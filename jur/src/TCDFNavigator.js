// src/TCDFNavigator.js
const https = require('https');

/**
 * TCDFNavigator — fala com a Busca TCDF (Tribunal de Contas do Distrito Federal).
 *
 * PORTA: API REST PUBLICA, sem auth, sem cookie, sem captcha, sem sessao.
 *   GET https://api-busca-publica.tc.df.gov.br/jurisprudencia/       (busca)
 *   GET https://api-busca-publica.tc.df.gov.br/jurisprudencia/tipos  (agregacoes)
 *   GET https://api-etcdf.tc.df.gov.br/publico/documentos/<EDOC>     (documento)
 *
 * O endpoint NAO foi chutado. A tela e uma SPA Vue 2 + Vuetify em
 * `busca2.tc.df.gov.br/#/jurisprudencia/inteiro-teor`, e o bundle
 * `/js/app.fbb389bc.js` monta a URL literal
 * `"https://api-busca-publica.tc.df.gov.br/jurisprudencia/?"+s+this.hash+
 *  "&from="+this.pageNo+"&maxPerPage="+this.maxPerPage+...`.
 * Medicao de 20/08/2026. Detalhe em human-codegen/TCDF/01-jurisprudencia/.
 *
 * ⚠️ COMO SE CHEGA AQUI, porque o nome obvio engana (a armadilha do TCE-MG):
 * `jurisprudencia.tc.df.gov.br` NAO tem busca nenhuma — e um WordPress de
 * boletins e anuarios. A busca mora em `busca2.`, linkada de dentro dele.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (procurado e medido, nao presumido):
 *   ✅ /jurisprudencia/, /jurisprudencia/tipos, /publica/, /publica/tipos,
 *      /boletim/, /boletim/tipos e api-etcdf/publico/documentos/<edoc>.
 *   🔴 `dadosabertos.tc.df.gov.br` NAO TEM REGISTRO DNS (curl exit 6).
 *   🔴 DataJud NAO se aplica: contas nao e Judiciario, nao ha alias api_publica_*.
 *   🔴 Numeracao CNJ NAO se aplica: o documento e `<numero>/<ano>` (4760/2020) e o
 *      processo e `4518/2020-e`. `src/cnj.js` reprovaria todo documento valido.
 *      Como no resto do Bloco 5, NAO HA PLANO B se o portal cair.
 *   ⚠️ SUMULAS nao estao nesta API: o botao da tela leva ao SINJ-DF
 *      (www.sinj.df.gov.br), outro sistema, nao mapeado.
 *
 * 🔴 O WAF F5 BLOQUEIA PELO User-Agent "curl" — 403 COM PAGINA DE 35 KB.
 * Medido nos dois hosts publicos do tribunal:
 *   curl SEM -A          -> HTTP 403, text/html, 35.074 B,
 *                           <title>Web Application Firewall</title>, rodape F5
 *   curl -A "<Chrome>"   -> HTTP 200, application/json, 129.795 B
 * E o gate e SO o User-Agent, nao "headless": o Playwright headless SEM override
 * (UA `.../HeadlessChrome/151.0.7922.34`) tambem recebe 200. Ou seja o F5 do TCDF
 * NAO faz o que o WAF do TCE-CE faz. Por isso este Navigator manda UA de
 * navegador SEMPRE — sem ele, todo request vira 403 com HTML, que se le como
 * "o tribunal exige captcha" quando a API esta escancarada.
 */

const HOST_BUSCA = 'api-busca-publica.tc.df.gov.br';
const HOST_DOC = 'api-etcdf.tc.df.gov.br';

/**
 * 🔴 OBRIGATORIO. Ver o bloco do F5 acima. Nao remova "por limpeza".
 */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

