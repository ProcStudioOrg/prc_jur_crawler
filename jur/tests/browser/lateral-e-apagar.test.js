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
 * Dois achados da revisao final de branch, os dois sobre acesso que so existia numa
 * condicao que nem todo usuario tem:
 *
 *   I4 — abaixo de 860px o `estilo.css` fazia `#lateral { display: none }` sem substituto
 *        nenhum. Sumiam Nova conversa, o historico e **Configuracoes**, o unico lugar da
 *        interface onde se digita a chave da Anthropic. O chat responde "informe na
 *        interface" e nao havia caminho na tela para obedecer.
 *
 *   I5 — o "x" de apagar conversa era `opacity: 0` + `:hover`. Em touch nunca aparecia, e
 *        como `opacity: 0` nao tira o elemento da ordem de tabulacao, quem usa teclado
 *        focava um botao invisivel. E a mesma classe de defeito que este projeto ja
 *        reprovou uma vez na ressalva do tribunal, e que o spec §2.3 proibe.
 *
 * Os dois so aparecem num browser de verdade: dependem de media query e de `opacity`
 * computada, coisas que nao existem num teste HTTP.
 */

let servidor; let base; let browser;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-lateral-'));
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

/**
 * Abre a pagina numa viewport dada com EXATAMENTE uma conversa no historico (o servidor
 * e o mesmo para todos os testes deste arquivo, entao limpamos antes de criar).
 * Espera por 'attached', nao por 'visible': em tela estreita a gaveta comeca recolhida,
 * que e justamente o estado que os testes de I4 querem observar.
 */
async function abrirPagina(width, height = 844) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const { conversas: antigas } = await (await fetch('/api/v1/conversas')).json();
    for (const c of antigas) await fetch(`/api/v1/conversas/${c.id}`, { method: 'DELETE' });
    await fetch('/api/v1/conversas', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#historico .conversa-item', { state: 'attached' });
  return page;
}

