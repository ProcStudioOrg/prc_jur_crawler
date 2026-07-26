// src/TJRJNavigator.js

/**
 * Navigator do TJRJ — cliente HTTP puro do módulo de jurisprudência do e-Proc:
 * https://eproc1g.tjrj.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 *
 * É o MESMO módulo `eproc-jur` do TRF4/TJSC (mesmos ids: #txtPesquisa,
 * #selOrigem, .resultadoItem), mas SEM o bloqueio F5 do TJSC — o host responde
 * a POST direto, então aqui não há browser. Mapeamento: `human-codegen/TJRJ/02-eproc/`.
 *
 * O que este módulo cobre e o que NÃO cobre:
 *   - Só decisões do sistema e-Proc (TJRJ migrou em 2023) — 2º grau da Justiça
 *     Comum: Câmaras, Seções, Órgão Especial, Conselho da Magistratura.
 *   - O #selOrigem tem UMA opção ("TJRJ"). Turmas Recursais/Juizados NÃO estão
 *     nesta base: vivem no eJURIS legado (human-codegen/TJRJ/01-ejuris/, sem
 *     crawler ainda). Ver CLAUDE-TJRJ.md.
 *
 * Particularidades confirmadas na prática (24/07/2026):
 *   - Charset ISO-8859-1 na página E nas respostas. O servidor aceitou tanto
 *     UTF-8 quanto latin-1 no corpo do POST com a mesma contagem, mas enviamos
 *     latin-1 (o que a tela envia) para não depender dessa tolerância.
 *   - Total/paginação vêm em hidden fields da resposta: hdnTotalResultado,
 *     hdnTotalPaginas, hdnPaginaAtual. Página fixa de 10 resultados.
 *   - Paginação por POST em `ajax_paginar_resultado` com o MESMO corpo da busca
 *     + hdnPaginaAtual=N (devolve outra página inteira de HTML).
 *   - Combos avançados (órgão, relator, classe) chegam por AJAX
 *     (`ajax_carregar_listas_pesquisa`) e o value dos POSTs é o PRÓPRIO LABEL
 *     ("6ª Câmara de Direito Privado"), não um id numérico.
 *   - Inteiro teor: GET no data-link do card (`download_inteiro_teor&
 *     id_jurisprudencia=<id>&termosPesquisados=<base64 da query>`) devolve o
 *     HTML completo do documento (~1 MB), sem sessão.
 */

