const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { chromium } = require('playwright');
const db = require('../../servidor/db');
const jobs = require('../../servidor/jobs');
const conversasMod = require('../../servidor/conversas');
const { criarConexoes } = require('../../servidor/conexoes-llm');
const { criarApp } = require('../../servidor/index');

/**
 * Saldo compartilhado na interface: a conexão ProcStudio cobra cada rodada do saldo de IA do
 * time. No molde de chat-fluxo.test.js — `app.js` de verdade num Chromium, servidor real com
 * o repositório de conexões real (conexão gerenciada ligada), cobrança falsa (saldo em
 * centavos) e um provedor falso que informa `usage` em cada rodada.
 */
const GERENCIADA = {
  apiKey: 'sk-operador', endpoint: 'https://openrouter.ai/api/v1', modelo: 'z-ai/glm-5.3-flash',
  modeloCatalogo: 'glm-5.3-flash', upstream: 'z-ai', rotulo: 'GLM-5.3 Flash', extras: {},
};
const USO = (entrada, saida) => ({
  input_tokens: entrada, output_tokens: saida, cache_read_tokens: 0, cache_write_tokens: 0,
  cost_usd: 0.001, generation_id: 'gen-1',
});
const ferramenta = (id, usage = USO(500, 20)) => ({
  stop_reason: 'tool_use', usage,
  content: [{ type: 'text', text: 'vou olhar os tribunais' }, { type: 'tool_use', id, name: 'listar_tribunais', input: {} }],
});
const final = (texto, usage = USO(1000, 200)) => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: texto }] });

/** Saldo em centavos; cada rodada custa `precoCents`. podeOperar = saldo > 0, salvo `podeOperar` explícito. */
function cobrancaFalsa({ saldoCents = 1000, precoCents = 4, podeOperar } = {}) {
  const estado = { saldoCents, chamadas: 0 };
  const veredito = () => (estado.saldoCents > 0
    ? { ok: true }
    : { ok: false, motivo: 'saldo', saldoBrl: estado.saldoCents / 100, mensagem: 'msg do Rails', topupPath: '/equipe?tab=billing' });
  return {
    estado,
    async podeOperar() {
      estado.chamadas++;
      return podeOperar ? podeOperar(estado.chamadas, veredito) : veredito();
    },
    async registrar() {
      estado.saldoCents -= precoCents;
      return { cobradoBrl: precoCents / 100, saldoBrl: estado.saldoCents / 100, podeOperar: estado.saldoCents > 0, duplicado: false };
    },
    async saldo() {
      return {
        ativo: true, podeOperar: estado.saldoCents > 0, saldoCents: estado.saldoCents, saldoBrl: estado.saldoCents / 100,
        mensagem: 'Saldo de IA do time.', topupPath: '/equipe?tab=billing',
        modelo: { modelId: 'glm-5.3-flash', nome: 'GLM', entradaPor1MBrl: 1, saidaPor1MBrl: 4 },
      };
    },
    pendentes: () => 0,
    falhaDoOperador: () => Object.assign(new Error('indisponivel'), { code: 'PROCSTUDIO_LLM_INDISPONIVEL' }),
  };
}

function provedorFalso(respostas) {
  let i = 0;
  return {
    messages: {
      stream() {
        const resposta = respostas[i++] || final('sem roteiro');
        const ouvintes = {};
        const p = {
          on(evento, fn) { ouvintes[evento] = fn; return p; },
          async finalMessage() {
            for (const b of resposta.content) if (b.type === 'text' && ouvintes.text) ouvintes.text(b.text);
            return resposta;
          },
        };
        return p;
      },
    },
  };
}

