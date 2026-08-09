// src/TJPINavigator.js
const https = require('https');

/**
 * Fala com o JusPI — portal de jurisprudência do TJPI.
 * https://jurisprudencia.tjpi.jus.br
 *
 * O JusPI é uma aplicação **Rails renderizada no servidor** (Turbo + Sprockets),
 * não uma SPA: não há endpoint JSON interno para interceptar. A busca é um
 * `GET /jurisprudences/search` com querystring, e a resposta é o HTML da
 * listagem. Por isso o crawler é `http` puro — o mapeamento foi feito no
 * Playwright (human-codegen/TJPI/01-juspi/), mas o acesso final dispensa
 * browser.
 *
 * ✅ Sem captcha, sem login, sem cookie de sessão, sem token: busca, ementa e
 *    inteiro teor respondem ao `curl` cru. Medido em 09/08/2026.
 *
 * ⚠️ NÃO EXISTE API. Medido e registrado para não se repetir a busca:
 *    - `dadosabertos.tjpi.jus.br`, `api.tjpi.jus.br`, `juris.tjpi.jus.br`,
 *      `sistemas/app/portal.tjpi.jus.br` → todos NXDOMAIN (sem vhost curinga:
 *      `/qualquer-coisa-inventada-9z` devolve 404 real, md5 diferente da home).
 *    - `/dados-abertos`, `/transparencia/dados-abertos` no portal
 *      institucional → 404.
 *    - `search.json` → **HTTP 406** (o Rails não tem respondedor JSON) e
 *      `/jurisprudences.json` → **HTTP 401** (índice autenticado, atrás do
 *      "ACESSO"). Nenhum dos dois serve.
 *    - `/swagger`, `/v3/api-docs`, `/actuator` → 404.
 */

const HOST = 'jurisprudencia.tjpi.jus.br';
const ORIGIN = `https://${HOST}`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * 🔴 A PÁGINA É FIXA EM 25 RESULTADOS E NÃO HÁ COMO MUDAR.
 * Medido: `per_page`, `per` e `limit` são todos **ignorados em silêncio** —
 * devolvem os mesmos 25 cards e o mesmo total. Quem passar `per_page=100`
 * acha que pediu 100 e recebe 25.
 */
const POR_PAGINA = 25;

class TJPINavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.log = options.log ?? (() => {});
    this.origin = options.origin ?? ORIGIN;
  }

  /** GET simples; devolve { status, body }. @private */
  _get(path) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.origin);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'pt-BR,pt;q=0.9',
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'), // Content-Type: charset=utf-8
          }));
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout de ${this.timeout}ms em ${url.pathname}`)));
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Roda uma busca. `params` já vem com os nomes que o formulário usa
   * (q, tipo, relator, classe, orgao, data_min, data_max, page).
   */
  async buscar(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const { status, body } = await this._get(`/jurisprudences/search?${qs}`);
    if (status === 500 && /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(params.q || '')) {
      // 🔴 O parser do JusPI ENGASGA quando a query é só um CNJ mascarado:
      //    a pontuação sozinha derruba a requisição com HTTP 500. Com qualquer
      //    outro termo junto ele parseia normalmente. Ver TJPIChecker.
      throw new Error(
        'O JusPI devolve HTTP 500 quando a busca e SO um numero de processo mascarado. '
        + 'Use "./bin/jur tjpi -n <numero>", que aplica o contorno medido.',
      );
    }
    if (status !== 200) throw new Error(`JusPI respondeu HTTP ${status} na busca`);
    return body;
  }

  /**
   * Baixa a página pública de um documento — é dela que sai o INTEIRO TEOR.
   * ✅ Este é o permalink: `/jurisprudences/<id>/public` abre em aba limpa,
   *    sem cookie e sem sessão (confirmado no Playwright em contexto novo).
   */
  async documento(id) {
    const { status, body } = await this._get(`/jurisprudences/${id}/public`);
    if (status !== 200) throw new Error(`JusPI respondeu HTTP ${status} no documento ${id}`);
    return body;
  }

  /** URL pública e estável de um documento. */
  static permalink(id) {
    return `${ORIGIN}/jurisprudences/${id}/public`;
  }
}

TJPINavigator.HOST = HOST;
TJPINavigator.ORIGIN = ORIGIN;
TJPINavigator.POR_PAGINA = POR_PAGINA;

module.exports = TJPINavigator;
