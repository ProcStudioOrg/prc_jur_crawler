// src/TJPBNavigator.js
const https = require('node:https');

/**
 * Fala com a API REST de jurisprudência do TJPB (portal Juris-PB).
 *
 * O portal (https://app.tjpb.jus.br/juris-pb) é uma SPA Angular 19 + PrimeNG
 * cujo backend é um Spring Boot sobre Elasticsearch. O crawler não usa browser:
 * o mapeamento foi feito no Playwright (human-codegen/TJPB/), mas o acesso final
 * é HTTP direto.
 *
 * ✅ **Sem auth, sem token, sem cookie, sem sessão e sem captcha.** `/public/*`
 * responde ao `curl` cru. Medido em 08/08/2026 e reconfirmado em 13/08/2026.
 *
 * 🔴 **A TELA está atrás do Cloudflare e a API NÃO.** Medido em 13/08/2026:
 * `https://app.tjpb.jus.br/juris-pb/...` (o index e **todos** os assets:
 * `browser-*.js`, `search.page-*.js`, PNG, woff) devolve **403 ao `curl`**,
 * inclusive como primeira requisição de um contexto novo — o que **corrige a
 * hipótese gravada em 08/08** de que o 403 era cota de rate limit. No Playwright
 * o documento HTML carrega (46 KB) e os sub-recursos continuam 403, então a SPA
 * nunca renderiza. Nada disso afeta este Navigator: o host é o mesmo, o caminho
 * `/juris-pb-backend/public/*` é que está fora do challenge.
 */

const HOST = 'app.tjpb.jus.br';
const BASE = '/juris-pb-backend/public';
const ORIGIN = 'https://app.tjpb.jus.br';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/**
 * Máximo aceito em `size`. Medido: 50 responde; 51 e 100 devolvem **HTTP 400
 * honesto** (`search.size: deve ser menor que ou igual à 50`) — não é zero
 * silencioso, ao contrário de meio repo.
 */
const SIZE_MAX = 50;

/** Cada item traz o inteiro teor (5–21 mil chars), então a página pesa. */
const SIZE_DEFAULT = 20;

/**
 * Teto de offset (`page * size`). O backend é Elasticsearch com o
 * `max_result_window` padrão: medido em 13/08/2026, `page=500&size=10`
 * (offset 5.000) responde 200 e `page=1000&size=10` (offset 10.000) devolve
 * **HTTP 404 `ElasticSearchQueryException: Falha ao consultar Elasticsearch`**.
 * É o mesmo teto do TJRO, com erro menos honesto (404, não 500).
 */
const OFFSET_MAX = 10000;

/** Os 7 combos são AUTOCOMPLETE: exigem `term` e não listam o acervo (ver §3 do doc). */
const OPCOES = ['competencias', 'classes', 'comarcas', 'varas', 'orgaos-julgadores', 'relatores', 'processos'];

class TJPBNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 120000;
    this.log = options.log ?? console.log;
    this.agent = new https.Agent({ keepAlive: true });
  }

  /** GET cru. @private */
  _get(path) {
    return new Promise((resolve, reject) => {
      const req = https.get({
        host: HOST,
        path,
        agent: this.agent,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Origin: ORIGIN,
          Referer: `${ORIGIN}/juris-pb/`,
        },
        timeout: this.timeout,
      }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout falando com a API do TJPB')));
    });
  }

  /** GET que exige JSON. @private */
  async _json(path) {
    const r = await this._get(path);
    if (r.status !== 200) {
      let detalhe = String(r.body).slice(0, 160);
      try {
        const j = JSON.parse(r.body);
        detalhe = j.message || j.detail || detalhe;
      } catch { /* corpo não-JSON: fica o recorte cru */ }
      const e = new Error(`HTTP ${r.status} da API do TJPB (${detalhe})`);
      e.status = r.status;
      throw e;
    }
    try {
      return JSON.parse(r.body);
    } catch {
      throw new Error(`Resposta nao-JSON do TJPB (${String(r.body).slice(0, 120)})`);
    }
  }

  /** Monta a querystring, descartando vazios. Array vira parâmetro repetido. @private */
  static qs(params) {
    const partes = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      for (const item of Array.isArray(v) ? v : [v]) {
        if (item === undefined || item === null || item === '') continue;
        partes.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
      }
    }
    return partes.join('&');
  }

  /**
   * Uma página de busca.
   *
   * @param {Object} params - já com os nomes da API (`searchTerm`, `grau`,
   *   `advanced`, `codigoComarca`, `intervaloJulgamentoPrimeiroDia`...)
   * @param {number} page - **0-based** (a tela mostra 1-based)
   * @param {number} size - máx. 50
   * @returns {Promise<{content: Array, total: number, totalPages: number, last: boolean}>}
   */
  async buscar(params, page = 0, size = SIZE_DEFAULT) {
    if (size > SIZE_MAX) {
      throw new Error(`size maximo do TJPB e ${SIZE_MAX} (pedido: ${size}) — acima disso a API devolve HTTP 400`);
    }
    if ((page + 1) * size > OFFSET_MAX) {
      throw new Error(
        `offset (page*size = ${page * size}) passa do teto de ${OFFSET_MAX} do Elasticsearch do TJPB — ` +
        'acima disso a API devolve HTTP 404 "Falha ao consultar Elasticsearch". ' +
        'Recorte a busca por data (--advanced) em vez de paginar fundo.'
      );
    }
    const d = await this._json(`${BASE}/search?${TJPBNavigator.qs({
      ...params,
      page,
      size,
      sort: params.sort || 'DATA_JULGAMENTO',
      order: params.order || 'DESC',
    })}`);
    return {
      content: d.content || [],
      // ⚠️ `totalPages` da API é `totalElements/size`, não um número absoluto de
      // páginas: com size=1 ele vem igual a totalElements. Não o leia como
      // "o acervo tem 2,5 milhões de páginas".
      total: Number(d.totalElements ?? 0),
      totalPages: Number(d.totalPages ?? 0),
      last: !!d.last,
      numberOfElements: Number(d.numberOfElements ?? (d.content || []).length),
    };
  }

  /** Só o total, sem arrastar documento (size=1 ainda traz 1 inteiro teor). */
  async contar(params) {
    const r = await this.buscar(params, 0, 1);
    return r.total;
  }

  /**
   * Autocomplete de um combo.
   *
   * 🔴 **NÃO são combos enumeráveis**: sem `term` a API responde HTTP 400
   * (`Required parameter 'term' is not present`), e com `term=` vazio devolve
   * lista vazia. Não existe endpoint com a lista canônica — mesma pendência do
   * TJES/TJTO. O que volta é `[{id, nome}]`.
   *
   * ⚠️ E o mesmo NOME pode ter vários ids: `comarcas?term=joao` devolve três
   * "João Pessoa" (200, 0 e 9010) e os três filtram contagens diferentes
   * (1.689 / 3.169 / 41 em `usucapião`). Escolher o primeiro é escolher errado.
   */
  async opcoes(tipo, term) {
    if (!OPCOES.includes(tipo)) {
      throw new Error(`combo invalido: "${tipo}" (use ${OPCOES.join(', ')})`);
    }
    if (!term) {
      throw new Error(
        `o combo "${tipo}" do TJPB e AUTOCOMPLETE: exige um termo. ` +
        'Sem `term` a API devolve HTTP 400 e nao existe endpoint que liste o acervo inteiro.'
      );
    }
    return this._json(`${BASE}/options/${tipo}?${TJPBNavigator.qs({ term })}`);
  }
}

TJPBNavigator.HOST = HOST;
TJPBNavigator.BASE = BASE;
TJPBNavigator.ORIGIN = ORIGIN;
TJPBNavigator.SIZE_MAX = SIZE_MAX;
TJPBNavigator.SIZE_DEFAULT = SIZE_DEFAULT;
TJPBNavigator.OFFSET_MAX = OFFSET_MAX;
TJPBNavigator.OPCOES = OPCOES;

module.exports = TJPBNavigator;
