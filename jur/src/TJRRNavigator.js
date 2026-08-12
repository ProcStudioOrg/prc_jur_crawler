// src/TJRRNavigator.js
const https = require('https');

/**
 * Fala com o **Juris — Sistema de Jurisprudência do TJRR**.
 * https://jurisprudencia.tjrr.jus.br
 *
 * Aplicação **JSF/PrimeFaces 10** (`br.jus.tjrr.bpu.*`, "BPU"), renderizada no
 * servidor, rodando em Kubernetes atrás de nginx. Não é SPA e não tem API REST.
 * A busca é um POST de formulário com `javax.faces.ViewState`, e a resposta é o
 * HTML inteiro da listagem — ementa íntegra incluída.
 *
 * ✅ Sem captcha, sem login, sem token, em etapa nenhuma. A busca, a listagem e
 *    o inteiro teor em PDF respondem ao `curl` cru. Medido em 12/08/2026.
 *    ⚠️ Diferente do TJSE, que também é JSF/PrimeFaces e é captcha nos dois
 *    módulos: a família não diz nada sobre o portão. Aqui foi medido mandando o
 *    POST e lendo a resposta, não procurando a string `captcha` no HTML.
 *
 * ⚠️ A TELA TIRA O ACENTO DA QUERY ANTES DE ENVIAR, E O ÍNDICE TAMBÉM NORMALIZA
 *    — duas camadas fazendo a mesma coisa. O `<form>` tem
 *    `onsubmit="normalizar(document.getElementById('consultaAtual').value)"`, de
 *    modo que quem digita `usucapião` manda `usucapiao` no fio. Medido em
 *    seguida **por fora do cliente**, mandando o termo cru: `usucapiao`,
 *    `usucapião` e até o mojibake `usucapiÃo` devolvem os **mesmos 991**.
 *    Ou seja: `normalizar()` aqui reproduz o cliente por fidelidade, **não** por
 *    necessidade — e a conclusão só existe porque as duas camadas foram medidas
 *    em separado. Fosse só a primeira, ficaria gravado "o índice normaliza" sem
 *    prova, ou "o acento é obrigatório" sem prova.
 *
 * 🔴 SÃO DUAS TABELAS DE RESULTADO NA MESMA RESPOSTA, e o total autoritativo de
 *    cada uma é o `rowCount` do widget PrimeFaces, não texto de tela:
 *      `dataTablePesquisa`  → aba **ACÓRDÃOS**
 *      `dataTablePesquisa2` → aba **DECISÃO MONOCRÁTICA**
 *    Quem ler só a primeira perde a segunda inteira, sem sintoma nenhum: a
 *    página responde 200 e mostra cards.
 *
 * ⚠️ NÃO EXISTE API PÚBLICA. Medido e registrado para não se repetir a busca:
 *    - `dadosabertos`/`api`/`consultas`/`sistemas`/`busca`/`portal`.tjrr.jus.br
 *      → todos **NXDOMAIN**.
 *    - No próprio host: `/swagger`, `/swagger-ui.html`, `/v2/api-docs`,
 *      `/v3/api-docs`, `/openapi.json`, `/api`, `/rest`, `/dados-abertos`,
 *      `/robots.txt` → **404** (mesmo corpo de 10.667 b do 404 padrão).
 *    - **Sem vhost curinga:** `/path-inventado-9z` → 404 real.
 *    - ⚠️ `juris.tjrr.jus.br` (SPA Angular, "Sistema Juris") responde **HTTP 200
 *      a QUALQUER path**, inclusive `/path-inventado-9z`, com o mesmo
 *      `index.html` de ~1,6 KB. É fallback de roteador, não API — a armadilha
 *      do TJES. **Confira o tamanho antes de comemorar um 200 em `/swagger`.**
 *    - ✅ O **DataJud** do CNJ responde para o TJRR (`api_publica_tjrr`,
 *      372.220 processos) — é o que alimenta o `TJRRChecker`.
 */

