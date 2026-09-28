const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../servidor/db');
const { criarFila } = require('../servidor/jobs');
const { criarPool } = require('../servidor/navegadores/pool');
const { criarRegistro } = require('../servidor/navegadores/registro');

test('duas contas compartilham limite; espera fica enfileirada e cancelada não executa', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-pool-'));
  const pool = criarPool(1);
  const conA = db.abrir(':memory:'); const conB = db.abrir(':memory:');
  t.after(() => { conA.close(); conB.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const iniciou = []; let liberar;
  const executarFn = async (c, p) => {
    iniciou.push(p.query);
    if (p.query === 'primeira') await new Promise((r) => { liberar = r; });
    return { ok: true, total: 0, resultados: [] };
  };
  const opt = { pool, executarFn, dirResultados: dir, catalogoFn: () => ({ disponivel: true }) };
  const a = criarFila({ ...opt, con: conA }); const b = criarFila({ ...opt, con: conB });
  const j1 = a.enfileirar('tjsp', { query: 'primeira' });
  const j2 = b.enfileirar('tjsp', { query: 'cancelada' });
  const j3 = b.enfileirar('tjsp', { query: 'terceira' });
  await new Promise(setImmediate);
  assert.equal(b.obter(j2.id).status, 'enfileirado');
  assert.equal(pool.posicao(j2.id), 1);
  b.cancelar(j2.id);
  liberar();
  await Promise.all([a.aguardar(j1.id), b.aguardar(j3.id)]);
  assert.deepEqual(iniciou, ['primeira', 'terceira']);
  assert.equal(b.obter(j2.id).status, 'cancelado');
  assert.equal(pool.estado().ocupados, 0);
});

test('admissão global preserva A1, B1, A2 recebidos no mesmo turno', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-fifo-'));
  const pool = criarPool(1);
  const cons = [db.abrir(':memory:'), db.abrir(':memory:')];
  t.after(() => { cons.forEach((c) => c.close()); fs.rmSync(dir, { recursive: true, force: true }); });
  const ordem = [];
  const filas = cons.map((con) => criarFila({ con, pool, dirResultados: dir,
    catalogoFn: () => ({ disponivel: true }), executarFn: async (c, p) => {
      ordem.push(p.query); return { ok: true, total: 0, resultados: [] };
    },
  }));
  const a1 = filas[0].enfileirar('tjsp', { query: 'A1' });
  const b1 = filas[1].enfileirar('tjsp', { query: 'B1' });
  const a2 = filas[0].enfileirar('tjsp', { query: 'A2' });
  await Promise.all([filas[0].aguardar(a1.id), filas[1].aguardar(b1.id), filas[0].aguardar(a2.id)]);
  assert.deepEqual(ordem, ['A1', 'B1', 'A2']);
});

test('provedor removido rejeita busca sem deixar job fantasma no histórico', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-provedor-'));
  const con = db.abrir(':memory:');
  t.after(() => { con.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  criarRegistro(con, { browserbase: true }).salvar({ acompanhar: true, captcha: false, provedor: 'browserbase' });
  const registro = criarRegistro(con); // serviço reiniciado sem credenciais
  const fila = criarFila({ con, pool: criarPool(1), navegadores: registro, dirResultados: dir,
    catalogoFn: () => ({ disponivel: true }), executarFn: () => assert.fail('não deve executar') });
  assert.throws(() => fila.enfileirar('tjsp', { query: 'teste' }), /configurado/i);
  assert.deepEqual(fila.listar(), []);
});
