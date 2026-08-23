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
 * O painel de decisoes: acesso aos julgados que a conversa de fato leu.
 *
 * Sem ele, os julgados so existiam dentro da resposta do modelo — resumidos, e sem como
 * conferir o que ficou de fora. O painel abre a lista de buscas da conversa e, dentro de
 * cada uma, os julgados como vieram do tribunal.
 *
 * A conversa e os vinculos sao montados direto no banco: o assunto aqui e a LEITURA, e
 * fazer o LLM rodar de verdade so acrescentaria partes moveis a um teste de interface.
 */

let servidor; let base; let browser; let repo; let fila; let jobConcluido; let jobVazio;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-dec-ui-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  repo = conversas.criarRepositorio(con);

  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([
    { processo: '0000627-73.2019.8.16.0080', relator: 'DES. FULANO', dataJulgamento: '17/06/2026', ementa: 'USUCAPIAO ESPECIAL URBANO. Metragem inferior a 250 m2.' },
    { processo: '0043348-93.2013.8.16.0001', relator: 'DES. BELTRANA', dataJulgamento: '02/02/2026', ementa: 'Area acima de 250 m2 inviabiliza a modalidade especial.' },
  ]));
  fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }),
  });

  // Um job concluido com dois julgados e um job concluido com zero.
  jobConcluido = fila.enfileirar('tjpr', { query: 'usucapiao especial' }).id;
  await fila.aguardar(jobConcluido);
  // Busca genuinamente vazia grava um array vazio — e o que a CLI faz com `-o`. Sem
  // arquivo nenhum, o servidor reporta FALHA DE LEITURA, que e outra coisa (e ele esta
  // certo em distinguir: falha de infra nao pode se disfarcar de busca sem resultado).
  const arquivoVazio = path.join(dir, 'vazio.json');
  fs.writeFileSync(arquivoVazio, '[]');
  const filaVazia = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: arquivoVazio, erro: null }),
  });
  jobVazio = filaVazia.enfileirar('stf', { query: 'nada disso' }).id;
  await filaVazia.aguardar(jobVazio);

  servidor = http.createServer(criarApp({
    fila, chaves: chaves.criarGerenciador(con), conversas: repo, exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

// O titulo precisa ser UNICO por teste: o servidor e o mesmo para o arquivo inteiro, e
// a lateral acumula as conversas dos testes anteriores. Sem isto o clique por titulo
// abriria a conversa errada.
let contador = 0;

// `waitForSelector` espera por VISIVEL por padrao, entao um seletor `[hidden]` nunca
// casa — ele esperaria ate o timeout mesmo com o painel fechado corretamente.
const esperarFechado = (page) => page.waitForFunction(
  () => document.querySelector('#decisoes').hidden,
);

/** Cria uma conversa (ja com titulo) com as buscas pedidas e abre a pagina nela. */
async function abrirCom(jobIds) {
  // `criar(titulo)` porque a conversa nasce sem titulo: quem renomeia e o chat.js, a
  // partir da primeira mensagem, e aqui nao ha chat rodando.
  const titulo = `conversa ${++contador}`;
  const c = repo.criar(titulo);
  repo.acrescentar(c.id, 'user', 'usucapiao no tjpr');
  repo.acrescentar(c.id, 'assistant', [{ type: 'text', text: 'analise' }]);
  for (const j of jobIds) repo.vincularBusca(c.id, j);

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#historico .conversa-item');
  await page.click(`#historico .conversa-item:has(span:text-is("${titulo}"))`);
  await page.waitForSelector('#conversa:not([hidden])');
  return { page, id: c.id };
}

describe('painel de decisoes — abrir e fechar', () => {
  it('o botao aparece com a contagem de buscas da conversa', async () => {
    const { page } = await abrirCom([jobConcluido, jobVazio]);
    try {
      await page.waitForSelector('#abrir-decisoes:not([hidden])');
      assert.match(await page.textContent('#abrir-decisoes'), /2/);
    } finally { await page.close(); }
  });

  it('conversa sem busca nenhuma nao mostra o botao', async () => {
    const { page } = await abrirCom([]);
    try {
      await page.waitForTimeout(300);
      assert.strictEqual(await page.isVisible('#abrir-decisoes'), false,
        'um botao que abre um painel vazio so ensina o usuario a ignora-lo');
    } finally { await page.close(); }
  });

  it('abre, lista as buscas e fecha no Escape', async () => {
    const { page } = await abrirCom([jobConcluido, jobVazio]);
    try {
      await page.click('#abrir-decisoes');
      await page.waitForSelector('#decisoes:not([hidden])');
      const linhas = await page.$$eval('.busca-item', (els) => els.map((e) => e.textContent));
      assert.strictEqual(linhas.length, 2);
      assert.ok(linhas.some((l) => /tjpr/i.test(l) && /usucapiao especial/.test(l)),
        `a busca precisa dizer o tribunal E a query: ${JSON.stringify(linhas)}`);

      await page.keyboard.press('Escape');
      await esperarFechado(page);
    } finally { await page.close(); }
  });

  it('fecha tambem no botao de fechar', async () => {
    const { page } = await abrirCom([jobConcluido]);
    try {
      await page.click('#abrir-decisoes');
      await page.waitForSelector('#decisoes:not([hidden])');
      await page.click('#decisoes .fechar');
      await esperarFechado(page);
    } finally { await page.close(); }
  });
});

describe('painel de decisoes — os julgados', () => {
  it('escolher uma busca mostra os julgados com processo, relator e ementa', async () => {
    const { page } = await abrirCom([jobConcluido]);
    try {
      await page.click('#abrir-decisoes');
      await page.waitForSelector('.busca-item');
      await page.click('.busca-item');
      await page.waitForSelector('.julgado');

      const texto = await page.textContent('#decisoes');
      assert.match(texto, /0000627-73\.2019\.8\.16\.0080/);
      assert.match(texto, /DES\. FULANO/);
      assert.match(texto, /USUCAPIAO ESPECIAL URBANO/);
      assert.strictEqual((await page.$$('.julgado')).length, 2);
    } finally { await page.close(); }
  });

  it('busca com ZERO resultados diz que veio zero, e repassa a ressalva do tribunal', async () => {
    const { page } = await abrirCom([jobVazio]);
    try {
      await page.click('#abrir-decisoes');
      await page.waitForSelector('.busca-item');
      await page.click('.busca-item');
      await page.waitForSelector('.decisoes-vazio');
      const texto = await page.textContent('.decisoes-vazio');
      // O invariante do repo, agora tambem nesta tela: zero NAO e "nao existe
      // jurisprudencia". Um painel que so mostrasse "nenhum julgado" seria mais uma
      // superficie afirmando o que o resto do sistema recusa afirmar.
      assert.match(texto, /0 resultado|zero/i);
      assert.match(texto, /nao significa|não significa|acervo/i,
        'o painel nao pode deixar o zero sozinho na tela');
    } finally { await page.close(); }
  });

  it('da para voltar da lista de julgados para a lista de buscas', async () => {
    const { page } = await abrirCom([jobConcluido, jobVazio]);
    try {
      await page.click('#abrir-decisoes');
      await page.click('.busca-item');
      await page.waitForSelector('.julgado');
      await page.click('#decisoes-voltar');
      await page.waitForSelector('.busca-item');
      assert.strictEqual((await page.$$('.busca-item')).length, 2);
    } finally { await page.close(); }
  });
});

describe('painel de decisoes — layout', () => {
  it('em tela larga ele fica ancorado ao lado, sem cobrir a conversa', async () => {
    const { page } = await abrirCom([jobConcluido]);
    try {
      await page.click('#abrir-decisoes');
      await page.waitForSelector('#decisoes:not([hidden])');
      const r = await page.evaluate(() => {
        const painel = document.querySelector('#decisoes').getBoundingClientRect();
        const centro = document.querySelector('#centro').getBoundingClientRect();
        return { painelE: painel.left, centroD: centro.right };
      });
      assert.ok(r.painelE >= r.centroD - 1,
        `ancorado, o painel comeca onde o centro termina (painel ${r.painelE}, centro ${r.centroD})`);
    } finally { await page.close(); }
  });

  it('em tela estreita ele sobrepoe, e ha um fundo para fechar', async () => {
    const { page } = await abrirCom([jobConcluido]);
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.click('#abrir-decisoes');
      await page.waitForSelector('#decisoes:not([hidden])');
      const posicao = await page.$eval('#decisoes', (el) => getComputedStyle(el).position);
      assert.strictEqual(posicao, 'fixed',
        'em tela estreita nao ha espaco para dividir: o painel cobre, como o drawer do ProcStudio');
      // Clica na FAIXA que sobra a esquerda: o fundo cobre a tela inteira, mas o painel
      // fica por cima dele no centro. Sem a posicao explicita, o clique cairia no meio,
      // que e o painel.
      await page.click('#fundo-decisoes', { position: { x: 20, y: 400 } });
      await esperarFechado(page);
    } finally { await page.close(); }
  });
});
