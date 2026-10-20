const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const {
  criarCaptura, derivarPasso, urlSemQuery, instalarSaida, instrumentarChromium, modoConsulta, capturaLigada,
} = require('../src/navegadorPreload');

// PNG de 1x1: o conteúdo não importa, só que o arquivo exista e não esteja vazio.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jur-preload-')); }

function pagina({ url = 'https://x.br/', html = '<html></html>', titulo = 'Título', fechada = false, screenshot, content } = {}) {
  const page = new EventEmitter();
  page.isClosed = () => fechada;
  page.screenshot = screenshot || (async () => PNG);
  page.content = content || (async () => html);
  page.url = () => url;
  page.title = async () => titulo;
  return page;
}

function processoFalso(aoSair) {
  const proc = new EventEmitter();
  proc.exit = (codigo) => aoSair(codigo);
  proc.escrito = { stdout: '', stderr: '' };
  for (const nome of ['stdout', 'stderr']) proc[nome] = { write: (t) => { proc.escrito[nome] += t; return true; } };
  return proc;
}

const tique = () => new Promise((r) => setImmediate(r));

function chromiumFalso({ falharCdp } = {}) {
  const navegador = () => {
    const browser = new EventEmitter();
    browser.contexts = () => [];
    browser.newContext = async () => { const c = new EventEmitter(); c.pages = () => []; return c; };
    return browser;
  };
  return {
    launch: async () => navegador(),
    connectOverCDP: async () => { if (falharCdp) throw new Error(`connect failed: ${falharCdp}`); return navegador(); },
  };
}

const ler = (dir, nome) => fs.readFileSync(path.join(dir, nome), 'utf8');

test('captura a pagina mais recente: png, html e meta sem query', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'trf4', rota: 'local' });
  c.anexarPagina(pagina({ url: 'https://a.br/velha' }));
  c.anexarPagina(pagina({ url: 'https://jurisprudencia.trf4.jus.br/pesquisa/resultado.php?token=X1', html: '<p>oi</p>' }));
  await c.capturar();
  const meta = JSON.parse(ler(dir, 'meta.json'));
  assert.equal(meta.url, 'https://jurisprudencia.trf4.jus.br/pesquisa/resultado.php');
  assert.equal(meta.passo, 'pagina:jurisprudencia.trf#.jus.br/pesquisa/resultado.php');
  assert.deepEqual([meta.tribunal, meta.rota, meta.erro], ['trf4', 'local', null]);
  assert.equal(ler(dir, 'pagina.html'), '<p>oi</p>');
  assert.ok(fs.statSync(path.join(dir, 'tela.png')).size > 0);
});

test('pagina fechada e ignorada em favor da anterior aberta', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'trf4', rota: 'local' });
  c.anexarPagina(pagina({ url: 'https://a.br/aberta' }));
  c.anexarPagina(pagina({ url: 'https://a.br/fechada', fechada: true }));
  await c.capturar();
  assert.equal(JSON.parse(ler(dir, 'meta.json')).url, 'https://a.br/aberta');
});

test('capturar e idempotente', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'trf4', rota: 'local' });
  assert.equal(c.capturar(), c.capturar());
});

test('marco __jurPasso vence a derivacao', () => {
  globalThis.__jurPasso = 'submeter';
  try { assert.equal(derivarPasso('https://x.br/a', 't'), 'submeter'); } finally { delete globalThis.__jurPasso; }
});

