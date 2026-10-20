// Rotas de relato (botão "Relatar"): card no Linear BRU com fatos do servidor e cópia no FFD.
const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const db = require('../servidor/db');
const conversas = require('../servidor/conversas');
const linear = require('../servidor/issue-reporter/linear');
const { clearReporterCache, LinearError } = require('../servidor/issue-reporter/report');
const { payloadRelato } = require('../servidor/kaizen/payload');
const { criarApp } = require('../servidor/index');

const INDEX = path.join(__dirname, '..', 'publico', 'index.html');
const WIDGET = path.join(__dirname, '..', 'publico', 'issue-reporter', 'widget.js');

const ENV_BRU = { LINEAR_API_KEY: 'lin_api_SEGREDO', LINEAR_TEAM_ID: 'team-bru', JUR_PUBLIC_URL: 'https://jurcrawler.com.br' };
const principal = { issuer: 'ps', userId: 'u1', teamId: 't1', email: 'alice@x.com' };
const BRU = {
  id: 'team-bru', key: 'BRU', name: 'BrunoDev', labels: [],
  states: [{ id: 's-backlog', name: 'Backlog', type: 'backlog', position: 0 }, { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 }],
};

const jobDaConta = {
  id: 'job-1', comando: 'trf4', params: { query: 'auxilio-acidente', dataInicio: '01/01/2024' },
  status: 'erro', erro: 'Timeout em wss://connect.steel.dev?apiKey=SEGREDO-STEEL', navegador: 'Steel (reserva)',
};
const fila = {
  obter: (id) => (id === jobDaConta.id ? jobDaConta : null),
  capturaDoJob: (id) => (id === jobDaConta.id ? { assinatura: 'trf4|timeout|resultado|timeout' } : null),
};

const original = { getTeamMeta: linear.getTeamMeta, createIssue: linear.createIssue };
let linearChamadas;
let espiao;
let repo;
let servidores = [];

