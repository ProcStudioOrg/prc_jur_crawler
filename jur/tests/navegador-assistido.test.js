const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const helperPath = '../src/navegadorAssistido';
const carregar = () => {
  assert.doesNotThrow(() => require.resolve(helperPath), 'a ponte de intervenção deve existir');
  return require(helperPath);
};

function pagina() {
  const page = new EventEmitter();
  page.isClosed = () => false;
  page.viewportSize = () => ({ width: 800, height: 600 });
  page.mouse = { click: async () => {}, wheel: async () => {} };
  page.keyboard = { insertText: async () => {}, press: async () => {} };
  page.screenshot = async () => Buffer.from('jpeg');
  return page;
}

test('sem opt-in, importar helper não instala listeners nem aguarda CAPTCHA', async (t) => {
  const anterior = process.env.JUR_CAPTCHA;
  delete process.env.JUR_CAPTCHA;
  t.after(() => { if (anterior == null) delete process.env.JUR_CAPTCHA; else process.env.JUR_CAPTCHA = anterior; });
  const listeners = process.listenerCount('message');
  const helper = carregar();
  assert.equal(await helper.aguardarIntervencao(null, { verificar: () => { throw new Error('não deve verificar'); } }), false);
  assert.equal(process.listenerCount('message'), listeners);
});

test('ações rejeitam valores não finitos, atalhos arbitrários, código e texto acima do limite', () => {
  const { validarAcao } = carregar();
  for (const acao of [null, [], {}, { tipo: 'executar', codigo: '1+1' },
    { tipo: 'clicar', x: -0.1, y: 0 }, { tipo: 'clicar', x: 1.01, y: 0 },
    { tipo: 'clicar', x: 0, y: NaN }, { tipo: 'clicar', x: '0.5', y: 0 },
    { tipo: 'rolar', deltaY: Infinity }, { tipo: 'texto', texto: 'x'.repeat(1001) },
    { tipo: 'texto', texto: 1 }, { tipo: 'tecla', tecla: 'Control+L' }]) {
    assert.throws(() => validarAcao(acao), /inválid|limite|permitid/i);
  }
  assert.deepEqual(validarAcao({ tipo: 'rolar', deltaY: 100000 }), { tipo: 'rolar', deltaY: 1200 });
  assert.deepEqual(validarAcao({ tipo: 'rolar', deltaY: -100000 }), { tipo: 'rolar', deltaY: -1200 });
  assert.deepEqual(validarAcao({ tipo: 'clicar', x: 0, y: 1 }), { tipo: 'clicar', x: 0, y: 1 });
  assert.deepEqual(validarAcao({ tipo: 'tecla', tecla: 'Shift+Tab' }), { tipo: 'tecla', tecla: 'Shift+Tab' });
});

test('captura somente sob demanda e responde IPC sem detalhes internos dos erros', async () => {
  const { criarPonte } = carregar();
  const mensagens = [];
  const ponte = criarPonte({ enviar: (m) => mensagens.push(m), captcha: true });
  const page = pagina();
  let capturas = 0;
  page.screenshot = async () => { capturas++; return Buffer.from('jpeg'); };
  ponte.anexarPagina(page);
  assert.equal(capturas, 0);
  await ponte.tratarMensagem({ jurNavegador: true, requestId: 's1', tipo: 'tela' });
  assert.equal(capturas, 1);
  assert.deepEqual(mensagens.at(-1), {
    jurNavegador: true, requestId: 's1', dados: { imagem: 'anBlZw==', largura: 800, altura: 600 },
  });
  page.screenshot = async () => { throw new Error('wss://segredo@provedor/token cookie=privado'); };
  await ponte.tratarMensagem({ jurNavegador: true, requestId: 's2', tipo: 'tela' });
  assert.match(mensagens.at(-1).erro, /captur/i);
  assert.doesNotMatch(JSON.stringify(mensagens), /segredo|provedor|privado/);
  await assert.rejects(ponte.executarAcao({ tipo: 'texto', texto: 'x' }), /pausa/i);
});

test('continuar só retoma após condição real; uma tentativa incorreta continua pausada', async () => {
  const { criarPonte } = carregar();
  const mensagens = [];
  const ponte = criarPonte({ enviar: (m) => mensagens.push(m), captcha: true });
  const page = pagina();
  let pronto = false;
  const espera = ponte.aguardarIntervencao(page, { verificar: async () => pronto, mensagem: 'Resolva o desafio.', timeoutMs: 5000 });
  assert.equal(mensagens.at(-1).estado, 'aguardando_usuario');
  await assert.rejects(ponte.executarAcao({ tipo: 'continuar' }), /ainda|concluíd/i);
  assert.equal(mensagens.at(-1).estado, 'aguardando_usuario');
  pronto = true;
  assert.deepEqual(await ponte.executarAcao({ tipo: 'continuar' }), { ok: true });
  assert.equal(await espera, true);
  assert.equal(mensagens.at(-1).estado, 'rodando');
  await assert.rejects(ponte.executarAcao({ tipo: 'clicar', x: 0, y: 0 }), /pausa/i);
});

