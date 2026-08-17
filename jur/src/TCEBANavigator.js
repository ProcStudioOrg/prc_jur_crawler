// src/TCEBANavigator.js
const https = require('https');
const tls = require('tls');

/**
 * TCEBANavigator — fala com a Consulta de Jurisprudencia do TCE-BA.
 *
 * PORTA: API REST PUBLICA, sem auth real, sem cookie, sem captcha.
 *   GET https://proinfo.tce.ba.gov.br/rest3/api/portaltce/julgamento/obterDecisoes
 * O endpoint NAO foi chutado: o proprio HTML da pagina
 * `https://www.tce.ba.gov.br/jurisprudencia/consulta` traz
 * `<input type="hidden" id="servidorRest" value="https://proinfo.tce.ba.gov.br/rest3">`
 * e os clientes JS (`ProInfoJulgamento.js`, `ProInfoProtocolo.js`) montam a URL.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (medido em 17/08/2026):
 *   ✅ Busca:    GET  /api/portaltce/julgamento/obterDecisoes
 *   ✅ PDF:      POST /api/portaltce/protocolo/downloadComposicao
 *                     ?idProtocolo=<n>&idDocumento=<n>   — CHAVE COMPOSTA
 *   ✅ Combos:   GET  /api/portaltce/julgamento/obterConselheiros
 *                GET  /api/portaltce/julgamento/obterColegiados
 *                GET  /api/portaltce/protocolo/obterNaturezas
 *   🔴 dadosabertos./api./jurisprudencia./consulta./portal.tce.ba.gov.br sao
 *      NXDOMAIN — nao ha vhost curinga, e nao ha Dados Abertos de jurisprudencia.
 *   🔴 DataJud NAO se aplica: contas nao e Judiciario, nao ha alias api_publica_*.
 *      Como em TCE-PR/SC/RS/SP/RJ, NAO HA PLANO B se o portal cair.
 *
 * 🔴 CADEIA TLS INCOMPLETA — HTTP 000 QUE NAO E "FORA DO AR".
 * `proinfo.tce.ba.gov.br` apresenta so o certificado folha
 * (`CN=*.tce.ba.gov.br`, emitido por `Sectigo Public Server Authentication CA
 * OV R36`) e OMITE o intermediario. O navegador nao liga porque busca o
 * intermediario sozinho pelo AIA; `curl` e o Node NAO fazem isso e falham com
 * `unable to get local issuer certificate` — que se le como HTTP 000. Medido:
 * 000 com verificacao ligada, 400/200 com o intermediario fornecido.
 * ⚠️ O `www.tce.ba.gov.br` (mesmo certificado curinga) responde 200 normalmente
 * porque MANDA o intermediario — quem medisse so o institucional concluiria que
 * o TLS do tribunal esta bom. Identico ao TCE-MG, e mesma CA.
 * A correcao honesta e fornecer o intermediario, NAO desligar a verificacao:
 * `rejectUnauthorized` continua ligado.
 *
 * 🔴 `qtRegistros` NAO E TAMANHO DE PAGINA — E UM LIMIAR QUE RECUSA.
 * NAO EXISTE PAGINACAO nesta API. O portal manda `qtRegistros=200` e, quando a
 * busca casa mais que isso, o servidor devolve **HTTP 400** com
 * `NegocioException: "A sua pesquisa retornou mais de 200 ocorrencias"` — e
 * ZERO documento. O numero da mensagem ECOA o valor pedido (`qtRegistros=1000`
 * → "mais de 1000 ocorrencias"), ou seja o teto e escolha do cliente, nao
 * limite do servidor. O crawler levanta o teto e, quando ainda assim estoura,
 * FATIA POR ANO (`anoDecisao`) em vez de devolver zero.
 */

/** Intermediario que o TCE-BA omite. Baixado do AIA do proprio certificado
 *  (http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt). */
