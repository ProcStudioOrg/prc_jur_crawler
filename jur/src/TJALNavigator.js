// src/TJALNavigator.js

/**
 * Navigator do TJAL — cliente HTTP puro do e-SAJ `cjsg` (Consulta de
 * Jurisprudência do Segundo Grau):
 * https://www2.tjal.jus.br/cjsg/consultaCompleta.do
 *
 * ⚠️ **O host é `www2`, não `esaj`.** Medido em 31/07/2026 e reconfirmado em
 * 05/08/2026: `esaj.tjal.jus.br` é **NXDOMAIN** — o host não existe. Quem
 * chutar o padrão `esaj.` dos irmãos conclui que o tribunal caiu. (No TJAM o
 * erro é o inverso: lá o `esaj.` resolve e devolve 404.)
 *
 * **Sem browser para a busca.** Medido: a tela de consulta não carrega
 * `grecaptcha` (`typeof window.grecaptcha === "undefined"`), não tem `sitekey`
 * no HTML e a palavra "captcha" não aparece no documento.
 *
 * ⚠️ **MAS O DOWNLOAD DO INTEIRO TEOR TEM reCAPTCHA**, como no TJAC e no TJAM.
 * O bloqueio é assimétrico: busca livre, `getArquivo.do` atrás de reCAPTCHA v2
 * com sitekey **própria de Alagoas** (`SITEKEY_DOWNLOAD` abaixo — a do TJAM e a
 * do TJAC não servem). Ver `inteiroTeor()`.
 *
 * ✅ **A BASE ESTÁ VIVA — e é a diferença mais importante contra o TJAM.**
 * Medido em 05/08/2026 com `dano moral` na ementa, 2º grau, acórdãos:
 *
 *   por julgamento: 2021: 3.532 | 2022: 9.100 | 2023: 12.404 | 2024: 28.016
 *                   2025: 26.657 | 2026 (jan–jul): **11.215**
 *   por publicação: 2024: 27.924 | 2025: 26.504 | 2026 (jan–jul): **11.483**
 *                   jul/2026 sozinho: **981**
 *
 * O julgado mais recente da amostra tem julgamento em 23/07/2026 e publicação
 * em 24/07/2026 — ou seja, a base está a dias do presente. O `TJALTestes.js`
 * tem um teste-sentinela que falha em voz alta se isso mudar.
 *
 * O que este módulo cobre e o que NÃO cobre:
 *   - Só **2º grau** (Câmaras/Seções) e **Colégios Recursais** (o rótulo da
 *     tela), separados pelo checkbox `dados.origensSelecionadas` (T e R).
 *   - **Não tem 1º grau.** O módulo `cjpg` (sentenças) **não existe** aqui:
 *     medido, `/cjpg/` responde 200 com 5.701 bytes e **sem formulário de
 *     busca**. Mesmo comportamento do TJAM.
 *   - **Não cobre o acervo do Projudi**, que o TJAL roda em paralelo com o ESAJ
 *     no 1º grau (`projudi.tjal.jus.br` é NXDOMAIN; não há módulo de
 *     jurisprudência mapeável).
 *
 * **Não existe API pública de jurisprudência** — procurada e não encontrada.
 * ⚠️ E aqui a armadilha do TJAC se repete em forma mais perigosa: **todo path
 * inventado responde HTTP 200**. Medido — `/dados-abertos`, `/swagger`,
 * `/openapi.json`, `/api/`, `/rest/`, `/v1/` **e** `/qualquer-coisa-inventada-9z`
 * devolvem exatamente o mesmo corpo (md5 idêntico: a shell do SPA em
 * `tjal.jus.br`, 1.730 bytes; a página fixa do e-SAJ em `www2`, 5.705 bytes).
 * `dadosabertos.tjal.jus.br` resolve, mas **redireciona para `/enderecos`** do
 * portal institucional. `api.tjal.jus.br` resolve para **172.17.35.106**, um IP
 * privado (RFC1918) que não responde de fora — vazamento de DNS interno, não
 * API pública. `jurisprudencia.tjal.jus.br` é NXDOMAIN.
 * **Confira o md5 antes de comemorar um 200.**
 *
 * Diferenças medidas contra os cjsg do TJMS, TJAC e TJAM — **não herde de
 * nenhum dos três**:
 *   - **Página de 20** (TJAM 10, TJAC 20, TJMS 100). Coincide com o TJAC.
 *   - **A Justiça Comum é MAIOR que o Juizado — 3,3×** (103.280 × 31.474).
 *     Isso **desfaz** a inversão do TJAC (2,8× a favor do Juizado) e do TJAM
 *     (7,7×). Quatro instalações, três padrões diferentes: medir é obrigatório.
 *   - **O formulário só tem o checkbox `A`** (Acórdãos). TJAC tem A e D; TJAM
 *     tem A, H e D. ⚠️ **Mas `D` funciona mesmo sem checkbox** (43 monocráticas
 *     medidas, com `cdAcordao` e datas próprios). Checkbox ausente ≠ aba
 *     inexistente — ver `TIPOS`.
 *   - **Acento NÃO importa** (como TJAC/TJAM, ao contrário do TJMS):
 *     `usucapiao`/`usucapião` = 1.819; `execucao`/`execução` = 95.558.
 *   - **`$` não zera aqui, degenera**: `dan$` devolve **2** (no TJAC e no TJAM
 *     zerava). Continua inútil, mas o sintoma é outro.
 *   - **A citação abre por `Número do Processo:`** — quarto formato da família.
 *     TJMS, TJAC e TJAM abrem cada um de um jeito. Ver `separarCitacao()`.
 *   - **Total exato**, provado por aritmética: jul/2026 = 981 = 49 páginas
 *     cheias de 20 + 1 na página 50 (a última medida); a 51 devolve 0 cards.
 *   - **Paginação estável**: 3/3 idênticas na mesma sessão e 3/3 entre sessões
 *     novas. `trocaDePagina.do` sem sessão dá **HTTP 404** — falha barulhenta.
 */

