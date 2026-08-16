/**
 * TCERJCrawler — TCE-RJ (Tribunal de Contas do Estado do Rio de Janeiro).
 *
 * ESCOPO: CONTROLE EXTERNO, nao Judiciario. Contas, licitacao, contrato, ato de
 * pessoal do Estado do RJ e dos municipios fluminenses.
 *
 * 🔴 A CAPITAL NAO ESTA NESTA BASE. O Municipio do Rio de Janeiro e do TCM-RJ,
 *    orgao separado que este repo NAO cobre. Confirmado por MEDICAO, sem sair do
 *    portal: o combo de municipio traz 93 opcoes = "Selecione" + "ESTADO DO RIO
 *    DE JANEIRO" + 91 municipios, e o RJ tem 92 — a unica ausente e a capital.
 *    Mesmo caso do TCE-SP × TCM-SP; oposto de PR/SC/RS, onde o combo trazia todos.
 * 🔴 Nao existe numero CNJ nem DataJud aqui (contas nao e Judiciario):
 *    src/cnj.js NAO se aplica e NAO ha plano B se o portal cair.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA BASE E — leia antes de relatar numero ao usuario:
 *
 * 🔴 A "Jurisprudencia Selecionada" e uma base CURADA e PEQUENA: 1.089
 *    documentos, selecionados pelo Servico de Jurisprudencia (SJU) a partir das
 *    decisoes plenarias. NAO e o acervo de decisoes do TCE-RJ. O acervo grande
 *    esta na Pesquisa Textual (liana-pesquisa-externo), que e busca PROCESSUAL,
 *    sem ementa, e nao esta implementada aqui — ver human-codegen/TCERJ/02-*.
 *    **Nunca relate 1.089 como "a jurisprudencia do TCE-RJ".**
 * ✅ Em compensacao a qualidade e alta: 1.089/1.089 com ementa (100%), todos
 *    "Publicado", base CORRENTE (2021 → voto de 22/06/2026).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESSALVAS MEDIDAS (16/08/2026) — todas com HTTP 200, salvo onde dito:
 *
 * 🔴 O CAMPO DE RELATOR SE CHAMA `conselheiro`, E OS NOMES PLAUSIVEIS SAO
 *    IGNORADOS EM SILENCIO. Com o MESMO nome valido, contra o acervo de 1.089:
 *      conselheiro     → 342  ✅ filtra
 *      relator         → 1.089 ❌   relatorNome → 1.089 ❌   relatorId → 1.089 ❌
 *      nomeRelator     → 1.089 ❌   relatores   → 1.089 ❌   relatorVencedor → 1.089 ❌
 *    O engano e completo porque `relator` EXISTE no payload de RESPOSTA: o nome
 *    obvio esta la, e como FILTRO ele e descartado sem erro. O controle e o
 *    valor inventado (`relator` inventado tambem devolve 1.089), que separa
 *    "ignorado" de "campo certo, valor errado".
 *    ➡️ Nome de campo na resposta NAO e nome de campo no filtro.
 *
 * 🔴 O `NAO` NAO EXCLUI: ELE DEFLACIONA. O botao "NAO" existe na tela e insere o
 *    token, mas ele vira PALAVRA e entra no AND:
 *      licitacao NAO zzzinexistente → 0    (exclusao daria 267)
 *      licitação NÃO pessoal        → 5    (exclusao daria 260)
 *      licitação NAO pessoal        → 0    (sem acento zera de vez)
 *    O repo ja catalogou operador que ZERA (TJMS), que INFLA (TJBA/TJES/TJTO) e
 *    que e IGNORADO (TJMT). Este e o quarto modo: deflaciona para um numero
 *    pequeno e PLAUSIVEL — 5 se le como "busca especifica", nao como defeito.
 * ✅ `E` e `OU` FUNCIONAM, com aritmetica EXATA: licitação=267, pessoal=180,
 *    `E`=7 (igual ao espaco), `OU`=440 = 267+180−7. O espaco entre termos e E (AND).
 * 🔴 `AND` e `OR` DERRUBAM A BUSCA COM HTTP 500 — sintoma visivel, nao zero calado.
 * 🔴 ACENTO E OBRIGATORIO e o indice NAO normaliza: `licitacao` = 0 contra
 *    `licitação` = 267. Padrao TJMS/TJBA/TJPB. Zero aqui e quase sempre acento.
 * 🔴 CURINGA NAO EXISTE e nao ha stemming: `licita*` = 0 e `licita` = 0.
 *
 * ✅ AS DATAS SAO BEM-COMPORTADAS (raro): as duas pontas funcionam SOZINHAS
 *    (so dataInicio=346, so dataFim=978) e a janela no-op 1900→2100 devolve os
 *    1.089 — nao ha o `-di` que zera do TCE-PR nem o no-op que derruba 42% do
 *    TJES. O eixo e a DATA DO VOTO; nao existe data de publicacao nesta base.
 *
 * 🔴 NAO EXISTE FILTRO POR NUMERO DE PROCESSO. numeroProcesso, processo,
 *    numeroDoProcessoFormatado e numeroAcordao sao TODOS ignorados (1.089 em
 *    todos, com as duas formas do numero e com valor inventado). Por isso o
 *    Checker recorta no CLIENTE — o que aqui e barato, porque o acervo inteiro
 *    cabe numa requisicao.
 *
 * ✅ Total EXATO (26 pag. de 10 + 7 = 267), paginacao ESTAVEL 3/3, sem teto de
 *    tamanhoPagina, e PERMALINK PUBLICO em PDF por acordao.
 * 🔴 Mas NAO ha permalink de BUSCA (a SPA nao muda de rota) e NAO ha citacao
 *    oficial pronta — ela e montada dos campos do card.
 * ⚠️ 998 processos distintos para 1.089 registros: um processo rende varios
 *    julgados. Quem identifica o documento e `jurisprudenciaId`.
 * ⚠️ 2 dos 1.089 registros vem SEM numeroAcordao — e sem ele nao ha URL de PDF.
 */

