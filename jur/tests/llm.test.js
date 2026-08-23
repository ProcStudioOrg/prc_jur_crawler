const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const llm = require('../servidor/llm');
const ferramentas = require('../servidor/ferramentas');

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
    assert.strictEqual(capturado.tools.length, ferramentas.definicoes().length,
      'o loop precisa publicar as MESMAS tools que ferramentas.js define — travar o numero aqui\n'
      + '     so obriga a editar o teste a cada tool nova, sem provar nada sobre o que foi enviado');
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

  it('avisa quando o modelo recusa em vez de devolver texto vazio no fim', async () => {
    const cliente = clienteFalso([{ stop_reason: 'refusal', content: [] }]);
    const r = await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila } });
    assert.notStrictEqual(r.texto, '', 'refusal com content vazio nao pode virar texto em branco');
    assert.match(r.texto, /recus/i);
  });

  it('nao chama a API se o signal ja chega abortado', async () => {
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca deveria rodar' }] }]);
    let chamadas = 0;
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p, o) => { chamadas++; return original(p, o); };

    const controlador = new AbortController();
    controlador.abort();
    await assert.rejects(
      () => llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, sinal: controlador.signal }),
      (e) => e.name === 'APIUserAbortError',
    );
    assert.strictEqual(chamadas, 0, 'nao deveria nem tentar chamar a API com o signal ja abortado');
  });

  it('aborta no meio do loop de tools e para de chamar a API de novo', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca deveria rodar' }] },
    ]);
    let chamadas = 0;
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p, o) => { chamadas++; return original(p, o); };

    const controlador = new AbortController();
    await assert.rejects(
      () => llm.conversar({
        mensagens: [{ role: 'user', content: 'x' }],
        cliente, deps: { fila }, sinal: controlador.signal,
        aoFerramenta: () => controlador.abort(), // simula o cliente indo embora enquanto a tool roda
      }),
      (e) => e.name === 'APIUserAbortError',
    );
    assert.strictEqual(chamadas, 1, 'a primeira chamada ja tinha ido; a segunda nao deveria acontecer');
  });

  it('roda tools do mesmo turno em paralelo, preservando a ordem dos tool_result', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-llm-par-'));
    const filaParalela = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async (comando) => {
        // stf demora bem mais que trf2 — se as tools rodassem em serie, o tempo total
        // seria perto da SOMA (210ms); em paralelo, perto do MAIOR (150ms). A folga de
        // 60ms entre os dois absorve jitter de agendamento do event loop sem ficar lento.
        const atraso = comando === 'stf' ? 150 : 60;
        await new Promise((resolve) => { setTimeout(resolve, atraso); });
        return { ok: true, total: 1, resultados: [{ tribunal: comando }], arquivo: null, erro: null };
      },
    });
    const cliente = clienteFalso([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'a-stf', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } },
          { type: 'tool_use', id: 'b-trf2', name: 'buscar_jurisprudencia', input: { tribunal: 'trf2', query: 'x' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'pronto' }] },
    ]);

    const inicio = Date.now();
    const r = await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila: filaParalela } });
    const duracao = Date.now() - inicio;

    assert.ok(duracao < 180, `esperava rodar em paralelo (~150ms), levou ${duracao}ms — parece serial (~210ms)`);

    const turnoDeResultados = r.mensagens.find((m) => Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
    assert.deepStrictEqual(turnoDeResultados.content.map((c) => c.tool_use_id), ['a-stf', 'b-trf2'],
      'a ordem do tool_result precisa bater com a ordem do tool_use, mesmo com trf2 terminando primeiro');
  });

  it('manda output_config.effort no opus e sonnet', async () => {
    for (const modelo of ['claude-opus-5', 'claude-sonnet-5']) {
      let capturado = null;
      const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
      const original = cliente.messages.stream.bind(cliente.messages);
      cliente.messages.stream = (p) => { capturado = p; return original(p); };
      await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, modelo, esforco: 'low' });
      assert.strictEqual(capturado.model, modelo);
      assert.deepStrictEqual(capturado.output_config, { effort: 'low' });
      assert.ok(!('effort' in capturado), 'effort nao pode ir no topo do payload');
    }
  });

  it('NAO manda output_config no haiku, que rejeita o parametro', async () => {
    let capturado = null;
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p) => { capturado = p; return original(p); };
    await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, modelo: 'claude-haiku-4-5' });
    assert.strictEqual(capturado.model, 'claude-haiku-4-5');
    assert.ok(!('output_config' in capturado), 'haiku nao aceita output_config');
  });
});

/**
 * O escopo declarado pelo usuario entra no PROMPT, e e dai que vem a economia de chamada
 * de ferramenta: com o catalogo ja a vista, o modelo nao precisa gastar uma rodada
 * inteira chamando listar_tribunais so para descobrir onde pode buscar.
 */
