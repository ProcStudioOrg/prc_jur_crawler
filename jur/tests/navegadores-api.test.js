const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { criarAplicacao } = require('../servidor/aplicacao');

test('API protege sessões, preferências, opt-in STJ e fila global entre usuários', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-navegadores-api-'));
  const principals = new Map(); const execucoes = [];
  const procstudio = {
    exchange: async (code) => {
      const principal = { issuer: 'https://rails.test', userId: code, teamId: 'team', expiresAt: Date.now() + 60000 };
      principals.set(code, principal); return { token: code, principal };
    }, introspect: async (token) => principals.get(token), revoke: async () => {}, subject: async () => true,
  };
  const app = criarAplicacao({ dir, cofreKey: Buffer.alloc(32, 7).toString('base64'), procstudio,
    publicUrl: 'http://127.0.0.1', frontendUrl: 'https://proc.test', clientId: 'jur', concorrencia: 1,
    executarFn: (comando, params, extra) => new Promise((resolve) => execucoes.push({ comando, params, extra, resolve })),
  });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (cookie, route, method = 'GET', body) => fetch(base + route, { method,
    headers: { cookie, origin: 'http://127.0.0.1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(user) {
    const r = await fetch(base + '/auth/login', { redirect: 'manual' });
    const state = new URL(r.headers.get('location')).searchParams.get('state');
    const cb = await fetch(base + `/auth/callback?code=${user}&state=${state}`, {
      redirect: 'manual', headers: { cookie: r.headers.get('set-cookie').split(';')[0] },
    });
    return cb.headers.get('set-cookie').split(';')[0];
  }
  try {
    assert.equal((await fetch(base + '/api/v1/navegadores')).status, 401);
    const alice = await login('alice'); const bob = await login('bob');
    const initial = await (await call(alice, '/api/v1/navegadores')).json();
    assert.equal(initial.total, 1); assert.equal(initial.preferencias.captcha, false);
    assert.equal((await call(alice, '/api/v1/buscas', 'POST', { tribunal: 'stj', query: 'teste' })).status, 409);
    assert.equal((await call(alice, '/api/v1/navegadores/preferencias', 'POST', { acompanhar: false, captcha: true })).status, 200);
    const catalogoA = await (await call(alice, '/api/v1/tribunais')).json();
    const catalogoB = await (await call(bob, '/api/v1/tribunais')).json();
    assert.equal(catalogoA.tribunais.find((t) => t.comando === 'stj').assistido, true);
    assert.equal(catalogoB.tribunais.find((t) => t.comando === 'stj').disponivel, false);
    const jobA = await (await call(alice, '/api/v1/buscas', 'POST', { tribunal: 'stj', query: 'privado' })).json();
    const jobB = await (await call(bob, '/api/v1/buscas', 'POST', { tribunal: 'tjsp', query: 'segundo' })).json();
    const stateB = await (await call(bob, '/api/v1/navegadores')).json();
    assert.equal(stateB.ocupados, 1); assert.equal(stateB.naFila, 1);
    assert.equal(stateB.preferencias.captcha, false);
    assert.deepEqual(stateB.sessoes.map((s) => s.id), [jobB.id]);
    assert.equal(stateB.sessoes[0].posicao, 1); assert.equal(stateB.sessoes[0].status, 'enfileirado');
    assert.equal((await call(bob, `/api/v1/navegadores/${jobA.id}/tela`)).status, 404);
    assert.equal((await call(bob, `/api/v1/navegadores/${jobA.id}/acao`, 'POST', { tipo: 'continuar' })).status, 404);
    assert.equal((await call(alice, `/api/v1/navegadores/${jobA.id}/acao`, 'POST', { tipo: 'continuar' })).status, 409);
    assert.equal(execucoes[0].extra.env.JUR_CAPTCHA, '1');
    await call(bob, `/api/v1/buscas/${jobB.id}`, 'DELETE');
    execucoes[0].resolve({ ok: true, total: 0, resultados: [] });
    await new Promise(setImmediate);
    const done = await (await call(alice, '/api/v1/navegadores')).json();
    assert.equal(done.disponiveis, 1); assert.deepEqual(done.sessoes, []);
    assert.equal(execucoes.length, 1);
  } finally {
    for (const e of execucoes) e.resolve({ ok: false, erro: 'fim do teste' });
    await new Promise(setImmediate);
    server.closeAllConnections(); await new Promise((r) => server.close(r));
    app.fechar(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
