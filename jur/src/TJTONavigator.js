// src/TJTONavigator.js
const https = require('https');

/**
 * Fala com o "Jurisprudência 4.0" — portal de jurisprudência do TJTO.
 * https://jurisprudencia.tjto.jus.br
 *
 * Portal PHP 8 renderizado no servidor (nginx + PHP/8.2), sobre um **Apache
 * Solr** exposto por trás. Não é SPA: a busca é um POST de formulário e a
 * resposta é o HTML da listagem. O único XHR do portal é `/ementa.php`, que
 * devolve **o JSON cru do Solr** (`response.numFound` / `response.docs[]`).
 *
 * ✅ Sem captcha, sem login, sem token. A busca, a ementa e o inteiro teor
 *    respondem ao `curl` cru. Medido em 11/08/2026.
 *
 * 🔴 O 403 DO PORTAL É USER-AGENT, NÃO BLOQUEIO. Sem UA de navegador, TODO
 *    path responde **403 Forbidden** com 118 bytes de nginx — inclusive `/` e
 *    os próprios assets que a página carrega. Com UA de Chrome tudo vira
 *    200/404. Foi o que quase fez este portal ser lido como "sem robots.txt,
 *    sem swagger, sem nada": eram 403 de UA. **Por isso o UA abaixo não é
 *    cosmético — sem ele o crawler não funciona.**
 *
 * 🔴 OS FILTROS SÓ EXISTEM NO POST. Por GET, `type_minuta_selected`,
 *    `tip_criterio_inst`, `fq_*` e as datas são **ignorados em silêncio**, com
 *    HTTP 200 e a contagem do acervo inteiro. `q` funciona nos dois métodos, o
 *    que torna a armadilha invisível: a busca "responde", só não filtra.
 *    Medido: `?q=usucapiao&type_minuta_selected=2` (GET) devolve 1.807
 *    (acórdãos) e o mesmo par por POST devolve 4.583 (monocráticas).
 *
 * ⚠️ NÃO EXISTE API PÚBLICA. Medido e registrado para não se repetir a busca:
 *    - `dadosabertos`/`projudi`/`consultas`/`sistemas`/`juris`.tjto.jus.br →
 *      todos **NXDOMAIN**.
 *    - `api.tjto.jus.br` resolve (177.0.107.33) mas **não completa conexão**
 *      (HTTP 000); `eproc1g`/`eproc2g.tjto.jus.br` — os hosts registrados no
 *      `tribunais.json` — são **NXDOMAIN** (o e-Proc vivo é `eproc2.tjto.jus.br`).
 *    - `/swagger`, `/api`, `/v1/`, `/rest/`, `/api-docs`, `/v3/api-docs`,
 *      `/openapi.json`, `/dados-abertos` no portal de jurisprudência → **404**
 *      (com UA de navegador; sem UA todos dão o mesmo 403, que não prova nada).
 *    - `www.tjto.jus.br/dados-abertos` e `/transparencia/dados-abertos` → 404.
 *    - **Sem vhost curinga:** `/path-inventado-9z` → 404 real de 555 bytes,
 *      diferente da home. Não foi preciso conferir md5.
 *
 * ⚠️ CHARSET DIVIDIDO NO MESMO HOST — não herde de um módulo para o outro:
 *    `consulta.php` e `ementa.php` são **UTF-8**; `documento.php` (o inteiro
 *    teor) é **ISO-8859-1**. Ler o inteiro teor como UTF-8 produz mojibake em
 *    todo acento.
 */

const HOST = 'jurisprudencia.tjto.jus.br';
const ORIGIN = `https://${HOST}`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * 🔴 O TETO DE `rows` NÃO É UM NÚMERO FIXO — É PESO DE PAYLOAD, e por isso ele
 *    OSCILA. Na bisecção, 300 respondeu e 400 deu HTTP 500; minutos depois o
 *    **mesmo** `rows=300` deu 500. Medido duas vezes cada, na mesma query:
 *
 *      rows=100 → 200 / 200   (1,5 MB)   ✅ único estável
 *      rows=150 → 200 / 504              ⚠️ oscila (e o 504 é gateway, não app)
 *      rows=200 → 500 / 200   (2,4 MB)   ⚠️ oscila
 *      rows=250 → 500 / 500
 *      rows=300 → 500 / 500
 *
 *    Cada card carrega a ementa íntegra (~5 KB) ou a decisão inteira, então o
 *    limite real é o tamanho dos documentos DAQUELA busca, não a contagem.
 *    Um crawler que fixasse `rows` no maior valor que viu passar quebraria de
 *    forma intermitente, com HTTP 500 que se lê como "portal instável" —
 *    **bisectar uma vez só produz um número que não se sustenta**.
 *    ✅ O erro é honesto (500/504, corpo vazio) — nunca trunca em silêncio.
 */
