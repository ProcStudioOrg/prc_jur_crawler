const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const executorReal = require('../servidor/executor');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jur-jobs-'));

function filaDeTeste(executarFn, concorrencia = 3) {
  const dir = tmpDir();
  return jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    concorrencia,
    executarFn,
    catalogoFn: (comando) => (comando === 'inexistente' ? null
      : { comando, nome: 'X', disponivel: comando !== 'bloqueado', estado: 'ok', nota: '' }),
  });
}

describe('jobs', () => {
  it('roda um job ate concluido e guarda o total', async () => {
    const fila = filaDeTeste(async () => ({ ok: true, total: 2, resultados: [{ a: 1 }, { a: 2 }], arquivo: null, erro: null }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    const job = await fila.aguardar(id);
    assert.strictEqual(job.status, 'concluido');
    assert.strictEqual(job.total, 2);
  });

  it('marca erro quando o crawler falha, e nao concluido com zero', async () => {
    const fila = filaDeTeste(async () => ({ ok: false, total: 0, resultados: [], arquivo: null, erro: 'fora do ar' }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    const job = await fila.aguardar(id);
    assert.strictEqual(job.status, 'erro');
    assert.match(job.erro, /fora do ar/);
  });

  it('recusa tribunal inexistente e tribunal indisponivel', () => {
    const fila = filaDeTeste(async () => ({ ok: true, total: 0, resultados: [] }));
    assert.throws(() => fila.enfileirar('inexistente', {}), /desconhecido/i);
    assert.throws(() => fila.enfileirar('bloqueado', {}), /indispon/i);
  });

  it('aguardar com id inexistente resolve na hora com null, sem travar', async () => {
    const fila = filaDeTeste(async () => ({ ok: true, total: 0, resultados: [] }));
    const resultado = await Promise.race([
      fila.aguardar('id-que-nao-existe'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('aguardar travou por mais de 300ms')), 300)),
    ]);
    assert.strictEqual(resultado, null);
  });

  it('respeita a concorrencia: nunca mais de 3 rodando ao mesmo tempo', async () => {
    let rodando = 0;
    let pico = 0;
    const fila = filaDeTeste(async () => {
      rodando++;
      pico = Math.max(pico, rodando);
      await new Promise((r) => setTimeout(r, 30));
      rodando--;
      return { ok: true, total: 1, resultados: [{}], arquivo: null, erro: null };
    }, 3);
    const ids = Array.from({ length: 9 }, () => fila.enfileirar('stf', { query: 'x' }).id);
    await Promise.all(ids.map((id) => fila.aguardar(id)));
    assert.ok(pico <= 3, `pico de concorrencia foi ${pico}, esperava <= 3`);
    // Nao basta nunca ULTRAPASSAR 3: uma fila travada em 1 (por exemplo, um bug que
    // nunca libera o slot) tambem passaria no assert.ok acima sem ser pega. Prova que
    // o pico de fato CHEGA a usar as 3 vagas de concorrencia.
    assert.strictEqual(pico, 3, `pico de concorrencia foi ${pico}, esperava que chegasse a 3`);
  });

  it('cancela um job que ainda esta na fila', async () => {
    const fila = filaDeTeste(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, total: 0, resultados: [], arquivo: null, erro: null };
    }, 1);
    const primeiro = fila.enfileirar('stf', { query: 'a' });
    const segundo = fila.enfileirar('stf', { query: 'b' });
    assert.strictEqual(fila.cancelar(segundo.id), true);
    assert.strictEqual(fila.obter(segundo.id).status, 'cancelado');
    await fila.aguardar(primeiro.id);
  });

  it('cancelar antes do pid chegar nao deixa processo orfao: aoIniciar mata quando o pid aparece', async () => {
    const chamadasMatarGrupo = [];
    const matarGrupoOriginal = executorReal.matarGrupo;
    executorReal.matarGrupo = (pid) => chamadasMatarGrupo.push(pid);
    try {
      let aoIniciarCapturado;
      let resolverExecucao;
      const fila = filaDeTeste((comando, params, extra) => {
        aoIniciarCapturado = extra.aoIniciar;
        return new Promise((resolve) => { resolverExecucao = resolve; });
      }, 1);
      const { id } = fila.enfileirar('stf', { query: 'x' });
      // deixa o bombear() colocar o job em 'rodando' antes de cancelar, mas cancela
      // ANTES de aoIniciar disparar (pid ainda desconhecido nesse instante)
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(fila.obter(id).status, 'rodando');
      assert.strictEqual(fila.cancelar(id), true);
      assert.deepStrictEqual(chamadasMatarGrupo, []); // ainda nao tinha pid pra matar
      // so agora o pid "chega", depois do cancelamento
      aoIniciarCapturado(4321);
      assert.deepStrictEqual(chamadasMatarGrupo, [4321]); // aoIniciar matou assim que soube
      resolverExecucao({ ok: false, total: 0, resultados: [], arquivo: null, erro: 'morto' });
      const job = await fila.aguardar(id);
      assert.strictEqual(job.status, 'cancelado');
    } finally {
      executorReal.matarGrupo = matarGrupoOriginal;
    }
  });

  it('emite eventos de inicio e fim', async () => {
    const vistos = [];
    const fila = filaDeTeste(async () => ({ ok: true, total: 1, resultados: [{}], arquivo: null, erro: null }));
    fila.aoEvento((e) => vistos.push(e.tipo));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    await fila.aguardar(id);
    assert.ok(vistos.includes('iniciado'));
    assert.ok(vistos.includes('concluido'));
  });

  // I6 (revisao final): `rodar()` e async e o call site em bombear() nao a aguardava; o
  // try/catch cobria SO o executarFn. Um throw de con.prepare(...).run() no UPDATE de
  // conclusao (SQLITE_FULL com /dados cheio), de obter(), ou do JSON.parse de
  // params_json virava unhandled rejection — e o Node 22 derruba o processo, levando
  // junto TODO cliente SSE e TODO job em voo.
  describe('falha do banco dentro de rodar() nao derruba o processo (I6)', () => {
    /** Conexao real com um `prepare` que sabota o SQL escolhido. */
    function conSabotado(caminho, deveQuebrar) {
      const real = db.abrir(caminho);
      return { prepare: (sql) => { deveQuebrar(sql); return real.prepare(sql); } };
    }

    function filaComCon(con, dir, executarFn) {
      return jobs.criarFila({
        con,
        dirResultados: dir,
        concorrencia: 1,
        executarFn,
        catalogoFn: (comando) => ({ comando, nome: 'X', disponivel: true, estado: 'ok', nota: '' }),
      });
    }

    async function semRejeicaoNaoTratada(corpo) {
      const rejeicoes = [];
      const ouvinte = (e) => rejeicoes.push(e);
      process.on('unhandledRejection', ouvinte);
      try {
        const r = await corpo();
        // Deixa qualquer rejeicao pendente aflorar antes de julgar.
        await new Promise((res) => setTimeout(res, 50));
        assert.deepStrictEqual(
          rejeicoes.map((e) => (e && e.message) || String(e)), [],
          'nenhuma rejeicao pode escapar: no Node 22 ela mata o processo inteiro',
        );
        return r;
      } finally { process.off('unhandledRejection', ouvinte); }
    }

    it('SQLITE_FULL no UPDATE de conclusao vira job com erro, sem unhandled rejection e sem travar aguardar()', async () => {
      const dir = tmpDir();
      let armado = false;
      const con = conSabotado(path.join(dir, 'jur.db'), (sql) => {
        if (armado && /status='concluido'/.test(sql)) throw new Error('SQLITE_FULL: database or disk is full');
      });
      const fila = filaComCon(con, dir, async () => {
        armado = true; // so sabota depois que o job ja esta rodando
        return { ok: true, total: 7, resultados: [], arquivo: null, erro: null };
      });

      const job = await semRejeicaoNaoTratada(async () => {
        const { id } = fila.enfileirar('stf', { query: 'x' });
        return Promise.race([
          fila.aguardar(id),
          new Promise((_, rej) => setTimeout(() => rej(new Error('aguardar travou: ninguem liberou quem esperava')), 2000)),
        ]);
      });

      assert.ok(job, 'aguardar precisa resolver, nao travar');
      assert.strictEqual(job.status, 'erro');
      assert.match(job.erro, /falha interna da fila/);
      assert.match(job.erro, /SQLITE_FULL/);
    });

    it('falha ja no UPDATE de inicio tambem e contida, e a fila continua bombeando o proximo job', async () => {
      const dir = tmpDir();
      let sabotarInicio = true;
      const con = conSabotado(path.join(dir, 'jur.db'), (sql) => {
        if (sabotarInicio && /status='rodando'/.test(sql)) {
          sabotarInicio = false; // so o primeiro job quebra
          throw new Error('SQLITE_FULL: database or disk is full');
        }
      });
      const fila = filaComCon(con, dir, async () => ({ ok: true, total: 1, resultados: [], arquivo: null, erro: null }));

      const [primeiro, segundo] = await semRejeicaoNaoTratada(async () => {
        const a = fila.enfileirar('stf', { query: 'a' });
        const b = fila.enfileirar('stf', { query: 'b' });
        return Promise.all([
          Promise.race([fila.aguardar(a.id), new Promise((_, rej) => setTimeout(() => rej(new Error('travou no primeiro')), 2000))]),
          Promise.race([fila.aguardar(b.id), new Promise((_, rej) => setTimeout(() => rej(new Error('travou no segundo')), 2000))]),
        ]);
      });

      assert.strictEqual(primeiro.status, 'erro');
      assert.strictEqual(segundo.status, 'concluido',
        'a fila precisa continuar processando: um job que explodiu nao pode parar a fila');
    });
  });

  // C3 (revisao final): NENHUM dos 107 testes cobria falha de leitura — e ela devolvia
  // {total: job.total, itens: []} sem sinal nenhum, identico a uma busca legitimamente
  // vazia. Gatilhos reais e banais: `docker compose down -v`, disco cheio, remontagem
  // de /dados. Com job concluido e total 42, o REST respondia {"total":42,"itens":[]},
  // que e uma contradicao que o cliente le como "nao veio julgado nenhum".
  describe('falha de leitura do arquivo de resultados (C3)', () => {
    it('arquivo ausente vira erro explicito, nao pagina vazia', async () => {
      const dir = tmpDir();
      const arquivo = path.join(dir, 'sumiu.json');
      fs.writeFileSync(arquivo, JSON.stringify(Array.from({ length: 42 }, (_, i) => ({ n: i }))));
      const fila = filaDeTeste(async () => ({ ok: true, total: 42, resultados: [], arquivo, erro: null }));
      const { id } = fila.enfileirar('stf', { query: 'x' });
      await fila.aguardar(id);
      assert.strictEqual(fila.resultados(id, 0, 20).erro, null, 'antes de sumir, sem erro');

      fs.unlinkSync(arquivo); // `docker compose down -v` / disco remontado
      const pagina = fila.resultados(id, 0, 20);
      assert.strictEqual(pagina.itens.length, 0);
      assert.strictEqual(pagina.total, 42);
      assert.ok(pagina.erro, 'total 42 com itens [] PRECISA carregar erro; sem ele e busca vazia disfarcada');
      assert.match(pagina.erro, /ausente/i);
      assert.match(fila.erroDeLeitura(fila.obter(id)), /ausente/i);
    });

    it('JSON corrompido vira erro explicito, nao pagina vazia', async () => {
      const dir = tmpDir();
      const arquivo = path.join(dir, 'corrompido.json');
      fs.writeFileSync(arquivo, '[{"n":1},{"n":2'); // truncado (disco cheio no meio da escrita)
      const fila = filaDeTeste(async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }));
      const { id } = fila.enfileirar('stf', { query: 'x' });
      await fila.aguardar(id);
      const pagina = fila.resultados(id, 0, 20);
      assert.strictEqual(pagina.itens.length, 0);
      assert.ok(pagina.erro, 'JSON ilegivel PRECISA carregar erro');
      assert.match(pagina.erro, /ilegivel/i);
    });

    it('job que ainda nao terminou NAO e falha de leitura — so ainda nao tem arquivo', async () => {
      const fila = filaDeTeste(() => new Promise(() => {}));
      const { id } = fila.enfileirar('stf', { query: 'x' });
      const pagina = fila.resultados(id, 0, 20);
      assert.strictEqual(pagina.erro, null);
      assert.strictEqual(fila.erroDeLeitura(fila.obter(id)), null);
    });

    it('caminho feliz continua com erro null', async () => {
      const dir = tmpDir();
      const arquivo = path.join(dir, 'ok.json');
      fs.writeFileSync(arquivo, JSON.stringify([{ n: 1 }]));
      const fila = filaDeTeste(async () => ({ ok: true, total: 1, resultados: [], arquivo, erro: null }));
      const { id } = fila.enfileirar('stf', { query: 'x' });
      await fila.aguardar(id);
      assert.deepStrictEqual(fila.resultados(id, 0, 20).erro, null);
    });
  });

  it('pagina os resultados a partir do arquivo', async () => {
    const dir = tmpDir();
    const arquivo = path.join(dir, 'r.json');
    fs.writeFileSync(arquivo, JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ n: i }))));
    const fila = filaDeTeste(async () => ({ ok: true, total: 25, resultados: [], arquivo, erro: null }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    await fila.aguardar(id);
    const pagina = fila.resultados(id, 10, 5);
    assert.strictEqual(pagina.total, 25);
    assert.strictEqual(pagina.itens.length, 5);
    assert.strictEqual(pagina.itens[0].n, 10);
  });
});
