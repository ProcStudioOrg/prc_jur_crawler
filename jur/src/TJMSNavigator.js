// src/TJMSNavigator.js

/**
 * Navigator do TJMS — cliente HTTP puro do e-SAJ `cjsg` (Consulta de
 * Jurisprudência do Segundo Grau):
 * https://esaj.tjms.jus.br/cjsg/consultaCompleta.do
 *
 * **Sem browser.** Medido em 04/08/2026: ao contrário do cjsg do TJCE e do
 * TJSP, o do TJMS **não tem reCAPTCHA** (nem v2 nem v3 — a página não carrega
 * `grecaptcha` e não há sitekey no HTML) e responde a POST direto.
 *
 * O que este módulo cobre e o que NÃO cobre:
 *   - Só **2º grau** (Câmaras/Seções/Órgão Especial) e **Turmas Recursais**,
 *     separados pelo checkbox `dados.origensSelecionadas` (T e R).
 *   - **Não tem 1º grau.** Sentenças ficam no `cjpg` (Julgados de 1º Grau),
 *     que é outro módulo e não está mapeado.
 *   - **Não cobre o acervo do e-Proc.** O TJMS começou a migrar para e-Proc em
 *     01/07/2026 (justiça comum e 2º grau) e o módulo de jurisprudência do
 *     e-Proc **não está habilitado**: medido em 04/08/2026,
 *     `eproc2g.tjms.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@
 *     jurisprudencia/pesquisar` devolve HTTP 200 com "Falha no processamento
 *     da solicitação". Ver CLAUDE-TJMS.md.
 *
 * Particularidades confirmadas na prática (04/08/2026):
 *   - **Charset UTF-8**, não ISO-8859-1. O e-SAJ clássico costuma ser latin-1;
 *     este responde `text/html; charset=utf-8` e aceita o corpo em UTF-8.
 *   - **Acento é obrigatório e não é normalizado**: `usucapiao` devolve 3
 *     resultados, `usucapião` devolve 3.885. Buscar sem acento não é "quase
 *     igual", é outra busca.
 *   - Total autoritativo: hidden `totalResultadoAba-<tipo>` na resposta —
 *     um por aba (A/H/D). O texto "Resultados 1 a N de M" é do topo da aba
 *     ativa e não serve quando há mais de um tipo selecionado.
 *   - Página fixa de **100** resultados; paginação por GET em
 *     `trocaDePagina.do?tipoDeDecisao=<A|H|D>&pagina=N`, que **exige o
 *     JSESSIONID** da busca (sem cookie devolve página vazia, HTTP 200).
 *   - Inteiro teor: `GET /cjsg/getArquivo.do?cdAcordao=<id>&cdForo=<foro>`
 *     devolve **PDF** (~300 KB) e **não exige sessão nem captcha**.
 *   - O identificador do documento é o **`cdAcordao`**, não o nº do processo:
 *     um mesmo processo aparece como acórdão E como monocrática.
 */

const BASE = 'https://esaj.tjms.jus.br/cjsg';
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
    .replace(/&amp;/gi, '&');

