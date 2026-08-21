// src/TCEESCrawler.js
const TCEESNavigator = require('./TCEESNavigator');

/**
 * Crawler do **TCE-ES** (Tribunal de Contas do Estado do Espírito Santo) —
 * módulo **Pesquisa de Jurisprudência** (base de *excertos*).
 *
 * Como TCE-PR/TCE-PA/TJPI/TJBA, NÃO estende BaseCrawler: o acesso é HTTP direto
 * (ver `TCEESNavigator`). Contrato do repo: `search(query, filters, options)`
 * devolve Array com `.totalResults`.
 *
 * ✅ ESCOPO — O ESPÍRITO SANTO NÃO TEM TCM, e as contas municipais estão aqui.
 *    A prova saiu do próprio acervo, não de pesquisa fora do portal: o excerto
 *    17365 trata do "Edital de Concorrência nº 1/2025, promovido pela
 *    **Prefeitura Municipal de Serra** e da Secretaria Municipal de
 *    Comunicação". A armadilha do Bloco 5 ("onde existe TCM, buscar contas
 *    municipais no TCE devolve zero") é **falsa no ES**, como em PR, SC, RS, PE
 *    e MG — e verdadeira em SP, RJ, BA, GO e PA.
 *
 * 🔴 ESTA BASE É DE **EXCERTOS**, NÃO É O ACERVO DE DELIBERAÇÕES DO TCE-ES.
 *    São **9.730** excertos curados — e a própria tela avisa, no topo: "O
 *    enunciado do excerto, elaborado pelo **Núcleo de Jurisprudência e Súmula —
 *    NJS** ou extraído da ementa, procura retratar o entendimento contido na
 *    deliberação da qual foi extraído, **não constituindo, todavia, um resumo
 *    oficial da decisão** proferida pelo Tribunal". Ou seja: é o equivalente da
 *    "Jurisprudência Selecionada" do TCDF e da base curada do TCE-RJ. Nunca
 *    relate 9.730 como "as decisões do Tribunal de Contas do ES", e nunca cite
 *    o *enunciado* como se fosse a ementa oficial.
 *    ⚠️ O acervo largo de deliberações fica no outro módulo do mesmo host
 *    (`/Publica/DocumentoDisponibilizado`), que **não foi mapeado** — ver
 *    `CLAUDE-TCEES.md`.
 *
 * 🔴 O CAMPO SE CHAMA `CriacaoData` E O TOOLTIP DIZ "excertos criados", MAS O
 *    QUE ELE FILTRA É A **DATA DA DELIBERAÇÃO**. Medido: a faceta "Último mês"
 *    (16) bate exatamente com o intervalo 21/07–21/08/2026 (16), e os 25 cards
 *    de `2012` trazem 25 deliberações de 2012. O rótulo da tela para o eixo é,
 *    aliás, "Data de disponibilização da deliberação". Nunca apresente esta
 *    data como data de criação do excerto.
 *
 * 🔴 DATA INVÁLIDA É **IGNORADA EM SILÊNCIO**, não recusada: `99/99/9999`
 *    devolve os 9.730 do acervo inteiro com HTTP 200. Um erro de digitação vira
 *    "busca sem filtro" com número plausível. Por isso o crawler valida a data
 *    antes de enviar.
 *
 * 🔴 NÃO EXISTE OPERADOR BOOLEANO NO CAMPO DE TEXTO — E O ERRO NÃO ZERA, ELE
 *    RESTRINGE. O espaço entre termos já é `E` (AND) implícito, e `E`/`OU`/
 *    `NÃO`/`AND`/`OR`/`NOT` viram **mais um termo** no AND. Medido:
 *      licitação                 3.344     nepotismo                    22
 *      licitação nepotismo           6     ← AND implícito
 *      licitação E nepotismo         6     ← "E" casa 9.670 de 9.730: quase no-op
 *      licitação OU nepotismo        5     🔴 você pede união e recebe MENOS que o AND
 *      licitação AND nepotismo       0     🔴 "AND" casa 9 documentos: zera
 *      licitação NÃO publicidade 2.415     🔴 não exclui: é AND com "não" e "publicidade"
 *    Para excluir existe **campo próprio** (`--excluir`), cuja aritmética fecha
 *    exata: 3.344 − 2.584 (licitação AND publicidade) = **760** = `--excluir`.
 *    Para unir, rode duas buscas e some.
 *
 * 🔴 ASPAS NO CAMPO LIVRE **NÃO SÃO FRASE EXATA**: `"segregação de funções"` em
 *    `-q` devolve 70 (AND dos termos, aspas descartadas) e o campo próprio
 *    `--frase` devolve **60**. Números parecidos, resultados diferentes — o
 *    sintoma é invisível. Use `--frase`.
 *
 * ⚠️ O ÍNDICE NORMALIZA ACENTO E CAIXA e faz **stemming** português:
 *    `licitação` = `licitacao` = `LICITAÇÃO` = `licita` = `licitar` = `licit` =
 *    **3.344**. Não avise o usuário sobre acento aqui. ⚠️ Mas o curinga
 *    **não existe**: `*` é descartado (`licita*` = 3.344, igual ao stem) e `$`
 *    entra no token e **zera** (`licitac$` = 0).
 *
 * ✅ O TOTAL É EXATO, NÃO SATURADO, e a paginação vai até o fim: 3.344 fecha em
 *    134 páginas (133 × 25 + 19). Página além do fim devolve 0 card com HTTP 200
 *    e o mesmo total. ✅ Paginação **estável**: a página 5 pedida duas vezes
 *    devolveu os mesmos 25 ids, tanto por relevância quanto por data.
 *
 * ⚠️ `AgruparResultados=True` NÃO MUDA O TOTAL, MUDA OS CARDS: ele colapsa os
 *    vários excertos da mesma deliberação em um card só (o documento 4937529
 *    ocupa 6 dos 25 cards sem agrupar e 1 com). Como o total continua contando
 *    **excertos**, a aritmética da paginação deixa de fechar. Default `False`.
 */

