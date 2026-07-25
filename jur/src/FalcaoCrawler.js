// src/FalcaoCrawler.js
const FalcaoNavigator = require('./FalcaoNavigator');
const { stripHtml } = require('./inteiroTeorFetcher');

/**
 * Crawler da base FALCÃO (jurisprudência de toda a Justiça do Trabalho).
 *
 * Camada de FAMÍLIA, igual ao FalcaoNavigator: serve TST + os 24 TRTs.
 * Um tribunal concreto é `new FalcaoCrawler({ tribunal: 'TRT9' })`.
 *
 * Não estende BaseCrawler: o Falcão é API JSON pura, sem browser (mesma
 * decisão do TJPACrawler).
 *
 * A COLEÇÃO É O EIXO. Cada coleção é um índice próprio com schema próprio;
 * a busca acontece em UMA coleção por vez. Isso é o que torna a separação de
 * instância inequívoca: um resultado de `sentencas` é 1º grau, ponto.
 * `--grau ambos` roda as duas consultas e concatena, marcando cada item.
 */
class FalcaoCrawler {
  constructor(options = {}) {
    this.tribunal = options.tribunal ?? null;
    this.pageSize = options.pageSize ?? 10; // servidor só aceita 5 ou 10
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new FalcaoNavigator({
      tribunal: this.tribunal,
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
  }

  /** DD/MM/YYYY (padrão da CLI) -> YYYY-MM-DD (o que a API aceita). @private */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /**
   * Normaliza um documento de qualquer coleção para o formato do repo.
   * Os quatro schemas são DIFERENTES — este método é o adaptador.
   */
  mapDocumento(d, colecao) {
    const meta = FalcaoNavigator.COLECOES[colecao] || {};
    const tribunal = d.tribunal || this.tribunal || '';

    // órgão julgador: cada coleção nomeia o campo de um jeito
    const orgao =
      d.orgaoJulgadorPorExtenso ||           // sentencas, recursorevista
      d.turma ||                              // acordaos (colegiado)
      d.orgaoJulgador ||                      // decisoesmonocraticas (string), precedentes
      d.descricaoOrgao || '';
    const orgaoColegiado = d.orgaoJulgadorColegiadoPorExtenso || d.turma || '';
    const gabinete = d.gabinete || (colecao === 'decisoesmonocraticas' ? d.orgaoJulgador : '') || '';

    const html = this.navigator.inteiroTeor(d, colecao);

    const r = {
      id: String(
        d.idDocumentoAcordao ?? d.idSentenca ?? d.idDocumento ?? d.idRecursoRevista ?? d.id ?? ''
      ),
      colecao,
      colecaoRotulo: meta.rotulo || colecao,
      // A DESAMBIGUAÇÃO, explícita em cada resultado:
      grau: meta.grau || '',
      instancia: meta.descricao || '',
      tipoDocumento: d.tipoDocumento || meta.rotulo || '',
      tribunal,
      uf: FalcaoNavigator.UF_POR_TRIBUNAL[tribunal] || '',
      processo: d.numeroProcesso || '',
      numeroProcesso: d.numeroProcesso || '',
      classe: d.classeProcessualPorExtenso || d.classeProcesso || '',
      classeSigla: d.classeProcessual || d.siglaClasseProcesso || '',
      orgaoJulgador: orgao,
      orgaoJulgadorColegiado: orgaoColegiado,
      gabinete,
      // Em recursorevista o documento aponta também a Vara de origem — 1º grau
      // dentro de um documento de 2º grau. Não confundir com `orgaoJulgador`.
      orgaoJulgadorOrigem1Grau: d.orgaoJulgadorGrau1PorExtenso || '',
      relator: d.relator || d.nomeRelator || '',
      redator: d.nomeRedator || '',
      dataJulgamento: d.dataJulgamento || '',
      dataJuntada: d.dataJuntada || '',
      dataPublicacao: d.dataPublicacao || '',
      prioridades: d.prioridades || null,
      referenciaLegislativa: d.referenciaLegislativa || null,
      possuiEmenta: d.possuiEmenta === 'S' || !!d.ementa,
      // a API devolve a ementa como HTML com estilo inline; normalizamos para texto
      ementa: stripHtml(String(this.navigator.ementa(d, colecao) || '')).substring(0, 10000),
      // Não há permalink por documento no Falcão (verificado: nenhum endpoint
      // de documento no bundle). A prova de existência é a consulta por número.
      inteiroTeorLink: null,
      scoreRelevancia: d.score ?? null,
    };
    // html guardado fora do JSON de saída, para --fetch-inteiro-teor
    Object.defineProperty(r, '_inteiroTeorHtml', { value: html, enumerable: false });
    if (this.includeFullText) r.inteiroTeor = html;
    return r;
  }

  /** @private Uma coleção, paginada. */
  async _buscarColecao(query, filters, colecao, maxPages, maxResults) {
    const p = {
      texto: query || '',
      colecao,
      dataInicio: this._toApiDate(filters.dataInicio),
      dataFim: this._toApiDate(filters.dataFim),
      orgaoJulgador: filters.orgaoJulgador || undefined,
      nomeRelator: filters.relator || undefined,
      classeProcesso: filters.classe || undefined,
      prioridade: filters.prioridade || undefined,
      temEmenta: filters.temEmenta || undefined,
      pesquisaSomenteNasEmentas: filters.escopo === 'ementa' ? true : false,
      ordenacao: FalcaoNavigator.ORDENACOES[filters.ordenacao || 'relevancia'],
      tribunais: filters.tribunais !== undefined ? filters.tribunais : undefined,
    };

    const out = [];
    let total = null;
    const teto = Math.min(maxPages, FalcaoNavigator.LIMITES.maxPage + 1);
    for (let page = 0; page < teto; page++) {
      this.log(`[${colecao}] página ${page + 1}...`);
      const data = await this.navigator.pesquisar({ ...p, page, size: this.pageSize });
      if (total === null) {
        total = data.quantidadeTotal ?? 0;
        this.log(`[${colecao}] total no servidor: ${total}${total >= FalcaoNavigator.LIMITES.tetoContagem ? ' (saturado — 10 mil ou mais)' : ''}`);
      }
      const docs = data.documentos || [];
      out.push(...docs.map((d) => this.mapDocumento(d, colecao)));
      this.log(`[${colecao}] ${docs.length} nesta página (acumulado: ${out.length})`);
      if (docs.length < this.pageSize) break;
      if (out.length >= maxResults) { out.length = maxResults; break; }
      if (out.length >= FalcaoNavigator.LIMITES.maxResultados) {
        this.log(`[${colecao}] teto de ${FalcaoNavigator.LIMITES.maxResultados} do usuário anônimo atingido — fatie por data ou órgão para ir além`);
        break;
      }
    }
    return { itens: out, total };
  }

  /**
   * Busca principal. Mesmo contrato dos demais crawlers do repo.
   *
   * @param {string} query
   * @param {Object} filters
   *   - colecoes: string[] — a DESAMBIGUAÇÃO. default ['acordaos'].
   *   - dataInicio/dataFim: DD/MM/YYYY (data de julgamento/juntada)
   *   - orgaoJulgador, relator, classe, prioridade, temEmenta ('S'|'N')
   *   - escopo: 'ementa' (só ementa) | 'inteiroTeor' (default)
   *   - ordenacao: 'relevancia' | 'recentes' | 'antigos'
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults e .totaisPorColecao
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const colecoes = (filters.colecoes && filters.colecoes.length)
      ? filters.colecoes
      : ['acordaos'];

    for (const c of colecoes) {
      if (!FalcaoNavigator.COLECOES[c]) {
        throw new Error(`Coleção desconhecida: "${c}" (use ${Object.keys(FalcaoNavigator.COLECOES).join(', ')})`);
      }
    }

    const todos = [];
    const totaisPorColecao = {};
    for (const c of colecoes) {
      const restante = maxResults === Infinity ? Infinity : Math.max(0, maxResults - todos.length);
      if (restante === 0) break;
      const { itens, total } = await this._buscarColecao(query, filters, c, maxPages, restante);
      totaisPorColecao[c] = total;
      todos.push(...itens);
    }

    todos.totalResults = Object.values(totaisPorColecao).reduce((a, b) => a + (b || 0), 0);
    todos.totaisPorColecao = totaisPorColecao;
    return todos;
  }

  /** Grava o inteiro teor dos resultados em disco (sem novo acesso à rede). */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, {
      log: options.log ?? this.log,
      formats: options.formats ?? ['txt'],
    });
  }
}

module.exports = FalcaoCrawler;
