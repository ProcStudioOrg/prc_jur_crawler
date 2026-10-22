const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');
const { criarCobranca } = require('../servidor/cobranca');

const abrirTmp = () => db.abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-cobranca-')), 'jur.db'));
const principal = { issuer: 'https://procstudio.test', userId: 'u1', teamId: 't1', expiresAt: Date.now() + 3600e3 };
const erro = (status, code) => Object.assign(new Error(code || 'ProcStudio indisponível. Tente novamente.'), { status, ...(code ? { code } : {}) });

const BALANCE = {
  ativo: true, podeOperar: true, saldoCents: 1000, saldoBrl: '10,00', limiteNegativoCents: 0,
  mensagem: null, topupPath: '/configuracoes/ia', modelo: { modelId: 'glm' },
};
const USO_OK = { cobradoCents: 2, cobradoBrl: '0,02', saldoCents: 998, saldoBrl: '9,98', podeOperar: true, duplicado: false };
const USO = { requestId: 'c1:0:0', modelId: 'glm', inputTokens: 10, outputTokens: 5 };

// Respostas programáveis: cada item é o valor devolvido, um Error lançado ou uma função chamada na hora.
function procstudioFalso({ saldos = [], usos = [] } = {}) {
  const chamadas = { saldo: 0, registrarUso: [] };
  const proximo = async (fila) => {
    let r = fila.length > 1 ? fila.shift() : fila[0];
    if (typeof r === 'function') r = await r();
    if (r instanceof Error) throw r;
    return structuredClone(r);
  };
  return {
    chamadas,
    async saldo(p) { assert.equal(p.userId, 'u1'); chamadas.saldo++; return proximo(saldos); },
    async registrarUso(p, u) { chamadas.registrarUso.push({ p, u }); return proximo(usos); },
  };
}

function kaizenFalso(ligado = true) {
  const itens = [];
  return { itens, outbox: { ligado, enfileirar: (source, corpo) => { itens.push({ source, corpo }); return true; } } };
}

function montar({ con = abrirTmp(), procstudio, kaizen = kaizenFalso(), relogio = { t: 1_000_000 } } = {}) {
  const logs = [];
  const esperas = [];
  const cobranca = criarCobranca({
    con, procstudio, principal, kaizen,
    agora: () => relogio.t,
    esperar: async (ms) => { esperas.push(ms); },
    logar: (linha) => logs.push(JSON.parse(linha)),
  });
  return { cobranca, con, logs, esperas, relogio, kaizen };
}

describe('cobranca: pré-checagem', () => {
  it('cache de 30 s: duas checagens em 10 s = uma ida; 31 s depois = nova ida', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE] });
    const { cobranca, relogio } = montar({ procstudio });
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
    relogio.t += 10_000;
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
    assert.equal(procstudio.chamadas.saldo, 1);
    relogio.t += 21_000;
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
    assert.equal(procstudio.chamadas.saldo, 2);
  });

  it('sem saldo devolve motivo saldo com mensagem e topupPath', async () => {
    const procstudio = procstudioFalso({ saldos: [{ ...BALANCE, podeOperar: false, saldoBrl: '-5,00', mensagem: 'Saldo esgotado.' }] });
    const { cobranca } = montar({ procstudio });
    assert.deepEqual(await cobranca.podeOperar(), {
      ok: false, motivo: 'saldo', saldoBrl: '-5,00', mensagem: 'Saldo esgotado.', topupPath: '/configuracoes/ia',
    });
  });

  it('PRICING_UNAVAILABLE, 503 e ativo:false viram indisponivel e não ficam em cache', async () => {
    const procstudio = procstudioFalso({ saldos: [erro(503, 'PRICING_UNAVAILABLE'), erro(503), { ativo: false }, BALANCE] });
    const { cobranca, logs, kaizen } = montar({ procstudio });
    for (let i = 0; i < 3; i++) assert.deepEqual(await cobranca.podeOperar(), { ok: false, motivo: 'indisponivel' });
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
    assert.equal(procstudio.chamadas.saldo, 4);
    assert.equal(logs.filter((l) => l.event === 'procstudio_llm_operator_failure').length, 2);
    assert.deepEqual(kaizen.itens.map((i) => [i.source, i.corpo.origem, i.corpo.classe, i.corpo.status]), [
      ['jur-diagnostico', 'cobranca', 'operador', 503],
      ['jur-diagnostico', 'cobranca', 'operador', 503],
    ]);
  });

  it('saldo forçado que volta inativo ou falha apaga o cache do podeOperar', async () => {
    for (const ruim of [{ ativo: false }, erro(503)]) {
      const procstudio = procstudioFalso({ saldos: [BALANCE, ruim] });
      const { cobranca } = montar({ procstudio });
      assert.deepEqual(await cobranca.podeOperar(), { ok: true });
      await cobranca.saldo({ forcar: true }).catch(() => {});
      assert.deepEqual(await cobranca.podeOperar(), { ok: false, motivo: 'indisponivel' });
      assert.equal(procstudio.chamadas.saldo, 3);
    }
  });

  it('dois criarCobranca com con diferentes não compartilham cache', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE] });
    const relogio = { t: 5_000 };
    const a = montar({ procstudio, relogio });
    const b = montar({ procstudio, relogio });
    await a.cobranca.podeOperar();
    await b.cobranca.podeOperar();
    assert.equal(procstudio.chamadas.saldo, 2);
  });

  it('saldo() usa o cache e busca de novo com forcar', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE] });
    const { cobranca } = montar({ procstudio });
    assert.equal((await cobranca.saldo()).saldoBrl, '10,00');
    assert.equal((await cobranca.saldo()).saldoBrl, '10,00');
    assert.equal(procstudio.chamadas.saldo, 1);
    await cobranca.saldo({ forcar: true });
    assert.equal(procstudio.chamadas.saldo, 2);
  });
});

