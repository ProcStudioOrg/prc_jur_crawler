// src/TJACNavigator.js

/**
 * Navigator do TJAC — cliente HTTP puro do e-SAJ `cjsg` (Consulta de
 * Jurisprudência do Segundo Grau):
 * https://esaj.tjac.jus.br/cjsg/consultaCompleta.do
 *
 * **Sem browser para a busca.** Medido em 04/08/2026: a tela de consulta não
 * carrega `grecaptcha` e não tem sitekey — o POST direto responde.
 *
 * ⚠️ **MAS O DOWNLOAD DO INTEIRO TEOR TEM reCAPTCHA.** O bloqueio é
 * assimétrico: busca livre, `getArquivo.do` atrás de reCAPTCHA v2
 * (sitekey `6LevDTsUAAAAAN6dsn77RReaDKhYAQrOVkTUOgOD`). Ver `inteiroTeor()`.
 *
 * O que este módulo cobre e o que NÃO cobre:
 *   - Só **2º grau** (Câmaras/Órgão Especial) e **Turmas Recursais**,
 *     separados pelo checkbox `dados.origensSelecionadas` (T e R).
 *   - **Não tem 1º grau.** Sentenças ficam no `cjpg`, outro módulo.
 *   - **Não cobre o acervo do e-Proc.** O TJAC roda ESAJ e e-Proc em paralelo
 *     e o módulo de jurisprudência do e-Proc **não está habilitado**: medido em
 *     04/08/2026, `eproc{1,2}g.tjac.jus.br/eproc/externo_controlador.php?acao=
 *     jurisprudencia@jurisprudencia/pesquisar` devolve HTTP 200 com "Falha no
 *     processamento da solicitação", e o menu público não tem o item.
 *
 * Diferenças medidas contra o cjsg do TJMS — **não herde as suposições de lá**:
 *   - **Página de 20**, não de 100.
 *   - **Acento NÃO importa**: `usucapiao`=334 e `usucapião`=334; `execucao` e
 *     `execução`=11.078; `prisao` e `prisão`=7.949. O índice normaliza. É o
 *     oposto do TJMS, onde acento muda a busca por ordem de grandeza.
 *   - **Só duas abas de tipo**: `A` (acórdão) e `D` (monocrática). Não há `H`.
 *   - **Paginação estável** (3/3 idênticas) e `trocaDePagina.do` sem sessão
 *     devolve **HTTP 404**, não página vazia — falha barulhenta, não silenciosa.
 *   - **Total exato**, não saturado: 7.649 = 382 páginas de 20 + 9 na última.
 *   - **Formato da citação é outro**: `(Relator (a): …; Comarca: …; Número do
 *     Processo:…; Órgão julgador: …; Data do julgamento: …; Data de registro: …)`,
 *     sem a sigla do tribunal. O regex do TJMS não casa aqui.
 */

const BASE = 'https://esaj.tjac.jus.br/cjsg';
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
    // `&sect;` aparece de verdade nas ementas do TJAC ("CPC, arts. 509, &sect; 2º")
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

class TJACNavigator {
  /** `dados.origensSelecionadas` — a desambiguação Justiça Comum × Juizado. */
  static ORIGENS = { comum: 'T', turmas: 'R' };
  /**
   * `tipoDecisaoSelecionados` — as abas do resultado.
   * ⚠️ Só existem duas no TJAC. Enviar `H` (a "Homologação de Acordo" do TJMS)
   * responde `totalResultadoAba-H = 0` — não é acervo vazio, é aba inexistente.
   */
  static TIPOS = { acordao: 'A', monocratica: 'D' };
  /** `dados.ordenarPor`. */
  static ORDENS = { publicacao: 'dtPublicacao', relevancia: 'relevancia' };
  /** `dados.buscaEmenta` × `dados.buscaInteiroTeor`. */
  static ESCOPOS = { ementa: 'dados.buscaEmenta', inteiroTeor: 'dados.buscaInteiroTeor' };
  /** Medido: "Resultados 1 a 20 de 7649" e 20 cards por página. Não há combo. */
  static POR_PAGINA = 20;
  static BASE = BASE;
  /** reCAPTCHA v2 que guarda o `getArquivo.do` — só o download, não a busca. */
  static SITEKEY_DOWNLOAD = '6LevDTsUAAAAAN6dsn77RReaDKhYAQrOVkTUOgOD';

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

    const escopo = TJACNavigator.ESCOPOS[filtros.escopo ?? 'ementa'];
    if (!escopo) throw new Error(`escopo inválido: "${filtros.escopo}" (use ementa ou inteiroTeor)`);
    campos[escopo] = filtros.query ?? '';

