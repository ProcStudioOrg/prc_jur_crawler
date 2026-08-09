// src/TJPITestes.js
// Testes de integração do TJPI contra o site real.
// Cada teste é SENTINELA de uma ressalva medida em 09/08/2026: se ele começar a
// falhar, o comportamento do portal mudou e o CLAUDE-TJPI.md ficou desatualizado.
//   node src/TJPITestes.js
const TJPINavigator = require('./TJPINavigator');
const TJPICrawler = require('./TJPICrawler');
const TJPIChecker = require('./TJPIChecker');

const nav = new TJPINavigator({ timeout: 90000 });
const crawler = new TJPICrawler({ log: () => {} });

let ok = 0; let fail = 0;
const t = async (nome, fn) => {
  try {
    await fn();
    ok++; console.log(`  ok   ${nome}`);
  } catch (e) {
    fail++; console.log(`  FAIL ${nome}\n       ${e.message}`);
  }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} esperado ${b}, veio ${a}`); };
const ge = (a, b, m) => { if (!(a >= b)) throw new Error(`${m || ''} esperado >= ${b}, veio ${a}`); };

/** Conta resultados de uma busca crua. */
const conta = async (params) => TJPICrawler.lerTotal(await nav.buscar(params));

(async () => {
  console.log('TJPI — testes de integração (site real)\n');

  // ---- busca básica -------------------------------------------------------
  await t('busca simples devolve resultados', async () => {
    const r = await crawler.search('usucapião', {}, { maxPages: 1 });
    ge(r.totalResults, 1); eq(r.length, 25, 'cards por página:');
  });

  await t('SENTINELA: acento continua NORMALIZADO no índice', async () => {
    eq(await conta({ q: 'usucapiao' }), await conta({ q: 'usucapião' }),
      'usucapiao x usucapião:');
  });

  // ---- operadores (§2 do human-codegen) -----------------------------------
  await t('SENTINELA: o espaço entre termos continua sendo E (AND)', async () => {
    eq(await conta({ q: 'usucapião posse' }), await conta({ q: 'usucapião e posse' }),
      'espaço x E:');
  });

  await t('SENTINELA: OU fecha a aritmética exata', async () => {
    const [a, b, ab, ou] = await Promise.all([
      conta({ q: 'usucapião' }), conta({ q: 'posse' }),
      conta({ q: 'usucapião e posse' }), conta({ q: '(usucapião ou posse)' }),
    ]);
    eq(ou, a + b - ab, 'OU (inclusão-exclusão):');
  });

  await t('SENTINELA: NÃO acentuado continua sendo o operador de exclusão', async () => {
    const [a, ab, nao] = await Promise.all([
      conta({ q: 'usucapião' }), conta({ q: 'usucapião e posse' }),
      conta({ q: 'usucapião não posse' }),
    ]);
    eq(nao, a - ab, 'NÃO (exclusão):');
  });

  await t('SENTINELA: "nao" SEM acento continua NÃO sendo operador', async () => {
    const [comAcento, semAcento] = await Promise.all([
      conta({ q: 'usucapião não posse' }), conta({ q: 'usucapião nao posse' }),
    ]);
    if (comAcento === semAcento) {
      throw new Error('o portal passou a aceitar "nao" sem acento — atualize o aviso do crawler');
    }
    ge(semAcento, comAcento, '"nao" sem acento (deve INFLAR):');
  });

  await t('SENTINELA: os operadores INGLESES continuam zerando', async () => {
    for (const op of ['and', 'or', 'not', 'adj', 'prox']) {
      eq(await conta({ q: `usucapião ${op} posse` }), 0, `operador "${op}":`);
    }
  });

  // ---- filtros (provados por contagem) ------------------------------------
  await t('SENTINELA: a partição por tipo continua EXATA', async () => {
    const [todos, ac, dt, su] = await Promise.all([
      conta({ q: 'a' }), conta({ q: 'a', tipo: 'Acórdão' }),
      conta({ q: 'a', tipo: 'Decisão Terminativa' }), conta({ q: 'a', tipo: 'Súmula' }),
    ]);
    eq(ac + dt + su, todos, 'Acórdão + Terminativa + Súmula:');
  });

  await t('SENTINELA: valor de filtro inventado continua devolvendo 0', async () => {
    eq(await conta({ q: 'usucapião', tipo: 'XXINVALIDOXX' }), 0, 'tipo inválido:');
    eq(await conta({ q: 'usucapião', orgao: 'XXINVALIDOXX' }), 0, 'órgão inválido:');
  });

  await t('filtro de órgão restringe de fato', async () => {
    const [sem, com] = await Promise.all([
      conta({ q: 'usucapião' }),
      conta({ q: 'usucapião', orgao: '1ª Câmara Especializada Cível' }),
    ]);
    if (!(com > 0 && com < sem)) throw new Error(`órgão: sem=${sem} com=${com} — não restringiu`);
  });

  // ---- datas (§4 e §5) ----------------------------------------------------
  await t('SENTINELA: uma ponta só do filtro de data continua IGNORADA', async () => {
    const [sem, soMin] = await Promise.all([
      conta({ q: 'usucapião' }), conta({ q: 'usucapião', data_min: '2026-01-01' }),
    ]);
    eq(soMin, sem, 'data_min sozinho (deve ser ignorado):');
  });

  await t('as duas pontas juntas restringem, e a janela no-op devolve o total', async () => {
    const [sem, janela, noop] = await Promise.all([
      conta({ q: 'usucapião' }),
      conta({ q: 'usucapião', data_min: '2026-01-01', data_max: '2026-12-31' }),
      conta({ q: 'usucapião', data_min: '1900-01-01', data_max: '2100-12-31' }),
    ]);
    if (!(janela > 0 && janela < sem)) throw new Error(`janela não restringiu: ${janela} de ${sem}`);
    eq(noop, sem, 'janela 1900-2100 (no-op):');
  });

  await t('SENTINELA: o filtro de data devolve documento DENTRO da janela (lição TJMT)', async () => {
    const r = await crawler.search('posse', { dataInicio: '01/07/2026', dataFim: '31/07/2026' }, { maxPages: 1 });
    for (const d of r.slice(0, 10)) {
      const m = d.dataPublicacao.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m || m[2] !== '07' || m[3] !== '2026') {
        throw new Error(`documento ${d.id} fora da janela: ${d.dataPublicacao}`);
      }
    }
  });

  // ---- paginação (§20) ----------------------------------------------------
  await t('SENTINELA: per_page/per/limit continuam IGNORADOS (página fixa de 25)', async () => {
    const cards = TJPICrawler.fatiarCards(await nav.buscar({ q: 'usucapião', per_page: 100 }));
    eq(cards.length, 25, 'com per_page=100:');
  });

  await t('SENTINELA: total EXATO — a última página fecha a aritmética', async () => {
    const total = await conta({ q: 'usucapião' });
    const ultima = Math.ceil(total / 25);
    const n = TJPICrawler.fatiarCards(await nav.buscar({ q: 'usucapião', page: ultima })).length;
    eq((ultima - 1) * 25 + n, total, 'aritmética da última página:');
    eq(TJPICrawler.fatiarCards(await nav.buscar({ q: 'usucapião', page: ultima + 1 })).length, 0,
      'página além do fim:');
  });

  await t('SENTINELA: paginação ESTÁVEL (mesma página, 2 rodadas)', async () => {
    const ids = async () => TJPICrawler.fatiarCards(await nav.buscar({ q: 'usucapião', page: 2 }))
      .map((c) => crawler.mapCard(c).id).join(',');
    const [a, b] = [await ids(), await ids()];
    eq(a, b, 'ids da página 2:');
  });

  // ---- documento e permalink (§19, §20b) ----------------------------------
  await t('a ementa íntegra já vem na busca, e é maior que o trecho', async () => {
    const r = await crawler.search('usucapião', { tipo: 'acordao' }, { maxPages: 1 });
    ge(r[0].ementa.length, 1000, 'ementa do card:');
    ge(r[0].ementa.length, r[0].trecho.length + 1, 'ementa deve ser maior que o trecho:');
  });

  await t('a citação oficial vem pronta, e dela saem classe/relator/órgão', async () => {
    const r = await crawler.search('usucapião', { tipo: 'acordao' }, { maxPages: 1 });
    if (!/^\(TJPI\s*-/.test(r[0].citacao)) throw new Error(`citação inesperada: ${r[0].citacao}`);
    for (const c of ['classe', 'relator', 'orgaoJulgador']) {
      if (!r[0][c]) throw new Error(`campo "${c}" vazio — o formato da citação mudou`);
    }
  });

  await t('SENTINELA: decisão terminativa continua TENDO ementa', async () => {
    const r = await crawler.search('usucapião', { tipo: 'terminativa' }, { maxPages: 1 });
    ge(r[0].ementa.length, 500, 'ementa da decisão terminativa:');
  });

  await t('permalink de acórdão abre e traz o mesmo número de processo', async () => {
    const r = await crawler.search('usucapião', { tipo: 'acordao' }, { maxPages: 1 });
    const html = await nav.documento(r[0].id);
    if (!html.includes(r[0].numeroProcesso)) throw new Error('o permalink não traz o número do processo');
  });

  await t('inteiro teor do permalink é maior que a ementa', async () => {
    const r = await crawler.search('usucapião', { tipo: 'acordao' }, { maxPages: 1 });
    const it = await crawler.fetchInteiroTeor(r[0].id, r[0].tipoDocumento);
    ge(it.length, r[0].ementa.length + 1, 'inteiro teor x ementa:');
  });

  await t('SENTINELA: o permalink de SÚMULA continua quebrado (HTTP 500)', async () => {
    const r = await crawler.search('a', { tipo: 'sumula' }, { maxPages: 1 });
    if (r[0].processoUrl !== null) throw new Error('súmula não deveria expor permalink');
    let deu500 = false;
    try { await nav.documento(r[0].id); } catch (e) { deu500 = /HTTP 500/.test(e.message); }
    if (!deu500) throw new Error('o permalink de súmula VOLTOU a funcionar — atualize CLAUDE-TJPI.md');
  });

  // ---- Checker (§14) ------------------------------------------------------
  await t('SENTINELA: CNJ mascarado SOZINHO continua derrubando a busca (HTTP 500)', async () => {
    let deu500 = false;
    try { await nav.buscar({ q: '0763373-15.2025.8.18.0000' }); } catch (e) { deu500 = /HTTP 500/.test(e.message); }
    if (!deu500) throw new Error('o JusPI parou de dar 500 no CNJ sozinho — atualize CLAUDE-TJPI.md');
  });

  await t('SENTINELA: CNJ sem máscara e pedaços continuam devolvendo 0 (sem erro)', async () => {
    eq(await conta({ q: '07633731520258180000' }), 0, '20 dígitos:');
    eq(await conta({ q: '0763373' }), 0, 'pedaço do número:');
  });

  await t('o contorno do Checker acha o processo', async () => {
    const r = await new TJPIChecker().consultarProcesso('0763373-15.2025.8.18.0000');
    if (!r.encontrado) throw new Error('o contorno parou de funcionar');
    eq(r.documentos[0].numeroProcesso, '0763373-15.2025.8.18.0000', 'processo:');
  });

  await t('CNJ inválido é recusado antes de consultar', async () => {
    const r = await new TJPIChecker().consultarProcesso('0000000-00.2025.8.18.0000');
    eq(r.valido, false, 'validação de DV:');
  });

  // ---- vigência (§ base corrente) ----------------------------------------
  await t('SENTINELA: a base continua CORRENTE', async () => {
    const ano = new Date().getFullYear();
    const n = await conta({ q: 'de', data_min: `${ano}-01-01`, data_max: `${ano}-12-31` });
    ge(n, 1000, `publicações em ${ano}:`);
  });

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})();
