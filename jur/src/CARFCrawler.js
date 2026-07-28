// src/CARFCrawler.js
const CARFNavigator = require('./CARFNavigator');

/**
 * Crawler do CARF — contencioso administrativo tributário federal.
 *
 * Como TJPA/TJDFT/TJCE, NÃO estende BaseCrawler/Playwright: a base é um Solr
 * público (o mesmo da tela oficial) que já devolve ementa, dispositivo E o
 * inteiro teor no payload da busca. Contrato público idêntico aos demais:
 *   search(query, filters, options) → Array (com .totalResults anexado).
 */
class CARFCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? 20, CARFNavigator.ROWS_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new CARFNavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    this.avisos = [];
  }

  /** Documento cru do Solr → formato padrão do repo. */
  mapDocumento(d) {
    const ementa = this.navigator.ementa(d);
    const temInteiroTeor = d.arquivo_indexado_s !== 'N' && Boolean(d.conteudo_txt);
    const result = {
      // `id` (do índice) identifica o julgado; o nº do processo não serve —
      // um processo tem vários julgados. O número CITÁVEL é numero_decisao_s.
      id: d.id,
      tipoDocumento: this.navigator.tipoDocumento(d),
      numeroDecisao: d.numero_decisao_s || '',
      processo: d.numero_processo_s || '',
      processoUrl: null,
      orgaoJulgador: [d.turma_s, d.camara_s, d.secao_s].filter(Boolean).join(' / '),
      turma: d.turma_s || '',
      camara: d.camara_s || '',
      secao: d.secao_s || '',
      materia: d.materia_s || '',
      relator: (d.nome_relator_s || '').trim(),
      dataJulgamento: CARFNavigator.fromApiDate(d.dt_sessao_tdt),
      dataPublicacao: CARFNavigator.fromApiDate(d.dt_publicacao_tdt),
      uf: '',
      ementa,
      temEmenta: Boolean(ementa),
      decisao: this.navigator.dispositivo(d),
      // permalink verificável: o PDF original responde 200 sem sessão
      inteiroTeorLink: this.navigator.pdfUrl(d),
      temInteiroTeor,
    };
    if (this.includeFullText) result.inteiroTeor = this.navigator.inteiroTeor(d);
    return result;
  }

  /** Filtros no estilo da CLI → params do Solr. @private */
  _buildParams(query, filters = {}) {
    const { FACETS, RANGE_DATA_SADIO } = CARFNavigator;
    const fq = [];

    if (filters.secao) fq.push(`${FACETS.secao}:"${filters.secao}"`);
    if (filters.camara) fq.push(`${FACETS.camara}:"${filters.camara}"`);
    if (filters.turma) fq.push(`${FACETS.turma}:"${filters.turma}"`);
    if (filters.materia) fq.push(`${FACETS.materia}:"${filters.materia}"`);
    if (filters.relator) fq.push(`${FACETS.relator}:"${filters.relator}"`);

    const rangeSessao = CARFNavigator.rangeData('dt_sessao_tdt', filters.dataSessaoInicio, filters.dataSessaoFim);
    if (rangeSessao) fq.push(rangeSessao);
    const rangePub = CARFNavigator.rangeData('dt_publicacao_tdt', filters.dataPubInicio, filters.dataPubFim);
    if (rangePub) fq.push(rangePub);

    let sort = null;
    if (filters.ordenacao === 'recentes') {
      sort = 'dt_sessao_tdt desc';
      // lixo de data na base (ano 19944 vem primeiro): cerca o range quando
      // o usuário não deu período próprio
      if (!rangeSessao) fq.push(`dt_sessao_tdt:${RANGE_DATA_SADIO}`);
    }

    return { q: query, fq, sort };
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   * @param {string} query - sintaxe Solr/edismax: espaço = E implícito,
   *   NOT/-, "frase", "frase"~N, curinga *. ⚠️ OR é aceito e IGNORADO.
   * @param {Object} filters - dataSessaoInicio/Fim, dataPubInicio/Fim
   *   (DD/MM/YYYY), secao, camara, turma, materia, relator (strings exatas
   *   do facet — use --listar), ordenacao ('relevancia'|'recentes')
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const params = this._buildParams(query, filters);
    this.avisos = [];

    if (/\bOR\b|\bou\b/i.test(String(query))) {
      const aviso = 'A base do CARF IGNORA o operador OU/OR (vira E): rode uma busca por termo ' +
        'e some os resultados, em vez de "a OR b".';
      this.avisos.push(aviso);
      this.log(`AVISO: ${aviso}`);
    }

    const allResults = [];
    let totalResults = null;

    for (let page = 0; page < maxPages; page++) {
      this.log(`Extraindo resultados da página ${page + 1}...`);
      const data = await this.navigator.buscar(params, page * this.pageSize, this.pageSize);
      if (totalResults === null) {
        totalResults = data.numFound ?? null;
        this.log(`Total no servidor: ${totalResults} (exato)`);
      }
      const docs = data.docs || [];
      allResults.push(...docs.map((d) => this.mapDocumento(d)));
      this.log(`${docs.length} resultados na página ${page + 1} (acumulado: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        this.log(`Limite de maxResults (${maxResults}) atingido.`);
        break;
      }
      if (!docs.length || allResults.length >= totalResults) break;
    }

    // 0,3% da base não tem o texto do PDF extraído — quem consome precisa
    // saber que ali só há ementa + dispositivo.
    const semTeor = allResults.filter((r) => !r.temInteiroTeor);
    if (semTeor.length) {
      const aviso = `${semTeor.length} de ${allResults.length} documentos estão sem inteiro teor ` +
        'indexado (arquivo_indexado_s:N) — para esses cite a ementa/dispositivo, e o PDF pode ' +
        'existir mesmo assim no inteiroTeorLink.';
      this.avisos.push(aviso);
      this.log(`AVISO: ${aviso}`);
    }

    allResults.totalResults = totalResults;
    allResults.avisos = this.avisos;
    return allResults;
  }

  /**
   * Grava o inteiro teor (txt do payload; pdf com um GET por documento).
   * O txt NÃO custa request: veio na busca (exige includeFullText? não —
   * o navigator refaz do doc cru; aqui recebemos os mapeados, então busca
   * de novo por id apenas se faltar o texto).
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    const docs = [];
    for (const r of results) {
      docs.push({
        id: r.id,
        numero_decisao_s: r.numeroDecisao,
        nome_arquivo_pdf_s: r.inteiroTeorLink ? r.inteiroTeorLink.split('/').pop() : null,
        conteudo_txt: r.inteiroTeor != null
          ? `Conteúdo =>${r.inteiroTeor}`
          : (await this._docCru(r.id))?.conteudo_txt,
        arquivo_indexado_s: r.temInteiroTeor ? 'S' : 'N',
      });
    }
    return this.navigator.baixarLote(docs, outputDir, { log, formats: options.formats ?? ['txt'] });
  }

  /** Reconsulta um documento pelo id. @private */
  async _docCru(id) {
    const data = await this.navigator.buscar({ q: `id:${id}` }, 0, 1);
    return (data.docs || [])[0] ?? null;
  }

  /** Domínio dos filtros com contagens (facets da tela oficial). */
  async listarFiltros() {
    const out = {};
    for (const nome of Object.keys(CARFNavigator.FACETS)) {
      out[nome] = await this.navigator.facetar(nome);
    }
    return out;
  }
}

module.exports = CARFCrawler;
