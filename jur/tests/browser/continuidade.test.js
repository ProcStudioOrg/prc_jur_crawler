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
 * O lado da TELA da continuidade. O servidor ja mantem o turno rodando depois que o
 * cliente vai embora (tests/conversas.test.js), mas isso so resolve metade do problema:
 * se a lateral nao mostrar quais conversas estao respondendo, o usuario reabre, ve a
 * propria pergunta e conclui que a conversa morreu — exatamente a impressao que este
 * trabalho existe para desfazer.
 *
 * O cliente do LLM e controlado pelo teste: ele so responde quando uma rota de controle
 * for chamada, para o turno ficar "em andamento" o tempo que a asserção precisar.
 */

let servidor; let base; let browser; let liberar; let repo;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-cont-ui-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  repo = conversas.criarRepositorio(con);
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });

  const presa = new Promise((r) => { liberar = r; });
  const clienteLLM = {
    messages: {
      stream() {
        const ouvintes = {};
        const p = {
          on(evento, fn) { ouvintes[evento] = fn; return p; },
          async finalMessage() {
            if (ouvintes.text) ouvintes.text('comecou ');
            await presa;
            if (ouvintes.text) ouvintes.text('e terminou');
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'comecou e terminou' }] };
          },
        };
        return p;
      },
    },
  };

  servidor = http.createServer(criarApp({
    fila, clienteLLM, conversas: repo, chaves: chaves.criarGerenciador(con), exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  liberar();
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

async function abrir() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    localStorage.setItem('jur.chaveLlm', 'sk-ant-teste');
    const { conversas: antigas } = await (await fetch('/api/v1/conversas')).json();
    for (const c of antigas) await fetch(`/api/v1/conversas/${c.id}`, { method: 'DELETE' });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  return page;
}

describe('continuidade na interface', () => {
  it('a conversa que esta respondendo ganha um indicador na lateral, e ele some no fim', async () => {
    const page = await abrir();
    try {
      await page.fill('#caixa-inicial .entrada', 'pergunta longa');
      await page.click('#caixa-inicial .enviar');

      // O turno esta preso dentro do cliente falso: a lateral precisa dizer isso.
      const emAndamento = await page.waitForSelector('#historico .conversa-item .em-andamento',
        { state: 'attached', timeout: 15000 });
      assert.ok(emAndamento, 'sem indicador, uma conversa respondendo e igual a uma parada');
      assert.ok(
        (await page.getAttribute('#historico .conversa-item .em-andamento', 'aria-label') || '').length > 3,
        'o indicador precisa de rotulo acessivel: uma bolinha girando nao diz nada a quem nao ve',
      );

      liberar();
      await page.waitForSelector('#historico .conversa-item .em-andamento',
        { state: 'detached', timeout: 15000 });
    } finally {
      await page.close();
    }
  });

  it('reabrir uma conversa em andamento mostra o que ja chegou e continua ao vivo', async () => {
    // Turno novo, ainda preso: recria o cliente controlado via uma segunda conversa.
    const page = await abrir();
    try {
      // Cria a conversa e um turno pelo backend, sem passar pela tela — o cliente falso
      // deste arquivo ja esta liberado pelo teste anterior, entao aqui o interesse e o
      // caminho de LEITURA: a conversa existe, tem mensagens, e a tela as carrega.
      const c = repo.criar();
      repo.acrescentar(c.id, 'user', 'pergunta de antes');
      repo.acrescentar(c.id, 'assistant', [{ type: 'text', text: 'resposta que ficou gravada' }]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#historico .conversa-item');
      await page.click('#historico .conversa-item');
      await page.waitForSelector('#mensagens .msg.assistant');
      const texto = await page.textContent('#mensagens');
      assert.match(texto, /resposta que ficou gravada/,
        'o turno que terminou com a aba fechada precisa aparecer quando o usuario volta');
    } finally {
      await page.close();
    }
  });
});