test('retomada aguarda a ação em andamento e recusa comandos que chegarem depois', async () => {
  const { criarPonte } = carregar();
  const ponte = criarPonte({ enviar() {}, captcha: true });
  const page = pagina();
  let liberar;
  let terminado = false;
  page.keyboard.insertText = () => new Promise((resolve) => { liberar = () => { terminado = true; resolve(); }; });
  const espera = ponte.aguardarIntervencao(page, { verificar: async () => terminado, timeoutMs: 5000 });
  const digitacao = ponte.executarAcao({ tipo: 'texto', texto: 'resposta' });
  await new Promise(setImmediate);
  const continuar = ponte.executarAcao({ tipo: 'continuar' });
  const tardia = assert.rejects(ponte.executarAcao({ tipo: 'tecla', tecla: 'Enter' }), /pausa|retom/i);
  liberar();
  await Promise.all([digitacao, continuar, tardia]);
  assert.equal(await espera, true);
});

test('prazo e fechamento da página encerram a pausa com erro explícito', async () => {
  const { criarPonte } = carregar();
  const ponte = criarPonte({ enviar() {}, captcha: true });
  await assert.rejects(ponte.aguardarIntervencao(pagina(), { verificar: async () => false, timeoutMs: 10 }), /tempo|prazo/i);
  await assert.rejects(ponte.executarAcao({ tipo: 'continuar' }), /pausa/i);
  const page = pagina();
  const espera = ponte.aguardarIntervencao(page, { verificar: async () => false, timeoutMs: 5000 });
  page.emit('close');
  await assert.rejects(espera, /fechad|encerrad/i);
});

test('preload limita lançamentos concorrentes e instrumenta páginas CDP preexistentes', async () => {
  assert.doesNotThrow(() => require.resolve('../src/navegadorPreload'));
  const { instrumentarChromium } = require('../src/navegadorPreload');
  const page = pagina();
  const context = new EventEmitter();
  context.pages = () => [page];
  const browser = new EventEmitter();
  browser.contexts = () => [context];
  browser.newContext = async () => context;
  let concluir;
  const chromium = { launch: async () => { throw new Error('CDP deve ser usado'); }, connectOverCDP: async () => new Promise((r) => { concluir = () => r(browser); }) };
  const paginas = new Set();
  instrumentarChromium(chromium, { anexarPagina: (p) => paginas.add(p), encerrar() {} }, { cdp: 'http://127.0.0.1:1234' });
  const primeira = chromium.launch();
  await assert.rejects(chromium.launch(), /navegador|execução/i);
  concluir();
  assert.equal(await primeira, browser);
  assert.ok(paginas.has(page));
  const popup = pagina();
  context.emit('page', popup);
  assert.ok(paginas.has(popup));
});

test('STJ preserva as retentativas quando CAPTCHA não foi ativado', async (t) => {
  const anterior = process.env.JUR_CAPTCHA;
  delete process.env.JUR_CAPTCHA;
  t.after(() => { if (anterior == null) delete process.env.JUR_CAPTCHA; else process.env.JUR_CAPTCHA = anterior; });
  const STJNavigator = require('../src/STJNavigator');
  const nav = new STJNavigator({ tentativasDesafio: 3 });
  let visitas = 0;
  nav.browser = {};
  nav.page = { goto: async () => { visitas++; }, waitForTimeout: async () => {}, locator: () => ({ count: async () => 0 }) };
  await assert.rejects(nav.abrir(), /desafio/i);
  assert.equal(visitas, 3);
});

test('provedor CDP é usado sem acompanhamento nem listeners IPC', () => {
  const codigo = `
    const { EventEmitter } = require('node:events');
    const { chromium } = require('playwright');
    let destino = '';
    const browser = new EventEmitter();
    browser.contexts = () => [];
    browser.newContext = async () => {};
    chromium.launch = async () => { destino = 'local'; return browser; };
    chromium.connectOverCDP = async () => { destino = 'remoto'; return browser; };
    require('./src/navegadorPreload');
    chromium.launch().then(() => console.log(JSON.stringify({ destino, listeners: process.listenerCount('message') })));
  `;
  const result = spawnSync(process.execPath, ['-e', codigo], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, JUR_ACOMPANHAR: '0', JUR_CAPTCHA: '0', JUR_BROWSER_CDP: 'http://127.0.0.1:1234' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { destino: 'remoto', listeners: 0 });
});

test('STJ rejeita bloqueio que reaparece nas requisições HTTP após a liberação inicial', async () => {
  const STJNavigator = require('../src/STJNavigator');
  const nav = new STJNavigator();
  for (const [status, html] of [
    [403, '<title>Just a moment...</title>'],
    [429, 'Too many requests'],
    [200, '<title>Um momento...</title><p>Verificação automática em andamento</p>'],
  ]) {
    nav.context = { request: { get: async () => ({ status: () => status, body: async () => Buffer.from(html, 'latin1') }) } };
    await assert.rejects(nav.buscar({ query: 'consulta', inicio: 11 }), /STJ.*(?:bloque|desafio|verifica|CAPTCHA)/i);
  }
});

test('STJ distingue falha HTTP de busca vazia explícita', async () => {
  const STJNavigator = require('../src/STJNavigator');
  const nav = new STJNavigator();
  nav.context = { request: { get: async () => ({ status: () => 500, body: async () => Buffer.from('Indisponível') }) } };
  await assert.rejects(nav.buscar({ query: 'consulta' }), /STJ.*HTTP 500/i);
  nav.context.request.get = async () => ({ status: () => 200, body: async () => Buffer.from('Nenhum documento encontrado', 'latin1') });
  assert.equal((await nav.buscar({ query: 'consulta' })).total, 0);
});
