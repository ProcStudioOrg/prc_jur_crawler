// src/TJGOCrawler.js
const TJGONavigator = require('./TJGONavigator');

/**
 * Crawler for TJGO (Tribunal de Justiça de Goiás) jurisprudência —
 * Novo Módulo de Pesquisa de Jurisprudência (PROJUDI).
 *
 * Como o TJPA, NÃO usa browser: o formulário aceita POST direto e cada
 * resultado já vem com o texto completo da decisão (ver TJGONavigator).
 * Contrato público igual aos demais crawlers do repo:
 * search(query, filters, options) → Array (com .totalResults anexado).
 */
class TJGOCrawler {
  constructor(options = {}) {
    this.pageSize = options.pageSize ?? 50; // o site aceita 10, 20 ou 50
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJGONavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
  }

  /** Valida DD/MM/YYYY (formato exigido pelo formulário). @private */
  _validarData(d) {
    if (!d) return '';
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
    }
    return d;
  }

  /**
   * Resolve o filtro Órgão/Matéria por código ou nome (tabela embutida).
   * @private
   */
  _resolverOrgaoMateria(valor) {
    if (!valor) return '0';
    const s = String(valor).trim();
    const porCodigo = TJGONavigator.ORGAOS_MATERIA.find(o => o.codigo === s);
    if (porCodigo) return porCodigo.codigo;
    const porNome = TJGONavigator.ORGAOS_MATERIA.find(
      o => o.descricao.toLowerCase() === s.toLowerCase()
    ) || TJGONavigator.ORGAOS_MATERIA.find(
      o => o.descricao.toLowerCase().includes(s.toLowerCase())
    );
    if (!porNome) {
      const nomes = TJGONavigator.ORGAOS_MATERIA.map(o => o.descricao).join(' | ');
      throw new Error(`Órgão/Matéria desconhecido: "${valor}". Opções: ${nomes}`);
    }
    return porNome.codigo;
  }

  /**
   * Monta os campos do formulário a partir dos filtros da CLI, resolvendo
   * nomes de serventia/magistrado/tipo de ato pelas lupas quando necessário.
   * @private
   */
  async _buildForm(query, filters = {}) {
    const form = {
      Texto: query || '',
      qtdeItensPagina: String(this.pageSize),
    };

    if (filters.instancia && filters.instancia !== 'todas') {
      const id = TJGONavigator.INSTANCIAS[filters.instancia];
      if (!id) throw new Error(`Instância inválida: "${filters.instancia}" (todas|1grau|turmas|tribunal)`);
      form.Id_Instancia = id;
    }
    if (filters.area && filters.area !== 'todas') {
      const id = TJGONavigator.AREAS[filters.area];
      if (!id) throw new Error(`Área inválida: "${filters.area}" (todas|civel|criminal)`);
      form.Id_Area = id;
    }
    if (filters.orgaoMateria) {
      form.Id_ServentiaSubTipo = this._resolverOrgaoMateria(filters.orgaoMateria);
    }
    if (filters.serventia) {
      const alvo = await this.navigator.resolverLupa('serventia', filters.serventia);
      if (!alvo) throw new Error(`Serventia não encontrada na lupa: "${filters.serventia}"`);
      this.log(`Serventia resolvida: ${alvo.nome} (id ${alvo.id})`);
      form.Id_Serventia = alvo.id;
      form.Serventia = alvo.nome;
    }
    if (filters.magistrado) {
      const alvo = await this.navigator.resolverLupa('magistrado', filters.magistrado,
        form.Id_Serventia ? { filtroServentia: form.Id_Serventia } : {});
      if (!alvo) throw new Error(`Magistrado(a) não encontrado(a) na lupa: "${filters.magistrado}"`);
      this.log(`Magistrado(a) resolvido(a): ${alvo.nome} (id ${alvo.id})`);
      form.Id_Usuario = alvo.id;
      form.Usuario = alvo.nome;
    }
    if (filters.tipoAto) {
      const s = String(filters.tipoAto).trim().toLowerCase();
      const local = TJGONavigator.TIPOS_ATO.find(t => t.id === s || t.descricao.toLowerCase() === s);
      const alvo = local
        ? { id: local.id, nome: local.descricao }
        : await this.navigator.resolverLupa('tipoAto', filters.tipoAto);
      if (!alvo) throw new Error(`Tipo de Ato não encontrado: "${filters.tipoAto}"`);
      this.log(`Tipo de Ato resolvido: ${alvo.nome} (id ${alvo.id})`);
      form.Id_ArquivoTipo = alvo.id;
      form.ArquivoTipo = alvo.nome;
    }
    if (filters.processo) form.ProcessoNumero = filters.processo;
    if (filters.dataPublicacaoInicio) form.DataInicial = this._validarData(filters.dataPublicacaoInicio);
    if (filters.dataPublicacaoFim) form.DataFinal = this._validarData(filters.dataPublicacaoFim);

    return form;
  }

  /**
   * Map a raw navigator result to the repo's standard result shape.
   */
  mapResultado(r) {
    const out = {
      id: r.idArquivo,
      tipoDocumento: r.tipoAto,
      numeroProcesso: r.numeroProcesso,
      classe: r.classe,
      orgaoJulgador: r.serventia,
      dataJulgamento: (r.dataJulgamento || '').split(' ')[0],
      dataPublicacao: (r.dataPublicacao || '').split(' ')[0],
      dataPublicacaoHora: r.dataPublicacao || '',
      relator: r.magistrado,
      cargoMagistrado: r.cargoMagistrado,
      uf: 'GO',
      // o "ementa" padrão do repo: aqui é o início do texto completo do ato
      ementa: (r.texto || '').substring(0, 10000),
    };
    if (this.includeFullText) out.inteiroTeor = r.texto || '';
    return out;
  }

  /**
   * Main search. Same contract as BaseCrawler.search().
   * @param {string} query - termos (aspas duplas = frase exata; palavras
   *   soltas são combinadas com E implícito; não há operadores OU/NAO aqui)
   * @param {Object} filters - instancia ('todas'|'1grau'|'turmas'|'tribunal'),
   *   area ('todas'|'civel'|'criminal'), orgaoMateria (nome ou código),
   *   serventia (nome — resolvido pela lupa), magistrado (nome — lupa),
   *   tipoAto (nome ou id), processo (nº CNJ),
   *   dataPublicacaoInicio/Fim (DD/MM/YYYY)
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} mapped results with .totalResults attached
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    if (!query && !filters.processo && !filters.magistrado && !filters.serventia) {
      throw new Error('Informe um termo de pesquisa ou ao menos um filtro forte (processo/magistrado/serventia)');
    }

    const form = await this._buildForm(query, filters);
    const allResults = [];
    let totalResults = null;
    let totalPages = 1;

    for (let page = 0; page < maxPages && page < totalPages; page++) {
      console.log(`Extracting results from page ${page + 1}...`);
      const data = await this.navigator.buscar({ ...form, PosicaoPaginaAtual: String(page) });
      if (totalResults === null) {
        totalResults = data.total;
        totalPages = data.total != null ? Math.ceil(data.total / this.pageSize) : 1;
        console.log(`Total results on server: ${totalResults}`);
      }
      allResults.push(...data.resultados.map(r => this.mapResultado(r)));
      console.log(`Found ${data.resultados.length} results on page ${page + 1} (total: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        console.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (!data.resultados.length) break;
    }

    allResults.totalResults = totalResults;
    return allResults;
  }

  /**
   * Grava o texto completo de cada resultado como .txt (e opcionalmente
   * .html) — o texto já veio na busca, então não há novo acesso à rede.
   * OBS: search() precisa ter rodado com includeFullText=true para gravar
   * o texto integral; sem isso grava a ementa (primeiros 10k chars).
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? console.log;
    return this.navigator.salvarLote(results, outputDir, {
      log,
      formats: options.formats ?? ['txt'],
    });
  }

  /** Lista as opções válidas do combo Órgão/Matéria (tabela embutida). */
  listarOrgaosMateria() {
    return TJGONavigator.ORGAOS_MATERIA;
  }
}

module.exports = TJGOCrawler;