const BASE = 'https://www2.tjal.jus.br/cjsg';
const URL_CONSULTA = `${BASE}/consultaCompleta.do`;
const URL_RESULTADO = `${BASE}/resultadoCompleta.do`;
const URL_PAGINA = `${BASE}/trocaDePagina.do`;
const URL_ARQUIVO = `${BASE}/getArquivo.do`;

/**
 * Campos que a tela envia sempre, mesmo vazios. Omitir muda o resultado.
 * Extraídos do DOM depois do AJAX — ver `human-codegen/TJAL/01-cjsg/01-campos.json`
 * (39 campos, **zero `<select>`**: os combos de classe/assunto/seção são popups
 * do SAJ que gravam em hidden, não elementos `<select>`).
 */
const CAMPOS_BASE = {
  conversationId: '',
  'dados.buscaInteiroTeor': '',
  'dados.pesquisarComSinonimos': 'S',
  'dados.buscaEmenta': '',
  'dados.nuProcOrigem': '',
  'dados.nuRegistro': '',
  agenteSelectedEntitiesList: '',
  contadoragente: '0',
  contadorMaioragente: '0',
  codigoCr: '',
  codigoTr: '',
  nmAgente: '',
  juizProlatorSelectedEntitiesList: '',
  contadorjuizProlator: '0',
  contadorMaiorjuizProlator: '0',
  codigoJuizCr: '',
  codigoJuizTr: '',
  nmJuiz: '',
  'classesTreeSelection.values': '',
  'classesTreeSelection.text': '',
  'assuntosTreeSelection.values': '',
  'assuntosTreeSelection.text': '',
  'secoesTreeSelection.values': '',
  'secoesTreeSelection.text': '',
  'dados.dtJulgamentoInicio': '',
  'dados.dtJulgamentoFim': '',
  'dados.dtPublicacaoInicio': '',
  'dados.dtPublicacaoFim': '',
  'dados.ordenarPor': 'dtPublicacao',
};

