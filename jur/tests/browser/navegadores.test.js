const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const { fixture } = require('./sso-fixture');

let browser;
let imagem;
before(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.setContent('<h1>Portal do tribunal</h1><label>Código de confirmação <input></label>');
  imagem = (await page.screenshot({ type: 'jpeg' })).toString('base64');
  await page.close();
});
after(async () => browser?.close());

function estado(sessoes = []) {
  return {
    total: 5, ocupados: 3, disponiveis: 2, naFila: 0,
    preferencias: { acompanhar: false, captcha: false, provedor: 'local' },
    provedores: ['local', 'browserbase'], sessoes,
  };
}
function sessao(id, status = 'rodando') {
  return { id, comando: 'stj', status, posicao: null, acompanhar: true };
}
async function abrir(t, dados = estado(), viewport = { width: 1280, height: 900 }) {
  const f = await fixture();
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(6000);
  t.after(async () => { await page.close(); await f.close(); });
  const chamadas = { estado: 0, telas: [], acoes: [], preferencias: [], cancelamentos: [] };
  const controle = { dados, erroPreferencias: false, erroAcao: false, tela: null };
  await page.route('**/api/v1/navegadores**', async (route) => {
    const req = route.request();
    const caminho = new URL(req.url()).pathname;
    if (caminho.endsWith('/preferencias')) {
      chamadas.preferencias.push(req.postDataJSON());
      if (controle.erroPreferencias) return route.fulfill({ status: 503, json: { erro: 'Não foi possível salvar agora.' } });
      controle.dados.preferencias = req.postDataJSON();
      return route.fulfill({ json: controle.dados.preferencias });
    }
    if (caminho.endsWith('/tela')) {
      assert.match(req.headers().cookie || '', /jur_session=/);
      assert.equal(req.headers().authorization, undefined);
      chamadas.telas.push(caminho);
      if (controle.tela) return controle.tela(route);
      return route.fulfill({ json: { imagem, largura: 800, altura: 500 } });
    }
    if (caminho.endsWith('/acao')) {
      chamadas.acoes.push({ caminho, ...req.postDataJSON() });
      if (controle.acao) return controle.acao(route);
      if (controle.erroAcao) return route.fulfill({ status: 409, json: { erro: 'O desafio ainda está na tela.' } });
      return route.fulfill({ json: { ok: true } });
    }
    chamadas.estado++;
    return route.fulfill({ json: controle.dados });
  });
  await page.route('**/api/v1/buscas/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    chamadas.cancelamentos.push(id);
    controle.dados.sessoes = controle.dados.sessoes.filter((s) => s.id !== id);
    await route.fulfill({ json: { ok: true } });
  });
  return { f, page, chamadas, controle };
}
async function expandir(page) {
  await page.click('#navegadores-abrir');
  await page.locator('#navegadores-corpo').waitFor({ state: 'visible' });
}

test('capacidade aparece apenas na conta autenticada; CAPTCHA ativa acompanhamento e falha ao salvar reverte', async (t) => {
  const { f, page, chamadas, controle } = await abrir(t);
  await page.goto(f.base);
  await page.locator('#login-procstudio').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#navegadores').isVisible(), false);
  assert.equal(chamadas.estado, 0);
  await f.login(page);
  await page.getByText('2 de 5 navegadores disponíveis', { exact: true }).waitFor();
  assert.equal(await page.locator('#navegadores-abrir').getAttribute('aria-expanded'), 'false');
  assert.equal(chamadas.telas.length, 0);
  await expandir(page);
  assert.equal(await page.locator('#navegadores-acompanhar').isChecked(), false);
  assert.equal(await page.locator('#navegadores-captcha').isChecked(), false);
  await page.check('#navegadores-captcha');
  await page.locator('#navegadores-captcha:enabled').waitFor();
  assert.equal(await page.locator('#navegadores-acompanhar').isChecked(), true);
  assert.deepEqual(chamadas.preferencias.at(-1), { acompanhar: true, captcha: true, provedor: 'local' });
  await page.selectOption('#navegadores-provedor', 'browserbase');
  await page.locator('#navegadores-provedor:enabled').waitFor();
  assert.equal(chamadas.preferencias.at(-1).provedor, 'browserbase');
  controle.erroPreferencias = true;
  await page.uncheck('#navegadores-acompanhar');
  await page.getByText('Não foi possível salvar agora.', { exact: true }).waitFor();
  assert.equal(await page.locator('#navegadores-acompanhar').isChecked(), true);
  assert.equal(await page.locator('#navegadores-captcha').isChecked(), true);
});

test('fila informa posição pessoal e permite cancelar sem pedir imagens', async (t) => {
  const dados = estado([{ ...sessao('na-fila', 'enfileirado'), posicao: 2 }]);
  Object.assign(dados, { ocupados: 5, disponiveis: 0, naFila: 3 });
  const { f, page, chamadas } = await abrir(t, dados);
  await f.login(page);
  await page.getByText('5 de 5 navegadores ocupados', { exact: true }).waitFor();
  await expandir(page);
  assert.match(await page.locator('#navegadores-estado').textContent(), /posição 2/i);
  assert.equal(chamadas.telas.length, 0);
  await page.click('#navegadores-cancelar');
  await page.locator('#navegadores-vazio').waitFor({ state: 'visible' });
  assert.deepEqual(chamadas.cancelamentos, ['na-fila']);
});

