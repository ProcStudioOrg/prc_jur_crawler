// src/TCECENavigator.js
const https = require('https');

/**
 * TCECENavigator — fala com o Contexto, o portal de busca textual do TCE-CE.
 *
 * PORTA: API REST PUBLICA sobre Elasticsearch. Sem auth, sem cookie, sem CSRF,
 * sem sessao, sem captcha (`grecaptcha`/`turnstile` undefined na tela, medido).
 *   POST https://contexto-api.tce.ce.gov.br/documentos/buscar          (busca)
 *   GET  https://contexto-api.tce.ce.gov.br/tabelas-auxiliares/<t>     (combos)
 *   GET  https://contexto-api.tce.ce.gov.br/documentos/total-documentos
 *   GET  https://api-add.tce.ce.gov.br/arquivos/documento?documento_id=<id>  (PDF)
 *   POST https://api-processos.tce.ce.gov.br/processos/porNumero       (Checker)
 *
 * O endpoint NAO foi chutado: o bundle do SPA Ionic
 * `www.tce.ce.gov.br/contexto/build/main.03360a1865.js` traz a config crua
 * (`url_servidor_externo`, `endpoints.documentos.url_acoes.url_buscar`), e o
 * contrato foi confirmado no Playwright pela aba Network. Detalhe em
 * human-codegen/TCECE/01-contexto-documentos/.
 *
 * 🔴 O WAF BLOQUEIA POR User-Agent DE HEADLESS — e a casca e uma pagina HTML
 * "Web Page Blocked!" com Attack ID, servida no lugar do SPA. Medido em
 * 22/08/2026 em `www.tce.ce.gov.br/contexto/`:
 *   Playwright headless SEM override (UA `HeadlessChrome/…`) -> pagina do WAF
 *   Playwright com UA de Chrome real                          -> 200, SPA carrega
 *   curl -A "<Chrome>"                                        -> 200
 * E a licao do TJRN/TJAP repetida pela terceira vez. Por isso o UA de navegador
 * abaixo e OBRIGATORIO. ⚠️ Os hosts de API (`contexto-api`, `api-add`) NAO estao
 * atras do WAF — so o `www`. Testar so a API e concluir "nao ha WAF" e erro.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (procurado e medido, nao presumido):
 *   ✅ `api-dados-abertos.tce.ce.gov.br/sim/` — Swagger real, 105 endpoints, mas
 *      e o SIM (orcamento/contratos/obras municipais). ZERO endpoint de
 *      jurisprudencia. Nao serve ao crawler.
 *   🔴 `dadosabertos.tce.ce.gov.br` — NXDOMAIN.
 *   🔴 `tcece.tc.br` / `www.tcece.tc.br` — NXDOMAIN. Ao contrario de TCE-PE,
 *      TCE-PA e TCE-ES, o TCE-CE NAO migrou para o dominio `.tc.br`.
 *   🔴 `tcewsapi.tce.ce.gov.br/{api,rest,ws,swagger-ui.html,v2/api-docs,…}` —
 *      todos 404/500. O nome "wsapi" NAO entrega REST: ali so mora JSF.
 *   🔴 DataJud/CNJ NAO se aplica — contas nao e Judiciario. Numeracao propria
 *      `<sequencial>/<ano>-<dv>` (09815/2018-9); `src/cnj.js` reprovaria todo
 *      processo valido. Como no resto do Bloco 5, NAO HA PLANO B se o portal cair.
 *   ⚠️ `tcece.sydle.one` (tesauro TCN) e SaaS de TERCEIRO — fora da cerca, nao usar.
 *   ⚠️ `POST /logs-es/salvar-log-busca-app` e telemetria que o SPA dispara junto
 *      da busca (manda o IP do usuario). Este crawler NAO a chama.
 */

const HOST_API = 'contexto-api.tce.ce.gov.br';
const HOST_PDF = 'api-add.tce.ce.gov.br';
const HOST_PROC = 'api-processos.tce.ce.gov.br';

