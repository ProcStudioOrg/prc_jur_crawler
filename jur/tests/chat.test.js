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

  before(async () => {
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

  after(() => servidor.close());

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
