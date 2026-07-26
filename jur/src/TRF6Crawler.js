// src/TRF6Crawler.js
const TRF6Navigator = require('./TRF6Navigator');

/**
 * Crawler do TRF6 (Tribunal Regional Federal da 6ª Região — Minas Gerais).
 *
 * Portal alvo: o módulo de jurisprudência do e-Proc
 * https://eproc-jur.trf6.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 *
 * Como TRF2/TJRS/TJGO/TJPA, NÃO estende BaseCrawler: quem fala com o site é o
 * TRF6Navigator, e aqui não há browser nenhum — o portal responde a POST direto.
 *
 * A DESAMBIGUAÇÃO OBRIGATÓRIA (Justiça Federal comum × Juizados Especiais
 * Federais) é o filtro `origem`, que vira o combo "Origem" (#selOrigem):
 *   trf6   -> TRF6             (2º grau da Justiça Federal comum)
 *   turmas -> Turmas Recursais (2º grau dos Juizados Especiais Federais de MG)
 *   tru    -> TRU6             (Turma Regional de Uniformização — Juizados)
 *   varas  -> Varas Federais   (1º grau — DECLARADA E VAZIA, ver aviso abaixo)
 *
 * ⚠️ ABRANGÊNCIA: a base começa em 2023 (o TRF6 foi instalado em ago/2022).
 * Jurisprudência federal de MG anterior a isso está no TRF1 — ver CLAUDE-TRF6.md.
 *
 * Contrato público idêntico ao dos demais: search(query, filters, options)
 * devolve um Array com `.totalResults` anexado.
 */
class TRF6Crawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TRF6Navigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    this.ownsNavigator = !options.navigator;
  }

  /** 'juizados' | 'jef' | ... -> chave canônica de TRF6Navigator.ORIGENS (ou 'todas'). */
  static chaveOrigem(origem) {
    const chave = TRF6Navigator.ORIGENS_ALIAS[String(origem ?? 'trf6').toLowerCase()];
    if (!chave) {
      throw new Error(`origem inválida: "${origem}" (use trf6 | turmas | tru | varas | todas)`);
    }
    return chave;
  }

  /** Chave canônica -> códigos do #selOrigem. @private */
  _codigosOrigem(chave) {
    return chave === 'todas' ? Object.values(TRF6Navigator.ORIGENS) : [TRF6Navigator.ORIGENS[chave]];
  }

  /**
   * Tipos de documento pedidos -> códigos.
   *
   * Os códigos NÃO mudam com a origem (Acórdão é sempre 1). O que muda é quais
   * existem: Súmula e Despacho da Vice-Presidência só há na origem TRF6;
   * Sentença só nas Varas Federais. Pedir um tipo inexistente na origem devolveria
   * 0 em silêncio (o servidor ignora o filtro), então recusamos alto.
   * @private
   */
  _codigosTipo(chaveOrigem, tipos = []) {
    if (!tipos.length) return [];
    return tipos.map((t) => {
      const chave = String(t).toLowerCase();
      const codigo = TRF6Navigator.TIPOS_DOCUMENTO[chave];
      if (!codigo) {
        throw new Error(`tipo inválido: "${t}" (use ${Object.keys(TRF6Navigator.TIPOS_DOCUMENTO).join(', ')})`);
      }
      const disponiveis = TRF6Navigator.TIPOS_POR_ORIGEM[chaveOrigem];
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

  /**
   * Avisos que dependem do recorte pedido — o crawler prefere falar em vez de
   * devolver uma lista vazia que o usuário lê como "não há jurisprudência".
   * @private
   */
  _avisosDeEscopo(chaveOrigem, filters) {
    const avisos = [];
    if (chaveOrigem === 'varas') {
      avisos.push(
        'TRF6: a origem "Varas Federais" (1º grau) existe no combo do site mas está VAZIA — ' +
        '0 documentos em qualquer termo (medido em 25/07/2026). Não há sentença de 1º grau ' +
        'nesta base; use --origem trf6 (2º grau) ou --origem turmas (Juizados).',
      );
    }
    const anoDe = (d) => (d ? Number(String(d).slice(-4)) : null);
    const inicio = anoDe(filters.dataInicio) ?? anoDe(filters.dataPubInicio);
    const fim = anoDe(filters.dataFim) ?? anoDe(filters.dataPubFim);
    if ((fim && fim < 2023) || (inicio && inicio < 2023 && !fim)) {
      avisos.push(
        'TRF6: a base começa em 2023 (o tribunal foi instalado em ago/2022 e desmembrado do ' +
        'TRF1). Qualquer recorte anterior devolve 0. A jurisprudência federal de Minas Gerais ' +
        'até 2022 está no TRF1 — use `./bin/jur trf1`.',
      );
    }
    return avisos;
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
   * @param {string} query termo livre. Diferente do TRF2, aqui a query vai
   *   INTACTA para o servidor: o espaço funciona como E e hifenizar quebraria
   *   `ou`/`não`. Ver TRF6Navigator.normalizarQuery.
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

    const chave = TRF6Crawler.chaveOrigem(filters.origem);
    const origens = this._codigosOrigem(chave);
    const tiposDocumento = this._codigosTipo(chave, filters.tipos ?? []);

    const avisos = this._avisosDeEscopo(chave, filters);
    let queryEnviada = String(query ?? '');
    if (!filters.literal) {
      const n = TRF6Navigator.normalizarQuery(query);
      queryEnviada = n.query;
      if (n.aviso) avisos.push(n.aviso);
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
    this.log(`Origem aplicada: ${origens.map((c) => TRF6Navigator.ORIGENS_LABEL[c]).join(' + ')}`);

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
    todos.origemAplicada = origens.map((c) => TRF6Navigator.ORIGENS_LABEL[c]);
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

module.exports = TRF6Crawler;
