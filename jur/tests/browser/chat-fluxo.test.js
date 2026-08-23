const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { chromium } = require('playwright');
const db = require('../../servidor/db');
const jobs = require('../../servidor/jobs');
const chaves = require('../../servidor/chaves');
const conversas = require('../../servidor/conversas');
const { criarApp } = require('../../servidor/index');

/**
 * Regressao dos tres achados da revisao da Task 7 (dois Critical + um Important),
 * todos reproduzidos "ao vivo" num Chromium real contra `app.js` de verdade — os
 * bugs vivem em cima de timing de eventos do browser (dois Enter na mesma janela de
 * corrida, um streaming que continua depois que o usuario troca de tela) que um
 * teste HTTP direto no servidor nao teria como flagrar.
 *
 * Cliente falso com a mesma forma do SDK usada em tests/chat.test.js, com dois
 * acrescimos: registra os `params` de cada chamada (para inspecionar se
 * `output_config` foi mandado) e aceita um `delayMs` por resposta, para simular uma
 * resposta lenta e conseguir trocar de conversa NO MEIO do streaming.
 */
function clienteFalso(script) {
  let i = 0;
  const chamadas = [];
  return {
    chamadas,
    messages: {
      stream(params) {
        const idx = i++;
        chamadas.push(params);
        const config = script[idx] || { texto: '', stopReason: 'end_turn' };
        const ouvintes = {};
        const p = {
          on(evento, fn) { ouvintes[evento] = fn; return p; },
          async finalMessage() {
            if (config.delayMs) await new Promise((r) => setTimeout(r, config.delayMs));
            if (config.texto && ouvintes.text) ouvintes.text(config.texto);
            return {
              stop_reason: config.stopReason || 'end_turn',
              content: [{ type: 'text', text: config.texto || '' }],
            };
          },
        };
        return p;
      },
    },
  };
}

async function subirServidor({ clienteLLM } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chat-fluxo-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con,
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  const gerenciadorChaves = chaves.criarGerenciador(con);
  const repositorioConversas = conversas.criarRepositorio(con);
  const servidor = http.createServer(
    criarApp({
      fila, chaves: gerenciadorChaves, conversas: repositorioConversas, clienteLLM, exigirChave: true,
    }).handler,
  );
  await new Promise((r) => servidor.listen(0, r));
  const porta = servidor.address().port;
  return { servidor, base: `http://127.0.0.1:${porta}` };
}

const esperarRespostaCompleta = (page, timeout = 15000) => page.waitForFunction(() => {
  const b = document.querySelector('#caixa-conversa .enviar');
  return b && !b.disabled;
}, { timeout });

