// src/TJCECrawler.js
const TJCENavigator = require('./TJCENavigator');

/**
 * Crawler for TJCE (Tribunal de Justiça do Ceará) jurisprudência — SJURIS.
 *
 * Como TJPA e TJDFT, este crawler NÃO estende BaseCrawler/Playwright: o SJURIS
 * expõe uma API JSON aberta que já devolve ementa, inteiro teor e o PDF
 * autenticado. O contrato público é o mesmo dos demais:
 *   search(query, filters, options) → Array (com .totalResults anexado).
 */
class TJCECrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? TJCENavigator.SIZE_MAX, TJCENavigator.SIZE_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJCENavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    /** Avisos que o usuário precisa ouvir (ementa vazia etc). */
    this.avisos = [];
  }

  /** Mapeia um documento cru da API para o formato padrão do repo. */
  mapDocumento(d) {
    const ementa = this.navigator.ementa(d);
    const result = {
      // `id` é "<numeroProcesso>_<idDocumento>" — é ELE que identifica o
      // julgado. O nº do processo não serve: um processo tem vários julgados.
      id: d.id,
      idDocumento: d.idDocumento,
      tipoDocumento: d.nomeDocumento || '',
      processo: d.numeroProcesso || '',
      // A SPA vive toda em /tela-consulta: não há permalink por documento.
      processoUrl: null,
      classe: d.classe || d.classeJudicial?.descricaoSistemaOrigem || '',
      assunto: d.assuntoCompleto || d.assunto || '',
      orgaoJulgador: d.orgaoJulgador || '',
      orgaoJulgadorOrigem: d.orgaoJulgadorScpu?.descricaoSistemaOrigem || '',
      relator: d.magistrado || '',
      dataJulgamento: TJCENavigator.fromApiDate(d.dataJulgamento),
      // `dataPublicacao` vem "n/d" na esmagadora maioria dos documentos.
      dataPublicacao: d.dataPublicacao && d.dataPublicacao !== 'n/d'
        ? TJCENavigator.fromApiDate(d.dataPublicacao) || d.dataPublicacao
        : '',
      origem: d.origem || '',
      sistemaOrigem: d.siglaSistema || '',
      situacao: d.situacaoScpu || '',
      uf: 'CE',
      ementa,
      // Sem ementa (monocrática), o texto citável é o inteiro teor — e quem
      // consome precisa saber que é isso, não uma ementa.
      temEmenta: Boolean(ementa),
      inteiroTeorLink: null,
      temInteiroTeor: Boolean(this.navigator.inteiroTeor(d)),
      temPdf: Boolean(d.pdfAutenticadoBase64),
      partes: (d.partes || []).map((p) => ({
        tipo: p.tipoParte,
        nome: p.nomeParte?.nomeOriginal || '',
        advogados: (p.advogados || []).map((a) => `${a.nome?.nomeOriginal || ''} (OAB ${a.numeroOAB || '-'})`),
      })),
    };
    if (this.includeFullText) result.inteiroTeor = this.navigator.inteiroTeor(d);
    return result;
  }

  /** Monta o corpo da API a partir dos filtros no estilo da CLI. @private */
  _buildPayload(query, filters = {}) {
    const { BASES, TIPOS, ORIGENS } = TJCENavigator;

    const baseDocumento = [];
    if (filters.base === 'turmas') baseDocumento.push(BASES.turmas);
    else if (filters.base === 'todos') baseDocumento.push(BASES.comum, BASES.turmas);
    else baseDocumento.push(BASES.comum);

    const nomeDocumento = [];
    if (filters.tipo === 'acordao') nomeDocumento.push(TIPOS.acordao);
    else if (filters.tipo === 'monocratica') nomeDocumento.push(TIPOS.monocratica);
    else if (filters.tipo === 'sumula') nomeDocumento.push(TIPOS.sumula);
    else nomeDocumento.push(TIPOS.acordao, TIPOS.monocratica);

    const payload = {
      busca: query,
      ordenacao: filters.ordenacao === 'recentes' ? 'order2' : 'order1',
      nomeDocumento,
      baseDocumento,
    };

    // Omitir `origem` traz PJE + SAJ juntos, que é o superset — só filtre
    // quando o usuário pedir de propósito.
    if (filters.origem === 'pje') payload.origem = [ORIGENS.pje];
    else if (filters.origem === 'saj') payload.origem = [ORIGENS.saj];

    // ⚠️ o período vai nestes dois campos, NUNCA dentro de `dataJulgamento`.
    const di = TJCENavigator.toApiDate(filters.dataJulgamentoInicio);
    const df = TJCENavigator.toApiDate(filters.dataJulgamentoFim);
    if (di) payload.dataJulgamentoInicial = di;
    if (df) payload.dataJulgamentoFinal = df;

    if (filters.orgaoJulgador) payload.orgaoJulgador = [filters.orgaoJulgador];
    if (filters.relator) payload.magistrado = [filters.relator];
    if (filters.classe) payload.classe = [filters.classe];

    return payload;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   * @param {string} query - texto livre (operadores do portal: e, ou, não,
   *   "frase", ~, $, ?, parênteses)
   * @param {Object} filters - dataJulgamentoInicio/Fim (DD/MM/YYYY),
   *   base ('comum'|'turmas'|'todos'), tipo ('acordao'|'monocratica'|'sumula'|
   *   'ambos'), origem ('pje'|'saj'|'ambas'), ordenacao ('relevancia'|'recentes'),
   *   orgaoJulgador, relator, classe
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults anexado
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const payload = this._buildPayload(query, filters);
    this.avisos = [];

    const allResults = [];
    let totalResults = null;
    let totalPages = 1;

    for (let page = 0; page < maxPages && page < totalPages; page++) {
      this.log(`Extraindo resultados da página ${page + 1}...`);
      const data = await this.navigator.buscar(payload, page, this.pageSize);
      if (totalResults === null) {
        totalResults = data.totalElements ?? null;
        totalPages = data.totalPages ?? 1;
        this.log(`Total no servidor: ${totalResults}`);
      }
      const content = data.content || [];
      allResults.push(...content.map((d) => this.mapDocumento(d)));
      this.log(`${content.length} resultados na página ${page + 1} (acumulado: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        this.log(`Limite de maxResults (${maxResults}) atingido.`);
        break;
      }
      if (!content.length) break;
    }

    // ⚠️ DECISÃO MONOCRÁTICA vem sem ementa. Silenciar isso faz o consumidor
    // ler "sem ementa" como "sem conteúdo" — e o inteiro teor está ali.
    const semEmenta = allResults.filter((r) => !r.temEmenta);
    if (semEmenta.length) {
      const tipos = [...new Set(semEmenta.map((r) => r.tipoDocumento))].join(', ');
      const aviso = `${semEmenta.length} de ${allResults.length} documentos vieram SEM ementa ` +
        `(tipo: ${tipos}). No SJURIS só ACÓRDÃO e TURMA RECURSAL têm ementa indexada; ` +
        `para esses use o inteiro teor (--full-text ou --fetch-inteiro-teor), que já veio na busca.`;
      this.avisos.push(aviso);
      this.log(`AVISO: ${aviso}`);
    }

    allResults.totalResults = totalResults;
    allResults.avisos = this.avisos;
    return allResults;
  }

  /**
   * Grava o inteiro teor de cada resultado. Diferente dos outros tribunais,
   * aqui NÃO há request por documento: o texto veio na busca. Por isso a
   * gravação exige que a busca tenha rodado com includeFullText.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    const docs = results.map((r) => ({
      id: r.id,
      numeroProcesso: r.processo,
      conteudo: r.inteiroTeor ?? '',
      pdfAutenticadoBase64: r.pdfAutenticadoBase64 ?? null,
    }));
    return this.navigator.baixarLote(docs, outputDir, { log, formats: options.formats ?? ['txt'] });
  }

  /** Domínio dos filtros com contagem (órgão, tipo, classe, base, assunto). */
  async listarFiltros() {
    const { CAMPOS } = TJCENavigator;
    const out = {};
    for (const [nome, idx] of Object.entries(CAMPOS)) {
      out[nome] = await this.navigator.listaCampos(idx);
    }
    return out;
  }
}

module.exports = TJCECrawler;
