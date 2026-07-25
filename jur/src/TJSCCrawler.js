// src/TJSCCrawler.js
const TJSCNavigator = require('./TJSCNavigator');

/**
 * Crawler do TJSC (Tribunal de Justiça de Santa Catarina).
 * Portal alvo: o novo módulo de jurisprudência do e-Proc
 * https://eprocwebcon.tjsc.jus.br/consulta1g/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 *
 * Como TJRS/TJPA/TJGO, NÃO estende BaseCrawler: quem é dono da sessão é o
 * TJSCNavigator, porque a sessão aqui não é trivial (há um desafio F5 a vencer)
 * e o Checker precisa exatamente da mesma sessão. Manter a montagem do browser
 * em um lugar só evita duas implementações do warm-up.
 *
 * Contrato público idêntico ao dos demais: search(query, filters, options)
 * devolve um Array com `.totalResults` anexado.
 *
 * A DESAMBIGUAÇÃO OBRIGATÓRIA (Justiça Comum × Juizados Especiais) é o filtro
 * `origem`, que vira o combo "Origem" (#selOrigem) da tela:
 *   comum         -> TJSC                     (Justiça Comum, 2º grau)
 *   turmas        -> Turmas Recursais         (Juizados Especiais)
 *   uniformizacao -> Turmas de Uniformização  (Juizados Especiais)
 *   conselho      -> Conselho da Magistratura (administrativo)
 */
class TJSCCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJSCNavigator({
      headless: options.headless ?? true,
      slowMo: options.slowMo ?? 0,
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    this.ownsNavigator = !options.navigator;
  }

  /**
   * 'turmas' | 'juizados' | ... -> chave canônica.
   * @returns {string} chave de TJSCNavigator.ORIGENS ou 'todas'
   */
  static chaveOrigem(origem) {
    const chave = TJSCNavigator.ORIGENS_ALIAS[String(origem ?? 'comum').toLowerCase()];
    if (!chave) {
      throw new Error(
        `origem inválida: "${origem}" (use comum | turmas | uniformizacao | conselho | todas)`,
      );
    }
    return chave;
  }

  /** Chave canônica -> códigos do #selOrigem. @private */
  _codigosOrigem(chave) {
    return chave === 'todas' ? Object.values(TJSCNavigator.ORIGENS) : [TJSCNavigator.ORIGENS[chave]];
  }

  /**
   * Resolve os tipos de documento pedidos.
   *
   * ARMADILHA: o combo #selTipoDocumento é recarregado por AJAX a cada troca de
   * origem e os códigos NÃO se repetem entre origens (acórdão é 1 no TJSC e 7
   * nas Turmas Recursais). Por isso a tradução é sempre relativa à origem, e com
   * `--origem todas` não há tradução possível — recusamos em vez de mandar um
   * código que o servidor ignoraria em silêncio.
   * @private
   */
  _codigosTipo(chaveOrigem, tipos = []) {
    if (!tipos.length) return [];
    if (chaveOrigem === 'todas') {
      throw new Error('-t/--tipo exige uma --origem específica (os códigos de tipo de documento mudam por origem)');
    }
    const mapa = TJSCNavigator.TIPOS_DOCUMENTO[chaveOrigem];
    return tipos.map((t) => {
      const codigo = mapa[String(t).toLowerCase()];
      if (!codigo) {
        throw new Error(
          `tipo inválido para --origem ${chaveOrigem}: "${t}" (disponíveis: ${Object.keys(mapa).join(', ')})`,
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
   * Casa um valor informado pelo usuário com uma opção do combo.
   * Os combos do TJSC usam o PRÓPRIO TEXTO como value ("3ª Câmara de Direito
   * Civil"), então o casamento é textual: exato, depois sem acento, depois
   * "contém".
   * @private
   */
  async _resolverCombo(id, valores, rotulo) {
    const lista = await this.navigator.opcoes(id);
    const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return valores.map((v) => {
      const alvo = norm(v);
      const achado = lista.find((o) => o.id === v)
        || lista.find((o) => norm(o.label) === alvo)
        || lista.find((o) => norm(o.id) === alvo)
        || lista.find((o) => norm(o.label).includes(alvo));
      if (!achado) {
        throw new Error(`${rotulo} não encontrado no combo: "${v}". Use --listar-combos para ver as opções da origem escolhida.`);
      }
      return achado.id;
    });
  }

  /** Item cru do navigator -> formato padrão do repo. */
  mapResult(r) {
    // "5014543-38.2025.8.24.0054/TJSC" -> número + sufixo de origem
    const [numero, sufixo] = String(r.numeroProcesso || '').split('/');
    return {
      id: r.id || null,
      tipoDocumento: r.tipoDocumento || '',
      numeroProcesso: (numero || '').trim(),
      sufixoOrigem: (sufixo || '').trim(),
      processo: (numero || '').trim(),
      processoUrl: r.processoUrl || null,
      classe: r.classe || '',
      orgaoJulgador: r.orgaoJulgador || '',
      dataJulgamento: r.dataJulgamento || '',
      dataPublicacao: r.dataPublicacao || '',
      relator: r.relator || '',
      uf: r.uf || 'SC',
      decisao: (r.decisao || '').substring(0, 10000),
      ementa: (r.ementa || r.citacao || '').substring(0, 10000),
      citacao: (r.citacao || '').substring(0, 2000),
      inteiroTeorLink: r.inteiroTeorLink || null,
    };
  }

  /**
   * Busca principal.
   *
   * @param {string} query
   * @param {Object} filters origem, tipos[], escopo ('ementa'|'inteiroTeor'),
   *   dataInicio/dataFim, dataPubInicio/dataPubFim (DD/MM/YYYY), processo,
   *   orgaos[], relatores[], classes[], precedenteRelevante, ordenacao
   * @param {Object} options maxPages, maxResults, tamanhoPagina
   * @returns {Array} resultados mapeados, com .totalResults / .origemAplicada
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const tamanhoPagina = options.tamanhoPagina ?? 10;

    const chave = TJSCCrawler.chaveOrigem(filters.origem);
    const origens = this._codigosOrigem(chave);
    const tiposDocumento = this._codigosTipo(chave, filters.tipos ?? []);

    const todos = [];
    try {
      await this.navigator.abrir();

      // combos dependem da origem: fixamos a origem ANTES de resolver nomes
      await this.navigator.definirOrigem(origens);
      const orgaos = filters.orgaos?.length ? await this._resolverCombo('selOrgao', filters.orgaos, 'Órgão julgador') : [];
      const relatores = filters.relatores?.length ? await this._resolverCombo('selRelator', filters.relatores, 'Relator') : [];
      const classes = filters.classes?.length ? await this._resolverCombo('selClasse', filters.classes, 'Classe') : [];

      const { total } = await this.navigator.pesquisar({
        query,
        origens,
        tiposDocumento,
        escopo: filters.escopo,
        dataDecisaoInicio: this._data(filters.dataInicio),
        dataDecisaoFim: this._data(filters.dataFim),
        dataPublicacaoInicio: this._data(filters.dataPubInicio),
        dataPublicacaoFim: this._data(filters.dataPubFim),
        processo: filters.processo,
        orgaos,
        relatores,
        classes,
        precedenteRelevante: filters.precedenteRelevante,
        ordenacao: filters.ordenacao,
        tamanhoPagina,
      });
      this.log(`Total results on server: ${total ?? '(desconhecido)'}`);
      this.log(`Origem aplicada: ${origens.map((c) => TJSCNavigator.ORIGENS_LABEL[c]).join(' + ')}`);

      for (let pagina = 1; pagina <= maxPages; pagina++) {
        this.log(`Extracting results from page ${pagina}...`);
        const crus = await this.navigator.extrair();
        todos.push(...crus.map((r) => this.mapResult(r)));
        this.log(`Found ${crus.length} results on page ${pagina} (total: ${todos.length})`);

        if (todos.length >= maxResults) {
          todos.length = maxResults;
          this.log(`Reached maxResults limit (${maxResults}), stopping.`);
          break;
        }
        if (!crus.length) break;
        if (pagina >= maxPages) break;
        if (!(await this.navigator.temProximaPagina())) break;
        if (!(await this.navigator.proximaPagina())) {
          this.log('Paginação não avançou; encerrando.');
          break;
        }
      }

      todos.totalResults = total;
      todos.origemAplicada = origens.map((c) => TJSCNavigator.ORIGENS_LABEL[c]);
      return todos;
    } finally {
      // `keepOpen` existe por causa do inteiro teor: o download reaproveita os
      // cookies do desafio F5, então a sessão precisa sobreviver à busca.
      if (this.ownsNavigator && !options.keepOpen) await this.navigator.fechar();
    }
  }

  /** Fecha a sessão do browser (só necessário depois de search({keepOpen:true})). */
  async close() {
    if (this.ownsNavigator) await this.navigator.fechar();
  }

  /**
   * Grava o inteiro teor dos resultados. Exige a MESMA sessão da busca (cookies
   * do desafio F5) — chame search() com `{ keepOpen: true }` antes.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, { log: options.log ?? this.log, formats: options.formats ?? ['txt'] });
  }
}

module.exports = TJSCCrawler;
