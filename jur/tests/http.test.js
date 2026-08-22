const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor;
let base;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-http-'));
  const fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [{ processo: '1' }], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

describe('http', () => {
  it('GET /api/v1/saude responde ok', async () => {
    const r = await fetch(`${base}/api/v1/saude`);
    assert.strictEqual(r.status, 200);
    const corpo = await r.json();
    assert.strictEqual(corpo.ok, true);
  });

  it('GET /api/v1/tribunais lista com estado e disponivel', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais`)).json();
    assert.ok(corpo.tribunais.length > 60);
    const stf = corpo.tribunais.find((t) => t.comando === 'stf');
    assert.strictEqual(stf.disponivel, true);
    assert.ok('estado' in stf && 'nota' in stf);
  });

  it('GET /api/v1/tribunais?segmento=superior filtra', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais?segmento=superior`)).json();
    assert.ok(corpo.tribunais.every((t) => t.segmento === 'superior'));
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const r = await fetch(`${base}/api/v1/nao-existe`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).erro, 'rota nao encontrada');
  });
});
