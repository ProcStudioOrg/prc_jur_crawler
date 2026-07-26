// src/TJMANavigator.js
const https = require('node:https');

/**
 * Navigator for the TJMA jurisprudence system (JurisConsult).
 *
 *   Portal: https://jurisconsult.tjma.jus.br/#/sg-jurisprudence-form
 *   API:    https://apijuris.tjma.jus.br/v1
 *
 * The portal is an Ionic 3 / Angular SPA backed by a clean REST API. Like
 * TJPA, no browser is needed to *talk* to it — but unlike TJPA, every search
 * route is gated server-side by TWO captchas:
 *
 *   1. TJMA's own image captcha (5 chars), from GET /util/gera_captcha,
 *      sent back as `Authorization: Bearer <tokenCaptcha> <resposta>`;
 *   2. Google reCAPTCHA v2 **invisible**, whose token goes on the
 *      querystring as `tokenG` (+ `keyId`).
 *
 * >>> THIS REPO DOES NOT AUTOMATE CAPTCHA SOLVING. <<<
 * Consequence: `buscar()` cannot complete unattended and throws
 * `CaptchaBloqueadoError`. That is the honest, intended behaviour — not a bug.
 * Full evidence: human-codegen/TJMA/09-jurisconsult/04-bloqueio-captcha.txt
 *
 * What DOES work here, and is used in production:
 *   - every combo/listing route below (open, no captcha);
 *   - `recaptchaHabilitado()`, the probe that tells you whether TJMA has
 *     switched the block off — the day it returns false, `buscar()` becomes
 *     usable with only the image captcha, and this file needs no rewrite;
 *   - `TJMAChecker`, which verifies process numbers via DataJud/CNJ instead.
 *
 * Search-route contract (reverse-engineered from build/5.js and
 * build/{197,198,199,200,201,202}.js — kept here so the mapping survives):
 *
 *   GET {API}/{rota do relatório}
 *       ?chave=&tipoPesquisa=&sistema=&relator=&revisor=&camara=
 *       &comarca=&vara=&classe=&condicao=&fraseExata=&checkForm=
 *       &dtaInicio=YYYY-MM-DD&dtaFim=YYYY-MM-DD
 *       &inicioPagina=&fimPagina=&tokenG=&keyId=
 *   Headers: Content-Type: application/json
 *            Authorization: Bearer <tokenCaptcha> <resposta do captcha>
 *   Null/empty params are omitted from the querystring.
 *   Response: {"response":{"processos":[...]}}, total in processos[0].int_count
 */

const BASE_URL = 'https://jurisconsult.tjma.jus.br';
const API_URL = 'https://apijuris.tjma.jus.br/v1';

/** Hash do site key do reCAPTCHA usado pela web desktop (`keyId`). */
const RECAPTCHA_KEY_ID = 'cf70bdaf271e5e3c8495a92b8e57ace0';

/**
 * Os 7 relatórios de jurisprudência do TJMA.
 *
 * ATENÇÃO: a desambiguação Justiça Comum × Turma Recursal × Juizado NÃO é um
 * filtro dentro de uma busca — é a escolha do relatório, e cada um bate numa
 * rota diferente sobre uma base diferente. Prova por conjuntos de opções em
 * human-codegen/TJMA/09-jurisconsult/03-relatorios-desambiguacao.txt.
 *
 * `chaves` diz o nome do campo de id em cada combo — ele MUDA entre rotas
 * (pkmatricula × matricula_id, pkcamara × camara_id, id_classe × classe_id).
 */