const decodeEntidades = (s) =>
  String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&Ccedil;/g, 'Ç').replace(/&ccedil;/g, 'ç')
    .replace(/&Atilde;/g, 'Ã').replace(/&atilde;/g, 'ã')
    .replace(/&Otilde;/g, 'Õ').replace(/&otilde;/g, 'õ')
    .replace(/&Aacute;/g, 'Á').replace(/&aacute;/g, 'á')
    .replace(/&Eacute;/g, 'É').replace(/&eacute;/g, 'é')
    .replace(/&Iacute;/g, 'Í').replace(/&iacute;/g, 'í')
    .replace(/&Oacute;/g, 'Ó').replace(/&oacute;/g, 'ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&uacute;/g, 'ú')
    .replace(/&Acirc;/g, 'Â').replace(/&acirc;/g, 'â')
    .replace(/&Ecirc;/g, 'Ê').replace(/&ecirc;/g, 'ê')
    .replace(/&Ocirc;/g, 'Ô').replace(/&ocirc;/g, 'ô')
    .replace(/&Agrave;/g, 'À').replace(/&agrave;/g, 'à')
    .replace(/&Uuml;/g, 'Ü').replace(/&uuml;/g, 'ü')
    .replace(/&ordm;/g, 'º').replace(/&ordf;/g, 'ª')
    .replace(/&sect;/g, '§').replace(/&deg;/g, '°').replace(/&para;/g, '¶')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&amp;/gi, '&');

