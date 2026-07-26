// src/TJMGCrawler.js
const TJMGNavigator = require('./TJMGNavigator');

/**
 * Crawler do TJMG (Tribunal de Justiça de Minas Gerais).
 * https://consulta-jurisprudencia.tjmg.jus.br/pesquisa
 *
 * Como o TJPA, não estende BaseCrawler/Playwright: a consulta unificada expõe
 * uma API JSON aberta (ver TJMGNavigator) e a busca roda em HTTP puro. Contrato
 * público igual ao dos demais: search(query, filters, options) → Array com
 * `.totalResults`.
 *
 * ⚠️ DUAS COISAS QUE MUDAM COMO SE LÊ O RESULTADO:
 *
 * 1. `totalResults` satura em 1000 (teto do contador da API, não do acervo).
 *    Quando bate no teto o crawler expõe `.totalResultsExato = false` — quem
 *    exibir "1000 resultados" sem isso está afirmando um número que a API não
 *    afirmou. Para contagem exata, estreite a janela até cair abaixo de 1000.
 *
 * 2. O campo `ementa` só é ementa de verdade quando o tipo é "Acórdão". Nos
 *    outros três tipos a API não devolve ementa (é o mesmo fato de eles não
 *    terem ementa indexada) e o campo cai para os TRECHOS destacados. O
 *    booleano `ementaEhTrecho` distingue os dois casos — confira-o antes de
 *    citar. `trechos` traz os destaques sempre, para os dois casos.
 */
