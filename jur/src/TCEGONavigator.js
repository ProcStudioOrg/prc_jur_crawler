// src/TCEGONavigator.js
const https = require('https');

/**
 * TCEGONavigator — fala com o "Iago", o SPA de Consulta Ampla de Decisoes do TCE-GO.
 *
 * PORTA (desde out/2026): a MESMA API REST sobre Elasticsearch, agora atras de um
 * PROXY NA PROPRIA ORIGEM DO SPA, `decisoes.tce.go.gov.br/api/proxy/...`.
 *   POST https://decisoes.tce.go.gov.br/api/proxy/decisions/search?<filtros>   (busca)
 *   POST https://decisoes.tce.go.gov.br/api/proxy/decisions/aggregations?<f>   (combos + contagem EXATA)
 *   GET  https://decisoes.tce.go.gov.br/api/proxy/decisions/<id>               (INTEIRO TEOR em texto)
 *   GET  https://decisoes.tce.go.gov.br/api/proxy/decisions/url/<id>?type=WEBSITE  (permalink do processo)
 *
 * 🔴 REGRESSAO DO SMOKE DE 19/10/2026, CONSERTADA EM 21/10 — TRES COISAS MUDARAM
 * DE UMA VEZ, e cada uma sozinha ja derrubava o crawler:
 *   1. O HOST DIRETO MORREU: `iago-search-api.tce.go.gov.br/decisions/*` responde
 *      HTTP 404 (HTML do Apache) para search, aggregations e /decisions/<id>; a
 *      raiz `/` responde "4.5.0" em text/plain. O bundle novo
 *      (`_next/static/chunks/477-*.js`) cria o axios com `baseURL:"/api/proxy"`.
 *   2. O PROXY EXIGE O COOKIE `_tce_nav_ctx` (httpOnly, SameSite=Lax), que o
 *      Next.js grava no GET da home. SEM ELE A BUSCA NAO ERRA: responde HTTP 200
 *      `{"content":[],"totalElements":0,"size":10}` — a casca de HTTP 200 deste
 *      tribunal. A assinatura e `size` IGNORADO (sempre 10) + total 0; com o
 *      cookie o mesmo request devolve 10.000/`size` pedido. Origin/Referer nao
 *      importam (medido com e sem). Aggregations, /decisions/<id> e /url NAO
 *      exigem o cookie, so a busca — por isso o "0 resultados" enganava.
 *   3. RATE LIMIT NOVO: `x-ratelimit-limit: 20` por janela (~1 min, reset em
 *      epoch no header `x-ratelimit-reset`). O mapeamento de 22/08 (30 em 6 s,
 *      todas 200) nao vale mais; quem paginar fundo bate em 429.
 * A SPA tambem manda `cookie=<10 chars aleatorios>` na querystring (localStorage
 * `decisoes-user-token`, gerado no cliente) — e tracking, NAO e exigido (medido
 * com e sem). Nada disso e credencial: o `_tce_nav_ctx` e emitido para qualquer
 * GET anonimo da home.
 *
 * O endpoint NAO foi chutado: o cliente axios esta literal no bundle do Next.js
 * (`baseURL:"/api/proxy"`, `n.post("/decisions/search",{term:e},{params:...})`)
 * e o contrato foi confirmado no Playwright pela aba Network (REQ/RESP com o
 * cookie). Detalhe em human-codegen/TCEGO/01-decisoes/.
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

const HOST_WEB = 'decisoes.tce.go.gov.br';
/** Desde out/2026 a API so responde pelo proxy da propria origem do SPA. */
const HOST = HOST_WEB;
const BASE = '/api/proxy';
/** 🔴 Host direto antigo — responde 404 em tudo desde out/2026. Fica documentado. */
const HOST_API_ANTIGO = 'iago-search-api.tce.go.gov.br';
/** Nome do cookie de contexto que o proxy exige na busca. */
const COOKIE_CTX = '_tce_nav_ctx';
/** Idade minima do cookie antes da primeira busca (medido: 700 ms passa, 300 ms nao). */
const ESPERA_CONTEXTO_MS = 1500;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 🔴 O `track_total_hits` do Elasticsearch vazando como total. Ver §21 do mapeamento. */
const TETO_TOTAL = 10000;

