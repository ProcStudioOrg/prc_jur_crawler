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
