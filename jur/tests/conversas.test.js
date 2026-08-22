const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const conversas = require('../servidor/conversas');
const { criarApp } = require('../servidor/index');

let repo;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-'));
  repo = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
});

describe('conversas', () => {
  it('cria, lista e apaga', () => {
    const c = repo.criar();
    assert.ok(c.id);
    assert.ok(repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), true);
    assert.ok(!repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), false);
  });

  it('PRESERVA blocos estruturados de tool_use e tool_result', () => {
    const c = repo.criar();
    const usoDeFerramenta = [
      { type: 'text', text: 'vou buscar' },
      { type: 'tool_use', id: 'tu1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } },
    ];
    const resultado = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'job abc: 3 resultados' }];
    repo.acrescentar(c.id, 'user', 'busque no stf');
    repo.acrescentar(c.id, 'assistant', usoDeFerramenta);
    repo.acrescentar(c.id, 'user', resultado);

    const m = repo.mensagens(c.id);
    assert.strictEqual(m.length, 3);
    assert.strictEqual(m[0].conteudo, 'busque no stf');
    assert.deepStrictEqual(m[1].conteudo, usoDeFerramenta, 'o bloco tool_use precisa voltar intacto');
    assert.deepStrictEqual(m[2].conteudo, resultado, 'o tool_result precisa voltar intacto');
    assert.strictEqual(m[1].conteudo[1].input.tribunal, 'stf');
  });

  it('deriva o titulo da primeira mensagem do usuario e nao troca depois', () => {
    const c = repo.criar();
    repo.renomearSePrimeira(c.id, 'acordaos do trf4 sobre auxilio-acidente em 2024');
    const t1 = repo.listar().find((x) => x.id === c.id).titulo;
    assert.match(t1, /trf4/);
    assert.ok(t1.length <= 60, `titulo longo demais: ${t1.length}`);
    repo.renomearSePrimeira(c.id, 'outra coisa completamente diferente');
    assert.strictEqual(repo.listar().find((x) => x.id === c.id).titulo, t1, 'titulo nao pode mudar depois');
  });

  it('ordena por atualizacao, mais recente primeiro', () => {
    const a = repo.criar(); const b = repo.criar();
    repo.acrescentar(a.id, 'user', 'oi');
    const ids = repo.listar().map((x) => x.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), 'a conversa com atividade recente vem antes');
  });

  it('mensagens de conversa inexistente e lista vazia, nao erro', () => {
    assert.deepStrictEqual(repo.mensagens('nao-existe'), []);
  });

  it('apagar conversa leva as mensagens junto', () => {
    const c = repo.criar();
    repo.acrescentar(c.id, 'user', 'oi');
    repo.apagar(c.id);
    assert.deepStrictEqual(repo.mensagens(c.id), []);
  });

  it('obter busca direto por PK, sem depender de estar entre as N mais recentes', () => {
    const c = repo.criar();
    assert.deepStrictEqual(repo.obter(c.id), { id: c.id, titulo: null, criadoEm: c.criadoEm, atualizadoEm: c.criadoEm });
    assert.strictEqual(repo.obter('nao-existe'), null);
  });

  it('titulo derivado de emoji nao corrompe (nao gera U+FFFD) mesmo truncando', () => {
    const c = repo.criar();
    // 40 emojis fora do BMP (par substituto UTF-16 cada) — mais que TITULO_MAX (60),
    // entao o corte por unidade UTF-16 antigo partiria um par substituto ao meio bem
    // no limite e gravaria um replacement character no banco.
    const texto = '🎉'.repeat(40);
    repo.renomearSePrimeira(c.id, texto);
    const titulo = repo.obter(c.id).titulo;
    assert.ok(!titulo.includes('\uFFFD'), `titulo corrompido com replacement character: ${JSON.stringify(titulo)}`);
    // Nenhum surrogate solto: todo par alto (0xD800-0xDBFF) e seguido do par baixo dele.
    for (let i = 0; i < titulo.length; i++) {
      const code = titulo.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        assert.ok(i + 1 < titulo.length, 'par substituto alto sem par baixo no fim da string');
        const proximo = titulo.charCodeAt(i + 1);
        assert.ok(proximo >= 0xDC00 && proximo <= 0xDFFF, 'par substituto alto nao seguido de par baixo');
        i++;
      }
    }
    assert.ok(Array.from(titulo).length <= 60, `titulo longo demais em code points: ${Array.from(titulo).length}`);
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
        };
        return p;
      },
    },
  };
}