test('provedor salvo indisponível continua visível e permite escolher o servidor local', async (t) => {
  const dados = estado();
  dados.provedores = ['local'];
  dados.preferencias.provedor = 'browserbase';
  const { f, page, chamadas } = await abrir(t, dados);
  await f.login(page);
  await expandir(page);
  assert.equal(await page.locator('#navegadores-provedor').isVisible(), true);
  assert.equal(await page.locator('#navegadores-provedor').inputValue(), 'browserbase');
  assert.equal(await page.locator('#navegadores-provedor option[value="browserbase"]').evaluate((opcao) => opcao.disabled), true,
    await page.locator('#navegadores-provedor').evaluate((select) => select.outerHTML));
  await page.selectOption('#navegadores-provedor', 'local');
  await page.locator('#navegadores-provedor-campo').waitFor({ state: 'hidden' });
  assert.equal(chamadas.preferencias.at(-1).provedor, 'local');
});

test('mini tela usa JPEG autenticado e só admite comandos durante a pausa humana', async (t) => {
  const { f, page, chamadas, controle } = await abrir(t, estado([sessao('rodando')]));
  await f.login(page);
  await expandir(page);
  await page.locator('#navegadores-imagem').waitFor({ state: 'visible' });
  assert.match(await page.locator('#navegadores-imagem').getAttribute('src'), /^data:image\/jpeg;base64,/);
  assert.equal(await page.locator('#navegadores-tela').isDisabled(), true);
  assert.equal(await page.locator('#navegadores-controles').isVisible(), false);
  controle.dados.sessoes[0].status = 'aguardando_usuario';
  await page.locator('#navegadores-controles').waitFor({ state: 'visible' });
  await page.screenshot({ path: '/tmp/jur-navegadores-desktop.png' });
  const caixa = await page.locator('#navegadores-imagem').boundingBox();
  await page.mouse.click(caixa.x + caixa.width / 4, caixa.y + caixa.height / 2);
  await page.locator('#navegadores-continuar:enabled').waitFor();
  assert.equal(chamadas.acoes[0].tipo, 'clicar');
  assert.ok(Math.abs(chamadas.acoes[0].x - 0.25) < 0.01);
  assert.ok(Math.abs(chamadas.acoes[0].y - 0.5) < 0.01);
  await page.fill('#navegadores-texto', 'AB12');
  await page.click('#navegadores-enviar-texto');
  await page.locator('#navegadores-continuar:enabled').waitFor();
  assert.equal(chamadas.acoes.at(-1).texto, 'AB12');
  await page.click('#navegadores-enviar-tecla');
  await page.locator('#navegadores-continuar:enabled').waitFor();
  assert.equal(chamadas.acoes.at(-1).tecla, 'Tab');
  await page.click('#navegadores-rolar-baixo');
  await page.locator('#navegadores-continuar:enabled').waitFor();
  assert.equal(chamadas.acoes.at(-1).tipo, 'rolar');
  assert.ok(chamadas.acoes.at(-1).deltaY > 0);
  controle.erroAcao = true;
  await page.click('#navegadores-continuar');
  await page.getByText('O desafio ainda está na tela.', { exact: true }).waitFor();
  assert.equal(await page.locator('#navegadores-continuar').isEnabled(), true);
  const antes = chamadas.telas.length;
  await page.click('#navegadores-abrir');
  await page.waitForTimeout(1800);
  assert.equal(chamadas.telas.length, antes);
  assert.equal(await page.locator('#navegadores-imagem').getAttribute('src'), null);
  await expandir(page);
  await page.locator('#navegadores-imagem').waitFor({ state: 'visible' });
});

test('trocar de sessão descarta imagem atrasada e sair limpa o painel', async (t) => {
  const { f, page, controle } = await abrir(t, estado([sessao('antiga'), sessao('atual')]));
  let antiga;
  controle.tela = async (route) => {
    if (route.request().url().includes('/antiga/')) { antiga = route; return; }
    await route.fulfill({ json: { imagem, largura: 640, altura: 400 } });
  };
  await f.login(page);
  await expandir(page);
  await page.waitForFunction(() => document.querySelector('#navegadores-sessao').options.length === 2);
  await page.waitForTimeout(100);
  assert.ok(antiga);
  await page.selectOption('#navegadores-sessao', 'atual');
  await page.locator('#navegadores-imagem').waitFor({ state: 'visible' });
  await antiga.fulfill({ json: { imagem, largura: 800, altura: 500 } }).catch(() => {});
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#navegadores-imagem').getAttribute('width'), '640');
  await page.evaluate(() => document.dispatchEvent(new Event('jur:sair')));
  assert.equal(await page.locator('#navegadores').isVisible(), false);
  assert.equal(await page.locator('#navegadores-imagem').getAttribute('src'), null);
  assert.equal(await page.locator('#navegadores-sessao option').count(), 0);
  assert.equal(await page.locator('#navegadores-estado').textContent(), '');
});

