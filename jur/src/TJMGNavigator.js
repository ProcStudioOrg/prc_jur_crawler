// src/TJMGNavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator for the TJMG "Consulta de Jurisprudência Unificada"
 * (https://consulta-jurisprudencia.tjmg.jus.br/pesquisa).
 *
 * The SPA is backed by an OPEN JSON API with a PUBLIC OpenAPI spec at
 * https://jurisprudencia-api.tjmg.jus.br/v3/api-docs — no auth, no session,
 * no cookies, no captcha. So no browser is needed.
 *
 * ⚠️ NÃO use www5.tjmg.jus.br/jurisprudencia. Aquele é o portal ANTIGO e
 * devolve HTTP 401 + captcha numérico já na primeira busca, mesmo em sessão
 * limpa de Chromium real (medido 26/07/2026). O portal novo entrou no ar em
 * 22/06/2026 e, segundo o tribunal, vira a via principal em meados de agosto.
 * Mapeamento dos dois: human-codegen/TJMG/.
 *
 * Endpoints usados (todos POST, todos sem autenticação):
 *   /jurisprudencias/filter?size&page&sort   busca (JurisprudenciaFilter)
 *   /jurisprudencias/document                inteiro teor em HTML
 *   /dominio/{field}                         enumera um combo com contagem
 *
 * TRÊS ARMADILHAS DA API, todas medidas, todas com HTTP 500 como sintoma:
 *  1. /dominio/{field} quebra se o corpo levar `texto` ou `tipoTexto`.
 *  2. Busca por `numerosProcessos` quebra se o corpo levar `texto`/`tipoTexto`.
 *     A SPA omite os dois nessa chamada.
 *  3. /jurisprudencias/document exige `documentoId` E `datasPublicacao` com
 *     inicio = fim = a data de publicação daquele documento. Só o hash não basta.
 *
 * E uma quarta, silenciosa: `totalRecords` satura em 1000. Abaixo disso é
 * exato; igual a 1000 quer dizer "1000 ou mais". `total: true` não levanta o
 * teto. A PAGINAÇÃO, porém, continua andando muito além (page=150 ainda
 * devolve itens) — não use totalRecords para decidir quando parar.
 */

const BASE_URL = 'https://consulta-jurisprudencia.tjmg.jus.br';
const API_URL = 'https://jurisprudencia-api.tjmg.jus.br';
const CONSULTA_PROCESSUAL_URL = 'https://consulta.tjmg.jus.br/home';

/** O contador da API satura aqui. Ver o cabeçalho. */
const TETO_CONTADOR = 1000;

/**
 * Os únicos 4 tipos de documento da base (medidos em 26/07/2026, acervo
 * inteiro). É por aqui que se separa Juizado de Justiça Comum.
 */
const TIPOS_DOCUMENTO = {
  acordao: 'Acórdão',
  monocratica: 'Decisão Monocrática',
  turmas: 'Decisão Turma Recursal',
  vice: 'Decisão Vice-Presidência',
};

/**
 * ⚠️ SÓ "Acórdão" TEM EMENTA INDEXADA.
 *
 * Buscar com tipoTexto=EMENTA nestes três tipos devolve SEMPRE 0 — não porque
 * não existam julgados, mas porque o índice de ementa deles está vazio. Medido
 * em 26/07/2026 com 5 termos diferentes (usucapião, dano moral, honorários,
 * recurso, prescrição): 0 em EMENTA para os três, e 259 / 776 / 1000+ nos mesmos
 * termos em INTEIRO_TEOR.
 *
 * Consequência prática, e a razão de isto existir como constante: a busca
 * default do portal é por ementa. Quem pesquisar Juizado Especial mineiro sem
 * trocar o escopo recebe "0 resultados" e conclui que nenhuma Turma Recursal
 * decidiu o tema. O certo é dizer "essa pergunta precisa de --escopo inteiroTeor".
 */
const SEM_EMENTA_INDEXADA = [
  TIPOS_DOCUMENTO.monocratica,
  TIPOS_DOCUMENTO.turmas,
  TIPOS_DOCUMENTO.vice,
];

/** Campos aceitos por POST /dominio/{field}. */
const DOMINIOS = ['tiposDocumento', 'classes', 'comarcas', 'orgaosJulgadores', 'magistrados', 'assuntos'];

/** Valores aceitos em `sort` (a API responde 500 a qualquer outro). */
const ORDENACOES = {
  relevancia: 'relevancia',
  recentes: 'publicacao_data',
  julgamento: 'julgamento_data',
};

class TJMGNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * POST JSON com retry. Devolve {json} ou {text} conforme o content-type —
   * /jurisprudencias/document responde HTML, não JSON.
   * @private
   */
  _post(pathname, body, attempt = 0) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(`${API_URL}${pathname}`, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/`,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            // a API embute o motivo real em `detail` — vale mais que "HTTP 500"
            let detalhe = text.slice(0, 200);
            try { detalhe = JSON.parse(text).detail || detalhe; } catch { /* texto cru mesmo */ }
            const erro = new Error(`HTTP ${res.statusCode} em ${pathname}: ${detalhe}`);
            erro.statusCode = res.statusCode;
            return reject(erro);
          }
          try { resolve({ json: JSON.parse(text) }); } catch { resolve({ text }); }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout de ${this.timeout}ms em ${pathname}`)));
      req.on('error', reject);
      req.write(payload);
      req.end();
    }).catch((err) => {
      // 4xx é payload errado nosso: repetir dá o mesmo erro e só custa tempo.
      // Os 500 desta API também são determinísticos (campo a mais no corpo),
      // mas 5xx pode ser instabilidade real, então esse a gente ainda repete.
      const semRepeticao = err.statusCode >= 400 && err.statusCode < 500;
      if (!semRepeticao && attempt < this.retries) {
        const delay = 2000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} em ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay)).then(() => this._post(pathname, body, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * Corpo-base do JurisprudenciaFilter. Todos os arrays precisam existir, mesmo
   * vazios. `texto`/`tipoTexto` NÃO entram aqui — quem precisa deles é só a
   * busca textual, e a presença deles quebra /dominio e a busca por número.
   * @private
   */
  _filtroBase(o = {}) {
    return {
      ids: [],
      numerosProcessos: [],
      tiposDocumento: [],
      orgaosJulgadores: [],
      magistrados: [],
      classes: [],
      assuntos: [],
      comarcas: [],
      datasPublicacao: [],
      datasJulgamento: [],
      total: false,
      ...o,
    };
  }

  /**
   * Busca textual.
   * @param {Object} filtro - campos do JurisprudenciaFilter (ver _filtroBase)
   * @param {Object} pag - {page=0, size=20, sort='relevancia'}
   * @returns {Object} {retrieveTime, totalRecords, jurisprudencias:[...]}
   */
  async buscar(filtro = {}, pag = {}) {
    const page = pag.page ?? 0;
    const size = pag.size ?? 20;
    const sort = ORDENACOES[pag.sort] ?? pag.sort ?? 'relevancia';
    const body = {
      ...this._filtroBase(filtro),
      texto: filtro.texto ?? '',
      tipoTexto: filtro.tipoTexto ?? 'EMENTA',
    };
    const res = await this._post(`/jurisprudencias/filter?size=${size}&page=${page}&sort=${sort},DESC`, body);
    return res.json;
  }

  /**
   * Consulta direta por número de processo — é o que alimenta o Checker.
   * ⚠️ O corpo NÃO pode levar `texto`/`tipoTexto`: a API responde 500. A SPA
   * oficial também os omite nesta chamada.
   * @param {string|string[]} numeros - CNJ com ou sem máscara
   * @returns {Array} julgados encontrados
   */
  async buscarPorProcesso(numeros) {
    const lista = (Array.isArray(numeros) ? numeros : [numeros])
      .map((n) => String(n).replace(/\D/g, ''))
      .filter(Boolean);
    if (!lista.length) return [];
    const res = await this._post(
      '/jurisprudencias/filter?size=50&page=0&sort=publicacao_data,DESC',
      this._filtroBase({ numerosProcessos: lista }),
    );
    return (res.json && res.json.jurisprudencias) || [];
  }

  /**
   * Enumera um combo (com a contagem de documentos de cada valor).
   * @param {string} field - um de DOMINIOS
   * @param {Object} filtro - restringe o domínio (ex.: só de uma comarca)
   * @returns {Array<{dominio:string, quantidade:string}>}
   */
  async dominio(field, filtro = {}) {
    if (!DOMINIOS.includes(field)) {
      throw new Error(`Domínio inválido: "${field}". Válidos: ${DOMINIOS.join(', ')}`);
    }
    // _filtroBase de propósito: texto/tipoTexto aqui derrubam o endpoint (500)
    const res = await this._post(`/dominio/${field}`, this._filtroBase(filtro));
    return (res.json && res.json.dominios) || [];
  }

  /**
   * Inteiro teor de um julgado, em HTML.
   * ⚠️ Exige o par (documentoId, data de publicação). Sem a data → HTTP 500
   * "Dados de documento inválidos ou incompletos".
   * @param {string} documentoId
   * @param {string} dataPublicacao - DD/MM/AAAA ou YYYY-MM-DD
   * @returns {string} HTML
   */
  async inteiroTeor(documentoId, dataPublicacao) {
    if (!documentoId) throw new Error('inteiroTeor: documentoId é obrigatório');
    const iso = this.constructor.paraISO(dataPublicacao);
    if (!iso) {
      throw new Error(`inteiroTeor: data de publicação obrigatória e inválida: "${dataPublicacao}"`);
    }
    const res = await this._post('/jurisprudencias/document', {
      ...this._filtroBase({ datasPublicacao: [{ inicio: iso, fim: iso }] }),
      documentoId: String(documentoId),
      texto: null,
      tipoTexto: null,
    });
    return res.text ?? (typeof res.json === 'string' ? res.json : JSON.stringify(res.json));
  }

  /**
   * DD/MM/AAAA ou YYYY-MM-DD → YYYY-MM-DD. null se não reconhecer.
   * Valida o calendário, não só o formato: "31/13/2024" casa com a regex mas a
   * API responde 500 com "Validation failed for argument", que não ajuda ninguém
   * a descobrir que digitou o mês errado.
   */
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
    // o Date "conserta" 31/02 virando 03/03 — comparar de volta pega isso
    if (dt.getUTCFullYear() !== Number(ano)
      || dt.getUTCMonth() !== Number(mes) - 1
      || dt.getUTCDate() !== Number(dia)) return null;
    return `${ano}-${mes}-${dia}`;
  }

  /** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO. */
  static mascaraCNJ(n) {
    const d = String(n ?? '').replace(/\D/g, '').padStart(20, '0');
    if (d.length !== 20) return String(n ?? '');
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
  }

  /** Permalink do inteiro teor no portal (o que um humano abre no navegador). */
  documentoUrl(documentoId, dataPublicacao) {
    const iso = this.constructor.paraISO(dataPublicacao);
    return `${BASE_URL}/inteiro-teor?documentoId=${documentoId}${iso ? `&publicacaoData=${iso}` : ''}`;
  }

  /** Link do processo na Consulta Processual Unificada (outro sistema). */
  processoUrl(numeroCnj) {
    return `${CONSULTA_PROCESSUAL_URL}?numeroProcesso=${this.constructor.mascaraCNJ(numeroCnj)}`;
  }

  /**
   * Baixa o inteiro teor de vários julgados, gravando .txt (e .html se pedido)
   * + um index.json. Mesmo contrato de inteiroTeorFetcher.batchDownload.
   * @param {Array} julgados - resultados mapeados (precisam de documentoId e dataPublicacao)
   * @returns {Array} julgados com `arquivo` ou `downloadError`
   */
  async baixarLote(julgados, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const baixados = [];
    for (let i = 0; i < julgados.length; i += 1) {
      const j = julgados[i];
      const rotulo = j.processo || j.numeroProcesso || j.documentoId;
      try {
        // eslint-disable-next-line no-await-in-loop
        const html = await this.inteiroTeor(j.documentoId, j.dataPublicacao);
        // documentoId no nome: um mesmo processo pode ter vários julgados
        // (acórdão + monocrática, p.ex.) e só o número faria um sobrescrever o
        // outro, com as duas entradas do index.json apontando para um arquivo só.
        const base = sanitizeFilename(`${rotulo || 'documento'}-${j.documentoId}`);
        const escritos = [];
        if (formats.includes('txt')) {
          fs.writeFileSync(path.join(outputDir, `${base}.txt`), stripHtml(html), 'utf-8');
          escritos.push(`${base}.txt`);
        }
        if (formats.includes('html')) {
          fs.writeFileSync(path.join(outputDir, `${base}.html`), html, 'utf-8');
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

TJMGNavigator.BASE_URL = BASE_URL;
TJMGNavigator.API_URL = API_URL;
TJMGNavigator.TIPOS_DOCUMENTO = TIPOS_DOCUMENTO;
TJMGNavigator.SEM_EMENTA_INDEXADA = SEM_EMENTA_INDEXADA;
TJMGNavigator.DOMINIOS = DOMINIOS;
TJMGNavigator.ORDENACOES = ORDENACOES;
TJMGNavigator.TETO_CONTADOR = TETO_CONTADOR;

module.exports = TJMGNavigator;