test('passo derivado so usa o alfabeto aceito pelo FFD e corta em 80', () => {
  assert.equal(derivarPasso('https://X.br/Busca;jsessionid=ABC123/é ?q=1'), 'pagina:x.br/busca_jsessionid__redigido_');
  const longo = derivarPasso(`https://x.br/${'a'.repeat(200)}`);
  assert.equal(longo.length, 80);
  assert.match(derivarPasso('https://x.br/a b/[c]'), /^[a-z0-9_:./#-]+$/);
  assert.equal(derivarPasso(''), 'desconhecido');
  assert.equal(derivarPasso('about:blank'), 'desconhecido');
});

test('urlSemQuery devolve origem e caminho; invalida vira vazio', () => {
  assert.equal(urlSemQuery('https://a.br/x/y?k=1#f'), 'https://a.br/x/y');
  assert.equal(urlSemQuery('nao e url'), '');
  assert.equal(urlSemQuery(undefined), '');
});

test('meta.json nunca leva segredo do caminho da URL', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'tjsp', rota: 'local' });
  c.anexarPagina(pagina({ url: 'https://esaj.tjsp.jus.br/cjsg/resultado.do;jsessionid=SEGREDO1?x=SEGREDO2' }));
  await c.capturar();
  assert.doesNotMatch(ler(dir, 'meta.json'), /SEGREDO/);
});

test('pagina que trava screenshot: sai dentro do prazo so com meta.json (Review Focus 2)', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'stj', rota: 'remoto', prazoMs: 200 });
  c.anexarPagina(pagina({ screenshot: () => new Promise(() => {}), content: () => new Promise(() => {}) }));
  const t0 = Date.now(); await c.capturar();
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'tela.png')));
});

test('pagina que lanca em tudo: capturar nao lanca e grava meta.json', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'stj', rota: 'local' });
  const page = pagina();
  page.screenshot = async () => { throw new Error('alvo fechado'); };
  page.content = async () => { throw new Error('alvo fechado'); };
  page.url = () => { throw new Error('alvo fechado'); };
  page.title = async () => { throw new Error('alvo fechado'); };
  c.anexarPagina(page);
  await c.capturar();
  assert.equal(JSON.parse(ler(dir, 'meta.json')).passo, 'desconhecido');
});

test('sem pagina: meta.json com passo desconhecido', async () => {
  const dir = tmp(); await criarCaptura({ dir, tribunal: 'tjpr', rota: 'local' }).capturar();
  assert.equal(JSON.parse(ler(dir, 'meta.json')).passo, 'desconhecido');
});

test('exit(1) espera a captura e sai com o mesmo codigo; exit(0) nao captura', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  let capturou = 0; let liberar;
  instalarSaida({ capturar: () => { capturou++; return new Promise((r) => { liberar = r; }); } }, proc);
  proc.exit(0); proc.exit(1); await tique();
  assert.deepEqual(chamadas, [0]); assert.equal(capturou, 1);
  assert.equal(proc.exitCode, 1);
  liberar(); await tique();
  assert.deepEqual(chamadas, [0, 1]);
});

test('exit(1) seguido de exit(0) sai com 1 (fluxo que seguiu depois do exit interceptado)', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: async () => {} }, proc);
  proc.exit(1); proc.exit(0); await tique();
  assert.deepEqual(chamadas, [1]);
});

test('escrita depois do exit(1) nunca chega ao stdout nem ao stderr', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: async () => {} }, proc);
  proc.stdout.write('{"success":true,"encontrado":false}\n');
  proc.exit(1);
  let callback = false;
  assert.equal(proc.stdout.write('{"success":false}\n', () => { callback = true; }), true);
  proc.stderr.write('Error during crawling\n');
  await tique();
  assert.equal(proc.escrito.stdout, '{"success":true,"encontrado":false}\n');
  assert.equal(proc.escrito.stderr, '');
  assert.ok(callback, 'callback de write silenciado ainda é chamado');
});

