// src/TJRJCrawler.js
const fs = require('fs');
const path = require('path');
const TJRJNavigator = require('./TJRJNavigator');

/**
 * Crawler do TJRJ (Tribunal de Justiça do Rio de Janeiro) — módulo e-Proc.
 *
 * **Sem browser** — ver `TJRJNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * ESCOPO (a ressalva mais importante deste tribunal):
 *   Esta base cobre só o 2º grau da Justiça Comum no sistema e-Proc (decisões
 *   de ~2023 em diante). Turmas Recursais/Juizados Especiais e o acervo
 *   histórico estão no eJURIS legado, que está mapeado
 *   (human-codegen/TJRJ/01-ejuris/) mas ainda não tem crawler. Quando o pedido
 *   for de Juizado Especial fluminense, diga isso ao usuário em vez de fingir
 *   cobertura — ver CLAUDE-TJRJ.md.
 */
class TJRJCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJRJNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /**
   * Traduz as opções do CLI para o formulário do site.
   * @param {Object} filters
   * @param {string} filters.escopo   `ementa` (default) | `inteiroTeor`
   * @param {string} filters.tipo     `todas` (default) | `acordao` | `monocratica`
   * @param {string} filters.orgao    label exato ou trecho do órgão julgador
   * @param {string} filters.relator  label exato ou trecho do relator
   * @param {string} filters.classe   label exato ou trecho da classe
   */
  async montarFiltros(query, filters = {}) {
    const N = TJRJNavigator;
    const escopo = N.ESCOPOS[filters.escopo ?? 'ementa'];
    if (!escopo) throw new Error(`escopo inválido: "${filters.escopo}" (use ementa ou inteiroTeor)`);

    const tipo = filters.tipo ?? 'todas';
    let tiposDocumento;
    if (tipo === 'todas') tiposDocumento = [N.TIPOS_DOCUMENTO.acordao, N.TIPOS_DOCUMENTO.monocratica];
    else if (N.TIPOS_DOCUMENTO[tipo]) tiposDocumento = [N.TIPOS_DOCUMENTO[tipo]];
    else throw new Error(`tipo inválido: "${tipo}" (use todas, acordao ou monocratica)`);

    // os combos avançados usam o LABEL como value; resolvemos trechos contra a
    // lista viva do site para o filtro não ser ignorado em silêncio
    const resolver = async (campo, termo, lista) => {
      if (!termo) return [];
      const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const exato = lista.find((x) => norm(x) === norm(termo));
      const parcial = lista.filter((x) => norm(x).includes(norm(termo)));
      if (exato) return [exato];
      if (parcial.length === 1) return parcial;
      if (parcial.length > 1) {
        throw new Error(`${campo} ambíguo: "${termo}" casa com ${parcial.length} opções ` +
          `(${parcial.slice(0, 5).join('; ')}${parcial.length > 5 ? '; …' : ''})`);
      }
      throw new Error(`${campo} não encontrado: "${termo}" (use --listar-combos)`);
    };

    let orgaos = [], relatores = [], classes = [];
    if (filters.orgao || filters.relator || filters.classe) {
      const listas = await this.navigator.listas();
      orgaos = await resolver('órgão julgador', filters.orgao, listas.orgaos);
      relatores = await resolver('relator', filters.relator, listas.relatores);
      classes = await resolver('classe', filters.classe, listas.classes);
    }

    return {
      query: query ?? '',
      escopo,
      tiposDocumento,
      orgaos,
      relatores,
      classes,
      processo: filters.processo || '',
      dataDecisaoInicio: filters.dataJulgamentoInicio || '',
      dataDecisaoFim: filters.dataJulgamentoFim || '',
      dataPublicacaoInicio: filters.dataPublicacaoInicio || '',
      dataPublicacaoFim: filters.dataPublicacaoFim || '',
      precedenteRelevante: Boolean(filters.precedenteRelevante),
      ordem: N.ORDENS[filters.ordem ?? 'recentes'] ?? N.ORDENS.recentes,
    };
  }

  /**
   * Executa a busca paginada (10 julgados por página — limite do site).
   * @returns {Array<Object>} julgados no formato do repositório
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = await this.montarFiltros(query, filters);
    const vistos = new Set();
    const todos = [];
    let total = 0;
    let paginas = 1;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.buscar({ ...base, pagina });
      total = r.total;
      paginas = r.paginas;
      if (pagina === 1) {
        this.log(`Total no TJRJ (e-Proc): ${total} julgado(s) — ${paginas} página(s) de ${TJRJNavigator.POR_PAGINA}`);
      }
      const novos = r.resultados.filter((x) => {
        const chave = x.id || `${x.numeroProcesso}|${x.dataJulgamento}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
      todos.push(...novos);
      this.log(`Página ${pagina}/${Math.min(maxPages, paginas)}: ${novos.length} julgado(s) (acumulado ${todos.length})`);
      if (!TJRJNavigator.temProximaPagina(r) || pagina >= paginas) break;
    }

    this.ultimaBusca = {
      totalTJRJ: total,
      paginasDisponiveis: paginas,
      escopo: base.escopo,
      tiposDocumento: base.tiposDocumento,
      orgao: base.orgaos[0] ?? null,
      relator: base.relatores[0] ?? null,
      classe: base.classes[0] ?? null,
    };
    return todos;
  }

  /**
   * Baixa o inteiro teor de cada resultado — um GET por julgado, sem browser.
   * O documento vem como HTML (~1 MB); salvamos o texto extraído.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    const minCachedSize = options.minCachedSize ?? 2000;
    fs.mkdirSync(outputDir, { recursive: true });

    const saida = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nomeBase = String(r.numeroProcesso || r.id || `r${i}`).replace(/[^\w.\-]/g, '_');
      const arquivo = `${nomeBase}.txt`;
      const destino = path.join(outputDir, arquivo);

      if (fs.existsSync(destino) && fs.statSync(destino).size > minCachedSize) {
        log(`  [${i + 1}/${results.length}] cache ${nomeBase}`);
        saida.push({ ...r, arquivo });
        continue;
      }
      if (!r.inteiroTeorLink && !r.id) {
        saida.push({ ...r, arquivo: null, downloadError: 'julgado sem id nem link de inteiro teor' });
        continue;
      }
      try {
        const doc = await this.navigator.inteiroTeor(r.inteiroTeorLink || r.id);
        const texto = [
          `Processo: ${r.numeroProcesso}`,
          `Tipo: ${r.tipoDocumento}`,
          `Classe: ${r.classe}`,
          `Órgão Julgador: ${r.orgaoJulgador}`,
          `Relator: ${r.relator}`,
          `Data de Julgamento: ${r.dataJulgamento}`,
          `Data de Publicação: ${r.dataPublicacao}`,
          r.citacao ? `Citação: ${r.citacao}` : '',
          `URL: ${doc.url}`,
          '', '=== EMENTA ===', r.ementa || '',
          '', '=== INTEIRO TEOR ===', doc.texto || '(não disponível neste documento)',
        ].join('\n');
        fs.writeFileSync(destino, texto, 'utf-8');
        log(`  [${i + 1}/${results.length}] ${nomeBase} — ${doc.texto.length} chars` +
          (doc.temInteiroTeor ? '' : ' (sem inteiro teor)'));
        saida.push({ ...r, arquivo, temInteiroTeor: doc.temInteiroTeor });
      } catch (err) {
        log(`  [${i + 1}/${results.length}] ${nomeBase} FALHOU: ${err.message}`);
        saida.push({ ...r, arquivo: null, downloadError: err.message });
      }
    }

    const indice = path.join(outputDir, 'index.json');
    fs.writeFileSync(indice, JSON.stringify(saida, null, 2), 'utf-8');
    log(`Índice salvo em: ${indice}`);
    return saida;
  }

  /** Compatibilidade com a API baseada em browser (no-ops). */
  async init() { return this; }
  async close() { return this; }
}

module.exports = TJRJCrawler;