    if (filtros.processo) campos['dados.nuProcOrigem'] = filtros.processo;
    if (filtros.relator) campos.nmAgente = filtros.relator;
    if (filtros.dataJulgamentoInicio) campos['dados.dtJulgamentoInicio'] = filtros.dataJulgamentoInicio;
    if (filtros.dataJulgamentoFim) campos['dados.dtJulgamentoFim'] = filtros.dataJulgamentoFim;
    if (filtros.dataPublicacaoInicio) campos['dados.dtPublicacaoInicio'] = filtros.dataPublicacaoInicio;
    if (filtros.dataPublicacaoFim) campos['dados.dtPublicacaoFim'] = filtros.dataPublicacaoFim;
    if (filtros.sinonimos === false) campos['dados.pesquisarComSinonimos'] = 'N';
    campos['dados.ordenarPor'] = filtros.ordem ?? TJACNavigator.ORDENS.publicacao;

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
      body: TJACNavigator.corpo(filtros),
    });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`cjsg respondeu HTTP ${res.status}`);
    // o trocaDePagina.do não identifica a busca: ele pagina a ÚLTIMA desta
    // sessão. Guardamos a assinatura para detectar paginação órfã em paginar().
    this.assinaturaUltimaBusca = TJACNavigator.corpo(filtros);
    return { ...TJACNavigator.parsear(html), status: res.status, html };
  }

  /**
   * Página N de uma aba. Depende da sessão da busca — mas aqui, ao contrário do
   * TJMS, chamar sem o JSESSIONID devolve **HTTP 404**, e não uma página vazia
   * com HTTP 200. A falha é barulhenta; ainda assim exigimos o cookie.
   *
   * ⚠️ **`trocaDePagina.do` NÃO identifica a busca.** A URL só tem
   * `tipoDeDecisao` e `pagina` — o servidor pagina o **último resultado daquele
   * JSESSIONID**. Medido em 04/08/2026, na mesma sessão:
   *
   *   buscar("dano moral") -> paginar(2) -> processo 0700714-76.2023.8.01.0011
   *   buscar("usucapião")  -> paginar(2) -> processo 0700133-73.2023.8.01.0007
   *
   * Ou seja: intercalar duas buscas no mesmo Navigator e paginar depois devolve
   * as páginas da busca ERRADA, com HTTP 200 e cards perfeitamente válidos. É o
   * tipo de bug que não aparece em teste feliz. O `TJACCrawler` sempre faz
   * `buscar()` imediatamente antes de `paginar()` na mesma janela; o parâmetro
   * `assinaturaEsperada` deixa isso verificável em vez de convencionado.
   */
  async paginar(pagina, tipo = 'A', assinaturaEsperada = null) {
    if (!this.cookie) throw new Error('paginar() exige a sessão de buscar() — sem JSESSIONID o cjsg do TJAC devolve HTTP 404');
    if (assinaturaEsperada && this.assinaturaUltimaBusca !== assinaturaEsperada) {
      throw new Error('paginar() foi chamado depois de outra busca nesta mesma sessão: ' +
        'o trocaDePagina.do do TJAC pagina a ÚLTIMA busca do JSESSIONID, então isto ' +
        'devolveria páginas da busca errada com HTTP 200. Refaça buscar() antes de paginar.');
    }
    const res = await this._fetch(`${URL_PAGINA}?tipoDeDecisao=${tipo}&pagina=${pagina}`, { method: 'GET' });
    const html = await res.text();
    if (res.status !== 200) throw new Error(`trocaDePagina.do respondeu HTTP ${res.status}`);
    return { ...TJACNavigator.parsear(html), status: res.status, html };
  }

  /**
   * ⚠️ **BLOQUEADO POR reCAPTCHA.** Medido em 04/08/2026, com e sem a sessão da
   * busca: `getArquivo.do` devolve HTTP 200 `text/html` (~10,7 KB) com a tela
   * "Para acessar o conteúdo do Acórdão, por favor digite o código da figura no
   * campo abaixo. Esta validação lhe dará acesso para visualizar 20 resultados",
   * carregando `https://www.google.com/recaptcha/api.js` e um `uuidCaptcha`
   * vazio. **Nunca é PDF.** Este repo não automatiza captcha.
   *
   * O método existe para medir o bloqueio de novo (é o que o `fixer` usa quando
   * alguém perguntar "ainda está travado?") e falha com mensagem explícita em
   * vez de gravar o HTML do captcha como se fosse o acórdão.
   *
   * A boa notícia: a **ementa íntegra já vem no HTML da busca**
   * (`div#textAreaDados_<cdAcordao>`), então não se perde o texto analítico —
   * só o relatório/voto completos. Ver CLAUDE-TJAC.md.
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
          'inteiro teor do TJAC bloqueado por reCAPTCHA: o getArquivo.do devolve a tela ' +
          '"digite o código da figura", não o PDF. Este repo não resolve captcha. ' +
          'A ementa íntegra já veio na busca — use-a. Ver CLAUDE-TJAC.md.');
      }
      throw new Error(`getArquivo.do não devolveu PDF (${tipo}, ${buf.length} bytes)`);
    }
    return { url, buffer: buf, contentType: tipo, ehPdf, bytes: buf.length };
  }

  /**
   * ⚠️ **NÃO EXISTE PERMALINK NO TJAC.** O único candidato é o `getArquivo.do`,
   * e ele está atrás do reCAPTCHA (acima): colado numa aba limpa devolve a tela
   * do captcha, não o documento. O popup "ementa sem formatação" é um modal e
   * não tem URL própria (medido: a URL não muda ao abri-lo).
   *
   * Este método devolve a URL do `getArquivo.do` **rotulada como não-permalink**
   * para efeito de rastreio interno. **Nunca a apresente ao usuário como link de
   * citação** — a verificação de julgado do TJAC é por reconsulta (`-n <nº>`).
   */
  static urlDocumento(cdAcordao, cdForo = '0') {
    return `${URL_ARQUIVO}?cdAcordao=${cdAcordao}&cdForo=${cdForo}`;
  }

  // ----------------------------------------------------------------- parsing

  /** Rótulo humano de cada aba `tipoDecisaoSelecionados`. */
  static NOME_TIPO = { A: 'Acórdão', D: 'Decisão Monocrática' };

  /**
   * Lê os totais por aba e os cards de uma resposta do cjsg.
   *
   * ⚠️ `totais` VAZIO (`{}`) não é o mesmo que `{A: 0}`. O primeiro é a tela de
   * consulta devolvida de volta — no TJAC isso acontece quando o intervalo de
   * datas passa de 1 ano, e a página traz o aviso "A faixa entre data de inicio
   * e data de fim deve ser de no máximo 1 ano". O segundo é busca válida com
   * zero julgados. O `TJACCrawler` distingue os dois.
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
      resultados: TJACNavigator.parsearCards(html, tipo),
    };
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

      // A ementa "sem formatação" é a ÍNTEGRA e já vem no HTML da busca — não há
      // request para "expandir ementa" (o "+" do card é toggle de CSS).
      // A do corpo do card vem truncada e com <em> de highlight.
      const mSem = card.match(new RegExp(`<div id="textAreaDados_${cdAcordao}"[^>]*>([\\s\\S]*?)</div>`));
      const semFormatacao = mSem ? semTags(mSem[1]) : '';
      const { ementa, citacao } = TJACNavigator.separarCitacao(semFormatacao);

      const classeAssunto = campo(card, 'Classe/Assunto');
      const [classe, assunto] = classeAssunto.includes('/')
        ? [classeAssunto.split('/')[0].trim(), classeAssunto.split('/').slice(1).join('/').trim()]
        : [classeAssunto, ''];

      const mOcorr = card.match(/\((\d+)\s+ocorr[êe]ncias?\s+encontradas?\s+no\s+inteiro\s+teor/i);

      out.push({
        id: cdAcordao,
        cdAcordao,
        cdForo,
        tipoDocumento: TJACNavigator.NOME_TIPO[tipo] ?? 'Acórdão',
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
        uf: 'AC',
        tribunal: 'TJAC',
        // rotulado, não é permalink: o getArquivo.do exige reCAPTCHA
        inteiroTeorLink: null,
        inteiroTeorUrlBloqueada: TJACNavigator.urlDocumento(cdAcordao, cdForo),
        processoUrl: null,
      });
    }
    return out;
  }

  /**
   * Separa a ementa do rodapé de citação.
   *
   * ⚠️ O formato do TJAC **não** é o do TJMS. Aqui não há sigla do tribunal:
   *   `(Relator (a): Des. Lois Arruda; Comarca: Rio Branco;Número do
   *    Processo:0714244-12.2025.8.01.0001;Órgão julgador:  Primeira Câmara
   *    Cível;Data do julgamento: 30/07/2026; Data de registro: 31/07/2026)`
   * e depois do parêntese ainda vem um sufixo de origem (`Cível  2ª Vara Cível`).
   * Casar com `\(TJMS\.` — ou exigir que o parêntese seja o fim da string — não
   * pega nada.
   */
  static separarCitacao(texto) {
    const RE = /\(\s*Relator\s*\(a\)\s*:[\s\S]*?Data de registro\s*:[^)]*\)/i;
    const m = String(texto || '').match(RE);
    if (!m) return { ementa: String(texto || '').trim(), citacao: '' };
    const citacao = `TJAC. ${m[0].replace(/^\(|\)$/g, '').replace(/\s+/g, ' ').trim()}`;
    const ementa = texto.slice(0, m.index).trim();
    return { ementa, citacao };
  }
}

module.exports = TJACNavigator;
