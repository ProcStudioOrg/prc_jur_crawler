const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const remotos = require('../servidor/navegadores/remotos');
const { criarRegistro } = require('../servidor/navegadores/registro');

const ambiente = {};
beforeEach(() => {
  for (const k of ['KERNEL_API_KEY', 'STEEL_API_KEY', 'JUR_NAVEGADOR_REMOTO']) ambiente[k] = process.env[k];
  process.env.KERNEL_API_KEY = 'k-secreta';
  process.env.STEEL_API_KEY = 's-secreta';
  delete process.env.JUR_NAVEGADOR_REMOTO;
});
afterEach(() => {
  for (const [k, v] of Object.entries(ambiente)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

// Fornecedores falsos: `kernel`/`steel` decidem o que a criação de sessão devolve.
function fornecedoresFalsos({ kernel = 'ok', steel = 'ok' } = {}) {
  const chamadas = [];
  const fetchFn = async (url, opts) => {
    chamadas.push({ url, method: opts.method, headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    if (url === 'https://api.onkernel.com/browsers') {
      if (kernel === 'http') return new Response('{"erro":"k-secreta"}', { status: 429 });
      if (kernel === 'host') return Response.json({ session_id: 'k1', cdp_ws_url: 'wss://evil.example/?jwt=x' });
      return Response.json({ session_id: 'k1', cdp_ws_url: 'wss://proxy.iad-x.onkernel.com/browser?jwt=x' });
    }
    if (url === 'https://api.steel.dev/v1/sessions') {
      if (steel === 'http') return new Response('', { status: 500 });
      return Response.json({ id: 's-1' });
    }
    return new Response(null, { status: 204 });
  };
  return { chamadas, fetchFn };
}

test('ordem padrão é Kernel e depois Steel, só com chave presente', () => {
  assert.deepEqual(remotos.configurados(), ['kernel', 'steel']);
  delete process.env.KERNEL_API_KEY;
  assert.deepEqual(remotos.nomes(), ['Steel']);
  assert.deepEqual(remotos.configurados('steel,kernel,steel,xpto'), ['steel']);
});

test('Kernel abre sem stealth e encerra a sessão mesmo se o crawler falhar', async () => {
  const { chamadas, fetchFn } = fornecedoresFalsos();
  const avisos = [];
  await assert.rejects(remotos.comNavegadorRemoto(async (cdp) => {
    assert.match(cdp, /onkernel\.com/); throw new Error('crawler falhou');
  }, { fetchFn, aoFornecedor: (i) => avisos.push(i) }), /crawler falhou/);
  assert.equal(chamadas[0].body.stealth, false);
  assert.deepEqual(chamadas.at(-1), { url: 'https://api.onkernel.com/browsers/k1', method: 'DELETE', headers: { authorization: 'Bearer k-secreta' }, body: undefined });
  assert.equal(avisos[0].nome, 'Kernel');
  assert.equal(avisos[0].reserva, false);
});

test('cai na Steel quando a Kernel não abre sessão, e não vaza chave na mensagem', async () => {
  const { chamadas, fetchFn } = fornecedoresFalsos({ kernel: 'http' });
  const avisos = [];
  const r = await remotos.comNavegadorRemoto(async (cdp) => {
    assert.match(cdp, /^wss:\/\/connect\.steel\.dev\?apiKey=s-secreta&sessionId=s-1$/);
    return { ok: true, total: 3 };
  }, { fetchFn, aoFornecedor: (i) => avisos.push(i) });
  assert.deepEqual(r, { ok: true, total: 3 });
  assert.deepEqual(avisos.map(remotos.rotulo), ['Steel (reserva)']);
  assert.deepEqual(avisos[0].falhas, ['Kernel: HTTP 429']);
  const steel = chamadas.find((c) => c.url === 'https://api.steel.dev/v1/sessions');
  assert.equal(steel.body.solveCaptcha, false);
  assert.equal(steel.body.useProxy, false);
  assert.ok(chamadas.some((c) => c.url === 'https://api.steel.dev/v1/sessions/s-1/release'));
});

test('URL CDP fora do domínio do fornecedor é recusada', async () => {
  const { fetchFn } = fornecedoresFalsos({ kernel: 'host' });
  const usados = [];
  await remotos.comNavegadorRemoto(async (cdp) => { usados.push(cdp); return { ok: true }; }, { fetchFn });
  assert.equal(usados.length, 1);
  assert.match(usados[0], /steel\.dev/);
});

test('IP bloqueado pelo tribunal troca de fornecedor; erro do crawler não troca', async () => {
  let { chamadas, fetchFn } = fornecedoresFalsos();
  let n = 0;
  const r = await remotos.comNavegadorRemoto(async () => (++n === 1
    ? { ok: false, erro: 'HTTP 403 em pesquisa: <HTML>ERROR' } : { ok: true, total: 10 }), { fetchFn });
  assert.equal(n, 2);
  assert.equal(r.total, 10);
  assert.ok(chamadas.some((c) => c.method === 'DELETE'), 'sessão da Kernel encerrada antes da reserva');

  ({ chamadas, fetchFn } = fornecedoresFalsos());
  n = 0;
  const r2 = await remotos.comNavegadorRemoto(async () => { n++; return { ok: false, erro: 'seletor não encontrado' }; }, { fetchFn });
  assert.equal(n, 1);
  assert.equal(r2.erro, 'seletor não encontrado');
});

test('sem fornecedor disponível a falha explica cada um, sem segredo', async () => {
  const { fetchFn } = fornecedoresFalsos({ kernel: 'http', steel: 'http' });
  await assert.rejects(remotos.comNavegadorRemoto(async () => ({ ok: true }), { fetchFn }), (e) => {
    assert.match(e.message, /Kernel: HTTP 429; Steel: HTTP 500/);
    assert.ok(!e.message.includes('secreta'));
    return true;
  });
  delete process.env.KERNEL_API_KEY; delete process.env.STEEL_API_KEY;
  await assert.rejects(remotos.comNavegadorRemoto(async () => ({ ok: true })), /não configurado/);
});

test('TRF3 e Falcão vão pelo remoto mesmo com preferência local', () => {
  const con = new DatabaseSync(':memory:');
  const r = criarRegistro(con, { remoto: true });
  assert.deepEqual(r.provedores, ['local', 'remoto']);
  for (const c of ['trf3', 'trt2', 'tst', 'csjt']) { r.registrar(c, c); assert.equal(r.opcoes(c).provedor, 'remoto', c); }
  r.registrar('tjsp', 'tjsp');
  assert.equal(r.opcoes('tjsp').provedor, 'local');
  r.salvar({ acompanhar: false, captcha: false, provedor: 'remoto' });
  r.registrar('tjsp2', 'tjsp');
  assert.equal(r.opcoes('tjsp2').provedor, 'remoto');
  r.fornecedor('tjsp2', 'Kernel');
  assert.equal(r.listar({ posicao: () => null }).find((s) => s.id === 'tjsp2').navegador, 'Kernel');
  // Sem remoto configurado nada muda: o tribunal bloqueado segue local (e falha lá).
  const semRemoto = criarRegistro(new DatabaseSync(':memory:'));
  semRemoto.registrar('x', 'trf3');
  assert.equal(semRemoto.opcoes('x').provedor, 'local');
  assert.throws(() => semRemoto.salvar({ acompanhar: false, captcha: false, provedor: 'remoto' }), /prefer/i);
  con.close();
});

test('STJ vai só pela Steel, com resolvedor, e abre sempre assistido', async () => {
  assert.deepEqual(remotos.opcoesPara('stj'), { ordem: 'steel', captcha: true });
  assert.deepEqual(remotos.opcoesPara('trf3'), {});
  assert.ok(remotos.exigeRemoto('stj'));
  const { chamadas, fetchFn } = fornecedoresFalsos();
  const recebidas = [];
  await remotos.comNavegadorRemoto(async (cdp, info) => { recebidas.push([cdp, info]); return { ok: true }; },
    { ...remotos.opcoesPara('stj'), fetchFn });
  assert.ok(!chamadas.some((c) => c.url.includes('onkernel')), 'Kernel fica de fora do STJ');
  assert.equal(chamadas.find((c) => c.url === 'https://api.steel.dev/v1/sessions').body.solveCaptcha, true);
  assert.deepEqual(recebidas[0][1], { captcha: true });

  const con = new DatabaseSync(':memory:');
  const r = criarRegistro(con, { remoto: true });
  assert.ok(r.assistido('stj'), 'STJ buscável sem a preferência de captcha');
  r.registrar('s1', 'stj');
  assert.deepEqual(r.opcoes('s1'), { acompanhar: true, captcha: true, provedor: 'remoto' });
  r.registrar('t1', 'tjsp');
  assert.deepEqual(r.opcoes('t1'), { acompanhar: false, captcha: false, provedor: 'local' });
  con.close();

  // Sem chave da Steel o STJ volta ao comportamento anterior (local, captcha manual opcional).
  delete process.env.STEEL_API_KEY;
  assert.ok(!remotos.exigeRemoto('stj'));
  const semSteel = criarRegistro(new DatabaseSync(':memory:'), { remoto: true });
  assert.ok(!semSteel.assistido('stj'));
  semSteel.registrar('s2', 'stj');
  assert.equal(semSteel.opcoes('s2').provedor, 'local');
});