/** Cliente falso cujo finalMessage() so resolve (rejeitando) quando o `signal` passado
 *  em .stream(params, {signal}) aborta — imita o comportamento real do SDK da Anthropic
 *  quando o AbortController do servidor dispara, e serve para testar o caminho de
 *  desconexao no meio da chamada ao LLM (antes de qualquer resposta chegar).
 *
 *  Recebe um `estado` (objeto mutavel) e marca `estado.abortou = true` quando — e so
 *  quando — o `signal` de fato dispara o evento 'abort'. Sem essa instrumentacao, um
 *  teste que so olha o banco depois de um tempo fixo aprova tanto "abortou certinho"
 *  quanto "essa promise ficou pendurada para sempre e ninguem percebeu" — os dois
 *  produzem o MESMO estado no banco dentro de qualquer janela de espera. */
function clienteQueTravaAteAbortar(estado) {
  return {
    messages: {
      stream(params, opcoes) {
        const sinal = opcoes && opcoes.signal;
        const p = {
          on() { return p; },
          finalMessage() {
            return new Promise((resolve, reject) => {
              if (!sinal) return; // nunca resolve — nao deveria acontecer neste teste
              const disparar = () => { estado.abortou = true; rejeitarAbortado(reject); };
              if (sinal.aborted) return disparar();
              sinal.addEventListener('abort', disparar);
            });
          },
        };
        return p;
      },
    },
  };
}

function rejeitarAbortado(reject) {
  const erro = new Error('Requisicao abortada pelo cliente.');
  erro.name = 'APIUserAbortError';
  reject(erro);
}

