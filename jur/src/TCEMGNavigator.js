// src/TCEMGNavigator.js
const https = require('https');
const tls = require('tls');

/**
 * TCEMGNavigator — fala com o MapJuris do TCE-MG (Tribunal de Contas do Estado
 * de Minas Gerais), secao "Textual / Dados do Processo".
 *
 * PORTA: ASP.NET MVC classico, HTML parcial (nao JSON), SEM CAPTCHA.
 *   POST https://mapjuris.tce.mg.gov.br/TextualDadosProcesso/_ListarExcertoIntegra
 *   POST https://mapjuris.tce.mg.gov.br/TextualDadosProcesso/ConsultarInformacaoExcertoIntegra
 *
 * 🔴 A PORTA QUE SE CHAMA "JURISPRUDENCIA" E A FECHADA. A home institucional
 * rotula "Jurisprudencia do TCE" o TCJuris (`tcjuris.tce.mg.gov.br`), e ele esta
 * atras de reCAPTCHA v2 CONFERIDO NO SERVIDOR: com sessao ASP.NET viva e o POST
 * disparado de dentro da propria pagina, `/Home/Busca` devolve HTTP 200 com a
 * pagina "Ocorreu um erro..." (5.392 bytes) em vez do grid. O MapJuris, linkado
 * na MESMA home como "Consultas ao TCE", responde busca textual com ZERO
 * ocorrencias de captcha. Medido em 16/08/2026; ver `human-codegen/TCEMG/`.
 *
 * 🔴 SAO DOIS SALTOS, E O PRIMEIRO NAO TRAZ LINHA NENHUMA.
 *   1. `_ListarExcertoIntegra` devolve a CASCA (9.035 bytes, sempre os mesmos)
 *      com `<div id="gridContainerExcertoIntegra">` VAZIO.
 *   2. `ConsultarInformacaoExcertoIntegra` devolve o JSON com `totalRegistros`
 *      e o HTML das linhas.
 * ⚠️ E o segundo salto SO monta as linhas se receber de volta, no campo
 * `gridHelper`, o JSON de colunas que veio no `<input id='hidden_gridExcertoIntegra'>`
 * do primeiro. Sem ele a resposta e HTTP 200 com `<tr></tr>` vazio — casca de
 * sucesso. Este Navigator extrai e reenvia o hidden automaticamente.
 *
 * 🔴 A GRID SEGUE A ULTIMA BUSCA DA SESSAO, NAO O PARAMETRO. Medido: buscar
 * "pregão" (7), disparar "nepotismo" e so entao paginar com o gridHelper de
 * "pregão" devolve os 2 de nepotismo, HTTP 200, cards validos, sem sintoma.
 * O `gridHelper` carrega o TEMPLATE DE COLUNAS, nao a consulta. E a armadilha do
 * `trocaDePagina.do` do TJAC repetida em ASP.NET. Por isso cada `buscar()` daqui
 * abre a propria sessao e a paginacao fica serializada dentro dela.
 *
 * 🔴 CADEIA TLS INCOMPLETA — HTTP 000 QUE NAO E "FORA DO AR", E QUE VARIA POR
 * HOST DENTRO DO MESMO TRIBUNAL. `mapjuris`, `tcjuris` e `dadosabertos` mandam so
 * a folha (`*.tce.mg.gov.br`, Sectigo OV R36) e OMITEM o intermediario;
 * `www.tce.mg.gov.br`, com o MESMO certificado curinga, manda. Quem medisse o
 * institucional concluiria que o TLS do tribunal esta bom. A correcao e fornecer
 * o intermediario pelo AIA, com `rejectUnauthorized` LIGADO — nunca `-k`.
 * (Mesma CA e mesmo defeito do TCE-BA, um dia depois.)
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (medido em 16/08/2026):
 *   🔴 `api`/`jurisprudencia`/`consulta`.tce.mg.gov.br sao NXDOMAIN.
 *   🔴 `dadosabertos.tce.mg.gov.br` existe (SPA Angular) mas seu backend e um
 *      gateway WSO2 que devolve 401 em TUDO, inclusive no path inventado —
 *      negacao uniforme, de onde nao se conclui nem se ha dataset. Nao serve.
 *   🔴 DataJud NAO se aplica: contas nao e Judiciario. Como no resto do Bloco 5,
 *      NAO HA PLANO B se o portal cair.
 */