async function subir({ respostas = [final('resposta pronta')], cobranca = cobrancaFalsa(), gerenciada = GERENCIADA } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-saldo-ui-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const conversas = conversasMod.criarRepositorio(con);
  const reais = criarConexoes({
    con, owner: 'dono', cofre: { cifrar: (v) => v, decifrar: (v) => v }, gerenciada,
    transport: async () => { throw new Error('rede proibida neste teste'); },
  });
  const byok = reais.salvar({ provider: 'openai', name: 'Minha OpenAI', model: 'gpt-x', apiKey: 'sk-usuario' });
  const provedor = provedorFalso(respostas);
  const conexoes = { ...reais, cliente: () => provedor };
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  const srv = http.createServer(criarApp({
    fila, conexoes, conversas, frontendUrl: 'https://proc.example', ...(cobranca ? { cobranca } : {}),
  }).handler);
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  // O app de teste não tem login: só o /me é respondido aqui, o resto vai ao servidor real.
  await page.route('**/api/v1/me', (route) => route.fulfill({
    json: { issuer: 'fixture', userId: 'fixture', teamId: 'time', expiresAt: Date.now() + 600000 },
  }));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  return {
    page, base, byok, cobranca, conversas,
    async fechar() {
      await browser.close();
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const esperarRespostaCompleta = (page) => page.waitForFunction(() => {
  const b = document.querySelector('#caixa-conversa .enviar');
  return b && !b.disabled;
});

async function perguntar(page, texto, caixa = '#caixa-inicial') {
  await page.fill(`${caixa} .entrada`, texto);
  await page.click(`${caixa} .enviar`);
}

describe('saldo compartilhado na interface', () => {
  it('pílula com o saldo, linha de custo na resposta e total da conversa', async () => {
    const a = await subir();
    try {
      const { page } = a;
      await page.waitForSelector('#saldo-ia:not([hidden]) > *');
      assert.strictEqual((await page.textContent('#saldo-ia')).trim(), 'Saldo IA · R$ 10,00');
      assert.strictEqual(await page.$eval('#saldo-ia', (e) => e.className), '', 'R$ 10,00 não é saldo baixo');
      const link = await page.$eval('#saldo-ia a', (e) => ({ href: e.href, target: e.target }));
      assert.deepStrictEqual(link, { href: 'https://proc.example/ia-uso', target: '_blank' });

      await perguntar(page, 'quais tribunais?');
      await esperarRespostaCompleta(page);

      await page.waitForFunction(() => document.querySelector('#saldo-ia').textContent.includes('9,96'));
      assert.strictEqual((await page.textContent('#saldo-ia')).trim(), 'Saldo IA · R$ 9,96');
      const linha = await page.textContent('#mensagens .custo-resposta');
      assert.match(linha, /R\$/);
      assert.strictEqual(linha, 'R$ 0,04 · 1,2 mil tokens · GLM-5.3 Flash');
      assert.strictEqual(await page.textContent('#custo-conversa'), 'Esta conversa: R$ 0,04');

      // No celular o botão flutuante do menu (e a pílula) não podem cobrir o total.
      await page.setViewportSize({ width: 400, height: 800 });
      const caixa = (sel) => page.locator(sel).boundingBox();
      const sobrepoe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      // Sem o painel de navegadores (que empurraria a conversa para baixo): é o caso em que o
      // total encosta no topo, debaixo do botão flutuante.
      await page.evaluate(() => { document.querySelector('#navegadores').hidden = true; });
      const total = await caixa('#custo-conversa');
      for (const outro of ['.abrir-lateral', '#saldo-ia > *']) {
        const b = await caixa(outro);
        assert.ok(!sobrepoe(total, b), `${outro} cobre o total em 400px: ${JSON.stringify({ total, b })}`);
      }
      await page.setViewportSize({ width: 1280, height: 720 });

      // Segundo turno: o total soma; reabrir a conversa traz o total do servidor.
      await perguntar(page, 'e o STJ?', '#caixa-conversa');
      await esperarRespostaCompleta(page);
      await page.waitForFunction(() => document.querySelector('#custo-conversa').textContent === 'Esta conversa: R$ 0,08');
      await page.reload({ waitUntil: 'networkidle' });
      await page.click('#historico .conversa-item');
      await page.waitForSelector('#conversa:not([hidden])');
      await page.waitForFunction(() => document.querySelector('#custo-conversa').textContent === 'Esta conversa: R$ 0,08');
    } finally { await a.fechar(); }
  });

  it('sem saldo: cartão de bloqueio com os dois botões, nada gravado, e "Tentar de novo" reenvia quando liberar', async () => {
    const cobranca = cobrancaFalsa({ saldoCents: -52 });
    const a = await subir({ cobranca });
    try {
      const { page } = a;
      await page.waitForSelector('#saldo-ia.saldo-zerado > *');
      assert.strictEqual((await page.textContent('#saldo-ia')).trim(), 'Sem saldo');

      await perguntar(page, 'pergunta sem saldo');
      const cartao = page.locator('.bolha.bloqueio');
      await cartao.waitFor();
      assert.match(await cartao.textContent(), /Seu saldo de IA do ProcStudio acabou \(R\$ −0,52\)/);
      const adicionar = cartao.getByRole('link', { name: 'Adicionar créditos' });
      assert.strictEqual(await adicionar.getAttribute('href'), 'https://proc.example/equipe?tab=billing');
      assert.strictEqual(await adicionar.getAttribute('target'), '_blank');
      const tentar = cartao.getByRole('button', { name: 'Tentar de novo' });
      assert.strictEqual(await tentar.count(), 1);

      const { conversas } = await page.evaluate(() => window.jurApi.pedir('/api/v1/conversas'));
      for (const c of conversas) {
        assert.strictEqual(a.conversas.mensagens(c.id).length, 0, 'nenhuma mensagem pode ser gravada sem saldo');
      }
      assert.strictEqual(await page.inputValue('#caixa-inicial .entrada'), 'pergunta sem saldo', 'o texto volta para a caixa');

      // Ainda sem saldo: o cartão fica e explica.
      await tentar.click();
      await page.waitForFunction(() => document.querySelector('.bloqueio [role="status"]')?.textContent.length > 0);
      assert.strictEqual(await page.locator('.bloqueio').count(), 1);

      // O time recarregou: "Tentar de novo" confere o saldo e reenvia a última mensagem.
      cobranca.estado.saldoCents = 1000;
      await tentar.click();
      await page.waitForSelector('#conversa:not([hidden])');
      await esperarRespostaCompleta(page);
      assert.strictEqual(await page.locator('.bloqueio').count(), 0);
      assert.match(await page.textContent('#mensagens'), /resposta pronta/);
      assert.strictEqual(await page.locator('#mensagens .msg.user').count(), 1, 'a pergunta aparece uma vez só');
      await page.waitForFunction(() => document.querySelector('#saldo-ia').textContent.includes('9,96'));
    } finally { await a.fechar(); }
  });

  it('saldo que acaba no meio do turno mostra o mesmo cartão dentro da conversa', async () => {
    // 1ª checagem (antes do turno) libera; a de antes da rodada já encontra o saldo zerado; a
    // partir daí (o time recarregou) libera de novo, para o "Tentar de novo".
    const cobranca = cobrancaFalsa({
      podeOperar: (n) => (n === 2 ? { ok: false, motivo: 'saldo', saldoBrl: -0.01, topupPath: '/equipe?tab=billing' } : { ok: true }),
    });
    const a = await subir({ cobranca });
    try {
      const { page } = a;
      await perguntar(page, 'pergunta que esbarra no saldo');
      await page.locator('#mensagens .bolha.bloqueio').waitFor();
      await esperarRespostaCompleta(page);
      assert.strictEqual(await page.locator('#mensagens .bloqueio a', { hasText: 'Adicionar créditos' }).count(), 1);
      assert.strictEqual(await page.locator('#mensagens .bloqueio button', { hasText: 'Tentar de novo' }).count(), 1);
      assert.strictEqual(await page.locator('#mensagens .msg.erro').count(), 0, 'é o cartão, não uma bolha de erro comum');

      // "Tentar de novo" reaproveita a pergunta já gravada: nem a tela nem a conversa a repetem.
      const corpos = [];
      await page.route('**/api/v1/chat', (route) => { corpos.push(route.request().postDataJSON()); route.continue(); });
      await page.locator('#mensagens .bloqueio button', { hasText: 'Tentar de novo' }).click();
      await page.waitForFunction(() => /resposta pronta/.test(document.querySelector('#mensagens').textContent));
      await esperarRespostaCompleta(page);
      assert.strictEqual(corpos.length, 1);
      assert.strictEqual(corpos[0].reenvio, true);
      assert.strictEqual(corpos[0].mensagens.filter((m) => m.content === 'pergunta que esbarra no saldo').length, 1);
      assert.strictEqual(await page.locator('#mensagens .msg.user').count(), 1, 'a pergunta aparece uma vez só');
      const id = await page.evaluate(() => window.jurConversa.id);
      const { mensagens } = await page.evaluate((c) => window.jurApi.pedir(`/api/v1/conversas/${c}`), id);
      assert.strictEqual(mensagens.filter((m) => m.conteudo === 'pergunta que esbarra no saldo').length, 1,
        `a conversa grava a pergunta uma vez só: ${JSON.stringify(mensagens)}`);
    } finally { await a.fechar(); }
  });

  it('saldo que acaba depois de uma rodada cobrada: "Tentar de novo" continua do resultado pago, sem repetir a pergunta', async () => {
    // O caso real (cache de saldo de 30 s): checagens 1 = antes do turno, 2 = antes da rodada 1
    // (cobrada), 3 = antes da rodada 2 (sem saldo). Depois o time recarregou e tudo libera.
    const cobranca = cobrancaFalsa({
      podeOperar: (n) => (n === 3 ? { ok: false, motivo: 'saldo', saldoBrl: -0.01, topupPath: '/equipe?tab=billing' } : { ok: true }),
    });
    const a = await subir({ cobranca, respostas: [ferramenta('tu_1'), final('resposta depois do reenvio')] });
    try {
      const { page } = a;
      const pergunta = 'pergunta interrompida depois da 1a rodada';
      await perguntar(page, pergunta);
      await page.locator('#mensagens .bolha.bloqueio').waitFor();
      await esperarRespostaCompleta(page);
      const id = await page.evaluate(() => window.jurConversa.id);
      assert.deepStrictEqual(a.conversas.mensagens(id).map((m) => m.papel), ['user', 'assistant', 'user'],
        'a rodada 1 (tool_use + tool_result) ficou gravada depois da pergunta');

      const corpos = [];
      await page.route('**/api/v1/chat', (route) => { corpos.push(route.request().postDataJSON()); route.continue(); });
      await page.locator('#mensagens .bloqueio button', { hasText: 'Tentar de novo' }).click();
      await page.waitForFunction(() => /resposta depois do reenvio/.test(document.querySelector('#mensagens').textContent));
      await esperarRespostaCompleta(page);

      assert.strictEqual(corpos.length, 1);
      assert.strictEqual(corpos[0].reenvio, true);
      const enviadas = corpos[0].mensagens;
      assert.deepStrictEqual(enviadas.map((m) => m.role), ['user', 'assistant', 'user'], JSON.stringify(enviadas));
      assert.strictEqual(enviadas[2].content[0].type, 'tool_result', 'o reenvio termina no resultado pago');
      assert.strictEqual(enviadas.filter((m) => m.content === pergunta).length, 1);
      assert.strictEqual(await page.locator('#mensagens .msg.erro').count(), 0, 'sem 409 nem bolha de erro');
      assert.strictEqual(await page.locator('.bloqueio').count(), 0);
      assert.strictEqual(await page.locator('#mensagens .msg.user', { hasText: pergunta }).count(), 1, 'a pergunta aparece uma vez só');

      const { mensagens } = await page.evaluate((c) => window.jurApi.pedir(`/api/v1/conversas/${c}`), id);
      assert.deepStrictEqual(mensagens.map((m) => m.papel), ['user', 'assistant', 'user', 'assistant'], JSON.stringify(mensagens));
      assert.strictEqual(mensagens.filter((m) => m.conteudo === pergunta).length, 1, 'a conversa grava a pergunta uma vez só');

      // O turno seguinte leva o histórico inteiro, com a resposta continuada no fim.
      await perguntar(page, 'e agora?', '#caixa-conversa');
      await esperarRespostaCompleta(page);
      assert.deepStrictEqual(corpos[1].mensagens.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    } finally { await a.fechar(); }
  });

  it('conversa que mudou entre o bloqueio e o reenvio: 409 devolve a pergunta à caixa e realinha o histórico', async () => {
    const cobranca = cobrancaFalsa({
      podeOperar: (n) => (n === 3 ? { ok: false, motivo: 'saldo', saldoBrl: -0.01, topupPath: '/equipe?tab=billing' } : { ok: true }),
    });
    const a = await subir({ cobranca, respostas: [ferramenta('tu_1'), final('resposta depois do reenvio')] });
    try {
      const { page } = a;
      const pergunta = 'pergunta interrompida depois da 1a rodada';
      await perguntar(page, pergunta);
      await page.locator('#mensagens .bolha.bloqueio').waitFor();
      await esperarRespostaCompleta(page);
      const id = await page.evaluate(() => window.jurConversa.id);

      // Outra aba pergunta e recebe resposta na mesma conversa enquanto o reenvio está a caminho:
      // a última gravada deixa de ser o tool_result que este cliente manda.
      const corpos = [];
      await page.route('**/api/v1/chat', (route) => {
        corpos.push(route.request().postDataJSON());
        if (corpos.length === 1) {
          a.conversas.acrescentar(id, 'user', 'pergunta de outra aba');
          a.conversas.acrescentar(id, 'assistant', 'resposta de outra aba');
        }
        route.continue();
      });
      await page.locator('#mensagens .bloqueio button', { hasText: 'Tentar de novo' }).click();
      const aviso = page.locator('#mensagens .msg.erro', { hasText: 'Não foi possível tentar de novo' });
      await aviso.waitFor();
      assert.strictEqual(corpos.length, 1);
      assert.strictEqual(corpos[0].reenvio, true);
      assert.strictEqual(await page.inputValue('#caixa-conversa .entrada'), pergunta, 'a pergunta volta para a caixa');
      assert.strictEqual(await page.locator('#mensagens .msg.user', { hasText: pergunta }).count(), 1);
      assert.strictEqual(await page.locator('.bloqueio').count(), 0);

      // O próximo envio leva o histórico gravado (com a rodada cobrada e a outra aba) e a pergunta no fim.
      await page.click('#caixa-conversa .enviar');
      await page.waitForFunction(() => /resposta depois do reenvio/.test(document.querySelector('#mensagens').textContent));
      await esperarRespostaCompleta(page);
      assert.strictEqual(corpos.length, 2);
      const enviadas = corpos[1].mensagens;
      assert.strictEqual(corpos[1].reenvio, undefined);
      const blocos = enviadas.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      assert.ok(blocos.some((b) => b.type === 'tool_use' && b.id === 'tu_1'), JSON.stringify(enviadas));
      assert.ok(blocos.some((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_1'), JSON.stringify(enviadas));
      assert.deepStrictEqual(enviadas[enviadas.length - 1], { role: 'user', content: pergunta });
      assert.deepStrictEqual(enviadas.map((m) => m.role), ['user', 'assistant', 'user', 'user', 'assistant', 'user']);
    } finally { await a.fechar(); }
  });

  it('recusa antes do stream (409 cobrança pendente, 503 indisponível) tira a pergunta da tela e do histórico', async () => {
    for (const [motivo, texto] of [['pendente', /cobrança pendente/], ['indisponivel', /temporariamente indisponível/]]) {
      // 1–2: primeiro turno inteiro; 3: pré-checagem do segundo, recusada; depois libera.
      const cobranca = cobrancaFalsa({ podeOperar: (n) => (n === 3 ? { ok: false, motivo } : { ok: true }) });
      const a = await subir({ cobranca, respostas: [final('primeira resposta'), final('segunda resposta')] });
      try {
        const { page } = a;
        await perguntar(page, 'primeira pergunta');
        await esperarRespostaCompleta(page);
        const id = await page.evaluate(() => window.jurConversa.id);

        await perguntar(page, 'pergunta recusada', '#caixa-conversa');
        const aviso = page.locator('#mensagens .msg.erro', { hasText: texto });
        await aviso.waitFor();
        await esperarRespostaCompleta(page);
        assert.strictEqual(await page.locator('#mensagens .msg.user', { hasText: 'pergunta recusada' }).count(), 0, `${motivo}: a bolha sai da tela`);
        assert.strictEqual(await page.inputValue('#caixa-conversa .entrada'), 'pergunta recusada', `${motivo}: o texto volta para a caixa`);
        assert.strictEqual(a.conversas.mensagens(id).length, 2, `${motivo}: o servidor não gravou nada`);

        const corpos = [];
        await page.route('**/api/v1/chat', (route) => { corpos.push(route.request().postDataJSON()); route.continue(); });
        await page.click('#caixa-conversa .enviar');
        await page.waitForFunction(() => /segunda resposta/.test(document.querySelector('#mensagens').textContent));
        await esperarRespostaCompleta(page);
        assert.deepStrictEqual(corpos[0].mensagens.map((m) => m.role), ['user', 'assistant', 'user'],
          `${motivo}: sem duas perguntas seguidas: ${JSON.stringify(corpos[0].mensagens)}`);
        assert.strictEqual(await page.locator('#mensagens .msg.user', { hasText: 'pergunta recusada' }).count(), 1);

        // Depois de um F5 a conversa gravada é a mesma da tela.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#historico .conversa-item');
        await page.waitForSelector('#conversa:not([hidden])');
        const perguntas = await page.locator('#mensagens .msg.user').allTextContents();
        assert.deepStrictEqual(perguntas, ['primeira pergunta', 'pergunta recusada']);
      } finally { await a.fechar(); }
    }
  });

  it('seletor com ProcStudio primeiro, selo e preço; Configurações com o bloco do ProcStudio e o avançado recolhido', async () => {
    const a = await subir();
    try {
      const { page } = a;
      await page.waitForSelector('#saldo-ia:not([hidden]) > *');
      assert.strictEqual(await page.textContent('#caixa-inicial .modelo-abrir'), 'ProcStudio · GLM-5.3 Flash');

      await page.click('#caixa-inicial .modelo-abrir');
      const popover = page.locator('#caixa-inicial .modelo-popover');
      await popover.waitFor();
      const primeiro = await popover.evaluate((p) => [...p.children].find((c) => !c.hidden).textContent);
      assert.match(primeiro, /^ProcStudio/);
      assert.match(primeiro, /recomendada/);
      assert.match(primeiro, /R\$ 1,00 \/ 1M entrada · R\$ 4,00 \/ 1M saída/);
      assert.match(await popover.textContent(), /Avançado — usar minha própria chave/);
      // Sem busca de modelo para a ProcStudio: um botão só.
      await popover.getByRole('button', { name: 'Usar GLM-5.3 Flash' }).click();
      await popover.waitFor({ state: 'hidden' });

      await page.click('#abrir-config');
      const painel = page.locator('#painel-config');
      await painel.getByRole('heading', { name: 'IA do ProcStudio' }).waitFor();
      assert.match(await painel.textContent(), /O chat usa o saldo de IA do seu time no ProcStudio\./);
      await painel.getByText('R$ 10,00').waitFor();
      assert.strictEqual(await painel.getByRole('link', { name: 'Adicionar créditos' }).getAttribute('href'), 'https://proc.example/equipe?tab=billing');
      const avancado = painel.locator('details');
      assert.match(await avancado.locator('summary').textContent(), /Avançado: minha própria chave/);
      assert.strictEqual(await avancado.evaluate((d) => d.open), false, 'recolhido por padrão');
    } finally { await a.fechar(); }
  });

  it('BYOK selecionado: a linha de custo mostra só tokens e o avançado abre aberto', async () => {
    const a = await subir();
    try {
      const { page, byok } = a;
      await page.evaluate((id) => window.jurConexoes.selecionar(id, 'gpt-x'), byok.id);
      assert.strictEqual(await page.textContent('#caixa-inicial .modelo-abrir'), 'OpenAI · gpt-x');
      await perguntar(page, 'pergunta com minha chave');
      await esperarRespostaCompleta(page);
      const linha = await page.textContent('#mensagens .custo-resposta');
      assert.match(linha, /tokens/);
      assert.doesNotMatch(linha, /R\$/);
      assert.strictEqual(await page.locator('#custo-conversa').isVisible(), false, 'sem cobrança não há total em reais');
      assert.strictEqual((await page.textContent('#saldo-ia')).trim(), 'Saldo IA · R$ 10,00', 'BYOK não mexe no saldo');

      await page.click('#abrir-config');
      assert.strictEqual(await page.locator('#painel-config details').evaluate((d) => d.open), true);
    } finally { await a.fechar(); }
  });

  it('ProcStudio indisponível: erro com o link para configurar uma conexão própria', async () => {
    const cobranca = cobrancaFalsa({ podeOperar: () => ({ ok: false, motivo: 'indisponivel' }) });
    const a = await subir({ cobranca });
    try {
      const { page } = a;
      await perguntar(page, 'pergunta com o ProcStudio fora');
      const aviso = page.locator('#caixa-inicial .aviso-caixa');
      await aviso.waitFor();
      assert.match(await aviso.textContent(), /temporariamente indisponível/);
      await aviso.getByRole('button', { name: 'Configurar uma conexão própria' }).click();
      await page.locator('#painel-config details[open]').waitFor();
    } finally { await a.fechar(); }
  });

  it('conta inativa no ProcStudio: o saldo responde 401 e a tela volta ao login com o motivo, sem pílula "indisponível"', async () => {
    const cobranca = { ...cobrancaFalsa(), saldo: async () => ({ ativo: false }) };
    const a = await subir({ cobranca });
    try {
      const { page } = a;
      await page.waitForSelector('#login-procstudio:not([hidden])');
      assert.strictEqual(await page.textContent('#login-erro'),
        'Sua conta do ProcStudio está inativa ou a sessão expirou; entre de novo.');
      assert.strictEqual(await page.evaluate(() => document.body.classList.contains('aguardando-sessao')), true);
      assert.strictEqual(await page.$eval('#saldo-ia', (e) => e.hidden), true);
      assert.doesNotMatch(await page.textContent('#saldo-ia'), /indisponível/);
    } finally { await a.fechar(); }
  });

  it('conta que fica inativa ao perguntar: 401 do chat leva ao login com o motivo', async () => {
    const cobranca = cobrancaFalsa({ podeOperar: () => ({ ok: false, motivo: 'inativo' }) });
    const a = await subir({ cobranca });
    try {
      const { page } = a;
      await page.waitForSelector('#saldo-ia:not([hidden]) > *');
      await perguntar(page, 'pergunta com a conta desativada');
      await page.waitForSelector('#login-procstudio:not([hidden])');
      assert.strictEqual(await page.textContent('#login-erro'),
        'Sua conta do ProcStudio está inativa ou a sessão expirou; entre de novo.');
      await page.waitForFunction(() => document.querySelector('#saldo-ia').hidden);
    } finally { await a.fechar(); }
  });

  it('sem conexão gerenciada (disponivel: false) a pílula não aparece', async () => {
    const a = await subir({ cobranca: null, gerenciada: null });
    try {
      const { page } = a;
      const r = await page.evaluate(() => window.jurApi.pedir('/api/v1/saldo'));
      assert.deepStrictEqual(r, { disponivel: false });
      await page.waitForTimeout(200);
      assert.strictEqual(await page.$eval('#saldo-ia', (e) => e.hidden), true);
      assert.strictEqual(await page.textContent('#caixa-inicial .modelo-abrir'), 'OpenAI · gpt-x');
    } finally { await a.fechar(); }
  });
});
