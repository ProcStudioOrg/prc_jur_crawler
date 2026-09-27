// Entrada exclusiva de desenvolvimento. O servidor de produção não importa este módulo.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { criarAplicacao } = require('../servidor/aplicacao');
const { executar, matarGrupo } = require('../servidor/executor');

async function iniciarLocal({
  port = Number(process.env.JUR_LOCAL_PORT || 4317),
  dir = process.env.JUR_LOCAL_DADOS || path.resolve(__dirname, '../../.local/jur'),
  concorrencia = Number(process.env.JUR_CONCORRENCIA || 3),
  executarFn = executar,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Porta local inválida.');
  if (!Number.isSafeInteger(concorrencia) || concorrencia < 1) throw new Error('Concorrência inválida.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, 'cofre.key');
  try { fs.writeFileSync(keyPath, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }

  let app;
  let base;
  const codes = new Map();
  const sessions = new Map();
  const running = new Map();
  const pids = new Set();
  let spawned = false;
  let stopping = false;
  const identity = { issuer: 'urn:jur:local', userId: 'local', teamId: 'desenvolvimento' };
  const sameIdentity = p => p && Object.keys(identity).every(key => p[key] === identity[key]);
  const hash = value => createHash('sha256').update(value).digest('base64url');
  const procstudio = {
    async exchange(code, verifier, redirectUri) {
      const attempt = codes.get(code); codes.delete(code);
      if (!attempt || attempt.expiresAt < Date.now() || attempt.challenge !== hash(verifier) || redirectUri !== base + '/auth/callback') return null;
      const token = randomBytes(32).toString('base64url');
      const principal = { ...identity, expiresAt: Date.now() + 86400000 };
      sessions.set(token, principal);
      return { token, principal };
    },
    async introspect(token) { const p = sessions.get(token); return p?.expiresAt > Date.now() ? p : null; },
    async revoke(token) { sessions.delete(token); },
    async subject(p) { return sameIdentity(p); },
  };
  const html = fs.readFileSync(path.join(__dirname, '../publico/index.html'), 'utf8')
    .replace('</head>', '<link rel="stylesheet" href="/__local/painel.css"></head>')
    .replace('</body>', '<script src="/__local/painel.js"></script></body>')
    .replace('Entrar com ProcStudio', 'Entrar localmente')
    .replace('Pesquisa jurídica,<br>com a sua conta.', 'JurCrawler no seu computador')
    .replace('Consulte as bases oficiais dos tribunais e converse com a IA de sua escolha.', 'Ambiente de validação com conta local. Pesquisas reais, sem login ProcStudio.')
    .replace('Suas conexões de IA e pesquisas ficam privadas na sua conta.', 'Dados separados da produção. O chat aceita uma chave de IA sua nas configurações.');
  const assets = {
    '/__local/painel.js': ['painel.js', 'text/javascript; charset=utf-8'],
    '/__local/painel.css': ['painel.css', 'text/css; charset=utf-8'],
  };
  const server = http.createServer((req, res) => {
    if (!app || stopping) { res.writeHead(503); return res.end(); }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.headers.host !== new URL(base).host ||
        (req.headers.origin && req.headers.origin !== base) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403); return res.end('Ambiente restrito ao endereço local.');
    }
    const url = new URL(req.url, base);
    if (url.pathname === '/_auth/jurcrawler' && req.method === 'GET') {
      const state = url.searchParams.get('state');
      const challenge = url.searchParams.get('code_challenge');
      if (!/^[\w-]{43}$/.test(state || '') || !/^[\w-]{43}$/.test(challenge || '') || !req.headers.cookie?.includes('jur_attempt=')) {
        res.writeHead(400); return res.end('Tentativa de entrada inválida.');
      }
      for (const [code, attempt] of codes) if (attempt.expiresAt <= Date.now()) codes.delete(code);
      const code = randomBytes(32).toString('base64url');
      codes.set(code, { challenge, expiresAt: Date.now() + 60000 });
      res.writeHead(303, { location: `/auth/callback?state=${state}&code=${code}`, 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    const asset = assets[url.pathname];
    if (asset && req.method === 'GET') {
      res.writeHead(200, { 'content-type': asset[1] }); return res.end(fs.readFileSync(path.join(__dirname, asset[0])));
    }
    return app.handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    app = criarAplicacao({ dir, cofreKey: fs.readFileSync(keyPath, 'utf8').trim(), procstudio,
      publicUrl: base, frontendUrl: base, clientId: 'jur-local', concorrencia,
      executarFn: (comando, params, extra) => {
        if (stopping) return Promise.resolve({ ok: false, erro: 'Ambiente local encerrado.' });
        const controller = new AbortController();
        let pid;
        const promise = Promise.resolve().then(() => executarFn(comando, params, { ...extra,
          sinal: extra.sinal ? AbortSignal.any([extra.sinal, controller.signal]) : controller.signal,
          aoIniciar: value => {
            spawned = true;
            pid = value; pids.add(pid); extra.aoIniciar?.(pid);
            if (stopping) matarGrupo(pid);
          },
        }));
        running.set(controller, promise);
        const cleanup = () => { running.delete(controller); if (pid) pids.delete(pid); };
        promise.then(cleanup, cleanup);
        return promise;
      },
    });
  } catch (e) { await new Promise(resolve => server.close(resolve)); throw e; }
  return {
    base, dir,
    async fechar() {
      stopping = true;
      const pending = [...running.values()];
      for (const controller of running.keys()) controller.abort();
      for (const pid of pids) matarGrupo(pid);
      // matarGrupo agenda SIGKILL em 5s com timer unref. Mantém o processo vivo
      // também para grupos cancelados cujo filho direto já terminou.
      const killGrace = spawned ? new Promise(resolve => setTimeout(resolve, 5100)) : Promise.resolve();
      await Promise.allSettled(pending);
      await killGrace;
      await new Promise(setImmediate);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      app.fechar();
    },
  };
}

if (require.main === module) iniciarLocal().then(local => {
  console.log(`JurCrawler local: ${local.base}\nDados: ${local.dir}\nSem ProcStudio. Use Configurações para conectar uma IA, ou faça uma pesquisa direta.`);
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await local.fechar(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { iniciarLocal };
