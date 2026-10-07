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
const { gerarChaveBrowser, injetarChave } = require('./chave-conexao');

/**
 * O painel de disponibilidade era uma grade de siglas minusculas e nada mais: dava para
 * ver o estado do tribunal (pela barra colorida a esquerda) e abrir a ressalva, so.
 *
 * Agora ele tambem e o lugar onde o usuario escolhe ONDE buscar. A bolinha a direita de
 * cada sigla e o liga/desliga, e a selecao vai no corpo do POST /api/v1/chat — o modelo
 * recebe o catalogo ja recortado e nao gasta uma rodada chamando listar_tribunais.
 *
 * As duas coisas nao se confundem, e e isso que a maioria destes testes guarda:
 *   barra a ESQUERDA  = estado REAL do tribunal (o servidor decide)
 *   bolinha a DIREITA = ligado/desligado (o usuario decide)
 */

let servidor; let base; let browser; let chaveBrowser;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-disp-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  const gerenciador = chaves.criarGerenciador(con);
  chaveBrowser = gerarChaveBrowser(gerenciador);
  servidor = http.createServer(criarApp({
    fila, chaves: gerenciador, conversas: conversas.criarRepositorio(con), exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

const CHAVE = 'jur.tribunaisSelecionados.["fixture","fixture","test"]';

async function abrir(selecionados = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await injetarChave(page, chaveBrowser);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ chave, s }) => {
    localStorage.removeItem(chave);
    if (s) localStorage.setItem(chave, JSON.stringify(s));
  }, { chave: CHAVE, s: selecionados });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chip-tribunal');
  return page;
}
const guardado = (page) => page.evaluate((c) => localStorage.getItem(c), CHAVE);
const escopoNoPost = async (page, seletorCaixa = '#caixa-inicial') => {
  let corpo = null;
  await page.route('**/api/v1/chat', (rota) => { corpo = JSON.parse(rota.request().postData()); rota.abort(); });
  await page.fill(`${seletorCaixa} .entrada`, 'oi');
  await page.click(`${seletorCaixa} .enviar`);
  for (let i = 0; i < 100 && !corpo; i++) await page.waitForTimeout(50);
  return corpo;
};
const chip = (comando) => `.chip-tribunal[data-comando="${comando}"]`;

