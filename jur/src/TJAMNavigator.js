// src/TJAMNavigator.js

/**
 * Navigator do TJAM — cliente HTTP puro do e-SAJ `cjsg` (Consulta de
 * Jurisprudência do Segundo Grau):
 * https://consultasaj.tjam.jus.br/cjsg/consultaCompleta.do
 *
 * ⚠️ **O host é `consultasaj`, não `esaj`.** Medido em 05/08/2026:
 * `esaj.tjam.jus.br` resolve para o mesmo IP (179.127.124.18) mas devolve
 * **HTTP 404 com corpo vazio** na raiz. O nome canônico é `consultasaj`.
 *
 * **Sem browser para a busca.** Medido: a tela de consulta não carrega
 * `grecaptcha` (`typeof window.grecaptcha === "undefined"`), não tem `sitekey`
 * no HTML, e todos os requests da tela são estáticos do próprio host.
 *
 * ⚠️ **MAS O DOWNLOAD DO INTEIRO TEOR TEM reCAPTCHA**, como no TJAC. O bloqueio
 * é assimétrico: busca livre, `getArquivo.do` atrás de reCAPTCHA v2 — aqui com
 * sitekey PRÓPRIA (`6LcnC3cdAAAAABWUEy-SzR8kMrk3FA9llI6hU934`, diferente da do
 * TJAC). Ver `inteiroTeor()`.
 *
 * 🔴 **A BASE ESTÁ PARADA — é a ressalva mais importante deste tribunal.**
 * Medido em 05/08/2026 com `dano moral` na ementa, 2º grau, acórdãos, ano a ano
 * por data de julgamento:
 *
 *   2022: 4.398 | 2023: 7.543 | 2024: 9.023 | **2025: 62** | **2026: 0**
 *
 * e no corte mensal: 12/2024 = 1.027, 01/2025 = 36, 02/2025 = 18, 03/2025 = 5,
 * 06/2025 = 0, 12/2025 = 0. O mesmo despencamento aparece em `execução`
 * (1.746 → 22 → 0) e nos Colégios Recursais (36.264 → 1 → 0), então **não é
 * artefato da query**. O documento mais recente da base é de **publicação
 * 06/10/2025**. Não confunda isso com "não há jurisprudência recente no AM":
 * é a base que parou de ser alimentada. Reteste periódico obrigatório.
 *
 * O que este módulo cobre e o que NÃO cobre:
 *   - Só **2º grau** (Câmaras/Órgão Especial) e **Colégios Recursais** (o nome
 *     que o TJAM dá às Turmas Recursais), separados pelo checkbox
 *     `dados.origensSelecionadas` (T e R).
 *   - **Não tem 1º grau.** O módulo `cjpg` (sentenças) **não existe** neste
 *     tribunal: medido, `/cjpg/` responde 200 mas redireciona para a home do
 *     e-SAJ, sem formulário de busca.
 *   - **Não cobre o acervo do Projudi.** O TJAM roda ESAJ e Projudi em paralelo
 *     e a consulta pública do Projudi (`projudi-consulta.tjam.jus.br/publica/`)
 *     responde "Request Rejected" (WAF, 245 bytes). Não há módulo de
 *     jurisprudência do Projudi mapeável.
 *
 * Diferenças medidas contra os cjsg do TJMS e do TJAC — **não herde de nenhum
 * dos dois**:
 *   - **Página de 10**, não 20 (TJAC) nem 100 (TJMS). É a menor do repo.
 *   - **Acento NÃO importa** (como no TJAC, ao contrário do TJMS): `usucapiao`
 *     e `usucapião` = 340; `execucao`/`execução` = 21.431; `prisao`/`prisão` =
 *     11.025; `alimenticia`/`alimentícia` = 456.
 *   - **A aba `H` (Homologação de Acordo) EXISTE no formulário** — ao contrário
 *     do TJAC, onde nem o checkbox existe — **mas o acervo é zero** em todas as
 *     medições, nas duas origens. Aba real e vazia, não aba inexistente.
 *   - **As monocráticas são praticamente inexistentes**: `recurso` devolve
 *     472.094 acórdãos e **193** monocráticas. No TJAC elas são um acervo de
 *     verdade. Ver `TJAMCrawler.NOME_ABA`.
 *   - **Os Colégios Recursais são 7,7× o 2º grau** (252.381 × 32.755) — a
 *     inversão do TJAC (2,8×) levada ao extremo.
 *   - **O rodapé de citação começa pela CLASSE**: `(Apelação Cível Nº <CNJ>;
 *     Relator (a): …; Comarca: Manaus/AM; …)`. O regex do TJAC, que ancora em
 *     `\(\s*Relator`, não casa aqui.
 *   - **Total exato**, provado por aritmética: 32.755 = 3.275 páginas de 10 + 5
 *     na página 3.276 (a última, medida).
 *   - **Paginação estável** (3/3 idênticas) e `trocaDePagina.do` sem sessão dá
 *     **HTTP 404** — falha barulhenta, como no TJAC.
 */

