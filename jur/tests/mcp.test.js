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

  // I5 (revisao final): `tools/call buscar_jurisprudencia` travava o POST /mcp por ate
  // 10 minutos (o timeout do executor). O cliente MCP desiste antes — e ao desistir
  // NUNCA recebeu o job_id, entao `ler_resultados` era inutil e o crawler seguia rodando
  // sem ninguem ouvindo. Aqui a mesma chamada volta dentro do prazo, pela superficie
  // MCP de verdade, carregando o job_id.
  it('tools/call de busca longa responde dentro do prazo com o job_id, em vez de travar o POST /mcp', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-mcp-i5-'));
    const filaLenta = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: () => new Promise(() => {}),
    });
    const srv = http.createServer(criarApp({ fila: filaLenta, timeoutBuscaMs: 80 }).handler);
    await new Promise((r) => srv.listen(0, r));
    try {
      const comeco = Date.now();
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 77, method: 'tools/call',
          params: { name: 'buscar_jurisprudencia', arguments: { tribunal: 'stf', query: 'x' } },
        }),
      }).then((x) => x.json());
      assert.ok(Date.now() - comeco < 5000, 'o POST /mcp nao pode ficar preso ate o timeout do executor');
      const texto = r.result.content[0].text;
      assert.strictEqual(r.result.isError, false);
      const id = texto.match(/[0-9a-f-]{36}/);
      assert.ok(id, `o cliente MCP PRECISA sair daqui com o job_id: ${texto}`);
      assert.ok(filaLenta.obter(id[0]), 'o job_id devolvido tem que existir na fila');
      assert.match(texto, /ler_resultados/);
    } finally { srv.close(); }
  });

  // C2 (revisao final): o revisor confirmou que `POST /mcp` com Origin
  // https://evil.example e content-type text/plain — uma "requisicao simples" do CORS,
  // que o browser manda SEM preflight — devolvia o tools/list completo. Sem conseguir
  // LER a resposta o site ja consegue EXECUTAR: tools/call enfileira busca de verdade.
  // O spec do MCP exige validacao de Origin em transporte HTTP por causa disso.
  describe('verificacao de Origin (C2)', () => {
    const comOrigem = (origin, corpo = { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin },
      body: JSON.stringify(corpo),
    });

    it('recusa Origin hostil com 403 e nao vaza o tools/list', async () => {
      const r = await comOrigem('https://evil.example');
      assert.strictEqual(r.status, 403);
      const texto = await r.text();
      assert.ok(!/buscar_jurisprudencia/.test(texto), `nao pode vazar o catalogo de tools: ${texto}`);
    });

    it('recusa tools/call de Origin hostil sem executar a ferramenta', async () => {
      const r = await comOrigem('https://evil.example', {
        jsonrpc: '2.0', id: 10, method: 'tools/call',
        params: { name: 'buscar_jurisprudencia', arguments: { tribunal: 'stf', query: 'x' } },
      });
      assert.strictEqual(r.status, 403);
    });

    it('recusa Origin opaca ("null", de iframe sandbox / file://)', async () => {
      assert.strictEqual((await comOrigem('null')).status, 403);
    });

    it('aceita Origin de loopback e Origin igual ao Host (mesma origem)', async () => {
      const porta = servidor.address().port;
      for (const origin of [`http://localhost:${porta}`, `http://127.0.0.1:${porta}`, base]) {
        const r = await comOrigem(origin);
        assert.strictEqual(r.status, 200, `${origin} devia passar`);
        assert.ok((await r.json()).result.tools.length === 3);
      }
    });

    it('aceita requisicao SEM Origin — cliente MCP nativo/curl nao manda o cabecalho', async () => {
      const r = await rpc('tools/list', {});
      assert.strictEqual(r.result.tools.length, 3);
    });
  });
});
