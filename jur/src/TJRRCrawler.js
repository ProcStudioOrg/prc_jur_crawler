// src/TJRRCrawler.js
const TJRRNavigator = require('./TJRRNavigator');

/**
 * Crawler do TJRR (Tribunal de Justiça de Roraima) — "Juris", o Sistema de
 * Jurisprudência. https://jurisprudencia.tjrr.jus.br
 *
 * Como TJPI/TJBA/TJPE/TJTO, NÃO estende BaseCrawler: o acesso é HTTP direto
 * (ver TJRRNavigator). Contrato público do repo: search(query, filters,
 * options) → Array com `.totalResults`.
 *
 * ✅ A EMENTA ÍNTEGRA JÁ VEM NO HTML DA BUSCA (`div.docTexto` depois do rótulo
 *    `EMENTA:`), no formato estruturado do CNJ. Sem captcha, sem sessão extra.
 *
 * 🔴 SÓ ACÓRDÃO TEM EMENTA. A aba "Decisão Monocrática" (49.256 documentos de
 *    um acervo de 126.384) traz card **sem nenhum bloco de ementa** — só
 *    processo, relator, órgão e as duas datas. O texto da monocrática existe
 *    apenas no PDF do inteiro teor (`--fetch-inteiro-teor`).
 *    ⚠️ E o card dela mostra assim mesmo o botão "Copia a ementa para a área de
 *    transferência" — controle que promete um campo que aquele documento não
 *    tem. Medido por contagem também: o filtro "Ementa/Indexação" com `posse`
 *    devolve 276 acórdãos e **0 monocráticas**.
 *
 * 🔴 LINHAS POR PÁGINA SÓ ACEITA 10, 20 OU 30 — e fora disso a tabela volta
 *    VAZIA com HTTP 200 (fragmento de 57 bytes), não com erro. `--page-size 50`
 *    e `--page-size 3` colheriam zero documento em toda página, o que se lê como
 *    "acabaram os resultados". O `snapRows()` do Navigator encaixa o pedido no
 *    valor válido; nunca desligue isso.
 */

/** As duas abas do portal. */
const TIPOS = ['acordao', 'monocratica'];

/** O valor de `tipoOrgaoList` que isola o Juizado Especial. */
const ORGAO_TURMA_RECURSAL = 'TURMA_RECURSAL';
/** Os demais órgãos = Justiça Comum / cúpula. Usados no recorte `--origem comum`. */
const ORGAOS_COMUNS = [
  'PRIMEIRA_TURMA_CIVEL',
  'SEGUNDA_TURMA_CIVEL',
  'CAMARA_CRIMINAL',
  'VICE_PRESIDENCIA',
  'TRIBUNAL_PLENO',
  'CAMARAS_REUNIDAS',
  'PRESIDENCIA',
  'CONSELHO_DA_MAGISTRATURA',
  'CAMARA_CIVEL',
  'CAMARA_UNICA',
  'PLANTAO_JUDICIAL',
];

class TJRRCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages ?? 10;
    this.porPagina = TJRRNavigator.snapRows(options.porPagina ?? 30);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJRRNavigator({ log: this.log });
    this.ultimaBusca = null;
  }

  /** Converte ISO para DD/MM/YYYY. O portal IGNORA ISO em silêncio. @private */
  _dataBr(d) {
    if (!d) return '';
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Avisos de query e de filtro, no padrão do repo. @private */
  _avisos(query, filters) {
    const a = [];
    const q = query || '';
    if (/\b(AND|OR|NOT)\b/.test(q)) {
      a.push(
        'AVISO: no TJRR os operadores INGLESES nao funcionam — viram palavra literal e '
          + 'DESTROEM a busca (dano AND moral = 4, OR = 22, NOT = 0, contra 15.907 de "dano E moral"). '
          + 'Use os PORTUGUESES: E, OU, NAO/NÃO.'
      );
    }
    if (/\b(ADJ|PROX)\b/.test(q)) {
      a.push('AVISO: ADJ e PROX nao existem no TJRR — viram palavra literal e zeram a busca (4 e 1 resultados).');
    }
    if (filters.origem === 'comum') {
      a.push(
        'AVISO: --origem comum e recorte por LISTA DE ORGAOS (os 11 que nao sao Turma Recursal). '
          + 'A particao fecha exata (medido: as 12 partes somam 991 = o total sem filtro), mas o '
          + 'total relatado e o da soma, nao um numero do servidor.'
      );
    }
    if (filters.origem !== 'turmas') {
      a.push(
        'AVISO: em RORAIMA o peso do Juizado depende MUITO do tema — Turma Recursal e 37,5% em '
          + '"dano moral" (5.965 de 15.907) e 0,4% em "usucapiao" (4 de 991). Em consumo, rode tambem '
          + '--origem turmas.'
      );
    }
    if (filters.tipo === 'monocratica') {
      a.push(
        'AVISO: decisao monocratica no TJRR vem SEM EMENTA — o card so tem processo, relator, orgao '
          + 'e datas. O texto so existe no PDF: use --fetch-inteiro-teor. Nao apresente o card como ementa.'
      );
    }
    if ((filters.dataFim || filters.dataFimPublicacao) && !(filters.dataInicio || filters.dataInicioPublicacao)) {
      a.push(
        'AVISO: no TJRR a data FINAL sozinha e IGNORADA em silencio (devolve o acervo inteiro com '
          + 'HTTP 200); a INICIAL sozinha funciona. Mande as duas pontas.'
      );
    }
    return a;
  }

  /**
   * Busca. `filters`:
   *   tipo: 'acordao' | 'monocratica' | 'todos' (default 'todos')
   *   origem: 'turmas' | 'comum' | 'ambas' (default 'ambas')
   *   orgaos: string[] (valores crus de tipoOrgaoList)
   *   classe: string (value do tipoClasseList)
   *   ementa: string (campo "Ementa/Indexação")
   *   dataInicio/dataFim: DD/MM/YYYY — data de JULGAMENTO
   *   dataInicioPublicacao/dataFimPublicacao: DD/MM/YYYY — data de PUBLICAÇÃO
   *   numeroProcesso: 13 (SISCOM) ou 20 (PROJUDI) dígitos
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    // ⚠️ snapRows é obrigatório: `_rows` fora de {10,20,30} devolve tabela
    //    vazia com HTTP 200 (ver o bloco 🔴 no TJRRNavigator).
    const rows = TJRRNavigator.snapRows(options.porPagina ?? this.porPagina);
    this._avisos(query, filters).forEach((x) => this.log(x));

    const usaPublicacao = Boolean(filters.dataInicioPublicacao || filters.dataFimPublicacao);
    const p = {
      termo: query || '',
      ementa: filters.ementa || '',
      numProcesso: filters.numeroProcesso || '',
      classe: filters.classe || '0',
      dataInicial: this._dataBr(usaPublicacao ? filters.dataInicioPublicacao : filters.dataInicio),
      dataFinal: this._dataBr(usaPublicacao ? filters.dataFimPublicacao : filters.dataFim),
      // ⚠️ O combo diz "TODOS", mas medido: sem `tipoProcedimento` a janela filtra
      //    JULGAMENTO (58 = igual a JULGAMENTO explicito, contra 60 de PUBLICACAO).
      //    "TODOS" nao e a uniao dos dois — e o julgamento.
      tipoData: usaPublicacao ? 'PUBLICACAO' : 'JULGAMENTO',
      orgaos: this._orgaos(filters),
      porPagina: rows,
    };

    const est = await this.navigator.buscar(p);
    const totais = TJRRNavigator.totais(est.html);
    const estado = { cookie: est.cookie, viewState: est.viewState };
    this.ultimaBusca = { totais, filtros: p };

    const tipos = filters.tipo && filters.tipo !== 'todos' ? [filters.tipo] : TIPOS;
    const out = [];
    for (const tipo of tipos) {
      const total = totais[tipo] ?? 0;
      if (!total) continue;
      for (let page = 0; page < maxPages; page++) {
        const first = page * rows;
        if (first >= total) break;
        // 🔴 A resposta da busca traz as DUAS tabelas no mesmo HTML, com os
        //    mesmos ids `resultados1..N`. Fatiar a página inteira mistura
        //    monocrática dentro de acórdão, sem sintoma: os campos batem, só a
        //    ementa vem vazia. Por isso toda página — inclusive a primeira —
        //    vem do fragmento AJAX, que contém uma tabela só.
        const html = await this.navigator.paginar(estado, { aba: tipo, first, rows, termo: query || '' });
        const cards = TJRRCrawler.fatiarCards(html, tipo);
        if (!cards.length) break;
        out.push(...cards);
      }
    }

    const vistos = new Set();
    const unicos = out.filter((r) => {
      const chave = r.id ?? `sem-id:${r.processo}:${r.dataJulgamento}`;
      return vistos.has(chave) ? false : vistos.add(chave);
    });

    if (this.includeFullText) {
      for (const r of unicos) {
        if (!r.id) { this.log(`AVISO: documento ${r.processo} nao tem inteiro teor no portal (sem id).`); continue; }
        try {
          r.inteiroTeorPdf = await this.navigator.inteiroTeor(r.id);
        } catch (e) {
          this.log(`AVISO: inteiro teor do id ${r.id} falhou: ${e.message}`);
        }
      }
    }

    unicos.totalResults = (totais.acordao ?? 0) + (totais.monocratica ?? 0);
    unicos.totaisPorAba = totais;
    return unicos;
  }

  /** Resolve a lista de órgãos a partir de `origem`/`orgaos`. @private */
  _orgaos(filters) {
    if (filters.orgaos && filters.orgaos.length) return filters.orgaos;
    if (filters.origem === 'turmas') return [ORGAO_TURMA_RECURSAL];
    if (filters.origem === 'comum') return ORGAOS_COMUNS;
    return [];
  }

  /**
   * Fatia os cards de um HTML (página inteira ou fragmento AJAX).
   * ⚠️ Cada documento é renderizado DUAS vezes na resposta (layout desktop e
   *    mobile); a deduplicação por `id` no `search()` é obrigatória.
   */
  static fatiarCards(html, tipo = 'acordao') {
    const out = [];
    // O card é `<div id="resultados<N>" class="row">`, uma linha da dataTable.
    // ⚠️ O id do documento aparece MAIS DE UMA VEZ dentro do mesmo card (no
    //    config do accordion e no iframe do visualizador) — por isso se pega o
    //    primeiro de cada card, e não toda ocorrência do HTML.
    const marcas = [];
    const re = /<div id="resultados(\d+)"/g;
    let m;
    while ((m = re.exec(html))) marcas.push(m.index);
    for (let i = 0; i < marcas.length; i++) {
      const trecho = html.slice(marcas[i], i + 1 < marcas.length ? marcas[i + 1] : html.length);
      // ⚠️ NEM TODO DOCUMENTO TEM INTEIRO TEOR. Medido: 1 das 10 monocráticas
      //    da primeira página de `usucapiao` não traz `inteiroTeor.xhtml?id=`
      //    nenhum — o card existe, com processo, relator e datas, e não há PDF.
      //    Descartar o card por falta de id perderia o julgado em silêncio, que
      //    é justamente o defeito que este repo persegue: aqui ele entra com
      //    `id: null` e sem link.
      const idm = trecho.match(/inteiroTeor\.xhtml\?id=(\d+)/);
      const id = idm ? idm[1] : null;
      const campos = TJRRCrawler._campos(trecho);
      if (!campos.processo) continue;
      out.push({
        id,
        tipoDocumento: tipo === 'monocratica' ? 'DECISAO_MONOCRATICA' : 'ACORDAO',
        tribunal: 'TJRR',
        uf: 'RR',
        processo: campos.processo,
        classe: campos.classe || null,
        relator: campos.relator || null,
        orgaoJulgador: campos.orgao || null,
        dataJulgamento: campos.dataJulgamento || null,
        dataPublicacao: campos.dataPublicacao || null,
        ementa: campos.ementa || null,
        semEmenta: !campos.ementa,
        // ⚠️ `inteiroTeor.xhtml` é só o visualizador; o PDF publico é `/pdf?id=`.
        inteiroTeorLink: id ? `${TJRRNavigator.ORIGIN}/pdf?id=${id}` : null,
        permalink: id ? `${TJRRNavigator.ORIGIN}/inteiroTeor.xhtml?id=${id}` : null,
        semInteiroTeor: !id,
      });
    }
    return out;
  }

  /** Extrai os pares docTitulo/docTexto de um trecho de card. @private */
  static _campos(trecho) {
    const pares = [];
    // ⚠️ O `docTexto` da EMENTA carrega `style="text-align: justify"` e os
    //    demais não: casar `class="docTexto"` cru pega processo/relator/datas e
    //    perde justamente a ementa, calado. O `[^>]*` aqui é o conserto.
    const re = /<div class="docTitulo"[^>]*>([\s\S]*?)<\/div>\s*<div class="docTexto"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(trecho))) pares.push([TJRRCrawler._txt(m[1]), m[2]]);
    const pega = (rot) => {
      const p = pares.find(([k]) => k.toUpperCase().startsWith(rot));
      return p ? p[1] : '';
    };
    const proc = pega('PROCESSO');
    const linhas = TJRRCrawler._txt(proc.replace(/<br\s*\/?>/gi, '\n'))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const numero = linhas.find((l) => /^\d{13,20}$/.test(l.replace(/\D/g, '')) && l.replace(/\D/g, '').length >= 13);
    return {
      classe: linhas[0] && linhas[0] !== numero ? linhas[0] : null,
      processo: numero ? numero.replace(/\s/g, '') : null,
      relator: TJRRCrawler._txt(pega('RELATOR')) || null,
      orgao: TJRRCrawler._txt(pega('ÓRGÃO')) || null,
      dataJulgamento: TJRRCrawler._txt(pega('DATA DO JULGAMENTO')) || null,
      dataPublicacao: TJRRCrawler._txt(pega('DATA DA PUBLICA')) || null,
      ementa: TJRRCrawler._txt(pega('EMENTA')) || null,
    };
  }

  /** HTML → texto limpo. @private */
  static _txt(h) {
    return String(h || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  static get ORGAOS_COMUNS() {
    return ORGAOS_COMUNS;
  }
  static get ORGAO_TURMA_RECURSAL() {
    return ORGAO_TURMA_RECURSAL;
  }
}

module.exports = TJRRCrawler;