test('launch e connectOverCDP depois do exit(1) nunca abrem navegador', async () => {
  const proc = processoFalso(() => {});
  const saida = instalarSaida({ capturar: () => new Promise(() => {}) }, proc, { tetoMs: 50 });
  let abertos = 0;
  const chromium = { launch: async () => { abertos++; }, connectOverCDP: async () => { abertos++; } };
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { exclusivo: false, encerrando: saida.encerrando });
  proc.exit(1);
  let resolveu = false;
  chromium.launch().then(() => { resolveu = true; });
  chromium.connectOverCDP('wss://x').then(() => { resolveu = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(abertos, 0); assert.equal(resolveu, false);
});

test('captura que nunca termina: o teto forca a saida com o codigo', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: () => new Promise(() => {}) }, proc, { tetoMs: 50 });
  const t0 = Date.now(); proc.exit(4);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(chamadas, []);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(chamadas, [4]); assert.ok(Date.now() - t0 < 500);
});

test('excecao e rejeicao nao tratadas: stack no stderr, captura e saida com 1', async () => {
  for (const evento of ['uncaughtException', 'unhandledRejection']) {
    const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
    let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
    proc.emit(evento, new Error('quebrou no seletor'));
    await tique();
    assert.deepEqual(chamadas, [1], evento); assert.equal(capturou, 1);
    assert.match(proc.escrito.stderr, /quebrou no seletor/);
  }
});

test('modo consulta (-n, --numero=, --acordao, --listar-*, --help) fica fora da captura', () => {
  for (const args of [['trf4', '-n', '5000'], ['trf2', '--numero=5000'], ['tcu', '--acordao', '1/2026'], ['trf4', '--listar-combos'], ['stj', '--help'], ['stf', '--teses', 'x']]) {
    assert.equal(modoConsulta(['node', 'bin/jur', ...args]), true, args.join(' '));
  }
  assert.equal(modoConsulta(['node', 'bin/jur', 'trf4', '-q', 'x', '-p', '5000', '--json']), false);
});

test('exit(1) repetido durante a captura sai uma vez so', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: async () => {} }, proc);
  proc.exit(1); proc.exit(1); await tique();
  assert.deepEqual(chamadas, [1]);
});

test('captura que rejeita nao impede a saida com o codigo original', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: async () => { throw new Error('x'); } }, proc);
  proc.exit(2); await new Promise((r) => setImmediate(r));
  assert.deepEqual(chamadas, [2]);
});

test('SIGUSR2 captura e sai com codigo 1', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
  proc.emit('SIGUSR2'); await new Promise((r) => setImmediate(r));
  assert.deepEqual(chamadas, [1]); assert.equal(capturou, 1);
});

test('sem ponte nem CDP: dois launch seguidos continuam permitidos (Review Focus 1)', async () => {
  const chromium = chromiumFalso();
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { exclusivo: false });
  await chromium.launch(); await chromium.launch();
});

test('com CDP: erro de conexao nao vaza a URL', async () => {
  const chromium = chromiumFalso({ falharCdp: 'wss://connect.steel.dev?apiKey=SEGREDO' });
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { cdp: 'wss://x', exclusivo: true });
  await assert.rejects(chromium.launch(), (e) => !/SEGREDO/.test(e.message) && /navegador remoto/.test(e.message));
});

test('connectOverCDP direto (Falcao) tambem registra paginas, sem duplicar', async () => {
  const page = pagina();
  const context = new EventEmitter(); context.pages = () => [page];
  const browser = new EventEmitter(); browser.contexts = () => [context]; browser.newContext = async () => context;
  const chromium = { launch: async () => browser, connectOverCDP: async () => browser };
  const vistas = []; const naPonte = [];
  instrumentarChromium(chromium, { anexarPagina: (p) => naPonte.push(p), encerrar() {} }, { exclusivo: false, aoPagina: (p) => vistas.push(p) });
  await chromium.connectOverCDP('wss://y');
  await browser.newContext();
  context.emit('page', page);
  const popup = pagina(); context.emit('page', popup);
  assert.deepEqual(vistas, [page, popup]);
  assert.deepEqual(naPonte, [page, popup]);
});

