// src/TJPACrawler.js
const TJPANavigator = require('./TJPANavigator');

/**
 * Crawler for TJPA (Tribunal de Justiça do Pará) jurisprudência.
 * https://jurisprudencia.tjpa.jus.br
 *
 * Unlike the other crawlers this one does NOT extend BaseCrawler/Playwright:
 * the TJPA SPA exposes an open JSON API (see TJPANavigator) that returns
 * ementa + inteiro teor directly, so searches run over plain HTTP — faster
 * and far more stable than DOM scraping. The public contract is the same:
 * search(query, filters, options) → Array (with .totalResults attached).
 */
class TJPACrawler {
  constructor(options = {}) {
    this.pageSize = options.pageSize ?? 20;
    this.includeFullText = options.includeFullText ?? false;
    this.navigator = options.navigator ?? new TJPANavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? console.log,
    });
  }

  /**
   * Convert DD/MM/YYYY (CLI standard) to YYYY-MM-DD (API format).
   * Dates already in YYYY-MM-DD pass through.
   * @private
   */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Convert YYYY-MM-DD to DD/MM/YYYY for output. @private */
  _toBrDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  }

  /**
   * Map a raw API decision to the repo's standard result shape.
   */
  mapDecisao(d) {
    const idStr = String(d.id ?? '');
    const result = {
      id: d.id,
      // internal id = "9999" + nº do acórdão/decisão mostrado na interface
      numeroDocumento: idStr.startsWith('9999') && idStr.length > 4 ? idStr.slice(4) : idStr,
      tipoDocumento: d.tipo || '',
      numeroProcesso: d.numeroprocesso || '',
      processoUrl: this.navigator.documentoUrl(d.id),
      classe: d.classe?.nome || '',
      assuntos: (d.assuntos || []).map(a => a.nome).filter(Boolean).join('; '),
      area: d.area || '',
      origem: d.origem || '',
      orgaoJulgador: d.orgaojulgador?.nome || '',
      orgaoJulgadorColegiado: d.orgaojulgadorcolegiado?.nome || '',
      dataJulgamento: this._toBrDate(d.datajulgamento),
      dataPublicacao: this._toBrDate(d.datapublicacao),
      dataDocumento: this._toBrDate(d.datadocumento),
      relator: (d.pessoas || []).join('; '),
      uf: 'PA',
      ementa: (this.navigator.ementa(d) || '').substring(0, 10000),
      inteiroTeorLink: this.navigator.documentoUrl(d.id),
      scoreRelevancia: d.scoreRelevancia ?? null,
    };
    if (this.includeFullText) {
      result.inteiroTeor = this.navigator.inteiroTeor(d);
    }
    return result;
  }

  /**
   * Build the API payload from CLI-style filters.
   * @private
   */
  _buildPayload(query, filters = {}) {
    const origem = [];
    if (filters.origem === 'turmas') origem.push(TJPANavigator.ORIGENS.turmas);
    else if (filters.origem === 'ambas') origem.push(TJPANavigator.ORIGENS.tjpa, TJPANavigator.ORIGENS.turmas);
    else origem.push(TJPANavigator.ORIGENS.tjpa);

    const tipo = [];
    if (filters.tipo === 'acordao') tipo.push(TJPANavigator.TIPOS.acordao);
    else if (filters.tipo === 'monocratica') tipo.push(TJPANavigator.TIPOS.monocratica);
    else tipo.push(TJPANavigator.TIPOS.acordao, TJPANavigator.TIPOS.monocratica);

    return {
      query,
      queryType: filters.tipoConsulta === 'anywords' ? 'anywords' : 'free',
      queryScope: filters.escopo === 'inteiroTeor' ? 'inteiroTeor' : 'ementa',
      origem,
      tipo,
      classe: filters.classe || undefined,
      assunto: filters.assunto || undefined,
      relatores: filters.relatores?.length ? filters.relatores : undefined,
      orgaoJulgadorColegiado: filters.orgaoJulgadorColegiado || undefined,
      dataJulgamentoInicio: this._toApiDate(filters.dataJulgamentoInicio),
      dataJulgamentoFim: this._toApiDate(filters.dataJulgamentoFim),
      dataPublicacaoInicio: this._toApiDate(filters.dataPublicacaoInicio),
      dataPublicacaoFim: this._toApiDate(filters.dataPublicacaoFim),
      size: this.pageSize,
    };
  }

  /**
   * Main search. Same contract as BaseCrawler.search().
   * @param {string} query
   * @param {Object} filters - dataJulgamentoInicio/Fim, dataPublicacaoInicio/Fim
   *   (DD/MM/YYYY), origem ('tjpa'|'turmas'|'ambas'), tipo ('acordao'|
   *   'monocratica'|'ambos'), escopo ('ementa'|'inteiroTeor'), tipoConsulta
   *   ('free'|'anywords'), classe, assunto, relatores [..],
   *   orgaoJulgadorColegiado, ordenacao ('relevancia'|'recentes'|'antigos')
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} mapped results with .totalResults attached
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const payload = this._buildPayload(query, filters);

    const allResults = [];
    let totalResults = null;
    let totalPages = 1;

    for (let page = 0; page < maxPages && page < totalPages; page++) {
      console.log(`Extracting results from page ${page + 1}...`);
      const data = await this.navigator.buscar({ ...payload, page });
      if (totalResults === null) {
        totalResults = data.totalElements ?? null;
        totalPages = data.totalPages ?? 1;
        console.log(`Total results on server: ${totalResults}`);
        if (data.excedeuLimiteTecnico) {
          console.log(`AVISO: ${data.mensagemLimiteTecnico}`);
        }
      }
      const content = data.content || [];
      allResults.push(...content.map(d => this.mapDecisao(d)));
      console.log(`Found ${content.length} results on page ${page + 1} (total: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        console.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (!content.length) break;
    }

    // The backend only sorts by relevância; date ordering is client-side
    // (same as the official SPA does).
    if (filters.ordenacao === 'recentes' || filters.ordenacao === 'antigos') {
      const dir = filters.ordenacao === 'recentes' ? -1 : 1;
      const key = r => {
        const m = r.dataJulgamento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? `${m[3]}${m[2]}${m[1]}` : '';
      };
      allResults.sort((a, b) => dir * key(a).localeCompare(key(b)));
    }

    allResults.totalResults = totalResults;
    return allResults;
  }

  /**
   * Download the inteiro teor of each result as .txt (and optionally .html).
   * Results here are mapped results from search(); the text is re-fetched
   * by processo number via the navigator.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const raw = [];
    for (const r of results) {
      raw.push({ ...r, numeroprocesso: r.numeroProcesso });
    }
    return this.navigator.baixarLote(raw, outputDir, { log, formats: options.formats ?? ['txt'] });
  }
}

module.exports = TJPACrawler;