const BASE = 'https://consultasaj.tjam.jus.br/cjsg';
const URL_CONSULTA = `${BASE}/consultaCompleta.do`;
const URL_RESULTADO = `${BASE}/resultadoCompleta.do`;
const URL_PAGINA = `${BASE}/trocaDePagina.do`;
const URL_ARQUIVO = `${BASE}/getArquivo.do`;

/** Campos que a tela envia sempre, mesmo vazios. Omitir muda o resultado. */
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

class TJAMNavigator {
  /**
   * `dados.origensSelecionadas` — a desambiguação Justiça Comum × Juizado.
   * Rótulos exatos da tela: `T` = "2° grau", `R` = "Colégios Recursais".
   *
   * ⚠️ Medido: `dano moral` na ementa dá 32.755 em T e **252.381** em R, e
   * T+R = 285.136 exatamente (o filtro não é ignorado). No Amazonas o Juizado
   * é **7,7× maior** que o 2º grau — o default `comum` esconde 89% do acervo.
   */
  static ORIGENS = { comum: 'T', turmas: 'R' };

  /**
   * `tipoDecisaoSelecionados` — as abas do resultado. As três existem no
   * formulário do TJAM (ao contrário do TJAC, que só tem A e D).
   *
   * ⚠️ Mas duas delas são praticamente vazias, e isso está medido:
   *   - `H` (Homologação de Acordo): **0** em T e em R, em toda medição.
   *   - `D` (Decisão Monocrática): 193 para `recurso` contra 472.094 acórdãos.
   * Zero na aba H aqui é acervo vazio de verdade, não aba inexistente.
   */
  static TIPOS = { acordao: 'A', homologacao: 'H', monocratica: 'D' };

  /** `dados.ordenarPor`. */
  static ORDENS = { publicacao: 'dtPublicacao', relevancia: 'relevancia' };

  /** `dados.buscaEmenta` × `dados.buscaInteiroTeor`. */
  static ESCOPOS = { ementa: 'dados.buscaEmenta', inteiroTeor: 'dados.buscaInteiroTeor' };

  /**
   * Medido: "Resultados 1 a 10 de 32755" e 10 cards por página. Não há combo
   * de tamanho de página. **É a menor página do repo** — TJAC usa 20, TJMS 100.
   * Herdar 20 daqui faria o crawler pular metade dos julgados em silêncio.
   */
  static POR_PAGINA = 10;

  static BASE = BASE;

  /** reCAPTCHA v2 que guarda o `getArquivo.do` — só o download, não a busca. */
  static SITEKEY_DOWNLOAD = '6LcnC3cdAAAAABWUEy-SzR8kMrk3FA9llI6hU934';

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

    const escopo = TJAMNavigator.ESCOPOS[filtros.escopo ?? 'ementa'];
    if (!escopo) throw new Error(`escopo inválido: "${filtros.escopo}" (use ementa ou inteiroTeor)`);
    campos[escopo] = filtros.query ?? '';

    if (filtros.processo) campos['dados.nuProcOrigem'] = filtros.processo;
    if (filtros.relator) campos.nmAgente = filtros.relator;
    if (filtros.dataJulgamentoInicio) campos['dados.dtJulgamentoInicio'] = filtros.dataJulgamentoInicio;
    if (filtros.dataJulgamentoFim) campos['dados.dtJulgamentoFim'] = filtros.dataJulgamentoFim;
    if (filtros.dataPublicacaoInicio) campos['dados.dtPublicacaoInicio'] = filtros.dataPublicacaoInicio;
    if (filtros.dataPublicacaoFim) campos['dados.dtPublicacaoFim'] = filtros.dataPublicacaoFim;
    if (filtros.sinonimos === false) campos['dados.pesquisarComSinonimos'] = 'N';
    campos['dados.ordenarPor'] = filtros.ordem ?? TJAMNavigator.ORDENS.publicacao;