test('connectOverCDP direto com CDP configurado nao vaza a URL', async () => {
  const chromium = chromiumFalso({ falharCdp: 'wss://connect.steel.dev?apiKey=SEGREDO' });
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { cdp: 'wss://x', exclusivo: true });
  await assert.rejects(chromium.connectOverCDP('wss://connect.steel.dev?apiKey=SEGREDO'), (e) => !/SEGREDO/.test(e.message));
});

// Padrão do bin/jur: envelope JSON, exit interceptado retorna e o fluxo segue para outro envelope.
const SIM = `(async () => {
  const numero = process.argv.includes('-n');
  try {
    if (numero) { process.stdout.write(JSON.stringify({ success: true, encontrado: false }) + '\\n'); process.exit(1); }
    if (!process.env.Q) throw new Error('Informe -q');
    process.stdout.write(JSON.stringify({ success: true, count: 3 }) + '\\n');
    process.exit(0);
  } catch (e) { process.stdout.write(JSON.stringify({ success: false, error: e.message }) + '\\n'); process.exit(1); }
})();`;

function rodarSim(args, env = {}) {
  const { spawnSync } = require('node:child_process');
  const dir = tmp(); const falha = path.join(dir, 'falha');
  const script = path.join(dir, 'sim.js'); fs.writeFileSync(script, SIM);
  const preload = path.resolve(__dirname, '../src/navegadorPreload.js');
  const r = spawnSync(process.execPath, ['--require', preload, script, ...args], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, JUR_ACOMPANHAR: '0', JUR_CAPTCHA: '0', JUR_BROWSER_CDP: '', JUR_FALHA_DIR: falha, ...env },
  });
  return { ...r, meta: fs.existsSync(path.join(falha, 'meta.json')) };
}

test('processo real: falha sem -n deixa so o primeiro envelope, sai com 1 e grava meta.json', () => {
  const r = rodarSim(['trf2'], { Q: '' });
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['{"success":false,"error":"Informe -q"}']);
  assert.ok(r.meta);
});

test('processo real: -n sai na hora com o comportamento original e sem captura', () => {
  const r = rodarSim(['trf2', '-n', '5000'], { Q: '' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim().split('\n')[0], '{"success":true,"encontrado":false}');
  assert.equal(r.meta, false);
});

test('processo real: sucesso sai com 0 e sem captura', () => {
  const r = rodarSim(['trf2'], { Q: 'x' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '{"success":true,"count":3}');
  assert.equal(r.meta, false);
});

// O executor sabe se a execucao e consulta pura (params); o argv nao: em trf1/trf3/trf5 `-n`
// filtra uma busca com -q. JUR_CAPTURA manda; modoConsulta(argv) so vale com a CLI direta.
test('processo real: JUR_CAPTURA=1 captura mesmo com -n no argv (filtro de busca)', () => {
  const r = rodarSim(['trf2', '-q', 'x', '-n', '5000'], { Q: '', JUR_CAPTURA: '1' });
  assert.equal(r.status, 1);
  assert.equal(r.meta, true);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'exit interceptado silencia o resto');
});

test('processo real: JUR_CAPTURA=0 desliga a captura mesmo sem flag de consulta', () => {
  const r = rodarSim(['trf2'], { Q: '', JUR_CAPTURA: '0' });
  assert.equal(r.status, 1);
  assert.equal(r.meta, false);
});

test('capturaLigada: JUR_CAPTURA manda; sem ela, cai em modoConsulta(argv)', () => {
  const argvConsulta = ['node', 'bin/jur', 'tcepa', '--decisao', 'x'];
  const argvBusca = ['node', 'bin/jur', 'trf4', '-q', 'x'];
  assert.equal(capturaLigada({ JUR_CAPTURA: '1' }, argvConsulta), true);
  assert.equal(capturaLigada({ JUR_CAPTURA: '0' }, argvBusca), false);
  assert.equal(capturaLigada({}, argvConsulta), false);
  assert.equal(capturaLigada({}, argvBusca), true);
  assert.equal(capturaLigada({ JUR_CAPTURA: '' }, argvBusca), true);
});

// Cancelamento do usuario (jobs.cancelar -> matarGrupo -> SIGTERM) nao e falha: sem captura, sem espera.
test('SIGTERM (cancelamento) e depois exit(1): sai na hora, sem captura', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
  proc.on('SIGTERM', () => {}); // o handler do Playwright (posto no launch), que so fecha o browser
  proc.emit('SIGTERM');
  assert.deepEqual(chamadas, [], 'com o Playwright presente, quem sai e o crawler');
  proc.exit(1);
  assert.deepEqual(chamadas, [1]); assert.equal(capturou, 0);
  proc.emit('SIGUSR2'); await tique();
  assert.equal(capturou, 0, 'SIGUSR2 depois do cancelamento nao captura');
});