describe('llm — escopo de tribunais no prompt do sistema', () => {
  function clienteEspiao(capturado) {
    return {
      messages: {
        stream(params) {
          capturado.params = params;
          const p = { on() { return p; }, async finalMessage() { return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; } };
          return p;
        },
      },
    };
  }

  const rodar = async (escopo) => {
    const capturado = {};
    await llm.conversar({
      mensagens: [{ role: 'user', content: 'oi' }],
      cliente: clienteEspiao(capturado),
      deps: {},
      escopo,
    });
    return capturado.params.system;
  };

  it('sem escopo, o prompt fica como sempre foi', async () => {
    assert.strictEqual(await rodar(undefined), llm.SISTEMA);
  });

  it('com escopo, o prompt lista os tribunais ligados', async () => {
    const sistema = await rodar(['stf', 'trf4']);
    assert.notStrictEqual(sistema, llm.SISTEMA);
    assert.match(sistema, /\bstf\b/);
    assert.match(sistema, /\btrf4\b/);
  });

  it('o prompt dispensa explicitamente a chamada a listar_tribunais', async () => {
    const sistema = await rodar(['stf']);
    assert.match(sistema, /listar_tribunais/,
      'sem dizer que nao precisa chamar, o modelo chama assim mesmo e a economia nao acontece');
  });

  it('o prompt proibe buscar fora do escopo e proibe ler isso como ausencia de julgado', async () => {
    const sistema = await rodar(['stf']);
    assert.match(sistema, /desligad/i);
    assert.match(sistema, /nao ha jurisprudencia|não há jurisprudência|ausencia|ausência/i);
  });

  it('escopo vazio tambem entra no prompt — desligar tudo nao pode virar silencio', async () => {
    const sistema = await rodar([]);
    assert.notStrictEqual(sistema, llm.SISTEMA);
    assert.match(sistema, /nenhum tribunal/i);
  });
});

/**
 * `aoResultadoFerramenta` e o gancho que leva o jobId de volta a rota, para ela vincular
 * a busca a conversa. Precisa existir separado do `aoFerramenta`, que dispara ANTES da
 * execucao (para o cliente ja mostrar "buscando…") e portanto nao tem resultado nenhum
 * em maos.
 */
describe('llm — aviso de resultado de ferramenta', () => {
  function clienteComToolUse() {
    let i = 0;
    const respostas = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'pronto' }] },
    ];
    return {
      messages: {
        stream() {
          const r = respostas[i++];
          const p = { on() { return p; }, async finalMessage() { return r; } };
          return p;
        },
      },
    };
  }

  it('avisa com o nome, a entrada e o resultado — inclusive o jobId', async () => {
    const vistos = [];
    const fila = {
      enfileirar: () => ({ id: 'job-42', status: 'enfileirado' }),
      obter: () => ({ id: 'job-42', status: 'concluido', total: 3 }),
      aguardar: async () => ({ id: 'job-42', status: 'concluido', total: 3 }),
    };
    await llm.conversar({
      mensagens: [{ role: 'user', content: 'busca' }],
      cliente: clienteComToolUse(),
      deps: { fila, timeoutBuscaMs: 0 },
      aoResultadoFerramenta: (nome, entrada, resultado) => vistos.push({ nome, entrada, resultado }),
    });
    assert.strictEqual(vistos.length, 1);
    assert.strictEqual(vistos[0].nome, 'buscar_jurisprudencia');
    assert.strictEqual(vistos[0].entrada.tribunal, 'stf');
    assert.strictEqual(vistos[0].resultado.jobId, 'job-42');
  });

  it('sem o gancho, o loop roda igual — ele e opcional', async () => {
    const fila = {
      enfileirar: () => ({ id: 'j', status: 'enfileirado' }),
      obter: () => ({ id: 'j', status: 'concluido', total: 0 }),
      aguardar: async () => ({ id: 'j', status: 'concluido', total: 0 }),
    };
    const r = await llm.conversar({
      mensagens: [{ role: 'user', content: 'busca' }],
      cliente: clienteComToolUse(),
      deps: { fila, timeoutBuscaMs: 0 },
    });
    assert.strictEqual(r.texto, 'pronto');
  });

  it('gancho que lanca nao derruba o turno', async () => {
    const fila = {
      enfileirar: () => ({ id: 'j', status: 'enfileirado' }),
      obter: () => ({ id: 'j', status: 'concluido', total: 0 }),
      aguardar: async () => ({ id: 'j', status: 'concluido', total: 0 }),
    };
    const r = await llm.conversar({
      mensagens: [{ role: 'user', content: 'busca' }],
      cliente: clienteComToolUse(),
      deps: { fila, timeoutBuscaMs: 0 },
      aoResultadoFerramenta: () => { throw new Error('ouvinte quebrado'); },
    });
    assert.strictEqual(r.texto, 'pronto',
      'o vinculo com a conversa e util, mas nao vale perder a resposta inteira por causa dele');
  });
});
