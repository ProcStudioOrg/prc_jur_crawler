// src/TJPENavigator.js
const https = require('https');
const tls = require('tls');

/**
 * Fala com a API REST de jurisprudência do TJPE.
 *
 * O portal (https://consultajurisprudencia.app.tjpe.jus.br) é uma SPA Angular
 * cujo backend é uma API **JHipster pública, sem autenticação e sem captcha**,
 * na mesma origem. Por isso o crawler não usa browser: o mapeamento foi feito
 * no Playwright (human-codegen/TJPE/), mas o acesso final é HTTP direto.
 *
 * 🔴 O SERVIDOR MANDA A CADEIA TLS INCOMPLETA. Ele apresenta só o certificado
 * folha (`CN=*.app.tjpe.jus.br`, emitido por `Amazon RSA 2048 M01`) e **omite o
 * intermediário**. O navegador não liga porque busca o intermediário sozinho
 * pelo AIA; `curl` e o Node NÃO fazem isso e falham com
 * `unable to get local issuer certificate` — o que se lê como "o site está
 * fora do ar" (HTTP 000) e não está. Medido em 07/08/2026.
 *
 * A correção honesta é fornecer o intermediário, **não** desligar a
 * verificação: `rejectUnauthorized` continua ligado.
 */

/** Intermediário que o TJPE omite. Baixado do AIA do próprio certificado
 *  (http://crt.r2m01.amazontrust.com/r2m01.cer), que é o repositório da CA. */
const AMAZON_RSA_2048_M01 = `-----BEGIN CERTIFICATE-----
MIIEXjCCA0agAwIBAgITB3MSOAudZoijOx7Zv5zNpo4ODzANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTIyMDgyMzIyMjEyOFoXDTMwMDgyMzIyMjEyOFowPDEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEcMBoGA1UEAxMTQW1hem9uIFJT
QSAyMDQ4IE0wMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOtxLKnL
H4gokjIwr4pXD3i3NyWVVYesZ1yX0yLI2qIUZ2t88Gfa4gMqs1YSXca1R/lnCKeT
epWSGA+0+fkQNpp/L4C2T7oTTsddUx7g3ZYzByDTlrwS5HRQQqEFE3O1T5tEJP4t
f+28IoXsNiEzl3UGzicYgtzj2cWCB41eJgEmJmcf2T8TzzK6a614ZPyq/w4CPAff
nAV4coz96nW3AyiE2uhuB4zQUIXvgVSycW7sbWLvj5TDXunEpNCRwC4kkZjK7rol
jtT2cbb7W2s4Bkg3R42G3PLqBvt2N32e/0JOTViCk8/iccJ4sXqrS1uUN4iB5Nmv
JK74csVl+0u0UecCAwEAAaOCAVowggFWMBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYD
VR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAdBgNV
HQ4EFgQUgbgOY4qJEhjl+js7UJWf5uWQE4UwHwYDVR0jBBgwFoAUhBjMhTTsvAyU
lC4IWZzHshBOCggwewYIKwYBBQUHAQEEbzBtMC8GCCsGAQUFBzABhiNodHRwOi8v
b2NzcC5yb290Y2ExLmFtYXpvbnRydXN0LmNvbTA6BggrBgEFBQcwAoYuaHR0cDov
L2NydC5yb290Y2ExLmFtYXpvbnRydXN0LmNvbS9yb290Y2ExLmNlcjA/BgNVHR8E
ODA2MDSgMqAwhi5odHRwOi8vY3JsLnJvb3RjYTEuYW1hem9udHJ1c3QuY29tL3Jv
b3RjYTEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqGSIb3DQEBCwUAA4IB
AQCtAN4CBSMuBjJitGuxlBbkEUDeK/pZwTXv4KqPK0G50fOHOQAd8j21p0cMBgbG
kfMHVwLU7b0XwZCav0h1ogdPMN1KakK1DT0VwA/+hFvGPJnMV1Kx2G4S1ZaSk0uU
5QfoiYIIano01J5k4T2HapKQmmOhS/iPtuo00wW+IMLeBuKMn3OLn005hcrOGTad
hcmeyfhQP7Z+iKHvyoQGi1C0ClymHETx/chhQGDyYSWqB/THwnN15AwLQo0E5V9E
SJlbe4mBlqeInUsNYugExNf+tOiybcrswBy8OFsd34XOW3rjSUtsuafd9AWySa3h
xRRrwszrzX/WWGm6wyB+f7C4
-----END CERTIFICATE-----`;