const BASE = 'https://eproc1g.tjrj.jus.br/eproc/';
const URL_PESQUISAR = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`;
const URL_LISTAR = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados`;
const URL_PAGINAR = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/ajax_paginar_resultado`;
const URL_LISTAS = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/ajax_carregar_listas_pesquisar`;
const URL_LISTAS_AJAX = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/ajax_carregar_listas_pesquisa`;

/** Percent-encoding sobre bytes ISO-8859-1 (o charset declarado pela página). */
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
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');

const semTags = (html) =>
  decodeEntidades(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

class TJRJNavigator {
  /** #selOrigem — uma única opção nesta base (só Justiça Comum 2º grau). */
  static ORIGENS = { tjrj: '1' };
  /** #selTipoDocumento. */
  static TIPOS_DOCUMENTO = { acordao: '1', monocratica: '2' };
  /** #rdoCampo — onde o termo é procurado. */
  static ESCOPOS = { ementa: 'E', inteiroTeor: 'I' };
  /** #selOrdenacao da tela de resultados. */
  static ORDENS = { recentes: '1', antigos: '2' };
  /** A página de resultados é fixa em 10 itens. */
  static POR_PAGINA = 10;

  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.cookie = null;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  }

  // ------------------------------------------------------------------ sessão

  /** GET na tela de pesquisa só para receber o PHPSESSID. Idempotente. */
  async iniciar() {
    if (this.cookie) return this.cookie;
    const res = await this._fetch(URL_PESQUISAR, { method: 'GET' });
    await res.arrayBuffer();
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
        if (c.startsWith('PHPSESSID=')) this.cookie = c.split(';')[0];
      }
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  /** Corpo em bytes ISO-8859-1, como a tela envia. @private */
  async _postHtml(url, campos) {
    const body = campos
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${encodeLatin1(k)}=${encodeLatin1(v)}`)
      .join('&');
    const res = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`TJRJ respondeu HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return new TextDecoder('iso-8859-1').decode(buf);
  }

  // ------------------------------------------------------------------ busca

  /**
   * Campos do POST na ordem do formulário. Multi-selects repetem a chave
   * (`selTipoDocumento[]=1&selTipoDocumento[]=2`), por isso lista de pares e
   * não objeto.
   * @private
   */
  static montarFormulario(f = {}) {
    const campos = [
      ['txtPesquisa', f.query ?? ''],
      ['rdoCampo', f.escopo ?? TJRJNavigator.ESCOPOS.ementa],
      ['txtProcesso', f.processo ?? ''],
      ['dtDecisaoInicio', f.dataDecisaoInicio ?? ''],
      ['dtDecisaoFim', f.dataDecisaoFim ?? ''],
      ['hdnDecisaoInicio', f.dataDecisaoInicio ?? ''],
      ['hdnDecisaoFim', f.dataDecisaoFim ?? ''],
      ['dtPublicacaoInicio', f.dataPublicacaoInicio ?? ''],
      ['dtPublicacaoFim', f.dataPublicacaoFim ?? ''],
      ['hdnPublicacaoInicio', f.dataPublicacaoInicio ?? ''],
      ['hdnPublicacaoFim', f.dataPublicacaoFim ?? ''],
    ];
    for (const o of f.origens ?? [TJRJNavigator.ORIGENS.tjrj]) campos.push(['selOrigem[]', o]);
    for (const t of f.tiposDocumento ?? []) campos.push(['selTipoDocumento[]', t]);
    for (const o of f.orgaos ?? []) campos.push(['selOrgao[]', o]);
    for (const r of f.relatores ?? []) campos.push(['selRelator[]', r]);
    for (const c of f.classes ?? []) campos.push(['selClasse[]', c]);
    // ordenação SEMPRE explícita: sem ela o ranking oscila ainda mais entre
    // requisições e a paginação repete/pula documentos (ver ressalva no doc)
    campos.push(['selOrdenacao', f.ordem ?? TJRJNavigator.ORDENS.recentes]);
    if (f.precedenteRelevante) campos.push(['chkPrecedenteRelevante', 'on']);
    // "Agrupar Resultados" é o default da tela; espelhamos, a menos que peçam
    if (f.agrupar !== false) campos.push(['chkAgruparResultados', 'on']);
    if (f.pagina && Number(f.pagina) > 1) campos.push(['hdnPaginaAtual', String(f.pagina)]);
    return campos;
  }

  /**
   * Executa uma busca (ou pede outra página dela) e devolve HTML + totais +
   * julgados parseados.
   * @returns {{html:string, total:number, paginas:number, pagina:number, resultados:Array<Object>}}
   */
  async buscar(filtros = {}) {
    await this.iniciar();
    const pagina = Number(filtros.pagina ?? 1);
    const url = pagina > 1 ? URL_PAGINAR : URL_LISTAR;
    const html = await this._postHtml(url, TJRJNavigator.montarFormulario(filtros));
    const hidden = (nome) => {
      const m = html.match(new RegExp(`name="${nome}"[^>]*value="(\\d+)"`)) ||
                html.match(new RegExp(`value="(\\d+)"[^>]*name="${nome}"`));
      return m ? parseInt(m[1], 10) : null;
    };
    return {
      html,
      total: hidden('hdnTotalResultado') ?? 0,
      paginas: hidden('hdnTotalPaginas') ?? 1,
      pagina: hidden('hdnPaginaAtual') ?? pagina,
      resultados: TJRJNavigator.parseResultados(html),
    };
  }

  // ----------------------------------------------------------------- parsing

  /**
   * Extrai os cards `.resultadoItem`. Cada campo do card é um par
   * `.resLabel` → `.resValue`; os rótulos flexionam gênero
   * (RELATOR/RELATORA), então casamos por prefixo.
   */
  static parseResultados(html) {
    const cards = html.split(/<div class="card mb-3 resultadoItem"/).slice(1);
    const out = [];
    for (const bruto of cards) {
      const card = '<div ' + bruto;
      const id = (card.match(/id="resultado(\d+)"/) || [])[1] || '';

      // pares rótulo → primeiro .resValue do trecho até o próximo rótulo
      const campos = {};
      const rotulos = [...card.matchAll(/class="[^"]*resLabel[^"]*"[^>]*>\s*([^<]+?)\s*</g)];
      for (let i = 0; i < rotulos.length; i++) {
        const ini = rotulos[i].index + rotulos[i][0].length;
        const fim = i + 1 < rotulos.length ? rotulos[i + 1].index : card.length;
        const trecho = card.slice(ini, fim);
        const valor = (trecho.match(/class="[^"]*resValue[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [, trecho])[1];
        campos[rotulos[i][1].toUpperCase()] = semTags(valor);
      }
      const porPrefixo = (p) => campos[Object.keys(campos).find((k) => k.startsWith(p)) ?? ''] ?? '';

      // nº no <a class="numero-processo">, classe no <span> logo depois
      const linhaProcesso = porPrefixo('PROCESSO');
      const numeroProcesso = (linhaProcesso.match(/[\d.\-/]{15,30}(?=\/TJRJ|\s|$)/) || [])[0]?.replace(/\/$/, '') || '';
      const aposProcesso = (card.match(/class="[^"]*numero-processo[^"]*"[\s\S]*?<\/a>([\s\S]{0,400})/) || [])[1] || '';
      const classe = semTags((aposProcesso.match(/<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');

      let inteiroTeorLink = (card.match(/class="[^"]*inteiroTeor[^"]*"[^>]*data-link="([^"]+)"/) || [])[1] || '';
      if (inteiroTeorLink) inteiroTeorLink = decodeEntidades(inteiroTeorLink);
      if (inteiroTeorLink && !/^https?:/.test(inteiroTeorLink)) inteiroTeorLink = BASE + inteiroTeorLink;
      let processoUrl = (card.match(/class="[^"]*consultaProcessual[^"]*"[^>]*data-link="([^"]+)"/) || [])[1] || '';
      processoUrl = decodeEntidades(processoUrl);

      if (!id && !numeroProcesso) continue;
      out.push({
        id,
        tipoDocumento: semTags((card.match(/class="[^"]*resValueTipoJurisprudencia[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''),
        numeroProcesso,
        processoUrl,
        classe,
        uf: porPrefixo('UF') || 'RJ',
        orgaoJulgador: porPrefixo('ÓRGÃO JULGADOR'),
        dataJulgamento: (porPrefixo('DATA DO JULGAMENTO').match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || '',
        dataPublicacao: (porPrefixo('DATA DA PUBLICAÇÃO').match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || '',
        relator: porPrefixo('RELATOR'),
        decisao: porPrefixo('DECISÃO').substring(0, 2000),
        ementa: porPrefixo('EMENTA').substring(0, 10000),
        citacao: semTags((card.match(/data-citacao="([^"]*)"/) || [])[1] || ''),
        inteiroTeorLink,
        tribunal: 'TJRJ',
      });
    }
    return out;
  }

  static temProximaPagina(r) {
    return r.pagina < r.paginas;
  }

  // ------------------------------------------------------- documento / teor

  /**
   * Baixa o inteiro teor de um julgado. O `link` é o data-link do card; sem
   * ele, monta a URL a partir do id (termosPesquisados é a query em base64 e
   * serve só para o destaque de termos — opcional).
   */
  async inteiroTeor(idOuLink, query = '') {
    await this.iniciar();
    let url = String(idOuLink ?? '');
    if (!/^https?:/.test(url)) {
      url = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor` +
        `&id_jurisprudencia=${url}` +
        (query ? `&termosPesquisados=${Buffer.from(query, 'latin1').toString('base64')}` : '');
    }
    const res = await this._fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`inteiro teor: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = new TextDecoder('iso-8859-1').decode(buf);
    const texto = semTags(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''));
    return { url, html, texto, temInteiroTeor: texto.length > 200 };
  }

  // ------------------------------------------------------------------ listas

  /**
   * Combos avançados (classe, relator, órgão julgador) direto do AJAX da tela.
   * O value aceito nos POSTs é o próprio label.
   * @returns {{classes:string[], relatores:string[], orgaos:string[]}}
   */
  async listas() {
    await this.iniciar();
    let res = await this._fetch(URL_LISTAS_AJAX, { method: 'GET' });
    if (!res.ok) res = await this._fetch(URL_LISTAS, { method: 'GET' });
    if (!res.ok) throw new Error(`listas: HTTP ${res.status}`);
    const d = JSON.parse(await res.text());
    return {
      classes: Object.keys(d.arrClasse ?? {}),
      relatores: Object.keys(d.arrRelator ?? {}),
      orgaos: Object.keys(d.arrOrgao ?? {}),
    };
  }
}

TJRJNavigator.BASE = BASE;
TJRJNavigator.encodeLatin1 = encodeLatin1;
TJRJNavigator.semTags = semTags;

module.exports = TJRJNavigator;
