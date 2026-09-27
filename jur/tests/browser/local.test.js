const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { iniciarLocal } = require('../../dev/local');

test('formulário local inicia busca pela API real sem LLM e mantém fila e cancelamento', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-local-browser-'));
  const pendentes = [];
  const app = await iniciarLocal({ port: 0, dir, concorrencia: 1,
    executarFn: (comando, params) => new Promise(resolve => pendentes.push({ comando, params, resolve })) });
  const browser = await chromium.launch();
  t.after(async () => {
    for (const p of pendentes) p.resolve({ ok: true, total: 0, resultados: [] });
    await new Promise(setImmediate);
    await browser.close(); await app.fechar(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  await page.goto(app.base);
  await page.getByRole('link', { name: 'Entrar localmente' }).click();
  await page.locator('#local-validacao').waitFor({ state: 'visible' });
  await page.getByLabel('Consulta direta').fill('dano moral');
  await page.getByRole('button', { name: 'Iniciar pesquisa real' }).click();
  await page.locator('#local-buscar:enabled').waitFor();
  await page.getByRole('button', { name: 'Iniciar pesquisa real' }).click();
  await page.locator('#local-buscar:enabled').waitFor();
  await page.getByText('1 de 1 navegadores ocupados', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#local-resultados li').length === 2);
  assert.equal(pendentes.length, 1);
  assert.equal(pendentes[0].comando, 'tjsp');
  assert.equal(pendentes[0].params.query, 'dano moral');
  assert.equal(pendentes[0].params.maxPaginas, 1);
  await page.locator('#local-resultados li').filter({ hasText: 'Na fila' }).getByRole('button', { name: 'Cancelar' }).click();
  await page.getByText('Cancelada', { exact: true }).waitFor();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
});
