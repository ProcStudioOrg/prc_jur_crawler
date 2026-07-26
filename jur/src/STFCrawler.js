// src/STFCrawler.js
const STFNavigator = require('./STFNavigator');

/**
 * Crawler do STF (Supremo Tribunal Federal).
 * https://jurisprudencia.stf.jus.br
 *
 * Como TJPA e TRT9, este crawler **não dirige o navegador**: fala direto com a
 * API (`POST /api/search/search`). O Playwright entra uma única vez, e só para
 * resolver o desafio do AWS WAF — ver `STFNavigator.token()`.
 *
 * A base é dividida em 4 acervos ("bases"), e a escolha muda TUDO
 * (campos, filtros e contagem):
 *
 *   acordaos      368.511 docs — decisões colegiadas (Pleno e Turmas), desde 1892
 *   decisoes      741.676 docs — decisões monocráticas (seleção), desde 1968
 *   sumulas           799 docs — 736 simples + 63 VINCULANTES, desde 1963
 *   informativos   11.571 docs — resumos da Secretaria, desde 1995
 *
 * A desambiguação do STF não é Juizado × Justiça Comum (não existe Juizado no
 * STF). É por **órgão** (Tribunal Pleno × Turmas) e por **classe processual**
 * (ADI, ADPF, ADC, RE, ARE, HC, MS...). Ambas são filtros de verdade — as
 * contagens estão em `CLAUDE-STF.md`.
 */
class STFCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? 100, 250);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new STFNavigator({
      timeout: options.timeout ?? 60000,
      headless: options.headless ?? true,
      log: this.log,
    });
  }

  /** DD/MM/YYYY (padrão da CLI) → DDMMYYYY (formato aceito pelo range do ES). @private */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[1]}${br[2]}${br[3]}`;
    if (/^\d{8}$/.test(d)) return d;
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** YYYY-MM-DD → DD/MM/YYYY. @private */
  _toBrDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  }

  /** Traduz as flags da CLI para os parâmetros da API. */
  montarFiltros(filters = {}) {
    const f = {};
    const bf = {};

    if (filters.orgao) f.orgao_julgador = String(filters.orgao).split(',').map((s) => s.trim()).filter(Boolean);
    if (filters.ministro) f.ministro_facet = String(filters.ministro).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (filters.classe) f.processo_classe_processual_unificada_classe_sigla = String(filters.classe).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (filters.uf) f.procedencia_geografica_uf_sigla = String(filters.uf).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    const dj = { from: this._toApiDate(filters.dataJulgamentoInicio), until: this._toApiDate(filters.dataJulgamentoFim) };
    if (dj.from || dj.until) f.julgamento_data = dj;
    const dp = { from: this._toApiDate(filters.dataPublicacaoInicio), until: this._toApiDate(filters.dataPublicacaoFim) };
    if (dp.from || dp.until) f.publicacao_data = dp;

    if (filters.repercussaoGeral === true) bf.is_repercussao_geral = true;
    if (filters.repercussaoGeral === false) bf.is_repercussao_geral = false;
    if (filters.vinculante === true) bf.is_vinculante = true;
    if (filters.vinculante === false) bf.is_vinculante = false;
    if (filters.questaoOrdem) bf.is_questao_ordem = true;
    if (filters.coletanea) bf.is_colac = true;
    if (filters.presidencia === true) bf.is_decisao_presidencia = true;
    if (filters.presidencia === false) bf.is_decisao_presidencia = false;

    const adv = {};
    for (const k of ['classeNumeroIncidente', 'ementaAtaIndexacao', 'tese', 'tema', 'partes', 'legislacao', 'observacao']) {
      if (filters[k]) adv[k] = filters[k];
    }

    return {
      base: filters.base || 'acordaos',
      filters: f,
      baseFilters: bf,
      advancedFilters: adv,
      fieldFilters: {
        sinonimo: filters.sinonimos !== false,
        plural: filters.plural !== false,
        radicais: !!filters.radicais,
        buscaExata: filters.buscaExata !== false,
        pesquisa_inteiro_teor: !!filters.inteiroTeor,
      },
      sort: filters.ordenacao === 'recentes' || filters.ordenacao === 'antigos' ? 'date' : '_score',
      sortBy: filters.ordenacao === 'antigos' ? 'asc' : 'desc',
    };
  }

  /** Converte um hit cru da API para o formato padrão do repo. */
  mapDocumento(h, base) {
    const tipo = {
      acordaos: 'Acórdão',
      decisoes: 'Decisão monocrática',
      sumulas: h.is_vinculante ? 'Súmula vinculante' : 'Súmula',
      informativos: 'Informativo',
    }[base] || base;

    const relator = h.relator_processo_nome || h.relator_decisao_nome || h.relator_acordao_nome
      || (Array.isArray(h.ministro_facet) ? h.ministro_facet.join('; ') : h.ministro_facet) || '';

    const ementa = h.ementa_texto || h.sumula_texto || h.resumo_noticia || h.decisao_texto || '';

    const r = {
      id: h._id,
      tipoDocumento: tipo,
      base,
      // No STF o identificador natural é CLASSE + NÚMERO + INCIDENTE ("ARE 1596565 AgR").
      // Não existe número CNJ na base de jurisprudência — ver CLAUDE-STF.md §Checker.
      processo: h.processo_codigo_completo || h.titulo || '',
      numeroProcesso: h.processo_codigo_completo || h.titulo || '',
      classe: h.processo_classe_processual_unificada_classe_sigla || '',
      classeExtenso: h.processo_classe_processual_unificada_extenso || '',
      incidente: h.processo_classe_processual_unificada_incidente_sigla || '',
      numero: h.processo_numero ?? null,
      processoUrl: this.navigator.documentoUrl(h._id),
      orgaoJulgador: h.orgao_julgador || '',
      dataJulgamento: this._toBrDate(h.julgamento_data),
      dataPublicacao: this._toBrDate(h.publicacao_data),
      relator,
      redatorAcordao: h.relator_acordao_nome || '',
      uf: h.procedencia_geografica_uf_sigla || '',
      origem: h.procedencia_geografica_completo || '',
      ementa: String(ementa).substring(0, 20000),
      decisao: String(h.acordao_ata || '').substring(0, 8000),
      indexacao: String(h.documental_indexacao_texto || '').substring(0, 8000),
      tema: h.documental_tese_tema_texto || '',
      tese: h.documental_tese_texto || '',
      legislacaoCitada: h.documental_legislacao_citada_texto || '',
      jurisprudenciaCitada: h.documental_jurisprudencia_citada_texto || '',
      partes: h.partes_lista_texto || '',
      publicacaoDje: h.documental_publicacao_lista_texto || '',
      repercussaoGeral: !!h.is_repercussao_geral,
      sumulaVinculante: !!h.is_vinculante,
      situacaoSumula: h.situacao_sumula || '',
      ramoDireito: h.ramo_direito || '',
      questaoOrdem: !!h.is_questao_ordem,
      coletanea: !!h.is_colac,
      informativo: h.volume_informativo ?? null,
      acompanhamentoUrl: h.acompanhamento_processual_url || '',
      djeUrl: h.dje_url || '',
      inteiroTeorLink: h.inteiro_teor_url || this.navigator.documentoUrl(h._id),
      temInteiroTeorIndexado: !!h.inteiro_teor_texto,
      scoreRelevancia: h._score ?? null,
    };
    if (this.includeFullText && h.inteiro_teor_texto) r.inteiroTeor = h.inteiro_teor_texto;
    return r;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   * @returns {Array} resultados mapeados, com `.totalResults` anexado
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const cfg = this.montarFiltros(filters);
    const base = cfg.base;

    const todos = [];
    let total = null;

    for (let page = 0; page < maxPages; page++) {
      // Teto duro do Elasticsearch: nenhum registro além do 10.000º é acessível.
      if (this.pageSize * page >= 10000) {
        this.log('AVISO: limite técnico do STF (10.000 registros por consulta) atingido — refine com datas/filtros.');
        break;
      }
      this.log(`Extracting results from page ${page + 1}...`);
      const r = await this.navigator.buscar({ ...cfg, queryString: query || undefined, page, pageSize: this.pageSize });
      if (total === null) {
        total = r.total;
        this.log(`Total results on server: ${total}`);
        if (total > 10000) this.log('AVISO: mais de 10.000 resultados; só os 10.000 primeiros são acessíveis.');
      }
      todos.push(...r.hits.map((h) => this.mapDocumento(h, base)));
      this.log(`Found ${r.hits.length} results on page ${page + 1} (total: ${todos.length})`);

      if (todos.length >= maxResults) { todos.length = maxResults; break; }
      if (!r.hits.length || todos.length >= total) break;
    }

    todos.totalResults = total;
    return todos;
  }

  /**
   * Salva o inteiro teor de cada resultado em .txt. Na base Acórdãos o texto já
   * veio no índice (`inteiro_teor_texto`), então isto é I/O local: nada de
   * requisição extra. Quando o campo está vazio, cai para o PDF do portal.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });
    const saida = [];

    for (const r of results) {
      const nome = `${(r.processo || r.id).replace(/[^\w.-]+/g, '_')}.txt`;
      const destino = path.join(outputDir, nome);
      try {
        let texto = r.inteiroTeor;
        if (!texto) {
          const doc = await this.navigator.buscar({ base: r.base || 'acordaos', pageSize: 1, advancedFilters: { classeNumeroIncidente: r.processo } });
          const achado = doc.hits.find((h) => h._id === r.id) || doc.hits[0];
          const it = await this.navigator.inteiroTeor(achado);
          if (it.texto) texto = it.texto;
          else if (it.pdf) {
            const pdfPath = destino.replace(/\.txt$/, '.pdf');
            fs.writeFileSync(pdfPath, it.pdf);
            saida.push({ processo: r.processo, arquivo: pdfPath, fonte: 'pdf' });
            log(`  ${r.processo}: PDF salvo (${it.pdf.length} bytes)`);
            continue;
          }
        }
        if (!texto) { saida.push({ processo: r.processo, arquivo: null, erro: 'inteiro teor indisponível' }); continue; }
        const cabecalho = [
          `PROCESSO: ${r.processo}`, `ÓRGÃO: ${r.orgaoJulgador}`, `RELATOR: ${r.relator}`,
          `JULGAMENTO: ${r.dataJulgamento}`, `PUBLICAÇÃO: ${r.dataPublicacao}`,
          `URL: ${r.processoUrl}`, '', '='.repeat(70), '',
        ].join('\n');
        fs.writeFileSync(destino, cabecalho + texto, 'utf-8');
        saida.push({ processo: r.processo, arquivo: destino, fonte: 'indice' });
        log(`  ${r.processo}: ${texto.length} caracteres`);
      } catch (e) {
        saida.push({ processo: r.processo, arquivo: null, erro: e.message });
        log(`  ${r.processo}: ERRO ${e.message}`);
      }
    }
    return saida;
  }
}

module.exports = STFCrawler;
