// src/TCEGONavigator.js
const https = require('https');

/**
 * TCEGONavigator — fala com o "Iago", o SPA de Consulta Ampla de Decisoes do TCE-GO.
 *
 * PORTA: API REST INTERNA sobre Elasticsearch. Sem auth, sem cookie, sem CSRF,
 * sem sessao, sem captcha e sem WAF (medido em 22/08/2026: 30 requisicoes
 * sequenciais em 6 s e 20 em paralelo, TODAS 200).
 *   POST https://iago-search-api.tce.go.gov.br/decisions/search?<filtros>   (busca)
 *   POST https://iago-search-api.tce.go.gov.br/decisions/aggregations?<f>   (combos + contagem EXATA)
 *   GET  https://iago-search-api.tce.go.gov.br/decisions/<id>               (INTEIRO TEOR em texto)
 *   GET  https://iago-search-api.tce.go.gov.br/decisions/url/<id>?type=WEBSITE  (permalink do processo)
 *
 * O endpoint NAO foi chutado: o cliente axios esta literal no bundle do Next.js
 * `decisoes.tce.go.gov.br/_next/static/chunks/670-*.js`, e o contrato foi
 * confirmado no Playwright pela aba Network. Detalhe em
 * human-codegen/TCEGO/01-decisoes/.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (procurado e medido, nao presumido):
 *   ⚠️ `dadosabertos.tce.go.gov.br` — EXISTE (CKAN 2.9.10, 200), mas os 63 datasets
 *      sao indicadores de saude/educacao/seguranca. ZERO de jurisprudencia.
 *   🔴 `/swagger`, `/swagger-ui.html`, `/api-docs`, `/openapi.json` -> 401;
 *      `/v3/api-docs` -> 500. Sem contrato publicado.
 *   🔴 `antigo-decisoes.tce.go.gov.br` — SEM DNS. O proprio SPA linka esse host
 *      morto no botao "Acessar a versao antiga!".
 *   🔴 DataJud/CNJ NAO se aplica — contas nao e Judiciario. E a numeracao e
 *      propria: processo `AAAANNNNNNNNNNN` (15 digitos), decisao `NNNNN/AAAA`.
 *      `src/cnj.js` reprovaria todo processo valido. Como no resto do Bloco 5,
 *      NAO HA PLANO B se o portal cair.
 *   ⚠️ NAO e vhost curinga: `host-inventado-9z.tce.go.gov.br` nao resolve DNS,
 *      entao os 200 de `decisoes`/`dadosabertos` sao aplicacoes de verdade.
 *
 * 🔴 O PDF ORIGINAL ESTA QUEBRADO, E NAO E BLOQUEIO — E LINK PENDURADO.
 * `GET /decisions/url/<id>?type=DOCUMENT` devolve uma URL
 * `…/ConsultaDecisoes/CarregaDocumentoAssinadoPDF?idDocumento=…` que responde
 * HTTP 200 `text/html` com o app shell do Next (14.270 bytes por curl; 0 caractere
 * de texto em aba limpa do Playwright). O host que serviria esse caminho
 * (`antigo-decisoes`) nao tem DNS. E `GET /decisions/download?id=<id>&type=DOCUMENT`
 * responde HTTP 500 com e sem Origin/Referer de browser.
 * ✅ A saida existe e e melhor: `GET /decisions/<id>` devolve `{id, text}` com o
 * INTEIRO TEOR em texto puro, livre, medido nos QUATRO tipos de documento
 * (2.272 a 39.055 chars). O crawler usa esse — nao ha PDF a baixar.
 */

const HOST = 'iago-search-api.tce.go.gov.br';
const HOST_WEB = 'decisoes.tce.go.gov.br';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 🔴 O `track_total_hits` do Elasticsearch vazando como total. Ver §21 do mapeamento. */
const TETO_TOTAL = 10000;

class TCEGONavigator {
  constructor({ log = console.log, timeout = 180000 } = {}) {
    this.log = log;
    this.timeout = timeout;
  }

