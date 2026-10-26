const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

/** Cliente falso com a mesma forma do SDK: .messages.stream(...) -> {on, finalMessage}. */
function clienteFalso(respostas) {
  let i = 0;
  return {
    messages: {
      stream(params) {
        const resposta = respostas[i++];
        const ouvintes = {};
        const p = {
          on(evento, fn) { ouvintes[evento] = fn; return p; },
          async finalMessage() {
            for (const bloco of resposta.content) {
              if (bloco.type === 'text' && ouvintes.text) ouvintes.text(bloco.text);
            }
            return resposta;
          },
        };
        return p;
      },
    },
  };
}

/** Le um corpo SSE completo (`event: X\ndata: Y\n\n`) e devolve a lista de eventos. */
function analisarSSE(texto) {
  return texto
    .split('\n\n')
    .filter(Boolean)
    .map((bloco) => {
      const linhas = bloco.split('\n');
      const linhaEvento = linhas.find((l) => l.startsWith('event: '));
      const linhaDado = linhas.find((l) => l.startsWith('data: '));
      if (!linhaEvento) return null; // comentario (': ping') ou lixo
      return { evento: linhaEvento.slice(7), dado: linhaDado ? JSON.parse(linhaDado.slice(6)) : undefined };
    })
    .filter(Boolean);
}