/** Intermediario que o `mapjuris` omite. Baixado do AIA do proprio certificado
 *  (http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt).
 *  E o MESMO do TCE-BA — a CA e a mesma. */
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

const HOST = 'mapjuris.tce.mg.gov.br';
const TELA = `https://${HOST}/TextualDadosProcesso`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * ⚠️ TIMEOUT ALTO DE PROPOSITO. A busca custa proporcionalmente a janela de
 * datas: 1,7 s para um mes, ~13 s para um ano, e SEM janela nenhuma nao responde
 * em 240 s (abortado — nao e bloqueio, e custo). Ver TCEMGCrawler.
 */
const TIMEOUT_PADRAO = 180000;

class TCEMGNavigator {
  /** 🔴 O limite do TCE-MG e de SESSOES NOVAS, nao de buscas — ver `abrirSessao`. */
  static TENTATIVAS_SESSAO = 4;
  static ESPERA_429_MS = 20000;

  constructor(options = {}) {
    this.timeout = options.timeout ?? TIMEOUT_PADRAO;
    this.log = options.log ?? console.log;
    this.cookie = null;
    this.agent = new https.Agent({
      keepAlive: true,
      // Raizes do sistema + o intermediario que o mapjuris esquece de mandar.
      ca: [...tls.rootCertificates, SECTIGO_SERVER_AUTH_OV_R36],
    });
  }

  /** ✅ Permalink por documento, confirmado em aba limpa: HTTP 200 SEM cookie.
   *  ⚠️ Mas a pagina e uma CASCA — o conteudo entra por AJAX. Ver `permalinkUtil`. */
  static permalink(id) {
    return `${TELA}/DetalhesExcerto/${id}`;
  }

