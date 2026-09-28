const { chromium } = require('playwright');
const fs = require('fs');
const D = 'human-codegen/TCEES/01-pesquisar-excerto';
const APP = 'https://acessoidentificado.tcees.tc.br/Publica/PesquisarExcerto/Index';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  const p = await ctx.newPage();
  const xhr = [];
  p.on('request', (r) => {
    if (['xhr', 'fetch'].includes(r.resourceType()) && !/google|analytics/.test(r.url()))
      xhr.push({ m: r.method(), u: r.url(), body: (r.postData() || '').slice(0, 1200) });
  });

  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  // 02 — menu lateral de filtros (as 14 facetas), aberto
  await p.screenshot({ path: `${D}/02.01-menu-lateral-facetas.png`, fullPage: true });
  const menuHtml = await p.locator('#menu-lateral, .menu-lateral, aside, .col-sm-6').first()
    .evaluate((e) => e.outerHTML).catch(() => '');
  if (menuHtml) fs.writeFileSync(`${D}/02-menu-lateral.html`, menuHtml);

  // 03 — busca real
  await p.fill('#BuscaTextual', 'licitação');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${D}/03.01-resultados-topo.png` });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${D}/03.02-resultados-rodape-paginacao.png` });

  // card cru
  const card = await p.locator('.row-fluid:has(.titulo-resultado-pesquisa)').first()
    .evaluate((e) => e.outerHTML).catch(() => '');
  if (card) fs.writeFileSync(`${D}/03-card-resultado-decisao.html`, card);
  await p.locator('.titulo-resultado-pesquisa').first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${D}/03.03-card-excerto.png` });

  // 04 — faceta expandida (Tipo de deliberação)
  const facet = p.locator('h3.titulo-facet', { hasText: 'Tipo de delibera' }).first();
  if (await facet.count()) {
    await facet.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${D}/04.01-faceta-tipo-deliberacao.png` });
  }
  const relFacet = p.locator('h3.titulo-facet', { hasText: 'Relator' }).first();
  if (await relFacet.count()) {
    await relFacet.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${D}/04.02-faceta-relator.png` });
  }

  // 05 — permalink em aba limpa
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  const p2 = await ctx2.newPage();
  await p2.goto('https://www.tcees.tc.br/jurisprudencia/detalhar-excerto/?id=17365', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `${D}/05.01-permalink-detalhar-excerto.png` });

  fs.writeFileSync(`${D}/03-xhr-busca.json`, JSON.stringify(xhr, null, 2));
  console.log(xhr.map((x) => `${x.m} ${x.u}\n   ${x.body.slice(0, 400)}`).join('\n'));
  await b.close();
})();