describe('rotas HTTP de conversas (POST/GET/DELETE /api/v1/conversas)', () => {
  let servidor; let base; let repoHttp;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-http-'));
    repoHttp = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
    servidor = http.createServer(criarApp({ conversas: repoHttp }).handler);
    await new Promise((r) => servidor.listen(0, r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(() => servidor.close());

  it('POST cria, GET lista, GET por id devolve mensagens, DELETE apaga', async () => {
    const criada = await fetch(`${base}/api/v1/conversas`, { method: 'POST' });
    assert.strictEqual(criada.status, 201);
    const conversa = await criada.json();
    assert.ok(conversa.id);

    const listada = await fetch(`${base}/api/v1/conversas`);
    assert.strictEqual(listada.status, 200);
    const { conversas: lista } = await listada.json();
    assert.ok(lista.some((c) => c.id === conversa.id));

    repoHttp.acrescentar(conversa.id, 'user', 'oi');
    const porId = await fetch(`${base}/api/v1/conversas/${conversa.id}`);
    assert.strictEqual(porId.status, 200);
    const corpo = await porId.json();
    assert.strictEqual(corpo.id, conversa.id);
    assert.deepStrictEqual(corpo.mensagens, [{ papel: 'user', conteudo: 'oi' }]);

    const apagada = await fetch(`${base}/api/v1/conversas/${conversa.id}`, { method: 'DELETE' });
    assert.strictEqual(apagada.status, 200);
    assert.deepStrictEqual(await apagada.json(), { id: conversa.id, apagada: true });
  });

  it('GET e DELETE por id inexistente devolvem 404', async () => {
    const g = await fetch(`${base}/api/v1/conversas/nao-existe`);
    assert.strictEqual(g.status, 404);
    const d = await fetch(`${base}/api/v1/conversas/nao-existe`, { method: 'DELETE' });
    assert.strictEqual(d.status, 404);
  });

  it('sem deps.conversas, as rotas nao existem (404 de rota, nao de app quebrado)', async () => {
    const srv = http.createServer(criarApp({}).handler);
    await new Promise((r) => srv.listen(0, r));
    const porta = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${porta}/api/v1/conversas`);
    assert.strictEqual(r.status, 404);
    srv.close();
  });

  // Regressao alvo: uma versao anterior desta rota buscava com
  // `repo.listar(1000).find((c) => c.id === id)` — funciona sempre que a conversa esta
  // entre as 1000 mais recentemente atualizadas, e devolve 404 (silencioso, sem indicio
  // de bug) para qualquer conversa mais antiga que isso. `repo.obter(id)` busca direto
  // por chave primaria e nao tem esse limite. Este teste so falha sob a versao antiga.
  it('GET por id encontra conversa fora das 1000 mais recentes (nao usa listar(1000).find)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-1000-'));
    const conRaw = db.abrir(path.join(dir, 'jur.db'));
    const repoGrande = conversas.criarRepositorio(conRaw);

    const maisAntiga = repoGrande.criar();
    // ATUALIZA a mais antiga direto no banco para um atualizado_em muito no passado —
    // nao basta cria-la primeiro e seguir criando: `criar()` usa Date.now(), e Date.now()
    // tem resolucao de 1ms, entao criar 1005 conversas em sequencia pode empatar varias
    // no mesmo milissegundo. Num empate, ORDER BY atualizado_em DESC do SQLite e um sort
    // ESTAVEL sobre a ordem de varredura (rowid ascendente = ordem de insercao), entao a
    // "mais antiga" pode acabar bem NO TOPO do grupo empatado — o oposto do que o teste
    // precisa, e de forma nao deterministica (medido: falhou em 2 de 3 execucoes locais
    // sem este ajuste). Forcar o valor aqui elimina a corrida.
    conRaw.prepare('UPDATE conversa SET atualizado_em = 0 WHERE id = ?').run(maisAntiga.id);
    for (let i = 0; i < 1005; i++) repoGrande.criar();

    // Pre-condicao do teste: confirma que o cenario realmente empurrou a mais antiga
    // para fora do topo 1000 por recencia — sem isso o teste passaria por acidente,
    // mesmo com o bug de volta.
    assert.ok(
      !repoGrande.listar(1000).some((c) => c.id === maisAntiga.id),
      'pre-condicao do teste: a conversa mais antiga precisa estar fora das 1000 mais recentes',
    );

    const srv = http.createServer(criarApp({ conversas: repoGrande }).handler);
    await new Promise((r) => srv.listen(0, r));
    const porta = srv.address().port;
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/v1/conversas/${maisAntiga.id}`);
      assert.strictEqual(r.status, 200, 'a rota deveria achar a conversa por PK mesmo fora do topo 1000 por recencia');
      const corpo = await r.json();
      assert.strictEqual(corpo.id, maisAntiga.id);
    } finally { srv.close(); }
  });
});

