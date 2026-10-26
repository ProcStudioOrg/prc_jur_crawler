const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { iniciarLocal } = require('../dev/local');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-local-'));
  const local = await iniciarLocal({ port: 0, dir, concorrencia: 1 });
  t.after(async () => { await local.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  return local;
}
async function login(base) {
  const cookies = new Map();
  let target = base + '/auth/login';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(target, { redirect: 'manual', headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const value of r.headers.getSetCookie()) {
      const [name, ...parts] = value.split(';')[0].split('='); cookies.set(name, parts.join('='));
    }
    if (!r.headers.has('location')) break;
    target = new URL(r.headers.get('location'), base).href;
    assert.equal(new URL(target).origin, base, 'login nunca acessa o ProcStudio');
  }
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

test('modo local cria sessão sem ProcStudio e preserva autenticação, origem e logout', async (t) => {
  const { base } = await fixture(t);
  assert.equal((await fetch(base + '/api/v1/me')).status, 401);
  const cookie = await login(base);
  const me = await (await fetch(base + '/api/v1/me', { headers: { cookie } })).json();
  assert.equal(me.userId, 'local');
  const browsers = await (await fetch(base + '/api/v1/navegadores', { headers: { cookie } })).json();
  assert.equal(browsers.total, 1);
  const preferences = { acompanhar: true, captcha: true, provedor: 'local' };
  assert.equal((await fetch(base + '/api/v1/navegadores/preferencias', { method: 'POST', headers: { cookie, origin: 'https://fora.example', 'content-type': 'application/json' }, body: JSON.stringify(preferences) })).status, 403);
  assert.equal((await fetch(base + '/api/v1/navegadores/preferencias', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(preferences) })).status, 200);
  assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie, origin: base } })).status, 200);
  assert.equal((await fetch(base + '/api/v1/me', { headers: { cookie } })).status, 401);
});