describe('chat: regressao da revisao da Task 7', () => {
  it('Critical 1 — escolher Haiku 4.5 nao manda esforco no corpo, e o chat continua funcionando', async () => {
    const cliente = clienteFalso([
      { texto: 'resposta com opus (default)', stopReason: 'end_turn' },
      { texto: 'resposta com haiku', stopReason: 'end_turn' },
    ]);
    const { servidor, base } = await subirServidor({ clienteLLM: cliente });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.fill('#caixa-inicial .entrada', 'pergunta com o modelo padrao');
      await page.click('#caixa-inicial .enviar');
      await esperarRespostaCompleta(page);

      assert.strictEqual(cliente.chamadas.length, 1);
      assert.deepStrictEqual(
        cliente.chamadas[0].output_config, { effort: 'high' },
        'com o modelo padrao (opus, aceita esforco) o corpo devia levar output_config',
      );

      // troca para Haiku, na MESMA conversa, e envia de novo — este e o caminho que
      // quebrava antes: o <select> escondido continuava sendo lido por `enviar`.
      await page.selectOption('#caixa-conversa .modelo', 'claude-haiku-4-5');
      await page.fill('#caixa-conversa .entrada', 'pergunta com haiku');
      await page.click('#caixa-conversa .enviar');
      await esperarRespostaCompleta(page);

      assert.strictEqual(cliente.chamadas.length, 2);
      assert.strictEqual(
        cliente.chamadas[1].output_config, undefined,
        'haiku rejeita output_config na API — o corpo nao pode leva-lo',
      );

      const erros = await page.$$eval('#mensagens .msg.erro', (els) => els.map((e) => e.textContent));
      assert.deepStrictEqual(erros, [], `nenhuma bolha de erro esperada, veio: ${JSON.stringify(erros)}`);

      const textoMensagens = await page.$eval('#mensagens', (el) => el.textContent);
      assert.match(textoMensagens, /resposta com haiku/, 'a resposta do turno com haiku precisa aparecer na tela');
    } finally {
      await page.close();
      await browser.close();
      await new Promise((r) => servidor.close(r));
    }
  });

  it('Critical 2 — trocar de conversa no meio do streaming nao vaza texto nem historico para a conversa errada', async () => {
    const cliente = clienteFalso([
      { texto: 'RESPOSTA-DE-Y', stopReason: 'end_turn' }, // 1a mensagem da conversa Y (rapida)
      { texto: 'RESPOSTA-DE-X-DEMOROU', stopReason: 'end_turn', delayMs: 3000 }, // 1a de X (lenta)
      { texto: 'RESPOSTA-DE-Y-2', stopReason: 'end_turn' }, // 2a mensagem de Y, ja de volta nela
    ]);
    const { servidor, base } = await subirServidor({ clienteLLM: cliente });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const corposChat = [];
    await page.route('**/api/v1/chat', (route) => {
      corposChat.push(JSON.parse(route.request().postData()));
      route.continue();
    });
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle' });

      // 1) cria a conversa Y e espera a resposta (rapida) terminar por completo.
      await page.fill('#caixa-inicial .entrada', 'pergunta Y');
      await page.click('#caixa-inicial .enviar');
      await esperarRespostaCompleta(page);

      // 2) volta pra tela inicial e manda a pergunta que cria a conversa X — esta
      //    demora 3s pra responder (delayMs acima).
      await page.click('#nova-conversa');
      await page.waitForSelector('#caixa-inicial .entrada');
      await page.fill('#caixa-inicial .entrada', 'pergunta X');
      await page.click('#caixa-inicial .enviar');
      await page.waitForSelector('#conversa:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(300); // da tempo do POST /api/v1/chat de X sair do lado do cliente

      // 3) troca pra Y (unico item que a lateral conhece agora) ENQUANTO X ainda esta
      //    streamando em segundo plano.
      await page.click('#historico .conversa-item');
      await page.waitForTimeout(200);
      const mensagensDeYLogoDepois = await page.$eval('#mensagens', (el) => el.textContent);
      assert.doesNotMatch(
        mensagensDeYLogoDepois, /RESPOSTA-DE-X/,
        'a resposta de X nao pode vazar para a tela de Y enquanto X ainda esta streamando',
      );

      // 4) espera o streaming orfao de X terminar (o servidor persiste sozinho, o
      //    cliente so para de repassar pra tela/historico).
      await page.waitForTimeout(3500);
      const mensagensDeYDepoisDeXTerminar = await page.$eval('#mensagens', (el) => el.textContent);
      assert.doesNotMatch(
        mensagensDeYDepoisDeXTerminar, /RESPOSTA-DE-X/,
        'nem depois de X terminar o texto dela pode aparecer na tela de Y',
      );

      // 5) manda uma segunda mensagem em Y e confere que o CORPO mandado ao servidor
      //    (historicoLocal) nao foi contaminado pela resposta orfa de X.
      await page.fill('#caixa-conversa .entrada', 'segunda pergunta em Y');
      await page.click('#caixa-conversa .enviar');
      await esperarRespostaCompleta(page);
      const corpoSegundoEnvioEmY = corposChat[corposChat.length - 1];
      assert.doesNotMatch(
        JSON.stringify(corpoSegundoEnvioEmY.mensagens), /RESPOSTA-DE-X/,
        'o historico local de Y nao pode carregar nada da conversa X',
      );

      // 6) recarrega, abre X pela lateral e confirma que o SERVIDOR persistiu a
      //    resposta de X mesmo com o cliente tendo trocado de tela no meio do streaming.
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#historico .conversa-item', { timeout: 10000 });
      const itens = await page.$$eval('#historico .conversa-item span', (els) => els.map((e) => e.textContent));
      const idxX = itens.findIndex((t) => t.startsWith('pergunta X'));
      assert.ok(idxX >= 0, `conversa X precisa aparecer na lateral apos reload: ${JSON.stringify(itens)}`);
      const itensEls = await page.$$('#historico .conversa-item');
      await itensEls[idxX].click();
      await page.waitForSelector('#conversa:not([hidden])', { timeout: 10000 });
      await page.waitForTimeout(300);
      const mensagensDeXAoReabrir = await page.$eval('#mensagens', (el) => el.textContent);
      assert.match(
        mensagensDeXAoReabrir, /RESPOSTA-DE-X-DEMOROU/,
        'o servidor devia ter persistido a resposta de X mesmo orfa no cliente',
      );
    } finally {
      await page.close();
      await browser.close();
      await new Promise((r) => servidor.close(r));
    }
  });

  it('Important — dois Enter quase simultaneos na tela inicial criam so UMA conversa', async () => {
    const cliente = clienteFalso([{ texto: 'unica resposta', stopReason: 'end_turn' }]);
    const { servidor, base } = await subirServidor({ clienteLLM: cliente });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const postsConversas = [];
    await page.route('**/api/v1/conversas', (route) => {
      if (route.request().method() === 'POST') postsConversas.push(1);
      route.continue();
    });
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.waitForSelector('#caixa-inicial .entrada');

      // Dispara os dois keydown de Enter dentro do MESMO script sincrono do browser,
      // sem nenhum await entre eles — e exatamente a janela de corrida do bug: o
      // segundo `enviar()` comeca a rodar antes do primeiro `await` do primeiro
      // devolver (o POST /api/v1/conversas).
      await page.evaluate(() => {
        const campo = document.querySelector('#caixa-inicial .entrada');
        campo.value = 'pergunta em duplicidade';
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        const criarEnter = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        campo.dispatchEvent(criarEnter());
        campo.dispatchEvent(criarEnter());
      });

      await esperarRespostaCompleta(page);
      await page.waitForTimeout(300);

      assert.strictEqual(postsConversas.length, 1, `esperava 1 POST /api/v1/conversas, teve ${postsConversas.length}`);
      assert.strictEqual(cliente.chamadas.length, 1, `esperava 1 chamada ao LLM, teve ${cliente.chamadas.length}`);

      const { conversas: lista } = await page.evaluate(() => fetch('/api/v1/conversas').then((r) => r.json()));
      assert.strictEqual(lista.length, 1, `esperava 1 conversa no banco, teve ${lista.length}`);
    } finally {
      await page.close();
      await browser.close();
      await new Promise((r) => servidor.close(r));
    }
  });
});
