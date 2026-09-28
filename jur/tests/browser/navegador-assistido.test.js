const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '../..');
const preload = path.join(raiz, 'src/navegadorPreload.js');

function iniciarFilho(t, codigo, env = {}) {
  const filho = spawn(process.execPath, ['--require', preload, '-e', codigo], {
    cwd: raiz, env: { ...process.env, JUR_ACOMPANHAR: '1', JUR_CAPTCHA: '1', JUR_CAPTCHA_TIMEOUT_MS: '10000', JUR_BROWSER_CDP: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const mensagens = [];
  const terminou = new Promise((resolve) => filho.once('exit', resolve));
  let stderr = '';
  filho.stderr.on('data', (s) => { stderr += s; });
  filho.on('message', (m) => mensagens.push(m));
  t.after(() => { if (filho.exitCode === null) filho.kill('SIGKILL'); });
  async function esperar(predicado) {
    const achada = mensagens.find(predicado);
    if (achada) return achada;
    return new Promise((resolve, reject) => {
      const limpar = () => { clearTimeout(timer); filho.off('message', receber); filho.off('exit', saiu); };
      const receber = (m) => { if (predicado(m)) { limpar(); resolve(m); } };
      const saiu = (code) => { limpar(); reject(new Error(`CLI terminou (${code}): ${stderr}`)); };
      const timer = setTimeout(() => { limpar(); reject(new Error(`CLI não respondeu: ${stderr}`)); }, 15000);
      filho.on('message', receber);
      filho.once('exit', saiu);
    });
  }
  let sequencia = 0;
  const pedir = async (tipo, acao) => {
    const requestId = String(++sequencia);
    filho.send({ jurNavegador: true, requestId, tipo, acao });
    return esperar((m) => m.requestId === requestId);
  };
  return { filho, mensagens, esperar, pedir, terminou };
}

// Desafio de teste, deliberadamente simples. Nenhuma página de tribunal é acessada.
const desafio = `<title>Verificação humana</title><style>input{position:absolute;left:20px;top:60px;width:240px;height:35px}button{position:absolute;left:20px;top:120px;width:240px;height:35px}</style>
<p>Digite LOCAL para liberar a pesquisa.</p><input aria-label="Resposta"><button onclick="if(document.querySelector('input').value==='LOCAL'){document.title='Pesquisa';document.body.innerHTML='<input id=pesquisaLivre>'}">Validar</button>`;

test('IPC em Chromium real captura JPEG e só libera desafio local após ações e Continuar', { timeout: 25000 }, async (t) => {
  const codigo = `
    const { chromium } = require('playwright');
    const { aguardarIntervencao } = require('./src/navegadorAssistido');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      await page.setContent(${JSON.stringify(desafio)});
      await aguardarIntervencao(page, { verificar: () => page.locator('#pesquisaLivre').isVisible() });
      process.send({ fixture: 'concluida', liberado: await page.locator('#pesquisaLivre').isVisible() });
      process.on('message', async (m) => { if (m.fixture === 'encerrar') { await browser.close(); process.disconnect(); } });
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `;
  const cli = iniciarFilho(t, codigo);
  await cli.esperar((m) => m.estado === 'aguardando_usuario');
  assert.equal(cli.mensagens.some((m) => m.dados?.imagem), false);
  const tela = await cli.pedir('tela');
  assert.equal(tela.dados.largura, 640);
  assert.equal(tela.dados.altura, 480);
  assert.equal(Buffer.from(tela.dados.imagem, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  assert.match((await cli.pedir('acao', { tipo: 'continuar' })).erro, /ainda|concluíd/i);
  assert.equal(cli.mensagens.some((m) => m.fixture === 'concluida'), false);
  for (const acao of [
    { tipo: 'clicar', x: 0.1, y: 0.16 },
    { tipo: 'texto', texto: 'LOCAL' },
    { tipo: 'tecla', tecla: 'Tab' },
    { tipo: 'tecla', tecla: 'Enter' },
    { tipo: 'continuar' },
  ]) assert.deepEqual((await cli.pedir('acao', acao)).dados, { ok: true });
  assert.equal((await cli.esperar((m) => m.fixture === 'concluida')).liberado, true);
  assert.match((await cli.pedir('acao', { tipo: 'texto', texto: 'indevido' })).erro, /pausa/i);
  cli.filho.send({ fixture: 'encerrar' });
  assert.equal(await cli.terminou, 0);
});

test('STJ oferece intervenção após a primeira falta do formulário, sem navegar dez vezes', { timeout: 25000 }, async (t) => {
  const codigo = `
    const STJ = require('./src/STJNavigator');
    (async () => {
      const nav = new STJ({ headless: true });
      await nav._init();
      let visitas = 0;
      await nav.page.route('**/SCON/', (route) => { visitas++; return route.fulfill({ body: ${JSON.stringify(desafio)}, contentType: 'text/html' }); });
      await nav.abrir();
      process.send({ fixture: 'concluida', visitas });
      await nav.fechar();
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `;
  const cli = iniciarFilho(t, codigo);
  await cli.esperar((m) => m.estado === 'aguardando_usuario');
  const tela = await cli.pedir('tela');
  for (const acao of [
    { tipo: 'clicar', x: 80 / tela.dados.largura, y: 80 / tela.dados.altura },
    { tipo: 'texto', texto: 'LOCAL' },
    { tipo: 'tecla', tecla: 'Tab' }, { tipo: 'tecla', tecla: 'Enter' }, { tipo: 'continuar' },
  ]) assert.equal((await cli.pedir('acao', acao)).erro, undefined);
  assert.equal((await cli.esperar((m) => m.fixture === 'concluida')).visitas, 1);
  assert.equal(await cli.terminou, 0);
});

test('TJSP identifica desafios visíveis sem confundir ementa ou iframe oculto', { timeout: 20000 }, async (t) => {
  const TJSP = require('../../src/TJSPCrawler');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const crawler = new TJSP({ silent: true });
  crawler.page = page;
  assert.equal(typeof crawler.detectarDesafio, 'function', 'TJSP precisa distinguir bloqueio de resultado vazio');
  for (const html of [
    '<title>Verificação de segurança</title><p>Confirme que você é humano</p>',
    '<iframe title="reCAPTCHA" srcdoc="Confirme"></iframe>',
    '<p>Verifique que você não é um robô</p>',
  ]) {
    await page.setContent(html);
    assert.equal(await crawler.detectarDesafio(), true);
  }
  await page.setContent('<table><tr class="fundocinza1"><td>Acórdão menciona captcha e afirma que não sou um robô.</td></tr></table><iframe title="reCAPTCHA" style="display:none"></iframe>');
  assert.equal(await crawler.detectarDesafio(), false);
  await page.setContent('<input id="iddados.buscaInteiroTeor"><iframe title="reCAPTCHA" style="width:0;height:0;border:0"></iframe>');
  assert.equal(await crawler.detectarDesafio(), false, 'iframe sem área visível não é um desafio aberto');
  await page.setContent('<input id="iddados.buscaInteiroTeor"><div class="grecaptcha-badge"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?size=invisible" srcdoc="Selo reCAPTCHA"></iframe></div>');
  assert.equal(await crawler.detectarDesafio(), false, 'o selo invisível permanente não interrompe o formulário normal');
  await page.setContent('<input id="iddados.buscaInteiroTeor"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?size=normal" srcdoc="checkbox"></iframe>');
  assert.equal(await crawler.detectarDesafio(), true, 'checkbox realmente apresentado requer resposta');
  await page.setContent('<input id="iddados.buscaInteiroTeor"><textarea name="g-recaptcha-response" hidden>token-local</textarea><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?size=normal" srcdoc="checkbox preenchido"></iframe>');
  assert.equal(await crawler.detectarDesafio(), false, 'anchor preenchido permanece na página');
  await page.setContent('<input id="iddados.buscaInteiroTeor"><iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/api2/bframe" srcdoc="Selecione as imagens"></iframe>');
  assert.equal(await crawler.detectarDesafio(), true, 'desafio visual aberto interrompe mesmo com formulário visível');
});

test('TJSP nunca retorna resultados vazios diante de desafio sem opt-in', { timeout: 20000 }, async (t) => {
  const TJSP = require('../../src/TJSPCrawler');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const crawler = new TJSP({ silent: true });
  crawler.page = page;
  await page.setContent('<title>Verificação de segurança</title><p>Confirme que você é humano</p>');
  // A implementação antiga aguardava quinze segundos e devolvia [].
  await assert.rejects(crawler.extractResults(), /TJSP.*(CAPTCHA|verificação|desafio)/i);
});

test('TJSP só retoma quando o desafio local revela os resultados reais', { timeout: 20000 }, async (t) => {
  const resultado = '<input id="iddados.buscaInteiroTeor" hidden><table><tr class="fundocinza1"><td><a class="esajLinkLogin downloadEmenta" cdacordao="123">0001-LOCAL</a><div id="textAreaDados_123">Ementa de teste</div></td></tr></table>';
  const html = `<title>Verificação humana</title><input style="position:absolute;left:20px;top:60px;width:240px;height:35px"><button style="position:absolute;left:20px;top:120px;width:240px;height:35px" onclick="liberar()">Validar</button><script>function liberar(){if(document.querySelector('input').value==='LOCAL'){document.title='Resultados';document.body.innerHTML=${JSON.stringify(resultado)}}}</script>`;
  const formulario = `<input id="iddados.buscaInteiroTeor"><button id="pbSubmit" onclick="document.open();document.write(${JSON.stringify(html).replaceAll('&', '&amp;').replaceAll('"', '&quot;')});document.close()">Buscar</button>`;
  const codigo = `
    const TJSP = require('./src/TJSPCrawler');
    (async () => {
      const crawler = new TJSP({ silent: true });
      await crawler.init();
      await crawler.page.setContent(${JSON.stringify(formulario)});
      // Modela o networkidle que não chega enquanto o provedor mantém o desafio aberto.
      crawler.waitForLoad = async () => { if (await crawler.detectarDesafio()) throw new Error('networkidle bloqueado pelo desafio'); };
      await crawler.executeSearch('consulta local');
      const resultados = await crawler.extractResults();
      process.send({ fixture: 'concluida', resultados });
      await crawler.close();
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `;
  const cli = iniciarFilho(t, codigo);
  await cli.esperar((m) => m.estado === 'aguardando_usuario');
  assert.match((await cli.pedir('acao', { tipo: 'continuar' })).erro, /ainda|concluíd/i);
  const tela = await cli.pedir('tela');
  for (const acao of [
    { tipo: 'clicar', x: 80 / tela.dados.largura, y: 80 / tela.dados.altura },
    { tipo: 'texto', texto: 'LOCAL' }, { tipo: 'tecla', tecla: 'Tab' },
    { tipo: 'tecla', tecla: 'Enter' }, { tipo: 'continuar' },
  ]) assert.equal((await cli.pedir('acao', acao)).erro, undefined);
  const { resultados } = await cli.esperar((m) => m.fixture === 'concluida');
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].numeroProcesso, '0001-LOCAL');
  assert.equal(resultados[0].ementa, 'Ementa de teste');
  assert.equal(await cli.terminou, 0);
});

test('acompanhamento sem CAPTCHA captura a página e rejeita o controle', { timeout: 20000 }, async (t) => {
  const cli = iniciarFilho(t, `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      await page.setContent('<h1>Busca em andamento</h1>');
      process.send({ fixture: 'pronta' });
      process.on('message', async (m) => { if (m.fixture === 'encerrar') { await browser.close(); process.disconnect(); } });
    })().catch((e) => { console.error(e); process.exitCode = 1; });
  `, { JUR_CAPTCHA: '0' });
  await cli.esperar((m) => m.fixture === 'pronta');
  assert.equal((await cli.pedir('tela')).dados.largura, 640);
  assert.match((await cli.pedir('acao', { tipo: 'clicar', x: 0.5, y: 0.5 })).erro, /pausa/i);
  cli.filho.send({ fixture: 'encerrar' });
  assert.equal(await cli.terminou, 0);
});