    for (const [k, v] of Object.entries(campos)) p.append(k, v);
    for (const o of filtros.origens ?? ['T']) p.append('dados.origensSelecionadas', o);
    for (const t of filtros.tipos ?? ['A']) p.append('tipoDecisaoSelecionados', t);
    return p.toString();
  }

  /**
   * Executa a busca (página 1) e devolve totais por aba + os julgados.
   * A sessão criada aqui é o que permite paginar depois.
   *
   * ⚠️ **A busca com os dois campos de texto vazios devolve ZERO** (medido:
   * origens T, tipo A, sem termo → 0 cards, `totais` vazio, 66.785 bytes).
   * Não existe "listar tudo" neste portal.
   */
  async buscar(filtros = {}) {
    const res = await this._fetch(URL_RESULTADO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: TJAMNavigator.corpo(filtros),
    });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`cjsg respondeu HTTP ${res.status}`);
    // o trocaDePagina.do não identifica a busca: ele pagina a ÚLTIMA desta
    // sessão. Guardamos a assinatura para detectar paginação órfã em paginar().
    this.assinaturaUltimaBusca = TJAMNavigator.corpo(filtros);
    return { ...TJAMNavigator.parsear(html), status: res.status, html };
  }

  /**
   * Página N de uma aba. Depende da sessão da busca — medido: sem o JSESSIONID
   * o `trocaDePagina.do` do TJAM devolve **HTTP 404** (773 bytes), e não uma
   * página vazia com HTTP 200. A falha é barulhenta, como no TJAC.
   *
   * ⚠️ **`trocaDePagina.do` NÃO identifica a busca.** A URL só tem
   * `tipoDeDecisao` e `pagina` — o servidor pagina o **último resultado daquele
   * JSESSIONID**. Intercalar duas buscas no mesmo Navigator e paginar depois
   * devolveria as páginas da busca ERRADA, com HTTP 200 e cards válidos. O
   * `TJAMCrawler` sempre faz `buscar()` imediatamente antes de `paginar()`; o
   * parâmetro `assinaturaEsperada` deixa isso verificável em vez de convencionado.
   */
  async paginar(pagina, tipo = 'A', assinaturaEsperada = null) {
    if (!this.cookie) throw new Error('paginar() exige a sessão de buscar() — sem JSESSIONID o cjsg do TJAM devolve HTTP 404');
    if (assinaturaEsperada && this.assinaturaUltimaBusca !== assinaturaEsperada) {
      throw new Error('paginar() foi chamado depois de outra busca nesta mesma sessão: ' +
        'o trocaDePagina.do do TJAM pagina a ÚLTIMA busca do JSESSIONID, então isto ' +
        'devolveria páginas da busca errada com HTTP 200. Refaça buscar() antes de paginar.');
    }
    const res = await this._fetch(`${URL_PAGINA}?tipoDeDecisao=${tipo}&pagina=${pagina}`, { method: 'GET' });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`trocaDePagina.do respondeu HTTP ${res.status}`);
    return { ...TJAMNavigator.parsear(html), status: res.status, html };
  }

  /**
   * ⚠️ **BLOQUEADO POR reCAPTCHA.** Medido em 05/08/2026, **com e sem** a sessão
   * da busca (com um `cdAcordao` válido, 3363939): `getArquivo.do` devolve
   * HTTP 200 `text/html;charset=UTF-8` (~10,7 KB) com a tela "Para acessar o
   * conteúdo do Acórdão, por favor digite o código da figura no campo abaixo",
   * carregando o reCAPTCHA v2 com a sitekey `SITEKEY_DOWNLOAD`. **Nunca é PDF.**
   * A sessão da busca **não destrava** — foi medido em separado, e um não prova
   * o outro. Este repo não automatiza captcha.
   *
   * O método existe para medir o bloqueio de novo (é o que o `fixer` usa quando
   * alguém perguntar "ainda está travado?") e falha com mensagem explícita em
   * vez de gravar o HTML do captcha como se fosse o acórdão.
   *
   * A boa notícia: a **ementa íntegra já vem no HTML da busca**
   * (`div#textAreaDados_<cdAcordao>`) — medido, sem NENHUM XHR ao abrir o popup
   * "ementa sem formatação". Não se perde o texto analítico, só o relatório/voto.
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
          'inteiro teor do TJAM bloqueado por reCAPTCHA: o getArquivo.do devolve a tela ' +
          '"digite o código da figura", não o PDF. Este repo não resolve captcha. ' +
          'A ementa íntegra já veio na busca — use-a. Ver CLAUDE-TJAM.md.');
      }
      throw new Error(`getArquivo.do não devolveu PDF (${tipo}, ${buf.length} bytes)`);
    }
    return { url, buffer: buf, contentType: tipo, ehPdf, bytes: buf.length };
  }

  /**
   * ⚠️ **NÃO EXISTE PERMALINK NO TJAM.** Medido em aba limpa (contexto sem
   * cookies), 05/08/2026:
   *   - `resultadoCompleta.do` → HTTP 200 com o **formulário vazio**, 0 cards.
   *     A URL de resultado não é reutilizável: o estado da busca vive na sessão.
   *   - `getArquivo.do?cdAcordao=…&cdForo=…` → a tela do reCAPTCHA.
   *   - O popup "ementa sem formatação" é **modal e não muda a URL** (medido).
   *
   * Este método devolve a URL do `getArquivo.do` **rotulada como não-permalink**
   * para efeito de rastreio interno. **Nunca a apresente ao usuário como link de
   * citação** — a verificação de julgado do TJAM é por reconsulta (`-n <nº>`).
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
   * conferido contra o texto da tela ("Resultados 1 a 10 de 32755") e contra a
   * aritmética da última página (3.275 × 10 + 5 = 32.755). **Total exato**,
   * não saturado.
   *
   * ⚠️ `totais` VAZIO (`{}`) não é o mesmo que `{A: 0}`. O primeiro é a tela de
   * consulta devolvida de volta — no TJAM isso acontece quando o intervalo de
   * datas passa de 1 ano, e a página traz o aviso "A faixa entre data de inicio
   * e data de fim deve ser de no máximo 1 ano" (medido: 66.845 bytes com aviso,
   * contra 66.632 do zero genuíno, que traz `{A: 0}`). O `TJAMCrawler` distingue
   * os dois — sem isso, uma busca recusada vira "não há jurisprudência".
   */
  static parsear(html) {
    const totais = {};
    for (const m of html.matchAll(/id="totalResultadoAba-(\w)"[^>]*value="(\d+)"/g)) {
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
      resultados: TJAMNavigator.parsearCards(html, tipo),
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

      // A ementa "sem formatação" é a ÍNTEGRA e já vem no HTML da busca — medido:
      // abrir o popup não dispara NENHUM XHR. A do corpo do card vem truncada
      // (697 chars contra 2.877 da íntegra, no mesmo documento).
      const mSem = card.match(new RegExp(`<div id="textAreaDados_${cdAcordao}"[^>]*>([\\s\\S]*?)</div>`));
      const semFormatacao = mSem ? semTags(mSem[1]) : '';
      const { ementa, citacao } = TJAMNavigator.separarCitacao(semFormatacao);

      const classeAssunto = campo(card, 'Classe/Assunto');
      const [classe, assunto] = classeAssunto.includes('/')
        ? [classeAssunto.split('/')[0].trim(), classeAssunto.split('/').slice(1).join('/').trim()]
        : [classeAssunto, ''];

      const mOcorr = card.match(/\((\d+)\s+ocorr[êe]ncias?\s+encontradas?\s+no\s+inteiro\s+teor/i);

      out.push({
        id: cdAcordao,
        cdAcordao,
        cdForo,
        tipoDocumento: TJAMNavigator.NOME_TIPO[tipo] ?? 'Acórdão',
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
        uf: 'AM',
        tribunal: 'TJAM',
        // rotulado, não é permalink: o getArquivo.do exige reCAPTCHA
        inteiroTeorLink: null,
        inteiroTeorUrlBloqueada: TJAMNavigator.urlDocumento(cdAcordao, cdForo),
        processoUrl: null,
      });
    }
    return out;
  }

  /**
   * Separa a ementa do rodapé de citação.
   *
   * ⚠️ O formato do TJAM **não** é o do TJAC nem o do TJMS. Aqui o parêntese
   * abre pela **classe processual**, e o "Relator (a)" — que tem parênteses
   * dentro — vem só depois:
   *
   *   `(Apelação Cível Nº 0708349-62.2020.8.04.0001; Relator (a): Délcio Luís
   *    Santos; Comarca: Manaus/AM; Órgão julgador: Segunda Câmara Cível;
   *    Data do julgamento: 25/11/2024; Data de registro: 18/09/2025)`
   *
   * O regex do TJAC ancora em `\(\s*Relator\s*\(a\)` e **não casa nada aqui**.
   * Também não dá para pegar "o último parêntese": `Relator (a)` é um parêntese
   * aninhado. Então achamos `Data de registro:` e caminhamos para trás até o
   * `(` que abre o grupo, contando profundidade — assim o formato pode variar
   * de prefixo sem quebrar a extração.
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
    return { ementa: s.slice(0, inicio).trim(), citacao: `TJAM. ${bruto}` };
  }
}

module.exports = TJAMNavigator;