describe('chat.js grava o turno na conversa quando conversaId vem no corpo', () => {
  let chaveOriginal;
  before(() => { chaveOriginal = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  after(() => {
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  function subir(deps) {
    return new Promise((resolve) => {
      const srv = http.createServer(criarApp(deps).handler);
      srv.listen(0, () => resolve(srv));
    });
  }

  it('grava usuario, tool_use, tool_result e resposta final — nada achatado', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-chat-'));
    const repoChat = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
    const c = repoChat.criar();
    const clienteLLM = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'resposta final' }] },
    ]);
    const srv = await subir({ conversas: repoChat, clienteLLM });
    const porta = srv.address().port;
    try {
      const resp = await fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'quais tribunais?' }] }),
      });
      assert.strictEqual(resp.status, 200);
      await resp.text(); // drena o SSE ate o fim

      const m = repoChat.mensagens(c.id);
      assert.strictEqual(m.length, 4, 'usuario + assistant(tool_use) + user(tool_result) + assistant(texto final)');
      assert.strictEqual(m[0].papel, 'user');
      assert.strictEqual(m[0].conteudo, 'quais tribunais?');
      assert.strictEqual(m[1].papel, 'assistant');
      assert.deepStrictEqual(m[1].conteudo, [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: {} }]);
      assert.strictEqual(m[2].papel, 'user');
      assert.strictEqual(m[2].conteudo[0].type, 'tool_result');
      assert.strictEqual(m[2].conteudo[0].tool_use_id, 'tu1');
      assert.strictEqual(m[3].papel, 'assistant');
      // llm.conversar grava sempre mensagem.content bruto (array de blocos da Messages
      // API), nunca o texto achatado — mesmo quando so ha um bloco de texto.
      assert.deepStrictEqual(m[3].conteudo, [{ type: 'text', text: 'resposta final' }]);

      const titulo = repoChat.listar().find((x) => x.id === c.id).titulo;
      assert.match(titulo, /tribunais/);
    } finally { srv.close(); }
  });

  it('conversaId inexistente devolve 404 em portugues, sem chamar o LLM', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-chat-404-'));
    const repoChat = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
    const clienteLLM = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca deveria rodar' }] }]);
    let chamadas = 0;
    const original = clienteLLM.messages.stream.bind(clienteLLM.messages);
    clienteLLM.messages.stream = (p, o) => { chamadas++; return original(p, o); };

    const srv = await subir({ conversas: repoChat, clienteLLM });
    const porta = srv.address().port;
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: 'nao-existe-de-verdade', mensagens: [{ role: 'user', content: 'oi' }] }),
      });
      assert.strictEqual(r.status, 404);
      const corpo = await r.json();
      assert.match(corpo.erro, /conversa|encontrada/i);
      assert.strictEqual(chamadas, 0, 'o LLM nunca deveria ser chamado quando a conversa nao existe');
      assert.strictEqual(repoChat.listar().length, 0, 'nenhuma conversa deveria ter sido criada como efeito colateral');
    } finally { srv.close(); }
  });

  it('desconexao no meio da chamada ao LLM: so a mensagem do usuario fica gravada, e o signal realmente disparou', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-chat-abort-'));
    const repoChat = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
    const c = repoChat.criar();
    const estado = { abortou: false };
    const clienteLLM = clienteQueTravaAteAbortar(estado);
    const srv = await subir({ conversas: repoChat, clienteLLM });
    const porta = srv.address().port;
    try {
      const controlador = new AbortController();
      const chegou = fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'ola' }] }),
        signal: controlador.signal,
      }).catch(() => {}); // abortar o fetch do lado do cliente rejeita a promise — esperado

      // Espera a mensagem do usuario aparecer no banco (prova que a rota ja passou da
      // gravacao inicial e esta parada dentro da chamada ao LLM, que nunca resolve
      // sozinha neste cliente falso).
      let gravada;
      for (let tentativa = 0; tentativa < 100 && !gravada; tentativa++) {
        await new Promise((r) => setTimeout(r, 10));
        gravada = repoChat.mensagens(c.id).length > 0;
      }
      assert.ok(gravada, 'a mensagem do usuario deveria ter sido gravada antes da chamada ao LLM');
      assert.strictEqual(repoChat.mensagens(c.id).length, 1);
      assert.strictEqual(estado.abortou, false, 'pre-condicao: o signal nao pode ter disparado antes do abort');

      controlador.abort();
      await chegou;

      // Espera o SIGNAL de fato disparar no cliente falso — NAO um tempo fixo. Um tempo
      // fixo aprova tanto "abortou certinho" quanto "essa chamada travou para sempre e
      // ninguem percebeu": as duas deixam o banco com so a mensagem do usuario dentro de
      // qualquer janela de espera. So `estado.abortou === true` prova que o
      // AbortController do servidor de fato propagou ate o cliente do LLM.
      for (let tentativa = 0; tentativa < 100 && !estado.abortou; tentativa++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.strictEqual(estado.abortou, true,
        'o signal deveria ter disparado abort no cliente do LLM — sem isso este teste so prova '
        + 'que a chamada nunca terminou, nao que ela foi cancelada corretamente');

      const finais = repoChat.mensagens(c.id);
      assert.strictEqual(finais.length, 1, 'nenhuma mensagem nova deveria ter sido gravada apos o abort');
      assert.strictEqual(finais[0].papel, 'user');
      assert.strictEqual(finais[0].conteudo, 'ola');
    } finally { srv.close(); }
  });
});
