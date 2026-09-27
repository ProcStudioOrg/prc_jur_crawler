const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { criarRegistro } = require('../servidor/navegadores/registro');

test('preferências privadas persistem e captcha implica acompanhamento', () => {
  const con = new DatabaseSync(':memory:');
  const r = criarRegistro(con);
  assert.deepEqual(r.preferencias(), { acompanhar: false, captcha: false, provedor: 'local' });
  assert.deepEqual(r.salvar({ acompanhar: false, captcha: true, provedor: 'local' }), { acompanhar: true, captcha: true, provedor: 'local' });
  assert.equal(criarRegistro(con).preferencias().captcha, true);
  assert.throws(() => r.salvar({ acompanhar: 'true', captcha: false }), /prefer/i);
  con.close();
});

test('registro só aceita screenshot opt-in e controle durante pausa da própria sessão', async () => {
  const con = new DatabaseSync(':memory:');
  const r = criarRegistro(con);
  r.registrar('off', 'tjsp');
  assert.throws(() => r.requisitar('off', 'tela'), /acompanhamento/i);
  r.salvar({ acompanhar: true, captcha: true, provedor: 'local' });
  r.registrar('job', 'stj');
  const child = new EventEmitter(); child.connected = true;
  child.send = (m, cb) => { cb?.(); setImmediate(() => child.emit('message', { jurNavegador: true, requestId: m.requestId, dados: { ok: true } })); };
  r.anexar('job', child);
  assert.throws(() => r.requisitar('job', 'acao', { tipo: 'continuar' }), /pausado/i);
  child.emit('message', { jurNavegador: true, tipo: 'estado', estado: 'aguardando_usuario', mensagem: 'Preencha o captcha.' });
  assert.deepEqual(await r.requisitar('job', 'acao', { tipo: 'continuar' }), { ok: true });
  assert.throws(() => r.requisitar('other', 'tela'), /encontrad/i);
  r.remover('job');
  assert.equal(child.listenerCount('message'), 0);
  con.close();
});
