const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const { chromium } = require('playwright');
const db = require('../../servidor/db');
const jobs = require('../../servidor/jobs');
const chaves = require('../../servidor/chaves');
const conversas = require('../../servidor/conversas');
const { criarApp } = require('../../servidor/index');

/**
 * A chave da Anthropic era salva no evento `change` do input, que so dispara no BLUR.
 * Quem colava a chave e fechava o painel no "x" sem sair do campo nao salvava nada — e
 * nao havia sinal nenhum, nem antes nem depois, de que tivesse ou nao salvado. O chat
 * respondia "sem chave da Anthropic" e a tela mostrava um campo cheio de bolinhas.
 *
 * Os testes esperam pelo `data-estado` da regiao de status, nao pelo texto: os cinco
 * estados sao frases em portugues que compartilham radical ("salva", "nao salva",
 * "Salvar"), e casar por regex faria um teste passar no estado errado — o de "alteracao
 * nao salva" satisfaz /salva/i tanto quanto o de "chave salva". O texto continua sendo
 * verificado, mas so depois de o estado certo chegar.
 *
 * Estes testes so existem num browser de verdade: dependem de localStorage, de eventos
 * de foco e da regiao aria-live.
 */

let servidor; let base; let browser;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-config-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({
    fila,
    chaves: chaves.criarGerenciador(con),
    conversas: conversas.criarRepositorio(con),
    exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

/** Abre a pagina em tela larga (a lateral e coluna fixa) com o localStorage controlado. */
async function abrirConfig(chaveInicial = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((k) => {
    localStorage.removeItem('jur.chaveLlm');
    if (k) localStorage.setItem('jur.chaveLlm', k);
  }, chaveInicial);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('#abrir-config');
  await page.waitForSelector('#status-chave-llm');
  return page;
}

const CAMPO = '#painel-config input[type="password"]';
const guardado = (page) => page.evaluate(() => localStorage.getItem('jur.chaveLlm'));
const status = (page) => page.textContent('#status-chave-llm');
const esperarEstado = (page, estado) => page.waitForFunction(
  (e) => document.querySelector('#status-chave-llm').dataset.estado === e, estado,
);

describe('painel de configuracoes — salvar a chave da LLM da um retorno', () => {
  it('sem chave guardada, o painel ja diz que nao ha chave', async () => {
    const page = await abrirConfig();
    try {
      assert.strictEqual(
        await page.getAttribute('#status-chave-llm', 'data-estado'), 'vazio',
        'abrir o painel sem chave precisa dizer isso — um campo de senha vazio nao diz nada',
      );
      assert.match(await status(page), /nenhuma chave/i);
    } finally {
      await page.close();
    }
  });

  it('digitar sem salvar avisa que a alteracao esta pendente', async () => {
    const page = await abrirConfig();
    try {
      await page.fill(CAMPO, 'sk-ant-aindanaosalva');
      await esperarEstado(page, 'pendente');
      assert.strictEqual(await guardado(page), null,
        'digitar nao pode gravar sozinho — o aviso existe justamente porque falta salvar');
    } finally {
      await page.close();
    }
  });

  it('o botao Salvar grava e confirma na tela', async () => {
    const page = await abrirConfig();
    try {
      await page.fill(CAMPO, 'sk-ant-abcdefgh4f2a');
      await page.click('#salvar-chave-llm');
      await esperarEstado(page, 'salvo');
      assert.strictEqual(await guardado(page), 'sk-ant-abcdefgh4f2a');
      assert.match(await status(page), /salva/i);
    } finally {
      await page.close();
    }
  });

  it('Enter no campo salva igual ao botao', async () => {
    const page = await abrirConfig();
    try {
      await page.fill(CAMPO, 'sk-ant-porenter1234');
      await page.press(CAMPO, 'Enter');
      await esperarEstado(page, 'salvo');
      assert.strictEqual(await guardado(page), 'sk-ant-porenter1234');
    } finally {
      await page.close();
    }
  });

  it('sair do campo (blur) tambem salva — nao regride quem ja usava assim', async () => {
    const page = await abrirConfig();
    try {
      await page.fill(CAMPO, 'sk-ant-porblur12345');
      await page.click('#painel-config h2');
      await esperarEstado(page, 'salvo');
      assert.strictEqual(await guardado(page), 'sk-ant-porblur12345');
    } finally {
      await page.close();
    }
  });

  it('chave fora do formato e SALVA, com aviso — nao bloqueia', async () => {
    const page = await abrirConfig();
    try {
      await page.fill(CAMPO, 'chave-esquisita');
      await page.click('#salvar-chave-llm');
      await esperarEstado(page, 'formato');
      assert.strictEqual(await guardado(page), 'chave-esquisita',
        'recusar um formato inesperado quebraria uma chave valida futura — avisa, nao bloqueia');
      assert.match(await status(page), /sk-ant-/,
        'o aviso precisa dizer QUAL e o formato esperado');
    } finally {
      await page.close();
    }
  });

  it('salvar vazio apaga a chave e diz que apagou', async () => {
    const page = await abrirConfig('sk-ant-jaexistia123');
    try {
      await page.fill(CAMPO, '');
      await page.click('#salvar-chave-llm');
      await esperarEstado(page, 'removido');
      assert.strictEqual(await guardado(page), '');
      assert.match(await status(page), /removida/i);
    } finally {
      await page.close();
    }
  });

  it('reabrir o painel mostra a chave mascarada, nunca o valor inteiro', async () => {
    const page = await abrirConfig('sk-ant-api03-segredointeiro4f2a');
    try {
      assert.strictEqual(await page.getAttribute('#status-chave-llm', 'data-estado'), 'salvo');
      const texto = await status(page);
      assert.match(texto, /sk-ant-/, 'precisa confirmar QUE ha uma chave salva');
      assert.match(texto, /4f2a/, 'o sufixo permite conferir qual chave e');
      assert.ok(
        !texto.includes('segredointeiro'),
        'o miolo da chave nao pode aparecer em texto claro na tela',
      );
    } finally {
      await page.close();
    }
  });

  it('a regiao de status e anunciada por leitor de tela', async () => {
    const page = await abrirConfig();
    try {
      assert.strictEqual(
        await page.getAttribute('#status-chave-llm', 'role'), 'status',
        'sem role=status a confirmacao e invisivel para quem nao ve a tela',
      );
    } finally {
      await page.close();
    }
  });
});
