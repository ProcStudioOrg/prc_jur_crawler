// src/TJRSCrawler.js
const TJRSNavigator = require('./TJRSNavigator');

/**
 * Crawler do TJRS (Tribunal de Justiça do Rio Grande do Sul).
 * https://www.tjrs.jus.br/buscas/jurisprudencia/?aba=jurisprudencia
 *
 * Como TJPA/TJGO, NÃO estende BaseCrawler/Playwright: a tela chama um endpoint
 * AJAX que devolve JSON do Solr, então a busca roda sobre HTTP puro (ver
 * TJRSNavigator). O contrato público é o mesmo dos outros crawlers:
 * search(query, filters, options) -> Array (com .totalResults anexado).
 *
 * A desambiguação obrigatória (Justiça Comum × Juizados Especiais/Turmas
 * Recursais) é o filtro `origem`, que vira o combo "Tribunal" do site:
 *   comum  -> Tribunal de Justiça do RS (cod_tribunal:3)
 *   turmas -> Turmas Recursais          (cod_tribunal:6)
 */
class TJRSCrawler {
  constructor(options = {}) {
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJRSNavigator({
      timeout: options.timeout ?? 120000,
      log: this.log,
    });
    /** cache dos combos, para resolver nome -> código sem repetir request */
    this._combos = new Map();
  }

