const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor; let base; let fila;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-buscas-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A' }, { processo: 'B' }, { processo: 'C' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 3, resultados: [], arquivo, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const criar = (corpo) => fetch(`${base}/api/v1/buscas`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

describe('rotas de busca', () => {
  it('cria busca e devolve 202 com id', async () => {
    const r = await criar({ tribunal: 'stf', query: 'aposentadoria' });
    assert.strictEqual(r.status, 202);
    const corpo = await r.json();
    assert.ok(corpo.id);
    assert.strictEqual(corpo.status, 'enfileirado');
  });

  it('recusa busca sem tribunal e sem query', async () => {
    assert.strictEqual((await criar({ query: 'x' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf' })).status, 400);
  });

  it('recusa tribunal indisponivel com 409 e explica', async () => {
    const r = await criar({ tribunal: 'stj', query: 'x' });
    assert.strictEqual(r.status, 409);
    const corpo = await r.json();
    assert.match(corpo.erro, /indispon/i);
    assert.ok(corpo.nota && corpo.nota.length > 0, 'o usuario precisa saber POR QUE');
  });

  it('acompanha ate concluido e pagina resultados', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    const job = await (await fetch(`${base}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.status, 'concluido');
    assert.strictEqual(job.total, 3);
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?offset=1&limite=1`)).json();
    assert.strictEqual(pagina.itens.length, 1);
    assert.strictEqual(pagina.itens[0].processo, 'B');
  });

  it('404 para busca inexistente', async () => {
    assert.strictEqual((await fetch(`${base}/api/v1/buscas/nao-existe`)).status, 404);
  });

  it('DELETE cancela', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    const r = await fetch(`${base}/api/v1/buscas/${id}`, { method: 'DELETE' });
    assert.ok([200, 409].includes(r.status)); // 409 se ja terminou antes do DELETE
  });
});