class TCEGONavigator {
  constructor({ log = console.log, timeout = 180000 } = {}) {
    this.log = log;
    this.timeout = timeout;
    /** Valor de `_tce_nav_ctx`; nasce vazio e e colhido no primeiro uso. */
    this._cookieCtx = null;
    this._renovando = false;
  }

  _req(url, { method = 'GET', body = null } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const u = new URL(url);
      const headers = { 'User-Agent': UA, Accept: 'application/json' };
      if (this._cookieCtx) headers.Cookie = `${COOKIE_CTX}=${this._cookieCtx}`;
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const req = https.request(
        { hostname: u.hostname, path: u.pathname + u.search, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            // O proxy manda um `_tce_nav_ctx` NOVO em cada busca, mas o ORIGINAL
            // continua valendo (medido: 4 paginas rapidas com o mesmo cookie, todas
            // 10.000). Guardamos so o primeiro: um cookie recem-emitido e "fresco"
            // de novo, e o proxy recusa cookie fresco (ver _garantirContexto).
            if (!this._cookieCtx || this._renovando) {
              for (const sc of [].concat(res.headers['set-cookie'] || [])) {
                const m = sc.match(new RegExp(`^${COOKIE_CTX}=([^;]+)`));
                if (m) this._cookieCtx = m[1];
              }
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              ms: Date.now() - t0,
            });
          });
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

  /**
   * Colhe o `_tce_nav_ctx` num GET anonimo da home do SPA. Idempotente: so vai a
   * rede se ainda nao ha cookie (ou se `forcar`, quando o proxy devolveu a casca).
   *
   * 🔴 O COOKIE TEM IDADE MINIMA. O valor e `<epoch ms>.<hash>` e o proxy recusa a
   * busca feita cedo demais depois da emissao — devolve a casca de 0/size 10.
   * Medido em 21/10/2026 variando SO o atraso entre o GET da home e o POST:
   *   0 ms -> 0 · 300 ms -> 0 · 700 ms -> 10.000 · 1.200 ms -> 10.000 · 2.500 ms -> 10.000
   * (repetido: 0 ms -> 0 de novo, 2.500 ms -> 10.000 de novo). E por isso que o
   * curl "funcionava" e o Node "nao": o curl de linha de comando leva mais de
   * meio segundo entre um comando e o outro. Esperamos ESPERA_CONTEXTO_MS uma vez
   * por processo — custo fixo, nao por pagina.
   */
  async _garantirContexto(forcar = false) {
    if (this._cookieCtx && !forcar) return this._cookieCtx;
    this._renovando = true;
    try {
      this._cookieCtx = null;
      const r = await this._req(`https://${HOST_WEB}/`);
      if (!this._cookieCtx) {
        throw new Error(
          `GET https://${HOST_WEB}/ respondeu HTTP ${r.status} sem o cookie ${COOKIE_CTX} — ` +
            'sem ele o proxy /api/proxy/decisions/search devolve 0 em silencio. O SPA mudou de novo?',
        );
      }
    } finally {
      this._renovando = false;
    }
    await new Promise((res) => setTimeout(res, ESPERA_CONTEXTO_MS));
    return this._cookieCtx;
  }

