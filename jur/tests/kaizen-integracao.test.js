// jur/tests/kaizen-integracao.test.js
// Ponta a ponta com falha REAL: POST /api/v1/buscas -> executor -> CLI filha com preload e
// Chromium de verdade numa pagina local sem o seletor -> jobs -> Kaizen -> outbox -> um "FFD"
// HTTP local que grava o que recebe. Nada do Kaizen e simulado; so o SSO e o site do tribunal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { criarAplicacao } = require('../servidor/aplicacao');
const { criarKaizen } = require('../servidor/kaizen');
const executor = require('../servidor/executor');

const CLI_FALSA = path.join(__dirname, 'fixtures', 'cli-falha-real.js');
const ESPERA_MS = 30000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, rotulo) {
  const limite = Date.now() + ESPERA_MS;
  while (Date.now() < limite) {
    const v = await cond();
    if (v) return v;
    await dormir(100);
  }
  throw new Error(`tempo esgotado: ${rotulo}`);
}
const ouvir = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const fechar = (server) => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); };

async function montar({ comWebhook, fetchFn }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-kaizen-int-'));
  const recebidos = [];
  // Site do "tribunal": a pagina existe, o seletor que o crawler espera nao.
  const site = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Consulta</title><h1>Layout novo</h1><p>Sem o resultado esperado.</p>');
  });
  const urlSite = await ouvir(site);
  // "FFD" falso: grava source, cabecalho e corpo.
  const ffd = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (d) => partes.push(d));
    req.on('end', () => {
      recebidos.push({ source: req.url.replace(/^\//, ''), token: req.headers['x-webhook-token'], corpo: JSON.parse(Buffer.concat(partes).toString('utf8')) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  const urlFfd = await ouvir(ffd);
  process.env.FIXTURE_URL = `${urlSite}/consulta/123/resultado?token=SEGREDO-NA-QUERY&q=abc`;

  const env = comWebhook
    ? { ...process.env, KAIZEN_WEBHOOK_URL: urlFfd, KAIZEN_WEBHOOK_TOKEN: 'token-do-teste', KAIZEN_SALT: 'sal' }
    : { ...process.env, KAIZEN_WEBHOOK_URL: '', KAIZEN_WEBHOOK_TOKEN: '', KAIZEN_SALT: 'sal' };
  const kaizen = criarKaizen({ dir, env, versao: '9.9.9', ...(fetchFn ? { fetchFn } : {}) });

  const principals = new Map();
  const procstudio = {
    exchange: async (code) => {
      const principal = { issuer: 'https://rails.example', userId: code, teamId: 'team', expiresAt: Date.now() + 60000 };
      principals.set(code, principal);
      return { token: code, principal };
    },
    introspect: async (t) => principals.get(t) || null,
    revoke: async (t) => principals.delete(t),
    subject: async () => true,
  };
  const app = criarAplicacao({
    dir, cofreKey: Buffer.alloc(32, 8).toString('base64'), procstudio, publicUrl: 'http://127.0.0.1',
    frontendUrl: 'https://proc.example', clientId: 'jur', kaizen,
    executarFn: (comando, params, extra) => executor.executar(comando, params, { ...extra, cliPath: CLI_FALSA }),
  });
  const api = http.createServer(app.handler);
  const base = await ouvir(api);

  const r = await fetch(base + '/auth/login', { redirect: 'manual' });
  const state = new URL(r.headers.get('location')).searchParams.get('state');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const cb = await fetch(`${base}/auth/callback?code=alice&state=${state}`, { redirect: 'manual', headers: { cookie } });
  const sessao = cb.headers.get('set-cookie').split(';')[0];
  const chamar = (url, metodo = 'GET', corpo) => fetch(base + url, {
    method: metodo, headers: { cookie: sessao, origin: 'http://127.0.0.1', 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  async function buscarEEsperar() {
    const resp = await chamar('/api/v1/buscas', 'POST', { tribunal: 'trf4', query: 'auxilio-acidente' });
    assert.equal(resp.status, 202);
    const { id } = await resp.json();
    const job = await ate(async () => {
      const j = await (await chamar(`/api/v1/buscas/${id}`)).json();
      return ['concluido', 'erro', 'cancelado'].includes(j.status) ? j : null;
    }, `job ${id} terminar`);
    return job;
  }

  async function encerrar() {
    await fechar(api); await fechar(ffd); await fechar(site);
    app.fechar(); kaizen.fechar();
    delete process.env.FIXTURE_URL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Arquivos pesados que ainda estao no disco: o meta.json fica de proposito (o relato do usuario
  // aponta a assinatura por ele), print e HTML nao.
  const diretoriosFalha = () => {
    const raiz = path.join(dir, 'usuarios');
    if (!fs.existsSync(raiz)) return [];
    return fs.readdirSync(raiz).flatMap((u) => {
      const res = path.join(raiz, u, 'resultados');
      if (!fs.existsSync(res)) return [];
      return fs.readdirSync(res).filter((n) => n.endsWith('.falha'))
        .flatMap((n) => fs.readdirSync(path.join(res, n)).filter((f) => f !== 'meta.json').map((f) => `${n}/${f}`));
    });
  };
  return { kaizen, recebidos, buscarEEsperar, encerrar, diretoriosFalha };
}

test('busca que falha no crawler chega ao FFD falso com captura e assinatura; 2a busca da mesma falha tem a mesma assinatura', async () => {
  const t = await montar({ comWebhook: true });
  try {
    const a = await t.buscarEEsperar();
    const b = await t.buscarEEsperar();
    assert.equal(a.status, 'erro');
    assert.equal(b.status, 'erro');
    await ate(() => t.diretoriosFalha().length === 0 && t.recebidos.length >= 2, 'diagnosticos chegarem ao FFD');
    await t.kaizen.outbox.drenar();

    const corpos = t.recebidos.filter((x) => x.source === 'jur-diagnostico').map((x) => x.corpo);
    assert.equal(corpos.length, 2);
    assert.ok(t.recebidos.every((x) => x.token === 'token-do-teste'));
    assert.equal(corpos[0].assinatura, corpos[1].assinatura);
    assert.equal(corpos[0].origem, 'busca');
    assert.equal(corpos[0].tribunal, 'trf4');
    assert.match(corpos[0].classe, /^[a-z_]+/);
    assert.ok(corpos[0].passo && corpos[0].passo !== 'desconhecido', `passo derivado da pagina: ${corpos[0].passo}`);
    assert.match(corpos[0].passo, /consulta/);
    assert.ok(corpos[0].assinatura.startsWith('trf4|'));
    assert.equal(typeof corpos[0].tela_png_gzip_b64, 'string');
    assert.equal(typeof corpos[0].html_gzip_b64, 'string');
    assert.match(corpos[0].html_sha256, /^[0-9a-f]{64}$/);
    // URL do site, sem query nem o segredo que estava nela
    assert.match(corpos[0].url, /^http:\/\/127\.0\.0\.1:\d+\/consulta\/123\/resultado$/);
    const texto = JSON.stringify(corpos);
    assert.ok(!/SEGREDO/i.test(texto), 'nenhum segredo (query da URL ou Bearer) no payload');
    assert.ok(!/Bearer/i.test(texto));
    // captura limpa: print e HTML sumiram do disco (so o meta.json resta)
    assert.deepEqual(t.diretoriosFalha(), []);
  } finally { await t.encerrar(); }
});

test('sem KAIZEN_WEBHOOK_URL a busca funciona igual e a outbox guarda local', async () => {
  let chamadas = 0;
  const t = await montar({ comWebhook: false, fetchFn: async () => { chamadas++; return new Response('{}'); } });
  try {
    const job = await t.buscarEEsperar();
    assert.equal(job.status, 'erro');
    await ate(() => t.kaizen.outbox.pendentes() === 1 && t.diretoriosFalha().length === 0, 'item guardado na outbox');
    await t.kaizen.outbox.drenar();
    assert.equal(t.kaizen.outbox.pendentes(), 1);
    assert.equal(chamadas, 0);
    assert.equal(t.recebidos.length, 0);
  } finally { await t.encerrar(); }
});
