const { chromium } = require('playwright');
const fs = require('fs');
const D = 'human-codegen/TCEES/01-pesquisar-excerto';
const APP = 'https://acessoidentificado.tcees.tc.br/Publica/PesquisarExcerto/Index';
const PORTAL = 'https://www.tcees.tc.br/jurisprudencia/';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();

  const xhr = [];
  p.on('request', (r) => {
    if (r.resourceType() === 'xhr' || r.resourceType() === 'fetch')
      xhr.push({ m: r.method(), u: r.url(), body: (r.postData() || '').slice(0, 800) });
  });

  // 1. portal WordPress (o iframe)
  await p.goto(PORTAL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${D}/01.01-portal-jurisprudencia.png`, fullPage: false });

  // 2. o app dentro do iframe, aberto direto
  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${D}/01.02-tela-inicial.png`, fullPage: true });

  fs.writeFileSync(`${D}/01-form-busca.html`,
    await p.locator('#form-buscar-excerto').evaluate((e) => e.outerHTML));

  // 3. selects (se houver) já populados
  const selects = [];
  for (const s of await p.locator('select').all()) {
    selects.push({
      name: await s.getAttribute('name'), id: await s.getAttribute('id'),
      opcoes: await s.locator('option').evaluateAll((o) => o.map((x) => ({ value: x.value, texto: x.textContent.trim() }))),
    });
  }
  fs.writeFileSync(`${D}/01-selects.json`, JSON.stringify(selects, null, 2));
  console.log('SELECTS', selects.map((s) => `${s.name}=${s.opcoes.length}`).join(' | ') || '(nenhum)');

  // 4. estrutura do menu lateral de filtros
  const menu = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('.titulo-facet, h3, .panel-heading, [data-toggle="collapse"]').forEach((e) => {
      const t = e.textContent.trim().replace(/\s+/g, ' ');
      if (t && t.length < 80) out.push({ tag: e.tagName, cls: e.className, texto: t });
    });
    return out;
  });
  fs.writeFileSync(`${D}/01-menu-lateral.json`, JSON.stringify(menu, null, 2));
  console.log('MENU', JSON.stringify(menu).slice(0, 1500));

  fs.writeFileSync(`${D}/00-xhr-carga-inicial.json`, JSON.stringify(xhr, null, 2));
  console.log('XHR', xhr.map((x) => x.m + ' ' + x.u).join('\n'));
  await b.close();
})();