const HOST = 'jurisprudencia.tjrr.jus.br';
const ORIGIN = `https://${HOST}`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/** Prefixo do componente que embrulha as duas tabelas (accordion de abas). */
const TABS = 'formPesquisa:j_idt155';
/** As duas tabelas de resultado da mesma resposta. */
const TABELAS = {
  acordao: { id: `${TABS}:dataTablePesquisa`, aba: 0, rotulo: 'ACÓRDÃOS' },
  monocratica: { id: `${TABS}:dataTablePesquisa2`, aba: 1, rotulo: 'DECISÃO MONOCRÁTICA' },
};

/**
 * 🔴 O COMBO "Linhas por página" É UMA LISTA BRANCA, E FORA DELA A TABELA VOLTA
 *    VAZIA COM HTTP 200. `_rows` aceita **exatamente** 10, 20 e 30 — os três
 *    valores que a tela oferece. Qualquer outro (3, 5, 15, 25, 31, 40, 50, 100)
 *    devolve um fragmento AJAX de **57 bytes**: tabela sem nenhuma linha, sem
 *    erro, sem 500. Medido duas vezes, idêntico nas duas.
 *
 *    É o AVESSO da lição do TJAL ("teste o parâmetro, não o controle"): aqui o
 *    parâmetro não aceita nada além do que o controle oferece, e a punição por
 *    tentar é um zero silencioso. Um crawler que pedisse `--page-size 50`
 *    colheria zero documento em toda página e leria isso como fim da lista.
 *    Por isso `snapRows()` existe: ele encaixa o pedido no valor válido mais
 *    próximo para baixo, em vez de deixar passar.
 */
const ROWS_VALIDOS = [10, 20, 30];
const POR_PAGINA_MAX = 30;

class TJRRNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.origin = options.origin ?? ORIGIN;
    this.pausaMs = options.pausaMs ?? 250;
    this._ultimoRequest = 0;
  }

  /** Request cru com throttle simples. Devolve { status, headers, body }. @private */
  async _req(method, path, body, cookie, extraHeaders = {}) {
    const espera = this.pausaMs - (Date.now() - this._ultimoRequest);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    this._ultimoRequest = Date.now();
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.origin);
      const data = body ? Buffer.from(body, 'utf8') : null;
      const headers = {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        ...extraHeaders,
      };
      if (cookie) headers.Cookie = cookie;
      if (data) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = data.length;
        headers.Referer = `${this.origin}/index.xhtml`;
        headers.Origin = this.origin;
      }
      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, method, headers, timeout: this.timeout },
        (res) => {
          const ch = [];
          res.on('data', (d) => ch.push(d));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) })
          );
        }
      );
      req.on('timeout', () => req.destroy(new Error(`timeout ${this.timeout}ms em ${path}`)));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  /**
   * Reproduz o `normalizar()` do próprio portal: tira acento e passa a
   * minúscula. **Não é opcional** — ver o bloco 🔴 no topo do arquivo.
   */
  static normalizar(t) {
    return String(t ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  /** Extrai o `javax.faces.ViewState` de um HTML de resposta. @private */
  static _viewState(html) {
    const m =
      html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/) ||
      html.match(/<update id="j_id1:javax\.faces\.ViewState:0"><!\[CDATA\[([^\]]*)\]\]><\/update>/);
    return m ? m[1] : null;
  }

  /** Abre a sessão: GET da home → cookies + ViewState inicial. */
  async abrirSessao() {
    const r = await this._req('GET', '/index.xhtml');
    if (r.status !== 200) throw new Error(`TJRR: home respondeu HTTP ${r.status}`);
    const html = r.body.toString('utf8');
    const cookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const viewState = TJRRNavigator._viewState(html);
    if (!viewState) throw new Error('TJRR: ViewState não encontrado na home');
    return { cookie, viewState, html };
  }

  /**
   * Busca. Duas etapas, porque o formulário da home (`menuinicial`) só tem
   * termo/número — os filtros só existem no formulário da tela de resultado
   * (`formPesquisa`), como no TJPI.
   *
   * @param {object} p
   * @param {string} [p.termo]        termo livre (será normalizado)
   * @param {string} [p.ementa]       texto em "Ementa/Indexação"
   * @param {string} [p.numProcesso]  13 dígitos (SISCOM) ou 20 dígitos (PROJUDI)
   * @param {string[]} [p.orgaos]     valores de `tipoOrgaoList` (ex.: TURMA_RECURSAL)
   * @param {string[]} [p.relatores]  valores crus de `relatorList*`
   * @param {string} [p.classe]       value do `tipoClasseList`
   * @param {string} [p.dataInicial]  DD/MM/YYYY
   * @param {string} [p.dataFinal]    DD/MM/YYYY
   * @param {string} [p.tipoData]     'JULGAMENTO' | 'PUBLICACAO' | '' (TODOS)
   * @param {number} [p.porPagina]
   */
  async buscar(p = {}) {
    const sessao = await this.abrirSessao();
    const termo = TJRRNavigator.normalizar(p.termo || '');

    // Etapa 1 — o POST da home. É o que cria a view `formPesquisa`.
    const inicial = new URLSearchParams({
      menuinicial: 'menuinicial',
      'javax.faces.ViewState': sessao.viewState,
      'menuinicial:j_idt28': termo,
      'menuinicial:j_idt30': '',
      'menuinicial:numProcesso': p.numProcesso || '',
      'menuinicial:j_idt42_collapsed': 'true',
      'menuinicial:data': '',
    });
    let r = await this._req('POST', '/index.xhtml', inicial.toString(), sessao.cookie);
    if (r.status !== 200) throw new Error(`TJRR: busca respondeu HTTP ${r.status}`);
    let html = r.body.toString('utf8');

    const temFiltro =
      p.ementa ||
      (p.orgaos && p.orgaos.length) ||
      (p.relatores && p.relatores.length) ||
      (p.classe && p.classe !== '0') ||
      p.dataInicial ||
      p.dataFinal ||
      (p.porPagina && p.porPagina !== 10);

    if (temFiltro) {
      html = await this._postFiltros(html, sessao.cookie, p, termo);
    }
    return { html, cookie: sessao.cookie, viewState: TJRRNavigator._viewState(html) };
  }

  /** POST no `formPesquisa` com os filtros aplicados. @private */
  async _postFiltros(html, cookie, p, termo) {
    const vs = TJRRNavigator._viewState(html);
    const body = new URLSearchParams();
    body.append('formPesquisa', 'formPesquisa');
    body.append('javax.faces.ViewState', vs);
    body.append('formPesquisa:consultaAtual', termo);
    body.append('formPesquisa:numProcesso', p.numProcesso || '');
    body.append('formPesquisa:j_idt122_collapsed', 'false');
    body.append('formPesquisa:datainicial_input', p.dataInicial || '');
    body.append('formPesquisa:datafinal_input', p.dataFinal || '');
    body.append('formPesquisa:tipoProcedimento', p.tipoData ?? '');
    for (const o of p.orgaos || []) body.append('formPesquisa:tipoOrgaoList', o);
    for (const rel of p.relatores || []) {
      body.append(rel.campo || 'formPesquisa:relatorList', rel.valor ?? rel);
    }
    body.append('formPesquisa:j_idt140_collapsed', 'false');
    body.append('formPesquisa:j_idt147', p.ementa || '');
    body.append('formPesquisa:tipoClasseList', p.classe || '0');
    const rows = String(TJRRNavigator.snapRows(p.porPagina || 10));
    body.append(`${TABELAS.acordao.id}_rppDD`, rows);
    body.append(`${TABELAS.monocratica.id}_rppDD`, rows);
    body.append(`${TABS}_activeIndex`, '0');
    body.append('formPesquisa:btnPesquisa', '');

    const r = await this._req('POST', '/index.xhtml', body.toString(), cookie);
    if (r.status !== 200) throw new Error(`TJRR: filtro respondeu HTTP ${r.status}`);
    return r.body.toString('utf8');
  }

  /**
   * Pagina uma das duas tabelas. É AJAX parcial do PrimeFaces: a resposta é XML
   * com o `<update>` da tabela dentro de CDATA.
   */
  async paginar(estado, { aba = 'acordao', first = 0, rows = 10, termo = '' } = {}) {
    const t = TABELAS[aba];
    if (!t) throw new Error(`TJRR: aba desconhecida "${aba}"`);
    rows = TJRRNavigator.snapRows(rows);
    const body = new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': t.id,
      'javax.faces.partial.execute': t.id,
      'javax.faces.partial.render': t.id,
      'javax.faces.behavior.event': 'page',
      'javax.faces.partial.event': 'page',
      [`${t.id}_pagination`]: 'true',
      [`${t.id}_first`]: String(first),
      [`${t.id}_rows`]: String(rows),
      [`${t.id}_skipChildren`]: 'true',
      [`${t.id}_encodeFeature`]: 'true',
      formPesquisa: 'formPesquisa',
      'javax.faces.ViewState': estado.viewState,
      'formPesquisa:consultaAtual': TJRRNavigator.normalizar(termo),
      'formPesquisa:numProcesso': '',
      'formPesquisa:j_idt122_collapsed': 'true',
      'formPesquisa:datainicial_input': '',
      'formPesquisa:datafinal_input': '',
      'formPesquisa:tipoProcedimento': '',
      'formPesquisa:j_idt140_collapsed': 'true',
      'formPesquisa:j_idt147': '',
      'formPesquisa:tipoClasseList': '0',
      [`${TABELAS.acordao.id}_rppDD`]: String(rows),
      [`${TABELAS.monocratica.id}_rppDD`]: String(rows),
      [`${TABS}_activeIndex`]: String(t.aba),
    });
    const r = await this._req('POST', '/index.xhtml', body.toString(), estado.cookie, {
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
    });
    if (r.status !== 200) throw new Error(`TJRR: paginação respondeu HTTP ${r.status}`);
    const xml = r.body.toString('utf8');
    const novoVs = TJRRNavigator._viewState(xml);
    if (novoVs) estado.viewState = novoVs;
    const m = xml.match(/<update id="[^"]*dataTablePesquisa2?"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
    return m ? m[1] : xml;
  }

  /**
   * Baixa o inteiro teor. É **PDF público**: `/pdf?id=<id>` responde 200 sem
   * cookie, sem sessão e sem captcha (testado em contexto limpo).
   * ⚠️ `inteiroTeor.xhtml?id=<id>` é só o visualizador — devolve 2,4 KB de
   * HTML embrulhando um `<object>`; não confunda um com o outro.
   */
  async inteiroTeor(id) {
    const r = await this._req('GET', `/pdf?id=${encodeURIComponent(id)}`);
    if (r.status !== 200) throw new Error(`TJRR: /pdf?id=${id} respondeu HTTP ${r.status}`);
    const ct = r.headers['content-type'] || '';
    if (!ct.includes('pdf')) throw new Error(`TJRR: /pdf?id=${id} devolveu ${ct}, não PDF`);
    return r.body;
  }

  /** Total autoritativo de cada aba: o `rowCount` do widget PrimeFaces. */
  static totais(html) {
    const out = { acordao: null, monocratica: null };
    const re = /id:"([^"]*dataTablePesquisa2?)"[\s\S]{0,600}?rowCount:(\d+)/g;
    let m;
    while ((m = re.exec(html))) {
      const key = m[1].endsWith('dataTablePesquisa2') ? 'monocratica' : 'acordao';
      out[key] = Number(m[2]);
    }
    return out;
  }

  /** Encaixa `rows` num dos três valores aceitos (10/20/30). Ver ROWS_VALIDOS. */
  static snapRows(n) {
    const alvo = Number(n) || 10;
    const validos = ROWS_VALIDOS.filter((v) => v <= alvo);
    return validos.length ? validos[validos.length - 1] : ROWS_VALIDOS[0];
  }

  static get ROWS_VALIDOS() {
    return ROWS_VALIDOS;
  }
  static get POR_PAGINA_MAX() {
    return POR_PAGINA_MAX;
  }
  static get TABELAS() {
    return TABELAS;
  }
  static get ORIGIN() {
    return ORIGIN;
  }
}

module.exports = TJRRNavigator;