class TCDFNavigator {
  constructor({ log = console.log, timeout = 180000 } = {}) {
    this.log = log;
    this.timeout = timeout;
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const req = https.get(
        url,
        { headers: { 'User-Agent': UA, Accept: 'application/json' } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body, ms: Date.now() - t0 }));
        },
      );
      // A mensagem reporta o tempo MEDIDO, nao o teto configurado.
      req.setTimeout(this.timeout, () =>
        req.destroy(new Error(`sem resposta de ${url.host} apos ${Date.now() - t0} ms (teto ${this.timeout} ms)`)));
      req.on('error', reject);
    });
  }

  /**
   * Monta a query string do jeito que o cliente oficial monta.
   *
   * 🔴 `q` VAZIO ZERA A BUSCA; `q` AUSENTE DEVOLVE O ACERVO. Medido:
   *      ?from=0&maxPerPage=1        -> 10.000/gte
   *      ?q=&from=0&maxPerPage=1     ->      0/eq
   *      ?q=%20&from=0&maxPerPage=1  ->      0/eq
   *    O proprio SPA OMITE a chave quando o termo e vazio
   *    (`var s = this.termoPesquisado ? "q=".concat(...) : ""`). Um crawler que
   *    sempre monte `q=${query||''}` devolve zero em toda busca sem termo.
   *
   * ⚠️ `from` E OFFSET EM DOCUMENTOS, nao numero de pagina — e o proprio SPA
   *    erra: na primeira busca manda `from=this.pageNo` (0) e no scroll manda
   *    `from=this.pageNo*this.maxPerPage`.
   */
  _urlBusca({ q, from = 0, maxPerPage = 100, filtros = {} }) {
    const u = new URL(`https://${HOST_BUSCA}/jurisprudencia/`);
    if (q) u.searchParams.set('q', q);
    u.searchParams.set('from', String(from));
    u.searchParams.set('maxPerPage', String(maxPerPage));
    for (const [k, v] of Object.entries(filtros)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(`filter[${k}]`, String(v));
    }
    return u;
  }

  /**
   * Uma pagina de busca.
   *
   * 🔴 QUINTA CASCA DE HTTP 200 DO REPO: PHP FATAL ERROR COMO SUCESSO.
   * O proxy e PHP com memory_limit de 128 MB e o registro do indice e gordo
   * (~44 KB; `jurisprudencia_relacionados` sozinho deu 52.595 chars numa amostra).
   * Medido sem `q`:
   *   maxPerPage=100  -> 200,  4.416.842 B, 100 hits   OK
   *   maxPerPage=800  -> 200, 35.529.427 B, 800 hits   OK
   *   maxPerPage=1600 -> 200,        344 B,
   *      "<b>Fatal error</b>: Allowed memory size of 134217728 bytes exhausted"
   * 🔴 O TETO E EM BYTES, NAO EM DOCUMENTOS: `q=nepotismo&maxPerPage=10000`
   * responde 200 JSON com os 112 documentos. Quem bisectar o teto com uma busca
   * estreita conclui 10.000 e quebra na busca larga.
   * => Resposta 200 que NAO e JSON significa PAGINA GRANDE DEMAIS. Este metodo
   *    reduz pela metade e repete, em vez de tratar como fim de acervo.
   */
  async buscarPagina({ q, from = 0, maxPerPage = 100, filtros = {} }, tentativa = 0) {
    const url = this._urlBusca({ q, from, maxPerPage, filtros });
    const r = await this._get(url);

    if (r.status === 403 && /Web Application Firewall/i.test(r.body)) {
      throw new Error(
        'HTTP 403 do WAF F5 do TCDF. O gate e o User-Agent: sem UA de navegador todo ' +
          'request vira 403 com uma pagina HTML de 35 KB. Confira o header User-Agent.',
      );
    }
    // 🔴 O MESMO DEFEITO (pagina grande demais) DA DUAS RESPOSTAS DIFERENTES,
    // conforme ONDE a memoria do PHP acaba. Medido com q=licitação, from=0:
    //   maxPerPage=500  -> HTTP 200, 29.967.044 B, 500 hits          OK
    //   maxPerPage=1000 -> HTTP 500 {"code":500,...}                 <- limpo
    //   maxPerPage=2000 -> HTTP 200, 433 B, "Allowed memory size..." <- casca
    //   maxPerPage=4000 -> HTTP 200, 240 B, idem
    // Ou seja HTTP 500 aqui e AMBIGUO: pode ser profundidade (from+maxPerPage
    // acima do max_result_window) ou pagina grande demais. So da para separar
    // olhando a soma — se ela cabe na janela, o 500 e de memoria, e reduzir
    // resolve. Tratar todo 500 como fatal desiste de uma busca que funciona.
    if (r.status === 500) {
      const cabeNaJanela = from + maxPerPage <= 10000;
      if (cabeNaJanela && maxPerPage > 10 && tentativa < 6) {
        const menor = Math.max(10, Math.floor(maxPerPage / 2));
        this.log(
          `   [ajuste] maxPerPage=${maxPerPage} devolveu HTTP 500 com from=${from} ` +
            `(soma ${from + maxPerPage}, dentro da janela de 10000), logo NAO e profundidade: ` +
            `e a memoria do proxy PHP. Reduzindo para ${menor} e repetindo.`,
        );
        return this.buscarPagina({ q, from, maxPerPage: menor, filtros }, tentativa + 1);
      }
      throw new Error(
        `HTTP 500 de ${HOST_BUSCA}. As causas medidas sao: (a) profundidade — ` +
          `from+maxPerPage > 10000 (max_result_window do Elasticsearch); aqui from=${from} ` +
          `e maxPerPage=${maxPerPage}, soma ${from + maxPerPage}; (b) memoria do proxy PHP ` +
          `com pagina grande (ja tentado reduzir ${tentativa}x); (c) sintaxe de q quebrada ` +
          `(ex.: terminar em "AND", ou numero de processo cru — a barra abre regex no Lucene).`,
      );
    }

    let j;
    try {
      j = JSON.parse(r.body);
    } catch (e) {
      const estourou = /Allowed memory size/i.test(r.body);
      if (estourou && maxPerPage > 10 && tentativa < 6) {
        const menor = Math.max(10, Math.floor(maxPerPage / 2));
        this.log(
          `   [ajuste] maxPerPage=${maxPerPage} estourou a memoria do proxy PHP (HTTP ${r.status}, ` +
            `resposta nao-JSON). Reduzindo para ${menor} e repetindo — isto NAO e fim de acervo.`,
        );
        return this.buscarPagina({ q, from, maxPerPage: menor, filtros }, tentativa + 1);
      }
      throw new Error(
        `Resposta HTTP ${r.status} de ${HOST_BUSCA} nao e JSON (${r.body.length} B). ` +
          (estourou
            ? 'O proxy PHP estourou 128 MB de memoria mesmo apos reduzir a pagina.'
            : `Inicio: ${JSON.stringify(r.body.slice(0, 160))}`),
      );
    }

    const hits = j?.data?.hits;
    return {
      documentos: hits?.hits || [],
      total: hits?.total?.value ?? null,
      // 🔴 "gte" = SATURADO. Ver TCDFCrawler.
      totalExato: hits?.total?.relation === 'eq',
      tookMs: j?.data?.took ?? null,
      maxPerPageUsado: maxPerPage,
    };
  }

  /**
   * Agregacoes — os vocabularios que alimentam os combos da tela.
   *
   * 🔴 AS COMBOS DA TELA SAO TOP-10 DO ELASTICSEARCH, NAO O DOMINIO, e o proprio
   * JSON denuncia por `sum_other_doc_count`: `Ano` traz 10 buckets com 545 fora,
   * `Relator` traz 10 com 229 fora. Filtrar por um relator ausente do combo
   * FUNCIONA (o filtro aceita string livre) — quem tratar o combo como dominio
   * fechado conclui que o relator nao existe.
   */
  async agregacoes({ q, filtros = {} } = {}) {
    const u = new URL(`https://${HOST_BUSCA}/jurisprudencia/tipos`);
    if (q) u.searchParams.set('q', q);
    for (const [k, v] of Object.entries(filtros)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(`filter[${k}]`, String(v));
    }
    const r = await this._get(u);
    try {
      return JSON.parse(r.body)?.data?.aggregations || {};
    } catch (e) {
      throw new Error(`agregacoes: HTTP ${r.status} nao-JSON (${r.body.length} B)`);
    }
  }

  /**
   * O documento no e-TCDF, pelo e-doc.
   *
   * ⚠️ ESTE ENDPOINT DEVOLVE MENOS TEXTO QUE A BUSCA. Medido no e-doc B0AB532D:
   *   busca  jurisprudencia_ementa_voto_e_excerto = 4.405 chars
   *   aqui   texto = 4.843 brutos / 1.742 limpos de HTML
   * Ele nao e o "inteiro teor" — e o ato formatado (mais `textoDecisao` e
   * `observacao`, que traz a composicao da sessao). O inteiro teor de verdade e o
   * PDF apontado por `arquivoPDFCas`, e o caminho do CAS ate o arquivo NAO foi
   * fechado (`/cas/forseti/base64/<edoc>` responde 500,
   * `/publico/documentos/<edoc>/merged_base64` responde 404).
   */
  async documento(edoc) {
    const u = new URL(`https://${HOST_DOC}/publico/documentos/${encodeURIComponent(edoc)}`);
    const r = await this._get(u);
    if (r.status === 404) return null;
    try {
      return JSON.parse(r.body);
    } catch (e) {
      throw new Error(`documento ${edoc}: HTTP ${r.status} nao-JSON (${r.body.length} B)`);
    }
  }

  /**
   * ✅ PERMALINK CONFIRMADO EM ABA LIMPA (Playwright, contexto novo, sem cookie):
   * 301 -> www2 -> 301 -> `etcdf.tc.df.gov.br/?a=...` HTTP 200, renderiza
   * "Documento B0AB532D", Numero/Ano, Processo TCDF, data do DOE, a ementa
   * integral e o botao "Download do arquivo PDF".
   * ⚠️ O HTML servido por curl NAO contem o edoc (`grep -c` = 0): e SPA que le a
   * query no cliente. Validar permalink por curl+grep conclui que nao funciona.
   */
  static permalink(edoc) {
    if (!edoc) return null;
    return (
      'https://www.tc.df.gov.br/app/mesaVirtual/implementacao/' +
      `?a=consultaETCDF&f=formPrincipal&edoc=${encodeURIComponent(edoc)}`
    );
  }
}

TCDFNavigator.HOST_BUSCA = HOST_BUSCA;
TCDFNavigator.HOST_DOC = HOST_DOC;
TCDFNavigator.UA = UA;

module.exports = TCDFNavigator;
