const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const conversas = require('../servidor/conversas');
const jobs = require('../servidor/jobs');
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
/** Le um corpo SSE completo (`event: X\ndata: Y\n\n`) e devolve a lista de eventos. */
function analisarSSE(texto) {
  return texto.split('\n\n').filter(Boolean).map((bloco) => {
    const linhas = bloco.split('\n');
    const linhaEvento = linhas.find((l) => l.startsWith('event: '));
    const linhaDado = linhas.find((l) => l.startsWith('data: '));
    if (!linhaEvento) return null; // comentario (': ping')
    return { evento: linhaEvento.slice(7), dado: linhaDado ? JSON.parse(linhaDado.slice(6)) : undefined };
  }).filter(Boolean);
}

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

  // ANTES este teste fixava o oposto: desconectar abortava a chamada e a conversa
  // ficava so com a pergunta do usuario. Era exatamente a falha relatada — fechar o
  // navegador matava a conversa. Com persistencia ligada (conversaId) o turno agora
  // sobrevive, e o que este teste guarda e que o signal NAO dispara mais.
  it('com conversaId, desconectar NAO aborta a chamada ao LLM', async () => {
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
      }).catch(() => {});

      let gravada;
      for (let tentativa = 0; tentativa < 100 && !gravada; tentativa++) {
        await new Promise((r) => setTimeout(r, 10));
        gravada = repoChat.mensagens(c.id).length > 0;
      }
      assert.ok(gravada, 'a mensagem do usuario deveria ter sido gravada antes da chamada ao LLM');

      controlador.abort();
      await chegou;
      // Janela generosa: se o abort fosse propagar, propagaria bem antes disto.
      await new Promise((r) => setTimeout(r, 300));

      assert.strictEqual(estado.abortou, false,
        'abortar aqui joga fora o turno inteiro so porque o usuario fechou a aba');
    } finally { srv.close(); }
  });
});

/**
 * CONTINUIDADE. Fechar o navegador matava a conversa: o `res.on('close')` de
 * rotas/chat.js abortava a chamada da Anthropic e cancelava as buscas daquela conversa.
 * O usuario voltava e encontrava so a propria pergunta gravada — sem resposta e sem
 * nenhum sinal de que algo tinha sido interrompido. Buscas de jurisprudencia levam
 * minutos: sair da tela enquanto rodam e o caso normal, nao o excepcional.
 */
