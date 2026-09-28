const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { criarAplicacao } = require('../../servidor/aplicacao');
test('login, chave privada, catálogo OpenRouter, persistência e logout no browser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-browser-new-'));
  const principals = new Map();
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const procstudio = {
    exchange: async (code) => {
      const principal = {
        issuer: 'https://rails.test',
        userId: code,
        teamId: 'team',
        expiresAt: Date.now() + 600000,
      };
      principals.set(code, principal);
      return { token: code, principal };
    },
    introspect: async (t) => principals.get(t) || null,
    revoke: async (t) => principals.delete(t),
    subject: async () => true,
  };
  app = criarAplicacao({
    dir,
    cofreKey: Buffer.alloc(32, 5).toString('base64'),
    procstudio,
    publicUrl: base,
    frontendUrl: 'https://proc.test',
    clientId: 'jur',
    llmTransport: async () =>
      Response.json({
        data: [
          {
            id: 'vendor/model',
            name: 'Modelo de teste',
            supported_parameters: ['tools'],
          },
        ],
      }),
    executarFn: async () => ({ ok: true, total: 0, resultados: [] }),
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
  });
  page.setDefaultTimeout(5000);
  page.on('pageerror', (e) => console.error('BROWSER', e.message));
  try {
    await page.goto(base);
    await page.locator('#login-procstudio').waitFor({ state: 'visible' });
    const r = await page.request.get(base + '/auth/login', { maxRedirects: 0 });
    const state = new URL(r.headers().location).searchParams.get('state');
    await page.goto(base + `/auth/callback?code=alice&state=${state}`);
    await page.locator('#login-procstudio').waitFor({ state: 'hidden' });
    await page.click('#abrir-config');
    await page
      .getByLabel('Provedor', { exact: true })
      .selectOption('openrouter');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page
      .getByLabel('Chave de API', { exact: true })
      .fill('fixture-secret');
    await page
      .getByRole('button', { name: 'Salvar e continuar', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Modelo de teste', exact: false })
      .click();
    await page
      .getByRole('button', { name: 'Usar este modelo', exact: true })
      .click();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.match(
      await page.locator('#caixa-inicial .modelo-abrir').textContent(),
      /OpenRouter.*vendor\/model/,
    );
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!storage.includes('fixture-secret'));
    assert.ok(!storage.includes('jur.chaveLlm'));
    await page.reload();
    await page.locator('#login-procstudio').waitFor({ state: 'hidden' });
    assert.match(
      await page.locator('#caixa-inicial .modelo-abrir').textContent(),
      /vendor\/model/,
    );
    await page.click('#sair-conta');
    await page.locator('#login-procstudio').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#historico').textContent(), '');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('catálogo atrasado não substitui os modelos da conexão atual', async () => {
  const { fixture } = require('./sso-fixture');
  const f = await fixture();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await f.login(page);
    const ids = await page.evaluate(async () => {
      const create = (provider) =>
        window.jurApi.pedir('/api/v1/conexoes-llm', {
          method: 'POST',
          body: JSON.stringify({
            provider,
            name: provider,
            apiKey: 'fixture-key',
            model: 'fixture-model',
          }),
        });
      const a = await create('openai');
      const b = await create('gemini');
      await window.jurConexoes.carregar();
      await window.jurConexoes.selecionar(a.id, 'fixture-model');
      return { a: a.id, b: b.id };
    });
    let oldRoute;
    await page.route('**/conexoes-llm/*/modelos', async (route) => {
      if (route.request().url().includes(ids.a)) {
        oldRoute = route;
        return;
      }
      await route.fulfill({
        json: {
          modelos: [{ id: 'gemini-model', name: 'Gemini atual', tools: true }],
        },
      });
    });
    await page.click('#caixa-inicial .modelo-abrir');
    await page.waitForTimeout(50);
    await page.selectOption('#caixa-inicial .conexao-select', ids.b);
    await page
      .getByRole('button', { name: 'Gemini atual gemini-model' })
      .waitFor();
    assert.ok(oldRoute);
    await oldRoute.fulfill({
      json: {
        modelos: [{ id: 'openai-model', name: 'OpenAI antigo', tools: true }],
      },
    });
    await page.waitForTimeout(50);
    await page.fill('#caixa-inicial .modelo-busca', 'model');
    assert.equal(
      await page
        .getByRole('button', { name: 'Gemini atual gemini-model' })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'OpenAI antigo openai-model' })
        .count(),
      0,
    );
  } finally {
    await browser.close();
    await f.close();
  }
});
