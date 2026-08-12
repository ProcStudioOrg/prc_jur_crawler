// src/TJRRTestes.js — testes de integração contra o site real do TJRR.
// Rode: node src/TJRRTestes.js
const TJRRNavigator = require('./TJRRNavigator');
const TJRRCrawler = require('./TJRRCrawler');
const TJRRChecker = require('./TJRRChecker');

const PROCESSO_CONHECIDO = '0841050-24.2023.8.23.0010'; // Apelação Cível, reintegração de posse, 2 acórdãos
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
const eq = (a, b, m) => {
  if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`);
};
const verdade = (c, m) => {
  if (!c) throw new Error(m);
};
const pausa = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const soma = (x) => (x.acordao ?? 0) + (x.monocratica ?? 0);

(async () => {
  const nav = new TJRRNavigator({ log: silencio });
  const crawler = new TJRRCrawler({ log: silencio, navigator: nav, porPagina: 10 });
  const checker = new TJRRChecker({ log: silencio, navigator: nav, crawler });

  await t('1. busca simples devolve resultados e total exato nas duas abas', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    verdade(r.length > 0, 'nenhum card');
    verdade(r.totalResults > 500, `total baixo demais: ${r.totalResults}`);
    verdade(r.totaisPorAba.acordao > 0 && r.totaisPorAba.monocratica > 0, 'faltou uma das abas');
  });
  await pausa();

  await t('2. acordao traz ementa integra, as DUAS datas e link de PDF', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const d = r[0];
    verdade(d.ementa && d.ementa.length > 500, `ementa curta demais: ${(d.ementa || '').length}`);
    verdade(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataJulgamento), 'data de julgamento ausente');
    verdade(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataPublicacao), 'data de publicacao ausente');
    verdade(d.inteiroTeorLink.includes('/pdf?id='), 'link de inteiro teor ausente');
  });
  await pausa();

  await t('3. monocratica vem SEM ementa (so o PDF)', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'monocratica' }, { maxPages: 1 });
    verdade(r.length > 0, 'nenhuma monocratica');
    eq(r.filter((d) => d.semEmenta).length, r.length, 'alguma monocratica veio com ementa');
    eq(r[0].tipoDocumento, 'DECISAO_MONOCRATICA', 'tipo errado');
  });
  await pausa();

  await t('4. filtro de orgao MUDA a contagem e a particao fecha exata', async () => {
    const semFiltro = await nav.buscar({ termo: 'usucapiao' });
    const total = soma(TJRRNavigator.totais(semFiltro.html));
    let acc = 0;
    for (const o of [TJRRCrawler.ORGAO_TURMA_RECURSAL, ...TJRRCrawler.ORGAOS_COMUNS]) {
      const r = await nav.buscar({ termo: 'usucapiao', orgaos: [o] });
      acc += soma(TJRRNavigator.totais(r.html));
    }
    eq(acc, total, 'as 12 partes deveriam somar o total');
  });
  await pausa();

  await t('5. valor INVENTADO de orgao e IGNORADO em silencio (nao zera, nao erra)', async () => {
    const r = await nav.buscar({ termo: 'usucapiao', orgaos: ['XXINVENTADO9Z'] });
    const base = await nav.buscar({ termo: 'usucapiao' });
    eq(soma(TJRRNavigator.totais(r.html)), soma(TJRRNavigator.totais(base.html)),
      'o valor inventado deveria devolver o acervo inteiro (fallback silencioso)');
  });
  await pausa();

  await t('6. filtro de data restringe, e a ponta FINAL sozinha e ignorada', async () => {
    const base = await nav.buscar({ termo: 'usucapiao' });
    const janela = await nav.buscar({
      termo: 'usucapiao', dataInicial: '01/01/2026', dataFinal: '31/12/2026', tipoData: 'JULGAMENTO',
    });
    const soFinal = await nav.buscar({ termo: 'usucapiao', dataFinal: '31/12/2026', tipoData: 'JULGAMENTO' });
    const t0 = soma(TJRRNavigator.totais(base.html));
    verdade(soma(TJRRNavigator.totais(janela.html)) < t0, 'a janela de data nao restringiu');
    eq(soma(TJRRNavigator.totais(soFinal.html)), t0, 'a data final sozinha deveria ser ignorada');
  });
  await pausa();

  await t('7. julgamento e publicacao sao filtros DIFERENTES', async () => {
    const j = await nav.buscar({ termo: 'usucapiao', dataInicial: '01/01/2026', dataFinal: '31/12/2026', tipoData: 'JULGAMENTO' });
    const p = await nav.buscar({ termo: 'usucapiao', dataInicial: '01/01/2026', dataFinal: '31/12/2026', tipoData: 'PUBLICACAO' });
    verdade(soma(TJRRNavigator.totais(j.html)) !== soma(TJRRNavigator.totais(p.html)),
      'julgamento e publicacao deveriam divergir');
  });
  await pausa();

  await t('8. operadores: portugueses funcionam e a aritmetica fecha', async () => {
    const n = async (q) => soma(TJRRNavigator.totais((await nav.buscar({ termo: q })).html));
    const [dano, moral, e, ou, nao] = [await n('dano'), await n('moral'), await n('dano E moral'),
      await n('dano OU moral'), await n('dano NAO moral')];
    eq(await n('dano moral'), e, 'o ESPACO deveria ser E (AND)');
    eq(ou, dano + moral - e, 'OU deveria ser a uniao exata');
    eq(nao, dano - e, 'NAO deveria ser a exclusao exata');
  });
  await pausa();

  await t('9. operadores INGLESES nao funcionam (viram palavra literal)', async () => {
    const n = async (q) => soma(TJRRNavigator.totais((await nav.buscar({ termo: q })).html));
    const and = await n('dano AND moral');
    verdade(and < 100, `AND deveria destruir a busca, veio ${and}`);
  });
  await pausa();

  await t('10. rows fora de {10,20,30} devolve tabela VAZIA — snapRows protege', async () => {
    eq(TJRRNavigator.snapRows(50), 30, 'snapRows(50)');
    eq(TJRRNavigator.snapRows(15), 10, 'snapRows(15)');
    eq(TJRRNavigator.snapRows(3), 10, 'snapRows(3)');
    const est = await nav.buscar({ termo: 'usucapiao' });
    const estado = { cookie: est.cookie, viewState: est.viewState };
    const frag = await nav.paginar(estado, { aba: 'acordao', first: 0, rows: 50, termo: 'usucapiao' });
    eq(TJRRCrawler.fatiarCards(frag, 'acordao').length, 30, 'snapRows deveria ter encaixado em 30');
  });
  await pausa();

  await t('11. paginacao anda e e ESTAVEL (mesma pagina 2, duas vezes)', async () => {
    const ids = async () => {
      const est = await nav.buscar({ termo: 'usucapiao' });
      const estado = { cookie: est.cookie, viewState: est.viewState };
      const frag = await nav.paginar(estado, { aba: 'acordao', first: 10, rows: 10, termo: 'usucapiao' });
      return TJRRCrawler.fatiarCards(frag, 'acordao').map((c) => c.id).join(',');
    };
    const a = await ids();
    const b = await ids();
    verdade(a.length > 0, 'pagina 2 veio vazia');
    eq(a, b, 'a paginacao deveria ser estavel');
  });
  await pausa();

  await t('12. consulta por numero acha o processo conhecido (com e sem mascara)', async () => {
    const comMascara = await checker.consultarProcesso(PROCESSO_CONHECIDO);
    verdade(comMascara.encontrado, 'nao achou com mascara');
    const semMascara = await checker.consultarProcesso(PROCESSO_CONHECIDO.replace(/\D/g, ''));
    eq(semMascara.totalDocumentos, comMascara.totalDocumentos, 'as duas formas deveriam empatar');
  });
  await pausa();

  await t('13. inteiro teor e PDF publico, sem sessao', async () => {
    const r = await crawler.search('usucapiao', { tipo: 'acordao' }, { maxPages: 1 });
    const pdf = await new TJRRNavigator({ log: silencio }).inteiroTeor(r[0].id);
    verdade(pdf.slice(0, 5).toString() === '%PDF-', 'nao veio PDF');
    verdade(pdf.length > 10000, `PDF pequeno demais: ${pdf.length}`);
  });
  await pausa();

  await t('14. DataJud confirma o processo (api_publica_tjrr)', async () => {
    const d = await checker.consultarDataJud(PROCESSO_CONHECIDO);
    verdade(d.encontrado, 'DataJud nao achou o processo');
    eq(d.processos[0].sistema, 'Eproc', 'o TJRR e 99,96% Eproc — a pista PJe/Projudi da base estava errada');
  });
  await pausa();

  await t('15. base CORRENTE (documento do ano corrente na primeira pagina)', async () => {
    const r = await crawler.search('', { tipo: 'acordao' }, { maxPages: 1 });
    const anos = r.map((d) => Number((d.dataJulgamento || '').slice(-4))).filter(Boolean);
    verdade(Math.max(...anos) >= 2026, `julgado mais recente e de ${Math.max(...anos)}`);
  });

  console.log(`\n${ok} OK, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})();