/** 🔴 OBRIGATORIO. Ver o bloco do WAF acima. Nao remova "por limpeza". */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class TCECENavigator {
  constructor({ log = console.log, timeout = 180000 } = {}) {
    this.log = log;
    this.timeout = timeout;
  }

  _req(url, { method = 'GET', body = null, binario = false } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const u = new URL(url);
      const headers = { 'User-Agent': UA, Accept: binario ? '*/*' : 'application/json' };
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
            const buf = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              buffer: buf,
              body: binario ? null : buf.toString('utf8'),
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
   * Uma pagina de busca.
   *
   * 🔴 SEXTA CASCA DE HTTP 200 DO REPO: ERRO DE SERVIDOR DENTRO DO ENVELOPE.
   * Toda resposta e `{"erros":[...],"data":{...}}` com HTTP **200**, inclusive
   * quando o Elasticsearch recusa. Medido:
   *   range dtfinalizado com "01/01/2024" e SEM `format`
   *     -> HTTP 200, {"erros":["400 Bad Request"],"data":null}
   *   texto com aspas duplas (`"prestacao de contas"`)
   *     -> HTTP 200, erros preenchido, data null
   * Quem checar `res.statusCode === 200` e ler `data.lista` recebe `undefined` e
   * conclui "zero resultados". Este metodo levanta erro quando `erros` vem cheio.
   *
   * 🔴 A PAGINA E FIXA EM 10 E NAO HA PARAMETRO QUE MUDE ISSO. Medido em
   * 22/08/2026: `size`, `qtd`, `tamanho`, `limit`, `from` e `pagina` = 50 foram
   * TODOS aceitos com HTTP 200 e TODOS devolveram 10 itens. Parametro aceito nao
   * e parametro obedecido (licao do TCE-PA). Varredura profunda custa 1 request
   * por 10 documentos — nao ha como acelerar.
   */
  async buscarPagina({ texto = '', filtros = null, searchAfterSort = null, palavraExata = false, pesquisaExata = false, sort = 'desc' } = {}) {
    const payload = JSON.stringify({
      texto,
      filtros: filtros && filtros.length ? filtros : null,
      searchAfterSort,
      buscaPalavraExata: !!palavraExata,
      buscaPesquisaExata: !!pesquisaExata,
      sort,
    });
    const r = await this._req(`https://${HOST_API}/documentos/buscar`, { method: 'POST', body: payload });

    if (/Web Page Blocked/i.test(r.body || '')) {
      throw new Error(
        'A resposta e a pagina "Web Page Blocked!" do WAF do TCE-CE, nao a API. ' +
          'O gate medido e o User-Agent de headless — confira o header User-Agent.',
      );
    }
    let j;
    try {
      j = JSON.parse(r.body);
    } catch (e) {
      throw new Error(
        `Resposta HTTP ${r.status} de ${HOST_API} nao e JSON (${(r.body || '').length} B). ` +
          `Inicio: ${JSON.stringify((r.body || '').slice(0, 160))}`,
      );
    }
    if (j.erros && j.erros.length) {
      throw new Error(
        `O Contexto respondeu HTTP ${r.status} com erro no envelope: ${JSON.stringify(j.erros)}. ` +
          'Causas medidas: data em DD/MM/YYYY sem `format` no range (400 Bad Request) e ' +
          'aspas duplas dentro de `texto`. Nao e "zero resultados".',
      );
    }
    const d = j.data || {};
    return {
      documentos: d.lista || [],
      total: d.tamanho ?? null,
      // 🔴 10.000 = teto do track_total_hits, nao o acervo. Ver TCECECrawler.
      totalExato: (d.tamanho ?? 0) < 10000,
      tookMs: d.tempo ?? null,
      agregacao: d.agregacao || {},
    };
  }

  /** Combos da tela. `GET /tabelas-auxiliares/<tabela>` -> {data:{lista:[{id,descricao}]}} */
  async tabelaAuxiliar(tabela) {
    const r = await this._req(`https://${HOST_API}/tabelas-auxiliares/${encodeURIComponent(tabela)}`);
    try {
      return JSON.parse(r.body)?.data?.lista || [];
    } catch (e) {
      throw new Error(`tabela-auxiliar ${tabela}: HTTP ${r.status} nao-JSON`);
    }
  }

  /**
   * ✅ O TAMANHO DO ACERVO E PUBLICADO — raro no Bloco 5. Medido 22/08/2026:
   * `GET /documentos/total-documentos` -> `{"erros":[],"data":"5318348"}`.
   * Isso resolve o que a busca nao resolve: `texto:""` satura em 10.000, entao
   * sem este endpoint o acervo seria "desconhecido".
   * ⚠️ E o total de DOCUMENTOS do Contexto, nao de decisoes.
   */
  async totalAcervo() {
    const r = await this._req(`https://${HOST_API}/documentos/total-documentos`);
    try {
      return parseInt(JSON.parse(r.body)?.data, 10);
    } catch (e) {
      return null;
    }
  }

  /** Data da ultima carga do indice. */
  async dataCarga() {
    const r = await this._req(`https://${HOST_API}/documentos/data-carga`);
    try {
      return JSON.parse(r.body)?.data || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * O PDF do documento.
   *
   * 🔴 A ARMADILHA DO HOST. O mesmo path em `contexto-api` responde HTTP 406
   * (`HttpMediaTypeNotAcceptableException`) para TODO `Accept` e toda variante de
   * parametro. O 406 nao e falta de header — e host errado. O bundle separa
   * `url_api_download_documentos` de `url_servidor_externo`. Quem reaproveitar o
   * host da busca gasta a sessao inteira achando que o download exige auth.
   */
  async pdf(iddocumento) {
    const r = await this._req(
      `https://${HOST_PDF}/arquivos/documento?documento_id=${encodeURIComponent(iddocumento)}`,
      { binario: true },
    );
    if (r.status !== 200) return null;
    if (!r.buffer.slice(0, 5).toString('latin1').startsWith('%PDF')) return null;
    return r.buffer;
  }

  /**
   * Metadados por numero de processo — a porta do Checker.
   * ⚠️ NAO devolve decisao nem ementa: so autuacao, assunto, entidade. Serve para
   * confirmar que o processo EXISTE; o julgado se confirma pela reconsulta.
   */
  async processoPorNumero(numero, { pagina = 0, qtd = 5 } = {}) {
    const r = await this._req(`https://${HOST_PROC}/processos/porNumero`, {
      method: 'POST',
      body: JSON.stringify({ numero, pagina, qtd }),
    });
    try {
      return JSON.parse(r.body);
    } catch (e) {
      throw new Error(`processoPorNumero: HTTP ${r.status} nao-JSON`);
    }
  }

  /**
   * 🔴 NAO HA PERMALINK DE INTERFACE. O card do Contexto nao tem `<a href>`:
   * "Visualizar completo" e um `<button>` que dispara download por JS, e a rota
   * do SPA nao muda (`#/home` do inicio ao fim). O unico endereco publico e
   * estavel do documento e o PDF abaixo — CONFIRMADO em sessao limpa (curl sem
   * cookie, sem referer): 200 application/pdf.
   */
  static permalink(iddocumento) {
    if (!iddocumento) return null;
    return `https://${HOST_PDF}/arquivos/documento?documento_id=${encodeURIComponent(iddocumento)}`;
  }
}

TCECENavigator.HOST_API = HOST_API;
TCECENavigator.HOST_PDF = HOST_PDF;
TCECENavigator.HOST_PROC = HOST_PROC;
TCECENavigator.UA = UA;

module.exports = TCECENavigator;