const TCERJNavigator = require('./TCERJNavigator');

/** Aceita DD/MM/YYYY (convencao do repo) e YYYY-MM-DD; a API quer ISO com Z. */
function normalizarData(d, fimDoDia = false) {
  if (!d) return null;
  const s = String(d).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  if (!iso) throw new Error(`data invalida: "${d}" (use DD/MM/YYYY)`);
  // A tela manda 03:00:00.000Z (meia-noite em BRT). Reproduzido tal e qual.
  return `${iso}T03:00:00.000Z`;
}

class TCERJCrawler {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.porPagina = options.porPagina || 20;
    this.includeFullText = !!options.includeFullText;
    this.navigator = new TCERJNavigator({ timeout: options.timeout || 120000, log: this.log });
    this._avisos = [];
  }

  aviso(msg) {
    if (!this._avisos.includes(msg)) {
      this._avisos.push(msg);
      this.log(`  [aviso] ${msg}`);
    }
  }

  /** Avisos derivados da QUERY — cada um corresponde a uma medicao. */
  checarQuery(q) {
    if (!q) return;
    const palavras = q.trim().split(/\s+/).filter(Boolean);
    for (const p of palavras) {
      const up = p.toUpperCase();
      if (up === 'NAO' || up === 'NÃO') {
        this.aviso('"NAO"/"NÃO" NAO exclui no TCE-RJ: vira PALAVRA e entra no AND, DEFLACIONANDO a contagem (licitação NÃO pessoal = 5, contra 260 da exclusao correta; sem acento zera). Nao ha operador de exclusao neste portal.');
      }
      if (up === 'AND' || up === 'OR') {
        this.aviso(`"${up}" DERRUBA a busca do TCE-RJ com HTTP 500. Use os portugueses: E e OU.`);
      }
      if (/[*$?]/.test(p)) {
        this.aviso('Curinga (* $ ?) NAO existe no TCE-RJ: "licita*" devolve 0, igual a "licita". Escreva a palavra inteira e COM acento.');
      }
    }
    // Acento e obrigatorio: o indice nao normaliza (licitacao=0, licitação=267).
    const semAcento = palavras.filter((p) => /^[a-zA-Z]+$/.test(p) && p.length > 4);
    if (semAcento.length) {
      this.aviso('ACENTO E OBRIGATORIO no TCE-RJ e o indice NAO normaliza ("licitacao" = 0, "licitação" = 267). Se a contagem vier 0, confira o acento antes de concluir que nao ha julgado.');
    }
  }

  montarFiltro(query, filters = {}) {
    const f = {};
    if (query) f.texto = query;
    if (filters.macroTema) f.macroTemaId = String(filters.macroTema);
    if (filters.tema) f.temaId = String(filters.tema);
    // 🔴 O campo e `conselheiro`. `relator` e ignorado em silencio — ver cabecalho.
    if (filters.conselheiro) f.conselheiro = filters.conselheiro;
    if (filters.dataInicio) f.dataInicio = normalizarData(filters.dataInicio);
    if (filters.dataFim) f.dataFim = normalizarData(filters.dataFim);

    if (filters.relator && !filters.conselheiro) {
      this.aviso('Use --conselheiro: o campo `relator` da API e IGNORADO em silencio (devolve o acervo inteiro, inclusive com nome inventado).');
    }
    return f;
  }

  mapear(r) {
    // `dispositivoCompleto` = verbetacao (CAIXA ALTA) + tese; e a ementa que a
    // tela mostra, integra e ja no payload da busca (469 chars = 469 no card).
    // `dispositivo` = so a tese, sem os descritores.
    const ementa = (r.dispositivoCompleto || '').trim() || null;
    const tese = (r.dispositivo || '').trim() || null;
    const temAcordao = !!(r.numeroAcordao && r.anoAcordao);

    return {
      id: r.jurisprudenciaId != null ? String(r.jurisprudenciaId) : null,
      tribunal: 'TCERJ',
      uf: 'RJ',
      tipoDocumento: 'Jurisprudência Selecionada',
      processo: r.numeroProcesso || null,
      numeroAcordao: r.acordaoFormatado || (temAcordao ? `${r.numeroAcordao}/${r.anoAcordao}` : null),
      relator: r.relator || null,
      macroTema: r.macroTemaNome || null,
      // 🔴 Nao ha data de publicacao nesta base: o unico eixo e a data do VOTO.
      dataJulgamento: r.dataDoVoto || null,
      dataPublicacao: null,
      boletim: r.boletim || null,
      status: r.statusNome || null,
      ementa,
      tese,
      semEmenta: !ementa,
      // ✅ Permalink publico, confirmado em requisicao limpa. E o PDF do acordao.
      inteiroTeorLink: temAcordao ? this.navigator.urlPdf(r.numeroAcordao, r.anoAcordao) : null,
      semInteiroTeor: !temAcordao,
      // 🔴 Nao ha citacao oficial pronta neste portal — montada dos campos.
      citacaoOficial: temAcordao && r.relator && r.dataDoVoto
        ? `TCE-RJ, Acórdão ${r.acordaoFormatado || `${r.numeroAcordao}/${r.anoAcordao}`}, Processo ${r.numeroProcesso}, Rel. Cons. ${r.relator}, voto de ${String(r.dataDoVoto).slice(0, 10).split('-').reverse().join('/')}.`
        : null,
    };
  }

  async search(query, filters = {}, opts = {}) {
    const maxPages = opts.maxPages || 10;
    this.checarQuery(query);

    const filtro = this.montarFiltro(query, filters);
    const coletados = [];
    const vistos = new Set();
    let total = 0;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.pesquisar(filtro, pagina, this.porPagina);
      if (pagina === 1) {
        total = r.totalResults;
        this.log(`Total no servidor: ${total}` + (total ? ` (exato — a aritmetica da ultima pagina fecha)` : ''));
        if (total === 0) {
          this.log('  0 resultados. Antes de concluir que nao ha julgado, confira:');
          this.log('  - ACENTO: o indice NAO normaliza ("licitacao"=0 x "licitação"=267);');
          this.log('  - CURINGA: * $ ? nao existem e zeram;');
          this.log('  - "NAO"/"NÃO" nao exclui: vira palavra e deflaciona ate zerar.');
          break;
        }
      }
      const lote = r.list || [];
      if (!lote.length) break;

      let novos = 0;
      for (const bruto of lote) {
        const m = this.mapear(bruto);
        const chave = m.id || `${m.processo}|${m.dataJulgamento}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        coletados.push(m);
        novos++;
      }
      this.log(`Pagina ${pagina}: ${lote.length} resultado(s), ${novos} novo(s) — acumulado ${coletados.length}`);
      if (coletados.length >= total) break;
      if (lote.length < this.porPagina) break;
    }

    if (this.includeFullText) {
      this.log('\nBaixando inteiro teor (PDF publico, 1 GET por acordao)...');
      let ok = 0; let falha = 0;
      for (const r of coletados) {
        if (r.semInteiroTeor) { falha++; continue; }
        const bruto = r.numeroAcordao ? r.numeroAcordao.split('/') : [];
        const res = await this.navigator.baixarPdf(bruto[0], bruto[1]);
        if (res.ok && res.buffer && res.buffer.length) {
          r.inteiroTeorPdfBuffer = res.buffer;
          r.inteiroTeorEhPdf = res.ehPdf;
          ok++;
        } else {
          falha++;
        }
      }
      this.log(`  PDFs: ${ok} baixado(s), ${falha} sem acordao/erro`);
    }

    const semPdf = coletados.filter((r) => r.semInteiroTeor).length;
    if (semPdf) {
      this.aviso(`${semPdf}/${coletados.length} registro(s) SEM numero de acordao — e sem ele nao ha URL de PDF nem permalink.`);
    }
    const processos = new Set(coletados.map((r) => r.processo));
    if (processos.size < coletados.length) {
      this.aviso(`${coletados.length} julgado(s) em ${processos.size} processo(s): um processo rende varios. Quem identifica o julgado e o campo id (jurisprudenciaId), nao o numero do processo.`);
    }
    this.aviso('Base CURADA e pequena (1.089 documentos no total): e a selecao do Servico de Jurisprudencia, NAO o acervo de decisoes do TCE-RJ. E a capital carioca nao esta aqui (é do TCM-RJ).');

    coletados.totalResults = total;
    coletados.avisos = this._avisos;
    return coletados;
  }
}

module.exports = TCERJCrawler;
