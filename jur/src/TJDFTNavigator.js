// src/TJDFTNavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator do JurisDF — a consulta de jurisprudência do TJDFT.
 * https://jurisdf.tjdft.jus.br
 *
 * Este é o primeiro tribunal do repo com API **oficial e documentada**: o TJDFT
 * publica a "Documentação da API Pública de Consulta à Jurisprudência" no seu
 * portal de dados abertos (PDF), com endpoint, parâmetros e formato de resposta.
 *   https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/webservice-ou-api
 * Sem auth, sem captcha, sem sessão obrigatória.
 *
 * ⚠️ A DOCUMENTAÇÃO OFICIAL É INCOMPLETA. Ela lista só query/pagina/tamanho/
 * termosAcessorios, e diz do valor apenas "string ou data". Faltam nela, e foram
 * medidos na SPA oficial:
 *   - `sinonimos`, `espelho`, `inteiroTeor`, `retornaInteiroTeor`,
 *     `retornaTotalizacao` — parâmetros de topo que a própria tela envia;
 *   - a SINTAXE DE INTERVALO DE DATA, que é prosa em português:
 *     {campo:'dataJulgamento', valor:'entre 2024-01-01 e 2024-03-31'}
 *     Sem isso só dá para filtrar por data exata. Qualquer outra prosa
 *     ("a partir de", "até", "maior que") devolve HTTP 500.
 *
 * ⚠️ DOIS NÓS COM ÍNDICES DESSINCRONIZADOS — E A CORREÇÃO.
 * Requisições idênticas SEM cookie alternam entre dois resultados diferentes
 * (medido: hits 3528 x 2825, com conjuntos de ids distintos). O balanceador
 * devolve um cookie de sessão; REENVIÁ-LO fixa o nó e a resposta fica estável
 * (medido: 8/8 idênticas com cookie, 2 versões sem). Este navigator guarda e
 * reenvia o cookie — sem isso a paginação mistura dois índices e o crawler
 * entrega lista com furo e repetição.
 *
 * ⚠️ RATE LIMIT de 60 requisições por janela (header x-ratelimit-limit).
 * Excedeu, é HTTP 429. O navigator respeita x-ratelimit-remaining e espaça
 * sozinho; 429 é BLOQUEIO, não erro — não conclua que o tribunal caiu.
 */

const BASE_URL = 'https://jurisdf.tjdft.jus.br';
const API_URL = `${BASE_URL}/api/v1/pesquisa`;

/** Teto de `tamanho` aceito pela API: 30. Acima disso é HTTP 400. */
const TAMANHO_MAX = 30;

/**
 * Bases e subbases do acervo. A hierarquia vem da agregação `base`, que traz
 * `filhos` — mas ATENÇÃO: para FILTRAR um filho é preciso usar o campo
 * `subbase`. Passar 'acordaos-tr' em `base` devolve 0 sem erro (medido).
 */
const BASES = {
  acordaos: { base: 'acordaos', subbase: null, rotulo: 'Acórdãos (Justiça Comum 2º grau)' },
  turmas: { base: 'acordaos', subbase: 'acordaos-tr', rotulo: 'Acórdãos de Turma Recursal (Juizado Especial)' },
  comum: { base: 'acordaos', subbase: 'acordaos', rotulo: 'Acórdãos SEM Turma Recursal' },
  decisoes: { base: 'decisoes', subbase: null, rotulo: 'Decisões (monocráticas + presidência)' },
  monocraticas: { base: 'decisoes', subbase: 'decisoes-monocraticas', rotulo: 'Decisões monocráticas' },
  presidencia: { base: 'decisoes', subbase: 'decisoes-presidencia', rotulo: 'Decisões da Presidência' },
  sumulas: { base: 'sumulas', subbase: null, rotulo: 'Súmulas' },
  informativos: { base: 'informativo-jurisprudencia', subbase: null, rotulo: 'Informativo de Jurisprudência' },
  foco: { base: 'jurisprudencia-foco', subbase: null, rotulo: 'Jurisprudência em Foco' },
};

/**
 * ⚠️ ACERVOS SEM DATA DE JULGAMENTO.
 *
 * Decisões monocráticas e da Presidência têm SÓ `dataPublicacao` — o campo
 * `dataJulgamento` não existe nesses registros (medido 0/20 em cada, contra
 * 20/20 nos acórdãos). Consequência: filtrar por data de JULGAMENTO apaga esses
 * dois acervos inteiros, em silêncio e sem erro:
 *
 *   acervo=monocraticas, sem data ............ 2.743
 *   acervo=monocraticas, julgamento em 2024 ....... 0   <- some tudo
 *   acervo=monocraticas, publicação em 2024 ..... 272   <- o filtro certo
 *
 * Um 0 ali se lê como "não há decisão monocrática sobre o tema", quando o certo
 * é "essa pergunta precisa de -dpi/-dpf". O crawler avisa.
 */