test('SIGTERM e depois erro fatal: sai com 1, sem captura', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  proc.on('SIGTERM', () => {});
  let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
  proc.emit('SIGTERM'); proc.emit('unhandledRejection', new Error('Target closed'));
  await tique();
  assert.deepEqual(chamadas, [1]); assert.equal(capturou, 0);
});

test('listener de SIGTERM so existe enquanto o do Playwright existe (acao padrao preservada)', () => {
  const proc = processoFalso(() => {});
  instalarSaida({ capturar: async () => {} }, proc);
  assert.equal(proc.listenerCount('SIGTERM'), 0, 'sem browser, o SIGTERM mata o node como sempre');
  const playwright = () => {};
  proc.on('SIGTERM', playwright);
  assert.equal(proc.listenerCount('SIGTERM'), 2);
  proc.off('SIGTERM', playwright); // removeProcessHandlersIfNeeded quando o ultimo browser fecha
  assert.equal(proc.listenerCount('SIGTERM'), 0);
  proc.on('SIGTERM', playwright);
  assert.equal(proc.listenerCount('SIGTERM'), 2, 'volta a vigiar no proximo launch');
});

function rodarAteSinal(script, env = {}) {
  const { spawn } = require('node:child_process');
  const dir = tmp(); const falha = path.join(dir, 'falha'); const pronto = path.join(dir, 'pronto');
  const arquivo = path.join(dir, 'c.js'); fs.writeFileSync(arquivo, script);
  const preload = path.resolve(__dirname, '../src/navegadorPreload.js');
  const filho = spawn(process.execPath, ['--require', preload, arquivo, 'trf4', '-q', 'x'], {
    cwd: path.resolve(__dirname, '..'), detached: true, stdio: 'ignore',
    env: { ...process.env, JUR_ACOMPANHAR: '0', JUR_CAPTCHA: '0', JUR_BROWSER_CDP: '', JUR_FALHA_DIR: falha, JUR_CAPTURA: '1', PRONTO: pronto, ...env },
  });
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => { try { process.kill(-filho.pid, 'SIGKILL'); } catch {} reject(new Error('nao saiu')); }, 20000);
    let t0 = null;
    const espera = setInterval(() => {
      if (!fs.existsSync(pronto)) return;
      clearInterval(espera); t0 = Date.now();
      process.kill(-filho.pid, 'SIGTERM'); // como matarGrupo no cancelamento
    }, 20);
    filho.on('close', (codigo, sinal) => {
      clearTimeout(limite); clearInterval(espera);
      resolve({ codigo, sinal, ms: t0 === null ? null : Date.now() - t0, meta: fs.existsSync(path.join(falha, 'meta.json')) });
    });
  });
}

