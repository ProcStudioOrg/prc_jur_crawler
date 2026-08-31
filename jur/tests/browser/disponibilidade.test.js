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

let servidor; let base; let browser;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-disp-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({
    fila, chaves: chaves.criarGerenciador(con), conversas: conversas.criarRepositorio(con), exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

async function abrir(desligados = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((d) => {
    localStorage.removeItem('jur.tribunaisDesligados');
    if (d) localStorage.setItem('jur.tribunaisDesligados', JSON.stringify(d));
  }, desligados);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chip-tribunal');
  return page;
}

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

describe('disponibilidade — liga/desliga', () => {
  const ligado = (page, c) => page.getAttribute(`${chip(c)} .liga`, 'aria-pressed');
  const guardado = (page) => page.evaluate(() => localStorage.getItem('jur.tribunaisDesligados'));

  it('tudo comeca ligado', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await ligado(page, 'tjpr'), 'true');
      assert.strictEqual(await ligado(page, 'stf'), 'true');
    } finally { await page.close(); }
  });

  it('clicar na bolinha desliga, e o estado sobrevive ao F5', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .liga`);
      assert.strictEqual(await ligado(page, 'tjpr'), 'false');
      assert.match(await guardado(page), /tjpr/);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.chip-tribunal');
      assert.strictEqual(await ligado(page, 'tjpr'), 'false');
      assert.strictEqual(await ligado(page, 'stf'), 'true', 'desligar um nao pode desligar os outros');
    } finally { await page.close(); }
  });

  // Guarda o que DESLIGOU, nao o que ligou: assim um tribunal novo numa versao futura
  // nasce ligado. Guardando os ligados, ele nasceria invisivel para quem ja tem a chave
  // no localStorage — um tribunal que existe e ninguem consegue usar, sem sintoma.
  it('o localStorage guarda os DESLIGADOS, nao os ligados', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .liga`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
    } finally { await page.close(); }
  });

  it('tribunal bloqueado nao pode ser ligado, e clicar explica por que', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await ligado(page, 'stj'), 'false',
        'tribunal sem acesso nao esta disponivel para busca — mostra-lo ligado seria mentira');
      await page.click(`${chip('stj')} .liga`);
      await page.waitForSelector('#painel-ressalva:not([hidden])');
      assert.strictEqual(await ligado(page, 'stj'), 'false');
    } finally { await page.close(); }
  });

  it('ha como ligar e desligar tudo de uma vez', async () => {
    const page = await abrir();
    try {
      await page.click('#desligar-todos');
      assert.strictEqual(await ligado(page, 'tjpr'), 'false');
      assert.strictEqual(await ligado(page, 'stf'), 'false');
      await page.click('#ligar-todos');
      assert.strictEqual(await ligado(page, 'tjpr'), 'true');
      assert.strictEqual(await ligado(page, 'stj'), 'false', 'ligar todos nao liga o que esta bloqueado');
    } finally { await page.close(); }
  });

  it('o placar diz quantos estao ligados', async () => {
    const page = await abrir(['tjpr']);
    try {
      assert.match(await page.textContent('#disponibilidade .placar'), /ligad/i);
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

describe('disponibilidade — o escopo chega ao servidor', () => {
  it('o POST /api/v1/chat leva os tribunais ligados', async () => {
    const page = await abrir(['tjpr', 'tjsc']);
    try {
      let corpo = null;
      await page.route('**/api/v1/chat', (rota) => {
        corpo = JSON.parse(rota.request().postData());
        rota.abort();
      });
      await page.fill('#caixa-inicial .entrada', 'oi');
      await page.click('#caixa-inicial .enviar');
      await page.waitForFunction(() => true);
      for (let i = 0; i < 100 && !corpo; i++) await page.waitForTimeout(50);

      assert.ok(corpo, 'o POST precisa sair');
      assert.ok(Array.isArray(corpo.tribunais), 'sem este campo o servidor nao tem como recortar nada');
      assert.ok(!corpo.tribunais.includes('tjpr'), 'tribunal desligado nao pode ir no escopo');
      assert.ok(!corpo.tribunais.includes('tjsc'));
      assert.ok(corpo.tribunais.includes('stf'), 'os ligados precisam ir');
      assert.ok(!corpo.tribunais.includes('stj'),
        'tribunal bloqueado nao entra no escopo: pedi-lo so gastaria uma recusa');
      assert.ok(corpo.tribunais.includes('tjsp'),
        'tribunal instavel continua selecionavel: o estado precisa ser testado na rodada atual');
    } finally { await page.close(); }
  });
});