  _req(url, { method = 'GET', body = null } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const u = new URL(url);
      const headers = { 'User-Agent': UA, Accept: 'application/json' };
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const req = https.request(
        { hostname: u.hostname, path: u.pathname + u.search, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              ms: Date.now() - t0,
            }),
          );
        },
      );
      req.setTimeout(this.timeout, () =>
        req.destroy(
          new Error(`sem resposta de ${u.hostname} apos ${Date.now() - t0} ms (teto ${this.timeout} ms)`),
        ),
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  static get TETO_TOTAL() {
    return TETO_TOTAL;
  }

  /**
   * 🔴 TODO FILTRO VAI NA QUERYSTRING; SO O TERMO VAI NO CORPO.
   * `POST /decisions/search?year=2024&type=Ac%C3%B3rd%C3%A3o` + `{"term":"..."}`.
   * Mandar o filtro no corpo e o erro obvio e ele e IGNORADO em silencio.
   *
   * 🔴 VALOR INVALIDO EM `order` RESPONDE HTTP 500 (medido). Os demais filtros
   * com valor inventado devolvem 0 com HTTP 200 — ou seja, ha as duas falhas.
   */
  async buscar({ term = '', params = {} } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const url = `https://${HOST}/decisions/search${qs.toString() ? '?' + qs : ''}`;
    const r = await this._req(url, { method: 'POST', body: JSON.stringify({ term }) });
    if (r.status !== 200) {
      throw new Error(
        `busca respondeu HTTP ${r.status} em ${url} — ${r.body.slice(0, 200)}` +
          (r.status === 500 ? ' (500 aqui costuma ser valor invalido em `order` ou data fora do ISO)' : ''),
      );
    }
    let j;
    try {
      j = JSON.parse(r.body);
    } catch (e) {
      throw new Error(`busca devolveu corpo nao-JSON (${r.body.length} bytes): ${r.body.slice(0, 200)}`);
    }
    return {
      documentos: j.content || [],
      totalBruto: j.totalElements,
      numberOfElements: j.numberOfElements,
      ms: r.ms,
    };
  }

  /**
   * ✅ A CONTAGEM EXATA MORA AQUI, e e a saida para o total saturado da busca.
   * Devolve `[{key, agg:[{label, value}]}]` com area, tema, subtema, ano,
   * tipo_documento, colegiado, tipo_sessao, relator_decisao, relator_processo.
   * A soma de `ano` = a soma de `tipo_documento` = o acervo, mesmo acima de 10.000.
   */
  async agregacoes({ term = '', params = {} } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const url = `https://${HOST}/decisions/aggregations${qs.toString() ? '?' + qs : ''}`;
    const r = await this._req(url, { method: 'POST', body: JSON.stringify({ term }) });
    if (r.status !== 200) throw new Error(`aggregations respondeu HTTP ${r.status}`);
    try {
      return JSON.parse(r.body);
    } catch (e) {
      throw new Error(`aggregations devolveu corpo nao-JSON: ${r.body.slice(0, 200)}`);
    }
  }

  /** 🟢 Inteiro teor em texto puro. Chave SIMPLES: so o `id` do documento. */
  async inteiroTeor(id) {
    const r = await this._req(`https://${HOST}/decisions/${encodeURIComponent(id)}`);
    if (r.status !== 200) return null;
    try {
      const j = JSON.parse(r.body);
      return typeof j.text === 'string' ? j.text : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Permalink do PROCESSO (nao do documento — este tribunal nao tem permalink de
   * documento, §23 do mapeamento). Responde `text/plain` com a URL.
   * ⚠️ O `proc=` da URL e um TERCEIRO identificador interno: nao e o `id` do
   * documento nem o `process` do card. So se obtem por aqui.
   */
  async urlProcesso(id) {
    const r = await this._req(`https://${HOST}/decisions/url/${encodeURIComponent(id)}?type=WEBSITE`);
    if (r.status !== 200) return null;
    const u = String(r.body || '').trim();
    return /^https?:\/\//.test(u) ? u : null;
  }

  static get HOST_WEB() {
    return HOST_WEB;
  }
}

module.exports = TCEGONavigator;