test('processo real: cancelamento com chromium aberto sai rapido e sem meta.json', async () => {
  const r = await rodarAteSinal(`const { chromium } = require(${JSON.stringify(require.resolve('playwright'))});
(async () => {
  try {
    const b = await chromium.launch(); const p = await b.newPage(); await p.setContent('<p>oi</p>');
    require('fs').writeFileSync(process.env.PRONTO, '1');
    await p.waitForTimeout(60000);
  } catch (e) { process.stdout.write(JSON.stringify({ success: false, error: 'x' }) + '\\n'); process.exit(1); }
})();`);
  assert.notEqual(r.ms, null, 'chegou ao sinal');
  assert.equal(r.meta, false, 'cancelamento nao e falha');
  assert.ok(r.ms < 2000, `saiu em ${r.ms} ms`);
});

test('processo real: SIGTERM antes de qualquer browser ainda mata o processo', async () => {
  const r = await rodarAteSinal(`require('fs').writeFileSync(process.env.PRONTO, '1'); setInterval(() => {}, 1000);`);
  assert.equal(r.sinal, 'SIGTERM');
  assert.equal(r.meta, false);
  assert.ok(r.ms < 2000, `saiu em ${r.ms} ms`);
});

test('envolverMetodos: rejeicao tira a foto da pagina viva e relanca o MESMO erro; sucesso nao fotografa', async () => {
  const { envolverMetodos } = require('../src/navegadorPreload');
  class Pagina { async goto(ok) { if (!ok) throw new Error('boom'); return 'feito'; } fechar() { return 'sync'; } }
  const fotos = [];
  envolverMetodos(Pagina.prototype, ['goto', 'fechar', 'inexistente'], async (p) => { fotos.push(p); });
  const p = new Pagina();
  assert.equal(await p.goto(true), 'feito');
  assert.equal(p.fechar(), 'sync');
  assert.deepEqual(fotos, []);
  let erro; try { await p.goto(false); } catch (e) { erro = e; }
  assert.equal(erro.message, 'boom');
  assert.equal(fotos.length, 1); assert.equal(fotos[0], p);
  // foto que lanca nao troca o erro original
  class Outra { async x() { throw new TypeError('original'); } }
  envolverMetodos(Outra.prototype, ['x'], async () => { throw new Error('foto falhou'); });
  await assert.rejects(new Outra().x(), (e) => e instanceof TypeError && e.message === 'original');
});

test('criarCaptura: sem pagina aberta grava a ultima foto tirada na falha', async () => {
  const dir = tmp();
  class PaginaFalsa extends EventEmitter {
    constructor() { super(); this.fechada = false; }
    isClosed() { return this.fechada; }
    async screenshot() { return PNG; }
    async content() { return '<html>falha</html>'; }
    url() { return 'https://x.br/consulta/12?token=SEGREDO'; }
    async title() { return 'T'; }
    async waitForSelector() { throw new Error('Timeout'); }
  }
  const captura = criarCaptura({ dir, tribunal: 'trf4', prazoMs: 500 });
  const page = new PaginaFalsa();
  captura.anexarPagina(page);
  await assert.rejects(page.waitForSelector('#x'), /Timeout/);
  page.fechada = true; // o crawler fechou o browser no finally
  await captura.capturar();
  assert.ok(fs.existsSync(path.join(dir, 'tela.png')));
  assert.match(fs.readFileSync(path.join(dir, 'pagina.html'), 'utf8'), /falha/);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.url, 'https://x.br/consulta/12');
  assert.match(meta.passo, /^pagina:/);
});

test('criarCaptura: pagina ja fechada na rejeicao nao gera foto e o erro segue igual', async () => {
  class Fechada extends EventEmitter {
    isClosed() { return true; }
    async screenshot() { throw new Error('nao deveria ler'); }
    async waitForSelector() { throw new Error('T'); }
  }
  const dir = tmp();
  const captura = criarCaptura({ dir, prazoMs: 200 });
  const p = new Fechada(); captura.anexarPagina(p);
  await assert.rejects(p.waitForSelector('#x'), /^Error: T$/);
  await captura.capturar();
  assert.ok(!fs.existsSync(path.join(dir, 'tela.png')));
});
