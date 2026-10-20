// jur/tests/kaizen-agenda.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proximaExecucao, diaDaSemanaSP, iniciarAgenda } = require('../servidor/kaizen/agenda');

const microtarefas = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('proximas 04:00 em Sao Paulo', () => {
  assert.equal(proximaExecucao(Date.parse('2026-10-18T06:59:00Z')), Date.parse('2026-10-18T07:00:00Z'));
  assert.equal(proximaExecucao(Date.parse('2026-10-18T07:00:00Z')), Date.parse('2026-10-19T07:00:00Z'));
  // 23:30 em SP ja e o dia seguinte em UTC: a proxima e as 04:00 de SP, nao de UTC
  assert.equal(proximaExecucao(Date.parse('2026-10-19T02:30:00Z')), Date.parse('2026-10-19T07:00:00Z'));
  assert.equal(diaDaSemanaSP(Date.parse('2026-10-19T07:00:00Z')), 1);
  assert.equal(diaDaSemanaSP(Date.parse('2026-10-19T02:30:00Z')), 0, 'ainda domingo em SP');
});

test('versao nova roda com remoto logo apos o boot; domingo nao libera remoto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-18T10:00:00Z') });
  const rodadas = [];
  const agenda = iniciarAgenda({ rodar: async (o) => rodadas.push(o), versaoNova: true, atrasoBootMs: 1000 });
  t.mock.timers.tick(1000); await microtarefas();
  assert.deepEqual(rodadas, [{ remotoPermitido: true }]);
  t.mock.timers.tick(Date.parse('2026-10-19T07:00:00Z') - Date.parse('2026-10-18T10:00:01Z')); await microtarefas();
  assert.equal(rodadas.length, 2);
  assert.deepEqual(rodadas.at(-1), { remotoPermitido: true }, 'segunda-feira');
  t.mock.timers.tick(24 * 3600e3); await microtarefas();
  assert.equal(rodadas.length, 3);
  assert.deepEqual(rodadas.at(-1), { remotoPermitido: false }, 'terca-feira');
  agenda.parar();
});

test('sem versao nova nao ha rodada de boot; erro da rodada nao para a agenda', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T06:00:00Z') });
  const erros = [];
  t.mock.method(console, 'error', (...a) => erros.push(a.join(' ')));
  let n = 0;
  const agenda = iniciarAgenda({ rodar: async () => { n++; throw new Error('quebrou'); }, atrasoBootMs: 1000 });
  t.mock.timers.tick(1000); await microtarefas();
  assert.equal(n, 0);
  t.mock.timers.tick(3600e3); await microtarefas();
  assert.equal(n, 1);
  assert.match(erros.join('\n'), /quebrou/);
  t.mock.timers.tick(24 * 3600e3); await microtarefas();
  assert.equal(n, 2, 'a proxima foi agendada mesmo com o erro');
  agenda.parar();
  t.mock.timers.tick(24 * 3600e3); await microtarefas();
  assert.equal(n, 2, 'parar cancela');
});

test('rodadas nunca se sobrepoem: a que chega durante outra espera ela terminar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-19T06:59:00Z') });
  let ativas = 0; let maximo = 0; const soltar = [];
  const rodar = () => { ativas++; maximo = Math.max(maximo, ativas); return new Promise((r) => soltar.push(() => { ativas--; r(); })); };
  const agenda = iniciarAgenda({ rodar, versaoNova: true, atrasoBootMs: 1000 });
  t.mock.timers.tick(1000); await microtarefas(); // boot começa
  t.mock.timers.tick(59e3); await microtarefas(); // 04:00 chega com o boot ainda rodando
  assert.equal(soltar.length, 1);
  soltar[0](); await microtarefas();
  assert.equal(soltar.length, 2, 'a das 04:00 roda depois');
  soltar[1](); await microtarefas();
  assert.equal(maximo, 1);
  agenda.parar();
});

test('timer que dispara 1 ms antes do alvo nao roda a mesma 04:00 duas vezes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T06:00:00Z') });
  let adiantado = 0; // relógio de parede atrás do monotônico
  const rodadas = [];
  const agenda = iniciarAgenda({ rodar: async (o) => rodadas.push(o), agora: () => Date.now() - adiantado });
  adiantado = 1;
  t.mock.timers.tick(3600e3); await microtarefas();
  assert.equal(rodadas.length, 1);
  t.mock.timers.tick(10); await microtarefas();
  t.mock.timers.tick(1000); await microtarefas();
  assert.equal(rodadas.length, 1, 'a proxima e amanha');
  t.mock.timers.tick(24 * 3600e3); await microtarefas();
  assert.equal(rodadas.length, 2);
  agenda.parar();
});

test('rodadas que chegam durante outra viram UMA pendente, com remoto se alguma tinha', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-18T06:59:00Z') }); // domingo
  const rodadas = []; const soltar = [];
  const rodar = (o) => { rodadas.push(o); return new Promise((r) => soltar.push(r)); };
  const agenda = iniciarAgenda({ rodar, versaoNova: true, atrasoBootMs: 1000 });
  t.mock.timers.tick(1000); await microtarefas(); // boot (remoto) começa e trava
  t.mock.timers.tick(59e3); await microtarefas(); // domingo 04:00 (sem remoto)
  t.mock.timers.tick(24 * 3600e3); await microtarefas(); // segunda 04:00 (remoto)
  t.mock.timers.tick(24 * 3600e3); await microtarefas(); // terça 04:00 (sem remoto)
  assert.equal(rodadas.length, 1);
  soltar[0](); await microtarefas();
  assert.equal(rodadas.length, 2, 'tres atrasadas viram uma');
  assert.deepEqual(rodadas[1], { remotoPermitido: true });
  soltar[1](); await microtarefas();
  assert.equal(rodadas.length, 2);
  agenda.parar();
});

test('aoBoot e chamado quando o timer de boot dispara, antes da rodada; sem versao nova, nunca', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T10:00:00Z') });
  const ordem = [];
  const agenda = iniciarAgenda({ rodar: async () => ordem.push('rodar'), versaoNova: true, atrasoBootMs: 1000, aoBoot: () => ordem.push('aoBoot') });
  t.mock.timers.tick(999); await microtarefas();
  assert.deepEqual(ordem, []);
  t.mock.timers.tick(1); await microtarefas();
  assert.deepEqual(ordem, ['aoBoot', 'rodar']);
  agenda.parar();
  let chamado = false;
  const outra = iniciarAgenda({ rodar: async () => {}, atrasoBootMs: 1000, aoBoot: () => { chamado = true; } });
  t.mock.timers.tick(5000); await microtarefas();
  assert.equal(chamado, false);
  outra.parar();
});
