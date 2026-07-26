// src/TRF2Crawler.js
const TRF2Navigator = require('./TRF2Navigator');

/**
 * Crawler do TRF2 (Tribunal Regional Federal da 2ª Região — RJ e ES).
 *
 * Portal alvo: o módulo de jurisprudência do e-Proc
 * https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 * (o antigo `juris.trf2.jus.br` foi desativado; `jurisprudencia.trf2.jus.br`
 * redireciona para cá).
 *
 * Como TJRS/TJGO/TJPA/TJSC, NÃO estende BaseCrawler: quem fala com o site é o
 * TRF2Navigator, e aqui não há browser nenhum — o portal responde a POST direto.
 *
 * A DESAMBIGUAÇÃO OBRIGATÓRIA (Justiça Federal comum × Juizados Especiais
 * Federais) é o filtro `origem`, que vira o combo "Origem" (#selOrigem):
 *   trf2   -> TRF2             (2º grau da Justiça Federal comum)
 *   turmas -> Turmas Recursais (2º grau dos Juizados Especiais Federais)
 *   tru    -> TRU2             (Turma Regional de Uniformização — Juizados)
 *
 * Contrato público idêntico ao dos demais: search(query, filters, options)
 * devolve um Array com `.totalResults` anexado.
 */
class TRF2Crawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TRF2Navigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    this.ownsNavigator = !options.navigator;
  }

  /** 'juizados' | 'jef' | ... -> chave canônica de TRF2Navigator.ORIGENS (ou 'todas'). */
  static chaveOrigem(origem) {
    const chave = TRF2Navigator.ORIGENS_ALIAS[String(origem ?? 'trf2').toLowerCase()];
    if (!chave) {
      throw new Error(`origem inválida: "${origem}" (use trf2 | turmas | tru | todas)`);
    }
    return chave;
  }

  /** Chave canônica -> códigos do #selOrigem. @private */
  _codigosOrigem(chave) {
    return chave === 'todas' ? Object.values(TRF2Navigator.ORIGENS) : [TRF2Navigator.ORIGENS[chave]];
  }

  /**
   * Tipos de documento pedidos -> códigos.
   *
   * Diferente do TJSC, aqui os códigos NÃO mudam com a origem (Acórdão é sempre
   * 1). O que muda é quais existem: Súmula e Despacho da Vice-Presidência só há
   * na origem TRF2. Pedir um tipo inexistente na origem devolveria 0 em
   * silêncio, então recusamos alto.
   * @private
   */
  _codigosTipo(chaveOrigem, tipos = []) {
    if (!tipos.length) return [];
    return tipos.map((t) => {
      const chave = String(t).toLowerCase();
      const codigo = TRF2Navigator.TIPOS_DOCUMENTO[chave];
      if (!codigo) {
        throw new Error(`tipo inválido: "${t}" (use ${Object.keys(TRF2Navigator.TIPOS_DOCUMENTO).join(', ')})`);
      }
      const disponiveis = TRF2Navigator.TIPOS_POR_ORIGEM[chaveOrigem];
      if (disponiveis && !disponiveis.includes(chave)) {
        throw new Error(
          `tipo "${chave}" não existe na origem "${chaveOrigem}" (disponíveis: ${disponiveis.join(', ')})`,
        );
      }
      return codigo;
    });
  }

  /** DD/MM/YYYY (aceita ISO e converte). @private */
  _data(d) {
    if (!d) return '';
    const s = String(d);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Item cru do navigator -> formato padrão do repo. */
  mapResult(r) {
    return {
      id: r.id || null,
      tipoDocumento: r.tipoDocumento || '',
      numeroProcesso: r.numeroProcesso || '',
      sufixoOrigem: r.sufixoOrigem || '',
      processo: r.numeroProcesso || '',
      processoUrl: r.processoUrl || null,
      classe: r.classe || '',
      orgaoJulgador: r.orgaoJulgador || '',
      dataJulgamento: r.dataJulgamento || '',
      dataPublicacao: r.dataPublicacao || '',
      relator: r.relator || '',
      relatorAcordao: r.relatorAcordao || '',
      uf: r.uf || '',
      decisao: (r.decisao || '').substring(0, 10000),
      ementa: (r.ementa || r.citacao || '').substring(0, 10000),
      citacao: (r.citacao || '').substring(0, 2000),
      inteiroTeorLink: r.inteiroTeorLink || null,
    };
  }

  /**
   * Busca principal.
   *
   * @param {string} query termo livre. Por padrão passa por
   *   TRF2Navigator.normalizarQuery — LEIA a ressalva lá: neste portal o espaço
   *   entre termos quebra a busca (46 resultados em vez de 20.201).
   * @param {Object} filters origem, tipos[], escopo ('ementa'|'inteiroTeor'),
   *   somenteCaput, dataInicio/dataFim, dataPubInicio/dataPubFim (DD/MM/YYYY),
   *   processo, orgaos[], relatores[], classes[], precedenteRelevante,
   *   agrupar, ordenacao, literal
   * @param {Object} options maxPages, maxResults, tamanhoPagina
   * @returns {Array} resultados mapeados, com .totalResults / .origemAplicada /
   *   .queryEnviada / .avisos
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const tamanhoPagina = Number(options.tamanhoPagina ?? 10);

    const chave = TRF2Crawler.chaveOrigem(filters.origem);
    const origens = this._codigosOrigem(chave);
    const tiposDocumento = this._codigosTipo(chave, filters.tipos ?? []);

    const avisos = [];
    let queryEnviada = String(query ?? '');
    if (!filters.literal) {
      const n = TRF2Navigator.normalizarQuery(query);
      queryEnviada = n.query;
      if (n.aviso) avisos.push(n.aviso);
      if (n.alterada) {
        this.log(`Query normalizada para o TRF2: "${query}" -> "${queryEnviada}" (espaço quebra a busca neste portal)`);
      }
    }
    for (const a of avisos) this.log(`AVISO: ${a}`);

    const f = {
      query: queryEnviada,
      origens,
      tiposDocumento,
      escopo: filters.escopo,
      somenteCaput: filters.somenteCaput,
      dataDecisaoInicio: this._data(filters.dataInicio),
      dataDecisaoFim: this._data(filters.dataFim),
      dataPublicacaoInicio: this._data(filters.dataPubInicio),
      dataPublicacaoFim: this._data(filters.dataPubFim),
      processo: filters.processo,
      classes: filters.classes ?? [],
      relatores: filters.relatores ?? [],
      orgaos: filters.orgaos ?? [],
      precedenteRelevante: filters.precedenteRelevante,
      agrupar: filters.agrupar,
      ordenacao: filters.ordenacao,
      tamanhoPagina,
    };

    const primeira = await this.navigator.pesquisar(f);
    this.log(`Total results on server: ${primeira.total ?? '(desconhecido)'}`);
    this.log(`Origem aplicada: ${origens.map((c) => TRF2Navigator.ORIGENS_LABEL[c]).join(' + ')}`);

    const todos = primeira.resultados.map((r) => this.mapResult(r));
    this.log(`Found ${primeira.resultados.length} results on page 1 (total: ${todos.length})`);

    const contexto = { totalPaginas: primeira.totalPaginas, totalResultado: primeira.total ?? 0 };
    for (let pagina = 2; pagina <= maxPages; pagina++) {
      if (todos.length >= maxResults) break;
      if (pagina > (primeira.totalPaginas || 1)) break;
      this.log(`Extracting results from page ${pagina}...`);
      const p = await this.navigator.paginar(f, pagina, contexto);
      if (!p.resultados.length) {
        this.log(`Página ${pagina} voltou vazia (estado: ${p.estado}); encerrando.`);
        break;
      }
      todos.push(...p.resultados.map((r) => this.mapResult(r)));
      this.log(`Found ${p.resultados.length} results on page ${pagina} (total: ${todos.length})`);
    }
    if (todos.length > maxResults) todos.length = maxResults;

    todos.totalResults = primeira.total;
    todos.totalPaginas = primeira.totalPaginas;
    todos.origemAplicada = origens.map((c) => TRF2Navigator.ORIGENS_LABEL[c]);
    todos.queryEnviada = queryEnviada;
    todos.avisos = avisos;
    return todos;
  }

  /** Compatibilidade com a CLI (HTTP puro: não há sessão a fechar). */
  async close() {
    if (this.ownsNavigator) await this.navigator.fechar();
  }

  /** Grava o inteiro teor dos resultados. */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, {
      log: options.log ?? this.log,
      formats: options.formats ?? ['txt'],
    });
  }
}

module.exports = TRF2Crawler;