describe('I4 — em tela estreita ainda ha caminho ate Configuracoes (a chave da LLM)', () => {
  for (const largura of [390, 800]) {
    it(`${largura}px: o botao abre a lateral e a chave da Anthropic fica alcancavel`, async () => {
      const page = await abrirPagina(largura);
      try {
        // A lateral comeca fora da tela — isso e o desenho, nao o defeito.
        assert.strictEqual(
          await page.isVisible('#lateral'), false,
          `em ${largura}px a lateral comeca recolhida`,
        );
        // ...mas precisa existir um caminho de volta.
        assert.strictEqual(
          await page.isVisible('#abrir-lateral'), true,
          `em ${largura}px sem este botao o usuario perde Configuracoes, e com ela a chave da LLM`,
        );
        assert.strictEqual(await page.getAttribute('#abrir-lateral', 'aria-expanded'), 'false');

        await page.click('#abrir-lateral');
        await page.waitForSelector('#lateral', { state: 'visible' });
        assert.strictEqual(await page.getAttribute('#abrir-lateral', 'aria-expanded'), 'true');
        assert.strictEqual(await page.isVisible('#nova-conversa'), true, 'Nova conversa tambem volta');
        assert.strictEqual(await page.isVisible('#historico .conversa-item'), true, 'o historico tambem volta');
        assert.strictEqual(await page.isVisible('#abrir-config'), true);

        // O que fecha o achado: chegar ao campo da chave da Anthropic.
        await page.click('#abrir-config');
        await page.waitForSelector('#painel-config .painel-caixa', { state: 'visible' });
        const campoChave = await page.$('#painel-config input[type="password"]');
        assert.ok(campoChave, 'o painel precisa trazer o campo da chave da LLM');
        assert.strictEqual(await campoChave.isVisible(), true, 'o campo da chave precisa estar visivel');
        await campoChave.fill('sk-ant-teste');
        assert.strictEqual(await campoChave.inputValue(), 'sk-ant-teste',
          'o usuario precisa conseguir DIGITAR a chave, nao so ver o campo');
      } finally {
        await page.close();
      }
    });
  }

  it('Escape fecha a gaveta e devolve o foco ao botao', async () => {
    const page = await abrirPagina(390);
    try {
      await page.click('#abrir-lateral');
      await page.waitForSelector('#lateral', { state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#lateral', { state: 'hidden' });
      assert.strictEqual(await page.getAttribute('#abrir-lateral', 'aria-expanded'), 'false');
      assert.strictEqual(
        await page.evaluate(() => document.activeElement.id), 'abrir-lateral',
        'fechar por teclado nao pode largar o foco no vazio',
      );
    } finally {
      await page.close();
    }
  });

  it('em tela larga nada muda: a lateral e coluna fixa e o botao nem aparece', async () => {
    const page = await abrirPagina(1280, 900);
    try {
      assert.strictEqual(await page.isVisible('#lateral'), true);
      assert.strictEqual(await page.isVisible('#abrir-lateral'), false);
      assert.strictEqual(await page.isVisible('#abrir-config'), true);
    } finally {
      await page.close();
    }
  });
});

describe('I5 — apagar conversa nao depende de hover', () => {
  it('o "x" ja esta visivel sem nenhum hover, e apagar funciona so com clique', async () => {
    const page = await abrirPagina(1280, 900);
    try {
      const apagar = await page.$('#historico .apagar');
      assert.ok(apagar, 'o botao de apagar precisa existir na lista');

      // Nenhum mouse encostou no item ate aqui.
      const opacidade = await apagar.evaluate((el) => getComputedStyle(el).opacity);
      assert.ok(Number(opacidade) > 0.4,
        `sem hover o "x" precisa estar visivel; opacidade computada: ${opacidade}`);
      assert.strictEqual(await apagar.isVisible(), true);
      assert.ok(await apagar.getAttribute('aria-label'), 'o "x" precisa de rotulo acessivel');

      await apagar.click();
      await page.waitForSelector('#historico .vazio');
      const { conversas: lista } = await page.evaluate(() => fetch('/api/v1/conversas').then((r) => r.json()));
      assert.strictEqual(lista.length, 0, 'o clique precisa ter apagado a conversa de verdade');
    } finally {
      await page.close();
    }
  });

  it('o foco por teclado chega a um botao VISIVEL (opacity 0 mantinha ele na tabulacao)', async () => {
    const page = await abrirPagina(1280, 900);
    try {
      // Tabula a partir do topo do documento ate cair no "x". Isto e o caminho real de
      // quem usa teclado — e era exatamente ele que terminava num elemento invisivel.
      await page.evaluate(() => document.body.focus());
      let achou = false;
      for (let i = 0; i < 20 && !achou; i++) {
        await page.keyboard.press('Tab');
        achou = await page.evaluate(() => !!document.activeElement
          && document.activeElement.classList.contains('apagar'));
      }
      assert.ok(achou, 'o botao de apagar precisa continuar alcancavel por teclado');

      const estado = await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        return { opacidade: s.opacity, contorno: s.outlineStyle, larguraContorno: s.outlineWidth };
      });
      assert.strictEqual(estado.opacidade, '1',
        `focado por teclado o "x" precisa estar em cheio; veio ${estado.opacidade}`);
      assert.notStrictEqual(estado.contorno, 'none', 'o foco precisa ter contorno visivel');
      assert.ok(parseFloat(estado.larguraContorno) > 0, 'contorno de largura zero nao e contorno');
    } finally {
      await page.close();
    }
  });

  it('em tela sem hover (touch) o "x" fica em cheio', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        const { conversas: antigas } = await (await fetch('/api/v1/conversas')).json();
        for (const c of antigas) await fetch(`/api/v1/conversas/${c.id}`, { method: 'DELETE' });
        await fetch('/api/v1/conversas', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        });
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.click('#abrir-lateral');
      await page.waitForSelector('#historico .apagar', { state: 'visible' });
      const opacidade = await page.$eval('#historico .apagar', (el) => getComputedStyle(el).opacity);
      assert.strictEqual(opacidade, '1',
        `em @media (hover: none) o "x" nao pode depender de hover; veio ${opacidade}`);
    } finally {
      await page.close();
    }
  });
});
