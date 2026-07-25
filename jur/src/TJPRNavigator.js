// src/TJPRNavigator.js
const path = require('path');

/**
 * Navigator do TJPR — cliente HTTP puro do módulo público de jurisprudência
 * (https://portal.tjpr.jus.br/jurisprudencia/).
 *
 * NÃO usa browser. O formulário é um Struts clássico (`pesquisa.do`) e responde
 * a um POST direto. Mapeamento: `human-codegen/TJPR/01-jurisprudencia/`.
 *
 * Três coisas que quebram quem tenta falar com este site "no automático":
 *
 *  1. **O corpo do POST é ISO-8859-1** (`accept-charset="ISO-8859-1"` no <form>).
 *     Mandar UTF-8 não dá erro: o servidor lê `usucapião` como `usucapiÃ£o`,
 *     devolve "Nenhum registro encontrado!" e o crawler conclui que não há
 *     jurisprudência. Por isso `encodeLatin1()` existe.
 *  2. **Toda busca vem contaminada por decisões da Corte IDH** (Corte
 *     Interamericana de Direitos Humanos), que não são jurisprudência do
 *     Paraná. Elas entram na MESMA tabela, com `class="... cidh"`, e são
 *     somadas no contador geral. `totais.tj` é o número que importa.
 *  3. **O combo "BASE DE CONSULTA" (`ambito`) NÃO separa Juizados de Justiça
 *     Comum de forma confiável** — ver `foro()` e o doc `CLAUDE-TJPR.md`.
 *
 * Respostas de `pesquisa.do` vêm em UTF-8; as de `ajax.do`, em ISO-8859-1.
 */

const BASE = 'https://portal.tjpr.jus.br';
const URL_INICIAR = `${BASE}/jurisprudencia/publico/pesquisa.do?actionType=iniciar`;
const URL_PESQUISAR = `${BASE}/jurisprudencia/publico/pesquisa.do?actionType=pesquisar`;

/** Órgãos julgadores do acervo, com id e volume — extraídos da faceta "Orgão Julgador". */
let ORGAOS = [];
try {
  ORGAOS = require(path.join(__dirname, '..', 'human-codegen', 'TJPR', '01-jurisprudencia', '06-orgaos.json'));
} catch {
  ORGAOS = [];
}

/**
 * Um órgão é do sistema dos Juizados Especiais quando o nome bate aqui.
 * No TJPR os Juizados de 2º grau aparecem como "Nª Turma Recursal",
 * "Turma Recursal Única", "Turma Recursal Suplementar", "Turma Recursal
 * Reunida", "Núcleo de Conciliação - Turmas Recursais" e as
 * "Turmas de Uniformização de Jurisprudência" (que uniformizam a
 * jurisprudência das próprias Turmas Recursais).
 */
const RE_JUIZADOS = /turma\s+recursal|turmas\s+recursais|turma\s+de\s+uniformiza|juizado|col[ée]gio\s+recursal/i;

/** Rede de segurança: ids das Turmas Recursais, caso o JSON do mapeamento suma. */
const IDS_JUIZADOS_FALLBACK = [240, 248, 249, 283, 284, 338, 339, 347, 348, 349, 350, 351, 354, 355, 356, 358, 359];