  /**
   * Request com uma retentativa em `ECONNRESET`.
   * ⚠️ O IIS atras do F5 derruba a conexao de vez em quando ("socket hang up"),
   * sem padrao e sem relacao com o 429 — medido durante a suite de testes. Uma
   * retentativa curta resolve; sem ela, o crawler falha por defeito do servidor.
   * @private
   */
  async _req(method, path, opts = {}) {
    try {
      return await this._req1(method, path, opts);
    } catch (e) {
      if (!/ECONNRESET|socket hang up|EPIPE/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return this._req1(method, path, opts);
    }
  }

  /** Request cru. Resolve { status, headers, body:Buffer }. @private */
  _req1(method, path, { body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const h = { 'User-Agent': UA, Accept: '*/*', ...headers };
      if (this.cookie) h.Cookie = this.cookie;
      if (body != null) {
        h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        h['Content-Length'] = Buffer.byteLength(body);
      }
      const req = https.request({ host: HOST, path, method, agent: this.agent, headers: h }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      });
      req.setTimeout(this.timeout, () =>
        req.destroy(
          new Error(
            `timeout apos ${this.timeout}ms. No MapJuris isso quase sempre e JANELA DE DATA ` +
              'LARGA DEMAIS, nao bloqueio: sem -di/-df a busca nao responde nem em 240 s. ' +
              'Fatie por ano.',
          ),
        ),
      );
      req.on('error', (e) => {
        if (/unable to verify|UNABLE_TO_GET_ISSUER|self.signed/i.test(e.message)) {
          reject(
            new Error(
              'TLS do MapJuris recusado por cadeia incompleta — o intermediario embutido no ' +
                'TCEMGNavigator pode ter sido rotacionado. Rebaixe do AIA do certificado ' +
                '(http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt). ' +
                'NAO desligue a verificacao. ' +
                `Erro original: ${e.message}`,
            ),
          );
          return;
        }
        reject(e);
      });
      if (body != null) req.write(body);
      req.end();
    });
  }

  static _form(o) {
    return Object.entries(o)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
      .join('&');
  }

  /**
   * Abre sessao. OBRIGATORIO: sem `ASP.NET_SessionId` o `/TextualDadosProcesso`
   * responde 302 -> `/Login/LogOff`.
   * ⚠️ E o 302 sozinho nao distingue rota real de rota inexistente — a inventada
   * vai para `/Home/ErrorStatus/404`. So o `Location` separa as duas.
   */
  async abrirSessao() {
    if (this.cookie) return this.cookie;

    let ultima = null;
    for (let tentativa = 0; tentativa < TCEMGNavigator.TENTATIVAS_SESSAO; tentativa++) {
      if (tentativa > 0) {
        const espera = TCEMGNavigator.ESPERA_429_MS * tentativa;
        this.log(
          `  [tcemg] HTTP 429 na home — o limitador do TCE-MG e por CRIACAO DE SESSAO. ` +
            `Aguardando ${Math.round(espera / 1000)} s (tentativa ${tentativa + 1}/${TCEMGNavigator.TENTATIVAS_SESSAO}).`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
      const home = await this._req('GET', '/');
      ultima = home;
      const sc = home.headers['set-cookie'] || [];
      const cookie = sc.map((c) => c.split(';')[0]).join('; ');
      if (/ASP\.NET_SessionId/.test(cookie)) {
        this.cookie = cookie;
        const tela = await this._req('GET', '/TextualDadosProcesso');
        if (tela.status !== 200) {
          throw new Error(`GET /TextualDadosProcesso respondeu ${tela.status} (esperado 200).`);
        }
        return this.cookie;
      }
      this.cookie = null;
      if (home.status !== 429) break;
    }

    // 🔴 429 AQUI NAO E BLOQUEIO DO CRAWLER — E LIMITE DE SESSOES NOVAS.
    // Medido em 20/08/2026: depois de ~20 sessoes abertas em poucos minutos, a
    // home passa a responder HTTP 429 com 54 bytes ("The custom error module
    // does not recognize this error."), SEM `Retry-After`, e ainda assim mandando
    // os cookies do F5 (BIGipServer + TS01bf607f) — so o `ASP.NET_SessionId` some.
    // Quem olhasse o `set-cookie` e concluisse "recebi cookie" seguiria adiante e
    // colheria 302 -> LogOff em toda requisicao seguinte.
    if (ultima && ultima.status === 429) {
      throw new Error(
        'MapJuris respondeu HTTP 429 na home e nao emitiu ASP.NET_SessionId, mesmo apos ' +
          `${TCEMGNavigator.TENTATIVAS_SESSAO} tentativas com espera. NAO e captcha nem ban: e ` +
          'limite de SESSOES NOVAS por origem. A correcao e REUSAR a mesma instancia de ' +
          'TCEMGNavigator (uma sessao serve para muitas buscas) em vez de criar uma por ' +
          'consulta. ⚠️ O 429 vem com os cookies do F5 mas SEM o de sessao — nao leia ' +
          '"recebi set-cookie" como "tenho sessao".',
      );
    }
    throw new Error(
      `MapJuris nao emitiu ASP.NET_SessionId na home (HTTP ${ultima ? ultima.status : '?'}). ` +
        'Sem sessao, /TextualDadosProcesso responde 302 -> /Login/LogOff.',
    );
  }

  /** Extrai o `<input id='hidden_<id>' value='...'>`. @private */
  static _hidden(html, id) {
    const m = html.match(new RegExp(`id='hidden_${id}' value='([\\s\\S]*?)'\\s*/?>`));
    return m ? m[1] : null;
  }

  /**
   * PRIMEIRO SALTO — dispara a busca. Devolve a casca e o template de colunas.
   *
   * ⚠️ `natureza` e `tempDataLista` sao parametros VALIDOS do contrato que a tela
   * principal NAO manda (aparecem em `DetalhesExcerto.js`). O de natureza filtra
   * de verdade — ver TCEMGCrawler.FILTROS.
   */
  async buscar({
    termo = '',
    tipoPesquisa = 'IndexExcerto',
    numeroProcesso = '',
    codRelator = '',
    nomeRelator = '',
    natureza = '',
    dataInicio = '',
    dataFim = '',
  } = {}) {
    await this.abrirSessao();
    const t0 = Date.now();
    const campos = {
      tipoPesquisa,
      termosPesquisa: termo,
      numeroProcesso,
      codRelator,
      dataSessaoInicio: dataInicio,
      dataSessaoFim: dataFim,
      nomeRelator,
    };
    if (natureza) campos.natureza = natureza;
    const r = await this._req('POST', '/TextualDadosProcesso/_ListarExcertoIntegra', {
      body: TCEMGNavigator._form(campos),
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: TELA },
    });
    const html = r.body.toString('utf8');
    return {
      status: r.status,
      bytes: r.body.length,
      ms: Date.now() - t0,
      html,
      // ✅ O zero e EXPLICITO aqui: corpo de 1.656 bytes com "Nenhum registro
      // encontrado.". Nao e formulario vazio com HTTP 200.
      vazio: /Nenhum registro encontrado/i.test(html),
      gridHelper: TCEMGNavigator._hidden(html, 'gridExcertoIntegra'),
    };
  }

  /**
   * SEGUNDO SALTO — traz as linhas. E quem sabe o `totalRegistros`.
   * `quantidade = 0` significa TODOS (o proprio cliente traduz o option "Todos"
   * para 0). Medido: 0, 100 e 1000 devolvem os mesmos 34 de 34 — nao ha teto de
   * pagina; o teto e o custo da busca, no primeiro salto.
   */
  async grid(gridHelper, { pagina = 1, quantidade = 0, ordenar = '', tipoOrdenacao = 0, filtro = '', primeira = true } = {}) {
    if (!gridHelper) {
      throw new Error(
        'gridHelper ausente: sem o JSON de colunas do <input hidden> da busca, o segundo ' +
          'salto responde HTTP 200 com <tr> VAZIO — casca de sucesso.',
      );
    }
    const t0 = Date.now();
    const r = await this._req('POST', '/TextualDadosProcesso/ConsultarInformacaoExcertoIntegra', {
      body: TCEMGNavigator._form({
        strIrParaPagina: pagina,
        strQuantidadeRegistros: String(quantidade),
        strFiltro: filtro,
        PrimeiraRequisicao: primeira,
        IdTabela: 'gridExcertoIntegra',
        strNomeCampoOrdenar: ordenar,
        tipoOrdenacao,
        strNomeColunaFiltrar: '',
        GerarExcel: false,
        primeiraRequisicao: primeira,
        gridHelper,
      }),
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: TELA },
    });
    let json = null;
    try {
      json = JSON.parse(r.body.toString('utf8'));
    } catch {
      /* deixa null: quem chama decide */
    }
    return {
      status: r.status,
      bytes: r.body.length,
      ms: Date.now() - t0,
      json,
      // ✅ Total EXATO, nao saturado: 10 + 10 + 10 + 4 = 34 conferido linha a linha.
      total: json ? json.totalRegistros : null,
      html: (json && (json.htmlGrid || json.htmlCabecalhoCorpo)) || '',
    };
  }

  /** Teses e sumulas — busca SEPARADA, so por termo (sem data, sem relator). */
  async tituloResenha(termo) {
    await this.abrirSessao();
    const r = await this._req('POST', '/TextualDadosProcesso/_ListarTituloResenha', {
      body: TCEMGNavigator._form({ termosPesquisa: termo }),
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: TELA },
    });
    const html = r.body.toString('utf8');
    return { status: r.status, bytes: r.body.length, html, vazio: /Nenhum registro encontrado/i.test(html) };
  }

  /** Combos, populados por AJAX (chegam vazios no HTML estatico). */
  async combos() {
    await this.abrirSessao();
    const out = {};
    for (const [nome, rota] of [
      ['relatores', 'RetornarRelatores'],
      ['naturezas', 'RetornarNaturezas'],
    ]) {
      const r = await this._req('POST', `/TextualDadosProcesso/${rota}`, {
        body: '',
        headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: TELA },
      });
      try {
        out[nome] = JSON.parse(r.body.toString('utf8'));
      } catch {
        out[nome] = { erro: `HTTP ${r.status}`, bytes: r.body.length };
      }
    }
    return out;
  }

  /**
   * PDF do excerto. ⚠️ EXIGE SESSAO (sem cookie: 302). E o href do card e
   * RELATIVO (`Excerto/ExportPdf/<id>`), que resolvido na tela vira
   * `/TextualDadosProcesso/Excerto/ExportPdf/<id>` — **404**. A rota que serve e
   * `/TextualDadosProcesso/ExportPdf/<id>` (ou `/Excerto/ExportPdf/<id>`).
   * ✅ Nome sugerido pelo servidor: `Excerto_<id>.pdf` — aqui o nome JA e chave
   * (ao contrario do TCE-BA), mas o crawler nao depende disso.
   */
  async pdf(id) {
    await this.abrirSessao();
    const r = await this._req('GET', `/TextualDadosProcesso/ExportPdf/${encodeURIComponent(id)}`);
    const tipo = r.headers['content-type'] || '';
    if (r.status !== 200 || !/pdf/i.test(tipo)) {
      return { ok: false, status: r.status, contentType: tipo, bytes: r.body.length };
    }
    return {
      ok: true,
      status: r.status,
      contentType: tipo,
      bytes: r.body.length,
      nomeServidor: (r.headers['content-disposition'] || '').match(/filename=([^;]+)/)?.[1] || null,
      buffer: r.body,
    };
  }

  /**
   * Permalink pelo caminho de um GET CRU (sem executar JavaScript).
   *
   * ✅ O PERMALINK E BOM E FOI CONFIRMADO EM ABA LIMPA: no Playwright, contexto
   * novo e sem cookie, `/DetalhesExcerto/1188139` renderiza **54.707 chars** com a
   * EMENTA visivel (print `03.08-permalink-aba-limpa.png`). Mande-o ao usuario.
   *
   * 🔴 MAS CONFERI-LO POR `curl`+`grep` DA FALSO NEGATIVO — e este metodo existe
   * para deixar isso medido, nao para reprovar o link. O GET cru devolve HTTP 200
   * com ~28,8 KB de CASCA: nem ementa, nem tabela do processo, nem link de PDF. O
   * conteudo entra depois, por um AJAX que refaz `_ListarExcertoIntegra` com
   * `numeroProcesso=<id>` (ver `DetalhesExcerto.js`). E a licao do TJRJ-eJURIS e do
   * TCDF: pagina que monta por AJAX nao se valida sem navegador.
   *
   * `temConteudoNoHtmlCru` e, portanto, esperado `false` — e se um dia virar
   * `true`, e o portal que mudou.
   */
  async permalinkUtil(id) {
    const semSessao = new TCEMGNavigator({ timeout: this.timeout, log: this.log });
    const r = await semSessao._req('GET', `/TextualDadosProcesso/DetalhesExcerto/${encodeURIComponent(id)}`);
    const html = r.body.toString('utf8');
    return {
      url: TCEMGNavigator.permalink(id),
      status: r.status,
      bytes: r.body.length,
      // A casca traz o form e o hidden de colunas, mas nenhum dado do julgado.
      temConteudoNoHtmlCru: /EMENTA/i.test(html),
      // ✅ Confirmado no navegador, em contexto limpo, em 20/08/2026.
      confirmadoEmAbaLimpa: true,
    };
  }
}

module.exports = TCEMGNavigator;
module.exports.TELA = TELA;