const RELATORIOS = {
  acordaos: {
    id: 1,
    titulo: 'Acórdãos',
    rota: '/sg/jurisprudencias/processos',
    foro: 'comum',
    grau: 2,
    campos: ['sistema', 'relator', 'revisor', 'camara', 'classe', 'condicao'],
    chaves: { relator: 'pkmatricula', camara: 'pkcamara', classe: 'id_classe' },
    tipoPesquisaPadrao: 1, // Ementa
  },
  'acordaos-tr': {
    id: 6,
    titulo: 'Acórdãos - Turma Recursal',
    rota: '/jurisprudencia/processos/pesquisa_acordaos_tr',
    foro: 'turmas',
    grau: 2,
    campos: ['relator', 'camara', 'classe', 'fraseExata'],
    chaves: { relator: 'matricula_id', camara: 'camara_id', classe: 'classe_id' },
    tipoPesquisaPadrao: 1, // Ementa
  },
  monocraticas: {
    id: 2,
    titulo: 'Decisões Monocráticas',
    rota: '/jurisprudencia/processos/pesquisa_monocraticas',
    foro: 'comum',
    grau: 2,
    campos: ['relator', 'camara', 'classe', 'fraseExata'],
    chaves: { relator: 'pkmatricula', camara: 'pkcamara', classe: 'id_classe' },
    tipoPesquisaPadrao: 8, // Decisão (não existe "Ementa" aqui)
  },
  'monocraticas-tr': {
    id: 5,
    titulo: 'Decisões Monocráticas - Turma Recursal',
    rota: '/jurisprudencia/processos/pesquisa_monocraticas_tr',
    foro: 'turmas',
    grau: 2,
    campos: ['relator', 'camara', 'classe', 'fraseExata'],
    chaves: { relator: 'pkmatricula', camara: 'camara_id', classe: 'classe_id' },
    tipoPesquisaPadrao: 8, // Decisão
  },
  sentencas: {
    id: 4,
    titulo: 'Sentenças de 1º Grau',
    rota: '/jurisprudencia/processos/sentencas_pg',
    foro: 'comum',
    grau: 1,
    campos: ['relator', 'comarca', 'vara', 'classe', 'fraseExata'],
    chaves: { relator: 'matricula_id', comarca: 'comarca_id', vara: 'vara_id', classe: 'classe_id' },
    tipoPesquisaPadrao: 11, // Sentença
  },
  'sentencas-je': {
    id: 7,
    titulo: 'Sentenças - Juizado Especial',
    rota: '/jurisprudencia/processos/sentencas_je',
    foro: 'juizados',
    grau: 1,
    campos: ['relator', 'comarca', 'vara', 'classe', 'fraseExata'],
    chaves: { relator: 'matricula_id', comarca: 'comarca_id', vara: 'vara_id', classe: 'classe_id' },
    tipoPesquisaPadrao: 11, // Sentença
  },
};

/** "Súmulas e Precedentes" (id 3) não é busca: devolve 3 links do portal. */
const ROTA_SUMULAS = '/jurisprudencia/links_pesquisa_sumulas';

/** Combo "Condição" — hardcoded no bundle (getConditions). Só no relatório 1. */
const CONDICOES = { e: '1', ou: '2', unico: '3' };

/** Combo "Sistema" — hardcoded no bundle (getSystems). Só no relatório 1. */
const SISTEMAS = { todos: '0', themis: 'ThemisSG', pje: 'Pje2G' };

/**
 * Erro lançado quando a API recusa a busca por causa do captcha.
 * É a resposta esperada do TJMA hoje — trate como bloqueio, não como falha
 * transitória (não adianta repetir).
 */
class CaptchaBloqueadoError extends Error {
  constructor(mensagem, detalhe = {}) {
    super(mensagem);
    this.name = 'CaptchaBloqueadoError';
    this.bloqueio = 'captcha';
    this.status = detalhe.status ?? null;
    this.codigo = detalhe.codigo ?? null;
    this.tribunal = 'TJMA';
  }
}

class TJMANavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * Low-level request. Returns {status, json, text} — it does NOT throw on
   * 4xx, because the 400/403 captcha bodies are exactly what we need to read.
   * @private
   */
  _request(method, url, headers = {}, attempt = 0) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          Origin: BASE_URL,
          Referer: `${BASE_URL}/`,
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* HTML de erro do servidor */ }
          resolve({ status: res.statusCode, json, text });
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms: ${url}`)));
      req.on('error', reject);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 2000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} after ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay))
          .then(() => this._request(method, url, headers, attempt + 1));
      }
      throw err;
    });
  }

  /** GET numa rota aberta (sem captcha); lança em status != 200. @private */
  async _getJson(rota) {
    const url = `${API_URL}${rota}`;
    const { status, json, text } = await this._request('GET', url);
    if (status !== 200 || !json) {
      throw new Error(`HTTP ${status} em ${rota}: ${text.slice(0, 200)}`);
    }
    return json;
  }

  // ---------------------------------------------------------------------
  // Rotas ABERTAS — funcionam sem captcha (é delas que saem os combos)
  // ---------------------------------------------------------------------

  /** Os 7 relatórios, com id/título/rota, direto da API. */
  async listaRelatorios() {
    const j = await this._getJson('/jurisprudencia/lista_relatorios');
    return j.response?.relatorios ?? [];
  }

  /** Opções de "Pesquisar pelo(a)" do relatório (Ementa, Inteiro Teor, ...). */
  async listaTiposPesquisa(relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_tipos_pesquisa?tipoRelatorio=${relatorioId}`);
    return j.tipos ?? [];
  }

  /** Classes judiciais do relatório. */
  async listaClasses(relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_classes?tipoRelatorio=${relatorioId}`);
    return j.classes ?? [];
  }

  /** Órgãos julgadores (câmaras / turmas recursais) do relatório. */
  async listaCamaras(relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_camaras?tipoRelatorio=${relatorioId}`);
    return j.camaras ?? [];
  }

  /** Relatores/revisores do relatório. */
  async listaMagistrados(relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_magistrados?tipoRelatorio=${relatorioId}`);
    return j.relatores ?? [];
  }

  /** Comarcas (só relatórios de 1º grau: 4 e 7). */
  async listaComarcas(relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_comarcas?tipoRelatorio=${relatorioId}`);
    return j.comarcas ?? [];
  }

  /** Varas de uma comarca (só relatórios de 1º grau: 4 e 7). */
  async listaVaras(comarcaId, relatorioId) {
    const j = await this._getJson(`/jurisprudencia/lista_todos_varas?comarca=${comarcaId}&tipoRelatorio=${relatorioId}`);
    return j.varas ?? [];
  }

  /**
   * "Súmulas e Precedentes" (relatório 3). Não é busca: devolve os links do
   * portal para IRDR admitidos, IAC admitidos e Súmulas do TJMA.
   * É a única rota da família de jurisprudência livre de captcha.
   */
  async linksPesquisaSumulas() {
    const j = await this._getJson(ROTA_SUMULAS);
    return j.response?.pesquisaSumulas ?? [];
  }

  // ---------------------------------------------------------------------
  // Diagnóstico do bloqueio
  // ---------------------------------------------------------------------

  /**
   * O reCAPTCHA ainda está ligado?
   *
   * Esta é a sonda que decide o destino do TJMA. Hoje devolve
   * `{habilitado: true}`; no dia em que o TJMA desligar, `buscar()` volta a
   * ser viável sem nenhuma reescrita — e o `jur-fixer` descobre isso aqui.
   *
   * @returns {Object} {habilitado, siteKey, keyId, permission}
   */
  async recaptchaHabilitado() {
    const [infos, perm] = await Promise.all([
      this._getJson(`/util/site_infos?tipo=${RECAPTCHA_KEY_ID}`),
      this._getJson('/util/permission_recaptcha'),
    ]);
    const si = infos.site_infos ?? {};
    const permissao = perm.permission?.[0]?.int_habilitado;
    return {
      habilitado: Number(si.int_habilitado) === 1 || Number(permissao) === 1,
      siteKey: si.str_public_key ?? null,
      keyId: si.str_hash_tipo ?? RECAPTCHA_KEY_ID,
      permission: Number(permissao),
    };
  }

  /**
   * Gera um captcha de imagem novo.
   *
   * Devolve o token opaco e a imagem, para que uma PESSOA leia e responda.
   * Este repositório não resolve captcha automaticamente — ver o cabeçalho.
   *
   * @returns {Object} {token, imagemBase64} — imagem JPEG 150x44
   */
  async gerarCaptcha() {
    const j = await this._getJson('/util/gera_captcha');
    const c = j.response?.captcha;
    if (!c) throw new Error('Resposta inesperada de /util/gera_captcha');
    // o campo `imagem` vem como hex de um base64 de JPEG
    const base64 = Buffer.from(c.imagem, 'hex').toString('utf-8');
    return { token: c.tokenCaptcha, imagemBase64: base64 };
  }

  /** Timestamp do servidor (usado pela paginação infinita do app mobile). */
  async timestampServidor() {
    const j = await this._getJson('/util/current-timestamp');
    return j.currentTimestamp;
  }

  // ---------------------------------------------------------------------
  // Busca — bloqueada por captcha
  // ---------------------------------------------------------------------

  /**
   * Monta a querystring da busca. `prepareGetParams` do site OMITE todo
   * parâmetro null/vazio — reproduzido aqui fielmente.
   * @private
   */
  _querystring(params) {
    const partes = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined || v === '') continue;
      partes.push(`${k}=${encodeURIComponent(v)}`);
    }
    return partes.join('&');
  }

  /**
   * Executa uma busca de jurisprudência.
   *
   * @param {string} rota - rota do relatório (RELATORIOS[x].rota)
   * @param {Object} params - parâmetros já com os nomes corretos da rota
   * @param {Object} credenciais - {tokenCaptcha, respostaCaptcha, tokenG, keyId}
   *   Sem `tokenG` VÁLIDO (reCAPTCHA v2 invisible resolvido por uma pessoa
   *   num navegador) a API responde 403 e este método lança
   *   CaptchaBloqueadoError.
   * @returns {Object} {processos: [...], total}
   * @throws {CaptchaBloqueadoError}
   */
  async buscar(rota, params, credenciais = {}) {
    const qs = this._querystring({
      ...params,
      tokenG: credenciais.tokenG ?? '',
      keyId: credenciais.keyId ?? RECAPTCHA_KEY_ID,
    });
    const url = `${API_URL}${rota}?${qs}`;

    const headers = { 'Content-Type': 'application/json' };
    if (credenciais.tokenCaptcha && credenciais.respostaCaptcha) {
      headers.Authorization = `Bearer ${credenciais.tokenCaptcha} ${credenciais.respostaCaptcha}`;
    }

    const { status, json, text } = await this._request('GET', url, headers);

    if (status === 200 && json?.response) {
      const processos = json.response.processos ?? [];
      return { processos, total: processos[0]?.int_count ?? processos.length };
    }

    const codigo = json?.error
      ?? json?.response?.validacao?.captcha_error
      ?? null;

    if (codigo && /captcha/i.test(codigo)) {
      throw new CaptchaBloqueadoError(TJMANavigator.explicarBloqueio(codigo), { status, codigo });
    }
    throw new Error(`HTTP ${status} em ${rota}: ${(text || '').slice(0, 200)}`);
  }

  /** Mensagem humana para cada código de erro de captcha da API. */
  static explicarBloqueio(codigo) {
    const comum =
      'A busca de jurisprudência do TJMA (JurisConsult) exige captcha de imagem + ' +
      'reCAPTCHA v2 invisible, ambos validados no servidor. Este repositório não ' +
      'automatiza resolução de captcha — o bloqueio é insuperável por ora. ' +
      'Veja CLAUDE-TJMA.md; para jurisprudência do MA use um tribunal vizinho.';
    const especifico = {
      captcha_not_provided: 'A API recusou a busca: nenhum captcha foi enviado.',
      incorrect_captcha: 'A API recusou a busca: captcha de imagem incorreto.',
      invalid_captcha_g: 'A API recusou a busca: token do reCAPTCHA (tokenG) inválido ou ausente.',
      expired_captcha: 'A API recusou a busca: captcha expirado.',
    }[codigo] ?? `A API recusou a busca (captcha: ${codigo}).`;
    return `${especifico} ${comum}`;
  }

  /** Permalink do portal para a tela de pesquisa. */
  formularioUrl() {
    return `${BASE_URL}/#/sg-jurisprudence-form`;
  }
}

TJMANavigator.BASE_URL = BASE_URL;
TJMANavigator.API_URL = API_URL;
TJMANavigator.RELATORIOS = RELATORIOS;
TJMANavigator.ROTA_SUMULAS = ROTA_SUMULAS;
TJMANavigator.CONDICOES = CONDICOES;
TJMANavigator.SISTEMAS = SISTEMAS;
TJMANavigator.RECAPTCHA_KEY_ID = RECAPTCHA_KEY_ID;
TJMANavigator.CaptchaBloqueadoError = CaptchaBloqueadoError;

module.exports = TJMANavigator;