describe('continuidade — o turno sobrevive ao cliente ir embora', () => {
  let chaveOriginal;
  before(() => { chaveOriginal = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  after(() => {
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  const subir = (deps) => new Promise((resolve) => {
    const srv = http.createServer(criarApp(deps).handler);
    srv.listen(0, () => resolve(srv));
  });
  const adormecer = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Cliente do SDK que so responde quando o teste mandar, e que REGISTRA se o signal
   * disparou. Sem `estado.abortou` um cliente falso que ignora o signal faria o teste
   * passar mesmo com o abort intacto — provaria so que o texto chegou, nao que a
   * desconexao deixou de matar o turno.
   */
  function clienteControlado() {
    let liberar;
    const presa = new Promise((r) => { liberar = r; });
    let chegou;
    const chamado = new Promise((r) => { chegou = r; });
    const estado = { abortou: false };
    return {
      liberar,
      chamado,
      estado,
      cliente: {
        messages: {
          stream(params, opcoes) {
            const sinal = opcoes && opcoes.signal;
            if (sinal) sinal.addEventListener('abort', () => { estado.abortou = true; });
            const ouvintes = {};
            const p = {
              on(evento, fn) { ouvintes[evento] = fn; return p; },
              async finalMessage() {
                if (ouvintes.text) ouvintes.text('parcial ');
                chegou();
                await presa;
                if (ouvintes.text) ouvintes.text('e o resto');
                return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'parcial e o resto' }] };
              },
            };
            return p;
          },
        },
      },
    };
  }

  function ambiente(nome) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jur-cont-${nome}-`));
    return conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
  }

  it('cliente desconecta no meio: o turno termina e a resposta INTEIRA fica gravada', async () => {
    const repoC = ambiente('desconecta');
    const c = repoC.criar();
    const { cliente, liberar, chamado, estado } = clienteControlado();
    const srv = await subir({ conversas: repoC, clienteLLM: cliente });
    const porta = srv.address().port;
    try {
      const controlador = new AbortController();
      const req = fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: controlador.signal,
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'pergunta' }] }),
      }).catch(() => {});
      await chamado;

      controlador.abort();          // fecha o navegador
      await req;
      await adormecer(50);
      assert.strictEqual(estado.abortou, false,
        'o signal nao pode disparar: e ele que matava a conversa quando o navegador fechava');
      liberar();                    // a LLM responde DEPOIS de o cliente sumir

      for (let i = 0; i < 200 && repoC.mensagens(c.id).length < 2; i++) await adormecer(10);
      const m = repoC.mensagens(c.id);
      assert.strictEqual(m.length, 2,
        'sem isto a conversa fica so com a pergunta do usuario, como se nada tivesse acontecido');
      assert.strictEqual(m[1].papel, 'assistant');
      assert.match(JSON.stringify(m[1].conteudo), /e o resto/,
        'o turno precisa chegar ao FIM, nao parar onde a conexao caiu');
    } finally { srv.close(); }
  });

  it('a busca em andamento NAO e mais cancelada quando o cliente vai embora', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-cont-job-'));
    const con = db.abrir(path.join(dir, 'jur.db'));
    const repoC = conversas.criarRepositorio(con);
    const filaLenta = jobs.criarFila({
      con, dirResultados: dir, executarFn: () => new Promise(() => {}),
    });
    const c = repoC.criar();
    const clienteLLM = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } }] },
    ]);
    const srv = await subir({ conversas: repoC, fila: filaLenta, clienteLLM });
    const porta = srv.address().port;
    try {
      const controlador = new AbortController();
      const req = fetch(`http://127.0.0.1:${porta}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: controlador.signal,
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'busca no stf' }] }),
      }).catch(() => {});

      let job;
      for (let i = 0; i < 200 && !job; i++) {
        await adormecer(10);
        job = filaLenta.listar().find((j) => j.comando === 'stf');
      }
      assert.ok(job, 'o job devia ter sido criado');

      controlador.abort();
      await req;
      await adormecer(150);

      assert.notStrictEqual(filaLenta.obter(job.id).status, 'cancelado',
        'cancelar aqui joga fora minutos de crawl justamente quando o usuario saiu para esperar');
    } finally { srv.close(); }
  });

  it('a lista de conversas marca qual esta em andamento', async () => {
    const repoC = ambiente('lista');
    const c = repoC.criar();
    const { cliente, liberar, chamado } = clienteControlado();
    const srv = await subir({ conversas: repoC, clienteLLM: cliente });
    const porta = srv.address().port;
    const base = `http://127.0.0.1:${porta}`;
    try {
      const lista = async () => (await (await fetch(`${base}/api/v1/conversas`)).json()).conversas;
      assert.strictEqual((await lista()).find((x) => x.id === c.id).emAndamento, false);

      const req = fetch(`${base}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'oi' }] }),
      });
      await chamado;
      assert.strictEqual((await lista()).find((x) => x.id === c.id).emAndamento, true,
        'e este campo que acende o icone de "rodando" na lateral');

      liberar();
      await (await req).text();
      assert.strictEqual((await lista()).find((x) => x.id === c.id).emAndamento, false);
    } finally { srv.close(); }
  });

  it('reanexar ao stream reproduz o que passou e continua ao vivo', async () => {
    const repoC = ambiente('reanexa');
    const c = repoC.criar();
    const { cliente, liberar, chamado } = clienteControlado();
    const srv = await subir({ conversas: repoC, clienteLLM: cliente });
    const porta = srv.address().port;
    const base = `http://127.0.0.1:${porta}`;
    try {
      const req = fetch(`${base}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'oi' }] }),
      });
      await chamado;

      const fluxo = await fetch(`${base}/api/v1/conversas/${c.id}/stream`);
      assert.strictEqual(fluxo.status, 200);
      const lendo = fluxo.text();

      liberar();
      const eventos = analisarSSE(await lendo);
      await (await req).text();

      const textos = eventos.filter((e) => e.evento === 'texto').map((e) => e.dado.texto).join('');
      assert.match(textos, /parcial /,
        'quem reabre a conversa no meio precisa ver o que ja tinha chegado, nao a resposta comecando do nada');
      assert.match(textos, /e o resto/, 'e depois continuar recebendo ao vivo');
      assert.ok(eventos.some((e) => e.evento === 'fim'), 'o stream reanexado tambem recebe o fim');
    } finally { srv.close(); }
  });

  it('stream de conversa sem turno vivo fecha na hora em vez de pendurar o cliente', async () => {
    const repoC = ambiente('semturno');
    const c = repoC.criar();
    const srv = await subir({ conversas: repoC });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/conversas/${c.id}/stream`);
      assert.strictEqual(r.status, 200);
      const eventos = analisarSSE(await r.text());
      assert.deepStrictEqual(eventos.map((e) => e.evento), ['encerrado'],
        'sem este aviso o cliente fica com a conexao aberta esperando um turno que nao existe');
    } finally { srv.close(); }
  });

  it('stream de conversa inexistente e 404, nao um SSE vazio', async () => {
    const repoC = ambiente('inexistente');
    const srv = await subir({ conversas: repoC });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/conversas/nao-existe/stream`);
      assert.strictEqual(r.status, 404);
    } finally { srv.close(); }
  });

  it('segundo POST na mesma conversa com turno vivo e recusado com 409', async () => {
    const repoC = ambiente('duplo');
    const c = repoC.criar();
    const { cliente, liberar, chamado } = clienteControlado();
    const srv = await subir({ conversas: repoC, clienteLLM: cliente });
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const primeiro = fetch(`${base}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'um' }] }),
      });
      await chamado;

      const segundo = await fetch(`${base}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'dois' }] }),
      });
      assert.strictEqual(segundo.status, 409,
        'dois turnos concorrentes gravariam mensagens intercaladas e o historico voltaria fora de ordem');
      assert.strictEqual(repoC.mensagens(c.id).filter((m) => m.conteudo === 'dois').length, 0,
        'o turno recusado nao pode deixar a pergunta gravada como se tivesse rodado');

      liberar();
      await (await primeiro).text();
    } finally { srv.close(); }
  });
});

/**
 * VINCULO CONVERSA -> BUSCA. Sem isto nao ha como responder "o que ESTA analise leu":
 * depois de um F5, os job_id so existiam dentro do TEXTO dos tool_result, e a coluna
 * `mensagem.job_id` sempre foi NULL. Ela tambem nao serviria: um turno pode disparar
 * varias buscas em paralelo (o modelo paraleliza tool_use), e uma coluna nao comporta N.
 * Dai uma tabela propria.
 */
describe('conversas — buscas vinculadas', () => {
  it('vincula e devolve na ordem em que foram feitas', () => {
    const c = repo.criar();
    repo.vincularBusca(c.id, 'job-a');
    repo.vincularBusca(c.id, 'job-b');
    assert.deepStrictEqual(repo.buscas(c.id), ['job-a', 'job-b']);
  });

  it('conversa sem busca devolve lista vazia, nao erro', () => {
    assert.deepStrictEqual(repo.buscas(repo.criar().id), []);
  });

  it('o mesmo job vinculado duas vezes aparece uma vez so', () => {
    const c = repo.criar();
    repo.vincularBusca(c.id, 'job-x');
    repo.vincularBusca(c.id, 'job-x');
    assert.deepStrictEqual(repo.buscas(c.id), ['job-x']);
  });

  it('buscas de uma conversa nao vazam para outra', () => {
    const a = repo.criar();
    const b = repo.criar();
    repo.vincularBusca(a.id, 'so-de-a');
    assert.deepStrictEqual(repo.buscas(b.id), []);
  });

  it('apagar a conversa leva os vinculos junto — senao a tabela cresce para sempre', () => {
    const c = repo.criar();
    repo.vincularBusca(c.id, 'job-z');
    repo.apagar(c.id);
    assert.deepStrictEqual(repo.buscas(c.id), []);
  });
});

/**
 * A ponta que o drawer consome: quais buscas ESTA conversa disparou, ja com tribunal,
 * query, status e total. E o vinculo precisa ser gravado enquanto o turno roda — nao no
 * fim —, senao uma busca que demora minutos fica invisivel exatamente durante os minutos
 * em que o usuario quer olhar para ela.
 */
describe('buscas da conversa — do chat ate a rota', () => {
  let chaveOriginal;
  before(() => { chaveOriginal = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  after(() => {
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = chaveOriginal;
  });

  const subir = (deps) => new Promise((resolve) => {
    const srv = http.createServer(criarApp(deps).handler);
    srv.listen(0, () => resolve(srv));
  });

  function montar(nome) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jur-dec-${nome}-`));
    const con = db.abrir(path.join(dir, 'jur.db'));
    const arquivo = path.join(dir, 'saida.json');
    fs.writeFileSync(arquivo, JSON.stringify([
      { processo: '0000627-73.2019.8.16.0080', relator: 'FULANO', ementa: 'usucapiao' },
      { processo: '0043348-93.2013.8.16.0001', relator: 'BELTRANO', ementa: 'metragem' },
    ]));
    const fila = jobs.criarFila({
      con, dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }),
    });
    return { con, fila, repo: conversas.criarRepositorio(con) };
  }

  it('o chat vincula a busca a conversa, e a rota devolve com os dados do job', async () => {
    const { fila, repo: repoC } = montar('fluxo');
    const c = repoC.criar();
    const clienteLLM = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'usucapiao' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'achei' }] },
    ]);
    const srv = await subir({ conversas: repoC, fila, clienteLLM });
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await fetch(`${base}/api/v1/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversaId: c.id, mensagens: [{ role: 'user', content: 'busca' }] }),
      });
      await r.text();

      const { buscas } = await (await fetch(`${base}/api/v1/conversas/${c.id}/buscas`)).json();
      assert.strictEqual(buscas.length, 1);
      assert.strictEqual(buscas[0].comando, 'stf');
      assert.strictEqual(buscas[0].status, 'concluido');
      assert.strictEqual(buscas[0].total, 2);
      assert.strictEqual(buscas[0].params.query, 'usucapiao',
        'sem a query o drawer nao consegue dizer QUAL busca foi essa');

      // E os julgados vem pela rota que ja existia, pelo id que acabamos de descobrir.
      const pagina = await (await fetch(`${base}/api/v1/buscas/${buscas[0].id}/resultados`)).json();
      assert.strictEqual(pagina.itens.length, 2);
      assert.match(JSON.stringify(pagina.itens), /0000627-73/);
    } finally { srv.close(); }
  });

  it('conversa sem busca devolve lista vazia', async () => {
    const { repo: repoC } = montar('vazia');
    const c = repoC.criar();
    const srv = await subir({ conversas: repoC });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/conversas/${c.id}/buscas`);
      assert.deepStrictEqual((await r.json()).buscas, []);
    } finally { srv.close(); }
  });

  it('conversa inexistente e 404', async () => {
    const { repo: repoC } = montar('inexistente');
    const srv = await subir({ conversas: repoC });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/conversas/nao-existe/buscas`);
      assert.strictEqual(r.status, 404);
    } finally { srv.close(); }
  });

  it('job vinculado que sumiu do banco nao derruba a rota', async () => {
    const { repo: repoC, fila } = montar('orfao');
    const c = repoC.criar();
    repoC.vincularBusca(c.id, 'job-que-nao-existe');
    const srv = await subir({ conversas: repoC, fila });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/conversas/${c.id}/buscas`);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual((await r.json()).buscas, [],
        'vinculo orfao some da lista em vez de virar uma linha vazia sem dado nenhum');
    } finally { srv.close(); }
  });
});