const SECTIGO_SERVER_AUTH_OV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----`;

const REST = 'proinfo.tce.ba.gov.br';
const BASE = '/rest3/api/portaltce';
const PORTAL = 'https://www.tce.ba.gov.br/jurisprudencia/consulta';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** O portal manda 200. E limiar de recusa, nao page size — ver cabecalho. */
const QT_PORTAL = 200;

class TCEBANavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 300000;
    this.log = options.log ?? console.log;
    this.agent = new https.Agent({
      keepAlive: true,
      // Raizes do sistema + o intermediario que o TCE-BA esquece de mandar.
      ca: [...tls.rootCertificates, SECTIGO_SERVER_AUTH_OV_R36],
    });
  }

  /** Request cru. Resolve { status, headers, body:Buffer }. @private */
  _req(method, path, { accept = 'application/json' } = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: REST,
          path,
          method,
          agent: this.agent,
          headers: {
            'User-Agent': UA,
            // O proprio cliente do portal manda este header literal.
            Authorization: 'No Authorization',
            Accept: accept,
            'Content-Type': 'application/json',
            Referer: PORTAL,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
          );
        }
      );
      req.setTimeout(this.timeout, () => req.destroy(new Error(`timeout apos ${this.timeout}ms`)));
      req.on('error', (e) => {
        if (/unable to verify|UNABLE_TO_GET_ISSUER|self.signed/i.test(e.message)) {
          reject(
            new Error(
              'TLS do TCE-BA recusado por cadeia incompleta — o intermediario embutido ' +
                'no TCEBANavigator pode ter sido rotacionado. Rebaixe do AIA do certificado ' +
                '(http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt). ' +
                `Erro original: ${e.message}`
            )
          );
          return;
        }
        reject(e);
      });
      req.end();
    });
  }

  /** GET JSON. @private */
  async _getJson(path) {
    const r = await this._req('GET', path);
    const texto = r.body.toString('utf8');
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* deixa null: quem chama decide */
    }
    return { status: r.status, json, texto };
  }

  /**
   * Monta a querystring de `obterDecisoes` na ORDEM do cliente oficial.
   * Parametro vazio/ausente e OMITIDO (o cliente do portal faz igual).
   */
  _qs(filtros = {}) {
    const mapa = [
      ['termo', filtros.termo],
      ['qtRegistros', filtros.qtRegistros ?? QT_PORTAL],
      ['idRelator', filtros.idRelator],
      ['numeroProtocolo', filtros.numeroProtocolo],
      ['anoProtocolo', filtros.anoProtocolo],
      ['anoDecisao', filtros.anoDecisao],
      ['anoExercicio', filtros.anoExercicio],
      ['numeroDecisao', filtros.numeroDecisao],
      ['idColegiado', filtros.idColegiado],
      ['idNatureza', filtros.idNatureza],
      ['listaIdTipoDecisao', filtros.listaIdTipoDecisao],
      ['resumoDocumento', filtros.resumoDocumento],
      ['nomeOrgaoUnidade', filtros.nomeOrgaoUnidade],
    ];
    return mapa
      .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /**
   * Uma busca. Devolve { ok, documentos, excedeuTeto, teto, mensagem }.
   *
   * 🔴 `excedeuTeto` e o caso que NAO PODE virar zero: o servidor responde
   * HTTP 400 com NegocioException e NENHUM documento. Ler isso como "nao ha
   * jurisprudencia" seria o erro classico do repo.
   */
  async buscar(filtros = {}) {
    const teto = filtros.qtRegistros ?? QT_PORTAL;
    const { status, json, texto } = await this._getJson(
      `${BASE}/julgamento/obterDecisoes?${this._qs({ ...filtros, qtRegistros: teto })}`
    );

    if (status === 200 && Array.isArray(json)) {
      return { ok: true, documentos: json, excedeuTeto: false, teto };
    }
    if (status === 400 && json && /mais de \d+ ocorr/i.test(json.message || '')) {
      return { ok: false, documentos: [], excedeuTeto: true, teto, mensagem: json.message };
    }
    // 200 com corpo vazio = "sua pesquisa nao retornou resultados" (o proprio
    // cliente do portal trata responseText vazio assim).
    if (status === 200 && texto.trim().length === 0) {
      return { ok: true, documentos: [], excedeuTeto: false, teto };
    }
    throw new Error(`obterDecisoes respondeu HTTP ${status}: ${texto.slice(0, 200)}`);
  }

  /**
   * PDF do documento. CHAVE COMPOSTA: idProtocolo + idDocumento — so o id do
   * documento nao basta. Medido PUBLICO: 200 sem cookie e sem sessao, e o corpo
   * comeca em %PDF (aqui o magic number vale).
   */
  async baixarPdf(idProtocolo, idDocumento) {
    const r = await this._req(
      'POST',
      `${BASE}/protocolo/downloadComposicao?idProtocolo=${encodeURIComponent(
        idProtocolo
      )}&idDocumento=${encodeURIComponent(idDocumento)}`,
      { accept: 'application/json' }
    );
    if (r.status !== 200) return { ok: false, status: r.status };
    const cd = r.headers['content-disposition'] || '';
    const nome = (cd.split('filename=')[1] || `TCEBA_${idDocumento}.pdf`).split(';')[0].trim();
    const ehPdf = r.body.slice(0, 4).toString('latin1') === '%PDF';
    return {
      ok: true,
      status: 200,
      buffer: r.body,
      nomeArquivo: nome,
      contentType: r.headers['content-type'] || null,
      ehPdf,
    };
  }

  /** Combos. Os tres saem dos mesmos endpoints que a tela chama no load. */
  async conselheiros() {
    return (await this._getJson(`${BASE}/julgamento/obterConselheiros?`)).json || [];
  }

  async colegiados() {
    return (await this._getJson(`${BASE}/julgamento/obterColegiados`)).json || [];
  }

  async naturezas() {
    return (
      (
        await this._getJson(
          `${BASE}/protocolo/obterNaturezas?stNaturezaSuperior=1&listaSiglaTipoDocumento=TCE`
        )
      ).json || []
    );
  }
}

module.exports = TCEBANavigator;
module.exports.QT_PORTAL = QT_PORTAL;