/** Filtros de faceta: flag do repo → campo do formulário. Todos medidos por contagem. */
const CAMPO_DE = {
  area: 'AreaAssuntoExcertoMenuItem.IdArea',
  tema: 'TemaAssuntoExcertoMenuItem.IdTema',
  subtema: 'SubtemaAssuntoExcertoMenuItem.IdSubtema',
  tipoDeliberacao: 'TipoDeliberacaoMenuItem.IdTipoDeliberacao',
  colegiado: 'ColegiadoMenuItem.IdColegiado',
  norma: 'NormaExcertoMenuItem.IdNorma',
  referenciaLegal: 'ReferenciaLegalExcertoMenuItem.IdReferenciaLegal',
  palavraChave: 'PalavraChaveMenuItem.IdPalavraChave',
  atividade: 'AtividadeProcessoMenuItem.IdAtividade',
  natureza: 'NaturezaProcessoMenuItem.IdNatureza',
  especie: 'EspecieProcessoMenuItem.IdEspecie',
  subespecie: 'SubespecieProcessoMenuItem.IdSubespecie',
  classificacao: 'ClassificacaoProcessoMenuItem.IdClassificacaoProcesso',
  relator: 'RelatorMenuItem.NomeRelator',
};

const POR_PAGINA = 25; // fixo no servidor: não há parâmetro de tamanho de página

class TCEESCrawler {
  constructor(options = {}) {
    this.navigator = options.navigator || new TCEESNavigator(options);
    this.log = options.log ?? console.log;
    this.maxPages = options.maxPages ?? 10;
    this.includeFullText = !!options.includeFullText;
    this.agrupar = !!options.agrupar;
  }

