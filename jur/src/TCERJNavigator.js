/**
 * TCERJNavigator — fala com o Portal de Jurisprudencia do TCE-RJ.
 *
 * PORTA: API REST PUBLICA, sem auth, sem cookie, sem captcha.
 *   POST https://www.tcerj.tc.br/liana-processo-webapi/consulta/pagina/{p}/tamanhoPagina/{n}
 * O endpoint NAO foi chutado: saiu da aba Network do Playwright, na SPA Angular
 * `/cadastro-publicacoes/public/jurisprudencia-selecionada`.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe:
 *   ✅ Busca:   POST /liana-processo-webapi/consulta/pagina/{p}/tamanhoPagina/{n}
 *   ✅ Detalhe: GET  /cadastro-publicacoes-webapi/api/JurisprudenciaSelecionada/{id}
 *   ✅ PDF:     GET  /documento-webapi-externo/api/documento/acordao/{numero}/{ano}
 *               — PUBLICO de verdade: 200 em requisicao limpa, sem cookie e sem
 *               Referer, e comeca com %PDF (aqui o magic number VALE, ao
 *               contrario do TCE-PR, cujo application/pdf era envelope PKCS#7).
 *   ✅ Combos:  GET  /cadastro-publicacoes-webapi/api/JurisprudenciaSelecionada/MacroTema
 *                                                                     /Relatores
 *                                                                     /RelatoresVencedores
 *   🔴 dadosabertos./api./jurisprudencia.tcerj.tc.br sao NXDOMAIN (sem vhost curinga).
 *   🔴 /dados-abertos, /dadosabertos, /api, /v1/api-docs → 404 de verdade (196 bytes).
 *   🔴 DataJud NAO se aplica: contas nao e Judiciario, nao ha alias api_publica_*.
 *      Como em TCE-PR/SC/RS/SP, NAO HA PLANO B se o portal cair.
 *
 * ⚠️ CASCA DE HTTP 200 — VARIANTE NOVA NO REPO: PAGINA DE ERRO 404 SERVIDA COM
 * STATUS 200. `/swagger/index.html` responde HTTP 200 com 571 bytes cujo corpo e
 * `<title>Erro HTTP - TCERJ</title> … <h1>Erro HTTP 404</h1>`. Nao e vhost
 * curinga (TJAC/TJAL), nem index.html de SPA (TJES/TJRR), nem tela de login
 * (TCE-PR): e uma pagina de erro que MENTE NO STATUS. Quem conferisse so
 * `resp.ok` registraria "o TCE-RJ tem Swagger". Leia o corpo antes do 200.
 *
 * ⚠️ O DOMINIO OFICIAL E `.tc.br`, NAO `.gov.br`: www.tce.rj.gov.br redireciona
 * (301) para www.tcerj.tc.br/portalnovo/, e `tce.rj.gov.br` SEM www resolve para
 * outro IP e da HTTP 000 (timeout). Some a colecao "000 nao e fora do ar"
 * (TJPE): aqui o 000 e de um host irmao, enquanto o oficial responde normal.
 */

const HOST = 'https://www.tcerj.tc.br';
const EP_BUSCA = `${HOST}/liana-processo-webapi/consulta`;
const EP_DETALHE = `${HOST}/cadastro-publicacoes-webapi/api/JurisprudenciaSelecionada`;
const EP_PDF = `${HOST}/documento-webapi-externo/api/documento/acordao`;
const ORIGIN = HOST;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

class TCERJNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout || 120000;
    this.log = options.log || console.log;
  }

  async _fetch(url, init = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeout);
    try {
      return await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: ORIGIN,
          Referer: `${ORIGIN}/cadastro-publicacoes/public/jurisprudencia-selecionada`,
          'User-Agent': UA,
          ...(init.headers || {}),
        },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Busca paginada. `pagina` e 1-BASED (a tela manda 1 na primeira busca).
   *
   * ⚠️ NAO ha teto de tamanhoPagina medido: pedir 1089 devolve os 1.089 do
   * acervo numa unica resposta, e pedir 2000 devolve 1.089 (trunca no acervo,
   * sem erro e sem HTTP 400). O acervo inteiro cabe em uma requisicao.
   *
   * 🔴 O SERVIDOR DEVOLVE HTTP 500 PARA `AND`/`OR` NA QUERY — e o unico erro
   * visivel do portal. Conferir so o corpo classificaria isso como "0
   * resultados" (licao do TJPI: confira o status antes de chamar um zero de
   * zero). Por isso o status e checado ANTES do parse.
   */
  async pesquisar(filtro, pagina = 1, tamanhoPagina = 20) {
    const url = `${EP_BUSCA}/pagina/${pagina}/tamanhoPagina/${tamanhoPagina}`;
    const resp = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtro || {}),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      let msg = texto.slice(0, 200);
      try {
        const e = JSON.parse(texto);
        if (e && e.message) msg = e.message;
      } catch (_) { /* corpo nao-JSON: fica o texto cru */ }
      throw new Error(`HTTP ${resp.status} na busca: ${msg}`);
    }
    try {
      return JSON.parse(texto);
    } catch (e) {
      throw new Error(`resposta nao-JSON (HTTP ${resp.status}): ${texto.slice(0, 200)}`);
    }
  }

  /**
   * Detalhe de um registro — acrescenta verbetacoes, comentarios, leis
   * (referencia legislativa) e relatorVencedor ao que ja veio na busca.
   */
  async detalhe(jurisprudenciaId) {
    const resp = await this._fetch(`${EP_DETALHE}/${encodeURIComponent(jurisprudenciaId)}`);
    if (!resp.ok) return null;
    return resp.json();
  }

  /** Combos, direto do servidor (sem scraping da tela). */
  async macroTemas() {
    const r = await this._fetch(`${EP_DETALHE}/MacroTema`);
    return r.ok ? r.json() : null;
  }

  async relatores() {
    const r = await this._fetch(`${EP_DETALHE}/Relatores`);
    return r.ok ? r.json() : null;
  }

  /**
   * URL PUBLICA do inteiro teor. E o permalink do documento — confirmado em
   * requisicao limpa (sem cookie, sem Referer, sem sessao).
   * ⚠️ Quem enderessa o PDF e o ACORDAO (numero/ano), nao o jurisprudenciaId:
   * sao dois identificadores diferentes para o mesmo documento.
   */
  urlPdf(numeroAcordao, anoAcordao) {
    if (!numeroAcordao || !anoAcordao) return null;
    return `${EP_PDF}/${numeroAcordao}/${anoAcordao}`;
  }

  /**
   * Baixa o PDF do acordao.
   * ✅ Numero inventado devolve 404 com corpo vazio — sem casca de 200.
   */
  async baixarPdf(numeroAcordao, anoAcordao) {
    const url = this.urlPdf(numeroAcordao, anoAcordao);
    if (!url) return { ok: false, status: 0, buffer: null, erro: 'sem numero de acordao' };
    try {
      const resp = await this._fetch(url, { headers: { Accept: 'application/pdf,*/*' } });
      if (!resp.ok) return { ok: false, status: resp.status, buffer: null };
      const buffer = Buffer.from(await resp.arrayBuffer());
      return {
        ok: true,
        status: resp.status,
        buffer,
        url,
        ehPdf: buffer.slice(0, 4).toString() === '%PDF',
      };
    } catch (e) {
      return { ok: false, status: 0, buffer: null, erro: e.message };
    }
  }
}

module.exports = TCERJNavigator;
module.exports.HOST = HOST;
module.exports.EP_BUSCA = EP_BUSCA;
module.exports.EP_PDF = EP_PDF;
