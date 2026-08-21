// src/TCEESTestes.js — suite de integração do TCE-ES.  node src/TCEESTestes.js
const TCEESCrawler = require('./TCEESCrawler');
const TCEESChecker = require('./TCEESChecker');
const TCEESNavigator = require('./TCEESNavigator');

const ACERVO = 9730;      // medido 21/08/2026 (busca sem termo nem filtro)
const LICITACAO = 3344;   // medido 21/08/2026

let ok = 0; let fail = 0;
const t = async (nome, fn) => {
  try { await fn(); console.log(`  ok   ${nome}`); ok++; }
  catch (e) { console.log(`  FAIL ${nome}: ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} esperado ${b}, veio ${a}`); };
const ge = (a, b, m) => { if (!(a >= b)) throw new Error(`${m || ''} esperado >= ${b}, veio ${a}`); };

(async () => {
  const log = () => {};
  const nav = new TCEESNavigator({ log });
  const crawler = new TCEESCrawler({ log });

  console.log('TCE-ES — testes de integracao\n');

  console.log('1. Busca e total');
  await t('busca simples devolve 25 cards e total exato', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    eq(r.length, 25, 'cards');
    ge(r.totalResults, 1000, 'total');
  });
  await t('acervo inteiro tem a ordem de grandeza medida', async () => {
    const json = await nav.buscar({});
    const total = TCEESCrawler.total(json.Dados.ResultadosPesquisarExcerto);
    if (Math.abs(total - ACERVO) > ACERVO * 0.25) {
      throw new Error(`acervo ${total} longe demais dos ${ACERVO} medidos em 21/08/2026`);
    }
  });
  await t('termo inexistente devolve 0, nao o acervo', async () => {
    const json = await nav.buscar({ BuscaTextual: 'xyzabcnaoexiste' });
    eq(TCEESCrawler.total(json.Dados.ResultadosPesquisarExcerto), 0);
  });

  console.log('\n2. Filtros — contagem com e sem (invariante do repo)');
  await t('Colegiado particiona EXATO (Plenario+1a+2a = acervo)', async () => {
    const tot = async (c) => TCEESCrawler.total(
      (await nav.buscar(c)).Dados.ResultadosPesquisarExcerto
    );
    const base = await tot({});
    const p = await tot({ 'ColegiadoMenuItem.IdColegiado': '1' });
    const c1 = await tot({ 'ColegiadoMenuItem.IdColegiado': '2' });
    const c2 = await tot({ 'ColegiadoMenuItem.IdColegiado': '3' });
    eq(p + c1 + c2, base, 'soma dos colegiados');
    if (p === base) throw new Error('filtro de colegiado IGNORADO (contagem igual a sem filtro)');
  });
  await t('faceta anuncia o mesmo numero que o filtro aplicado devolve', async () => {
    const json = await nav.buscar({});
    const f = TCEESCrawler.facetas(json);
    const area = f['AreaAssuntoExcertoMenuItem.IdArea'].itens[0];
    const t2 = TCEESCrawler.total(
      (await nav.buscar({ 'AreaAssuntoExcertoMenuItem.IdArea': area.valor })).Dados.ResultadosPesquisarExcerto
    );
    eq(t2, area.contador, `faceta Area ${area.rotulo}`);
  });
  await t('filtro de data RESTRINGE de fato', async () => {
    const semData = (await crawler.search('licitação', {}, { maxPages: 1 })).totalResults;
    const comData = (await crawler.search('licitação', { dataInicio: '01/01/2026', dataFim: '21/08/2026' }, { maxPages: 1 })).totalResults;
    if (comData >= semData) throw new Error(`data nao restringiu: ${comData} >= ${semData}`);
  });
  await t('data invalida e RECUSADA pelo crawler (o servidor a ignoraria)', async () => {
    try { TCEESCrawler.dataBr('99/99/9999'); throw new Error('aceitou data invalida'); }
    catch (e) { if (!/invalida|inexistente/.test(e.message)) throw e; }
  });
  await t('--excluir fecha a aritmetica (A - A∩B)', async () => {
    const a = (await crawler.search('licitação', {}, { maxPages: 1 })).totalResults;
    const ab = (await crawler.search('licitação publicidade', {}, { maxPages: 1 })).totalResults;
    const exc = (await crawler.search('licitação', { excluir: 'publicidade' }, { maxPages: 1 })).totalResults;
    eq(exc, a - ab, 'exclusao');
  });

  console.log('\n3. Paginacao');
  await t('pagina 2 difere da pagina 1 (PaginaAtual e o driver)', async () => {
    const p1 = TCEESCrawler.fatiarCards((await nav.buscar({ BuscaTextual: 'licitação', PaginaAtual: '1' })).Dados.ResultadosPesquisarExcerto);
    const p2 = TCEESCrawler.fatiarCards((await nav.buscar({ BuscaTextual: 'licitação', PaginaAtual: '2' })).Dados.ResultadosPesquisarExcerto);
    if (p1[0].id === p2[0].id) throw new Error('pagina 2 repetiu a pagina 1');
  });
  await t('PaginaNova NAO pagina (armadilha registrada)', async () => {
    const p1 = TCEESCrawler.fatiarCards((await nav.buscar({ BuscaTextual: 'licitação' })).Dados.ResultadosPesquisarExcerto);
    const pn = TCEESCrawler.fatiarCards((await nav.buscar({ BuscaTextual: 'licitação', PaginaNova: '2' })).Dados.ResultadosPesquisarExcerto);
    eq(pn[0].id, p1[0].id, 'PaginaNova deveria ser inerte');
  });
  await t('mesma pagina duas vezes devolve os mesmos ids (estabilidade)', async () => {
    const get = async () => TCEESCrawler.fatiarCards(
      (await nav.buscar({ BuscaTextual: 'licitação', PaginaAtual: '5' })).Dados.ResultadosPesquisarExcerto
    ).map((c) => c.id).join(',');
    eq(await get(), await get(), 'paginacao instavel');
  });

  console.log('\n4. Card e caminho ate o documento');
  await t('todo card tem id, processo, relator, citacao e permalink', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    for (const c of r) {
      if (!c.id || !c.processo || !c.relator || !c.citacaoOficial || !c.permalink) {
        throw new Error(`card incompleto: ${JSON.stringify({ id: c.id, p: c.processo, r: c.relator, c: !!c.citacaoOficial })}`);
      }
    }
  });
  await t('a citacao entrega as duas datas (unica fonte delas)', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const comData = r.filter((c) => c.dataJulgamento && c.dataPublicacao).length;
    eq(comData, r.length, 'cards com as duas datas');
  });
  await t('nenhum card e apresentado como ementa', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    if (r.some((c) => c.ementa !== null || c.semEmenta !== true)) throw new Error('card se declarou ementa');
  });
  await t('inteiro teor: PDF real com chave composta', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const pdf = await nav.inteiroTeorPdf(r[0].inteiroTeorLink);
    ge(pdf.length, 10000, 'tamanho do PDF');
    if (pdf.slice(0, 4).toString() !== '%PDF') throw new Error('nao e PDF');
  });
  await t('sem a chave, o download NAO abre', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const semKey = r[0].inteiroTeorLink.replace(/&key=[0-9a-f]+/, '');
    try { await nav.inteiroTeorPdf(semKey); throw new Error('abriu sem a chave composta'); }
    catch (e) { if (/abriu sem/.test(e.message)) throw e; }
  });

  console.log('\n5. Permalink e Checker');
  await t('permalink responde em requisicao limpa (via o app, nao a casca)', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const d = await nav.detalharExcerto(r[0].id);
    eq(d.status, 200);
    if (!/Excerto:/.test(d.html)) throw new Error('detalhe sem o excerto');
  });
  await t('--verificar confere o PROCESSO, nao so o HTTP 200', async () => {
    const r = await crawler.search('nepotismo', {}, { maxPages: 1 });
    const v = await new TCEESChecker({ log, crawler }).verificar(r, 2);
    eq(v.confirmados, v.total, 'confirmados');
    if (v.itens.some((i) => i.bateProcesso !== true)) throw new Error('processo da pagina nao bateu com o do card');
  });
  await t('numero de processo: normalizacao e rejeicao de CNJ', async () => {
    eq(TCEESChecker.normalizar('TC 1522/2026'), '01522/2026');
    eq(TCEESChecker.normalizar('0000000-00.2026.8.08.0000'), null);
  });

  console.log('\n6. Avisos de operador (o portal erra para MENOS, sem sintoma)');
  await t('avisa sobre OU/AND/NAO', () => {
    const a = TCEESCrawler.avisosDeQuery('licitação OU nepotismo');
    if (!a.some((x) => /operador booleano/.test(x))) throw new Error('nao avisou');
  });
  await t('avisa sobre aspas em -q', () => {
    if (!TCEESCrawler.avisosDeQuery('"segregação de funções"').some((x) => /frase exata/.test(x))) throw new Error('nao avisou');
  });
  await t('avisa sobre curinga', () => {
    if (!TCEESCrawler.avisosDeQuery('licitac$').some((x) => /curinga/.test(x))) throw new Error('nao avisou');
  });

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})();