describe('disponibilidade — leitura', () => {
  // A maiuscula e do CSS, nao do DOM. Passar o texto para maiusculo no JS levaria o
  // valor junto — e "TJPR" nao casa com nenhum comando do servidor. Por isso o teste
  // olha o estilo COMPUTADO e, em seguida, exige que o dado tenha ficado minusculo.
  it('as siglas aparecem em MAIUSCULAS sem que o dado mude', async () => {
    const page = await abrir();
    try {
      const transformacao = await page.$eval(`${chip('tjpr')} .sigla`,
        (el) => getComputedStyle(el).textTransform);
      assert.strictEqual(transformacao, 'uppercase');
      assert.strictEqual((await page.textContent(`${chip('tjpr')} .sigla`)).trim(), 'tjpr');
      assert.strictEqual(await page.getAttribute(chip('tjpr'), 'data-comando'), 'tjpr');
    } finally { await page.close(); }
  });

  it('a barra da esquerda continua mostrando o estado REAL do tribunal', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await page.getAttribute(chip('tjpr'), 'data-e'), 'ok');
      assert.strictEqual(await page.getAttribute(chip('tjsp'), 'data-e'), 'instavel');
      assert.strictEqual(await page.getAttribute(chip('stj'), 'data-e'), 'sem-acesso');
    } finally { await page.close(); }
  });

  it('clicar na sigla abre a ressalva; isso nao pode virar o liga/desliga', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .sigla`);
      await page.waitForSelector('#painel-ressalva:not([hidden])');
      assert.match(await page.textContent('#painel-ressalva'), /Paran/);
      assert.strictEqual(await page.getAttribute(`${chip('tjpr')} .liga`, 'aria-pressed'), 'true',
        'abrir os detalhes nao pode desligar o tribunal sem querer');
    } finally { await page.close(); }
  });
});

describe('disponibilidade — filtros', () => {
  const visiveis = (page) => page.$$eval('.chip-tribunal:not([hidden])', (els) => els.map((e) => e.dataset.comando));

  it('filtrar por area mostra so os tribunais daquele segmento', async () => {
    const page = await abrir();
    try {
      await page.click('.filtro-area[data-valor="trabalhista"]');
      const lista = await visiveis(page);
      // O TST NAO entra aqui: o catalogo o classifica como `superior`, junto com STF e
      // STJ. Quem filtra por "Justica do Trabalho" ve os TRTs.
      assert.ok(lista.includes('trt9'), `esperava trt9 em ${JSON.stringify(lista)}`);
      assert.ok(!lista.includes('tjpr'), 'tjpr e estadual, nao pode aparecer no filtro trabalhista');
      assert.ok(!lista.includes('tst'), 'tst e superior no catalogo, nao trabalhista');
    } finally { await page.close(); }
  });

  it('filtrar por UF mostra so os tribunais daquele estado', async () => {
    const page = await abrir();
    try {
      await page.click('.filtro-uf[data-valor="PR"]');
      const lista = await visiveis(page);
      assert.ok(lista.includes('tjpr'));
      assert.ok(!lista.includes('tjsc'), 'tjsc e de SC');
    } finally { await page.close(); }
  });

  it('area e UF se combinam por E; dois valores da mesma dimensao por OU', async () => {
    const page = await abrir();
    try {
      await page.click('.filtro-uf[data-valor="PR"]');
      await page.click('.filtro-area[data-valor="estadual"]');
      const lista = await visiveis(page);
      assert.ok(lista.includes('tjpr'));
      assert.ok(!lista.includes('trt9'), 'trt9 e do PR mas e trabalhista — o E precisa cortar');

      await page.click('.filtro-uf[data-valor="SC"]');
      const comSC = await visiveis(page);
      assert.ok(comSC.includes('tjpr') && comSC.includes('tjsc'), 'duas UFs somam, nao intersectam');
    } finally { await page.close(); }
  });

  // O botao que expande as UFs estava DENTRO do contentor colapsado, entao ele sumia
  // junto com o que deveria revelar: a unica saida do estado colapsado ficava invisivel.
  it('a lista de UFs comeca colapsada e o botao que expande fica VISIVEL', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await page.isVisible('.chip-filtro.mais'), true,
        'sem este botao visivel, as UFs escondidas sao inalcancaveis');

      // `checkVisibility()` nao serve aqui: elemento recortado por `overflow: hidden`
      // continua "visivel" para ele. O que denuncia o recorte e scrollHeight > clientHeight.
      const recortado = (p) => p.$eval('.chips-uf', (el) => el.scrollHeight > el.clientHeight + 1);
      assert.strictEqual(await recortado(page), true, 'a lista de UFs deveria comecar colapsada');

      await page.click('.chip-filtro.mais');
      assert.strictEqual(await recortado(page), false, 'expandir precisa revelar as UFs escondidas');
      assert.strictEqual(await page.getAttribute('.chip-filtro.mais', 'aria-expanded'), 'true');

      // E o caminho de volta existe.
      await page.click('.chip-filtro.mais');
      assert.strictEqual(await recortado(page), true);
    } finally { await page.close(); }
  });

  it('da para limpar os filtros e voltar a lista inteira', async () => {
    const page = await abrir();
    try {
      const todos = (await visiveis(page)).length;
      await page.click('.filtro-area[data-valor="trabalhista"]');
      assert.ok((await visiveis(page)).length < todos);
      await page.click('#limpar-filtros');
      assert.strictEqual((await visiveis(page)).length, todos);
    } finally { await page.close(); }
  });

  it('filtrar nao desliga ninguem — sao coisas diferentes', async () => {
    const page = await abrir();
    try {
      await page.click('.filtro-area[data-valor="trabalhista"]');
      await page.click('#limpar-filtros');
      assert.strictEqual(await page.getAttribute(`${chip('tjpr')} .liga`, 'aria-pressed'), 'true',
        'esconder da tela nao pode tirar o tribunal do escopo da busca');
    } finally { await page.close(); }
  });
});

describe('escopo — selecao', () => {
  it('comeca em "todos os disponiveis" e o POST leva todos os disponiveis, nunca undefined', async () => {
    const page = await abrir();
    try {
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /Todos os dispon/);
      const corpo = await escopoNoPost(page);
      assert.ok(Array.isArray(corpo.tribunais) && corpo.tribunais.length > 50);
      assert.ok(corpo.tribunais.includes('stf') && corpo.tribunais.includes('tjsp'));
      assert.ok(!corpo.tribunais.includes('stj'), 'indisponivel nao entra');
    } finally { await page.close(); }
  });

  it('selecionar um tribunal manda SO ele, e a selecao sobrevive ao F5', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .sel`);
      assert.strictEqual(await page.getAttribute(`${chip('tjpr')} .sel`, 'aria-pressed'), 'true');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /tjpr/i);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.chip-tribunal');
      const corpo = await escopoNoPost(page);
      assert.deepStrictEqual(corpo.tribunais, ['tjpr']);
    } finally { await page.close(); }
  });

  it('mais cliques somam; clicar de novo tira; o x da barra tambem tira', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .sel`);
      await page.click(`${chip('stf')} .sel`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr', 'stf']);
      await page.click(`${chip('stf')} .sel`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
      await page.click('#caixa-inicial .barra-escopo .pill[data-comando="tjpr"] .tirar');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), []);
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /Todos os dispon/);
    } finally { await page.close(); }
  });

  it('"Todos os disponiveis" limpa a selecao', async () => {
    const page = await abrir(['tjpr', 'stf']);
    try {
      await page.click('#caixa-inicial .barra-escopo .escopo-todos');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), []);
    } finally { await page.close(); }
  });

  it('a chave legada de desligados e apagada no carregamento', async () => {
    const page = await abrir();
    try {
      await page.evaluate(() => localStorage.setItem('jur.tribunaisDesligados.["fixture","fixture","test"]', '["tjpr"]'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.chip-tribunal');
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('jur.tribunaisDesligados.["fixture","fixture","test"]')), null);
    } finally { await page.close(); }
  });

  it('o popover "+ adicionar" da barra seleciona por busca de sigla', async () => {
    const page = await abrir(['tjpr']);
    try {
      await page.click('#caixa-inicial .barra-escopo .escopo-adicionar');
      await page.fill('#caixa-inicial .barra-escopo .escopo-busca', 'trf4');
      await page.click('#caixa-inicial .barra-escopo .escopo-opcao[data-comando="trf4"]');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr', 'trf4']);
    } finally { await page.close(); }
  });

  it('remontar a barra nao acumula ouvintes: so a barra viva redesenha', async () => {
    const page = await abrir();
    try {
      // Conta os redesenhos de chips causados por UM jur:escopo depois de 1 montagem e depois de 5
      // no mesmo contentor: com vazamento a segunda contagem seria ~5x a primeira.
      const { uma, cinco } = await page.evaluate(() => {
        const c = document.querySelector('#caixa-inicial .barra-escopo');
        // Barras antigas desenham nos proprios chips (ja soltos do DOM), entao um
        // MutationObserver no chip vivo nao as veria: conta as chamadas de redesenho.
        const medir = () => {
          let n = 0;
          const orig = Element.prototype.replaceChildren;
          Element.prototype.replaceChildren = function (...a) {
            if (this.classList.contains('escopo-chips')) n++;
            return orig.apply(this, a);
          };
          document.dispatchEvent(new Event('jur:escopo'));
          Element.prototype.replaceChildren = orig;
          return n;
        };
        window.jurEscopo.montarBarra(c);
        const uma = medir();
        for (let i = 0; i < 5; i++) window.jurEscopo.montarBarra(c);
        return { uma, cinco: medir() };
      });
      assert.ok(uma > 0, 'a barra viva redesenha');
      assert.strictEqual(cinco, uma);
    } finally { await page.close(); }
  });
});