  /** `DD/MM/YYYY` (o que a tela usa) — validado, porque data ruim é ignorada em silêncio. */
  static dataBr(d) {
    if (!d) return '';
    const s = String(d).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) {
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) m = [null, iso[3], iso[2], iso[1]];
    }
    if (!m) throw new Error(`data invalida: ${d} (use DD/MM/YYYY). O servidor IGNORA data ruim e devolve o acervo inteiro.`);
    const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(ano, mes - 1, dia));
    if (dt.getUTCDate() !== dia || dt.getUTCMonth() !== mes - 1 || dt.getUTCFullYear() !== ano) {
      throw new Error(`data inexistente: ${d}`);
    }
    return `${m[1]}/${m[2]}/${m[3]}`;
  }

  /** Monta o corpo do POST a partir do termo e dos filtros. */
  static montarCampos(query, filters = {}, options = {}) {
    const campos = {};
    const termo = (query || '').trim();
    if (termo) campos.BuscaTextual = termo;
    if (filters.frase) campos.BuscaExata = String(filters.frase).trim();
    if (filters.excluir) campos.BuscaExcetuacao = String(filters.excluir).trim();
    if (filters.enunciado) campos.BuscarPorEnunciado = 'true';

    for (const [flag, campo] of Object.entries(CAMPO_DE)) {
      const v = filters[flag];
      if (v === undefined || v === null || v === '') continue;
      campos[campo] = String(v);
    }

    const ini = TCEESCrawler.dataBr(filters.dataInicio);
    const fim = TCEESCrawler.dataBr(filters.dataFim);
    if (ini) campos['PeriodoDataMenuItem.CriacaoDataIntervaloInicio'] = ini;
    if (fim) campos['PeriodoDataMenuItem.CriacaoDataIntervaloFim'] = fim;

    const ordem = options.ordem === 'data' ? 'data' : 'relevancia';
    campos.OrdenarPor = TCEESNavigator.ORDENACOES[ordem];
    campos.AgruparResultados = options.agrupar ? 'True' : 'False';
    return campos;
  }

  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    const base = TCEESCrawler.montarCampos(query, filters, {
      ordem: options.ordem,
      agrupar: options.agrupar ?? this.agrupar,
    });

    const temTermo = base.BuscaTextual || base.BuscaExata || base.BuscaExcetuacao;
    const temFiltro = Object.keys(base).some((k) => k.includes('MenuItem.') && base[k]);
    if (!temTermo && !temFiltro) {
      throw new Error('Informe um termo (-q/--frase) ou pelo menos um filtro — senao a busca devolve o acervo inteiro (9.730).');
    }

    const avisos = TCEESCrawler.avisosDeQuery(query, filters);
    avisos.forEach((a) => this.log(`AVISO: ${a}`));

    const out = [];
    let total = null;
    for (let pagina = 1; pagina <= maxPages; pagina++) {
      // 🔴 `PaginaAtual`, nunca `PaginaNova` — ver TCEESNavigator.
      const json = await this.navigator.buscar({ ...base, PaginaAtual: String(pagina) });
      const html = (json.Dados && json.Dados.ResultadosPesquisarExcerto) || '';
      if (total === null) {
        total = TCEESCrawler.total(html);
        this.ultimaBusca = { total, campos: base, facetas: TCEESCrawler.facetas(json) };
        this.log(`Total no servidor: ${total === null ? '?' : total} excertos (exato)`);
      }
      const cards = TCEESCrawler.fatiarCards(html);
      if (!cards.length) break;
      out.push(...cards);
      if (total !== null && out.length >= total) break;
    }

    // Paginação medida ESTÁVEL (mesma página 2× = mesmos ids, por score e por
    // data). Deduplicamos por idExcerto assim mesmo: é barato e agrupar repete.
    const vistos = new Set();
    const unicos = out.filter((r) => (vistos.has(r.id) ? false : vistos.add(r.id)));

    if (this.includeFullText) {
      for (const r of unicos) {
        if (!r.inteiroTeorLink) { this.log(`AVISO: excerto ${r.id} nao expoe download.`); continue; }
        try {
          r.inteiroTeorPdfBuffer = await this.navigator.inteiroTeorPdf(r.inteiroTeorLink);
        } catch (e) {
          this.log(`AVISO: PDF de ${r.id} falhou: ${e.message}`);
        }
      }
    }

    unicos.totalResults = total ?? unicos.length;
    return unicos;
  }

  /**
   * Avisos de operador — este portal erra **para menos**, e sem sintoma.
   * Ver o cabeçalho da classe para as contagens medidas.
   */
  static avisosDeQuery(query, filters = {}) {
    const avisos = [];
    const q = String(query || '');
    if (/\b(E|OU|NÃO|NAO|AND|OR|NOT)\b/.test(q)) {
      avisos.push(
        'O TCE-ES NAO tem operador booleano: E/OU/NAO/AND/OR/NOT viram mais um termo no AND implicito '
        + 'e RESTRINGEM (medido: "licitacao OU nepotismo" = 5, menos que o AND = 6; "AND" zera). '
        + 'Para excluir use --excluir; para unir, rode duas buscas e some.'
      );
    }
    if (/"/.test(q)) {
      avisos.push('Aspas em -q NAO fazem frase exata (as aspas sao descartadas: 70 contra 60 do campo proprio). Use --frase.');
    }
    if (/[*$]/.test(q)) {
      avisos.push('Nao ha curinga no TCE-ES: "*" e descartado e "$" ZERA a busca. O indice ja faz stemming (licita = licitar = licitacao).');
    }
    if (filters.dataInicio && !filters.dataFim) {
      avisos.push('Janela pela metade: so o inicio. Funciona, mas confira se e o recorte que voce queria.');
    }
    return avisos;
  }

  /** O total autoritativo é o hidden do Solr, não o texto "N excertos". */
  static total(html) {
    const m = String(html).match(/ResultadoPesquisaSolr_FilesCount"[^>]*value="(\d+)"/);
    return m ? Number(m[1]) : null;
  }

  /**
   * As 14 facetas, com contador.
   *
   * ✅ AQUI A FACETA RESPEITA O TERMO (ao contrário do TCE-PA, onde ela é global):
   *    sem termo, Área "Administração Pública" = 1.172; buscando `licitação`,
   *    a mesma faceta anuncia 273 — e aplicar o filtro devolve o número anunciado.
   * ⚠️ Mas a LISTA é truncada em **100 itens** (`Subtema` e `Palavra-chave`
   *    batem no teto). O que falta não aparece e não há aviso na tela.
   */
  static facetas(json) {
    const out = {};
    const dados = (json && json.Dados) || {};
    for (const [bloco, campo] of Object.entries(TCEESNavigator.FACETAS)) {
      const html = dados[bloco];
      if (!html) continue;
      const itens = [];
      for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        const valor = (m[1].match(/data-prop-val="([^"]*)"/) || [])[1];
        if (valor === undefined) continue;
        const cont = (m[2].match(/class="contador-facet">\s*([\d.]+)\s*</) || [])[1];
        const rotulo = TCEESCrawler._texto(m[2].replace(/<span[^>]*contador-facet[\s\S]*?<\/span>/, ''));
        itens.push({ valor, rotulo, contador: cont ? Number(cont.replace(/\./g, '')) : null });
      }
      out[campo] = { bloco, truncada: itens.length >= 100, itens };
    }
    return out;
  }

  /**
   * Fatia os cards.
   *
   * 🔴 QUEM IDENTIFICA O JULGADO É O **idExcerto**, NÃO O PROCESSO NEM A
   *    DELIBERAÇÃO: uma deliberação rende vários excertos (o Acórdão 00552/2026
   *    ocupa 7 dos 16 cards do "último mês"). Contar processos ou PDFs subestima;
   *    contar excertos é a unidade real desta base.
   *
   * ✅ A CITAÇÃO OFICIAL VEM PRONTA no `span.span-anexo-excerto` (oculto na
   *    tela, usado pelo botão "Copiar"), e é a única fonte de **data da sessão**
   *    e **data de publicação no DO-TCES** — nenhuma das duas tem campo próprio
   *    no card.
   */
  static fatiarCards(html) {
    const blocos = String(html).split(/(?=<div class="row-fluid">\s*<div class="titulo-resultado-pesquisa")/).slice(1);
    return blocos.map((b) => {
      const idDocumento = (b.match(/id="tituloResultadoPesquisa-(\d+)"/) || [])[1] || null;
      const idExcerto = (b.match(/detalhar-excerto\/\?id=(\d+)/) || [])[1] || null;
      const numeroExcerto = TCEESCrawler._texto((b.match(/detalhar-excerto\/\?id=\d+"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '')
        .replace(/^Excerto\s*/i, '') || null;
      // 🔴 A ANATOMIA DO CARD MUDA COM A VINTAGE DO EXCERTO. Os recentes (redação
      //    do NJS) trazem `div.excerto-palavra-chave` com as tags em <b> e o
      //    enunciado em <blockquote>; os antigos (medido: Parecer em Consulta
      //    00014/2003) **não têm nem um nem outro** — as tags vêm num
      //    `<strong>[...]</strong>` dentro do próprio teor e não há enunciado.
      //    Medido na página 1 de `licitação`: enunciado em 2/25, tags em 8/25.
      //    Um crawler que presuma o card novo devolve `null` calado em 92% deles.
      const classificacaoTitulo = TCEESCrawler._texto(
        (b.match(/class="excerto-palavra-chave">[\s\S]*?<b>([\s\S]*?)<\/b>/)
          || b.match(/<strong>\s*\[([\s\S]*?)\]\s*<\/strong>/) || [])[1] || ''
      ) || null;

      const docLink = b.match(/title="Visualizar documento">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const inteiroTeorLink = docLink ? `https://${TCEESNavigator.HOST_APP}${TCEESCrawler._deshtml(docLink[1])}` : null;
      const deliberacao = docLink ? TCEESCrawler._texto(docLink[2]) : null;

      const enunciado = TCEESCrawler._texto((b.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/) || [])[1] || '') || null;
      const teor = TCEESCrawler._texto(
        (b.match(/class="conteudo-excerto-texto[^"]*"[^>]*>([\s\S]*?)<a class="btn-expandir-contrair-excerto/) || [])[1] || ''
      ) || null;
      // ⚠️ Há DOIS `span-anexo-excerto` por card e só o ÚLTIMO é a citação: o
      //    primeiro é o cabeçalho oculto que o botão "Copiar" prefixa ao teor.
      //    Pegar o primeiro devolve "Parecer em Consulta 00014/2003" no lugar da
      //    citação inteira — plausível, e sem data nenhuma.
      const anexos = [...b.matchAll(/span-anexo-excerto"[^>]*>([\s\S]*?)<\/(?:span|div)>/g)]
        .map((m) => TCEESCrawler._texto(m[1]));
      const citacao = (anexos.filter((t) => /^\(?TCE-ES\./.test(t)).pop() || '').replace(/^\(|\)\.?$/g, '').trim();

      const proc = b.match(/Processo:<\/td>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const processoTexto = proc ? TCEESCrawler._texto(proc[2]) : null;
      const relator = TCEESCrawler._texto((b.match(/Relator:<\/td>[\s\S]*?<span>([\s\S]*?)<\/span>/) || [])[1] || '') || null;
      const classificacoes = [...b.matchAll(/Classifica[^<]*:<\/td>([\s\S]*?)<\/table>/g)]
        .flatMap((m) => [...m[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => TCEESCrawler._texto(x[1])))
        .filter(Boolean);

      return {
        id: idExcerto,
        idDocumento,
        numeroExcerto,
        deliberacao,
        processo: processoTexto ? processoTexto.split(' - ')[0] : null,
        processoClassificacao: processoTexto,
        processoUrl: proc ? TCEESCrawler._deshtml(proc[1]) : null,
        relator,
        orgaoJulgador: (citacao.match(/Órgão Julgador:\s*([^,.]+)/) || [])[1] || null,
        dataJulgamento: (citacao.match(/Data da sess[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
        dataPublicacao: (citacao.match(/Publica[çc][ãa]o no DO-TCES:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
        tituloClassificacao: classificacaoTitulo,
        classificacoes,
        // 🔴 `enunciado` NÃO É EMENTA OFICIAL — é redação do NJS ou extrato dela.
        enunciado,
        semEmenta: true,
        ementa: null,
        teorExcerto: teor,
        citacaoOficial: citacao ? `(${citacao})` : null,
        permalink: idExcerto ? TCEESNavigator.permalink(idExcerto) : null,
        inteiroTeorLink,
        uf: 'ES',
        tribunal: 'TCE-ES',
      };
    }).filter((r) => r.id || r.idDocumento);
  }

  /** @private */
  static _deshtml(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }

  /** @private */
  static _texto(frag) {
    return String(frag)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = TCEESCrawler;
module.exports.CAMPO_DE = CAMPO_DE;
module.exports.POR_PAGINA = POR_PAGINA;