describe('rotas de chat', () => {
  let servidor; let base; let fila;

  // I7 (revisao final): o teste do 401 abaixo so vale se ANTHROPIC_API_KEY estiver
  // vazia. Numa maquina com a chave exportada — o estado NORMAL de quem usa o produto —
  // ele nao so falhava como seguia para `llm.conversar`, que chamaria a API DE VERDADE
  // e cobraria do desenvolvedor por rodar a suite. A chave sai do ambiente antes de
  // qualquer teste deste arquivo e volta no fim; `node --test` roda cada arquivo num
  // processo separado, entao isto nao vaza para as outras suites.
  let chaveOriginal;

  before(async () => {
    chaveOriginal = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chat-'));
    fila = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
    });
    servidor = http.createServer(criarApp({ fila }).handler);
    await new Promise((r) => servidor.listen(0, r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(() => {
    servidor.close();
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  const postar = (corpo, extra = {}) => fetch(`${base}/api/v1/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), ...extra,
  });

  it('recusa corpo sem mensagens, com mensagens vazio, ou mal formadas — 400', async () => {
    assert.strictEqual((await postar({})).status, 400);
    assert.strictEqual((await postar({ mensagens: [] })).status, 400);
    assert.strictEqual((await postar({ mensagens: [{ content: 'x' }] })).status, 400); // sem role
    assert.strictEqual((await postar({ mensagens: [{ role: 'user' }] })).status, 400); // sem content
    assert.strictEqual((await postar({ mensagens: [{ role: 'sistema', content: 'x' }] })).status, 400); // role invalida
  });

  it('recusa prefill (ultima mensagem do assistant) com 400 explicando o motivo', async () => {
    const r = await postar({ mensagens: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'ja sei a resposta' }] });
    assert.strictEqual(r.status, 400);
    const corpo = await r.json();
    assert.match(corpo.erro, /prefill|assistant/i);
  });

  it('401 sem chave da Anthropic e sem cliente de teste', async () => {
    // Guarda explicita: se por qualquer motivo a chave voltar ao ambiente, este teste
    // falha AQUI, antes de chegar em llm.conversar — nunca vira chamada paga.
    assert.strictEqual(process.env.ANTHROPIC_API_KEY, undefined,
      'o before() deste describe precisa ter limpado a chave: sem isso o teste faz chamada real e paga');
    const semChaveNemCliente = http.createServer(criarApp({ fila }).handler);
    await new Promise((r) => semChaveNemCliente.listen(0, r));
    const portaIsolada = semChaveNemCliente.address().port;
    const r = await fetch(`http://127.0.0.1:${portaIsolada}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'oi' }] }),
    });
    assert.strictEqual(r.status, 401);
    semChaveNemCliente.close();
  });

  // C2 (revisao final): esta rota gasta a chave da Anthropic do operador (Opus 5,
  // max_tokens 64000). Um site hostil aberto no browser da vitima consegue POSTar aqui
  // como "requisicao simples" do CORS (content-type text/plain, sem preflight) — mesmo
  // sem conseguir LER o SSE de volta, a conta ja foi paga.
  it('recusa Origin hostil com 403 antes de tocar no LLM', async () => {
    const clienteLLM = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca deveria rodar' }] }]);
    let chamadas = 0;
    const original = clienteLLM.messages.stream.bind(clienteLLM.messages);
    clienteLLM.messages.stream = (p, o) => { chamadas++; return original(p, o); };

    const srv = http.createServer(criarApp({ fila, clienteLLM }).handler);
    await new Promise((r) => srv.listen(0, r));
    const porta = srv.address().port;
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
        body: JSON.stringify({ mensagens: [{ role: 'user', content: 'oi' }] }),
      });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(chamadas, 0, 'nem uma chamada ao LLM pode sair de uma origem hostil');

      // Contraprova: a MESMA requisicao com Origin de loopback passa.
      const ok = await fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://localhost:${porta}` },
        body: JSON.stringify({ mensagens: [{ role: 'user', content: 'oi' }] }),
      });
      assert.strictEqual(ok.status, 200);
      await ok.text();
      assert.strictEqual(chamadas, 1);
    } finally { srv.close(); }
  });

  it('feliz: SSE emite texto, ferramenta e fim', async () => {
    const clienteLLM = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'resposta final' }] },
    ]);
    const srv = http.createServer(criarApp({ fila, clienteLLM }).handler);
    await new Promise((r) => srv.listen(0, r));
    const porta = srv.address().port;

    const resp = await fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'quais tribunais?' }] }),
    });
    assert.strictEqual(resp.status, 200);
    assert.match(resp.headers.get('content-type'), /text\/event-stream/);

    const eventos = analisarSSE(await resp.text());
    assert.ok(eventos.some((e) => e.evento === 'ferramenta' && e.dado.nome === 'listar_tribunais'));
    assert.ok(eventos.some((e) => e.evento === 'texto' && e.dado.texto === 'resposta final'));
    const fim = eventos.find((e) => e.evento === 'fim');
    assert.ok(fim);
    assert.match(fim.dado.texto, /resposta final/);

    srv.close();
  });

  it('cancela o job de busca em andamento quando o cliente desconecta no meio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chat-abort-'));
    const filaLenta = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      // Nunca resolve sozinho — so o cancelamento (via DB) devolve o job a um estado
      // terminal; simula um crawler real que ficaria minutos rodando.
      executarFn: () => new Promise(() => {}),
    });
    const clienteLLM = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } }] },
    ]);
    const srv = http.createServer(criarApp({ fila: filaLenta, clienteLLM }).handler);
    await new Promise((r) => srv.listen(0, r));
    const porta = srv.address().port;

    const controlador = new AbortController();
    const chegou = fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'busca no stf' }] }),
      signal: controlador.signal,
    }).catch(() => {}); // esperamos abortar — o reject e esperado, nao e falha do teste

    // Espera o job aparecer rodando na fila (prova que o tool_use ja foi despachado).
    let job;
    for (let tentativa = 0; tentativa < 100 && !job; tentativa++) {
      await new Promise((r) => setTimeout(r, 10));
      job = filaLenta.listar().find((j) => j.comando === 'stf');
    }
    assert.ok(job, 'o job de busca deveria ter sido criado');
    assert.strictEqual(job.status, 'rodando');

    controlador.abort();
    await chegou;

    let atualizado = filaLenta.obter(job.id);
    for (let tentativa = 0; tentativa < 100 && atualizado.status !== 'cancelado'; tentativa++) {
      await new Promise((r) => setTimeout(r, 10));
      atualizado = filaLenta.obter(job.id);
    }
    assert.strictEqual(atualizado.status, 'cancelado', 'o job orfao devia ser cancelado, nao continuar rodando sozinho');

    srv.close();
  });

  it('evento busca de uma consulta por numero diz o numero, nao undefined', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'trf4', numero: '5000' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const app = http.createServer(criarApp({ fila, clienteLLM: cliente }).handler);
    await new Promise((r) => app.listen(0, r));
    const r = await fetch(`http://127.0.0.1:${app.address().port}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'processo 5000 no trf4' }], tribunais: ['trf4'] }),
    });
    const texto = await r.text();
    app.close();
    const busca = analisarSSE(texto).find((e) => e.evento === 'busca');
    assert.ok(busca, texto);
    assert.strictEqual(busca.dado.query, 'nº 5000');
  });

  it('busca fora do escopo e recusada e NAO cria job', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'trf4', query: 'x' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const app = http.createServer(criarApp({ fila, clienteLLM: cliente }).handler);
    await new Promise((r) => app.listen(0, r));
    const antes = fila.listar(100).length;
    const r = await fetch(`http://127.0.0.1:${app.address().port}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'busca no trf4' }], tribunais: ['stf'] }),
    });
    const texto = await r.text();
    app.close();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job pode ter sido criado fora do escopo');
    const eventos = analisarSSE(texto);
    assert.ok(eventos.some((e) => e.evento === 'fim'));
    assert.ok(!eventos.some((e) => e.evento === 'busca'), 'sem job, sem evento busca');
  });
});

