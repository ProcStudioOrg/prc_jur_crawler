const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { criarOutbox } = require('../servidor/kaizen/outbox');

let con;
let t;
beforeEach(() => { con = new DatabaseSync(':memory:'); t = 0; });

function outbox(extra = {}) {
  return criarOutbox({ con, url: 'https://ffd.example/api/webhooks', token: 'tok', agora: () => t, ...extra });
}

test('2xx apaga; URL e cabecalho do FFD', async () => {
  const chamadas = []; const o = outbox({ fetchFn: async (u, i) => { chamadas.push([u, i.headers['x-webhook-token']]); return new Response('{}'); } });
  o.enfileirar('jur-diagnostico', { a: 1 }); await o.drenar();
  assert.deepEqual(chamadas, [['https://ffd.example/api/webhooks/jur-diagnostico', 'tok']]);
  assert.equal(o.pendentes(), 0);
});
test('500 e rede adiam com backoff 1, 5, 15, 60, 60 min', async () => {
  const o = outbox({ fetchFn: async () => new Response('', { status: 500 }) });
  o.enfileirar('jur-diagnostico', {});
  for (const espera of [1, 5, 15, 60, 60]) {
    await o.drenar(); assert.equal(o.pendentes(), 1);
    t += espera * 60e3 - 1; assert.equal((await o.drenar()).enviados + (await o.drenar()).adiados, 0, 'antes da hora nao tenta');
    t += 1;
  }
});
test('429 e 408 adiam; 400 e 401 descartam', async () => {
  for (const [status, fica] of [[429, 1], [408, 1], [400, 0], [401, 0]]) {
    const o = outbox({ fetchFn: async () => new Response('', { status }) });
    o.enfileirar('user-issues', {}); await o.drenar(); assert.equal(o.pendentes(), fica, String(status));
    con.exec('DELETE FROM kaizen_envio');
  }
});
test('descarta apos 48 h', async () => {
  const o = outbox({ fetchFn: async () => { throw new Error('rede'); } });
  o.enfileirar('jur-diagnostico', {}); t += 48 * 3600e3 + 1; await o.drenar();
  assert.equal(o.pendentes(), 0);
});
test('teto de itens descarta os mais velhos (Review Focus 5)', async () => {
  const o = outbox({ maxItens: 3, fetchFn: async () => new Response('', { status: 500 }) });
  for (let i = 0; i < 5; i++) o.enfileirar('jur-diagnostico', { i });
  assert.equal(o.pendentes(), 3);
  assert.deepEqual(con.prepare('SELECT corpo_json FROM kaizen_envio ORDER BY id').all().map((r) => JSON.parse(r.corpo_json).i), [2, 3, 4]);
});
test('teto de bytes', () => {
  const o = outbox({ maxBytes: 100 }); o.enfileirar('x', { s: 'a'.repeat(60) }); o.enfileirar('x', { s: 'b'.repeat(60) });
  assert.equal(o.pendentes(), 1);
});
test('sem URL ou token: desligada, nao guarda nem envia', async () => {
  let n = 0; const o = outbox({ url: '', fetchFn: async () => { n++; return new Response('{}'); } });
  assert.equal(o.ligado, false); assert.equal(o.enfileirar('jur-diagnostico', {}), false); await o.drenar();
  assert.equal(n, 0); assert.equal(o.pendentes(), 0);
});
test('um POST por vez mesmo com drenar() concorrente', async () => {
  let simultaneos = 0, pico = 0;
  const o = outbox({ fetchFn: async () => { pico = Math.max(pico, ++simultaneos); await new Promise((r) => setTimeout(r, 10)); simultaneos--; return new Response('{}'); } });
  for (let i = 0; i < 4; i++) o.enfileirar('x', { i });
  await Promise.all([o.drenar(), o.drenar()]); assert.equal(pico, 1); assert.equal(o.pendentes(), 0);
});
test('enfileirar drena logo em seguida', async () => {
  let n = 0; const o = outbox({ fetchFn: async () => { n++; return new Response('{}'); } });
  o.enfileirar('x', {}); await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 5));
  assert.equal(n, 1); assert.equal(o.pendentes(), 0);
});
test('nunca lanca e nao loga token nem corpo', async () => {
  const logs = []; const orig = console.error; const origW = console.warn; const origL = console.log;
  console.error = console.warn = console.log = (...a) => logs.push(a.join(' '));
  try {
    const o = outbox({ fetchFn: async () => new Response('', { status: 400 }) });
    o.enfileirar('jur-diagnostico', { segredo: 'corpo-secreto' }); await o.drenar();
    const o2 = criarOutbox({ con: null, url: 'u', token: 'tok' });
    assert.doesNotThrow(() => o2.enfileirar('x', {}));
    assert.equal(await o2.drenar().then(() => 'ok'), 'ok');
  } finally { console.error = orig; console.warn = origW; console.log = origL; }
  assert.ok(logs.some((l) => l.includes('[kaizen] descartado jur-diagnostico HTTP 400')));
  assert.ok(!logs.some((l) => /\btok\b/.test(l) || l.includes('corpo-secreto')));
});
test('iniciar/parar nao seguram o processo', () => {
  const o = outbox({ intervaloMs: 10 }); o.iniciar(); o.iniciar(); o.parar();
});
test('teto de bytes conta bytes, nao caracteres', () => {
  const o = outbox({ maxBytes: 150 });
  o.enfileirar('x', { s: 'ã'.repeat(40) }); o.enfileirar('x', { s: 'ã'.repeat(40) }); // ~90 bytes cada, 45 chars
  assert.equal(o.pendentes(), 1);
});
test('FFD pendurado: uma unica tentativa por drenar()', async () => {
  let n = 0; const o = outbox({ fetchFn: async () => { n++; throw new Error('timeout'); } });
  for (let i = 0; i < 5; i++) o.enfileirar('x', { i });
  await o.drenar(); const antes = n; t += 3600e3; await o.drenar();
  assert.equal(n - antes, 1); assert.equal(o.pendentes(), 5);
});
test('cancela o corpo da resposta', async () => {
  let cancelado = false;
  const o = outbox({ fetchFn: async () => ({ status: 200, body: { cancel: async () => { cancelado = true; } } }) });
  o.enfileirar('x', {}); await o.drenar(); assert.equal(cancelado, true); assert.equal(o.pendentes(), 0);
});
test('log de indisponivel limitado a 1 por 10 min, sem segredo', async () => {
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const o = outbox({ fetchFn: async () => new Response('', { status: 503 }) });
    o.enfileirar('x', {}); await o.drenar(); t += 3600e3; await o.drenar(); await o.drenar();
    const n1 = logs.filter((l) => l.includes('FFD indisponivel (503)')).length;
    assert.equal(n1, 2, 'um por janela de 10 min');
    assert.ok(!logs.some((l) => l.includes('ffd.example') || /\btok\b/.test(l)));
  } finally { console.error = orig; }
});
test('migra tabela antiga sem coluna bytes', () => {
  con.exec('CREATE TABLE kaizen_envio (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, corpo_json TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_em INTEGER NOT NULL, criado_em INTEGER NOT NULL)');
  con.prepare("INSERT INTO kaizen_envio (source, corpo_json, proxima_em, criado_em) VALUES ('x', 'ãã', 0, 0)").run();
  const o = outbox();
  assert.equal(con.prepare('SELECT bytes FROM kaizen_envio').get().bytes, 4);
  assert.equal(o.pendentes(), 1);
});
test('enfileirar devolve true; depois de fechar nada toca o banco', async () => {
  const o = outbox({ fetchFn: async () => new Response('{}') });
  assert.equal(o.enfileirar('jur-diagnostico', {}), true);
  o.fechar(); con.close();
  assert.equal(o.enfileirar('jur-diagnostico', {}), false);
  assert.deepEqual(await o.drenar(), { enviados: 0, adiados: 0, descartados: 0 });
});
