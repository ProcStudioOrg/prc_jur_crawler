// Ensaio manual: somente ambiente Docker isolado, URLs/segredo de fixture abaixo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { criarAplicacao } = require('../../servidor/aplicacao');
const { criarCliente } = require('../../servidor/procstudio');
// Cliente de LLM falso (transporte HTTP do provedor): responde no formato OpenAI com uso
// informado, sem gastar a chave do operador. O que é real aqui é o Rails (saldo e cobrança).
const TOKENS_ENTRADA = 1200;
const TOKENS_SAIDA = 80;
function transporteFalso() {
  const chunks = [
    { id: 'gen-manual-1', choices: [{ delta: { content: 'Resposta de ensaio.' } }] },
    { id: 'gen-manual-1', choices: [{ delta: {}, finish_reason: 'stop' }] },
    { id: 'gen-manual-1', choices: [], usage: { prompt_tokens: TOKENS_ENTRADA, completion_tokens: TOKENS_SAIDA, cost: 0.0001 } },
  ];
  return async () =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
}
// Lê o corpo SSE do chat em [{ evento, dados }].
function eventosSse(texto) {
  return texto
    .split('\n\n')
    .map((bloco) => {
      const evento = /^event: (.+)$/m.exec(bloco)?.[1];
      const dados = /^data: (.+)$/m.exec(bloco)?.[1];
      return evento && dados ? { evento, dados: JSON.parse(dados) } : null;
    })
    .filter(Boolean);
}
(async () => {
  // A conexão ProcStudio só existe com a chave do operador; a deste ensaio é fictícia.
  process.env.PROCSTUDIO_LLM_API_KEY = process.env.PROCSTUDIO_LLM_API_KEY || 'sk-ensaio-fake';
  const fixture = JSON.parse(
    fs.readFileSync(
      process.env.PROCSTUDIO_TEST_USER_FILE || '/tmp/jur-e2e-user.json',
      'utf8',
    ),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-real-e2e-'));
  const app = criarAplicacao({
    dir,
    cofreKey: Buffer.alloc(32, 8).toString('base64'),
    publicUrl: 'http://127.0.0.1:3203',
    frontendUrl: 'http://127.0.0.1:3202',
    clientId: 'jur',
    llmTransport: transporteFalso(),
    procstudio: criarCliente({
      url: 'http://127.0.0.1:3201',
      issuer: 'http://127.0.0.1:3201',
      clientId: 'jur',
      secret: 'local-e2e-fixture',
    }),
  });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(3203, '127.0.0.1', r));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    await context.addCookies([
      {
        name: 'auth_token',
        value: fixture.token,
        url: 'http://127.0.0.1:3202',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('http://127.0.0.1:3203');
    await page.getByRole('link', { name: 'Entrar com ProcStudio' }).click();
    await page.locator('#login-procstudio').waitFor({ state: 'hidden' });
    assert.match(
      await page.locator('#conta-nome').textContent(),
      new RegExp(String(fixture.id)),
    );
    const me = await page.evaluate(() => window.jurApi.pedir('/api/v1/me'));
    assert.equal(me.userId, String(fixture.id));
    assert.ok(!page.url().includes(fixture.token));
    // Saldo compartilhado: o Rails responde ai_balance e a rodada paga é cobrada em ai_usage.
    const saldoAntes = await page.evaluate(() => window.jurApi.pedir('/api/v1/saldo?forcar=1'));
    assert.equal(saldoAntes.disponivel, true);
    assert.equal(typeof saldoAntes.saldoBrl, 'number');
    const chat = await page.evaluate(async () => {
      const r = await window.jurApi.requisitar('/api/v1/chat', {
        method: 'POST',
        body: JSON.stringify({
          conexaoId: 'procstudio',
          mensagens: [{ role: 'user', content: 'ensaio de cobrança' }],
        }),
      });
      return { status: r.status, texto: await r.text() };
    });
    assert.equal(chat.status, 200, chat.texto);
    const eventos = eventosSse(chat.texto);
    const custos = eventos.filter((e) => e.evento === 'custo');
    assert.ok(custos.length >= 1, 'o chat deve emitir ao menos um evento custo');
    const fim = eventos.find((e) => e.evento === 'fim');
    assert.ok(fim?.dados.custo, 'o evento fim deve carregar o custo do turno');
    const somado = custos.reduce((t, e) => t + e.dados.cobradoBrl, 0);
    assert.ok(Math.abs(fim.dados.custo.cobradoBrl - somado) < 0.005);
    assert.ok(somado > 0, 'a rodada precisa ter custado algo');
    const saldoDepois = await page.evaluate(() => window.jurApi.pedir('/api/v1/saldo?forcar=1'));
    assert.ok(
      Math.abs(saldoAntes.saldoBrl - saldoDepois.saldoBrl - somado) < 0.005,
      `saldo no Rails deveria cair ${somado}: ${saldoAntes.saldoBrl} -> ${saldoDepois.saldoBrl}`,
    );
    await page.click('#sair-conta');
    await page.locator('#login-procstudio').waitFor({ state: 'visible' });
    assert.equal(
      (await page.request.get('http://127.0.0.1:3203/api/v1/me')).status(),
      401,
    );
    // Two truly concurrent HTTP exchanges, handled by Puma/Postgres.
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    const authorization = await fetch(
      'http://127.0.0.1:3201/api/v1/service_access/authorize',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + fixture.token,
        },
        body: JSON.stringify({
          client_id: 'jur',
          redirect_uri: 'http://127.0.0.1:3203/auth/callback',
          code_challenge_method: 'S256',
          code_challenge: challenge,
        }),
      },
    );
    assert.equal(authorization.status, 201);
    const { code } = await authorization.json();
    const exchange = () =>
      fetch('http://127.0.0.1:3201/api/v1/service_access/exchange', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-e2e-fixture',
        },
        body: JSON.stringify({
          client_id: 'jur',
          redirect_uri: 'http://127.0.0.1:3203/auth/callback',
          code,
          code_verifier: verifier,
        }),
      });
    const responses = await Promise.all([exchange(), exchange()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
    console.log(
      'PASS: navegador → frontend SvelteKit → Rails/Postgres → crawler; identidade, saldo/cobrança por rodada, logout e troca concorrente única.',
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