const SEM_DATA_JULGAMENTO = ['decisoes-monocraticas', 'decisoes-presidencia'];

/** Campos aceitos em termosAcessorios. Qualquer outro devolve HTTP 400. */
const CAMPOS_FILTRO = [
  'base', 'subbase', 'origem', 'uuid', 'identificador', 'identificadorOrdenacao',
  'processo', 'nomeRelator', 'nomeRevisor', 'nomeRelatorDesignado',
  'descricaoOrgaoJulgador', 'dataJulgamento', 'dataPublicacao', 'descricaoClasseCnj',
];

class TJDFTNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
    /** cookie do balanceador — é o que fixa o nó. Ver cabeçalho. */
    this.cookie = options.cookie ?? null;
    /** margem antes de estourar o rate limit */
    this.margemRateLimit = options.margemRateLimit ?? 3;
    this._restantes = null;
    this._resetEm = null;
  }

  /** Espera o reset quando o rate limit está no fim. @private */
  async _respeitarRateLimit() {
    if (this._restantes === null || this._restantes > this.margemRateLimit) return;
    const espera = Math.max(1, Number(this._resetEm) || 60) * 1000 + 500;
    this.log(`Rate limit quase no fim (${this._restantes} restantes) — aguardando ${Math.round(espera / 1000)}s`);
    await new Promise((r) => setTimeout(r, espera));
    this._restantes = null;
  }

  /** POST no endpoint oficial, com cookie fixo e respeito ao rate limit. @private */
  async _post(body, attempt = 0) {
    await this._respeitarRateLimit();
    try {
      return await new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(API_URL, {
          method: 'POST',
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Origin: BASE_URL,
            Referer: `${BASE_URL}/`,
            ...(this.cookie ? { Cookie: this.cookie } : {}),
          },
        }, (res) => {
          // guarda o cookie do balanceador na PRIMEIRA resposta e nunca mais troca
          if (!this.cookie && res.headers['set-cookie']) {
            this.cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
          }
          if (res.headers['x-ratelimit-remaining'] !== undefined) {
            this._restantes = Number(res.headers['x-ratelimit-remaining']);
            this._resetEm = res.headers['x-ratelimit-reset'];
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode !== 200) {
              const err = new Error(`HTTP ${res.statusCode} no JurisDF: ${text.slice(0, 180)}`);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`JSON inválido: ${e.message}`)); }
          });
          res.on('error', reject);
        });
        req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout de ${this.timeout}ms`)));
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    } catch (err) {
      // 429 é bloqueio temporário: vale esperar o reset e repetir
      if (err.statusCode === 429 && attempt < this.retries) {
        const espera = (Number(this._resetEm) || 60) * 1000 + 1000;
        this.log(`HTTP 429 (rate limit) — aguardando ${Math.round(espera / 1000)}s e repetindo`);
        await new Promise((r) => setTimeout(r, espera));
        this._restantes = null;
        return this._post(body, attempt + 1);
      }
      // 400 é payload errado nosso; repetir dá o mesmo erro
      if (err.statusCode >= 400 && err.statusCode < 500) throw err;
      if (attempt < this.retries) {
        const espera = 2000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} em ${espera}ms: ${err.message}`);
        await new Promise((r) => setTimeout(r, espera));
        return this._post(body, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * Busca. Campos de topo seguem o que a SPA oficial envia (a doc oficial só
   * cita os três primeiros).
   * @param {Object} o - {query, termosAcessorios, pagina, tamanho, sinonimos,
   *   espelho, inteiroTeor, retornaInteiroTeor}
   */
  async buscar(o = {}) {
    const tamanho = Math.min(o.tamanho ?? 20, TAMANHO_MAX);
    return this._post({
      query: o.query ?? '',
      termosAcessorios: o.termosAcessorios ?? [],
      pagina: o.pagina ?? 0,
      tamanho,
      sinonimos: o.sinonimos ?? false,
      espelho: o.espelho ?? true,
      inteiroTeor: o.inteiroTeor ?? false,
      retornaInteiroTeor: o.retornaInteiroTeor ?? true,
      retornaTotalizacao: o.retornaTotalizacao ?? true,
    });
  }

  /**
   * Consulta direta por número de processo — alimenta o Checker.
   * ⚠️ EXIGE A MÁSCARA. Medido: '0705891-74.2023.8.07.0004' devolve 2 julgados;
   * o mesmo número só com dígitos devolve 0, sem erro. É o oposto do TJMG.
   */
  async buscarPorProcesso(numero) {
    const mascarado = this.constructor.mascaraCNJ(numero);
    const r = await this.buscar({
      query: '',
      termosAcessorios: [{ campo: 'processo', valor: mascarado }],
      tamanho: TAMANHO_MAX,
    });
    return (r && r.registros) || [];
  }

  /** Enumera o domínio dos filtros (relator, órgão, classe, base...) pela agregação. */
  async agregacoes(query = 'a') {
    const r = await this.buscar({ query, tamanho: 1 });
    return (r && r.agregacoes) || {};
  }

  /** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO (o formato que a API exige). */
  static mascaraCNJ(n) {
    const d = String(n ?? '').replace(/\D/g, '');
    if (!d) return String(n ?? '');
    const p = d.padStart(20, '0');
    return `${p.slice(0, 7)}-${p.slice(7, 9)}.${p.slice(9, 13)}.${p.slice(13, 14)}.${p.slice(14, 16)}.${p.slice(16, 20)}`;
  }

  /** DD/MM/AAAA ou YYYY-MM-DD → YYYY-MM-DD, validando o calendário. */
  static paraISO(d) {
    if (!d) return null;
    const s = String(d);
    let ano; let mes; let dia;
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) { [, dia, mes, ano] = br; } else {
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!iso) return null;
      [, ano, mes, dia] = iso;
    }
    const dt = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
    if (dt.getUTCFullYear() !== Number(ano) || dt.getUTCMonth() !== Number(mes) - 1
      || dt.getUTCDate() !== Number(dia)) return null;
    return `${ano}-${mes}-${dia}`;
  }

  /**
   * Monta o valor de intervalo de data. É a sintaxe NÃO DOCUMENTADA da API,
   * descoberta capturando o que a SPA envia: "entre YYYY-MM-DD e YYYY-MM-DD".
   * Só existe intervalo fechado — não há "a partir de" nem "até" (dão 500).
   * @returns {string|null} null quando não há os dois extremos
   */
  static intervaloData(inicio, fim) {
    const a = this.paraISO(inicio);
    const z = this.paraISO(fim);
    if (!a || !z) return null;
    return `entre ${a} e ${z}`;
  }

  /** Permalink do julgado no portal. */
  documentoUrl(uuid) {
    return `${BASE_URL}/documento/${uuid}`;
  }

  /**
   * Grava o inteiro teor de cada julgado em disco. O texto JÁ VEM na resposta
   * da busca (campo inteiroTeor) quando retornaInteiroTeor=true — não há
   * request adicional, ao contrário do TJMG.
   */
  async baixarLote(julgados, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const baixados = [];
    for (let i = 0; i < julgados.length; i += 1) {
      const j = julgados[i];
      const rotulo = j.processo || j.identificador || j.uuid;
      try {
        const texto = j.inteiroTeor || j.ementa || '';
        if (!texto) throw new Error('julgado sem inteiro teor nem ementa no payload');
        // identificador no nome: um processo tem vários julgados
        const base = sanitizeFilename(`${rotulo}-${j.identificador || j.uuid}`);
        const escritos = [];
        if (formats.includes('txt')) {
          fs.writeFileSync(path.join(outputDir, `${base}.txt`), stripHtml(texto), 'utf-8');
          escritos.push(`${base}.txt`);
        }
        if (formats.includes('html')) {
          fs.writeFileSync(path.join(outputDir, `${base}.html`), texto, 'utf-8');
          escritos.push(`${base}.html`);
        }
        log(`  [${i + 1}/${julgados.length}] ${rotulo} → ${escritos.join(', ')}`);
        baixados.push({ ...j, arquivo: escritos[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${julgados.length}] FALHOU ${rotulo}: ${err.message}`);
        baixados.push({ ...j, arquivo: null, downloadError: err.message });
      }
    }
    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(baixados, null, 2), 'utf-8');
    log(`Index saved to: ${indexPath}`);
    return baixados;
  }
}

TJDFTNavigator.BASE_URL = BASE_URL;
TJDFTNavigator.API_URL = API_URL;
TJDFTNavigator.BASES = BASES;
TJDFTNavigator.CAMPOS_FILTRO = CAMPOS_FILTRO;
TJDFTNavigator.SEM_DATA_JULGAMENTO = SEM_DATA_JULGAMENTO;
TJDFTNavigator.TAMANHO_MAX = TAMANHO_MAX;

module.exports = TJDFTNavigator;