describe('cobranca: registro', () => {
  it('2 falhas e sucesso na 3ª não gera pendência; espera 1 s e 3 s', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE], usos: [erro(503), erro(503), USO_OK] });
    const { cobranca, esperas } = montar({ procstudio });
    assert.deepEqual(await cobranca.registrar(USO), { cobradoBrl: '0,02', saldoBrl: '9,98', podeOperar: true, duplicado: false });
    assert.deepEqual(esperas, [1000, 3000]);
    assert.equal(cobranca.pendentes(), 0);
    assert.equal(procstudio.chamadas.registrarUso.length, 3);
    assert.equal(procstudio.chamadas.registrarUso[0].u.requestId, 'c1:0:0');
  });

  it('3 falhas gravam pendência, lançam COBRANCA_PENDENTE e bloqueiam a conta', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE], usos: [erro(503)] });
    const { cobranca, con } = montar({ procstudio });
    await assert.rejects(cobranca.registrar(USO), {
      code: 'COBRANCA_PENDENTE',
      message: 'Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes.',
    });
    assert.equal(cobranca.pendentes(), 1);
    const linha = con.prepare('SELECT * FROM cobranca_pendente').get();
    assert.equal(linha.request_id, 'c1:0:0');
    assert.equal(linha.tentativas, 3);
    assert.equal(linha.em_voo, 0);
    assert.deepEqual(JSON.parse(linha.payload).uso, USO);
    assert.equal(JSON.parse(linha.payload).principal.teamId, 't1');
    assert.deepEqual(await cobranca.podeOperar(), { ok: false, motivo: 'pendente' });
    assert.equal(procstudio.chamadas.saldo, 0);
  });

  it('recibo é gravado em voo antes da 1ª ida ao Rails e some no sucesso', async () => {
    const vistos = [];
    let m;
    const olhar = () => {
      const linha = m.con.prepare('SELECT em_voo, payload FROM cobranca_pendente WHERE request_id = ?').get('c1:0:0');
      vistos.push([linha?.em_voo, JSON.parse(linha.payload).uso.requestId, m.cobranca.pendentes()]);
    };
    const procstudio = procstudioFalso({
      usos: [() => { olhar(); return erro(503); }, () => { olhar(); return erro(503); }, () => { olhar(); return { ...USO_OK, duplicado: true }; }],
    });
    m = montar({ procstudio });
    assert.equal((await m.cobranca.registrar(USO)).duplicado, true);
    assert.deepEqual(vistos, [[1, 'c1:0:0', 0], [1, 'c1:0:0', 0], [1, 'c1:0:0', 0]]);
    assert.equal(m.con.prepare('SELECT COUNT(*) AS n FROM cobranca_pendente').get().n, 0);
  });

  it('recibo em voo não bloqueia a conta nem entra na drenagem', async () => {
    let m;
    let durante;
    const procstudio = procstudioFalso({
      saldos: [BALANCE],
      usos: [async () => {
        durante = { pode: await m.cobranca.podeOperar(), drenagem: await m.cobranca.drenar() };
        return USO_OK;
      }],
    });
    m = montar({ procstudio });
    await m.cobranca.registrar(USO);
    assert.deepEqual(durante, { pode: { ok: true }, drenagem: { enviados: 0, descartados: 0, adiados: 0 } });
    assert.equal(procstudio.chamadas.registrarUso.length, 1);
  });

  it('códigos terminais não geram pendência: logam billing_receipt_dropped e lançam COBRANCA_RECUSADA', async () => {
    for (const [status, code] of [[410, 'USER_GONE'], [422, 'INVALID_USAGE'], [401, 'SERVICE_AUTH'], [403, 'TEAM_REJECTED'], [404, 'TEAM_REJECTED']]) {
      const procstudio = procstudioFalso({ usos: [erro(status, code)] });
      const m = montar({ procstudio });
      const { cobranca, logs, esperas } = m;
      await assert.rejects(cobranca.registrar(USO), { code: 'COBRANCA_RECUSADA' });
      assert.equal(cobranca.pendentes(), 0);
      assert.equal(m.con.prepare('SELECT COUNT(*) AS n FROM cobranca_pendente').get().n, 0, code);
      assert.equal(procstudio.chamadas.registrarUso.length, 1, code);
      assert.deepEqual(esperas, []);
      assert.deepEqual(logs.map((l) => [l.event, l.motivo, l.requestId]), [['billing_receipt_dropped', code, 'c1:0:0']]);
    }
  });

  it('can_operate:false no registro faz podeOperar devolver saldo sem nova ida ao Rails', async () => {
    const procstudio = procstudioFalso({ saldos: [BALANCE], usos: [{ ...USO_OK, podeOperar: false, saldoBrl: '-0,50' }] });
    const { cobranca } = montar({ procstudio });
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
    await cobranca.registrar(USO);
    const r = await cobranca.podeOperar();
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'saldo');
    assert.equal(r.saldoBrl, '-0,50');
    assert.equal(r.topupPath, '/configuracoes/ia');
    assert.equal(procstudio.chamadas.saldo, 1);
  });

  it('falha do Rails no registro gera log e diagnóstico a cada tentativa; outbox desligada não recebe', async () => {
    const procstudio = procstudioFalso({ usos: [erro(503, 'PRICING_UNAVAILABLE'), USO_OK] });
    const kaizen = kaizenFalso(false);
    const { cobranca, logs } = montar({ procstudio, kaizen });
    await cobranca.registrar(USO);
    assert.deepEqual(logs.map((l) => [l.event, l.status, l.erro]), [['procstudio_llm_operator_failure', 503, 'PRICING_UNAVAILABLE']]);
    assert.deepEqual(kaizen.itens, []);
  });
});