test('modo local rejeita Host externo e acesso cross-site; login não aceita código inventado', async (t) => {
  const { base } = await fixture(t);
  const externalHost = await new Promise((resolve, reject) => {
    http.get(base, { headers: { host: 'externo.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(externalHost, 403);
  assert.equal((await fetch(base + '/auth/login', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const r = await fetch(base + '/auth/login', { redirect: 'manual' });
  const state = new URL(r.headers.get('location')).searchParams.get('state');
  const callback = await fetch(base + '/auth/callback?code=inventado&state=' + state, { redirect: 'manual', headers: { cookie: r.headers.get('set-cookie').split(';')[0] } });
  assert.equal(callback.headers.get('location'), '/?login=erro');
  assert.doesNotMatch(callback.headers.get('set-cookie'), /jur_session=/);
});

test('encerrar o ambiente interrompe a execução e não inicia pesquisas que estavam na fila', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-local-stop-'));
  let iniciadas = 0;
  const local = await iniciarLocal({ port: 0, dir, concorrencia: 1,
    executarFn: (_c, _p, options) => new Promise(resolve => {
      iniciadas++;
      options.sinal.addEventListener('abort', () => resolve({ ok: false, erro: 'interrompido' }), { once: true });
    }) });
  try {
    const cookie = await login(local.base);
    for (let i = 0; i < 3; i++) {
      const r = await fetch(local.base + '/api/v1/buscas', { method: 'POST', headers: { cookie, origin: local.base, 'content-type': 'application/json' }, body: JSON.stringify({ tribunal: 'tjsp', query: 'teste', maxPaginas: 1 }) });
      assert.equal(r.status, 202);
    }
    assert.equal(iniciadas, 1);
    await local.fechar();
    assert.equal(iniciadas, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('chave local é persistida com permissão privada para manter conexões após reinício', async (t) => {
  const { dir, base } = await fixture(t);
  await login(base);
  const keyPath = path.join(dir, 'cofre.key');
  const key = fs.readFileSync(keyPath, 'utf8');
  assert.equal(Buffer.from(key, 'base64').length, 32);
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
  const other = await iniciarLocal({ port: 0, dir, concorrencia: 1 });
  await other.fechar();
  assert.equal(fs.readFileSync(keyPath, 'utf8'), key);
});

test('encerramento do processo local aguarda SIGKILL de descendente que ignora SIGTERM', { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-local-group-'));
  const descendantCode = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'descendant.pid'))},String(process.pid));setInterval(()=>{},1000);`;
  const leaderCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendantCode)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const script = `
    const {iniciarLocal}=require(${JSON.stringify(require.resolve('../dev/local'))});
    const {spawn}=require('node:child_process');
    iniciarLocal({port:0,dir:${JSON.stringify(dir)},concorrencia:1,executarFn:(_c,_p,extra)=>new Promise(resolve=>{
      const child=spawn(process.execPath,['-e',${JSON.stringify(leaderCode)}],{detached:true,stdio:'ignore'});
      require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'leader.pid'))},String(child.pid));
      extra.aoIniciar(child.pid);
      child.on('close',()=>resolve({ok:false,erro:'interrompido'}));
    })}).then(local=>{
      process.on('SIGTERM',async()=>{await local.fechar();process.exit(0)});
      process.send(local.base);
    });`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => {
    for (const name of ['leader.pid', 'descendant.pid']) {
      try { const pid = Number(fs.readFileSync(path.join(dir, name), 'utf8')); process.kill(name === 'leader.pid' ? -pid : pid, 'SIGKILL'); } catch {}
    }
    child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true });
  });
  const [base] = await once(child, 'message');
  const cookie = await login(base);
  const response = await fetch(base + '/api/v1/buscas', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ tribunal: 'tjsp', query: 'teste', maxPaginas: 1 }) });
  assert.equal(response.status, 202);
  const readyDeadline = Date.now() + 4000;
  while (!fs.existsSync(path.join(dir, 'descendant.pid')) && Date.now() < readyDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  const pid = Number(fs.readFileSync(path.join(dir, 'descendant.pid'), 'utf8'));
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  let alive = true;
  const deadline = Date.now() + 1000;
  while (alive && Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(alive, false, 'encerramento não pode abandonar descendente que ignora SIGTERM');
});

// Carteira simulada: o chat gerenciado só existe com PROCSTUDIO_LLM_API_KEY, lida no boot.
async function comCarteira(t, { saldoInicial } = {}) {
  const antes = { chave: process.env.PROCSTUDIO_LLM_API_KEY, saldo: process.env.JUR_LOCAL_SALDO_INICIAL };
  process.env.PROCSTUDIO_LLM_API_KEY = 'chave-de-teste';
  if (saldoInicial === undefined) delete process.env.JUR_LOCAL_SALDO_INICIAL;
  else process.env.JUR_LOCAL_SALDO_INICIAL = String(saldoInicial);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-local-carteira-'));
  let local;
  try { local = await iniciarLocal({ port: 0, dir, concorrencia: 1 }); }
  finally {
    for (const [nome, valor] of [['PROCSTUDIO_LLM_API_KEY', antes.chave], ['JUR_LOCAL_SALDO_INICIAL', antes.saldo]]) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    }
  }
  t.after(async () => { await local.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  return local;
}
const principalLocal = { issuer: 'urn:jur:local', userId: 'local', teamId: 'desenvolvimento' };
const uso = (extra = {}) => ({ requestId: 'c1:t1:r1', modelId: 'glm-5.3-flash', inputTokens: 1_000_000, outputTokens: 0, ...extra });

test('carteira local: GET /saldo devolve R$ 10,00 e o preço fixo do modelo', async (t) => {
  const { base } = await comCarteira(t);
  const cookie = await login(base);
  const r = await fetch(base + '/api/v1/saldo?forcar=1', { headers: { cookie } });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.disponivel, true);
  assert.equal(corpo.saldoBrl, 10);
  assert.equal(corpo.podeOperar, true);
  assert.equal(corpo.modelo.entradaPor1MBrl, 1);
  assert.equal(corpo.modelo.saidaPor1MBrl, 4);
});

test('carteira local: registrarUso desconta, é idempotente por requestId e recusa o que não entende', async (t) => {
  const local = await comCarteira(t);
  const ps = local.procstudio;
  const r1 = await ps.registrarUso(principalLocal, uso({ outputTokens: 250_000 }));
  // 1M entrada (R$ 1,00) + 250 mil saída (R$ 1,00) = R$ 2,00
  assert.deepEqual(r1, { cobradoCents: 200, cobradoBrl: 2, saldoCents: 800, saldoBrl: 8, podeOperar: true, duplicado: false });
  const r2 = await ps.registrarUso(principalLocal, uso({ outputTokens: 250_000 }));
  assert.deepEqual(r2, { ...r1, duplicado: true });
  assert.equal((await ps.saldo(principalLocal)).saldoCents, 800);
  // mesmo requestId com outro corpo continua duplicado: nada é cobrado de novo
  assert.equal((await ps.registrarUso(principalLocal, uso({ inputTokens: 5 }))).duplicado, true);
  assert.equal((await ps.saldo(principalLocal)).saldoCents, 800);
  // arredonda para cima ao centavo
  const r3 = await ps.registrarUso(principalLocal, uso({ requestId: 'r2', inputTokens: 1, outputTokens: 0 }));
  assert.equal(r3.cobradoCents, 1);
  // não entendido: erro explícito, nunca um 200 inventado
  await assert.rejects(() => ps.registrarUso(principalLocal, uso({ requestId: 'x', modelId: 'outro' })), { code: 'INVALID_USAGE', status: 422 });
  await assert.rejects(() => ps.registrarUso(principalLocal, uso({ requestId: 'y', inputTokens: -1 })), { code: 'INVALID_USAGE' });
  await assert.rejects(() => ps.registrarUso(principalLocal, uso({ requestId: 'z', outputTokens: 1.5 })), { code: 'INVALID_USAGE' });
  await assert.rejects(() => ps.registrarUso(principalLocal, uso({ requestId: '' })), { code: 'INVALID_USAGE' });
  await assert.rejects(() => ps.registrarUso({ ...principalLocal, userId: 'outro' }, uso({ requestId: 'u' })), { code: 'USER_GONE', status: 410 });
  await assert.rejects(() => ps.registrarUso({ ...principalLocal, teamId: 'outro' }, uso({ requestId: 't' })), { code: 'TEAM_REJECTED', status: 404 });
  await assert.rejects(() => ps.registrarUso({ ...principalLocal, issuer: 'outro' }, uso({ requestId: 'i' })), { code: 'SERVICE_AUTH', status: 401 });
  assert.equal((await ps.saldo(principalLocal)).saldoCents, 799);
  assert.deepEqual(await ps.saldo({ ...principalLocal, teamId: 'outro' }), { ativo: false });
  await assert.rejects(() => ps.saldo({ ...principalLocal, issuer: 'outro' }), { code: 'SERVICE_AUTH' });
});

test('carteira local: JUR_LOCAL_SALDO_INICIAL=-100 bloqueia; dentro do limite de -R$ 0,50 ainda opera', async (t) => {
  const bloqueada = await comCarteira(t, { saldoInicial: -100 });
  const b = await bloqueada.procstudio.saldo(principalLocal);
  assert.equal(b.podeOperar, false);
  assert.equal(b.saldoCents, -100);
  assert.equal(b.limiteNegativoCents, -50);
  assert.ok(b.mensagem);
  assert.equal(b.topupPath, '/equipe?tab=billing');
  const cookie = await login(bloqueada.base);
  const corpo = await (await fetch(bloqueada.base + '/api/v1/saldo?forcar=1', { headers: { cookie } })).json();
  assert.equal(corpo.podeOperar, false);
  assert.equal(corpo.saldoBrl, -1);

  // estritamente acima do limite: no -50 exato já bloqueia, um centavo a mais opera
  const noLimite = await comCarteira(t, { saldoInicial: -50 });
  assert.equal((await noLimite.procstudio.saldo(principalLocal)).podeOperar, false);
  const limite = await comCarteira(t, { saldoInicial: -49 });
  assert.equal((await limite.procstudio.saldo(principalLocal)).podeOperar, true);
  const r = await limite.procstudio.registrarUso(principalLocal, uso({ inputTokens: 1 }));
  assert.equal(r.saldoCents, -50);
  assert.equal(r.podeOperar, false);
  // duplicado devolve o cobrado original, mas o saldo e podeOperar de agora
  const d = await limite.procstudio.registrarUso(principalLocal, uso({ inputTokens: 1 }));
  assert.deepEqual(d, { ...r, duplicado: true });
  await limite.procstudio.registrarUso(principalLocal, uso({ requestId: 'outro', inputTokens: 1 }));
  const d2 = await limite.procstudio.registrarUso(principalLocal, uso({ inputTokens: 1 }));
  assert.equal(d2.cobradoCents, 1);
  assert.equal(d2.saldoCents, -51);
});

test('carteira local: valor inválido em JUR_LOCAL_SALDO_INICIAL falha o boot e a carteira não é compartilhada entre instâncias', async (t) => {
  await assert.rejects(() => comCarteira(t, { saldoInicial: '10,5' }), /JUR_LOCAL_SALDO_INICIAL/);
  const a = await comCarteira(t);
  const b = await comCarteira(t);
  await a.procstudio.registrarUso(principalLocal, uso());
  assert.equal((await b.procstudio.saldo(principalLocal)).saldoCents, 1000);
});

test('sem PROCSTUDIO_LLM_API_KEY não existe conexão gerenciada: /saldo diz indisponível', async (t) => {
  const antes = process.env.PROCSTUDIO_LLM_API_KEY; delete process.env.PROCSTUDIO_LLM_API_KEY;
  t.after(() => { if (antes !== undefined) process.env.PROCSTUDIO_LLM_API_KEY = antes; });
  const { base } = await fixture(t);
  const cookie = await login(base);
  assert.deepEqual(await (await fetch(base + '/api/v1/saldo', { headers: { cookie } })).json(), { disponivel: false });
});
