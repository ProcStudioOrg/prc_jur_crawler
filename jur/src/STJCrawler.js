// src/STJCrawler.js
const STJNavigator = require('./STJNavigator');

/**
 * Crawler do STJ (Superior Tribunal de Justiça) — portal SCON.
 *
 * Como TJSC/TJRS/TJPA, NÃO estende BaseCrawler: quem é dono da sessão é o
 * STJNavigator, porque a sessão aqui custa caro (um desafio Cloudflare que só
 * cai em modo headful) e o Checker precisa exatamente da mesma sessão.
 *
 * A DESAMBIGUAÇÃO no STJ não é Juizado × Justiça Comum — é corte de
 * superposição, não há primeiro grau nem juizado. Ela é:
 *
 *   1. por ÓRGÃO JULGADOR  (--orgao / --secao) — e é substantiva:
 *      Seção 1 = direito público · Seção 2 = direito privado · Seção 3 = penal
 *   2. por TIPO DE DOCUMENTO (--base) — acórdão × decisão monocrática × súmula
 *
 * Ambas são provadas por contagem em CLAUDE-STJ.md.
 */
class STJCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new STJNavigator({
      headless: options.headless ?? false,
      slowMo: options.slowMo ?? 0,
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ownsNavigator = !options.navigator;
  }

  /** 'acordao' | 'monocratica' | ... -> chave canônica de BASES. */
  static chaveBase(base) {
    const chave = STJNavigator.BASES_ALIAS[String(base ?? 'acordao').toLowerCase()];
    if (!chave) {
      throw new Error(`--base inválida: "${base}" (use ${Object.keys(STJNavigator.BASES).join(' | ')})`);
    }
    return chave;
  }

  /**
   * Nomes/siglas informados -> códigos do filtro `orgao`.
   * Aceita "T3", "terceira-turma", "TERCEIRA TURMA", "Corte Especial".
   */
  static codigosOrgao(valores = []) {
    const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/\s+/g, '-');
    return valores.map((v) => {
      const bruto = String(v).trim().toUpperCase();
      if (STJNavigator.ORGAOS[bruto]) return bruto;
      const alias = STJNavigator.ORGAOS_ALIAS[norm(v)];
      if (alias) return alias;
      // casa pelo nome exibido ("PRIMEIRA SEÇÃO")
      const porNome = Object.entries(STJNavigator.ORGAOS)
        .find(([, nome]) => norm(nome) === norm(v));
      if (porNome) return porNome[0];
      throw new Error(
        `órgão julgador inválido: "${v}". Válidos: ${Object.entries(STJNavigator.ORGAOS)
          .map(([c, n]) => `${c} (${n})`).join(', ')}`,
      );
    });
  }

  /** '--secao 2' | 'privado' -> ['S2','T3','T4'] */
  static codigosSecao(secao) {
    const chave = String(secao).toLowerCase().replace(/[ªº]/g, '').trim();
    const lista = STJNavigator.SECOES[chave] ?? STJNavigator.SECOES[Number(chave)];
    if (!lista) {
      throw new Error(`--secao inválida: "${secao}" (use 1|2|3, publico|privado|penal, corte)`);
    }
    return lista;
  }

  /** Chave amigável -> expressão do combo Notas. */
  static expressaoNota(nota) {
    if (!nota) return '';
    const chave = String(nota).toLowerCase().trim();
    if (STJNavigator.NOTAS[chave]) return STJNavigator.NOTAS[chave];
    // permite passar a expressão crua (a Secretaria de Jurisprudência publica outras)
    if (/[A-Z$()]/.test(nota)) return String(nota);
    throw new Error(`--nota inválida: "${nota}" (use ${Object.keys(STJNavigator.NOTAS).join(' | ')})`);
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
   * Card cru do SCON -> formato padrão do repo.
   *
   * O campo "Processo" do espelho vem com três linhas coladas:
   *   "REsp 2031813 / SC" + "RECURSO ESPECIAL" + "2022/0314287-3"
   * — respectivamente: recurso + UF de origem, classe por extenso e o
   * NÚMERO DE REGISTRO do STJ (é ele, e não um número CNJ, que identifica o
   * processo aqui; ver CLAUDE-STJ.md, "Duas numerações").
   */
  mapResult(r) {
    const c = r.campos || {};
    const processoBruto = c.Processo || '';
    const linhas = processoBruto.split('\n').map((s) => s.trim()).filter(Boolean);
    const cabecalho = linhas[0] || '';
    const [recurso, uf] = cabecalho.split('/').map((s) => s.trim());
    // O registro é SEMPRE guardado em 12 dígitos crus (201901160800) — é o
    // formato que o SCON aceita na consulta e o que a auditoria compara. O
    // comentário `<!-- REGISTRO: -->` já vem assim; o do campo Processo vem
    // mascarado (2019/0116080-0) e precisa ser normalizado, sob pena de a
    // auditoria comparar "2019/0116080-0" com "201901160800" e acusar
    // divergência num julgado correto.
    const registroBruto = r.registro || (processoBruto.match(/(\d{4}\/\d{7}-\d)/) || [])[1] || null;
    const registro = registroBruto ? registroBruto.replace(/\D/g, '') : null;

    const publicacao = c['Data da Publicação/Fonte'] || '';
    const dataPublicacao = (publicacao.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';

    return {
      id: r.id || null,
      registro,
      tipoDocumento: linhas[1] || 'ACÓRDÃO',
      processo: recurso || r.identificacao || '',
      numeroProcesso: recurso || '',
      identificacao: r.identificacao || '',
      processoUrl: r.processoUrl || (registro ? `https://processo.stj.jus.br/processo/pesquisa/?num_registro=${registro.replace(/\D/g, '')}` : null),
      classe: linhas[1] || '',
      orgaoJulgador: c['Órgão Julgador'] || '',
      dataJulgamento: c['Data do Julgamento'] || '',
      dataPublicacao,
      fonte: publicacao,
      relator: c.Relator || '',
      relatorAcordao: c['Relator p/ Acórdão'] || c['Relator(a) p/ Acórdão'] || '',
      uf: (uf || '').toUpperCase(),
      ementa: (c.Ementa || '').substring(0, 20000),
      tese: (c.Tese || c['Tese Jurídica'] || '').substring(0, 10000),
      acordao: (c.Acórdão || '').substring(0, 10000),
      notas: (c.Notas || '').substring(0, 5000),
      referenciaLegislativa: (c['Referência Legislativa'] || '').substring(0, 5000),
      precedenteQualificado: r.precedenteQualificado || null,
      tema: r.tema || null,
      situacaoTema: r.situacaoTema || null,
      inteiroTeorLink: r.inteiroTeorLink || null,
      tribunal: 'STJ',
    };
  }

  /**
   * Busca principal.
   *
   * @param {string} query
   * @param {Object} filters base, orgaos[], secao, dataInicio/dataFim,
   *   dataPubInicio/dataPubFim, ementa, processo, classe, uf, relator, nota,
   *   ordenacao ('recentes'|'antigos'|'relevancia')
   * @param {Object} options maxPages, maxResults, porPagina, keepOpen
   * @returns {Array} resultados mapeados, com .totalResults / .orgaosAplicados
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const porPagina = options.porPagina ?? 10;

    const base = STJCrawler.chaveBase(filters.base);
    let orgaos = [];
    if (filters.secao) orgaos = STJCrawler.codigosSecao(filters.secao);
    if (filters.orgaos?.length) orgaos = STJCrawler.codigosOrgao(filters.orgaos);

    const comum = {
      query,
      base,
      orgaos,
      ementa: filters.ementa || '',
      processo: filters.processo || '',
      classe: filters.classe || '',
      uf: filters.uf || '',
      relator: filters.relator || '',
      nota: STJCrawler.expressaoNota(filters.nota),
      dataInicio: this._data(filters.dataInicio),
      dataFim: this._data(filters.dataFim),
      dataPubInicio: this._data(filters.dataPubInicio),
      dataPubFim: this._data(filters.dataPubFim),
      ordenacao: STJNavigator.ORDENACOES[filters.ordenacao ?? 'recentes'] ?? '',
      porPagina,
    };

    const todos = [];
    try {
      await this.navigator.abrir();

      let total = null;
      for (let pagina = 1; pagina <= maxPages; pagina++) {
        const inicio = 1 + (pagina - 1) * porPagina;
        this.log(`Buscando página ${pagina} (documento ${inicio}+)...`);
        const res = await this.navigator.buscar({ ...comum, inicio });

        if (res.total === 'timeout') {
          // O Oracle Text do SCON aborta consultas caras (ORA-01013). Acontece
          // de forma previsível em paginação profunda (a partir de ~800
          // documentos) e em buscas muito amplas na base de monocráticas.
          this.log(
            pagina === 1
              ? 'AVISO: o SCON abortou a consulta por demora (ORA-01013). Refine o termo ou o período.'
              : `AVISO: paginação interrompida na página ${pagina} — o SCON aborta consultas profundas (ORA-01013).`,
          );
          if (pagina === 1) {
            throw new Error(
              'STJ: a busca foi interrompida pelo servidor por demora excessiva (ORA-01013). '
              + 'Acrescente termos, restrinja o período (-di/-df) ou o órgão (--orgao/--secao).',
            );
          }
          break;
        }
        if (pagina === 1) {
          total = res.total;
          this.log(`Total results on server: ${total ?? '(desconhecido)'}`);
          if (orgaos.length) {
            this.log(`Órgão(s): ${orgaos.map((c) => `${c} = ${STJNavigator.ORGAOS[c]}`).join(' + ')}`);
          }
          // a expressão que o SERVIDOR montou — a prova de que o filtro pegou
          const { expressao } = await this.navigator.lerExpressao(res.html);
          todos.expressaoServidor = expressao;
          if (expressao) this.log(`Expressão no servidor: ${expressao}`);
        }

        const crus = await this.navigator.extrair(res.html);
        todos.push(...crus.map((r) => this.mapResult(r)));
        this.log(`Found ${crus.length} results on page ${pagina} (total: ${todos.length})`);

        if (!crus.length) break;
        if (todos.length >= maxResults) { todos.length = maxResults; break; }
        if (total !== null && inicio + porPagina > total) break;
      }

      todos.totalResults = total;
      todos.orgaosAplicados = orgaos.map((c) => STJNavigator.ORGAOS[c]);
      todos.baseAplicada = base;
      // Súmulas, Informativo e Jurisprudência em Teses respondem pelo mesmo
      // pesquisar.jsp mas renderizam telas PRÓPRIAS, sem os containers
      // `.documento`. Devolver 0 calado seria mentir por omissão.
      if (!['acordao', 'monocratica'].includes(base) && !todos.length) {
        todos.aviso = `A base "${base}" tem tela própria e NÃO é extraída por este crawler `
          + '(só acordao e monocratica são). Zero resultados aqui não significa base vazia — '
          + 'consulte o módulo à mão; as URLs estão em CLAUDE-STJ.md.';
        this.log(`AVISO: ${todos.aviso}`);
      }
      return todos;
    } finally {
      if (this.ownsNavigator && !options.keepOpen) await this.navigator.fechar();
    }
  }

  /**
   * Busca de precedentes qualificados (temas repetitivos, controvérsias, IACs).
   * NÃO usa o SCON: fala com processo.stj.jus.br, que não tem Cloudflare, em
   * modo headless. É uma sessão separada e sempre fechada aqui.
   */
  async buscarTemas(query, filters = {}, options = {}) {
    const rep = new STJNavigator.Repetitivos({ headless: options.headless ?? true, log: this.log });
    try {
      const { total, temas } = await rep.buscar({
        query,
        tipo: filters.tipo,
        temaInicial: filters.temaInicial,
        temaFinal: filters.temaFinal,
        ramo: filters.ramo,
        classe: filters.classe,
        numeroProcesso: filters.processo,
        porPagina: options.porPagina ?? 50,
      });
      const mapeados = temas.map((t) => ({
        sequencial: t.sequencial,
        tipo: filters.tipo ?? 'repetitivo',
        tema: t.campos['Tema Repetitivo'] || t.campos.Controvérsia || t.campos.IAC || '',
        situacao: t.campos['Situação'] || '',
        orgaoJulgador: t.campos['Órgão julgador'] || '',
        ramoDireito: t.campos['Ramo do direito'] || '',
        questaoSubmetida: t.campos['Questão submetida a julgamento'] || '',
        teseFirmada: t.campos['Tese Firmada'] || '',
        anotacoes: t.campos['Anotações NUGEPNAC'] || '',
        informacoesComplementares: t.campos['Informações Complementares'] || '',
        tribunal: 'STJ',
      }));
      mapeados.totalResults = total;
      return mapeados;
    } finally {
      await rep.fechar();
    }
  }

  async close() {
    if (this.ownsNavigator) await this.navigator.fechar();
  }

  /** Grava o inteiro teor. Exige a MESMA sessão da busca — use `{ keepOpen: true }`. */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    return this.navigator.baixarLote(results, outputDir, {
      log: options.log ?? this.log,
      formats: options.formats ?? ['txt'],
    });
  }
}

module.exports = STJCrawler;
