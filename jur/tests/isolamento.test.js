const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarEscopos } = require('../servidor/escopo');
const principal = (userId, teamId = 'team') => ({
  issuer: 'https://rails.example',
  userId,
  teamId,
  expiresAt: Date.now() + 60000,
});
test('separa conversas, buscas, resultados e turnos entre pessoas da mesma equipe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-scope-'));
  const scopes = criarEscopos({
    dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [] }),
  });
  const a = scopes.obter(principal('alice'));
  const b = scopes.obter(principal('bob'));
  const c = scopes.obter(principal('carol', 'other'));
  try {
    const conversation = a.conversas.criar('privada');
    const job = a.fila.enfileirar('stf', { query: 'privada' });
    await a.fila.aguardar(job.id);
    a.conversas.vincularBusca(conversation.id, job.id);
    for (const other of [b, c]) {
      assert.deepEqual(other.conversas.listar(), []);
      assert.equal(other.conversas.obter(conversation.id), null);
      assert.equal(other.conversas.apagar(conversation.id), false);
      assert.equal(other.fila.obter(job.id), null);
      assert.deepEqual(other.fila.listar(), []);
      assert.equal(other.turnos.emAndamento(conversation.id), false);
    }
    assert.equal(a.conversas.obter(conversation.id).titulo, 'privada');
    assert.equal(
      scopes
        .obter(principal('alice', 'other'))
        .conversas.obter(conversation.id),
      null,
    );
  } finally {
    scopes.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listagem de relatores também usa diretório e ambiente do proprietário', async () => {
  const executor = require('../servidor/executor');
  const ferramentas = require('../servidor/ferramentas');
  const original = executor.listar;
  let observed;
  executor.listar = async (_comando, _args, options) => {
    observed = options;
    return { ok: true, dados: { relatores: [] } };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-list-scope-'));
  const scopes = criarEscopos({ dir });
  try {
    const scope = scopes.obter(principal('alice'));
    const result = await ferramentas.executarDetalhado(
      'listar_relatores',
      { tribunal: 'stf' },
      scope,
    );
    assert.equal(result.ok, true);
    assert.equal(observed?.cwd, scope.home);
    assert.equal(observed?.env?.TMPDIR, path.join(scope.home, 'tmp'));
  } finally {
    executor.listar = original;
    scopes.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listagens de pessoas diferentes respeitam limite global de três processos', async () => {
  const executor = require('../servidor/executor');
  const original = executor.listar;
  let active = 0,
    peak = 0;
  executor.listar = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { ok: true, dados: {} };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-global-limit-'));
  const scopes = criarEscopos({ dir });
  try {
    const requests = Array.from({ length: 12 }, (_, i) =>
      scopes
        .obter(principal('user-' + i))
        .listarFn('stf', ['--listar-relatores']),
    );
    await Promise.all(requests);
    assert.equal(peak, 3);
  } finally {
    executor.listar = original;
    scopes.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache não fecha banco de job cancelado enquanto fila ainda usa recursos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-eviction-'));
  let release;
  const scopes = criarEscopos({
    dir,
    limite: 1,
    executarFn: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  try {
    const a = scopes.obter(principal('alice'));
    const queued = a.fila.enfileirar('tjsc', {});
    a.fila.cancelar(queued.id);
    assert.throws(() => scopes.obter(principal('bob')), /ocupado/);
    await new Promise(setImmediate);
    const running = a.fila.enfileirar('tjsc', {});
    await new Promise(setImmediate);
    a.fila.cancelar(running.id);
    assert.throws(() => scopes.obter(principal('bob')), /ocupado/);
    assert.equal(a.fila.obter(running.id).status, 'cancelado');
    release({ ok: true, total: 0, resultados: [] });
    await new Promise(setImmediate);
    assert.ok(scopes.obter(principal('bob')));
  } finally {
    scopes.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
