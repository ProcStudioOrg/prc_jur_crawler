const assert = require('node:assert');
const { describe, it } = require('node:test');
const turnos = require('../servidor/turnos');

/**
 * O registro de turnos vivos existe para desamarrar um turno de chat da conexao HTTP que
 * o pediu. Antes disto, fechar o navegador abortava a chamada da Anthropic e cancelava
 * as buscas da conversa (rotas/chat.js, `aoDesconectar`): o usuario voltava e a conversa
 * simplesmente tinha morrido no meio, sem nada gravado alem da propria pergunta.
 *
 * O registro e so MEMORIA: reiniciar o servidor mata o turno, do mesmo jeito que a fila
 * de jobs ja marca 'interrompido por reinicio do servidor'. Retomar uma chamada da
 * Anthropic pela metade nao e possivel, entao persistir o estado do turno so mudaria a
 * mensagem, nao o desfecho.
 */
const adormecer = (ms) => new Promise((r) => setTimeout(r, ms));

describe('turnos — registro de turnos vivos por conversa', () => {
  it('conversa sem turno nao esta em andamento', () => {
    const r = turnos.criarRegistro();
    assert.strictEqual(r.emAndamento('c1'), false);
    assert.deepStrictEqual(r.conversasEmAndamento(), []);
  });

  it('marca a conversa em andamento enquanto a tarefa roda e desmarca no fim', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    const rodando = r.executar('c1', async () => { await presa; });

    await adormecer(5);
    assert.strictEqual(r.emAndamento('c1'), true);
    assert.deepStrictEqual(r.conversasEmAndamento(), ['c1']);

    liberar();
    await rodando;
    assert.strictEqual(r.emAndamento('c1'), false);
  });

  it('desmarca tambem quando a tarefa lanca — turno preso trava a conversa para sempre', async () => {
    const r = turnos.criarRegistro();
    await assert.rejects(r.executar('c1', async () => { throw new Error('estourou'); }), /estourou/);
    assert.strictEqual(r.emAndamento('c1'), false);
  });

  it('recusa um segundo turno na mesma conversa', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    const primeiro = r.executar('c1', async () => { await presa; });
    await adormecer(5);

    await assert.rejects(
      r.executar('c1', async () => {}),
      /em andamento/i,
      'dois turnos na mesma conversa disputariam a ordem das mensagens gravadas',
    );

    liberar();
    await primeiro;
    // Terminado o primeiro, a conversa aceita outro.
    await r.executar('c1', async () => {});
  });

  it('conversas diferentes rodam em paralelo', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    const a = r.executar('c1', async () => { await presa; });
    const b = r.executar('c2', async () => { await presa; });
    await adormecer(5);
    assert.deepStrictEqual(r.conversasEmAndamento().sort(), ['c1', 'c2']);
    liberar();
    await Promise.all([a, b]);
  });

  it('quem anexa depois recebe o que ja passou e depois o que vier', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    let emitirExterno;
    const rodando = r.executar('c1', async (emitir) => {
      emitir('texto', { texto: 'antes' });
      emitirExterno = emitir;
      await presa;
    });
    await adormecer(5);

    const vistos = [];
    const desanexar = r.anexar('c1', (nome, dados) => vistos.push([nome, dados]));
    assert.ok(desanexar, 'turno vivo precisa devolver o desanexar');
    assert.deepStrictEqual(vistos, [['texto', { texto: 'antes' }]],
      'sem reproduzir o que passou, quem reabre no meio ve a resposta comecando do nada');

    emitirExterno('texto', { texto: 'depois' });
    assert.deepStrictEqual(vistos[1], ['texto', { texto: 'depois' }]);

    desanexar();
    emitirExterno('texto', { texto: 'ja saiu' });
    assert.strictEqual(vistos.length, 2, 'desanexado nao pode continuar recebendo');

    liberar();
    await rodando;
  });

  it('anexar numa conversa sem turno vivo devolve null em vez de fingir que ha stream', async () => {
    const r = turnos.criarRegistro();
    assert.strictEqual(r.anexar('inexistente', () => {}), null);
    await r.executar('c1', async (emitir) => { emitir('fim', { texto: 'ok' }); });
    assert.strictEqual(r.anexar('c1', () => {}), null,
      'turno ja encerrado nao pode reproduzir o buffer: o cliente leria do banco E do buffer, duplicando o turno');
  });

  it('ouvinte que quebra nao derruba o turno nem os outros ouvintes', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    let emitirExterno;
    const rodando = r.executar('c1', async (emitir) => { emitirExterno = emitir; await presa; });
    await adormecer(5);

    const bons = [];
    r.anexar('c1', () => { throw new Error('cliente morto'); });
    r.anexar('c1', (nome) => bons.push(nome));
    emitirExterno('texto', { texto: 'x' });
    assert.deepStrictEqual(bons, ['texto'],
      'um SSE que caiu no meio da escrita nao pode levar junto o turno de quem continua ouvindo');

    liberar();
    await rodando;
  });

  it('avisa os ouvintes quando o turno acaba, para o SSE fechar', async () => {
    const r = turnos.criarRegistro();
    let liberar;
    const presa = new Promise((res) => { liberar = res; });
    const rodando = r.executar('c1', async () => { await presa; });
    await adormecer(5);

    let encerrou = false;
    r.anexar('c1', () => {}, () => { encerrou = true; });
    liberar();
    await rodando;
    assert.strictEqual(encerrou, true,
      'sem este aviso o cliente reanexado fica com a conexao aberta esperando para sempre');
  });

  it('o aviso de fim tambem sai quando a tarefa lanca', async () => {
    const r = turnos.criarRegistro();
    let estourar;
    const presa = new Promise((_, rej) => { estourar = rej; });
    const rodando = r.executar('c1', async () => { await presa; }).catch(() => {});
    await adormecer(5);
    let encerrou = false;
    r.anexar('c1', () => {}, () => { encerrou = true; });
    estourar(new Error('x'));
    await rodando;
    assert.strictEqual(encerrou, true);
  });
});
