// src/TCEPATestes.js
// Testes de integração do TCE-PA. `node src/TCEPATestes.js`
//
// ⚠️ ESTES TESTES FALAM COM O PORTAL DE VERDADE, e o portal tem WAF que pune
//    rajada (ver TCEPANavigator). Por isso a pausa entre requisições é
//    deliberadamente alta e a suíte é curta: cada teste extra custa orçamento.
const TCEPANavigator = require('./TCEPANavigator');
const TCEPACrawler = require('./TCEPACrawler');
const TCEPAChecker = require('./TCEPAChecker');

const PAUSA = Number(process.env.TCEPA_PAUSA || 8000);
let ok = 0; let fail = 0;
const t = (nome, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${nome}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  console.log('TCE-PA — Pesquisa Integrada — testes de integração\n');

  // --- offline: o que não gasta orçamento de WAF -----------------------------
  console.log('[offline] montagem de query e parsing');
  t('querystring limita rpp a 25 (teto medido)',
    /rpp=25/.test(TCEPANavigator.querystring({ rpp: 100 })));
  t('montarQuery gera campo:"valor"',
    TCEPACrawler.montarQuery('x', { relator: 'DANIEL MELLO' }) === 'x relatores:"DANIEL MELLO"');
  t('montarQuery gera faixa Lucene de data',
    TCEPACrawler.montarQuery('', { dataInicio: '01/01/2024', dataFim: '31/12/2024' })
      === 'data-sessao-plenaria:[2024-01-01 TO 2024-12-31]');
  t('uma ponta só vira faixa aberta com *',
    TCEPACrawler.montarQuery('', { dataInicio: '01/01/2024' })
      === 'data-sessao-plenaria:[2024-01-01 TO *]');
  t('ehDesafioWaf reconhece o captcha servido com HTTP 200',
    TCEPANavigator.ehDesafioWaf('<script>window["failureConfig"] = "52"</script>'));
  t('ehDesafioWaf não dá falso positivo em HTML normal',
    !TCEPANavigator.ehDesafioWaf('<html><div id="resultado-organico-1">'));

  // --- ao vivo ---------------------------------------------------------------
  console.log('\n[live] busca, filtro, paginação, permalink');
  const crawler = new TCEPACrawler({ log: () => {}, pausaMs: PAUSA, porPagina: 25 });

  // ⚠️ Cada requisição custa orçamento de WAF, e o bloqueio ESCALA a cada
  //    reincidência (medido: o 4º bloqueio durou mais de 9 min de silêncio).
  //    Por isso a suíte ao vivo faz 5 requests, não 8: a busca de 2 páginas
  //    serve a quatro asserções de uma vez.
  const rA = await crawler.search('aposentadoria', {}, { maxPages: 2 });
  const pag1 = rA.slice(0, 25);
  t('busca simples devolve resultados', pag1.length > 0, `${pag1.length} cards na pg1`);
  t('total é exato e grande', rA.totalResults > 10000, String(rA.totalResults));
  t('a ementa inteira vem no card (não é trecho)',
    rA.some((x) => x.ementa && x.ementa.length > 200));
  t('permalink e download vêm montados', rA.every((x) => x.permalink && x.inteiroTeorLink));
  t('paginação anda além da página 1', rA.length > 25, `${rA.length} em 2 páginas`);
  t('paginação não repete documento', new Set(rA.map((x) => x.id)).size === rA.length);

  const rB = await crawler.search('aposentadoria', { anoSessao: '2024' }, { maxPages: 1 });
  t('filtro de ano RESTRINGE de fato (contagem muda)',
    rB.totalResults > 0 && rB.totalResults < rA.totalResults,
    `${rA.totalResults} -> ${rB.totalResults}`);

  let recusou = false;
  try { await crawler.search('a || b', {}, { maxPages: 1 }); } catch (e) { recusou = /\|\|/.test(e.message); }
  t('crawler RECUSA o operador || (devolve o acervo inteiro)', recusou);

  const checker = new TCEPAChecker({ log: () => {}, pausaMs: PAUSA });
  const c = await checker.consultarAcordao('24768');
  t('consulta por número de acórdão encontra o julgado', c.encontrado && c.total === 1,
    `total=${c.total}`);

  const aud = await checker.auditar(rA, 1);
  t('permalink abre PDF em requisição limpa', aud.confirmados === 1,
    JSON.stringify(aud.detalhes[0] && aud.detalhes[0].bytes));

  console.log(`\n${ok}/${ok + fail} testes passaram`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