class TJMGCrawler {
  constructor(options = {}) {
    this.pageSize = options.pageSize ?? 20;
    this.navigator = options.navigator ?? new TJMGNavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? console.log,
    });
    this.log = options.log ?? console.log;
  }

  /** DD/MM/AAAA (padrão da CLI) → YYYY-MM-DD (padrão da API). @private */
  _toApiDate(d) {
    if (!d) return undefined;
    const iso = TJMGNavigator.paraISO(d);
    if (!iso) throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
    return iso;
  }

  /**
   * Monta o intervalo no formato da API. `fim` pode ser null (intervalo aberto),
   * mas um par totalmente vazio não deve virar entrada nenhuma — array vazio
   * significa "sem filtro".
   * @private
   */
  _intervalo(inicio, fim) {
    const i = this._toApiDate(inicio);
    const f = this._toApiDate(fim);
    if (!i && !f) return [];
    return [{ inicio: i ?? null, fim: f ?? null }];
  }

  /**
   * Traduz o filtro de tipo da CLI para os nomes exatos da API.
   * `todos` (default) = sem filtro = Justiça Comum + Juizado misturados.
   * @private
   */
  _tiposDocumento(tipo) {
    const T = TJMGNavigator.TIPOS_DOCUMENTO;
    switch (tipo) {
      case 'acordao': return [T.acordao];
      case 'monocratica': return [T.monocratica];
      case 'turmas': return [T.turmas];
      case 'vice': return [T.vice];
      case 'comum': return [T.acordao, T.monocratica];
      case 'todos': case undefined: case null: case '': return [];
      default: throw new Error(
        `Tipo inválido: "${tipo}". Use acordao, monocratica, turmas, vice, comum ou todos`,
      );
    }
  }

  /**
   * Avisos sobre a combinação escopo × tipo, ANTES de rodar a busca.
   *
   * Existe porque só "Acórdão" tem ementa indexada (ver
   * TJMGNavigator.SEM_EMENTA_INDEXADA): no escopo ementa os outros três tipos
   * devolvem 0 sempre. Um `0` aqui se lê como "não há jurisprudência sobre o
   * tema" quando o certo é "essa pergunta precisa de --escopo inteiroTeor".
   * @returns {Array<string>}
   * @private
   */
  _avisosEscopo(tipos, tipoTexto) {
    if (tipoTexto !== 'EMENTA') return [];
    const cegos = TJMGNavigator.SEM_EMENTA_INDEXADA;

    if (!tipos.length) {
      return ['escopo=ementa: só "Acórdão" tem ementa indexada no TJMG, então esta busca '
        + 'devolve NA PRÁTICA só acórdãos. Decisão Monocrática, Turma Recursal (Juizado) e '
        + 'Vice-Presidência ficam de fora, sem aparecer como filtro. Use --escopo inteiroTeor '
        + 'para alcançá-las.'];
    }
    const bloqueados = tipos.filter((t) => cegos.includes(t));
    if (!bloqueados.length) return [];
    if (bloqueados.length === tipos.length) {
      return [`escopo=ementa com --tipo restrito a ${bloqueados.join(', ')}: estes tipos NÃO têm `
        + 'ementa indexada no TJMG e a busca vai devolver 0 — o que não significa ausência de '
        + 'jurisprudência. Repita com --escopo inteiroTeor.'];
    }
    return [`escopo=ementa: ${bloqueados.join(', ')} não têm ementa indexada e não vão aparecer `
      + 'nos resultados. Use --escopo inteiroTeor para incluí-los.'];
  }

  /** Mapeia um julgado da API para o formato padrão do repo. */
  mapJulgado(j) {
    const processo = TJMGNavigator.mascaraCNJ(j.numeroProcessoCnj);

    // Trechos com o termo destacado. Servem de fallback, não de ementa.
    const trechos = Object.values(j.highlights || {})
      .flat()
      .map((t) => String(t).replace(/<\/?b>/g, '').trim())
      .filter(Boolean);

    // A busca DEVOLVE a ementa — mas só de "Acórdão" (medido 20/20 em ambos os
    // escopos). Os outros três tipos vêm sem, pelo mesmo motivo de não terem
    // ementa indexada (ver SEM_EMENTA_INDEXADA). Para esses, o melhor que existe
    // é o trecho, e `ementaEhTrecho` diz que é isso — citar trecho como ementa
    // é citar recorte no lugar do todo.
    const ementaReal = (j.ementa && String(j.ementa).trim()) || '';

    return {
      id: j.id,
      documentoId: j.documentoId ?? null,
      documentoHash: j.documentoHash ?? null,
      tipoDocumento: j.tipoDocumento || '',
      processo,
      processoUrl: this.navigator.processoUrl(j.numeroProcessoCnj),
      numeroProcessoTj: j.numeroProcessoTj || '',
      classe: j.classe || '',
      assuntos: (j.assuntos || []).filter(Boolean).join('; '),
      comarca: j.comarca || '',
      orgaoJulgador: j.orgaoJulgador || '',
      relator: j.magistrado || '',
      // pode vir ausente — a própria tela mostra "<DATA NÃO IDENTIFICADA>".
      // Devolvemos vazio de propósito: nunca substituir pela data de publicação.
      dataJulgamento: j.julgamentoData || '',
      dataPublicacao: j.publicacaoData || '',
      uf: 'MG',
      ementa: ementaReal || trechos.join(' [...] '),
      ementaEhTrecho: !ementaReal,
      trechos: trechos.join(' [...] '),
      inteiroTeorLink: this.navigator.documentoUrl(j.documentoId, j.publicacaoData),
    };
  }

  /**
   * Busca principal.
   * @param {string} query - operadores do Elasticsearch: + | - "frase" ( ) * ~
   *   ⚠️ E/OU/NÃO em português são IGNORADOS pela API, sem aviso.
   * @param {Object} filters - dataJulgamentoInicio/Fim, dataPublicacaoInicio/Fim
   *   (DD/MM/YYYY), tipo (acordao|monocratica|turmas|vice|comum|todos),
   *   escopo ('ementa'|'inteiroTeor'), comarcas[], orgaos[], magistrados[],
   *   classes[], assuntos[], ordenacao (relevancia|recentes|julgamento)
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults e .totalResultsExato
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    // valida localmente: a API responde 500 a sort desconhecido, e chegar lá
    // custa a ida à rede mais os retries do Navigator.
    const ordenacao = filters.ordenacao || 'relevancia';
    if (!TJMGNavigator.ORDENACOES[ordenacao]) {
      throw new Error(
        `Ordenação inválida: "${ordenacao}". Use ${Object.keys(TJMGNavigator.ORDENACOES).join(', ')}`,
      );
    }

    // idem para o escopo: escrever "inteiroteor" no lugar de "inteiroTeor"
    // caía silenciosamente em EMENTA e subcontava por duas ordens de grandeza.
    const escopo = filters.escopo || 'ementa';
    if (!['ementa', 'inteiroTeor'].includes(escopo)) {
      throw new Error(`Escopo inválido: "${escopo}". Use ementa ou inteiroTeor`);
    }

    const tipoTexto = escopo === 'inteiroTeor' ? 'INTEIRO_TEOR' : 'EMENTA';
    const tiposDocumento = this._tiposDocumento(filters.tipo);
    const avisos = this._avisosEscopo(tiposDocumento, tipoTexto);
    for (const a of avisos) this.log(`AVISO: ${a}`);

    const filtro = {
      texto: query || '',
      tipoTexto,
      tiposDocumento,
      datasJulgamento: this._intervalo(filters.dataJulgamentoInicio, filters.dataJulgamentoFim),
      datasPublicacao: this._intervalo(filters.dataPublicacaoInicio, filters.dataPublicacaoFim),
      comarcas: filters.comarcas ?? [],
      orgaosJulgadores: filters.orgaos ?? [],
      magistrados: filters.magistrados ?? [],
      classes: filters.classes ?? [],
      assuntos: filters.assuntos ?? [],
    };

    const todos = [];
    // A API não desempata a ordenação por um campo único, então documentos com
    // a mesma data (ou o mesmo score) podem cair em mais de uma página — e, pela
    // mesma razão, outros podem ser PULADOS. Medido: ordenando por publicação,
    // 1 rodada em 3 devolveu 14 repetidos em 60. Deduplicar corrige o que dá
    // para corrigir do lado do cliente; o que foi pulado é perda do servidor e
    // por isso vira aviso em vez de ficar invisível.
    const vistos = new Set();
    let duplicatas = 0;
    let totalResults = null;

    for (let page = 0; page < maxPages; page += 1) {
      this.log(`Extracting results from page ${page + 1}...`);
      // eslint-disable-next-line no-await-in-loop
      const data = await this.navigator.buscar(filtro, { page, size: this.pageSize, sort: ordenacao });

      if (totalResults === null) {
        totalResults = data.totalRecords ?? null;
        if (totalResults >= TJMGNavigator.TETO_CONTADOR) {
          this.log(`Total results on server: ${totalResults}+ (contador da API satura em ${TJMGNavigator.TETO_CONTADOR})`);
        } else {
          this.log(`Total results on server: ${totalResults}`);
        }
      }

      const itens = data.jurisprudencias || [];
      for (const j of itens) {
        const chave = String(j.id);
        if (vistos.has(chave)) { duplicatas += 1; continue; }
        vistos.add(chave);
        todos.push(this.mapJulgado(j));
      }
      this.log(`Found ${itens.length} results on page ${page + 1} (total: ${todos.length})`);

      // parar por página vazia, NÃO por totalRecords: o contador satura em 1000
      // mas a paginação continua entregando resultados muito além disso.
      if (!itens.length) break;
      if (todos.length >= maxResults) {
        todos.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
    }

    if (duplicatas) {
      const aviso = `a API repetiu ${duplicatas} documento(s) entre páginas (ordenação sem desempate). `
        + 'Os repetidos foram descartados, mas o mesmo defeito costuma PULAR outros documentos: '
        + 'para varredura exaustiva, fatie a busca por data em vez de paginar fundo.';
      this.log(`AVISO: ${aviso}`);
      avisos.push(aviso);
    }

    todos.totalResults = totalResults;
    todos.totalResultsExato = totalResults !== null && totalResults < TJMGNavigator.TETO_CONTADOR;
    todos.duplicatasDescartadas = duplicatas;
    todos.avisos = avisos;
    return todos;
  }

  /** Enumera um combo com contagens (tiposDocumento, classes, comarcas, ...). */
  async listarDominio(field, filtro = {}) {
    return this.navigator.dominio(field, filtro);
  }

  /**
   * Confere os valores de comarca/órgão/magistrado/classe/assunto contra a lista
   * real da API, ANTES de buscar.
   *
   * Existe porque um valor errado não dá erro: a API aceita e devolve 0. E o
   * modo mais fácil de errar aqui é involuntário — 18 dos 575 órgãos julgadores
   * têm VÍRGULA no nome ("2º Titular Tr - Belo Horizonte, Betim E Contagem
   * [cível]"), e todos os 18 são de Turma Recursal, justamente o caminho que os
   * docs mandam usar para Juizado. Quem separasse por vírgula partiria o nome ao
   * meio e receberia zero achando que não há jurisprudência.
   *
   * @param {Object} filters - o mesmo objeto de search()
   * @throws {Error} listando o valor não encontrado e os candidatos parecidos
   */
  async validarFiltros(filters = {}) {
    const mapa = {
      comarcas: 'comarcas',
      orgaos: 'orgaosJulgadores',
      magistrados: 'magistrados',
      classes: 'classes',
      assuntos: 'assuntos',
    };
    const normal = (s) => String(s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    for (const [chave, campo] of Object.entries(mapa)) {
      const valores = filters[chave] || [];
      if (!valores.length) continue;
      // eslint-disable-next-line no-await-in-loop
      const dominio = await this.navigator.dominio(campo);
      const indice = new Map(dominio.map((d) => [normal(d.dominio), d.dominio]));

      for (const v of valores) {
        if (indice.has(normal(v))) continue;
        const alvo = normal(v);
        const parecidos = dominio
          .map((d) => d.dominio)
          .filter((d) => normal(d).includes(alvo) || alvo.includes(normal(d)))
          .slice(0, 5);
        const dica = parecidos.length
          ? `\n  Você quis dizer:\n    ${parecidos.join('\n    ')}`
          : `\n  Liste os valores válidos com: ./bin/jur tjmg --listar ${campo}`;
        throw new Error(
          `Valor não existe em ${campo}: "${v}".${dica}\n`
          + '  (a API aceitaria e devolveria 0 sem avisar — por isso isto falha aqui)',
        );
      }
    }
  }

  /** Baixa o inteiro teor de cada resultado como .txt (e .html se pedido). */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, {
      log: options.log ?? this.log,
      formats: options.formats ?? ['txt'],
    });
  }
}

module.exports = TJMGCrawler;
