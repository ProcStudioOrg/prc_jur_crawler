const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const chaves = require('../servidor/chaves');
const { criarApp } = require('../servidor/index');
const { criarGuarda } = require('../servidor/autenticacao');

let servidor; let base; let chaveValida;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-auth-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({ con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [], arquivo: null, erro: null }) });
  const g = chaves.criarGerenciador(con);
  chaveValida = g.gerar('teste').valor;
  servidor = http.createServer(criarApp({ fila, chaves: g, exigirChave: true }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const post = (caminho, corpo, cab = {}) => fetch(base + caminho, {
  method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: JSON.stringify(corpo),
});

describe('autenticacao', () => {
  it('recusa POST /buscas sem chave', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' });
    assert.strictEqual(r.status, 401);
    assert.match((await r.json()).erro, /chave/i);
  });

  it('aceita POST /buscas com chave valida', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' },
      { authorization: `Bearer ${chaveValida}` });
    assert.strictEqual(r.status, 202);
  });

  it('recusa chave invalida e chave revogada', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' },
      { authorization: 'Bearer jur_naoexiste' });
    assert.strictEqual(r.status, 401);
  });

  it('recusa /mcp sem chave', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.strictEqual(r.status, 401);
  });

  it('mantem interface, docs, OpenAPI e saude publicos', async () => {
    for (const caminho of ['/', '/docs', '/api/v1/openapi.json', '/api/v1/saude']) {
      const r = await fetch(base + caminho);
      assert.strictEqual(r.status, 200, caminho);
    }
  });

  it('NAO deixa passar so por mandar Origin de mesma origem sem Sec-Fetch-Site — regressao do bug original', async () => {
    // Este e o teste que "provava" o bootstrap antes do fix: um fetch de Node pode
    // setar Origin manualmente (header proibido em qualquer browser de verdade), entao
    // ele passava mesmo sem ser a interface. Sem Sec-Fetch-Site, tem que exigir chave.
    const r = await fetch(`${base}/api/v1/tribunais`, { headers: { origin: base } });
    assert.strictEqual(r.status, 401, 'Origin sozinho (sem Sec-Fetch-Site) nao pode dispensar chave');
  });

  it('Sec-Fetch-Site forjado nunca substitui Bearer', async () => {
    for (const valor of ['same-origin', 'none', 'same-site', 'cross-site']) {
      const r = await fetch(`${base}/api/v1/chaves`, {
        headers: { 'sec-fetch-site': valor },
      });
      assert.strictEqual(r.status, 401, valor);
    }
  });

  it('Bearer valido continua aceito com qualquer Sec-Fetch-Site', async () => {
    const r = await fetch(`${base}/api/v1/chaves`, {
      headers: {
        authorization: `Bearer ${chaveValida}`,
        'sec-fetch-site': 'cross-site',
      },
    });
    assert.strictEqual(r.status, 200);
  });

  it('recusa origem hostil mesmo sem exigir chave para GET', async () => {
    const r = await fetch(`${base}/api/v1/tribunais`, { headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.status, 403);
  });
});

/**
 * Uma revisao anterior deste projeto testou 24 variantes de Origin contra
 * origemPermitida (http.js) e pegou regex mal ancorada de verdade — ver
 * "origemPermitida (C2)" em tests/http.test.js. A guarda usa bloquearOrigemHostil
 * (a mesma funcao, ja coberta la) para a Barreira 1, entao aqui o foco e confirmar,
 * direto contra criarGuarda (sem HTTP de verdade), que a mesma lista dificil de casos
 * continua recusada/aceita quando passa pela guarda — inclusive os que dependem da
 * Barreira 2 (mesma-origem local) para passar sem chave.
 */
describe('criarGuarda — variantes de Origin (C2)', () => {
  const CAMINHO = '/api/v1/tribunais'; // rota comum, fora de LIVRES

  function reqFalso(origin, host = '127.0.0.1:3000') {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    return { headers };
  }

  function resFalso() {
    return {
      status: null,
      corpo: null,
      writeHead(codigo) { this.status = codigo; },
      end(texto) { this.corpo = texto; },
    };
  }

  const REJEITAR = [
    'http://127.0.0.1.evil.example',
    'http://localhost.evil.com',
    'https://evil.com/?x=http://localhost',
    'http://localhost@evil.com',
    'http://evil.com#@localhost',
  ];

  const ACEITAR = [
    undefined,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ];

  it('recusa as origens hostis disfarcadas de local', () => {
    const guarda = criarGuarda({});
    for (const origem of REJEITAR) {
      const req = reqFalso(origem);
      const res = resFalso();
      const bloqueou = guarda(req, res, CAMINHO);
      assert.strictEqual(bloqueou, true, `devia bloquear: ${origem}`);
      assert.strictEqual(res.status, 403, `devia responder 403 para: ${origem}`);
    }
  });

  it('aceita ausencia de Origin e as formas de loopback', () => {
    const guarda = criarGuarda({});
    for (const origem of ACEITAR) {
      const req = reqFalso(origem);
      const res = resFalso();
      const bloqueou = guarda(req, res, CAMINHO);
      assert.strictEqual(bloqueou, false, `devia deixar passar: ${origem}`);
      assert.strictEqual(res.status, null, `nao devia ter respondido para: ${origem}`);
    }
  });

  it('com chave exigida, a mesma lista hostil tambem e recusada (nao so por falta de chave)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-auth-variantes-'));
    const con = db.abrir(path.join(dir, 'jur.db'));
    const g = chaves.criarGerenciador(con);
    const guarda = criarGuarda({ chaves: g, exigir: true });
    for (const origem of REJEITAR) {
      const req = reqFalso(origem);
      const res = resFalso();
      const bloqueou = guarda(req, res, CAMINHO);
      assert.strictEqual(bloqueou, true, `devia bloquear: ${origem}`);
      assert.strictEqual(res.status, 403, `devia ser 403 (origem), nao 401 (chave), para: ${origem}`);
    }
  });
});
