/**
 * TCESCCrawler — TCE-SC (Tribunal de Contas do Estado de Santa Catarina).
 *
 * ESCOPO: CONTROLE EXTERNO, nao Judiciario. Contas, licitacao, contrato, ato de
 * pessoal e consultas do Estado de SC e dos municipios catarinenses.
 * ✅ SC NAO TEM TCM: os 295 municipios estao nesta base (a armadilha declarada do
 * Bloco 5 vale para SP, RJ, BA, GO e PA — nao para Santa Catarina).
 * 🔴 Nao existe numero CNJ nem DataJud aqui (contas nao e Judiciario): o processo
 * e <sigla> <ano>/<sequencial> e src/cnj.js NAO se aplica.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESSALVAS MEDIDAS (todas com HTTP 200 — nenhuma da erro):
 *
 * 🔴 O ESPACO ENTRE TERMOS E **OR**, E NAO EXISTE **AND**. Provado por
 *    aritmetica exata: merenda=497, escolar=4.774, "merenda escolar" sem aspas
 *    =4.783 → intersecao 488, coerente com uniao. Query de duas palavras devolve
 *    a UNIAO, e o numero grande e o termo mais comum, nao abundancia de julgado.
 * 🔴 NENHUM operador booleano funciona. `E`, `OU` e `OR` sao IGNORADOS (dao o
 *    mesmo que o espaco); `AND` (9.631), `NOT` (9.493) e `NAO` (26.057) viram
 *    PALAVRA e INFLAM. Inflar nao da sintoma — 26 mil se le como tema vasto.
 *    O UNICO recurso real e a "frase exata" entre aspas (1.821 contra 10.725).
 *    Decimo conjunto de operadores do repo, e o mais pobre: para exigir dois
 *    termos so ha a frase exata.
 * 🔴 CURINGA NAO EXISTE: `licita*`, `licita$` e `licita?` devolvem 608 — o mesmo
 *    que `licita` sozinho, e muito menos que `licitacao` (9.368). Os caracteres
 *    sao descartados em silencio; nao ha expansao de prefixo.
 * 🔴 TERMO COM MENOS DE 3 CARACTERES E DESCARTADO E DEVOLVE A BASE INTEIRA.
 *    `ab` e `de` devolvem os 27.783 do acervo. A tela avisa "minimo 3
 *    caracteres" mas o servidor nao recusa: ele ignora o termo e responde o
 *    total geral com HTTP 200. E o pior zero-invertido do repo — um typo curto
 *    devolve "27.783 resultados" em vez de erro.
 * ✅ ACENTO E NORMALIZADO (licitacao = licitação = 9.368): nao avise sobre acento.
 *
 * 🔴 A EMENTA QUASE NUNCA EXISTE, E O QUE VEM NO LUGAR E UM SNIPPET.
 *    O campo `ementa` volta null na maioria dos documentos; o texto exibido e
 *    `votoTexto`, que e o TRECHO DE MATCH do termo (comeca no meio da frase).
 *    O crawler marca `semEmenta` e NUNCA apresenta votoTexto como ementa.
 *    Para o texto integral e preciso o PDF (--fetch-inteiro-teor).
 * 🔴 AS TRES DATAS TEM COBERTURAS MUITO DIFERENTES, e escolher a errada apaga a
 *    maior parte do acervo em silencio. Medido em `licitacao` (9.368):
 *      - dataAutuacao  → presente em 100% (8.416 + 1.541 − 589 = 9.368, exato)
 *      - dataPublicacao→ ~79% (2.005 documentos sem)
 *      - dataSessao    → ~37% (5.885 documentos SEM data de sessao)
 *    Filtrar por sessao descarta 63% dos documentos sem nenhum sintoma.
 *    O default do crawler e AUTUACAO, que e a unica completa.
 * ✅ As DUAS pontas de cada janela funcionam sozinhas (diferente do TCE-PR, onde
 *    a inicial zerava e a final era ignorada). Aceita YYYY-MM-DD e DD/MM/YYYY
 *    (624 nos dois). Data invalida devolve erro visivel, nao zero calado.
 * 🔴 A CITACAO PRONTA CHAMA `dataDecisao` DE "Sessao". O textoCopiarEmenta diz
 *    "Sessao 03/08/2026" num documento cujo `dataSessao` e NULL — o rotulo mente,
 *    como no TJES. E quando numeroDecisao e null a citacao sai quebrada
 *    ("Decisao n. ,"). O crawler entrega a citacao do tribunal e sinaliza.
 *
 * 🔴 `decisaoSingular` NAO PARTICIONA A BASE, e o nome engana. Medido:
 *    true=1.787, false=25.497, sem filtro=27.783 → 499 documentos ficam FORA das
 *    duas metades (com `licitacao`: 5.864 + 1.588 = 7.452 contra 9.368, 1.916
 *    fora). Os de fora tem decisaoSingular=null e sao, eles proprios, decisoes
 *    singulares (documento titulado "Decisao Singular"). O que a flag `true`
 *    seleciona e a aba "Decisoes Singulares RATIFICADAS POR COLEGIADO", nao
 *    "decisao singular". Omitir a flag devolve um SUPERSET que a tela nunca
 *    mostra — as abas do portal somam menos que a propria API.
 * ⚠️ `exibirParecerMPC` e `exibirInstrucao` existem no schema e NAO filtram nada
 *    (true e false devolvem 27.783). Nao viraram flag: flag que nao filtra mente.
 *
 * ⚠️ O PORTAL TEM 5 BASES E ESTE CRAWLER COBRE 2. A tela "Pesquisa Integrada"
 *    soma Deliberacoes e Votos + Decisoes Singulares Ratificadas (as duas do
 *    GraphQL, aqui) + Enunciados de Consulta + Informativos + Sumulas — e essas
 *    tres ultimas vem de OUTRO backend (servicos.tcesc.tc.br/cojur/...), com
 *    contrato proprio. Ver a pendencia declarada no CLAUDE-TCESC.md.
 */

