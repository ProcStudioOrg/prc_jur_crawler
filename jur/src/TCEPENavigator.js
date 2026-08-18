// src/TCEPENavigator.js
const https = require('https');

/**
 * TCEPENavigator — fala com a Consulta de Jurisprudencia do TCE-PE.
 *
 * PORTA: API REST PUBLICA de um gateway JHipster, sem auth, sem cookie, sem captcha.
 *   GET https://portal.tcepe.tc.br/jurisprudencia/services/jurisprudencia/api/publico/deliberacoes
 *
 * O endpoint NAO foi chutado. A tela e uma SPA Angular
 * (`portal.tcepe.tc.br/jurisprudencia/consulta/deliberacoes`, `<base href="/jurisprudencia/">`)
 * e o bundle `app/main.<hash>.bundle.js` traz literalmente
 * `resourceUrl = o.d + "services/jurisprudencia/api/publico"` seguido de
 * `getDeliberacoes(e){...this.http.get(this.resourceUrl+"/deliberacoes",{params:t,observe:"response"})}`.
 * O conjunto exato de parametros foi capturado no Playwright, na aba Network,
 * fazendo a busca de verdade (medicao de 18/08/2026).
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (medido em 18/08/2026):
 *   ✅ Busca:    GET /publico/deliberacoes            (X-Total-Count no header)
 *   ✅ Combos:   GET /publico/relatores               (28)
 *                GET /publico/unidades-gestoras       (1.262)
 *                GET /publico/tipos-processo          (68)
 *                GET /publico/modalidades-processo-externo (15)
 *                GET /publico/orgaos-julgadores       (13, com variantes mortas)
 *                GET /publico/deliberacao/search/ano-deliberacao (36 anos)
 *   ✅ Outros modulos publicos do mesmo gateway, NAO mapeados aqui:
 *      /deliberacoes-selecionadas (Jurisprudencia Selecionada), /sumulas,
 *      /respostas-consulta (Enunciados de Prejulgados), /boletins-jurisprudencia.
 *   🔴 dadosabertos./api./consulta./jurisprudencia.tce.pe.gov.br e
 *      dadosabertos./api./servicos.tcepe.tc.br sao TODOS NXDOMAIN.
 *      NAO ha vhost curinga: `portal.tcepe.tc.br/path-inventado-9z` devolve 404
 *      de verdade (196 B), o controle que desfaz leitura de "tem Swagger".
 *   🔴 DataJud NAO se aplica: contas nao e Judiciario, nao ha alias api_publica_*.
 *      E o processo e `AAMMNNNN-D[sufixo]`, nao CNJ — `src/cnj.js` nao se aplica.
 *      Como em todo o Bloco 5 menos o TCE-RS, NAO HA PLANO B se o portal cair.
 *   🔴 NAO ha reCAPTCHA na busca: `window.grecaptcha` e `undefined` na tela de
 *      consulta, medido no Playwright. O bundle referencia `recaptcha/api.js`,
 *      mas ele pertence a outro modulo (assinatura de boletim) e nao carrega aqui.
 *
 * ⚠️ CADEIA TLS INCOMPLETA — MAS NO HOST INSTITUCIONAL, NAO NO DA API.
 * Invertido em relacao ao TCE-BA. `www.tce.pe.gov.br` (o dominio .gov.br que a
 * fila lista como entrada) apresenta SO o certificado folha
 * (`CN=*.tce.pe.gov.br`, emitido por `Thawte TLS RSA CA G1`) e OMITE o
 * intermediario: curl e Node devolvem HTTP 000 / `unable to get local issuer
 * certificate`, que se le como "portal fora do ar". Medido em camadas: DNS
 * resolve, TCP 443 ABRE, o TLS e que quebra com `TLS alert, unknown CA (560)`.
 * Fornecendo o intermediario do AIA (http://cacerts.thawte.com/ThawteTLSRSACAG1.crt),
 * 000 vira 302 -> 200. ✅ Ja `portal.tcepe.tc.br`, que e quem serve esta API,
 * MANDA a cadeia completa (folha + Thawte G1 + DigiCert Global Root G2,
 * `Verify return code: 0`) — por isso este Navigator NAO precisa embutir PEM
 * nenhum. O intermediario esta documentado aqui porque quem sondar o tribunal
 * pela entrada `.gov.br` vai bater no 000 antes de achar a API.
 *
 * ⚠️ O DOMINIO OFICIAL MUDA NO MEIO DO CAMINHO: `https://www.tce.pe.gov.br/`
 * redireciona (medido, 302 -> 200) para `https://www.tcepe.tc.br/internet/`, e a
 * jurisprudencia mora em `portal.tcepe.tc.br`. `tc.br` e o dominio oficial dos
 * Tribunais de Contas — nao e espelho nem agregador; o salto foi MEDIDO a partir
 * do dominio institucional, nao inventado.
 */

