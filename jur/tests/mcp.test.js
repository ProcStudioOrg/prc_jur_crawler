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

  // Confirmado pelo revisor rodando um cliente MCP de verdade contra este servidor:
  // id:0 e um id valido (JSON-RPC so trata id ausente/null como notificacao), e um
  // `id === undefined || id === null` ingenuo cairia na armadilha do falsy de `!id`.
  it('id:0 e tratado como id valido, nao como notificacao', async () => {
    const r = await rpc('tools/list', {}, 0);
    assert.strictEqual(r.id, 0);
    assert.ok(r.result.tools);
  });

  // Revisao da Task 11 — isError precisa refletir se a ferramenta EXECUTOU, nao so se
  // o nome bate com uma tool conhecida. Estes dois casos foram achados pelo revisor
  // devolvendo isError:false com erro tecnico cru: ler_resultados sem job_id vazava a
  // mensagem de bind do SQLite, e faltar deps.fila (dependencia ausente) vazava um
  // TypeError puro. Os dois agora viram isError:true com mensagem legivel.
  it('tools/call de ler_resultados sem job_id marca isError com mensagem legivel, nao o erro cru do SQLite', async () => {
    const r = await rpc('tools/call', { name: 'ler_resultados', arguments: {} });
    assert.strictEqual(r.result.isError, true);
    assert.match(r.result.content[0].text, /job_id.*obrigat/i);
    assert.ok(!/sqlite/i.test(r.result.content[0].text));
  });

  // Contraparte da fronteira: um tribunal que existe mas esta indisponivel, ou uma
  // busca com zero resultados, sao RESULTADOS LEGITIMOS da ferramenta — nao falha de
  // execucao. isError precisa ficar false nos dois, senao um cliente que decide
  // "mostrar/logar/tentar de novo" pelo isError trataria uma resposta final como erro.
  it('tools/call de tribunal indisponivel NAO marca isError — e resultado legitimo', async () => {
    const r = await rpc('tools/call', { name: 'buscar_jurisprudencia', arguments: { tribunal: 'stj', query: 'x' } });
    assert.strictEqual(r.result.isError, false);
    assert.match(r.result.content[0].text, /indispon/i);
  });

  it('tools/call com zero resultados NAO marca isError — e resultado legitimo', async () => {
    const r = await rpc('tools/call', { name: 'buscar_jurisprudencia', arguments: { tribunal: 'stf', query: 'x' } });
    assert.strictEqual(r.result.isError, false);
    assert.match(r.result.content[0].text, /0 resultados/);
  });
});
