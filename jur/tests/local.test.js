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
