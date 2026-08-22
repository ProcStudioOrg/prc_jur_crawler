const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor; let base;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-mcp-'));
  const fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const rpc = (metodo, params, id = 1) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id, method: metodo, params }),
}).then((r) => r.json());

describe('mcp', () => {
  it('initialize devolve protocolo, capacidades e nome', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    assert.strictEqual(r.jsonrpc, '2.0');
    assert.ok(r.result.protocolVersion);
    assert.ok(r.result.capabilities.tools);
    assert.strictEqual(r.result.serverInfo.name, 'jur');
  });

  it('tools/list publica as tres tools com inputSchema', async () => {
    const r = await rpc('tools/list', {});
    const nomes = r.result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(nomes, ['buscar_jurisprudencia', 'ler_resultados', 'listar_tribunais']);
    assert.strictEqual(r.result.tools[0].inputSchema.type, 'object');
  });

  it('tools/call executa e devolve content de texto', async () => {
    const r = await rpc('tools/call', { name: 'listar_tribunais', arguments: { segmento: 'superior' } });
    assert.strictEqual(r.result.content[0].type, 'text');
    assert.match(r.result.content[0].text, /stf/);
  });

  it('tools/call de tool inexistente marca isError sem derrubar', async () => {
    const r = await rpc('tools/call', { name: 'nao_existe', arguments: {} });
    assert.strictEqual(r.result.isError, true);
  });

  it('metodo desconhecido devolve erro JSON-RPC -32601', async () => {
    const r = await rpc('coisa/estranha', {});
    assert.strictEqual(r.error.code, -32601);
  });

  it('notificacao (sem id) nao devolve corpo', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.strictEqual(r.status, 202);
  });
});