const ROWS_MAX = 100;
const POR_PAGINA = 50;

class TJTONavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.origin = options.origin ?? ORIGIN;
  }

  /** Request cru; devolve { status, headers, buffer }. @private */
  _req(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.origin);
      const data = body ? Buffer.from(body, 'utf8') : null;
      const headers = {
        'User-Agent': UA, // 🔴 obrigatório: sem ele o nginx devolve 403 em tudo
        Accept: 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Referer: `${this.origin}/consulta.php`,
      };
      if (data) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = data.length;
      }
      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, method, headers, timeout: this.timeout },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout de ${this.timeout}ms em ${url.pathname}`)));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  /**
   * Roda uma busca. `params` é um objeto plano já com os nomes do formulário;
   * valores de array (as facetas `fq_campo[valor]`) chegam como chave literal.
   *
   * 🔴 SEMPRE POST — ver a ressalva do topo. Um GET aqui "funciona" e não filtra.
   */
  async buscar(params) {
    const body = TJTONavigator.encodeForm(params);
    const { status, buffer } = await this._req('POST', '/consulta.php', body);
    // Lição TJPI: confira o status ANTES de chamar um zero de zero. Aqui o
    // HTTP 500 (rows > 300) devolve corpo vazio, que se leria como "0 cards".
    if (status !== 200) throw new Error(`Jurisprudência 4.0 respondeu HTTP ${status} na busca`);
    return buffer.toString('utf8'); // consulta.php: charset=UTF-8
  }

  /**
   * A ementa de um documento, pelo XHR do próprio portal.
   * Devolve o **JSON cru do Solr**: `{ response: { numFound, docs: [ { … } ] } }`.
   * Traz `ementa` e `rodape_ementa` — este último é a **citação oficial pronta**.
   */
  async ementa(uuid) {
    const { status, buffer } = await this._req('GET', `/ementa.php?id=${encodeURIComponent(uuid)}`);
    if (status !== 200) throw new Error(`ementa.php respondeu HTTP ${status} para ${uuid}`);
    const j = JSON.parse(buffer.toString('utf8'));
    return j.response?.docs?.[0] ?? null;
  }

  /**
   * O INTEIRO TEOR, pelo permalink público.
   *
   * ✅ `documento.php?uuid=<uuid>` abre em contexto limpo, sem cookie e sem
   *    sessão — é o permalink do documento (confirmado em aba limpa).
   * ⚠️ O botão do card aponta para `viewFileDoc.php?uuid=…`, que só devolve um
   *    **302** para cá; o Location vem com `&amp;` literal (bug de escape do
   *    portal), inofensivo mas feio. O crawler vai direto no destino.
   * ⚠️ **ISO-8859-1** aqui, ao contrário do resto do host.
   */
  async documento(uuid) {
    const { status, buffer } = await this._req('GET', `/documento.php?uuid=${encodeURIComponent(uuid)}`);
    if (status !== 200) throw new Error(`documento.php respondeu HTTP ${status} para ${uuid}`);
    return buffer.toString('latin1'); // 🔴 ISO-8859-1, não UTF-8
  }

  /** URL pública e estável de um documento. */
  static permalink(uuid) {
    return `${ORIGIN}/documento.php?uuid=${uuid}`;
  }

  /**
   * Serializa o formulário. As facetas do portal têm nome `fq_campo[valor]`,
   * com o **valor literal dentro dos colchetes** (não um id) — por isso a
   * chave inteira é que se codifica, não só o valor.
   */
  static encodeForm(params) {
    const partes = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      partes.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return partes.join('&');
  }
}

TJTONavigator.HOST = HOST;
TJTONavigator.ORIGIN = ORIGIN;
TJTONavigator.UA = UA;
TJTONavigator.ROWS_MAX = ROWS_MAX;
TJTONavigator.POR_PAGINA = POR_PAGINA;

module.exports = TJTONavigator;