  /**
   * Requisicao ao proxy com os dois contornos novos de out/2026:
   *   - HTTP 429 (x-ratelimit-limit: 20/janela): espera ate `x-ratelimit-reset`
   *     (teto 65 s) e repete UMA vez, em vez de ler o limite como falha de rota.
   */
  async _reqProxy(caminho, opts = {}, tentativa = 0) {
    const r = await this._req(`https://${HOST}${BASE}${caminho}`, opts);
    if (r.status === 429 && tentativa < 1) {
      const reset = Number(r.headers['x-ratelimit-reset']) * 1000;
      const espera = Math.min(65000, Math.max(1000, (reset || 0) - Date.now() + 1000));
      this.log(`   [rate limit] HTTP 429 do proxy do TCE-GO (limite ${r.headers['x-ratelimit-limit']}/janela). Esperando ${Math.round(espera / 1000)} s.`);
      await new Promise((res) => setTimeout(res, espera));
      return this._reqProxy(caminho, opts, tentativa + 1);
    }
    return r;
  }

  /**
   * `true` quando a resposta tem a assinatura de "busca sem contexto": o proxy
   * ignora `size` (devolve 10) e zera o total. Zero LEGITIMO vem com o `size`
   * pedido — e o que separa "nao ha julgado" de "o cookie nao valeu".
   */
  static _ehCascaSemContexto(j, sizePedido) {
    return j && Array.isArray(j.content) && !j.content.length && !j.totalElements
      && sizePedido != null && Number(j.size) !== Number(sizePedido);
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
    const caminho = `/decisions/search${qs.toString() ? '?' + qs : ''}`;
    const url = `https://${HOST}${BASE}${caminho}`;
    await this._garantirContexto();
    let j;
    let r;
    for (let tentativa = 0; ; tentativa++) {
      r = await this._reqProxy(caminho, { method: 'POST', body: JSON.stringify({ term }) });
      if (r.status !== 200) {
        throw new Error(
          `busca respondeu HTTP ${r.status} em ${url} — ${r.body.slice(0, 200)}` +
            (r.status === 500 ? ' (500 aqui costuma ser valor invalido em `order` ou data fora do ISO)' : '') +
            (r.status === 429 ? ' (rate limit do proxy: 20 requisicoes por janela; espere e repita)' : ''),
        );
      }
      try {
        j = JSON.parse(r.body);
      } catch (e) {
        throw new Error(`busca devolveu corpo nao-JSON (${r.body.length} bytes): ${r.body.slice(0, 200)}`);
      }
      if (!TCEGONavigator._ehCascaSemContexto(j, params.size)) break;
      if (tentativa >= 1) {
        throw new Error(
          `proxy do TCE-GO devolveu a casca "sem contexto" (HTTP 200, total 0, size ${j.size} ` +
            `em vez de ${params.size}) mesmo apos renovar o cookie ${COOKIE_CTX}. ` +
            'Isto NAO e "0 resultados": e o proxy recusando a busca. Ver cabecalho do TCEGONavigator.',
        );
      }
      this.log(`   [contexto] busca voltou sem contexto; renovando ${COOKIE_CTX} e repetindo uma vez.`);
      await this._garantirContexto(true);
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
    const r = await this._reqProxy(`/decisions/aggregations${qs.toString() ? '?' + qs : ''}`, {
      method: 'POST', body: JSON.stringify({ term }),
    });
    if (r.status !== 200) throw new Error(`aggregations respondeu HTTP ${r.status}`);
    try {
      return JSON.parse(r.body);
    } catch (e) {
      throw new Error(`aggregations devolveu corpo nao-JSON: ${r.body.slice(0, 200)}`);
    }
  }

  /** 🟢 Inteiro teor em texto puro. Chave SIMPLES: so o `id` do documento. */
  async inteiroTeor(id) {
    const r = await this._reqProxy(`/decisions/${encodeURIComponent(id)}`);
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
    const r = await this._reqProxy(`/decisions/url/${encodeURIComponent(id)}?type=WEBSITE`);
    if (r.status !== 200) return null;
    const u = String(r.body || '').trim();
    return /^https?:\/\//.test(u) ? u : null;
  }

  static get HOST_WEB() {
    return HOST_WEB;
  }

  static get HOST_API_ANTIGO() {
    return HOST_API_ANTIGO;
  }

  static get BASE() {
    return BASE;
  }
}

module.exports = TCEGONavigator;