const TCESCNavigator = require('./TCESCNavigator');

const ORDENACOES = { relevancia: 'RELEVANCIA', recentes: 'MAIS_RECENTES', antigos: 'MAIS_ANTIGOS' };
const ABRANGENCIAS = { 'inteiro-teor': 'INTEIRO_TEOR', ementa: 'EMENTA' };

/** Aceita DD/MM/YYYY (convencao do repo) e YYYY-MM-DD; a API entende as duas. */
function normalizarData(d) {
  if (!d) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return d.trim();
}

class TCESCCrawler {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.porPagina = options.porPagina || 20;
    this.includeFullText = !!options.includeFullText;
    this.navigator = new TCESCNavigator({ timeout: options.timeout || 120000, log: this.log });
    this._avisos = [];
  }

  aviso(msg) {
    if (!this._avisos.includes(msg)) {
      this._avisos.push(msg);
      this.log(`  [aviso] ${msg}`);
    }
  }

  /** Avisos derivados da QUERY — todos correspondem a medicoes, nao a palpites. */
  checarQuery(q) {
    if (!q) return;
    const t = q.trim();
    const semAspas = t.replace(/"[^"]*"/g, '').trim();
    if (semAspas && semAspas.replace(/[^\wÀ-ÿ]/g, '').length > 0) {
      const palavras = semAspas.split(/\s+/).filter(Boolean);
      if (palavras.length > 1) {
        this.aviso('ESPACO entre termos e OR (UNIAO), nao AND: a contagem inclui documentos com apenas UM dos termos. Para exigir a expressao, use aspas: -q "\\"merenda escolar\\"".');
      }
      for (const op of ['AND', 'NOT', 'NAO', 'NÃO']) {
        if (palavras.some((p) => p.toUpperCase() === op)) {
          this.aviso(`"${op}" NAO e operador no TCE-SC: vira palavra e INFLA a contagem. Nenhum operador booleano funciona aqui — so "frase exata".`);
        }
      }
      for (const op of ['E', 'OU', 'OR']) {
        if (palavras.some((p) => p.toUpperCase() === op)) {
          this.aviso(`"${op}" e IGNORADO pelo servidor (devolve o mesmo que o espaco, que ja e OR).`);
        }
      }
      if (/[*$?]/.test(semAspas)) {
        this.aviso('Curinga (* $ ?) NAO existe no TCE-SC: o caractere e descartado em silencio e a busca vira o prefixo literal.');
      }
      for (const p of palavras) {
        const limpo = p.replace(/[^\wÀ-ÿ]/g, '');
        if (limpo.length > 0 && limpo.length < 3) {
          this.aviso(`Termo "${p}" tem menos de 3 caracteres: o servidor DESCARTA o termo e devolve o ACERVO INTEIRO com HTTP 200. O total nao se refere a sua busca.`);
        }
      }
    }
  }

  montarFiltro(query, filters, pagina) {
    const f = {
      textoBusca: query || '',
      pagina,
      tamanhoPagina: this.porPagina,
    };
    if (filters.abrangencia) {
      f.abrangencia = ABRANGENCIAS[filters.abrangencia] || filters.abrangencia;
    }
    if (filters.ordenacao) {
      f.ordenacao = ORDENACOES[filters.ordenacao] || filters.ordenacao;
    }
    if (filters.numeroProcesso) f.numeroProcesso = filters.numeroProcesso;
    if (filters.numeroDecisao) f.numeroDecisao = Number(filters.numeroDecisao);
    if (filters.relator) f.identificadorRelator = [].concat(filters.relator);
    if (filters.tipoProcesso) f.identificadorProcessoTipo = [].concat(filters.tipoProcesso);
    if (filters.unidadeGestora) f.identificadorUnidadeGestora = [].concat(filters.unidadeGestora);
    if (filters.refinamento) f.textoRefinamento = filters.refinamento;
    if (typeof filters.decisaoSingular === 'boolean') f.decisaoSingular = filters.decisaoSingular;

    // Tres eixos de data, com coberturas MUITO diferentes (ver cabecalho).
    const eixo = filters.eixoData || 'autuacao';
    const di = normalizarData(filters.dataInicio);
    const df = normalizarData(filters.dataFim);
    if (di || df) {
      const mapa = {
        autuacao: ['dataAutuacaoInicio', 'dataAutuacaoFim'],
        sessao: ['dataSessaoInicio', 'dataSessaoFim'],
        publicacao: ['dataPublicacaoInicio', 'dataPublicacaoFim'],
      };
      const par = mapa[eixo];
      if (!par) throw new Error(`--eixo-data invalido: ${eixo} (use autuacao | sessao | publicacao)`);
      if (di) f[par[0]] = di;
      if (df) f[par[1]] = df;
      if (eixo === 'sessao') {
        this.aviso('Filtro por SESSAO: ~63% dos documentos NAO tem data de sessao e somem em silencio. O eixo completo e "autuacao" (--eixo-data autuacao).');
      } else if (eixo === 'publicacao') {
        this.aviso('Filtro por PUBLICACAO: ~21% dos documentos nao tem data de publicacao e somem em silencio.');
      }
    }
    return f;
  }

  mapear(r) {
    const docs = Array.isArray(r.documentos) ? r.documentos : [];
    // O documento com texto encontrado e o que casou o termo; senao, o primeiro.
    const principal = docs.find((d) => d.textoEncontrado) || docs[0] || null;
    const ementa = r.ementa && r.ementa.trim() ? r.ementa.trim() : null;
    const trecho = r.votoTexto && r.votoTexto.trim() ? r.votoTexto.trim() : null;

    return {
      id: principal ? String(principal.identificadorDocumento) : (r.numeroProcesso || null),
      tribunal: 'TCESC',
      tipoDocumento: principal ? principal.tipoDocumentoNome : null,
      processo: r.processoNumeroFormatado || null,
      processoNumero: r.numeroProcesso || null,
      processoUrl: r.linkProcesso || null,
      numeroDecisao: r.numeroDecisao || null,
      relator: r.relator || null,
      unidadeGestora: Array.isArray(r.unidadeGestora)
        ? r.unidadeGestora.map((u) => (u || '').trim()).filter(Boolean)
        : (r.unidadeGestora || null),
      tipoProcesso: r.tipoProcesso || null,
      uf: 'SC',
      // ⚠️ dataDecisao e a unica presente na maioria; sessao/publicacao sao esparsas.
      dataDecisao: r.dataDecisao || null,
      dataSessao: r.dataSessao || null,
      dataPublicacao: r.dataPublicacao || null,
      ementa,
      // 🔴 NAO e ementa: e o trecho onde o termo casou (comeca no meio da frase).
      trechoMatch: trecho,
      semEmenta: !ementa,
      citacaoOficial: r.textoCopiarEmenta || null,
      // ⚠️ a citacao do tribunal rotula dataDecisao como "Sessao" e sai quebrada
      // quando numeroDecisao e null ("Decisao n. ,").
      citacaoSuspeita: !!(r.textoCopiarEmenta && /Decis[aã]o n\.\s*,/.test(r.textoCopiarEmenta)),
      decisaoSingularRatificada: r.decisaoSingular,
      documentoUrl: r.linkDocumento || null,
      inteiroTeorLink: principal ? principal.linkPublico : null,
      semInteiroTeor: !principal || !principal.linkPublico,
      documentos: docs.map((d) => ({
        id: d.identificadorDocumento,
        titulo: d.titulo,
        tipo: d.tipoDocumentoNome,
        link: d.linkPublico,
        dataJuntada: d.dataJuntadaDocumento,
        textoEncontrado: d.textoEncontrado,
      })),
    };
  }

  async search(query, filters = {}, opts = {}) {
    const maxPages = opts.maxPages || 10;
    this.checarQuery(query);
    if (!query) {
      this.aviso('Sem termo livre a busca devolve o acervo por filtro; o trechoMatch (votoTexto) fica vazio, porque ele e o match do termo.');
    }

    const coletados = [];
    let total = 0;
    let facets = null;
    const vistos = new Set();

    for (let pagina = 0; pagina < maxPages; pagina++) {
      const filtro = this.montarFiltro(query, filters, pagina);
      const r = await this.navigator.pesquisar(filtro);
      if (pagina === 0) {
        total = r.totalResultados;
        facets = r.facets || null;
        this.log(`Total no servidor: ${total}`);
        if (total === 0) {
          // Zero e zero de verdade aqui (termo inventado devolve 0 limpo), mas
          // um termo com <3 chars devolve o ACERVO, nao zero — ver checarQuery.
          this.log('  0 resultados. Confira: termo com <3 caracteres e IGNORADO (devolve tudo);');
          this.log('  e o espaco e OR, entao zero com duas palavras significa que NENHUMA existe.');
          break;
        }
      }
      const lote = r.resultados || [];
      if (!lote.length) break;

      let novos = 0;
      for (const bruto of lote) {
        const m = this.mapear(bruto);
        const chave = m.id || `${m.processoNumero}|${m.dataDecisao}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        coletados.push(m);
        novos++;
      }
      this.log(`Pagina ${pagina + 1}: ${lote.length} resultado(s), ${novos} novo(s) — acumulado ${coletados.length}`);
      if (coletados.length >= total) break;
      if (lote.length < this.porPagina) break;
    }

    if (this.includeFullText) {
      this.log('\nBaixando inteiro teor (PDF publico, 1 GET por documento)...');
      let ok = 0; let falha = 0;
      for (const r of coletados) {
        if (!r.inteiroTeorLink) { falha++; continue; }
        const res = await this.navigator.baixarPdf(r.inteiroTeorLink);
        if (res.ok && res.buffer && res.buffer.length) {
          r.inteiroTeorPdfBuffer = res.buffer;
          r.inteiroTeorEhPdf = res.ehPdf;
          ok++;
        } else {
          falha++;
        }
      }
      this.log(`  PDFs: ${ok} baixado(s), ${falha} sem link/erro`);
    }

    const semEmenta = coletados.filter((r) => r.semEmenta).length;
    if (semEmenta) {
      this.aviso(`${semEmenta}/${coletados.length} documento(s) SEM ementa — o texto do card e o trecho de match (trechoMatch), NAO uma ementa. Para o texto integral use --fetch-inteiro-teor.`);
    }

    coletados.totalResults = total;
    coletados.facets = facets;
    coletados.avisos = this._avisos;
    return coletados;
  }
}

module.exports = TCESCCrawler;
module.exports.ORDENACOES = ORDENACOES;
module.exports.ABRANGENCIAS = ABRANGENCIAS;