const HOST = 'portal.tcepe.tc.br';
const BASE = '/jurisprudencia/services/jurisprudencia/api/publico';

/** Ordem exata em que o cliente oficial monta a query string. */
const ORDEM = [
  'page',
  'size',
  'todasBaseDescricao.equals',
  'todasBaseExprExata.equals',
  'modalidade.in',
  'tipoProcesso.in',
  'relator.contains',
  'unidadeGestora.equals',
  'orgaoJulgador.equals',
  'numeroProcesso.equals',
  'acordao.equals',
  'decisao.equals',
  'parecerPrevio.equals',
  'inteiroTeor.equals',
  'dataJulgamentoInicio.equals',
  'dataJulgamentoFim.equals',
  'numeroDeliberacao.equals',
  'anoDeliberacao.in',
  'sort',
];

class TCEPENavigator {
  constructor({ log = console.log, timeout = 180000 } = {}) {
    this.log = log;
    this.timeout = timeout;
  }

  _url(path, params) {
    const u = new URL(`https://${HOST}${BASE}${path}`);
    if (params) {
      // Mantem a ordem do cliente oficial e NAO omite chave vazia: o portal manda
      // `modalidade.in=` vazio e o backend aceita. Omitir nunca quebrou, mas
      // reproduzir o contrato observado e mais barato que redescobri-lo.
      for (const k of ORDEM) if (params[k] !== undefined) u.searchParams.set(k, params[k]);
      for (const [k, v] of Object.entries(params)) if (!ORDEM.includes(k)) u.searchParams.set(k, v);
    }
    return u;
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      // ⚠️ A mensagem reporta o tempo MEDIDO, nao o teto configurado: uma versao
      // anterior dizia "timeout apos 180000 ms" num erro que ocorreu em 6 s, e a
      // duracao inventada mandaria quem for depurar procurar no lugar errado.
      req.setTimeout(this.timeout, () =>
        req.destroy(new Error(`sem resposta de ${HOST} apos ${Date.now() - t0} ms (teto ${this.timeout} ms)`)));
      req.on('error', (e) => {
        // 🔴 Traduz o 000 de cadeia incompleta em vez de deixar como "site fora do ar".
        if (/unable to get local issuer|UNABLE_TO_VERIFY|self.signed/i.test(e.message)) {
          return reject(
            new Error(
              `TLS de ${HOST} nao validou (${e.message}). Em 18/08/2026 este host mandava a ` +
                `cadeia completa e QUEM omitia o intermediario era www.tce.pe.gov.br. Se a CA ` +
                `rotacionou, baixe o intermediario do AIA do proprio certificado ` +
                `(openssl s_client -connect ${HOST}:443 | openssl x509 -text | grep "CA Issuers") ` +
                `e FORNECA-O — nao desligue a verificacao.`,
            ),
          );
        }
        reject(e);
      });
    });
  }

  /** Busca uma pagina. Devolve { documentos, total, status }. */
  async buscarPagina(params) {
    const url = this._url('/deliberacoes', params);
    const r = await this._get(url);
    if (r.status === 400) {
      // 🔴 O 400 desta API vem com corpo `{"message":null}` — erro MUDO. A causa
      // conhecida e mandar `todasBaseDescricao.equals` SEM `todasBaseExprExata.equals`
      // (medido) ou data fora de `YYYY-MM-DD` (`01/01/2026` da 400).
      throw new Error(
        `HTTP 400 com corpo mudo (${r.body.slice(0, 80)}). Causas medidas: termo sem ` +
          `todasBaseExprExata.equals, ou data que nao esta em YYYY-MM-DD. URL: ${url}`,
      );
    }
    if (r.status !== 200) throw new Error(`HTTP ${r.status} em ${url} — ${r.body.slice(0, 200)}`);
    let documentos;
    try {
      documentos = JSON.parse(r.body);
    } catch (e) {
      throw new Error(`Resposta nao e JSON (${r.body.slice(0, 120)})`);
    }
    const total = r.headers['x-total-count'] != null ? parseInt(r.headers['x-total-count'], 10) : null;
    return { documentos, total, status: r.status };
  }

  async _combo(path) {
    const r = await this._get(this._url(path));
    if (r.status !== 200) throw new Error(`HTTP ${r.status} em ${path}`);
    return JSON.parse(r.body);
  }

  /**
   * Baixa o ARQUIVO ORIGINAL (PDF) do documento.
   *
   * 🔴 CHAVE COMPOSTA DE TRES, e os nomes dos segmentos da rota vem DEPOIS do valor:
   *   GET /publico/conteudo-documento/<numeroProcesso>/processo-numero
   *       /<origemProcesso>/origem-processo/<tipoDocumento>/tipo-documento
   * Medido: `.../26100740-3AR001` sozinho da 404; `tipo-documento` = `DEL` da 400;
   * so `ITD` (inteiro teor do documento) devolveu 200. A resposta e JSON com o PDF
   * em base64 no campo `documentoByte` (`JVBERi0x...` = `%PDF-1.`) e `extensao: "PDF"`.
   *
   * 🔴 UM HTTP 400 TRANSITORIO QUE SE LE COMO BLOQUEIO PERMANENTE — E NAO E.
   * Na primeira chamada ao acordao 1450/2026 este endpoint devolveu HTTP 400 com
   * `{"message":"O documento é muito recente e ainda não está disponível publicamente.
   * Por favor, tente novamente mais tarde."}`. A mesma chave, minutos depois, devolveu
   * **HTTP 200 com 94.551 B em tres tentativas seguidas** — ou seja a mensagem NAO
   * descreve um embargo de publicacao, descreve um documento que ainda nao estava no
   * cache do backend. Quem medisse UMA vez registraria "documento recente e bloqueado"
   * e estaria errado. O metodo por isso RETENTA antes de desistir.
   * ⚠️ O que E verdade e que a BUSCA nunca depende disto: o texto integral (42.285
   * chars daquele mesmo acordao) ja vem em `descricaoParecerProcesso`. Busca e download
   * foram medidos EM SEPARADO e nenhum dos dois tem captcha, cookie ou sessao.
   */
  async baixarDocumento(numeroProcesso, { origem = 'ETCE', tipo = 'ITD' } = {}) {
    const url = new URL(
      `https://${HOST}${BASE}/conteudo-documento/${encodeURIComponent(numeroProcesso)}` +
        `/processo-numero/${encodeURIComponent(origem)}/origem-processo/${encodeURIComponent(tipo)}/tipo-documento`,
    );
    let r = await this._get(url);
    // O 400 "muito recente" foi medido como TRANSITORIO: a mesma chave respondeu 200
    // minutos depois. Retenta uma vez antes de reportar indisponibilidade.
    if (r.status === 400 && /muito recente/i.test(r.body)) {
      await new Promise((res) => setTimeout(res, 3000));
      r = await this._get(url);
    }
    if (r.status === 400) {
      let msg = r.body;
      try { msg = JSON.parse(r.body).message || r.body; } catch (e) { /* corpo nao-JSON */ }
      return { ok: false, status: 400, transitorio: /muito recente/i.test(msg), mensagem: msg };
    }
    if (r.status !== 200) return { ok: false, status: r.status, mensagem: r.body.slice(0, 200) };
    const d = JSON.parse(r.body);
    const buf = Buffer.from(d.documentoByte || '', 'base64');
    if (!buf.slice(0, 4).toString('latin1').startsWith('%PDF')) {
      return { ok: false, status: 200, mensagem: 'conteudo nao comeca em %PDF' };
    }
    return { ok: true, status: 200, extensao: d.extensao || 'PDF', bytes: buf.length, buffer: buf };
  }

  relatores() {
    return this._combo('/relatores').then((a) => a.map((x) => x.nomeServidor));
  }

  unidadesGestoras() {
    return this._combo('/unidades-gestoras').then((a) => a.map((x) => x.nomeUnidadeJurisdicionada));
  }

  tiposProcesso() {
    return this._combo('/tipos-processo');
  }

  modalidades() {
    return this._combo('/modalidades-processo-externo');
  }

  orgaosJulgadores() {
    return this._combo('/orgaos-julgadores').then((a) => a.map((x) => x.nomeOrgaoJulgador));
  }

  anosDeliberacao() {
    return this._combo('/deliberacao/search/ano-deliberacao');
  }
}

module.exports = TCEPENavigator;
module.exports.HOST = HOST;
module.exports.BASE = BASE;
