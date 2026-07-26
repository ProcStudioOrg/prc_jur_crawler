// src/FalcaoNavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator for FALCÃO — "Sistema de busca de jurisprudência" da Justiça do Trabalho.
 * https://jurisprudencia.jt.jus.br/jurisprudencia-nacional
 *
 * ESTE ARQUIVO É A CAMADA DE FAMÍLIA, NÃO DE UM TRIBUNAL.
 * O Falcão é a base ÚNICA de jurisprudência de TODA a Justiça do Trabalho:
 * TST + os 24 TRTs + CSJT. Ele é, aliás, desenvolvido pelo próprio TRT9 (o rodapé do
 * site diz "Desenvolvido por Tribunal Regional do Trabalho da 9ª Região").
 * Por isso o crawler de um TRT é literalmente `new FalcaoX({ tribunal: 'TRTn' })`
 * — ver `src/TRT9Navigator.js`, que tem cinco linhas.
 *
 * Acesso: `http` puro (API JSON pública, sem autenticação). Nenhum browser.
 *
 * Endpoints (todos GET, todos `no-auth`, descobertos no bundle Angular + Network):
 *   /jurisprudencia-nacional-backend/api/no-auth/pesquisa          — a busca
 *   /jurisprudencia-nacional-backend/api/no-auth/pesquisa/filtros  — facetas + contagens
 *   /jurisprudencia-nacional-backend/api/no-auth/autocompletar     — sugestões de termo
 *
 * RESSALVAS QUE CUSTAM CARO (todas verificadas, ver CLAUDE-TRT9.md):
 *
 * 1. CloudFront BLOQUEIA User-Agent de robô/headless. Sem um UA de navegador real
 *    a resposta é 403 "Request blocked". Isso vale inclusive para o Playwright
 *    headless com UA padrão. É por isso que `USER_AGENT` abaixo não é decorativo.
 * 2. `sessionId` é OBRIGATÓRIO e validado por formato: `_` + exatamente 7
 *    alfanuméricos. `_x1` ou `abcdefg` devolvem "Tentativa inválida de acesso
 *    ao sistema". Não precisa ser um id real — precisa ter o formato.
 * 3. Usuário anônimo: `size` ∈ {5, 10} e `page` ∈ 0..19. Qualquer outro valor é
 *    recusado com mensagem explícita. Teto duro: 200 resultados por consulta
 *    (a constante `LIMITE_MAXIMO_DE_REGISTROS_PARA_USUARIO_NAO_AUTENTICADO=200`
 *    está no próprio bundle do site). Para varrer mais, fatie por data/órgão.
 * 4. `quantidadeTotal` satura em 10000 (janela do Elasticsearch). "10000" quer
 *    dizer "10 mil ou mais", nunca exatamente 10 mil.
 * 5. O inteiro teor já VEM na resposta da busca — não há endpoint de documento
 *    nem permalink por documento. Em compensação a resposta é pesada
 *    (acórdãos trazem o brasão em base64; ~100 KB por documento).
 * 6. ESTRANGULAMENTO: em rajada o Falcão devolve HTTP 429 {"userMessage":"Too Many
 *    Requests"}. Não é bloqueio permanente nem erro de consulta, mas a janela é LONGA
 *    — medido: mais de 20 MINUTOS, não os "~45s" que se supunha. Varrer os 26 acervos
 *    em sequência bate nisso com facilidade,
 *    então o 429 tem orçamento de retry e backoff exponencial PRÓPRIOS (ver `_get`),
 *    e respeita `Retry-After` quando o servidor manda.
 */

const BASE_URL = 'https://jurisprudencia.jt.jus.br';
const API_URL = `${BASE_URL}/jurisprudencia-nacional-backend/api/no-auth`;
const APP_URL = `${BASE_URL}/jurisprudencia-nacional`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * AS COLEÇÕES — a desambiguação de instância/órgão da Justiça do Trabalho.
 *
 * É o equivalente funcional do "Justiça Comum × Juizado Especial" de um TJ.
 * Na Justiça do Trabalho não existem Juizados Especiais; o que existe é a
 * divisão por GRAU e por ÓRGÃO PROLATOR, e o Falcão a materializa como
 * coleções separadas (índices diferentes), não como um filtro solto.
 * Uma consulta pertence a UMA coleção — não há como misturar. Por isso a
 * separação é inequívoca: o resultado nunca é ambíguo quanto ao grau.
 */
const COLECOES = {
  sentencas: {
    valor: 'sentencas',
    rotulo: 'Sentenças',
    grau: '1',
    orgaos: 'Varas do Trabalho, Núcleos de Justiça 4.0, CEJUSC de 1º grau',
    descricao: '1º grau — sentenças e decisões de Vara do Trabalho (juízo monocrático de origem)',
  },
  acordaos: {
    valor: 'acordaos',
    rotulo: 'Acórdãos',
    grau: '2',
    orgaos: 'Turmas, Seção Especializada, Órgão Especial, Tribunal Pleno',
    descricao: '2º grau colegiado — acórdãos das Turmas e Seções do Tribunal Regional',
  },
  decisoesmonocraticas: {
    valor: 'decisoesmonocraticas',
    rotulo: 'Decisões Monocráticas',
    grau: '2',
    orgaos: 'Gabinetes de Desembargador, Presidência, Vice-Presidência, Corregedoria',
    descricao: '2º grau monocrático — decisões de relator/desembargador, não do colegiado',
  },
  recursorevista: {
    valor: 'recursorevista',
    rotulo: 'Admissibilidade de Recurso de Revista',
    grau: '2',
    orgaos: 'Vice-Presidência / OJC de Análise de Recurso',
    descricao: '2º grau — juízo de admissibilidade do RR (a porta de entrada do TST)',
  },
  precedentes: {
    valor: 'precedentes',
    rotulo: 'Precedentes',
    grau: 'qualificado',
    orgaos: 'STF, TST, TRTs (IRDR, IAC, IUJ, ArgInc, RRR, Repercussão Geral)',
    descricao: 'precedentes qualificados — base nacional (BNP), não é acervo de um TRT',
  },
};

/** Coleções que representam acervo decisório de um TRT (exclui `precedentes`). */
const COLECOES_TRIBUNAL = ['acordaos', 'sentencas', 'decisoesmonocraticas', 'recursorevista'];

/**
 * Os 26 acervos do Falcão: TST + TRT1..TRT24 + CSJT.
 * (Confirmado rodando `./bin/jur trt9 --listar-tribunais`.)
 */
const TRIBUNAIS = [
  'TST',
  ...Array.from({ length: 24 }, (_, i) => `TRT${i + 1}`),
  'CSJT',
];

/** UF atendida por cada TRT (usado para preencher o campo `uf` do resultado). */
const UF_POR_TRIBUNAL = {
  TST: 'BR', TRT1: 'RJ', TRT2: 'SP', TRT3: 'MG', TRT4: 'RS', TRT5: 'BA',
  TRT6: 'PE', TRT7: 'CE', TRT8: 'PA/AP', TRT9: 'PR', TRT10: 'DF/TO',
  TRT11: 'AM/RR', TRT12: 'SC', TRT13: 'PB', TRT14: 'RO/AC', TRT15: 'SP',
  TRT16: 'MA', TRT17: 'ES', TRT18: 'GO', TRT19: 'AL', TRT20: 'SE',
  TRT21: 'RN', TRT22: 'PI', TRT23: 'MT', TRT24: 'MS', CSJT: 'BR',
};

const ORDENACOES = {
  relevancia: 'mais_relevante',
  recentes: 'mais_recente',
  antigos: 'menos_recente',
};

/** Limites do usuário anônimo — impostos pelo servidor, não por nós. */
const LIMITES = {
  sizes: [5, 10],
  maxPage: 19,          // page 20 já é recusada
  maxResultados: 200,   // 20 páginas × 10
  tetoContagem: 10000,  // saturação de `quantidadeTotal`
};

/** Campo que carrega o inteiro teor em cada coleção (varia por coleção). */
const CAMPO_INTEIRO_TEOR = {
  acordaos: ['textoAcordao', 'highlightTextoAcordaoAnonimizado'],
  sentencas: ['textoSentenca', 'highlightSentencaAnonimizado'],
  decisoesmonocraticas: ['conteudoDocumento', 'textoDocumentoAnonim'],
  recursorevista: ['textoRecursoRevista', 'highlightRecursoRevistaAnonimizado'],
  precedentes: ['textoAcordaoMerito', 'textoAcordaoDecisao'],
};

class FalcaoNavigator {
  /**
   * @param {Object} options
   * @param {string} options.tribunal - 'TRT9', 'TRT2', 'TST'... ou null para a base inteira
   */
  constructor(options = {}) {
    this.tribunal = options.tribunal ?? null;
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    // Estrangulamento (429) é esperado em varredura longa — ver o backoff em _get.
    this.retriesRateLimit = options.retriesRateLimit ?? 5;
    this.backoffRateLimit = options.backoffRateLimit ?? 8000; // 8s, 16s, 32s...
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.log = options.log ?? (() => {});
    this.sessionId = options.sessionId ?? FalcaoNavigator.novoSessionId();
  }

  /**
   * Gera um sessionId no formato exigido: `_` + 7 alfanuméricos.
   * Formato inválido => "Tentativa inválida de acesso ao sistema" (HTTP 200!).
   */
  static novoSessionId() {
    const alfabeto = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '_';
    for (let i = 0; i < 7; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    return s;
  }

  /** @private Requisição GET com retries. */
  _get(endpoint, params, attempt = 0) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${API_URL}/${endpoint}?${qs}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': this.userAgent, // sem isto o CloudFront devolve 403
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Referer': `${APP_URL}/pesquisa`,
          'Origin': BASE_URL,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 429) {
            // Estrangulamento, não erro: varrer vários acervos em sequência bate
            // nisso com facilidade. Marcado para o backoff longo lá embaixo.
            const err = new Error(`HTTP 429 em ${endpoint}: limite de taxa do Falcão`);
            err.rateLimited = true;
            err.retryAfter = Number(res.headers['retry-after']) || null;
            return reject(err);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} em ${endpoint}: ${text.slice(0, 200)}`));
          }
          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            return reject(new Error(`JSON inválido de ${endpoint}: ${text.slice(0, 200)}`));
          }
          // O Falcão devolve erro de negócio com HTTP 200 + {userMessage}
          if (json && json.userMessage) {
            return reject(new Error(`Falcão recusou a consulta: ${json.userMessage}`));
          }
          resolve(json);
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout ${this.timeout}ms: ${endpoint}`)));
      req.on('error', reject);
    }).catch((err) => {
      // Erro de negócio (limite do usuário anônimo, formato) não adianta repetir
      if (/Falcão recusou/.test(err.message)) throw err;

      // 429 tem orçamento de tentativas e espera PRÓPRIOS: o backoff genérico de
      // 2s/4s não vence uma janela de estrangulamento, e desistir cedo derruba
      // uma varredura longa (varrer os 26 acervos bate nisso).
      const teto = err.rateLimited ? Math.max(this.retries, this.retriesRateLimit) : this.retries;
      if (attempt >= teto) throw err;
      const delay = err.rateLimited
        ? (err.retryAfter ? err.retryAfter * 1000 : this.backoffRateLimit * Math.pow(2, attempt))
        : 2000 * (attempt + 1);
      this.log(`Retry ${attempt + 1}/${teto} em ${Math.round(delay / 1000)}s: ${err.message}`);
      return new Promise((r) => setTimeout(r, delay)).then(() => this._get(endpoint, params, attempt + 1));
    });
  }

  /** @private Monta a querystring comum a /pesquisa e /pesquisa/filtros. */
  _params(p = {}) {
    const tribunais = p.tribunais !== undefined
      ? p.tribunais
      : (this.tribunal || '');
    return {
      sessionId: this.sessionId,
      latitude: 0,
      longitude: 0,
      texto: p.texto ?? '',
      verTodosPrecedentes: p.verTodosPrecedentes ?? false,
      tribunais: Array.isArray(tribunais) ? tribunais.join(',') : tribunais,
      pesquisaSomenteNasEmentas: p.pesquisaSomenteNasEmentas ?? false,
      colecao: p.colecao ?? 'acordaos',
      // filtros opcionais — só entram na URL se vierem preenchidos
      dataInicio: p.dataInicio,
      dataFim: p.dataFim,
      orgaoJulgador: p.orgaoJulgador,
      nomeRelator: p.nomeRelator,
      classeProcesso: p.classeProcesso,
      prioridade: p.prioridade,
      temEmenta: p.temEmenta,
      ordenacao: p.ordenacao,
      filtroRapidoData: p.filtroRapidoData,
      precedente: p.precedente,
      tipoPrecedente: p.tipoPrecedente,
    };
  }

  /**
   * Busca. `texto` aceita: palavras (OU implícito), "frase exata", -exclusão
   * e número de processo no padrão CNJ COM máscara.
   * @returns {Object} {documentos: [...], quantidadeTotal, temasTopFive}
   */
  async pesquisar(p = {}) {
    const page = p.page ?? 0;
    const size = p.size ?? 10;
    if (!LIMITES.sizes.includes(size)) {
      throw new Error(`size=${size} inválido para usuário anônimo (aceitos: ${LIMITES.sizes.join(', ')})`);
    }
    if (page > LIMITES.maxPage) {
      throw new Error(`page=${page} acima do teto do usuário anônimo (máx ${LIMITES.maxPage}; teto de ${LIMITES.maxResultados} resultados por consulta — fatie por data ou órgão)`);
    }
    return this._get('pesquisa', { ...this._params(p), page, size });
  }

  /** Facetas + contagens (é o que enumera órgãos, relatores, classes). */
  async filtros(p = {}) {
    return this._get('pesquisa/filtros', this._params(p));
  }

  /** @private Extrai uma faceta de /pesquisa/filtros. */
  async _faceta(nomeDoFiltro, p = {}) {
    const r = await this.filtros(p);
    const f = (r.filtrosDisponiveis || []).find((x) => x.nomeDoFiltro === nomeDoFiltro);
    return (f?.valoresFiltro || []).map((v) => ({
      valor: v.valor,
      rotulo: v.valorWeb,
      quantidade: v.quantidade,
    }));
  }

  /**
   * Órgãos julgadores disponíveis para uma coleção.
   * ATENÇÃO: `valor` NÃO é único entre tribunais ("1ª Turma" existe em todo TRT);
   * só desambigua junto com `tribunais`. O `rotulo` vem prefixado ("TRT9 - 1ª Turma").
   */
  listarOrgaosJulgadores(colecao = 'acordaos', p = {}) {
    return this._faceta('orgao_julgador', { ...p, colecao });
  }

  listarRelatores(colecao = 'acordaos', p = {}) {
    return this._faceta('nome_relator', { ...p, colecao });
  }

  listarClasses(colecao = 'acordaos', p = {}) {
    return this._faceta('ds_classe_judicial_sigla', { ...p, colecao });
  }

  listarPrioridades(colecao = 'acordaos', p = {}) {
    return this._faceta('prioridade', { ...p, colecao });
  }

  /** Contagem por coleção — é a prova de que a desambiguação de grau se aplica. */
  listarColecoes(p = {}) {
    return this._faceta('colecao', p);
  }

  /** Contagem por tribunal (os 26 acervos: TST + 24 TRTs + CSJT). */
  listarTribunais(p = {}) {
    return this._faceta('tribunal', { ...p, tribunais: '' });
  }

  /** Sugestões de termo (autocomplete oficial do site). */
  async autocompletar(texto) {
    return this._get('autocompletar', { texto });
  }

  /** Inteiro teor cru (HTML) de um documento, conforme a coleção. */
  inteiroTeor(doc, colecao) {
    for (const campo of CAMPO_INTEIRO_TEOR[colecao] || []) {
      if (doc[campo]) return doc[campo];
    }
    return '';
  }

  /** Ementa quando existe (só `acordaos` tem campo próprio de ementa). */
  ementa(doc, colecao) {
    if (colecao === 'acordaos') return doc.ementa || '';
    if (colecao === 'precedentes') return doc.textoEmentaMerito || doc.tese || '';
    return '';
  }

  /**
   * Grava o inteiro teor de cada resultado em .txt (e .html se pedido).
   * Não faz rede: o texto já veio junto da busca.
   */
  async baixarLote(results, outputDir, options = {}) {
    const log = options.log ?? (() => {});
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const out = [];
    for (const r of results) {
      const html = r._inteiroTeorHtml || r.inteiroTeor || '';
      const nome = sanitizeFilename(`${r.colecao || 'doc'}-${r.numeroProcesso || r.id || 'sem-numero'}`);
      const item = { numeroProcesso: r.numeroProcesso, arquivo: null };
      if (!html) {
        log(`  sem inteiro teor: ${r.numeroProcesso}`);
        out.push(item);
        continue;
      }
      if (formats.includes('txt')) {
        const p = path.join(outputDir, `${nome}.txt`);
        fs.writeFileSync(p, stripHtml(html), 'utf-8');
        item.arquivo = p;
      }
      if (formats.includes('html')) {
        const p = path.join(outputDir, `${nome}.html`);
        fs.writeFileSync(p, html, 'utf-8');
        item.arquivoHtml = p;
      }
      log(`  gravado: ${item.arquivo || item.arquivoHtml}`);
      out.push(item);
    }
    return out;
  }
}

FalcaoNavigator.BASE_URL = BASE_URL;
FalcaoNavigator.API_URL = API_URL;
FalcaoNavigator.APP_URL = APP_URL;
FalcaoNavigator.COLECOES = COLECOES;
FalcaoNavigator.COLECOES_TRIBUNAL = COLECOES_TRIBUNAL;
FalcaoNavigator.TRIBUNAIS = TRIBUNAIS;
FalcaoNavigator.UF_POR_TRIBUNAL = UF_POR_TRIBUNAL;
FalcaoNavigator.ORDENACOES = ORDENACOES;
FalcaoNavigator.LIMITES = LIMITES;
FalcaoNavigator.USER_AGENT = USER_AGENT;

module.exports = FalcaoNavigator;
