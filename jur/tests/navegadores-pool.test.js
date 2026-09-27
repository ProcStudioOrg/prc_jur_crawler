const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarPool } = require('../servidor/navegadores/pool');

test('pool global limita contas distintas e mantém posição FIFO', async () => {
  const pool = criarPool(2);
  const a = await pool.adquirir('alice-1');
  const b = await pool.adquirir('bob-1');
  let iniciou = false;
  const c = pool.adquirir('carol-1').then((soltar) => { iniciou = true; return soltar; });
  const d = pool.adquirir('alice-2');
  assert.deepEqual(pool.estado(), { total: 2, ocupados: 2, disponiveis: 0, naFila: 2 });
  assert.equal(pool.posicao('carol-1'), 1);
  assert.equal(pool.posicao('alice-2'), 2);
  assert.equal(iniciou, false);
  a(); a(); // liberação duplicada não libera duas vagas
  const soltarC = await c;
  assert.equal(pool.posicao('alice-2'), 1);
  assert.equal(pool.estado().ocupados, 2);
  b(); const soltarD = await d;
  soltarC(); soltarD();
  assert.equal(pool.estado().disponiveis, 2);
});

test('cancelar espera remove vaga e nunca inicia o trabalho cancelado', async () => {
  const pool = criarPool(1);
  const soltar = await pool.adquirir('a');
  const abort = new AbortController();
  const rejeicao = assert.rejects(pool.adquirir('b', abort.signal), { name: 'AbortError' });
  const c = pool.adquirir('c');
  abort.abort(); await rejeicao;
  assert.equal(pool.posicao('c'), 1);
  soltar(); (await c)();
  assert.equal(pool.estado().ocupados, 0);
});

test('capacidade inválida falha na inicialização', () => {
  for (const valor of [0, -1, NaN, 1.5, Infinity, 'abc']) assert.throws(() => criarPool(valor), /concorr/i);
});