/** Percent-encoding sobre bytes ISO-8859-1 (o que o <form> declara aceitar). */
function encodeLatin1(valor) {
  const texto = String(valor ?? '');
  const buf = Buffer.from(texto, 'latin1');
  let out = '';
  for (const b of buf) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.!~*'()]/.test(c)) out += c;
    else if (c === ' ') out += '+';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

const decodeEntidades = (s) =>
  String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&acirc;/gi, 'â')
    .replace(/&ecirc;/gi, 'ê').replace(/&ocirc;/gi, 'ô').replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ').replace(/&ccedil;/gi, 'ç').replace(/&Aacute;/g, 'Á')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&ordf;/gi, 'ª')
    .replace(/&ordm;/gi, 'º').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const semTags = (html) => decodeEntidades(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

class TJPRNavigator {
  /** Combo "BASE DE CONSULTA" (`ambito`) — os valores nativos da tela. */
  static AMBITOS = { todas: '-1', turmas: '4', tj: '6', vice: '7', cidh: '8' };
  /** Combo "TIPO DE DECISÃO" (`idsTipoDecisaoSelecionados`). */
  static TIPOS = { todas: '-1', acordao: '1', monocratica: '2', duvida: '3', sentencaIdh: '4', opiniaoIdh: '5' };
  /** Combo "EMENTA/INTEIRO TEOR" (`idLocalPesquisa`) — onde o termo é procurado. */
  static ESCOPOS = { ementa: '1', inteiroTeor: '2', ambas: '99' };
  /** Combo "SEGREDO DE JUSTIÇA" (`segredoJustica`). */
  static SEGREDO = { incluir: 'pesquisar com', excluir: 'pesquisar sem', somente: 'somente' };
  /** 40 julgados do TJ por página (as outras 10 linhas da página são da Corte IDH). */
  static POR_PAGINA = 40;

  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.cookie = null;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  }

  // ------------------------------------------------------------------ sessão

  /** Abre a tela de pesquisa só para pegar o JSESSIONID. Idempotente. */
  async iniciar() {
    if (this.cookie) return this.cookie;
    const res = await this._fetch(URL_INICIAR, { method: 'GET' });
    await res.text();
    return this.cookie;
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

  // ------------------------------------------------------------------ busca

  /**
   * Monta o corpo do POST a partir de filtros já normalizados.
   * Só campos com valor entram — o Struts trata ausente como "sem filtro".
   */
  static montarFormulario(f = {}) {
    const campos = {
      criterioPesquisa: f.query ?? '',
      idLocalPesquisa: f.escopo ?? TJPRNavigator.ESCOPOS.ementa,
      ambito: f.ambito ?? TJPRNavigator.AMBITOS.todas,
      idsTipoDecisaoSelecionados: f.tipo ?? TJPRNavigator.TIPOS.todas,
      segredoJustica: f.segredo ?? TJPRNavigator.SEGREDO.incluir,
      dataJulgamentoInicio: f.dataJulgamentoInicio ?? '',
      dataJulgamentoFim: f.dataJulgamentoFim ?? '',
      dataPublicacaoInicio: f.dataPublicacaoInicio ?? '',
      dataPublicacaoFim: f.dataPublicacaoFim ?? '',
      processo: f.processo ?? '',
      acordao: f.acordao ?? '',
      idOrgaoJulgador: f.idOrgaoJulgador ?? '',
      idRelator: f.idRelator ?? '',
      nomeRelator: f.nomeRelator ?? '',
      idComarca: f.idComarca ?? '',
      idClasseProcessual: f.idClasseProcessual ?? '',
      idAssunto: f.idAssunto ?? '',
      pageNumber: String(f.pagina ?? 1),
      sortColumn: 'processo_sDataJulgamento',
      sortOrder: f.ordem === 'antigos' ? 'ASC' : 'DESC',
      iniciar: 'Pesquisar',
    };
    if (f.mostrarCompleto) campos.mostrarCompleto = 'true';
    return Object.entries(campos)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${encodeLatin1(v)}`)
      .join('&');
  }

  /**
   * Executa uma busca e devolve o HTML + os totais + os julgados da página.
   * @returns {{html:string, totais:{tj:number,cidh:number,geral:number},
   *            paginas:number, pagina:number, resultados:Array<Object>}}
   */
  async buscar(filtros = {}) {
    await this.iniciar();
    const body = TJPRNavigator.montarFormulario(filtros);
    const res = await this._fetch(URL_PESQUISAR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`TJPR respondeu HTTP ${res.status}`);
    const html = await res.text();
    return {
      html,
      body,
      totais: TJPRNavigator.totais(html),
      paginas: TJPRNavigator.ultimaPagina(html),
      pagina: Number(filtros.pagina ?? 1),
      resultados: TJPRNavigator.parseResultados(html),
    };
  }

  // ----------------------------------------------------------------- parsing

  /**
   * Contadores da tela. O contador GERAL soma Corte IDH — nunca use como
   * "quantos julgados do TJPR existem"; use `tj`.
   */
  static totais(html) {
    const num = (re) => {
      const m = html.match(re);
      return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
    };
    const geral = num(/([\d.]+)\s*registro\(s\)\s*encontrado\(s\)/);
    const tj = num(/([\d.]+)\s*registro\(s\)\s*da\s*Jurisprud[êe]ncia do Tribunal de Justi[çc]a/);
    const cidh = num(/([\d.]+)\s*registro\(s\)\s*da\s*Corte IDH/);
    return {
      geral: geral ?? 0,
      // quando o filtro exclui a Corte IDH o site mostra só o contador geral
      tj: tj ?? (cidh === null ? geral ?? 0 : (geral ?? 0) - cidh),
      cidh: cidh ?? 0,
    };
  }

  /** Nº da última página segundo o navegador de páginas do rodapé. */
  static ultimaPagina(html) {
    const m = html.match(/arrowLastOn[\s\S]{0,200}?pageNumber'\]\.value='(\d+)'/);
    if (m) return parseInt(m[1], 10);
    return html.includes('arrowNextOn') ? 2 : 1;
  }

  static temProximaPagina(html) {
    return /class="arrowNextOn"/.test(html);
  }

  /** Classifica um órgão julgador em `juizados` | `comum`. */
  static foro(orgaoJulgador) {
    if (!orgaoJulgador) return 'indefinido';
    return RE_JUIZADOS.test(orgaoJulgador) ? 'juizados' : 'comum';
  }

  /**
   * Extrai os julgados do TJPR da tabela de resultados.
   * Linhas `<tr class="... cidh">` (Corte IDH) são DESCARTADAS de propósito.
   */
  static parseResultados(html) {
    const tabela = html.match(/<table[^>]*class="[^"]*resultTable jurisprudencia[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tabela) return [];
    const linhas = tabela[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const out = [];

    for (const tr of linhas) {
      if (/<tr[^>]*class="[^"]*\bcidh\b/i.test(tr)) continue;      // Corte IDH: fora
      if (!/juris-tabela-dados/.test(tr)) continue;                 // cabeçalho/ruído

      const id = (tr.match(/name="idsSelecionados"\s+value="(\d+)"/) || [])[1] || '';
      const href = (tr.match(/href="(\/jurisprudencia\/j\/[^"]+)"/) || [])[1] || '';
      const processoUrl = href ? BASE + href : (id ? `${BASE}/jurisprudencia/j/${id}/documento` : '');

      const props = (tr.match(/<div class="juris-tabela-propriedades">([\s\S]*?)<\/div>\s*<\/td>/i) ||
                     tr.match(/<div class="juris-tabela-propriedades">([\s\S]*?)$/i) || [])[1] || tr;
      const texto = semTags(props);

      const numeroProcesso =
        (texto.match(/Processo:\s*([\d.\-/]{10,30})/) || [])[1] ||
        (semTags((tr.match(/class="(?:acordao|decisao|monocratica)[^"]*negrito"[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '')
          .match(/[\d.\-/]{10,30}/) || [])[0] || '';

      const tipoDocumento = (texto.match(/\(([^)]{3,40})\)/) || [])[1] || '';
      const relatorBloco = (props.match(/Relator:\s*([\s\S]*?)(?:<br|<\/div|Processo:)/i) || [])[1] || '';
      const relator = semTags(relatorBloco.replace(/<i>[\s\S]*?<\/i>/i, '')).replace(/\s*\|\s*$/, '').trim();
      const cargoRelator = semTags((relatorBloco.match(/<i>([\s\S]*?)<\/i>/i) || [])[1] || '');
      const orgaoJulgador = (texto.match(/Órgão Julgador:\s*(.+?)(?:\s*Data (?:do )?Julgamento|$)/) || [])[1]?.trim() || '';
      const dataJulgamento = (texto.match(/Data (?:do )?Julgamento:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';
      const dataPublicacao = (texto.match(/(?:Data da )?Publica[çc][ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';

      let ementa = '';
      const celulaEmenta = (tr.match(/<td[^>]*class="juris-tabela-ementa"[^>]*>([\s\S]*?)<\/td>/i) || [])[1] || '';
      const divEmenta = (celulaEmenta.match(/<div id="ementa\d+">([\s\S]*?)<\/div>/i) || [])[1];
      ementa = semTags(divEmenta ?? celulaEmenta).replace(/\s*Leia mais\.\.\s*$/, '').trim();

      if (!id && !numeroProcesso) continue;
      out.push({
        id,
        tipoDocumento,
        numeroProcesso,
        processoUrl,
        inteiroTeorLink: processoUrl,
        orgaoJulgador,
        foro: TJPRNavigator.foro(orgaoJulgador),
        relator,
        cargoRelator,
        dataJulgamento,
        dataPublicacao,
        tribunal: 'TJPR',
        uf: 'PR',
        ementa: ementa.substring(0, 10000),
      });
    }
    return out;
  }

  // ------------------------------------------------------- documento / teor

  /**
   * Página de um julgado (`/jurisprudencia/j/<id>/<slug>`).
   * O inteiro teor JÁ VEM no HTML, dentro de `div#texto<id>` — o link
   * "Íntegra do Acórdão" só tira o `display:none`. Nada de browser.
   */
  async documento(id) {
    await this.iniciar();
    const url = `${BASE}/jurisprudencia/j/${id}/documento`;
    const res = await this._fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`documento ${id}: HTTP ${res.status}`);
    const html = await res.text();
    return { id: String(id), url, ...TJPRNavigator.parseDocumento(html, id), html };
  }

  static parseDocumento(html, id) {
    // a ficha do julgado é uma sequência de `<td><b>Rótulo:</b> valor</td>`
    const pegar = (rotulo, { comItalico = false } = {}) => {
      const m = html.match(new RegExp(`<b>\\s*${rotulo}\\s*:?\\s*<\\/b>([\\s\\S]{0,600}?)<\\/td>`, 'i'));
      if (!m) return '';
      const bruto = comItalico ? m[1] : m[1].replace(/<i>[\s\S]*?<\/i>/gi, '');
      return semTags(bruto);
    };
    const texto = (html.match(new RegExp(`<div id="texto${id}">([\\s\\S]*?)<\\/div>`, 'i')) || [])[1];
    const ementa = (html.match(new RegExp(`<div id="ementa${id}">([\\s\\S]*?)<\\/div>`, 'i')) || [])[1];
    const bruto = semTags(html);
    const citacao = (bruto.match(/\(TJPR\s*-\s*[^)]{20,400}\)/) || [])[0] || '';
    const orgaoJulgador = pegar('Órgão Julgador') || (bruto.match(/Órgão Julgador:\s*(.+?)\s{2,}/) || [])[1] || '';
    // o site imprime a data como `Tue Mar 31 00:00:00 BRT 2026` (toString de java.util.Date)
    const dataBR = (txt) => {
      const iso = Date.parse(String(txt).replace(/\s+[A-Z]{3,4}\s+(\d{4})$/, ' $1'));
      if (!Number.isNaN(iso)) {
        const d = new Date(iso);
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
      return (String(txt).match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || '';
    };
    return {
      numeroProcesso: (pegar('Processo').match(/[\d.\-/]{10,30}/) || [])[0] ||
        (bruto.match(/Processo:\s*([\d.\-/]{10,30})/) || [])[1] || '',
      tipoDocumento: (bruto.match(/\((Acórdão|Decisão monocrática|Dúvida[^)]*)\)/i) || [])[1] || '',
      relator: pegar('Relator\\(a\\)'),
      cargoRelator: semTags((html.match(/<b>\s*Relator\(a\):\s*<\/b>[\s\S]{0,300}?<i>([\s\S]*?)<\/i>/i) || [])[1] || ''),
      orgaoJulgador,
      foro: TJPRNavigator.foro(orgaoJulgador),
      comarca: pegar('Comarca'),
      dataJulgamento: dataBR(pegar('Data do Julgamento')),
      dataPublicacao: dataBR(pegar('Fonte/Data da Publicação')),
      segredoJustica: /Segredo de Justi[çc]a:\s*<\/b>\s*Sim/i.test(html),
      citacao,
      ementa: ementa ? semTags(ementa) : '',
      inteiroTeor: texto ? semTags(texto) : '',
      temInteiroTeor: Boolean(texto && semTags(texto).length > 200),
    };
  }

  // ----------------------------------------------------------------- órgãos

  /** Lista completa (id, nome, documentos) do mapeamento. */
  static orgaos() {
    return ORGAOS.slice();
  }

  static orgaosPorForo(foro) {
    if (!ORGAOS.length) {
      return foro === 'juizados' ? IDS_JUIZADOS_FALLBACK.map((id) => ({ id, nome: '(fallback)' })) : [];
    }
    return ORGAOS.filter((o) => TJPRNavigator.foro(o.nome) === foro);
  }

  /**
   * Ids para o campo `idOrgaoJulgador` (lista separada por vírgula) que
   * materializam a separação Justiça Comum × Juizados.
   * `todos` devolve '' (sem filtro).
   */
  static idsDoForo(foro) {
    if (!foro || foro === 'todos') return '';
    return TJPRNavigator.orgaosPorForo(foro).map((o) => o.id).join(',');
  }

  /** Resolve um órgão pelo nome (parcial, sem acento) ou pelo id. */
  static acharOrgao(termo) {
    const t = String(termo ?? '').trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return ORGAOS.find((o) => String(o.id) === t) || { id: Number(t), nome: `(id ${t})` };
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return ORGAOS.find((o) => norm(o.nome) === norm(t)) || ORGAOS.find((o) => norm(o.nome).includes(norm(t))) || null;
  }

  /**
   * Reconstrói a lista de órgãos a partir da faceta "Orgão Julgador" da tela
   * de resultados — é assim que `06-orgaos.json` foi gerado. Serve para
   * detectar quando o tribunal cria/renomeia um órgão.
   */
  async listarOrgaosAoVivo(filtros = {}) {
    const { html } = await this.buscar({ ...filtros, query: filtros.query ?? '' });
    const tabela = (html.match(/<table id="filtroTable"[\s\S]*?<\/table>/i) || [])[0] || '';
    const urls = [...tabela.matchAll(/loadDocument\('[^']+',\s*'[^']+',\s*'[^']+',\s*'([^']+)'\)/g)].map((m) => m[1]);
    const urlOrgao = urls[3];                       // 4ª faceta = ORGAO_JULGADOR (enum TipoFiltro)
    if (!urlOrgao) throw new Error('faceta de órgão julgador não encontrada na tela de resultados');
    const res = await this._fetch(BASE + urlOrgao, { method: 'GET' });
    const buf = Buffer.from(await res.arrayBuffer());
    const xml = new TextDecoder('iso-8859-1').decode(buf);   // ajax.do responde em ISO-8859-1
    const out = [];
    for (const tr of xml.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
      const id = (tr.match(/id="filtro_4_(\d+)"/) || [])[1];
      const rotulo = [...tr.matchAll(/<td>([^<]+)<\/td>/g)].map((m) => m[1]).find((t) => /\(\d+\)\s*$/.test(t));
      if (!id || !rotulo) continue;
      const m = rotulo.trim().match(/^(.+?)\s*\((\d+)\)$/);
      out.push({ id: Number(id), nome: m[1].trim(), documentos: Number(m[2]) });
    }
    return out;
  }
}

TJPRNavigator.BASE = BASE;
TJPRNavigator.encodeLatin1 = encodeLatin1;
TJPRNavigator.semTags = semTags;
TJPRNavigator.RE_JUIZADOS = RE_JUIZADOS;

module.exports = TJPRNavigator;