test('aba oculta suspende a tela e uma captura lenta não cria solicitações sobrepostas', async (t) => {
  const { f, page, chamadas, controle } = await abrir(t, estado([sessao('lenta')]));
  let captura;
  controle.tela = async (route) => { captura = route; };
  await f.login(page);
  await expandir(page);
  await page.waitForTimeout(1800);
  assert.equal(chamadas.telas.length, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await captura.fulfill({ json: { imagem, largura: 800, altura: 500 } }).catch(() => {});
  await page.waitForTimeout(1800);
  assert.equal(chamadas.telas.length, 1);
  assert.equal(await page.locator('#navegadores-imagem').getAttribute('src'), null);
});

test('comando aguarda a captura em curso e suspende novas capturas até terminar', async (t) => {
  const { f, page, chamadas, controle } = await abrir(t, estado([sessao('pausada', 'aguardando_usuario')]));
  let captura;
  let acao;
  let capturou;
  let comandou;
  const capturaIniciada = new Promise((resolve) => { capturou = resolve; });
  const acaoIniciada = new Promise((resolve) => { comandou = resolve; });
  controle.tela = async (route) => { captura = route; capturou(); };
  controle.acao = async (route) => { acao = route; comandou(); };
  await f.login(page);
  await expandir(page);
  await capturaIniciada;
  await page.click('#navegadores-enviar-tecla');
  await page.waitForTimeout(100);
  assert.equal(chamadas.acoes.length, 0, 'a captura ainda ocupa o canal da sessão');
  controle.tela = null;
  await captura.fulfill({ json: { imagem, largura: 800, altura: 500 } });
  await acaoIniciada;
  await page.waitForTimeout(1800);
  assert.equal(chamadas.telas.length, 1, 'não deve capturar enquanto a tecla está sendo enviada');
  const proximaTela = page.waitForRequest((req) => req.url().endsWith('/pausada/tela'));
  await acao.fulfill({ json: { ok: true } });
  await proximaTela;
  await page.locator('#navegadores-continuar:enabled').waitFor();
});

test('cancelamento não aguarda uma captura pendente', async (t) => {
  const { f, page, chamadas, controle } = await abrir(t, estado([sessao('cancelar')]));
  let captura;
  let capturou;
  const capturaIniciada = new Promise((resolve) => { capturou = resolve; });
  controle.tela = async (route) => { captura = route; capturou(); };
  await f.login(page);
  await expandir(page);
  await capturaIniciada;
  await page.click('#navegadores-cancelar');
  await page.locator('#navegadores-vazio').waitFor({ state: 'visible' });
  assert.deepEqual(chamadas.cancelamentos, ['cancelar']);
  await captura.fulfill({ json: { imagem, largura: 800, altura: 500 } }).catch(() => {});
});

test('painel e controles cabem no celular em ambos os temas', async (t) => {
  const { f, page } = await abrir(t, estado([sessao('captcha', 'aguardando_usuario')]), { width: 390, height: 844 });
  await f.login(page);
  await expandir(page);
  await page.locator('#navegadores-imagem').waitFor({ state: 'visible' });
  for (const tema of ['claro', 'escuro']) {
    await page.evaluate((valor) => { document.documentElement.dataset.tema = valor; }, tema);
    const medidas = await page.evaluate(() => {
      const painel = document.querySelector('#navegadores');
      const rect = painel.getBoundingClientRect();
      return { direita: rect.right, largura: innerWidth, conteudo: painel.scrollWidth, painel: painel.clientWidth };
    });
    assert.ok(medidas.direita <= medidas.largura);
    assert.ok(medidas.conteudo <= medidas.painel + 1);
    assert.equal(await page.locator('#navegadores-continuar').isVisible(), true);
    if (tema === 'claro') {
      await page.screenshot({ path: '/tmp/jur-navegadores-mobile.png' });
      await page.locator('#navegadores').screenshot({ path: '/tmp/jur-navegadores-mobile-painel.png' });
    }
    await page.locator('#navegadores-continuar').scrollIntoViewIfNeeded();
    const continuar = await page.locator('#navegadores-continuar').boundingBox();
    assert.ok(continuar.y >= 0 && continuar.y + continuar.height <= 844);
  }
});

test('ativar CAPTCHA atualiza o escopo real do STJ sem recarregar a página', async (t) => {
  const f = await fixture();
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  t.after(async () => { await page.close(); await f.close(); });
  await f.login(page);
  await page.locator('.chip-tribunal[data-comando="stj"]').waitFor();
  assert.equal(await page.evaluate(() => window.jurEscopo.ligados().includes('stj')), false);
  await expandir(page);
  await page.check('#navegadores-captcha');
  await page.waitForFunction(() => window.jurEscopo.ligados().includes('stj'));
  assert.equal(await page.locator('.chip-tribunal[data-comando="stj"]').getAttribute('data-e'), 'sem-acesso');
  await page.uncheck('#navegadores-captcha');
  await page.waitForFunction(() => !window.jurEscopo.ligados().includes('stj'));
});