const semTags = (html) =>
  decodeEntidades(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Pega o conteúdo de uma linha `<strong>Rótulo:</strong> valor` do card. */
function campo(cardHtml, rotulo) {
  const re = new RegExp(`<strong>\\s*${rotulo}\\s*:?\\s*</strong>([\\s\\S]*?)</td>`, 'i');
  const m = cardHtml.match(re);
  return m ? semTags(m[1]) : '';
}

class TJALNavigator {
  /**
   * `dados.origensSelecionadas` — a desambiguação Justiça Comum × Juizado.
   * Rótulos exatos da tela: `T` = "2° grau", `R` = "Colégios Recursais".
   *
   * ⚠️ Medido com `dano moral` na ementa (acórdãos):
   *
   *   T (2º grau)             -> 103.280
   *   R (Colégios Recursais)  ->  31.474
   *   T + R                   -> 134.754   (= 103.280 + 31.474, exato)
   *
   * A soma exata prova que o filtro não é ignorado. E **em Alagoas a Justiça
   * Comum é 3,3× o Juizado** — o oposto do TJAC (2,8× a favor do Juizado) e do
   * TJAM (7,7×). O default `comum` aqui NÃO esconde a maior parte do acervo,
   * mas ainda esconde 23% dele.
   *
   * ⚠️ O filtro se chama "Colégios Recursais" na tela, mas o `orgaoJulgador`
   * que volta nos dados é **`Turma Recursal Unificada`** (e o relator vem como
   * `Juiz 1 Turma Recursal Unificada`). Não procure "Colégio" nos dados.
   */
  static ORIGENS = { comum: 'T', turmas: 'R' };

  /**
   * `tipoDecisaoSelecionados` — as abas do resultado.
   *
   * ⚠️ **ARMADILHA MEDIDA: o formulário do TJAL só tem o checkbox `A`.** O
   * `<div id="linhaTipoDecisao">` traz um único input (`value="A"`, checked).
   * Não há checkbox de Homologação nem de Monocrática — ao contrário do TJAM
   * (A, H, D) e do TJAC (A, D).
   *
   * **Mas o parâmetro `D` funciona assim mesmo**: enviar
   * `tipoDecisaoSelecionados=D` devolve `totalResultadoAba-D = 43`, com cards
   * de `cdAcordao`, relator, órgão e datas próprios — documentos reais e
   * distintos dos acórdãos. Ou seja: **checkbox ausente ≠ aba inexistente**.
   *
   * Já `H` devolve `totalResultadoAba-H = 0` sem cards. Como o checkbox também
   * não existe, esse zero é **ambíguo** — pode ser aba vazia (caso do TJAM) ou
   * aba inexistente (caso do TJAC). **Não afirme qual dos dois é**; está
   * registrado como não decidido.
   */
  static TIPOS = { acordao: 'A', homologacao: 'H', monocratica: 'D' };

  /** `dados.ordenarPor`. */
  static ORDENS = { publicacao: 'dtPublicacao', relevancia: 'relevancia' };

  /** `dados.buscaEmenta` × `dados.buscaInteiroTeor` (103.280 × 144.628). */
  static ESCOPOS = { ementa: 'dados.buscaEmenta', inteiroTeor: 'dados.buscaInteiroTeor' };

  /**
   * Medido: "Resultados 1 a 20 de 103280" e 20 cards por página. Não há combo
   * de tamanho de página. Coincide com o TJAC; o TJAM usa 10 e o TJMS, 100.
   * Herdar 10 daqui faria o crawler pedir o dobro de páginas à toa; herdar 100
   * faria o `-m` prometer 5× mais resultados do que entrega.
   */
  static POR_PAGINA = 20;

  static BASE = BASE;

  /**
   * reCAPTCHA v2 que guarda o `getArquivo.do` — só o download, não a busca.
   * **Sitekey própria de Alagoas.** A do TJAM
   * (`6LcnC3cdAAAAABWUEy-SzR8kMrk3FA9llI6hU934`) é outra.
   */
  static SITEKEY_DOWNLOAD = '6LfALTkUAAAAALzYBt8XXduGuX-XRaljNf99yVpX';

  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.cookie = null;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  }

  async _fetch(url, options = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(options.headers || {}),
        },
      });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) {
        if (c.startsWith('JSESSIONID=')) this.cookie = c.split(';')[0];
      }
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  /** GET na tela de consulta só para abrir sessão. Idempotente. */
  async iniciar() {
    if (this.cookie) return this.cookie;
    const res = await this._fetch(URL_CONSULTA, { method: 'GET' });
    await res.text();
    return this.cookie;
  }

  /** Monta o corpo do POST na ordem/forma que a tela envia. */
  static corpo(filtros = {}) {
    const p = new URLSearchParams();
    const campos = { ...CAMPOS_BASE };

    const escopo = TJALNavigator.ESCOPOS[filtros.escopo ?? 'ementa'];
    if (!escopo) throw new Error(`escopo inválido: "${filtros.escopo}" (use ementa ou inteiroTeor)`);
    campos[escopo] = filtros.query ?? '';

    if (filtros.processo) campos['dados.nuProcOrigem'] = filtros.processo;
    if (filtros.relator) campos.nmAgente = filtros.relator;
    if (filtros.dataJulgamentoInicio) campos['dados.dtJulgamentoInicio'] = filtros.dataJulgamentoInicio;
    if (filtros.dataJulgamentoFim) campos['dados.dtJulgamentoFim'] = filtros.dataJulgamentoFim;
    if (filtros.dataPublicacaoInicio) campos['dados.dtPublicacaoInicio'] = filtros.dataPublicacaoInicio;
    if (filtros.dataPublicacaoFim) campos['dados.dtPublicacaoFim'] = filtros.dataPublicacaoFim;
    if (filtros.sinonimos === false) campos['dados.pesquisarComSinonimos'] = 'N';
    campos['dados.ordenarPor'] = filtros.ordem ?? TJALNavigator.ORDENS.publicacao;

    for (const [k, v] of Object.entries(campos)) p.append(k, v);
    for (const o of filtros.origens ?? ['T']) p.append('dados.origensSelecionadas', o);
    for (const t of filtros.tipos ?? ['A']) p.append('tipoDecisaoSelecionados', t);
    return p.toString();
  }

  /**
   * Executa a busca (página 1) e devolve totais por aba + os julgados.
   * A sessão criada aqui é o que permite paginar depois.
   */
  async buscar(filtros = {}) {
    const res = await this._fetch(URL_RESULTADO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: TJALNavigator.corpo(filtros),
    });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`cjsg respondeu HTTP ${res.status}`);
    // o trocaDePagina.do não identifica a busca: ele pagina a ÚLTIMA desta
    // sessão. Guardamos a assinatura para detectar paginação órfã em paginar().
    this.assinaturaUltimaBusca = TJALNavigator.corpo(filtros);
    return { ...TJALNavigator.parsear(html), status: res.status, html };
  }

  /**
   * Página N de uma aba. Depende da sessão da busca — medido: sem o JSESSIONID
   * o `trocaDePagina.do` do TJAL devolve **HTTP 404** (773 bytes), não uma
   * página vazia com HTTP 200. Falha barulhenta, como no TJAC e no TJAM.
   *
   * ⚠️ **`trocaDePagina.do` NÃO identifica a busca — e isso foi MEDIDO aqui,
   * não herdado.** A URL só tem `tipoDeDecisao` e `pagina`; o servidor pagina o
   * último resultado daquele JSESSIONID. O experimento: página 2 da busca A
   * devolveu `853528,853530,853534`; depois de rodar uma busca B no mesmo
   * cookie, a MESMA URL devolveu `850400,848809,848665` — HTTP 200, cards
   * válidos, busca errada, sintoma nenhum.
   */
  async paginar(pagina, tipo = 'A', assinaturaEsperada = null) {
    if (!this.cookie) throw new Error('paginar() exige a sessão de buscar() — sem JSESSIONID o cjsg do TJAL devolve HTTP 404');
    if (assinaturaEsperada && this.assinaturaUltimaBusca !== assinaturaEsperada) {
      throw new Error('paginar() foi chamado depois de outra busca nesta mesma sessão: ' +
        'o trocaDePagina.do do TJAL pagina a ÚLTIMA busca do JSESSIONID, então isto ' +
        'devolveria páginas da busca errada com HTTP 200. Refaça buscar() antes de paginar.');
    }
    const res = await this._fetch(`${URL_PAGINA}?tipoDeDecisao=${tipo}&pagina=${pagina}`, { method: 'GET' });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`trocaDePagina.do respondeu HTTP ${res.status}`);
    return { ...TJALNavigator.parsear(html), status: res.status, html };
  }

  /**
   * ⚠️ **BLOQUEADO POR reCAPTCHA.** Medido em 05/08/2026 com um `cdAcordao`
   * válido (853550): `getArquivo.do` devolve HTTP 200 `text/html;charset=UTF-8`
   * (3.420 bytes) com a tela "Para acessar o conteúdo do Acórdão, por favor
   * digite o código da figura no campo abaixo", carregando o reCAPTCHA v2 com a
   * `SITEKEY_DOWNLOAD`. **Nunca é PDF.** Este repo não automatiza captcha.
   *
   * Detalhe medido que os irmãos não têm: a tela diz *"Esta validação lhe dará
   * acesso para visualizar 20 resultados"* — o destravamento seria por lote, não
   * por documento. Continua exigindo resolver o captcha, então não muda nada
   * para o crawler; fica registrado porque muda o custo de uma eventual
   * operação assistida.
   *
   * A boa notícia: a **ementa íntegra já vem no HTML da busca**
   * (`div#textAreaDados_<cdAcordao>`), e no TJAL ela é a mais rica da família —
   * média de 4.746 chars em acórdão. Não se perde o texto analítico, só o
   * relatório/voto.
   */
  async inteiroTeor(cdAcordao, cdForo = '0') {
    const url = `${URL_ARQUIVO}?cdAcordao=${encodeURIComponent(cdAcordao)}&cdForo=${encodeURIComponent(cdForo)}`;
    const res = await this._fetch(url, { method: 'GET' });
    const buf = Buffer.from(await res.arrayBuffer());
    const tipo = res.headers.get('content-type') || '';
    if (res.status !== 200) throw new Error(`getArquivo.do respondeu HTTP ${res.status}`);
    const ehPdf = buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (!ehPdf) {
      const corpo = buf.toString('utf8');
      if (/recaptcha|uuidCaptcha|c[óo]digo da figura/i.test(corpo)) {
        throw new Error(
          'inteiro teor do TJAL bloqueado por reCAPTCHA: o getArquivo.do devolve a tela ' +
          '"digite o código da figura", não o PDF. Este repo não resolve captcha. ' +
          'A ementa íntegra já veio na busca — use-a. Ver CLAUDE-TJAL.md.');
      }
      throw new Error(`getArquivo.do não devolveu PDF (${tipo}, ${buf.length} bytes)`);
    }
    return { url, buffer: buf, contentType: tipo, ehPdf, bytes: buf.length };
  }

  /**
   * ⚠️ **NÃO EXISTE PERMALINK NO TJAL.** Medido em aba limpa (contexto sem
   * cookies), 05/08/2026:
   *   - `resultadoCompleta.do;jsessionid=…` → HTTP **200 com 0 cards**. A URL de
   *     resultado não é reutilizável: o estado da busca vive na sessão.
   *   - `getArquivo.do?cdAcordao=…&cdForo=…` → a tela do reCAPTCHA.
   *   - O único `onclick` do card é `abrirPopUpDadosSemFormatacao(<cdAcordao>)`,
   *     que é **modal e não muda a URL** — e, medido, **não dispara XHR nenhum**
   *     (o texto já estava na página).
   *
   * Devolve a URL do `getArquivo.do` **rotulada como não-permalink** para
   * rastreio interno. **Nunca a apresente como link de citação** — a verificação
   * de um julgado do TJAL é por reconsulta (`-n <nº>`).
   */
  static urlDocumento(cdAcordao, cdForo = '0') {
    return `${URL_ARQUIVO}?cdAcordao=${cdAcordao}&cdForo=${cdForo}`;
  }

  // ----------------------------------------------------------------- parsing

  /** Rótulo humano de cada aba `tipoDecisaoSelecionados`. */
  static NOME_TIPO = { A: 'Acórdão', H: 'Homologação de Acordo', D: 'Decisão Monocrática' };

  /**
   * Lê os totais por aba e os cards de uma resposta do cjsg.
   *
   * O total autoritativo é o hidden `<input id="totalResultadoAba-<tipo>">` —
   * conferido contra o texto da tela ("Resultados 1 a 20 de 103280") e contra a
   * aritmética da última página (jul/2026: 981 = 49 × 20 + 1 na página 50; a
   * página 51 devolve 0 cards). **Total exato**, não saturado — reconferido com
   * um termo raro (`litispendência superveniente` = 48, número não redondo).
   *
   * ⚠️ O atributo `id` vem **antes** do `type` neste portal
   * (`<input id="totalResultadoAba-A" type="hidden" value="103280" />`). Um
   * regex que exija `id=` logo depois de `type="hidden"` não casa nada e o
   * crawler lê zero em toda busca.
   *
   * ⚠️ `totais` VAZIO (`{}`) não é o mesmo que `{A: 0}`. O primeiro é a tela de
   * consulta devolvida de volta — aqui isso acontece quando o intervalo de datas
   * passa de 1 ano, e a página traz o aviso "A faixa entre data de inicio e data
   * de fim deve ser de no máximo 1 ano". O `TJALCrawler` distingue os dois; sem
   * isso, uma busca recusada vira "não há jurisprudência".
   */
  static parsear(html) {
    const totais = {};
    for (const m of html.matchAll(/totalResultadoAba-(\w)"[^>]*value="(\d+)"/g)) {
      totais[m[1]] = parseInt(m[2], 10);
    }
    const total = Object.values(totais).reduce((a, b) => a + b, 0);
    const formularioDeVolta = Object.keys(totais).length === 0;
    const avisoIntervalo = /faixa entre data de inicio e data de fim deve ser de no m[áa]ximo 1 ano/i.test(html);
    const mAba = html.match(/id="divDadosResultado-(\w)"/);
    const tipo = mAba ? mAba[1]
      : (Object.entries(totais).find(([, n]) => n > 0) || [])[0] || 'A';
    return {
      totais, total, tipo, formularioDeVolta, avisoIntervalo,
      resultados: TJALNavigator.parsearCards(html, tipo),
    };
  }

  /**
   * Cada julgado é um `<tr class="fundocinza1">`. O `cdacordao` do link de
   * download é o identificador do documento — **não** o nº do processo, que se
   * repete entre julgados do mesmo feito.
   */
  static parsearCards(html, tipo = 'A') {
    const out = [];
    const vistos = new Set();
    const partes = html.split(/<tr class="fundocinza1">/).slice(1);
    for (const bruto of partes) {
      const card = bruto.split(/<\/tr>\s*(?=<tr class="fundocinza1">|$)/)[0];
      const mId = card.match(/cdacordao="(\d+)"/i);
      if (!mId) continue;
      const cdAcordao = mId[1];
      if (vistos.has(cdAcordao)) continue;
      vistos.add(cdAcordao);
      const cdForo = (card.match(/cdforo="(\d+)"/i) || [])[1] || '0';

      const mProc = card.match(/<a class="[^"]*downloadEmenta"[^>]*>\s*([\d.\-]+)\s*</i);
      const processo = mProc ? mProc[1].trim() : '';

      // A ementa "sem formatação" é a ÍNTEGRA e já vem no HTML da busca —
      // medido: abrir o popup não dispara NENHUM XHR. Média de 4.746 chars em
      // acórdão, 3.876 em Turma Recursal e 3.394 em monocrática.
      const mSem = card.match(new RegExp(`<div id="textAreaDados_${cdAcordao}"[^>]*>([\\s\\S]*?)</div>`));
      const semFormatacao = mSem ? semTags(mSem[1]) : '';
      const { ementa, citacao } = TJALNavigator.separarCitacao(semFormatacao);

      const classeAssunto = campo(card, 'Classe/Assunto');
      const [classe, assunto] = classeAssunto.includes('/')
        ? [classeAssunto.split('/')[0].trim(), classeAssunto.split('/').slice(1).join('/').trim()]
        : [classeAssunto, ''];

      const mOcorr = card.match(/\((\d+)\s+ocorr[êe]ncias?\s+encontradas?\s+no\s+inteiro\s+teor/i);

      out.push({
        id: cdAcordao,
        cdAcordao,
        cdForo,
        tipoDocumento: TJALNavigator.NOME_TIPO[tipo] ?? 'Acórdão',
        processo,
        numeroProcesso: processo,
        classe,
        assunto,
        relator: campo(card, 'Relator\\(a\\)'),
        comarca: campo(card, 'Comarca'),
        orgaoJulgador: campo(card, 'Órgão julgador'),
        dataJulgamento: campo(card, 'Data do julgamento'),
        dataPublicacao: campo(card, 'Data de publicação'),
        ementa,
        citacao,
        ocorrenciasInteiroTeor: mOcorr ? parseInt(mOcorr[1], 10) : null,
        uf: 'AL',
        tribunal: 'TJAL',
        // rotulado, não é permalink: o getArquivo.do exige reCAPTCHA
        inteiroTeorLink: null,
        inteiroTeorUrlBloqueada: TJALNavigator.urlDocumento(cdAcordao, cdForo),
        processoUrl: null,
      });
    }
    return out;
  }

  /**
   * Separa a ementa do rodapé de citação.
   *
   * ⚠️ **Quarto formato da família — não é o do TJMS, nem o do TJAC, nem o do
   * TJAM.** Aqui o parêntese abre por `Número do Processo:`:
   *
   *   `(Número do Processo: 0701284-29.2025.8.02.0055; Relator (a): Des. Carlos
   *    Cavalcanti de Albuquerque Filho; Comarca: Foro de Santana do Ipanema;
   *    Órgão julgador: 2ª Câmara Cível; Data do julgamento: 23/07/2026;
   *    Data de registro: 24/07/2026)`
   *
   * O regex do TJAC ancora em `\(\s*Relator\s*\(a\)` e não casa; o do TJAM
   * esperava a classe processual na abertura. Como no TJAM, "pegar o último
   * parêntese" também quebra, porque `Relator (a)` é um parêntese aninhado.
   *
   * A estratégia que sobrevive aos quatro formatos: achar `Data de registro:` —
   * o único campo que os quatro põem por último — e caminhar para trás contando
   * profundidade até o `(` que abre o grupo. Assim o prefixo pode mudar de novo
   * no quinto tribunal sem quebrar a extração.
   */
  static separarCitacao(texto) {
    const s = String(texto || '');
    const marcador = /Data de registro\s*:/i.exec(s);
    if (!marcador) return { ementa: s.trim(), citacao: '' };

    // para trás a partir do marcador, achando o '(' que abre o grupo
    let profundidade = 0;
    let inicio = -1;
    for (let i = marcador.index; i >= 0; i--) {
      if (s[i] === ')') profundidade++;
      else if (s[i] === '(') {
        if (profundidade === 0) { inicio = i; break; }
        profundidade--;
      }
    }
    if (inicio < 0) return { ementa: s.trim(), citacao: '' };

    // para frente, achando o ')' que fecha
    profundidade = 0;
    let fim = -1;
    for (let i = inicio; i < s.length; i++) {
      if (s[i] === '(') profundidade++;
      else if (s[i] === ')') {
        profundidade--;
        if (profundidade === 0) { fim = i; break; }
      }
    }
    if (fim < 0) return { ementa: s.trim(), citacao: '' };

    const bruto = s.slice(inicio + 1, fim).replace(/\s+/g, ' ').trim();
    return { ementa: s.slice(0, inicio).trim(), citacao: `TJAL. ${bruto}` };
  }
}

module.exports = TJALNavigator;