const HOST = 'consultajurisprudencia.app.tjpe.jus.br';
const ORIGIN = `https://${HOST}`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Máximo aceito pelo servidor em `size`. Medido: 100 responde, 200 dá HTTP 500. */
const SIZE_MAX = 100;
/** Teto do contador e da janela de paginação (padrão do Elasticsearch). */
const TETO_RESULTADOS = 10000;

class TJPENavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? console.log;
    this.agent = new https.Agent({
      keepAlive: true,
      // Raízes do sistema + o intermediário que o TJPE esquece de mandar.
      ca: [...tls.rootCertificates, AMAZON_RSA_2048_M01],
    });
  }

  /** GET cru. @private */
  _get(path) {
    return new Promise((resolve, reject) => {
      const req = https.get({
        host: HOST,
        path,
        agent: this.agent,
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: ORIGIN + '/' },
        timeout: this.timeout,
      }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      });
      req.on('error', (e) => {
        if (/unable to get local issuer/i.test(e.message)) {
          return reject(new Error(
            'TLS do TJPE recusado por cadeia incompleta — o intermediario embutido ' +
            'no TJPENavigator pode ter mudado. Verifique o AIA do certificado.'
          ));
        }
        reject(e);
      });
      req.on('timeout', () => req.destroy(new Error('timeout falando com a API do TJPE')));
    });
  }

  /** GET que exige JSON. @private */
  async _json(path) {
    const r = await this._get(path);
    if (r.status !== 200) {
      const e = new Error(`HTTP ${r.status} da API do TJPE (${String(r.body).slice(0, 120)})`);
      e.status = r.status;
      throw e;
    }
    try {
      return { dados: JSON.parse(r.body), headers: r.headers };
    } catch {
      throw new Error(`Resposta nao-JSON do TJPE (${String(r.body).slice(0, 120)})`);
    }
  }

  /** Monta a querystring a partir de um objeto de filtros. @private */
  static qs(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /**
   * Uma página de busca.
   *
   * ⚠️ `tipoSentenca.in` é OBRIGATÓRIO sempre que houver `pesquisaLivre.contains`:
   * sem ele a API responde **HTTP 500 "Erro ao processar a consulta"**. Quem
   * monta o filtro é o Crawler, que sempre manda o default `A,D`.
   *
   * @param {Object} filtros - já com os nomes da API (`pesquisaLivre.contains` etc.)
   * @param {number} page - 0-based
   * @param {number} size - máx. 100
   * @returns {{itens: Array, total: number, saturado: boolean}}
   */
  async buscar(filtros, page = 0, size = 20) {
    if (size > SIZE_MAX) throw new Error(`size máximo do TJPE é ${SIZE_MAX} (pedido: ${size})`);
    const path = `/api/v1/jurisprudencias?${TJPENavigator.qs({ ...filtros, page, size })}`;
    const { dados, headers } = await this._json(path);
    const total = Number(headers['x-total-count'] ?? 0);
    return { itens: dados, total, saturado: total >= TETO_RESULTADOS };
  }

  /** Só o total, sem trazer documento (size=1 é o mínimo aceito). */
  async contar(filtros) {
    const r = await this.buscar(filtros, 0, 1);
    return { total: r.total, saturado: r.saturado };
  }

  /**
   * Consulta processual por chave composta.
   *
   * ⚠️ A chave é `codigoProcesso` + `origem`, **não** o campo `chave` do
   * documento. Passar `chave` devolve **HTTP 200 com todos os campos null** —
   * um zero silencioso, não um erro. Medido em 07/08/2026.
   */
  async processo(codigoProcesso, origem) {
    const { dados } = await this._json(
      `/api/v1/processo/${encodeURIComponent(codigoProcesso)}/${encodeURIComponent(origem)}`
    );
    return dados;
  }

  /** Combos populados por AJAX na carga da tela. */
  async relatores() { return (await this._json('/api/v1/relatores')).dados; }
  async classes() { return (await this._json('/api/v1/classes')).dados; }
  async assuntos() { return (await this._json('/api/v1/assuntos')).dados; }
  async unidadesJudiciais() { return (await this._json('/api/v1/unidades-judiciais')).dados; }
}

TJPENavigator.HOST = HOST;
TJPENavigator.SIZE_MAX = SIZE_MAX;
TJPENavigator.TETO_RESULTADOS = TETO_RESULTADOS;
TJPENavigator.AMAZON_RSA_2048_M01 = AMAZON_RSA_2048_M01;

module.exports = TJPENavigator;
