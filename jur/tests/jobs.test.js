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