const semTags = (html) =>
  decodeEntidades(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Pega o conteúdo de uma linha `<strong>Rótulo:</strong> valor` do card. */
function campo(cardHtml, rotulo) {
  const re = new RegExp(`<strong>\\s*${rotulo}\\s*:?\\s*</strong>([\\s\\S]*?)</td>`, 'i');
  const m = cardHtml.match(re);
  return m ? semTags(m[1]) : '';
}

class TJMSNavigator {
  /** `dados.origensSelecionadas` — a desambiguação Justiça Comum × Juizado. */
  static ORIGENS = { comum: 'T', turmas: 'R' };
  /** `tipoDecisaoSelecionados` — as abas do resultado. */
  static TIPOS = { acordao: 'A', homologacao: 'H', monocratica: 'D' };
  /** `dados.ordenarPor`. */
  static ORDENS = { publicacao: 'dtPublicacao', relevancia: 'relevancia' };
  /** `dados.buscaEmenta` × `dados.buscaInteiroTeor`. */
  static ESCOPOS = { ementa: 'dados.buscaEmenta', inteiroTeor: 'dados.buscaInteiroTeor' };
  /** A página do cjsg é fixa em 100 itens — não há combo para mudar. */
  static POR_PAGINA = 100;
  static BASE = BASE;

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

    const escopo = TJMSNavigator.ESCOPOS[filtros.escopo ?? 'ementa'];
    if (!escopo) throw new Error(`escopo inválido: "${filtros.escopo}" (use ementa ou inteiroTeor)`);
    campos[escopo] = filtros.query ?? '';

    if (filtros.processo) campos['dados.nuProcOrigem'] = filtros.processo;
    if (filtros.relator) campos.nmAgente = filtros.relator;
    if (filtros.dataJulgamentoInicio) campos['dados.dtJulgamentoInicio'] = filtros.dataJulgamentoInicio;
    if (filtros.dataJulgamentoFim) campos['dados.dtJulgamentoFim'] = filtros.dataJulgamentoFim;
    if (filtros.dataPublicacaoInicio) campos['dados.dtPublicacaoInicio'] = filtros.dataPublicacaoInicio;
    if (filtros.dataPublicacaoFim) campos['dados.dtPublicacaoFim'] = filtros.dataPublicacaoFim;
    if (filtros.sinonimos === false) campos['dados.pesquisarComSinonimos'] = 'N';
    campos['dados.ordenarPor'] = filtros.ordem ?? TJMSNavigator.ORDENS.publicacao;

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
      body: TJMSNavigator.corpo(filtros),
    });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`cjsg respondeu HTTP ${res.status}`);
    return { ...TJMSNavigator.parsear(html), status: res.status, html };
  }

  /**
   * Página N de uma aba. **Depende da sessão da busca** — chamar sem o
   * JSESSIONID devolve HTTP 200 com zero resultados, que se lê como
   * "acabaram os julgados" e não é.
   */
  async paginar(pagina, tipo = 'A') {
    if (!this.cookie) throw new Error('paginar() exige a sessão de buscar() — sem JSESSIONID o cjsg devolve página vazia');
    const res = await this._fetch(`${URL_PAGINA}?tipoDeDecisao=${tipo}&pagina=${pagina}`, { method: 'GET' });
    const html = await res.text();
    return { ...TJMSNavigator.parsear(html), status: res.status, html };
  }

  /** Baixa o inteiro teor (PDF). Não exige sessão. */
  async inteiroTeor(cdAcordao, cdForo = '0') {
    const url = `${URL_ARQUIVO}?cdAcordao=${encodeURIComponent(cdAcordao)}&cdForo=${encodeURIComponent(cdForo)}`;
    const res = await this._fetch(url, { method: 'GET' });
    const buf = Buffer.from(await res.arrayBuffer());
    const tipo = res.headers.get('content-type') || '';
    if (res.status !== 200) throw new Error(`getArquivo.do respondeu HTTP ${res.status}`);
    const ehPdf = buf.slice(0, 5).toString('latin1') === '%PDF-';
    return { url, buffer: buf, contentType: tipo, ehPdf, bytes: buf.length };
  }

  /** Permalink por documento — o próprio getArquivo.do, que abre sem sessão. */
  static permalink(cdAcordao, cdForo = '0') {
    return `${URL_ARQUIVO}?cdAcordao=${cdAcordao}&cdForo=${cdForo}`;
  }

  // ----------------------------------------------------------------- parsing

  /** Rótulo humano de cada aba `tipoDecisaoSelecionados`. */
  static NOME_TIPO = { A: 'Acórdão', H: 'Homologação de Acordo', D: 'Decisão Monocrática' };

  /** Lê os totais por aba e os cards de uma resposta do cjsg. */
  static parsear(html) {
    const totais = {};
    for (const m of html.matchAll(/id="totalResultadoAba-(\w)"[^>]*value="(\d+)"/g)) {
      totais[m[1]] = parseInt(m[2], 10);
    }
    const total = Object.values(totais).reduce((a, b) => a + b, 0);
    // a aba que de fato trouxe cards é a do container `divDadosResultado-<tipo>`;
    // sem isso toda monocrática sairia rotulada como acórdão
    const mAba = html.match(/id="divDadosResultado-(\w)"/);
    const tipo = mAba ? mAba[1]
      : (Object.entries(totais).find(([, n]) => n > 0) || [])[0] || 'A';
    return { totais, total, tipo, resultados: TJMSNavigator.parsearCards(html, tipo) };
  }

  /**
   * Cada julgado é um `<tr class="fundocinza1">`. O `cdacordao` do link de
   * download é o identificador do documento.
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

      // a ementa "sem formatação" é a íntegra; a do corpo vem com <em> de highlight
      const mSem = card.match(new RegExp(`<div id="textAreaDados_${cdAcordao}"[^>]*>([\\s\\S]*?)</div>`));
      const semFormatacao = mSem ? semTags(mSem[1]) : '';
      // O rodapé "(TJMS. Classe n. X, Comarca, Órgão, Relator, j:, p:)" é a citação
      // oficial. Cuidado: no HTML a sigla vem em <b>, então depois do semTags o
      // texto é "( TJMS . …" — casar com "\(TJMS\." não pega nada.
      const RE_CITACAO = /\(\s*TJMS\s*\.\s*([\s\S]*?)\)\s*$/;
      const mCit = semFormatacao.match(RE_CITACAO);
      const citacao = mCit ? `TJMS. ${mCit[1].replace(/\s+/g, ' ').trim()}` : '';
      const ementa = citacao ? semFormatacao.replace(RE_CITACAO, '').trim() : semFormatacao;

      const classeAssunto = campo(card, 'Classe/Assunto');
      const [classe, assunto] = classeAssunto.includes('/')
        ? [classeAssunto.split('/')[0].trim(), classeAssunto.split('/').slice(1).join('/').trim()]
        : [classeAssunto, ''];

      const mOcorr = card.match(/\((\d+)\s+ocorr[êe]ncias?\s+encontradas?\s+no\s+inteiro\s+teor/i);

      out.push({
        id: cdAcordao,
        cdAcordao,
        cdForo,
        tipoDocumento: TJMSNavigator.NOME_TIPO[tipo] ?? 'Acórdão',
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
        uf: 'MS',
        tribunal: 'TJMS',
        inteiroTeorLink: TJMSNavigator.permalink(cdAcordao, cdForo),
        processoUrl: TJMSNavigator.permalink(cdAcordao, cdForo),
      });
    }
    return out;
  }
}

module.exports = TJMSNavigator;
