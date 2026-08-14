// src/TCEPRCrawler.js
const TCEPRNavigator = require('./TCEPRNavigator');

/**
 * Crawler do **TCE-PR** (Tribunal de Contas do Estado do Paraná) — portal
 * **ViaJuris**. https://viajuris.tce.pr.gov.br
 *
 * Como TJPI/TJBA/TJPE/TJTO/TJRR, NÃO estende BaseCrawler: o acesso é HTTP
 * direto (ver `TCEPRNavigator`). Contrato público do repo:
 * `search(query, filters, options)` → Array com `.totalResults`.
 *
 * ⚠️ ESCOPO — E O QUE ELE **NÃO** COBRE. O TCE-PR fiscaliza o Estado do Paraná
 *    e **todos os 399 municípios paranaenses**: o Paraná **não tem TCM**, e a
 *    prova está no próprio formulário, cujo combo `MUNICIPIO` traz **399
 *    municípios** (400 opções, contando o "Selecione um Município"). Ou seja, a
 *    armadilha do Bloco 5 ("no TCE não há conta municipal, procure o TCM") **não
 *    existe aqui** — diferente de SP, RJ, BA, GO e PA. Em compensação, isto é
 *    controle externo: **não há jurisprudência judicial nenhuma nesta base**.
 *    Pedido de matéria cível, penal ou trabalhista não tem resposta aqui.
 *
 * ✅ A BUSCA ENTREGA TUDO DE UMA VEZ: ementa, tema, inteiro teor, classificação
 *    de termos (tesauro), referências normativas **e a citação oficial pronta**
 *    — sem captcha, sem sessão, sem request extra. `--fetch-inteiro-teor` só
 *    grava o PDF em disco.
 *
 * 🔴 O INTEIRO TEOR SÓ VEM SE HOUVER TERMO LIVRE (medido 100% × 0%; ver o bloco
 *    no `TCEPRNavigator`). Busca só por filtro devolve card **sem texto
 *    integral**, e o crawler avisa quando cai nesse regime.
 *
 * 🔴 O BLOCO "INTEIRO TEOR:" DO CARD NÃO É SÓ O TEXTO — SÃO TRECHOS DE HIGHLIGHT
 *    MAIS O TEXTO. São três `<div>`: os dois primeiros são **snippets** que
 *    começam com `...` e trazem o termo em `<span style="background-color:
 *    yellow">`; o terceiro é o texto integral. Quem concatenar os três publica o
 *    mesmo parágrafo três vezes; quem pegar o primeiro publica **595 caracteres
 *    de recorte** e chama de inteiro teor. Ficamos com o maior, e guardamos os
 *    snippets em `trechos` — que é o que eles são.
 *
 * ✅ A CITAÇÃO OFICIAL VEM PRONTA, no `data-content` do botão "Copiar Ementa",
 *    junto da ementa íntegra: `(REPRESENTAÇÃO DA LEI DE LICITAÇÕES n.º
 *    393433/2026, Acórdão n.º 1979/2026, Tribunal Pleno, Rel. …, julgado em
 *    05/08/2026, veiculado em 11/08/2026 no DETC)`. Nada de regex de citação,
 *    que foi o que custou caro na família e-SAJ (quatro formatos em quatro
 *    instalações).
 */

/** As 6 classificações de decisão, do hidden que de fato filtra. */
const CLASSIFICACOES = {
  'consulta-forca-normativa': '1',
  'consulta-sem-forca-normativa': '2',
  prejulgado: '3',
  sumula: '4',
  'uniformizacao-jurisprudencia': '5',
  'incidente-uniformizacao': '6',
};

/** Os três colegiados. A partição fecha exata (ver `_avisos`). */
const COLEGIADOS = {
  pleno: 'Tribunal Pleno',
  'primeira-camara': 'Primeira Câmara',
  'segunda-camara': 'Segunda Câmara',
};

class TCEPRCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages ?? 10;
    this.porPagina = options.porPagina ?? 20;
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TCEPRNavigator({ log: this.log, timeout: options.timeout });
    this.ultimaBusca = null;
  }

  /** Converte ISO para DD/MM/YYYY. O portal aceita os dois, mas normalizamos. @private */
  _dataBr(d) {
    if (!d) return '';
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
    throw new Error(`Data invalida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Avisos de query e de filtro, no padrão do repo. @private */
  _avisos(query, filters) {
    const a = [];
    const q = query || '';

    // 🔴 Medido: `ou` e `não` em português são IGNORADOS (devolvem a interseção,
    //    igual ao espaço), enquanto OR/NOT fecham a aritmética exata:
    //    379 + 17.563 − 179 = 17.763 (OR) e 17.563 − 179 = 17.384 (NOT).
    //    E a PRÓPRIA TELA anuncia "e ou não ( ) * ? ~" logo acima do campo.
    if (/\b(ou|OU)\b/.test(q)) {
      a.push(
        'AVISO: no TCE-PR o "ou" em portugues NAO e operador — e ignorado, e a busca vira E (AND). '
          + 'Voce pede uniao e recebe intersecao, com numero plausivel e sem sintoma '
          + '(medido: "nepotismo ou licitacao" = 179 = "nepotismo licitacao"). Use OR: 17.763, '
          + 'que fecha a aritmetica (379 + 17.563 - 179).'
      );
    }
    if (/\b(nao|não|NAO|NÃO)\b/.test(q)) {
      a.push(
        'AVISO: no TCE-PR o "nao"/"nao" em portugues NAO e operador de exclusao — vira palavra e a '
          + 'busca vira E (AND) (medido: 179 e 178, contra 17.384 do NOT correto). Use NOT.'
      );
    }
    if (/\?/.test(q)) {
      a.push(
        'AVISO: o curinga "?" ZERA a busca em silencio (HTTP 200 com "0 registros encontrados"), '
          + 'apesar de a tela anuncia-lo. Use "*".'
      );
    }
    if (/\*/.test(q)) {
      a.push(
        'AVISO: o curinga "*" DEGENERA no TCE-PR — devolve MENOS que o termo inteiro '
          + '(licita* = 12.291 contra licitacao = 17.563), porque o termo simples ja expande. '
          + 'Numero menor com curinga nao e busca mais especifica.'
      );
    }
    if (filters.dataInicio && !filters.dataFim) {
      a.push(
        'AVISO: no TCE-PR a data INICIAL sozinha ZERA a busca (0 registros, HTTP 200). '
          + 'Mande as duas pontas — o crawler nao envia meia janela.'
      );
    }
    if (filters.dataFim && !filters.dataInicio) {
      a.push(
        'AVISO: no TCE-PR a data FINAL sozinha e IGNORADA em silencio (devolve o acervo inteiro, '
          + 'HTTP 200). Mande as duas pontas — o crawler nao envia meia janela.'
      );
    }
    if (!q) {
      a.push(
        'AVISO: SEM TERMO LIVRE o card volta SEM inteiro teor (medido 0/50 sem termo contra 50/50 '
          + 'com termo). Voce tera ementa e tema, nao o texto integral. Para o texto, use '
          + '--fetch-inteiro-teor (PDF) ou informe -q.'
      );
    }
    return a;
  }

  /**
   * Busca. `filters`:
   *   colegiado: 'pleno' | 'primeira-camara' | 'segunda-camara' (ou o rótulo cru)
   *   classificacao: chave de CLASSIFICACOES, ou id(s) crus separados por vírgula
   *   anoAcordao / anoProcesso: 'YYYY'
   *   relator: nome exato do combo
   *   classe: value do combo CLASSE_PROCESSUAL
   *   municipio: id do combo MUNICIPIO
   *   interessado / entidade: texto livre
   *   dataInicio/dataFim: DD/MM/YYYY — data da SESSÃO de julgamento
   *   numeroProcesso / anoProcesso, numeroAcordao / anoAcordao
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    const porPagina = options.porPagina ?? this.porPagina;
    this._avisos(query, filters).forEach((x) => this.log(x));

    // 🔴 Meia janela nunca é meia resposta: início sozinho ZERA, fim sozinho é
    //    IGNORADO. Se vier só uma ponta, não mandamos nenhuma e dizemos isso.
    const temAmbas = Boolean(filters.dataInicio && filters.dataFim);
    const base = {
      TermoLivre: query || '',
      COLEGIADO: this._colegiado(filters),
      ANO_ATO: filters.anoAcordao || '-1',
      ANO_PROCESSO: filters.anoProcesso || '-1',
      NOME_RELATOR: filters.relator || '-1',
      CLASSE_PROCESSUAL: filters.classe || '-1',
      MUNICIPIO: filters.municipio || '-1',
      NUMERO_PROCESSO: filters.numeroProcesso || '',
      NUMERO_ATO: filters.numeroAcordao || '',
      INTERESSADO: filters.interessado || '',
      ENTIDADE: filters.entidade || '',
      CLASSIFICACAO_DECISAO_SELECIONADOS: this._classificacao(filters),
      DtSessaoInicial: temAmbas ? this._dataBr(filters.dataInicio) : '',
      DtSessaoFinal: temAmbas ? this._dataBr(filters.dataFim) : '',
      LinhasPorPagina: String(porPagina),
    };

    const out = [];
    let total = null;
    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.buscar({ ...base, PaginaAtual: String(pagina) });
      if (r.status !== 200) throw new Error(`Busca respondeu HTTP ${r.status}`);
      if (total === null) {
        total = TCEPRNavigator.total(r.html);
        this.ultimaBusca = { total, filtros: base };
      }
      const cards = TCEPRCrawler.fatiarCards(r.html);
      if (!cards.length) break;
      out.push(...cards);
      if (total !== null && out.length >= total) break;
    }

    // ⚠️ Paginação medida como ESTÁVEL (a mesma página 3× devolve os mesmos ids,
    //    e pg1 ∩ pg2 = 0), mas deduplicamos por id assim mesmo: é barato e é o
    //    que separa "estável hoje" de "estável sempre".
    const vistos = new Set();
    const unicos = out.filter((r) => (vistos.has(r.id) ? false : vistos.add(r.id)));

    if (this.includeFullText) {
      for (const r of unicos) {
        if (!r.inteiroTeorLink) { this.log(`AVISO: documento ${r.id} nao expoe PDF no card.`); continue; }
        try {
          r.inteiroTeorPdfBuffer = await this.navigator.inteiroTeorPdf(r.inteiroTeorLink);
        } catch (e) {
          this.log(`AVISO: PDF do documento ${r.id} falhou: ${e.message}`);
        }
      }
    }

    unicos.totalResults = total ?? unicos.length;
    return unicos;
  }

  /** @private */
  _colegiado(filters) {
    if (!filters.colegiado) return '-1';
    return COLEGIADOS[filters.colegiado] || filters.colegiado;
  }

  /** @private */
  _classificacao(filters) {
    if (!filters.classificacao) return '';
    return String(filters.classificacao)
      .split(',')
      .map((s) => CLASSIFICACOES[s.trim()] || s.trim())
      .join(',');
  }

  /** Texto útil de um pedaço de HTML. @private */
  static _texto(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  /** Extrai o valor de uma seção rotulada do card (`<b>Ementa:</b>` etc). @private */
  static _secao(cardHtml, rotulo) {
    const re = new RegExp(
      `<b>\\s*${rotulo}\\s*:?\\s*</b>[\\s\\S]*?</p>([\\s\\S]*?)(?=<div class="col-lg-12 no-padding|<a class="pull-right expandirConteudo|$)`,
      'i'
    );
    const m = cardHtml.match(re);
    return m ? m[1] : '';
  }

  /**
   * Fatia os cards de uma resposta de busca.
   *
   * O card é `div.conteudo-acordao`. O cabeçalho é uma linha só, no `<a>` do
   * permalink: `Acórdão: 1979/2026 | Tribunal Pleno | Processo: 393433/2026 |
   * Data da Sessão: 05/08/2026`.
   *
   * 🔴 QUEM IDENTIFICA O DOCUMENTO É O `id` DO PORTAL (`detalhesAcordao_202642`),
   *    não o número do processo: um processo rende vários acórdãos ao longo dos
   *    anos. O slug do permalink é **decorativo** — trocá-lo por qualquer coisa
   *    devolve o mesmo documento (medido); o que resolve é o id no fim da URL.
   */
  static fatiarCards(html) {
    const pedacos = [
      ...html.matchAll(/<div class="conteudo-acordao[\s\S]*?(?=<div class="conteudo-acordao|$)/g),
    ].map((m) => m[0]);

    return pedacos.map((c) => {
      const id = (c.match(/detalhesAcordao_(\d+)/) || [])[1] || null;
      const href = (c.match(/href="(\/Pesquisa\/Visualizar\/[^"]+)"/) || [])[1] || null;
      const cab = TCEPRCrawler._texto((c.match(/<a id="detalhesAcordao_\d+"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
      const pdf = (c.match(/class="btnUrlPDF"/) ? (c.match(/data-url="([^"]+)"/) || [])[1] : null) || null;

      // ✅ ementa íntegra + citação oficial, prontas, no data-content do "Copiar Ementa"
      const dc = (c.match(/class="modalShow"[^>]*data-content="([\s\S]*?)"\s*>/) || [])[1]
        || (c.match(/data-content="([\s\S]*?)"[^>]*class="modalShow"/) || [])[1] || '';
      const conteudo = TCEPRCrawler._texto(dc);
      const mCit = conteudo.match(/\n?(\([^()]*(?:\([^()]*\)[^()]*)*\))\s*$/);
      const citacao = mCit ? mCit[1] : null;
      const ementa = (mCit ? conteudo.slice(0, mCit.index) : conteudo).trim() || null;

      // 🔴 3 divs: 2 snippets de highlight + o texto integral. Fica o maior.
      const blocoIt = TCEPRCrawler._secao(c, 'Inteiro Teor');
      const divs = [...blocoIt.matchAll(/<div>([\s\S]*?)<\/div>/g)].map((m) => TCEPRCrawler._texto(m[1]));
      const inteiroTeor = divs.length ? divs.reduce((a, b) => (b.length > a.length ? b : a)) : null;
      const trechos = divs.filter((d) => d !== inteiroTeor && d.startsWith('...'));

      const termos = [...c.matchAll(/bucarCaminho\('[^']*','([^']*)'\)/g)]
        .map((m) => TCEPRCrawler._texto(m[1]));
      const referencias = [...c.matchAll(/bucarReferencia\('([^']*)'\)/g)]
        .map((m) => TCEPRCrawler._texto(m[1]))
        .filter((r) => !r.includes('|'));

      return {
        id,
        tipoDocumento: 'ACORDAO',
        acordao: (cab.match(/Acórdão:\s*([\d]+\/\d{4})/) || [])[1] || null,
        processo: (cab.match(/Processo:\s*([\d]+\/\d{4})/) || [])[1] || null,
        orgaoJulgador: (cab.match(/\|\s*([^|]*?)\s*\|\s*Processo/) || [])[1] || null,
        dataJulgamento: (cab.match(/Data da Sessão:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
        // ⚠️ A data de PUBLICAÇÃO existe (e é diferente da sessão: 05/08 × 11/08),
        //    mas só na página de detalhe e na citação — o card não a traz em campo
        //    próprio. Extraímos da citação quando ela vem.
        dataPublicacao: (conteudo.match(/veiculado em (\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
        relator: TCEPRCrawler._texto(TCEPRCrawler._secao(c, 'Relator')) || null,
        uf: 'PR',
        ementa,
        tema: TCEPRCrawler._texto(TCEPRCrawler._secao(c, 'Tema')) || null,
        inteiroTeor,
        trechos,
        semInteiroTeor: !inteiroTeor,
        citacao,
        classificacaoTermos: termos,
        referenciasNormativas: referencias,
        processoUrl: href ? `${TCEPRNavigator.ORIGIN}${href}` : null,
        inteiroTeorLink: pdf,
      };
    });
  }
}

module.exports = TCEPRCrawler;
module.exports.CLASSIFICACOES = CLASSIFICACOES;
module.exports.COLEGIADOS = COLEGIADOS;