  /** DD/MM/YYYY -> DD/MM/YYYY (o site usa o formato brasileiro). @private */
  _toSiteDate(d) {
    if (!d) return '';
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return String(d);
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** 2026-07-16T03:00:00Z -> 16/07/2026. @private */
  _toBrDate(d) {
    const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  /** Código do combo "Tribunal" a partir do alias amigável. @private */
  _codTribunal(origem) {
    const key = String(origem ?? 'comum').toLowerCase();
    const alias = {
      comum: 'comum', 'justica-comum': 'comum', tj: 'comum', tjrs: 'comum',
      turmas: 'turmas', 'turmas-recursais': 'turmas', juizados: 'turmas', juizado: 'turmas',
      alcada: 'alcada',
      todas: 'todas', todos: 'todas', ambas: 'todas',
      'exceto-turmas': 'exceto-turmas',
    };
    const nome = alias[key];
    if (!nome) {
      throw new Error(`origem inválida: "${origem}" (use comum | turmas | alcada | exceto-turmas | todas)`);
    }
    return TJRSNavigator.TRIBUNAIS[nome];
  }

  /**
   * Resolve um valor de combo informado por nome OU código.
   * @param {string} tipo - orgaos | relatores | classes-processuais | classes-cnj
   * @private
   */
  async _resolverCombo(tipo, valor, codTribunal) {
    const chave = `${tipo}:${codTribunal}`;
    if (!this._combos.has(chave)) {
      const buscar = {
        orgaos: () => this.navigator.listarOrgaosJulgadores(codTribunal),
        relatores: () => this.navigator.listarRelatores(codTribunal),
        'classes-processuais': () => this.navigator.listarTiposDeProcessos(codTribunal),
        'classes-cnj': () => this.navigator.listarClassesCNJ(),
      }[tipo];
      this._combos.set(chave, await buscar());
    }
    const lista = this._combos.get(chave);
    const alvo = String(valor).trim();
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const exato = lista.find(o => o.id === alvo) ||
      lista.find(o => norm(o.label) === norm(alvo)) ||
      lista.find(o => norm(o.label).includes(norm(alvo)));
    if (!exato) {
      throw new Error(`Valor não encontrado no combo ${tipo}: "${valor}". Use --listar-${tipo} para ver as opções.`);
    }
    return exato;
  }

  /**
   * Monta os campos do form#form_busca a partir dos filtros da CLI.
   * @private
   */
  async _buildForm(query, filters = {}) {
    const codTribunal = this._codTribunal(filters.origem);
    const form = {
      q_palavra_chave: query ?? '',
      filtroTribunal: codTribunal,
      conteudo_busca: filters.escopo === 'inteiroTeor'
        ? TJRSNavigator.ESCOPOS.inteiroTeor
        : TJRSNavigator.ESCOPOS.ementa,
      data_julgamento_de: this._toSiteDate(filters.dataJulgamentoInicio),
      data_julgamento_ate: this._toSiteDate(filters.dataJulgamentoFim),
      data_publicacao_de: this._toSiteDate(filters.dataPublicacaoInicio),
      data_publicacao_ate: this._toSiteDate(filters.dataPublicacaoFim),
      ordem: filters.ordenacao === 'antigos' ? 'asc' : 'desc',
    };

    // campos de texto da busca avançada (o servidor monta as cláusulas Solr)
    if (filters.expressao) form.filtroComAExpressao = filters.expressao;
    if (filters.qualquerPalavra) form.filtroComQualquerPalavra = filters.qualquerPalavra;
    if (filters.semPalavras) form.filtroSemAsPalavras = filters.semPalavras;
    if (filters.comarca) form.filtroComarcaOrigem = filters.comarca;
    if (filters.referenciaLegislativa) form.filtroReferenciaLegislativa = filters.referenciaLegislativa;
    if (filters.jurisprudencia) form.filtroJurisprudencia = filters.jurisprudencia;
    if (filters.processo) form.filtroNumeroProcesso = String(filters.processo).replace(/\D/g, '');

    // Seção (Cível / Crime) — checkbox, valor literal
    if (filters.secao === 'civel') form.filtroSecaoCivel = 'civel';
    else if (filters.secao === 'crime') form.filtroSecaoCrime = 'crime';
    else if (filters.secao === 'ambas') { form.filtroSecaoCivel = 'civel'; form.filtroSecaoCrime = 'crime'; }

    // Tipo de decisão — checkboxes; sem nenhum marcado o site traz todos
    for (const t of filters.tipos ?? []) {
      const campo = TJRSNavigator.TIPOS_DECISAO[t];
      if (!campo) {
        throw new Error(`tipo inválido: "${t}" (use acordao | monocratica | admissibilidade | duvida)`);
      }
      form[campo] = t;
    }

    // combos resolvidos por nome ou código
    if (filters.orgaoJulgador) {
      if (codTribunal === '-1' || codTribunal === '0') {
        throw new Error('-oj/--orgao exige --origem comum, turmas ou alcada (o combo de órgãos depende do tribunal)');
      }
      form.filtroOrgaoJulgador = (await this._resolverCombo('orgaos', filters.orgaoJulgador, codTribunal)).id;
    }
    if (filters.relator) {
      form.filtroRelator = (await this._resolverCombo('relatores', filters.relator, codTribunal)).id;
    }
    if (filters.classeCnj) {
      form.filtroClasseCnj = (await this._resolverCombo('classes-cnj', filters.classeCnj, codTribunal)).id;
      if (filters.assuntoCnj) {
        const assuntos = await this.navigator.listarAssuntosCnj(form.filtroClasseCnj);
        const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const alvo = assuntos.find(a => a.id === String(filters.assuntoCnj)) ||
          assuntos.find(a => norm(a.label).includes(norm(String(filters.assuntoCnj))));
        if (!alvo) throw new Error(`Assunto CNJ não encontrado para essa classe: "${filters.assuntoCnj}"`);
        form.assuntoCnj = alvo.id;
      }
    }
    if (filters.classeProcessual) {
      // DUAS RESSALVAS aqui (ver CLAUDE-TJRS.md):
      // 1. O Solr indexa `tipo_processo` como TEXTO. O combo do site manda o id
      //    numérico, e por isso o filtro "Classe Processual" da PÁGINA devolve 0
      //    resultados. Mandamos o LABEL, que funciona.
      // 2. O combo é a lista legada e NÃO cobre todos os valores do índice
      //    (ex.: "Recurso Inominado", com 30 mil julgados nas Turmas Recursais,
      //    não está no combo). Por isso: se não achar no combo, usa o texto
      //    informado como está, em vez de recusar.
      let label = filters.classeProcessual;
      try {
        label = (await this._resolverCombo('classes-processuais', filters.classeProcessual, codTribunal)).label;
      } catch {
        this.log(`AVISO: "${filters.classeProcessual}" não está no combo Classe Processual; usando como texto literal em tipo_processo`);
      }
      form.filtroTipoProcesso = label;
    }

    return form;
  }

  /** Doc cru do Solr -> formato padrão do repo. */
  mapDoc(doc) {
    const result = {
      id: doc.cod_ementa ?? null,
      tipoDocumento: doc.tipo_documento || '',
      numeroProcesso: doc.numero_processo || '',
      processoUrl: this.navigator.processoUrl(doc.numero_processo),
      tribunal: doc.nome_tribunal || '',
      codTribunal: doc.cod_tribunal ?? null,
      orgaoJulgador: doc.orgao_julgador || '',
      classeProcessual: doc.tipo_processo || '',
      classe: doc.nome_classe_cnj || '',
      assunto: doc.nome_assunto_cnj || '',
      secao: doc.secao || '',
      comarcaOrigem: doc.origem || '',
      dataJulgamento: this._toBrDate(doc.data_julgamento),
      dataPublicacao: this._toBrDate(doc.data_publicacao),
      relator: doc.nome_relator || (Array.isArray(doc.relator_redator) ? doc.relator_redator.join('; ') : ''),
      uf: 'RS',
      ementa: this.navigator.ementa(doc).substring(0, 10000),
      inteiroTeorLink: this.navigator.inteiroTeorUrl(doc),
      inteiroTeorDisponivel: !!this.navigator.inteiroTeorHtml(doc),
      segredoJustica: doc.ind_segredo_justica === 'S',
    };
    if (this.includeFullText) {
      result.inteiroTeor = this.navigator.inteiroTeor(doc);
    }
    return result;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   *
   * @param {string} query - pesquisa livre (AND implícito; OR maiúsculo;
   *   -palavra exclui; "frase exata"; +termo força stopword)
   * @param {Object} filters - origem ('comum'|'turmas'|'alcada'|'exceto-turmas'|'todas'),
   *   dataJulgamentoInicio/Fim, dataPublicacaoInicio/Fim (DD/MM/YYYY),
   *   escopo ('ementa'|'inteiroTeor'), secao ('civel'|'crime'|'ambas'),
   *   tipos ['acordao','monocratica','admissibilidade','duvida'],
   *   orgaoJulgador, relator, classeProcessual, classeCnj, assuntoCnj, comarca,
   *   expressao, qualquerPalavra, semPalavras, referenciaLegislativa,
   *   jurisprudencia, processo, ordenacao ('recentes'|'antigos')
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults e .filtroSolr
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const form = await this._buildForm(query, filters);

    const allResults = [];
    const raw = [];
    let totalResults = null;
    let filtroSolr = null;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      this.log(`Extracting results from page ${pagina}...`);
      const data = await this.navigator.buscar(form, pagina);
      if (totalResults === null) {
        totalResults = data.response.numFound ?? 0;
        filtroSolr = data.filtro ? decodeURIComponent(data.filtro) : '';
        this.log(`Total results on server: ${totalResults}`);
        this.log(`Filtro aplicado (Solr): ${filtroSolr || '(nenhum)'}`);
      }
      const docs = data.response.docs || [];
      raw.push(...docs);
      allResults.push(...docs.map(d => this.mapDoc(d)));
      this.log(`Found ${docs.length} results on page ${pagina} (total: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        raw.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (!docs.length || allResults.length >= totalResults) break;
    }

    allResults.totalResults = totalResults;
    allResults.filtroSolr = filtroSolr;
    allResults.raw = raw;
    return allResults;
  }

  /**
   * Grava o inteiro teor de cada resultado em .txt (e opcionalmente .html).
   * NÃO faz nova requisição: o texto já vem no payload da busca.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const docs = results.raw ?? [];
    if (!docs.length) {
      throw new Error('Sem documentos crus para gravar — chame search() antes de fetchInteiroTeorBatch()');
    }
    return this.navigator.baixarLote(docs, outputDir, { log, formats: options.formats ?? ['txt'] });
  }
}

module.exports = TJRSCrawler;
