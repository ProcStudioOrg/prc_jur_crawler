const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comBrowserbase } = require('../servidor/navegadores/browserbase');

test('Browserbase fecha sessão mesmo se o crawler falhar; não grava nem resolve captcha', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), key: opts.headers['X-BB-API-Key'] });
    return Response.json(calls.length === 1 ? { id: 'session-1', connectUrl: 'wss://connect.browserbase.com?secret=test' } : {});
  };
  await assert.rejects(comBrowserbase(async (cdp) => {
    assert.match(cdp, /^wss:/); throw new Error('crawler falhou');
  }, { apiKey: 'key', projectId: 'project', fetchFn }), /crawler falhou/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.browserSettings.solveCaptchas, false);
  assert.equal(calls[0].body.browserSettings.recordSession, false);
  assert.equal(calls[0].body.timeout, 600);
  assert.equal(calls[1].body.status, 'REQUEST_RELEASE');
});

test('Browserbase falha sem credenciais e não vaza erro do fornecedor', async () => {
  await assert.rejects(comBrowserbase(() => {}, {}), /configurad/);
  await assert.rejects(comBrowserbase(() => {}, { apiKey: 'secret', projectId: 'p', fetchFn: async () => { throw new Error('secret url'); } }), (e) => !e.message.includes('secret'));
});
