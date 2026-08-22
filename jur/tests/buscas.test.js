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

  it('recusa maxPaginas invalido (nao-numerico, negativo, acima do teto) com 400', async () => {
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 'abc' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: -5 })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 99999 })).status, 400);
  });

  it('aceita maxPaginas ausente ou dentro do teto', async () => {
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x' })).status, 202);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 5 })).status, 202);
  });

  it('offset negativo nao usa semantica de indice negativo do slice — clampa em 0', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    // Numa lista de 3 itens (A,B,C), offset=-1&limite=1 discrimina os dois
    // comportamentos: SEM clamp, Array.slice(-1, 0) usa indice negativo (conta a
    // partir do fim) e devolve [] (o "fim menos 1" fica DEPOIS do "inicio 0",
    // entao o slice fecha vazio) — o bug que o clamp existe para evitar. COM
    // clamp em 0, slice(0, 1) devolve [A], que e o que uma API de paginacao deve
    // fazer com offset negativo.
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?offset=-1&limite=1`)).json();
    assert.strictEqual(pagina.offset, 0, 'offset negativo devia ser clampado em 0 na resposta');
    assert.deepStrictEqual(pagina.itens.map((i) => i.processo), ['A']);
  });

  it('limite invalido (negativo ou nao-numerico) cai no default em vez de quebrar a pagina', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?limite=-5`)).json();
    assert.strictEqual(pagina.limite, 20, 'limite invalido devia cair no default (20)');
    assert.strictEqual(pagina.itens.length, 3); // so ha 3 itens na fixture
  });
});

describe('avisos no zero resultados (Important 3)', () => {
  // Fila separada, com executarFn que sempre devolve total:0 — para provar que a
  // garantia "total 0 nunca viaja sem aviso" vale tanto para um tribunal com nota
  // no catalogo (stf) quanto para um sem nota (tcu, disponivel:true e nota:'').
  let servidorZero; let baseZero; let filaZero;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-buscas-zero-'));
    const arquivo = path.join(dir, 'saida-vazia.json');
    fs.writeFileSync(arquivo, JSON.stringify([]));
    filaZero = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo, erro: null }),
    });
    servidorZero = http.createServer(criarApp({ fila: filaZero }).handler);
    await new Promise((r) => servidorZero.listen(0, r));
    baseZero = `http://127.0.0.1:${servidorZero.address().port}`;
  });

  after(() => servidorZero.close());

  const criarZero = (corpo) => fetch(`${baseZero}/api/v1/buscas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });

  it('tribunal com nota no catalogo: o aviso e a propria nota', async () => {
    const { id } = await (await criarZero({ tribunal: 'stf', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.ok(job.avisos.length > 0, 'total 0 nunca pode viajar com avisos vazio');
    assert.ok(job.avisos[0].length > 0);
  });

  it('tribunal sem nota no catalogo (tcu): ainda assim recebe um aviso generico honesto', async () => {
    const { id } = await (await criarZero({ tribunal: 'tcu', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.ok(job.avisos.length > 0, 'total 0 nunca pode viajar com avisos vazio, mesmo sem nota no catalogo');
    assert.match(job.avisos[0], /nao comprova/i);
  });
});
