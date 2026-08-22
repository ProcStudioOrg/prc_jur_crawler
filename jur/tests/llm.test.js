const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const llm = require('../servidor/llm');

let fila;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-llm-'));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [], arquivo: null, erro: null }),
  });
});

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
          _params: params,
        };
        return p;
      },
    },
  };
}

describe('llm', () => {
  it('usa o model id exigido e nao manda parametro proibido', async () => {
    let capturado = null;
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oi' }] }]);
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p) => { capturado = p; return original(p); };

    await llm.conversar({ mensagens: [{ role: 'user', content: 'oi' }], cliente, deps: { fila } });
    assert.strictEqual(capturado.model, 'claude-opus-5');
    assert.strictEqual(capturado.max_tokens, 64000);
    assert.ok(!('temperature' in capturado), 'temperature devolve 400 no Opus 5');
    assert.ok(!JSON.stringify(capturado).includes('budget_tokens'), 'budget_tokens foi removido da API');
    assert.ok(!JSON.stringify(capturado).includes('"type":"disabled"'), 'nao desligue o thinking do Opus 5');
    assert.strictEqual(capturado.tools.length, 3);
  });

  it('executa a tool pedida e devolve o resultado ao modelo', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: { segmento: 'superior' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'o STF esta ok' }] },
    ]);
    const usadas = [];
    const r = await llm.conversar({
      mensagens: [{ role: 'user', content: 'quais superiores?' }],
      cliente, deps: { fila }, aoFerramenta: (n) => usadas.push(n),
    });
    assert.deepStrictEqual(usadas, ['listar_tribunais']);
    assert.match(r.texto, /STF esta ok/);
    const resultado = r.mensagens.find((m) => Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
    assert.ok(resultado, 'o tool_result precisa voltar para o modelo');
    assert.strictEqual(resultado.content[0].tool_use_id, 'tu1');
  });

  it('encaminha os deltas de texto', async () => {
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'pedaco' }] }]);
    const pedacos = [];
    await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, aoTexto: (t) => pedacos.push(t) });
    assert.deepStrictEqual(pedacos, ['pedaco']);
  });

  it('para no teto de iteracoes em vez de rodar para sempre', async () => {
    const semFim = Array.from({ length: 30 }, () => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'x', name: 'listar_tribunais', input: {} }],
    }));
    const r = await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente: clienteFalso(semFim), deps: { fila }, maxIteracoes: 4 });
    assert.match(r.texto, /limite/i);
  });
});