describe('cobranca: falha do operador', () => {
  it('padroniza o erro, loga e enfileira diagnóstico sem segredos', () => {
    const procstudio = procstudioFalso();
    const { cobranca, logs, kaizen } = montar({ procstudio });
    const e = cobranca.falhaDoOperador(Object.assign(new Error('Insufficient credits'), { status: 402, headers: { authorization: 'Bearer x' } }));
    assert.equal(e.code, 'PROCSTUDIO_LLM_INDISPONIVEL');
    assert.equal(e.status, 503);
    assert.equal(e.message, 'A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.');
    assert.deepEqual(logs, [{ event: 'procstudio_llm_operator_failure', origem: 'cobranca', status: 402, erro: 'Insufficient credits' }]);
    assert.deepEqual(kaizen.itens, [{ source: 'jur-diagnostico', corpo: { origem: 'cobranca', classe: 'operador', erro: 'Insufficient credits', status: 402 } }]);
  });
});

describe('cobranca: pendências', () => {
  async function comPendencia(usosDepois) {
    const fila = [erro(503), erro(503), erro(503), ...usosDepois];
    const procstudio = procstudioFalso({ saldos: [BALANCE], usos: fila });
    const m = montar({ procstudio });
    await assert.rejects(m.cobranca.registrar(USO), { code: 'COBRANCA_PENDENTE' });
    m.logs.length = 0;
    return { ...m, procstudio };
  }

  it('drenar() com sucesso zera e libera a conta', async () => {
    const { cobranca, procstudio } = await comPendencia([USO_OK]);
    assert.deepEqual(await cobranca.drenar(), { enviados: 1, descartados: 0, adiados: 0 });
    assert.equal(cobranca.pendentes(), 0);
    assert.equal(procstudio.chamadas.registrarUso.at(-1).p.userId, 'u1');
    assert.deepEqual(await cobranca.podeOperar(), { ok: true });
  });

  it('410 na drenagem descarta e loga billing_receipt_dropped', async () => {
    const { cobranca, logs } = await comPendencia([erro(410, 'USER_GONE')]);
    assert.deepEqual(await cobranca.drenar(), { enviados: 0, descartados: 1, adiados: 0 });
    assert.equal(cobranca.pendentes(), 0);
    assert.deepEqual(logs.map((l) => [l.event, l.motivo, l.requestId]), [['billing_receipt_dropped', 'USER_GONE', 'c1:0:0']]);
  });

  it('503 na drenagem adia, soma tentativa e avisa quando passa de 24 h', async () => {
    const { cobranca, con, logs, relogio } = await comPendencia([erro(503)]);
    assert.deepEqual(await cobranca.drenar(), { enviados: 0, descartados: 0, adiados: 1 });
    const linha = con.prepare('SELECT tentativas, ultimo_erro FROM cobranca_pendente').get();
    assert.equal(linha.tentativas, 4);
    assert.match(linha.ultimo_erro, /indisponível/);
    assert.equal(logs.some((l) => l.event === 'billing_pending_stale'), false);
    relogio.t += 24 * 3600e3 + 1;
    await cobranca.drenar();
    assert.equal(logs.filter((l) => l.event === 'billing_pending_stale').length, 1);
  });

  it('linha ilegível é descartada com log e não impede as demais', async () => {
    const { cobranca, con, logs, procstudio } = await comPendencia([USO_OK]);
    con.prepare("INSERT INTO cobranca_pendente (request_id, payload, criado_em) VALUES ('ruim', '{quebrado', 0)").run();
    assert.equal(cobranca.pendentes(), 2);
    assert.deepEqual(await cobranca.drenar(), { enviados: 1, descartados: 1, adiados: 0 });
    assert.equal(cobranca.pendentes(), 0);
    assert.deepEqual(logs.map((l) => [l.event, l.requestId]), [['billing_receipt_corrupt', 'ruim']]);
    assert.equal(procstudio.chamadas.registrarUso.at(-1).u.requestId, 'c1:0:0');
  });

  it('iniciarVarredor recupera recibos em voo de um processo que caiu', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const con = abrirTmp();
    con.prepare(`INSERT INTO cobranca_pendente (request_id, payload, criado_em, em_voo) VALUES (?, ?, 0, 1)`)
      .run('c1:0:0', JSON.stringify({ principal, uso: USO }));
    const procstudio = procstudioFalso({ usos: [USO_OK] });
    const { cobranca } = montar({ con, procstudio });
    assert.equal(cobranca.pendentes(), 0);
    cobranca.iniciarVarredor();
    assert.equal(con.prepare('SELECT em_voo FROM cobranca_pendente').get().em_voo, 0);
    assert.equal(cobranca.pendentes(), 1);
    t.mock.timers.tick(60_000);
    await new Promise(setImmediate);
    assert.equal(cobranca.pendentes(), 0);
    assert.equal(procstudio.chamadas.registrarUso.length, 1);
    cobranca.pararVarredor();
  });

  it('drenar sem principal usa o principal gravado no recibo', async () => {
    const { con } = await comPendencia([]);
    const procstudio = procstudioFalso({ usos: [USO_OK] });
    const semPrincipal = criarCobranca({ con, procstudio, kaizen: kaizenFalso(), logar: () => {} });
    assert.equal((await semPrincipal.drenar()).enviados, 1);
    assert.equal(procstudio.chamadas.registrarUso[0].p.teamId, 't1');
    assert.equal(procstudio.chamadas.registrarUso[0].p.issuer, principal.issuer);
  });

  it('varredor: 60 s, só agenda com pendência, para de agendar quando zera', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cobranca, procstudio } = await comPendencia([erro(503), USO_OK]);
    cobranca.iniciarVarredor();
    const antes = procstudio.chamadas.registrarUso.length;
    t.mock.timers.tick(59_999);
    await new Promise(setImmediate);
    assert.equal(procstudio.chamadas.registrarUso.length, antes);
    t.mock.timers.tick(1);
    await new Promise(setImmediate);
    assert.equal(procstudio.chamadas.registrarUso.length, antes + 1);
    assert.equal(cobranca.pendentes(), 1);
    t.mock.timers.tick(60_000);
    await new Promise(setImmediate);
    assert.equal(cobranca.pendentes(), 0);
    t.mock.timers.tick(600_000);
    await new Promise(setImmediate);
    assert.equal(procstudio.chamadas.registrarUso.length, antes + 2);
    cobranca.pararVarredor();
  });

  it('varredor ligado sem pendência agenda quando um registro vira pendência', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const procstudio = procstudioFalso({ usos: [erro(503), erro(503), erro(503), USO_OK] });
    const { cobranca } = montar({ procstudio });
    cobranca.iniciarVarredor();
    await assert.rejects(cobranca.registrar(USO), { code: 'COBRANCA_PENDENTE' });
    t.mock.timers.tick(60_000);
    await new Promise(setImmediate);
    assert.equal(cobranca.pendentes(), 0);
    cobranca.pararVarredor();
  });
});