beforeEach(() => {
  clearReporterCache();
  linearChamadas = [];
  linear.getTeamMeta = async () => BRU;
  linear.createIssue = async (...args) => { linearChamadas.push(args); return { identifier: 'BRU-1', url: 'https://linear.app/x' }; };
  espiao = {
    relatos: [],
    enviarRelato(r) { this.relatos.push(payloadRelato(r)); return true; },
    linkFalha: (a) => `https://ffd.belzinhos.com.br/jur-falhas?assinatura=${encodeURIComponent(a)}`,
  };
  repo = conversas.criarRepositorio(db.abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-relatos-')), 'jur.db')));
});
afterEach(async () => {
  await Promise.all(servidores.map((s) => new Promise((r) => s.close(r))));
  servidores = [];
});
after(() => Object.assign(linear, original));

async function base(env) {
  const app = criarApp({ conta: principal, fila, kaizen: espiao, conversas: repo, env, versao: '1.1.0', revisao: 'abc1234' });
  const s = http.createServer(app.handler);
  servidores.push(s);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${s.address().port}`;
}

async function get(caminho, { env = ENV_BRU } = {}) {
  return (await fetch((await base(env)) + caminho)).json();
}

async function post(caminho, corpo, { env = ENV_BRU, ...headers } = {}) {
  const r = await fetch((await base(env)) + caminho, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json() };
}

function relato({ extra = {}, title = 'Busca do TRF4 travou', body = 'Fiquei esperando e nada.' } = {}) {
  return {
    title, body, module: null, type: null, priority: 3, reporter: null,
    context: { url: 'https://jurcrawler.com.br/', path: '/', at: '2026-10-19T12:00:00.000Z', console: [], network: [], extra },
  };
}

const descricao = () => linearChamadas[0][1].description;

test('sem LINEAR_*: meta enabled:false e o widget nao monta', async () => {
  assert.equal((await get('/api/v1/relatos/meta', { env: {} })).enabled, false);
});

test('com BRU: meta habilitada com o time e sem a chave', async () => {
  const meta = await get('/api/v1/relatos/meta');
  assert.equal(meta.enabled, true);
  assert.deepEqual(meta.team, { key: 'BRU', name: 'BrunoDev' });
  assert.doesNotMatch(JSON.stringify(meta), /SEGREDO/);
});

test('com BRU: card [jur] com contexto do servidor e o mesmo relato vai ao FFD', async () => {
  const r = await post('/api/v1/relatos', relato({ extra: { jobId: jobDaConta.id, tribunal: 'mentira' } }));
  assert.deepEqual([r.status, r.body.identifier], [200, 'BRU-1']);
  const [apiKey, input] = linearChamadas[0];
  assert.equal(apiKey, 'lin_api_SEGREDO');
  assert.match(input.title, /^\[jur\] .+ \(usuário u1\)$/);
  assert.match(input.description, /\| Tribunal \| trf4 \|/);
  assert.match(input.description, /\| ID do usuário \| u1 \|/);
  assert.match(input.description, /\| Equipe \| t1 \|/);
  assert.match(input.description, /\| Versão \| 1\.1\.0 · abc1234 \|/);
  assert.match(input.description, /\| Rota \| Steel \(reserva\) \|/);
  assert.match(input.description, /\| Captura de falha \| sim — https:\/\/ffd\.belzinhos\.com\.br\/jur-falhas\?assinatura=/);
  assert.doesNotMatch(input.description, /SEGREDO-STEEL/);
  assert.equal(input.stateId, 's-todo');
  const ffd = espiao.relatos[0];
  assert.deepEqual(ffd.linear, { identifier: 'BRU-1', url: 'https://linear.app/x' });
  assert.equal(ffd.servico, 'jurcrawler');
  assert.equal(ffd.autor_email, null);
  assert.equal(ffd.autor_nome, 'usuário u1 / equipe t1');
  assert.equal(ffd.equipe, 't1');
  assert.equal(ffd.versao, '1.1.0');
  assert.equal(ffd.contexto.Tribunal, 'trf4');
  assert.equal(ffd.contexto['Assinatura da falha'], 'trf4|timeout|resultado|timeout');
  assert.doesNotMatch(JSON.stringify(ffd), /SEGREDO/);
});

test('job de outra conta nao entra no contexto', async () => {
  const r = await post('/api/v1/relatos', relato({ extra: { jobId: 'job-de-outra-conta' } }));
  assert.equal(r.status, 200);
  assert.doesNotMatch(descricao(), /\| Busca \|/);
  assert.equal(espiao.relatos[0].contexto.Busca, undefined);
});

test('Linear fora: 200 Recebido e FFD com linear null; Linear e FFD fora: 502', async () => {
  linear.createIssue = async () => { throw new LinearError('Linear respondeu 500.', 500); };
  assert.deepEqual((await post('/api/v1/relatos', relato())).body, { ok: true, identifier: null, url: null });
  assert.equal(espiao.relatos.at(-1).linear, null);
  espiao.enviarRelato = () => false;
  const r = await post('/api/v1/relatos', relato());
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(r.body), /Linear respondeu/);
});

test('sem LINEAR_* o relato direto ainda vai ao FFD; sem os dois, 502', async () => {
  const r = await post('/api/v1/relatos', relato(), { env: {} });
  assert.deepEqual(r.body, { ok: true, identifier: null, url: null });
  assert.equal(linearChamadas.length, 0);
  assert.equal(espiao.relatos.length, 1);
  espiao.enviarRelato = () => false;
  assert.equal((await post('/api/v1/relatos', relato(), { env: {} })).status, 502);
});

test('titulo curto: 400 e nada vai ao FFD', async () => {
  const r = await post('/api/v1/relatos', relato({ title: 'oi' }));
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
  assert.equal(espiao.relatos.length, 0);
  assert.equal(linearChamadas.length, 0);
  // Mesmo com o Linear desligado a validação vale: o FFD não recebe relato vazio.
  assert.equal((await post('/api/v1/relatos', relato({ body: '  ' }), { env: {} })).status, 400);
  assert.equal(espiao.relatos.length, 0);
});

test('chave pessoal (Bearer) nao relata', async () => {
  const r = await post('/api/v1/relatos', relato(), { authorization: 'Bearer x' });
  assert.equal(r.status, 403);
  assert.equal(r.body.erro, 'Relato só pela interface.');
  assert.equal(espiao.relatos.length, 0);
});

// ─── conversa aberta na tela ────────────────────────────────────────────────

test('conversa da conta: ultimas 12 mensagens no card (recolhido) e no contexto do FFD', async () => {
  const c = repo.criar();
  for (let i = 1; i <= 13; i++) repo.acrescentar(c.id, i % 2 ? 'user' : 'assistant', `mensagem numero ${i}`);
  repo.acrescentar(c.id, 'assistant', [
    { type: 'text', text: 'vou buscar' },
    { type: 'tool_use', id: 'tu1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } },
  ]);
  repo.acrescentar(c.id, 'user', 'meu token: Bearer abcdef123456');
  const r = await post('/api/v1/relatos', relato({ extra: { conversaId: c.id } }));
  assert.equal(r.status, 200);
  const d = descricao();
  assert.match(d, /^\+\+\+ Histórico da conversa/m);
  assert.match(d, /^\+\+\+$/m);
  assert.match(d, /mensagem numero 13/);
  // 15 mensagens: as 12 últimas começam na 4ª.
  assert.match(d, /mensagem numero 4\b/);
  assert.doesNotMatch(d, /mensagem numero 3\b/, 'só as 12 últimas');
  assert.match(d, /buscar_jurisprudencia/);
  assert.match(d, /"tribunal":"stf"/);
  assert.doesNotMatch(d, /abcdef123456/);
  const ctx = espiao.relatos[0].contexto;
  const historico = Object.entries(ctx).find(([k]) => /Conversa/.test(k))?.[1];
  assert.ok(historico, 'histórico no contexto do FFD');
  assert.match(historico, /mensagem numero 13/);
  assert.doesNotMatch(historico, /abcdef123456/);
});

test('historico grande: no maximo 6 KB, sem as mais antigas, e contexto do FFD cabe em 8 KB', async () => {
  const c = repo.criar();
  for (let i = 1; i <= 12; i++) repo.acrescentar(c.id, 'user', `msg-${i} ` + 'á'.repeat(1400));
  const r = await post('/api/v1/relatos', relato({ extra: { conversaId: c.id, jobId: jobDaConta.id } }));
  assert.equal(r.status, 200);
  const d = descricao();
  const bloco = d.slice(d.indexOf('+++ Histórico'), d.lastIndexOf('\n+++'));
  assert.ok(Buffer.byteLength(bloco) <= 6 * 1024 + 300, `bloco com ${Buffer.byteLength(bloco)} bytes`);
  assert.match(bloco, /msg-12 /);
  assert.doesNotMatch(bloco, /msg-1 /, 'a mais antiga sai primeiro');
  const ctx = espiao.relatos[0].contexto;
  assert.ok(Buffer.byteLength(JSON.stringify(ctx)) <= 8 * 1024);
  assert.equal(ctx.aviso, undefined, 'contexto não pode cair no aviso de estouro');
  assert.equal(ctx.Tribunal, 'trf4');
  assert.match(Object.entries(ctx).find(([k]) => /Conversa/.test(k))[1], /msg-12 /);
});

test('conversa que nao e da conta nao entra', async () => {
  const r = await post('/api/v1/relatos', relato({ extra: { conversaId: 'conversa-de-outro-usuario' } }));
  assert.equal(r.status, 200);
  assert.doesNotMatch(descricao(), /\+\+\+/);
  assert.ok(!Object.keys(espiao.relatos[0].contexto).some((k) => /Conversa/.test(k)));
});

// ─── tela ───────────────────────────────────────────────────────────────────

test('index.html monta o widget como modulo e o widget e copia exata do ProcStudio', () => {
  assert.match(fs.readFileSync(INDEX, 'utf8'), /<script type="module" src="\/relatar\.js"><\/script>/);
  // Fonte: o widget do ProcStudio (superconjunto do FFD, com showIssueLink); o FFD passa a usar o
  // mesmo arquivo. Fora da máquina de desenvolvimento o repo não existe e a conferência pula.
  const repoPs = '/Users/brpl/code/ProcStudio/ProcStudio-Docker';
  if (!fs.existsSync(repoPs)) return;
  const { execFileSync } = require('node:child_process');
  let fonte;
  try {
    fonte = execFileSync('git', ['-C', repoPs, 'show', 'origin/development:frontend/src/lib/issue-reporter/widget.js'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; }
  assert.ok(fonte.equals(fs.readFileSync(WIDGET)), 'widget.js diverge do ProcStudio');
  assert.match(fs.readFileSync(WIDGET, 'utf8'), /showIssueLink/);
});

test('relatar.js so monta com sessao e manda job e conversa visiveis', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'publico', 'relatar.js'), 'utf8');
  assert.match(src, /from "\/issue-reporter\/widget\.js"|from '\/issue-reporter\/widget\.js'/);
  assert.match(src, /jur:sessao/);
  assert.match(src, /jurBuscaVisivel/);
  assert.match(src, /conversaId/);
  assert.match(src, /showIssueLink:\s*false/);
});

test('segredo cortado no meio nunca vaza: sanitiza o texto inteiro antes de cortar', async () => {
  const c = repo.criar();
  // o corte de 120 caracteres cai dentro do valor da chave
  repo.acrescentar(c.id, 'assistant', [{ type: 'tool_use', id: 'tu1', name: 'buscar', input: {
    q: 'x'.repeat(95), apiKey: 'sk-ant-api03-SEGREDOSEGREDOSEGREDO', token: 'SEGREDO2SEGREDO2SEGREDO2',
  } }]);
  repo.acrescentar(c.id, 'user', [{ type: 'tool_result', tool_use_id: 'tu1',
    content: `${'y'.repeat(100)} "access_token":"SEGREDO3SEGREDO3SEGREDO3"` }]);
  await post('/api/v1/relatos', relato({ extra: { conversaId: c.id } }));
  const d = descricao();
  assert.doesNotMatch(d, /sk-ant|SEGREDO/);
  assert.doesNotMatch(JSON.stringify(espiao.relatos[0].contexto), /sk-ant|SEGREDO/);
  assert.match(d, /ferramenta \(resultado\): \[resultado: y+/, 'tool_result não é fala do usuário');
});