/**
 * O escopo de tribunais vem do painel de disponibilidade e chega no corpo do POST.
 * Comando desconhecido e RECUSADO com 400 em vez de ignorado: ignorar deixaria o escopo
 * real menor do que o pedido sem ninguem perceber, e escopo menor em silencio vira zero
 * em silencio mais adiante.
 */
describe('POST /api/v1/chat — escopo de tribunais', () => {
  let servidor; let base; let chaveOriginal;

  before(async () => {
    chaveOriginal = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-escopo-'));
    const fila = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
    });
    const clienteLLM = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
    servidor = http.createServer(criarApp({ fila, clienteLLM }).handler);
    await new Promise((r) => servidor.listen(0, r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(() => {
    servidor.close();
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  const enviar = (extra) => fetch(`${base}/api/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mensagens: [{ role: 'user', content: 'oi' }], ...extra }),
  });

  it('aceita uma lista de comandos validos', async () => {
    const r = await enviar({ tribunais: ['stf', 'trf4'] });
    assert.strictEqual(r.status, 200);
    await r.text();
  });

  it('recusa comando desconhecido com 400 em vez de ignorar', async () => {
    const r = await enviar({ tribunais: ['stf', 'tjxx'] });
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).erro, /tjxx/);
  });

  it('recusa tribunais que nao e lista', async () => {
    assert.strictEqual((await enviar({ tribunais: 'stf' })).status, 400);
  });

  it('lista vazia e aceita — desligar tudo e uma escolha, nao um erro', async () => {
    const r = await enviar({ tribunais: [] });
    assert.strictEqual(r.status, 200);
    await r.text();
  });

  it('sem o campo, segue funcionando como antes', async () => {
    const r = await enviar({});
    assert.strictEqual(r.status, 200);
    await r.text();
  });
});

/**
 * Conexão ProcStudio: o chat cobra o saldo de IA do time por rodada. `cobranca` é falsa
 * (saldo em centavos, espiões em cada método); `conexoes` é o repositório real com a
 * conexão gerenciada, trocando só o cliente do provedor pelo falso.
 */
describe('POST /api/v1/chat — cobrança da conexão ProcStudio', () => {
  const conversasMod = require('../servidor/conversas');
  const turnosMod = require('../servidor/turnos');
  const { criarConexoes } = require('../servidor/conexoes-llm');
  const { erroProvedor } = require('../servidor/provedores');
  const GERENCIADA = {
    apiKey: 'sk-operador', endpoint: 'https://openrouter.ai/api/v1', modelo: 'z-ai/glm-5.3-flash',
    modeloCatalogo: 'glm-5.3-flash', upstream: 'z-ai', rotulo: 'GLM-5.3 Flash', extras: {},
  };
  const USO = (entrada, saida) => ({
    input_tokens: entrada, output_tokens: saida, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0.001, generation_id: 'gen-1',
  });
  const ferramenta = (id, usage) => ({ stop_reason: 'tool_use', usage, content: [{ type: 'text', text: 'vou olhar ' }, { type: 'tool_use', id, name: 'listar_tribunais', input: {} }] });
  const final = (texto, usage) => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: texto }] });

  let chaveOriginal;
  before(() => { chaveOriginal = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  after(() => {
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  /** Saldo em centavos; cada rodada custa `precoCents`. podeOperar = saldo > 0. */
  function cobrancaFalsa({ saldoCents = 1000, precoCents = 4, registrar, podeOperar } = {}) {
    const estado = { saldoCents };
    const espiao = { podeOperar: 0, registrar: [], falhaDoOperador: [] };
    return {
      espiao,
      estado,
      async podeOperar() {
        espiao.podeOperar++;
        if (podeOperar) return podeOperar(espiao.podeOperar);
        if (estado.saldoCents > 0) return { ok: true };
        return { ok: false, motivo: 'saldo', saldoBrl: estado.saldoCents / 100, mensagem: 'msg do Rails', topupPath: '/ia-uso/recarga' };
      },
      async registrar(uso) {
        espiao.registrar.push(uso);
        if (registrar) return registrar(uso, espiao.registrar.length);
        estado.saldoCents -= precoCents;
        return { cobradoBrl: precoCents / 100, saldoBrl: estado.saldoCents / 100, podeOperar: estado.saldoCents > 0, duplicado: false };
      },
      falhaDoOperador(erro) {
        espiao.falhaDoOperador.push(erro);
        return Object.assign(new Error('A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.'), { code: 'PROCSTUDIO_LLM_INDISPONIVEL', status: 503 });
      },
    };
  }

  /** Cliente do provedor: cada item é uma resposta, uma função (params) => resposta, ou um Error a lançar. */
  function provedorFalso(respostas) {
    const chamadas = [];
    let i = 0;
    return {
      chamadas,
      messages: {
        stream(params) {
          chamadas.push(params);
          const item = respostas[i++];
          const ouvintes = {};
          const p = {
            on(evento, fn) { ouvintes[evento] = fn; return p; },
            async finalMessage() {
              const resposta = typeof item === 'function' ? await item(params) : item;
              if (resposta instanceof Error) throw resposta;
              for (const bloco of resposta.content) {
                if (bloco.type === 'text' && ouvintes.text) ouvintes.text(bloco.text);
              }
              return resposta;
            },
          };
          return p;
        },
      },
    };
  }

  async function ambiente({ respostas, cobranca = cobrancaFalsa(), turnos } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chat-cobranca-'));
    const con = db.abrir(path.join(dir, 'jur.db'));
    const conversas = conversasMod.criarRepositorio(con);
    const cofre = { cifrar: (v) => v, decifrar: (v) => v };
    const reais = criarConexoes({
      con, owner: 'dono', cofre, gerenciada: GERENCIADA,
      transport: async () => { throw new Error('rede proibida neste teste'); },
    });
    const byok = reais.salvar({ provider: 'openai', name: 'minha', model: 'gpt-x', apiKey: 'sk-usuario' });
    const provedor = provedorFalso(respostas);
    const usados = [];
    const conexoes = { ...reais, cliente: (id) => { usados.push(id); return provedor; } };
    const fila = jobs.criarFila({
      con, dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
    });
    const srv = http.createServer(criarApp({
      fila, conexoes, cobranca, conversas, frontendUrl: 'https://proc.example', ...(turnos ? { turnos } : {}),
    }).handler);
    await new Promise((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const postar = (corpo, extra = {}) => fetch(`${base}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'quais tribunais?' }], ...corpo }), ...extra,
    });
    return { srv, base, postar, conversas, cobranca, provedor, usados, byok, fechar: () => srv.close() };
  }

  it('sem saldo: 402 antes de gravar a mensagem, sem chamar o provedor', async () => {
    const cobranca = cobrancaFalsa({ saldoCents: -52 });
    const a = await ambiente({ respostas: [final('nunca', USO(1, 1))], cobranca });
    try {
      const c = a.conversas.criar();
      const r = await a.postar({ conexaoId: 'procstudio', conversaId: c.id });
      assert.strictEqual(r.status, 402);
      assert.deepStrictEqual(await r.json(), {
        erro: 'Seu saldo de IA do ProcStudio acabou (R$ −0,52). Adicione créditos para continuar.',
        tipo: 'saldo_insuficiente',
        saldoBrl: -0.52,
        topupUrl: 'https://proc.example/ia-uso/recarga',
      });
      assert.deepStrictEqual(a.conversas.mensagens(c.id), [], 'nada pode ser gravado quando o turno é recusado');
      assert.strictEqual(a.provedor.chamadas.length, 0);
    } finally { a.fechar(); }
  });

  it('cobrança pendente → 409; ProcStudio indisponível → 503', async () => {
    for (const [motivo, status, tipo] of [['pendente', 409, 'cobranca_pendente'], ['indisponivel', 503, 'procstudio_indisponivel']]) {
      const cobranca = cobrancaFalsa({ podeOperar: () => ({ ok: false, motivo }) });
      const a = await ambiente({ respostas: [final('nunca', USO(1, 1))], cobranca });
      try {
        const r = await a.postar({ conexaoId: 'procstudio' });
        assert.strictEqual(r.status, status);
        const corpo = await r.json();
        assert.strictEqual(corpo.tipo, tipo);
        assert.match(corpo.erro, motivo === 'pendente' ? /cobrança pendente/ : /temporariamente indisponível/);
        assert.strictEqual(a.provedor.chamadas.length, 0);
      } finally { a.fechar(); }
    }
  });

  it('feliz: modelo do provedor, custo por rodada antes do fim, fim.custo soma e request_id por turno', async () => {
    const a = await ambiente({ respostas: [ferramenta('t1', USO(1000, 50)), final('pronto', USO(1200, 80))] });
    try {
      const c = a.conversas.criar();
      const r = await a.postar({ conexaoId: 'procstudio', conversaId: c.id, modelo: 'qualquer-coisa' });
      assert.strictEqual(r.status, 200);
      const eventos = analisarSSE(await r.text());
      assert.deepStrictEqual(a.provedor.chamadas.map((p) => p.model), ['z-ai/glm-5.3-flash', 'z-ai/glm-5.3-flash'],
        'o provedor recebe o id do provedor, nunca o do catálogo nem o que veio no corpo');
      const custos = eventos.filter((e) => e.evento === 'custo').map((e) => e.dado);
      assert.deepStrictEqual(custos, [
        { rodada: 1, tokensEntrada: 1000, tokensSaida: 50, cobradoBrl: 0.04, saldoBrl: 9.96, modelo: 'GLM-5.3 Flash' },
        { rodada: 2, tokensEntrada: 1200, tokensSaida: 80, cobradoBrl: 0.04, saldoBrl: 9.92, modelo: 'GLM-5.3 Flash' },
      ]);
      const nomes = eventos.map((e) => e.evento);
      assert.ok(nomes.lastIndexOf('custo') < nomes.indexOf('fim'), 'custo sai antes do fim');
      const fim = eventos.find((e) => e.evento === 'fim').dado;
      assert.deepStrictEqual(fim.custo, { cobradoBrl: 0.08, tokensEntrada: 2200, tokensSaida: 130, rodadas: 2, modelo: 'GLM-5.3 Flash' });

      const usos = a.cobranca.espiao.registrar;
      assert.strictEqual(usos.length, 2);
      const [conv, turno, rodada] = usos[0].requestId.split(':');
      assert.strictEqual(conv, c.id);
      assert.match(turno, /^[0-9a-f-]{36}$/);
      assert.strictEqual(rodada, '1');
      assert.strictEqual(usos[1].requestId, `${c.id}:${turno}:2`);
      assert.deepStrictEqual({ ...usos[0], requestId: undefined }, {
        requestId: undefined, modelId: 'glm-5.3-flash', inputTokens: 1000, outputTokens: 50, cacheReadTokens: 0,
        cacheWriteTokens: 0, provider: 'openrouter', providerModel: 'z-ai/glm-5.3-flash', providerCostUsd: 0.001,
        providerGenerationId: 'gen-1', conversationId: c.id,
      });

      const corpo = await (await fetch(`${a.base}/api/v1/conversas/${c.id}`)).json();
      assert.strictEqual(corpo.custos.length, 1);
      assert.strictEqual(corpo.custos[0].turnoId, turno);
      assert.strictEqual(corpo.custoTotalBrl, 0.08);
      assert.ok(a.cobranca.espiao.podeOperar >= 3, 'pré-checagem + uma checagem antes de cada rodada');
    } finally { a.fechar(); }
  });

  it('turno sem conversa usa request_id avulso-<uuid>', async () => {
    const a = await ambiente({ respostas: [final('ok', USO(1, 1))] });
    try {
      await (await a.postar({ conexaoId: 'procstudio' })).text();
      assert.match(a.cobranca.espiao.registrar[0].requestId, /^avulso-[0-9a-f-]{36}:[0-9a-f-]{36}:1$/);
      assert.strictEqual(a.cobranca.espiao.registrar[0].conversationId, null);
    } finally { a.fechar(); }
  });

  it('saldo acaba no meio: 2ª rodada bloqueada, 1ª gravada e custo persistido', async () => {
    const cobranca = cobrancaFalsa({ saldoCents: 3 });
    const a = await ambiente({ respostas: [ferramenta('t1', USO(500, 20)), final('nunca', USO(1, 1))], cobranca });
    try {
      const c = a.conversas.criar();
      const eventos = analisarSSE(await (await a.postar({ conexaoId: 'procstudio', conversaId: c.id })).text());
      assert.strictEqual(a.provedor.chamadas.length, 1, 'sem saldo nenhuma rodada nova vai ao provedor');
      const erro = eventos.find((e) => e.evento === 'erro');
      assert.ok(erro, JSON.stringify(eventos));
      assert.deepStrictEqual(erro.dado, {
        erro: 'Seu saldo de IA do ProcStudio acabou (R$ −0,01). Adicione créditos para continuar.',
        tipo: 'saldo_insuficiente', saldoBrl: -0.01, topupUrl: 'https://proc.example/ia-uso/recarga',
      });
      assert.ok(!eventos.some((e) => e.evento === 'fim'));
      assert.ok(eventos.some((e) => e.evento === 'custo'));
      const m = a.conversas.mensagens(c.id);
      assert.strictEqual(m.length, 3, 'pergunta + rodada 1 (tool_use) + tool_result');
      assert.strictEqual(m[1].papel, 'assistant');
      const custos = a.conversas.custos(c.id);
      assert.strictEqual(custos.length, 1);
      assert.strictEqual(custos[0].cobradoBrl, 0.04);
      assert.strictEqual(custos[0].rodadas, 1);
      assert.strictEqual(custos[0].conexao, 'procstudio');
    } finally { a.fechar(); }
  });

  it('registro que não se confirma encerra o turno com cobranca_pendente', async () => {
    const cobranca = cobrancaFalsa({
      registrar: () => { throw Object.assign(new Error('Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes.'), { code: 'COBRANCA_PENDENTE' }); },
    });
    const a = await ambiente({ respostas: [ferramenta('t1', USO(5, 5)), final('nunca', USO(1, 1))], cobranca });
    try {
      const eventos = analisarSSE(await (await a.postar({ conexaoId: 'procstudio' })).text());
      const erro = eventos.find((e) => e.evento === 'erro');
      assert.deepStrictEqual(erro.dado, {
        erro: 'Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes.',
        tipo: 'cobranca_pendente',
      });
      assert.ok(eventos.some((e) => e.evento === 'texto'), 'o texto já transmitido fica');
      assert.strictEqual(a.provedor.chamadas.length, 1);
    } finally { a.fechar(); }
  });

  it('pricing_unavailable do Rails no registro vira procstudio_indisponivel, avisa o operador uma vez e mantém o custo já cobrado', async () => {
    const { criarCobranca } = require('../servidor/cobranca');
    const dirCob = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chat-pricing-'));
    const logs = [];
    const diagnosticos = [];
    let idas = 0;
    const procstudio = {
      async saldo() { return { ativo: true, podeOperar: true, saldoCents: 1000, saldoBrl: 10, topupPath: '/ia-uso/recarga' }; },
      async registrarUso() {
        idas++;
        if (idas === 1) return { cobradoCents: 4, cobradoBrl: 0.04, saldoCents: 996, saldoBrl: 9.96, podeOperar: true, duplicado: false };
        throw Object.assign(new Error('pricing_unavailable'), { status: 503, code: 'PRICING_UNAVAILABLE' });
      },
    };
    const cobranca = criarCobranca({
      con: db.abrir(path.join(dirCob, 'jur.db')), procstudio,
      principal: { issuer: 'https://proc.example', userId: 'u1', teamId: 't1' },
      kaizen: { outbox: { ligado: true, enfileirar: (fonte, corpo) => { diagnosticos.push({ fonte, corpo }); return true; } } },
      esperar: async () => {},
      logar: (linha) => logs.push(JSON.parse(linha)),
    });
    const a = await ambiente({ respostas: [ferramenta('t1', USO(100, 10)), final('nunca', USO(200, 20))], cobranca });
    try {
      const c = a.conversas.criar();
      const eventos = analisarSSE(await (await a.postar({ conexaoId: 'procstudio', conversaId: c.id })).text());
      assert.deepStrictEqual(eventos.find((e) => e.evento === 'erro').dado, {
        erro: 'A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.',
        tipo: 'procstudio_indisponivel',
      });
      assert.strictEqual(idas, 4, 'rodada 1 cobrada + 3 tentativas da rodada 2');
      assert.strictEqual(logs.filter((l) => l.event === 'procstudio_llm_operator_failure').length, 1);
      assert.strictEqual(diagnosticos.length, 1);
      assert.strictEqual(cobranca.pendentes(), 1, 'o recibo continua devido e fica para o varredor');
      const corpo = await (await fetch(`${a.base}/api/v1/conversas/${c.id}`)).json();
      assert.strictEqual(corpo.custos.length, 1);
      assert.deepStrictEqual([corpo.custos[0].cobradoBrl, corpo.custos[0].rodadas], [0.04, 1]);
      assert.strictEqual(corpo.custoTotalBrl, 0.04);
    } finally { cobranca.pararVarredor(); a.fechar(); }
  });

  it('USAGE_MISSING encerra com tipo usage_missing', async () => {
    const a = await ambiente({ respostas: [final('sem uso', undefined)] });
    const erroOriginal = console.error;
    console.error = () => {}; // llm.js loga llm_usage_missing; o teste não precisa poluir a saída
    try {
      const eventos = analisarSSE(await (await a.postar({ conexaoId: 'procstudio' })).text());
      const erro = eventos.find((e) => e.evento === 'erro');
      assert.strictEqual(erro.dado.tipo, 'usage_missing');
      assert.match(erro.dado.erro, /consumo/);
      assert.strictEqual(a.cobranca.espiao.registrar.length, 0);
    } finally { console.error = erroOriginal; a.fechar(); }
  });

  it('erro do provedor na conexão ProcStudio vira procstudio_indisponivel e avisa o operador; em BYOK segue igual', async () => {
    const a = await ambiente({ respostas: [erroProvedor(402)] });
    try {
      const eventos = analisarSSE(await (await a.postar({ conexaoId: 'procstudio' })).text());
      assert.deepStrictEqual(eventos.find((e) => e.evento === 'erro').dado, {
        erro: 'A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.',
        tipo: 'procstudio_indisponivel',
      });
      assert.strictEqual(a.cobranca.espiao.falhaDoOperador.length, 1);
      assert.strictEqual(a.cobranca.espiao.falhaDoOperador[0].status, 402, 'o status do provedor precisa chegar ao diagnóstico');
    } finally { a.fechar(); }

    const b = await ambiente({ respostas: [erroProvedor(402)] });
    try {
      const eventos = analisarSSE(await (await b.postar({ conexaoId: b.byok.id })).text());
      assert.deepStrictEqual(eventos.find((e) => e.evento === 'erro').dado, {
        erro: erroProvedor(402).message, tipo: 'Error',
      });
      assert.strictEqual(b.cobranca.espiao.falhaDoOperador.length, 0);
    } finally { b.fechar(); }
  });

  it('BYOK não toca na cobrança e emite custo só com tokens', async () => {
    const a = await ambiente({ respostas: [ferramenta('t1', USO(10, 2)), final('ok', null)] });
    try {
      const c = a.conversas.criar();
      const eventos = analisarSSE(await (await a.postar({ conexaoId: a.byok.id, conversaId: c.id })).text());
      assert.deepStrictEqual(a.cobranca.espiao, { podeOperar: 0, registrar: [], falhaDoOperador: [] });
      assert.deepStrictEqual(a.provedor.chamadas.map((p) => p.model), ['gpt-x', 'gpt-x']);
      assert.deepStrictEqual(eventos.filter((e) => e.evento === 'custo').map((e) => e.dado),
        [{ rodada: 1, tokensEntrada: 10, tokensSaida: 2, modelo: 'gpt-x' }]);
      assert.deepStrictEqual(eventos.find((e) => e.evento === 'fim').dado.custo,
        { cobradoBrl: null, tokensEntrada: 10, tokensSaida: 2, rodadas: 1, modelo: 'gpt-x' });
      assert.deepStrictEqual(a.conversas.custos(c.id).map((x) => [x.cobradoBrl, x.conexao]), [[null, a.byok.id]]);
    } finally { a.fechar(); }
  });

  /** Porteira: a rodada só responde quando o teste abrir. */
  function porteira() {
    let abrir; let chegou;
    const aberta = new Promise((r) => { abrir = r; });
    const chamada = new Promise((r) => { chegou = r; });
    return { abrir, chamada, segurar: (resposta) => async () => { chegou(); await aberta; return resposta; } };
  }

  it('reanexar ao stream reproduz o custo', async () => {
    const p = porteira();
    const a = await ambiente({ respostas: [ferramenta('t1', USO(7, 3)), p.segurar(final('fim', USO(9, 4)))] });
    try {
      const c = a.conversas.criar();
      const req = a.postar({ conexaoId: 'procstudio', conversaId: c.id });
      await p.chamada; // a 1ª rodada já foi cobrada e emitiu `custo`
      const fluxo = await fetch(`${a.base}/api/v1/conversas/${c.id}/stream`);
      const lendo = fluxo.text();
      p.abrir();
      await (await req).text();
      const custos = analisarSSE(await lendo).filter((e) => e.evento === 'custo').map((e) => e.dado.rodada);
      assert.deepStrictEqual(custos, [1, 2]);
    } finally { a.fechar(); }
  });

  it('cliente que fecha a conexão no meio: todas as rodadas são cobradas e o custo fica na conversa', async () => {
    const p = porteira();
    const registro = turnosMod.criarRegistro();
    let terminou;
    const fimDoTurno = new Promise((r) => { terminou = r; });
    const turnos = { ...registro, executar: (id, tarefa) => { const x = registro.executar(id, tarefa); x.then(terminou); return x; } };
    const a = await ambiente({ respostas: [ferramenta('t1', USO(7, 3)), p.segurar(final('fim', USO(9, 4)))], turnos });
    try {
      const c = a.conversas.criar();
      const controlador = new AbortController();
      const req = a.postar({ conexaoId: 'procstudio', conversaId: c.id }, { signal: controlador.signal }).then((r) => r.text()).catch(() => {});
      await p.chamada;
      controlador.abort(); // fecha a aba
      await req;
      p.abrir();
      await fimDoTurno;
      assert.strictEqual(a.cobranca.espiao.registrar.length, 2);
      const corpo = await (await fetch(`${a.base}/api/v1/conversas/${c.id}`)).json();
      assert.strictEqual(corpo.custos.length, 1);
      assert.deepStrictEqual(
        { cobradoBrl: corpo.custos[0].cobradoBrl, rodadas: corpo.custos[0].rodadas, tokensEntrada: corpo.custos[0].tokensEntrada },
        { cobradoBrl: 0.08, rodadas: 2, tokensEntrada: 16 },
      );
      assert.strictEqual(corpo.custoTotalBrl, 0.08);
    } finally { a.fechar(); }
  });
});
