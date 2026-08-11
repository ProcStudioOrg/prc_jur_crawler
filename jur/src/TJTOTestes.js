// src/TJTOTestes.js — testes de integração contra o site real do TJTO.
// Rode: node src/TJTOTestes.js
const TJTONavigator = require('./TJTONavigator');
const TJTOCrawler = require('./TJTOCrawler');
const TJTOChecker = require('./TJTOChecker');

const PROCESSO_CONHECIDO = '0004697-71.2023.8.27.2737'; // Apelação Cível, usucapião, julgada 24/06/2026
const silencio = () => {};
let ok = 0; let falhou = 0;

async function t(nome, fn) {
  try {
    await fn();
    ok += 1; console.log(`OK    ${nome}`);
  } catch (e) {
    falhou += 1; console.log(`FALHA ${nome}\n        ${e.message}`);
  }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`); };
const verdade = (c, m) => { if (!c) throw new Error(m); };
const pausa = (ms = 400) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const nav = new TJTONavigator({ log: silencio });
  const crawler = new TJTOCrawler({ log: silencio, navigator: nav, porPagina: 20 });
  const checker = new TJTOChecker({ log: silencio, navigator: nav, crawler });

  await t('1. busca simples devolve resultados e total exato', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    verdade(r.length > 0, 'nenhum card');
    verdade(r.totalResults > 100, `total baixo demais: ${r.totalResults}`);
    verdade(r.totalExato === true, 'total deveria ser exato');
  });
  await pausa();

  await t('2. card traz ementa integra, permalink e as duas datas', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const d = r[0];
    verdade(/^[0-9a-f]{32}$/.test(d.id), 'uuid ausente');
    verdade(d.ementa.length > 500, `ementa curta demais: ${d.ementa.length}`);
    verdade(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataJulgamento), 'data de julgamento ausente');
    verdade(d.permalink.includes('documento.php?uuid='), 'permalink ausente');
    eq(d.dataPublicacao, null, 'a base do TJTO NAO tem data de publicacao');
  });
  await pausa();

  await t('3. as tres abas vem juntas e a maior NAO e a default', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const a = r.totaisPorTipo;
    verdade(Object.keys(a).length === 3, `esperava 3 abas, veio ${Object.keys(a).length}`);
    verdade(a['Decisões Monocráticas'] > a['Acórdãos'], 'a aba default deveria ser menor que a de monocraticas');
  });
  await pausa();

  await t('4. instancia particiona EXATO (1o grau + 2o grau = total)', async () => {
    const todos = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    await pausa();
    const g1 = await crawler.search('usucapiao', { tipo: 'acordao', instancia: '1' }, { maxPages: 1 });
    await pausa();
    const g2 = await crawler.search('usucapiao', { tipo: 'acordao', instancia: '2' }, { maxPages: 1 });
    eq(g1.totalResults + g2.totalResults, todos.totalResults,
      `particao por instancia nao fecha (${g1.totalResults}+${g2.totalResults})`);
  });
  await pausa();

  await t('5. filtro de data RESTRINGE (e exige tempo_julgados=pers)', async () => {
    const sem = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    await pausa();
    const com = await crawler.search('usucapiao',
      { tipo: 'acordao', dataInicio: '01/01/2026', dataFim: '31/12/2026' }, { maxPages: 1 });
    verdade(com.totalResults < sem.totalResults,
      `data nao restringiu: ${com.totalResults} contra ${sem.totalResults}`);
    verdade(com.totalResults > 0, 'data zerou a busca');
  });
  await pausa();

  await t('6. filtro de data NO-OP devolve o total (nao derruba, como no TJES)', async () => {
    const sem = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    await pausa();
    const noop = await crawler.search('usucapiao',
      { tipo: 'acordao', dataInicio: '01/01/1900', dataFim: '31/12/2100' }, { maxPages: 1 });
    eq(noop.totalResults, sem.totalResults, 'a janela no-op mudou a contagem');
  });
  await pausa();

  await t('7. Juizado x Justica Comum: a faceta MUDA a contagem', async () => {
    const sem = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    await pausa();
    const tr = await crawler.search('usucapiao', { tipo: 'acordao', origem: 'turmas' }, { maxPages: 1 });
    verdade(tr.totalResults < sem.totalResults,
      `a faceta de Turma Recursal foi ignorada (${tr.totalResults} = ${sem.totalResults})`);
    verdade(tr.every((d) => d.instancia === 'Turma Recursal'), 'voltou documento fora da Turma Recursal');
  });
  await pausa();

  await t('8. espaco entre termos e OR — a aritmetica fecha exata', async () => {
    const a = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 }); await pausa();
    const b = await crawler.search('posse', { tipo: 'acordao' }, { maxPages: 1 }); await pausa();
    const e = await crawler.search('usucapiao E posse', { tipo: 'acordao' }, { maxPages: 1 }); await pausa();
    const esp = await crawler.search('usucapiao posse', { tipo: 'acordao' }, { maxPages: 1 });
    eq(a.totalResults + b.totalResults - e.totalResults, esp.totalResults,
      'o espaco nao e OR (a aritmetica nao fecha)');
  });
  await pausa();

  await t('9. paginacao anda e e ESTAVEL (mesma pagina 2x)', async () => {
    const p1 = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 2, porPagina: 20 });
    verdade(p1.paginasLidas === 2, `leu ${p1.paginasLidas} paginas`);
    verdade(new Set(p1.map((d) => d.id)).size === p1.length, 'documento repetido entre paginas');
    await pausa();
    const a = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1, porPagina: 20 }); await pausa();
    const b = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1, porPagina: 20 });
    eq(a.map((d) => d.id).join(','), b.map((d) => d.id).join(','), 'a mesma pagina devolveu documentos diferentes');
  });
  await pausa();

  await t('10. rows do default responde; acima do teto o erro e HONESTO (500)', async () => {
    // ⚠️ Nao se testa "rows=300 responde": o teto e PESO DE PAYLOAD e oscila
    //    (300 passou na bissecao e falhou minutos depois). O que se garante e
    //    que o default entrega e que estourar da erro, nunca truncagem calada.
    const html = await nav.buscar({ q: 'usucapiao', type_minuta_selected: 1, rows: TJTONavigator.POR_PAGINA, start: 0 });
    verdade(TJTOCrawler.fatiarCards(html).length === TJTONavigator.POR_PAGINA,
      `rows=${TJTONavigator.POR_PAGINA} nao devolveu a pagina inteira`);
    await pausa();
    let estourou = false;
    try { await nav.buscar({ q: 'usucapiao', type_minuta_selected: 1, rows: 1000, start: 0 }); } catch { estourou = true; }
    verdade(estourou, 'rows=1000 deveria estourar com HTTP 500, nao truncar em silencio');
  });
  await pausa();

  await t('11. inteiro teor pelo permalink, sem sessao', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const texto = await crawler.fetchInteiroTeor(r[0].id);
    verdade(texto.length > 5000, `inteiro teor curto: ${texto.length}`);
    verdade(texto.includes(r[0].processo), 'o inteiro teor nao cita o numero do processo');
    verdade(!/Ã§|Ã£|Ã©/.test(texto.slice(0, 4000)), 'mojibake — documento.php e ISO-8859-1');
  });
  await pausa();

  await t('12. citacao oficial vem pronta (rodape_ementa), sem regex', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const cit = await crawler.fetchCitacao(r[0].id);
    verdade(/TJTO/.test(cit) && /julgado em/.test(cit), `citacao inesperada: ${cit.slice(0, 120)}`);
  });
  await pausa();

  await t('13. consulta por numero aceita mascara E 20 digitos', async () => {
    const a = await checker.consultarProcesso(PROCESSO_CONHECIDO); await pausa();
    const b = await checker.consultarProcesso(PROCESSO_CONHECIDO.replace(/\D/g, ''));
    verdade(a.encontrado && b.encontrado, 'processo conhecido nao encontrado');
    eq(a.totalDocumentos, b.totalDocumentos, 'mascara e digitos deram resultados diferentes');
    verdade(a.totalDocumentos > 1, 'esperava mais de um documento para o mesmo processo');
  });
  await pausa();

  await t('14. numero inventado devolve 0 (sintoma visivel)', async () => {
    const r = await checker.consultarProcesso('9999999-99.9999.8.27.9999');
    eq(r.encontrado, false, 'numero inventado achou documento');
  });
  await pausa();

  await t('15. sentenca e monocratica vem marcadas semEmenta', async () => {
    const s = await crawler.search('usucapiao', { tipo: 'sentenca' }, { maxPages: 1 });
    verdade(s.length > 0, 'nenhuma sentenca');
    verdade(s.every((d) => d.semEmenta === true), 'sentenca deveria vir marcada semEmenta');
    verdade(s.every((d) => d.tipoDocumento === 'Sentença'), 'tipoDocumento errado na aba de sentenca');
  });
  await pausa();

  await t('16. auditoria reabre o permalink e confirma a amostra', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const a = await checker.auditar(r, 3);
    eq(a.confirmados, a.amostra, 'a auditoria nao confirmou a amostra inteira');
  });

  console.log(`\n${ok} OK, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})();
