const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const {
  criarCaptura, derivarPasso, urlSemQuery, instalarSaida, instrumentarChromium,
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
  return proc;
}

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
  let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
  proc.exit(0); proc.exit(1); await new Promise((r) => setImmediate(r));
  assert.deepEqual(chamadas, [0, 1]); assert.equal(capturou, 1);
});

test('exit(1) repetido durante a captura sai uma vez so', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  instalarSaida({ capturar: async () => {} }, proc);
  proc.exit(1); proc.exit(1); await new Promise((r) => setImmediate(r));
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
