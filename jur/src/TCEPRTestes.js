// src/TCEPRTestes.js — testes de integração contra o site real do TCE-PR (ViaJuris).
// Rode: node src/TCEPRTestes.js
const TCEPRNavigator = require('./TCEPRNavigator');
const TCEPRCrawler = require('./TCEPRCrawler');
const TCEPRChecker = require('./TCEPRChecker');

const PROCESSO_CONHECIDO = '393433/2026'; // Representação da Lei de Licitações, Acórdão 1979/2026
const silencio = () => {};
let ok = 0;
let falhou = 0;

async function t(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`OK    ${nome}`);
  } catch (e) {
    falhou += 1;
    console.log(`FALHA ${nome}\n        ${e.message}`);
  }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`); };
const verdade = (c, m) => { if (!c) throw new Error(m); };
const pausa = (ms = 600) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const nav = new TCEPRNavigator({ log: silencio });
  const crawler = new TCEPRCrawler({ log: silencio, navigator: nav, porPagina: 10 });
  const checker = new TCEPRChecker({ log: silencio, navigator: nav });

  await t('1. busca simples devolve resultados e total exato', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    verdade(r.length > 0, 'nenhum card');
    verdade(r.totalResults > 10000, `total baixo demais: ${r.totalResults}`);
  });
  await pausa();

  await t('2. o card traz ementa, tema, inteiro teor, citacao oficial e PDF', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const d = r[0];
    verdade(d.ementa && d.ementa.length > 200, `ementa curta demais: ${(d.ementa || '').length}`);
    verdade(d.tema && d.tema.length > 50, 'tema ausente');
    verdade(d.inteiroTeor && d.inteiroTeor.length > 3000, `inteiro teor curto: ${(d.inteiroTeor || '').length}`);
    verdade(/Acórdão n\.º/.test(d.citacao || ''), 'citacao oficial ausente');
    verdade(/\/Arquivos\/\d{4}\/\d+\/\d+\.pdf$/.test(d.inteiroTeorLink || ''), 'link de PDF ausente');
    verdade(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataJulgamento), 'data da sessao ausente');
  });
  await pausa();

  // 🔴 A medição mais cara do mapeamento: sem termo livre o card volta sem
  //    inteiro teor. É regressão silenciosa se o portal mudar.
  await t('3. SEM termo livre o card vem SEM inteiro teor (100% x 0%, medido)', async () => {
    const r = await crawler.search('', { anoAcordao: '2026' }, { maxPages: 1 });
    verdade(r.length > 0, 'nenhum card sem termo');
    eq(r.filter((d) => d.semInteiroTeor).length, r.length, 'algum card sem termo veio COM inteiro teor');
  });
  await pausa();

  await t('4. o filtro de colegiado PARTICIONA exato (as 3 partes somam o total)', async () => {
    const total = (await crawler.search('licitação', {}, { maxPages: 1 })).totalResults;
    let soma = 0;
    for (const c of ['pleno', 'primeira-camara', 'segunda-camara']) {
      soma += (await crawler.search('licitação', { colegiado: c }, { maxPages: 1 })).totalResults;
      await pausa(300);
    }
    eq(soma, total, 'a particao por colegiado nao fecha');
  });
  await pausa();

  // 🔴 O select da tela e decorativo; quem filtra e o hidden. Se um dia o
  //    select passar a valer, este teste avisa (a contagem deixaria de bater).
  await t('5. a classificacao de decisao filtra pelo HIDDEN (sumulas << total)', async () => {
    const total = (await crawler.search('licitação', {}, { maxPages: 1 })).totalResults;
    const s = await crawler.search('licitação', { classificacao: 'sumula' }, { maxPages: 1 });
    verdade(s.totalResults > 0, 'sumulas zeraram');
    verdade(s.totalResults < total / 100, `filtro ignorado? sumulas=${s.totalResults} total=${total}`);
  });
  await pausa();

  await t('6. a janela de data restringe de fato (e nao e o acervo inteiro)', async () => {
    const total = (await crawler.search('licitação', {}, { maxPages: 1 })).totalResults;
    const j = await crawler.search('licitação', { dataInicio: '01/01/2025', dataFim: '31/12/2025' }, { maxPages: 1 });
    verdade(j.totalResults > 0 && j.totalResults < total, `data nao restringiu: ${j.totalResults} de ${total}`);
  });
  await pausa();

  await t('7. paginacao anda alem da pagina 1, sem repetir documento', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 3, porPagina: 10 });
    verdade(r.length > 20, `coletou pouco: ${r.length}`);
    eq(new Set(r.map((d) => d.id)).size, r.length, 'documento repetido entre paginas');
  });
  await pausa();

  // 🔴 O numero como a tela mostra devolve ZERO calado. O Checker parte o numero.
  await t('8. consulta por numero de processo encontra um processo conhecido', async () => {
    const r = await checker.consultarProcesso(PROCESSO_CONHECIDO);
    verdade(r.encontrado, `nao encontrou ${PROCESSO_CONHECIDO}`);
    verdade(r.documentos.some((d) => d.acordao === '1979/2026'), 'acordao conhecido ausente');
  });
  await pausa();

  await t('9. o permalink abre em requisicao limpa (auditoria)', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const a = await checker.auditar(r, 2);
    eq(a.confirmados, a.amostra, 'permalink nao confirmou a amostra');
  });
  await pausa();

  // 🔴 O arquivo NAO comeca com %PDF: e um envelope PKCS#7 assinado, com o PDF
  //    embutido no offset 57. Validar pelo magic number rejeitaria todos.
  await t('10. o PDF do inteiro teor e publico (sem sessao) e id falso da 404', async () => {
    const r = await crawler.search('licitação', {}, { maxPages: 1 });
    const buf = await nav.inteiroTeorPdf(r[0].inteiroTeorLink);
    verdade(buf.length > 10000, `PDF pequeno demais: ${buf.length}`);
    verdade(TCEPRNavigator.ehPdf(buf), 'nao contem PDF');
    verdade(buf.slice(0, 4).toString() !== '%PDF', 'o envelope PKCS#7 sumiu — reveja a ressalva');
    let deu404 = false;
    try { await nav.inteiroTeorPdf('/Arquivos/2026/8/000999999.pdf'); } catch (e) { deu404 = /404/.test(e.message); }
    verdade(deu404, 'id inexistente nao devolveu 404');
  });
  await pausa();

  await t('11. zero e ZERO de verdade (nao pagina de erro nem form vazio)', async () => {
    const r = await nav.buscar({ TermoLivre: 'xyzqwk9', LinhasPorPagina: '10', PaginaAtual: '1' });
    eq(r.status, 200, 'status inesperado');
    eq(TCEPRNavigator.total(r.html), 0, 'total nao foi 0');
    verdade(/0\s*registros\s*encontrados/i.test(r.html), 'faltou a mensagem de zero');
  });

  console.log(`\n${ok} OK, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})();
