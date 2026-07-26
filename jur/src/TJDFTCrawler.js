// src/TJDFTCrawler.js
const TJDFTNavigator = require('./TJDFTNavigator');

/**
 * Crawler do TJDFT (JurisDF). Como TJPA e TJMG, não usa browser: fala com a API
 * oficial. Contrato igual ao dos demais: search(query, filters, options) →
 * Array com `.totalResults`.
 *
 * ⚠️ O QUE MUDA A LEITURA DO RESULTADO NESTE TRIBUNAL:
 *
 * 1. Sem o cookie de sessão a API alterna entre DOIS índices dessincronizados.
 *    O Navigator fixa o nó; por isso o crawler REUSA um navigator só durante
 *    toda a paginação. Criar um navigator por página traria lista furada.
 *
 * 2. `espelho` (ementa) e `inteiroTeor` são escopos INDEPENDENTES e somáveis,
 *    não excludentes: medido espelho=3528, inteiroTeor=9441, os dois=9650.
 *    O default do portal é só espelho.
 *
 * 3. Turma Recursal (Juizado) é `subbase='acordaos-tr'`. Filtrar por
 *    `base='acordaos-tr'` devolve 0 SEM ERRO — a agregação mostra o valor
 *    aninhado em `base`, mas ele só filtra em `subbase`.
 */
class TJDFTCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? 20, TJDFTNavigator.TAMANHO_MAX);
    this.navigator = options.navigator ?? new TJDFTNavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? console.log,
    });
    this.log = options.log ?? console.log;
  }

  /** Traduz o filtro de acervo da CLI para os termosAcessorios. @private */
  _termosAcervo(acervo) {
    if (!acervo || acervo === 'todos') return [];
    const b = TJDFTNavigator.BASES[acervo];
    if (!b) {
      throw new Error(
        `Acervo inválido: "${acervo}". Use ${Object.keys(TJDFTNavigator.BASES).join(', ')} ou todos`,
      );
    }
    const t = [];
    // subbase é mais específico que base; quando existe, ele basta e é o que
    // de fato filtra Turma Recursal (ver cabeçalho).
    if (b.subbase) t.push({ campo: 'subbase', valor: b.subbase });
    else t.push({ campo: 'base', valor: b.base });
    return t;
  }

  /** Monta os termosAcessorios completos. @private */
  _termos(filters) {
    const t = this._termosAcervo(filters.acervo);

    const dj = TJDFTNavigator.intervaloData(filters.dataJulgamentoInicio, filters.dataJulgamentoFim);
    if (dj) t.push({ campo: 'dataJulgamento', valor: dj });
    else if (filters.dataJulgamentoInicio || filters.dataJulgamentoFim) {
      throw new Error(
        'A API do TJDFT só aceita intervalo FECHADO de data: informe -di E -df juntos '
        + '(não existe "a partir de" nem "até" — o servidor responde 500).',
      );
    }

    const dp = TJDFTNavigator.intervaloData(filters.dataPublicacaoInicio, filters.dataPublicacaoFim);
    if (dp) t.push({ campo: 'dataPublicacao', valor: dp });
    else if (filters.dataPublicacaoInicio || filters.dataPublicacaoFim) {
      throw new Error('Intervalo de publicação incompleto: informe -dpi E -dpf juntos.');
    }

    for (const [chave, campo] of [
      ['relator', 'nomeRelator'],
      ['revisor', 'nomeRevisor'],
      ['relatorDesignado', 'nomeRelatorDesignado'],
      ['orgao', 'descricaoOrgaoJulgador'],
      ['classe', 'descricaoClasseCnj'],
      ['processo', 'processo'],
    ]) {
      const v = filters[chave];
      if (!v) continue;
      // processo precisa ir mascarado — a API devolve 0 sem a máscara
      t.push({ campo, valor: campo === 'processo' ? TJDFTNavigator.mascaraCNJ(v) : v });
    }
    return t;
  }

  /** Mapeia um registro da API para o formato padrão do repo. */
  mapJulgado(r) {
    const iso = (d) => {
      const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    };
    return {
      id: r.uuid,
      identificador: r.identificador ?? null,
      base: r.base || '',
      subbase: r.subbase || '',
      // "acordaos-tr" é Turma Recursal: quem exibir sem isso mistura Juizado
      // com Justiça Comum sem o leitor perceber.
      juizado: r.subbase === 'acordaos-tr',
      tipoDocumento: r.subbase || r.base || '',
      processo: r.processo || '',
      processoUrl: this.navigator.documentoUrl(r.uuid),
      classe: r.descricaoClasseCnj || '',
      codigoClasseCnj: r.codigoClasseCnj ?? null,
      orgaoJulgador: r.descricaoOrgaoJulgador || r.descricaoOrgao || '',
      relator: r.nomeRelator || '',
      revisor: r.nomeRevisor || '',
      relatorDesignado: r.nomeRelatorDesignado || '',
      dataJulgamento: iso(r.dataJulgamento),
      dataPublicacao: iso(r.dataPublicacao),
      uf: 'DF',
      ementa: r.ementa || '',
      inteiroTeor: r.inteiroTeor || '',
      possuiInteiroTeor: !!r.possuiInteiroTeor,
      inteiroTeorLink: this.navigator.documentoUrl(r.uuid),
    };
  }

  /**
   * Busca principal.
   * @param {string} query - operadores: E, OU, NÃO, "frase", $, PROX<n>, ADJ<n>
   *   ⚠️ PROX/ADJ vão SEM parênteses (PROX5, não PROX(5)) — ver CLAUDE-TJDFT.md
   * @param {Object} filters - acervo, dataJulgamentoInicio/Fim,
   *   dataPublicacaoInicio/Fim (DD/MM/YYYY), relator, revisor, orgao, classe,
   *   processo, escopo ('espelho'|'inteiroTeor'|'ambos'), sinonimos
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    const escopo = filters.escopo || 'espelho';
    if (!['espelho', 'inteiroTeor', 'ambos'].includes(escopo)) {
      throw new Error(`Escopo inválido: "${escopo}". Use espelho, inteiroTeor ou ambos`);
    }
    const termos = this._termos(filters);

    const avisos = [];

    // O zero calado deste tribunal: decisões não têm data de julgamento.
    const usouJulgamento = termos.some((t) => t.campo === 'dataJulgamento');
    if (usouJulgamento) {
      const b = TJDFTNavigator.BASES[filters.acervo] || {};
      const cegos = TJDFTNavigator.SEM_DATA_JULGAMENTO;
      if (b.subbase && cegos.includes(b.subbase)) {
        avisos.push(`--acervo ${filters.acervo} com filtro de data de JULGAMENTO: este acervo não tem `
          + 'esse campo (só data de publicação), então a busca devolve 0 — o que NÃO significa ausência '
          + 'de jurisprudência. Refaça com -dpi/-dpf.');
      } else if (!filters.acervo || filters.acervo === 'todos' || filters.acervo === 'decisoes') {
        avisos.push('filtro de data de JULGAMENTO: decisões monocráticas e da Presidência não têm esse '
          + 'campo e ficam TODAS de fora, sem aparecer como filtro. Use -dpi/-dpf para alcançá-las.');
      }
    }

    if (/PROX\s*\(|ADJ\s*\(/i.test(query || '')) {
      avisos.push('a query usa PROX( ou ADJ( com PARÊNTESES — nesta base isso devolve 0 sem erro, '
        + 'apesar de o botão da tela mostrar "PROX(N)". Escreva PROX5 / ADJ3, sem parênteses.');
    }

    const todos = [];
    const vistos = new Set();
    let duplicatas = 0;
    let totalResults = null;

    for (let pagina = 0; pagina < maxPages; pagina += 1) {
      this.log(`Extracting results from page ${pagina + 1}...`);
      // eslint-disable-next-line no-await-in-loop
      const data = await this.navigator.buscar({
        query: query || '',
        termosAcessorios: termos,
        pagina,
        tamanho: this.pageSize,
        sinonimos: !!filters.sinonimos,
        espelho: escopo === 'espelho' || escopo === 'ambos',
        inteiroTeor: escopo === 'inteiroTeor' || escopo === 'ambos',
        retornaInteiroTeor: true,
      });

      if (totalResults === null) {
        totalResults = (data.hits && (data.hits.value ?? data.hits)) ?? null;
        this.log(`Total results on server: ${totalResults}`);
      }

      const regs = data.registros || [];
      for (const r of regs) {
        const chave = String(r.uuid || r.identificador);
        if (vistos.has(chave)) { duplicatas += 1; continue; }
        vistos.add(chave);
        todos.push(this.mapJulgado(r));
      }
      this.log(`Found ${regs.length} results on page ${pagina + 1} (total: ${todos.length})`);

      if (!regs.length) break;
      if (todos.length >= maxResults) {
        todos.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
    }

    if (duplicatas) {
      avisos.push(`a API repetiu ${duplicatas} documento(s) entre páginas; foram descartados.`);
    }
    for (const a of avisos) this.log(`AVISO: ${a}`);

    todos.totalResults = totalResults;
    todos.duplicatasDescartadas = duplicatas;
    todos.avisos = avisos;
    return todos;
  }

  /** Domínio dos filtros (relator, revisor, orgaoJulgador, base, classe). */
  async listarDominio(query = 'a') {
    return this.navigator.agregacoes(query);
  }

  /** Grava o inteiro teor — já veio no payload, sem request extra. */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, {
      log: options.log ?? this.log,
      formats: options.formats ?? ['txt'],
    });
  }
}

module.exports = TJDFTCrawler;
