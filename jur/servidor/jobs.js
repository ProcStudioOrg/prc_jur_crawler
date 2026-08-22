const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const executorPadrao = require('./executor');
const catalogoPadrao = require('./catalogo');

const CONCORRENCIA_PADRAO = Number(process.env.JUR_CONCORRENCIA || 3);

function criarFila(opcoes = {}) {
  const con = opcoes.con;
  const executarFn = opcoes.executarFn || ((comando, params, extra) => executorPadrao.executar(comando, params, extra));
  const catalogoFn = opcoes.catalogoFn || ((comando) => catalogoPadrao.obter(comando));
  const concorrencia = opcoes.concorrencia || CONCORRENCIA_PADRAO;
  const dirResultados = opcoes.dirResultados || path.join(process.env.JUR_DADOS || '/dados', 'resultados');

  fs.mkdirSync(dirResultados, { recursive: true });

  const pendentes = [];
  const rodando = new Map();          // jobId -> {pid}
  const ouvintes = new Set();
  const esperando = new Map();        // jobId -> [resolve]

  // Job que ficou 'rodando' quando o processo morreu nunca vai terminar sozinho.
  con.prepare(`UPDATE job SET status='erro', erro='interrompido por reinicio do servidor',
               terminado_em=? WHERE status IN ('rodando','enfileirado')`).run(Date.now());

  function emitir(evento) {
    for (const fn of ouvintes) {
      try { fn(evento); } catch { /* ouvinte quebrado nao derruba a fila */ }
    }
    if (['concluido', 'erro', 'cancelado'].includes(evento.tipo)) {
      const fila = esperando.get(evento.jobId) || [];
      esperando.delete(evento.jobId);
      for (const resolve of fila) resolve(obter(evento.jobId));
    }
  }

  function linhaParaJob(l) {
    if (!l) return null;
    return {
      id: l.id,
      comando: l.comando,
      params: JSON.parse(l.params_json),
      status: l.status,
      total: l.total,
      arquivo: l.arquivo,
      erro: l.erro,
      criadoEm: l.criado_em,
      terminadoEm: l.terminado_em,
    };
  }

  function obter(id) {
    return linhaParaJob(con.prepare('SELECT * FROM job WHERE id = ?').get(id));
  }

  function listar(limite = 50) {
    return con.prepare('SELECT * FROM job ORDER BY criado_em DESC LIMIT ?').all(limite).map(linhaParaJob);
  }

  function enfileirar(comando, params = {}) {
    const tribunal = catalogoFn(comando);
    if (!tribunal) throw new Error(`tribunal desconhecido: ${comando}`);
    if (!tribunal.disponivel) throw new Error(`tribunal indisponivel: ${comando} (${tribunal.estado})`);

    const id = crypto.randomUUID();
    con.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
                 VALUES (?, ?, ?, 'enfileirado', ?)`).run(id, comando, JSON.stringify(params), Date.now());
    pendentes.push(id);
    setImmediate(bombear);
    return { id, status: 'enfileirado' };
  }

  function bombear() {
    while (rodando.size < concorrencia && pendentes.length) {
      const id = pendentes.shift();
      const job = obter(id);
      if (!job || job.status !== 'enfileirado') continue;   // cancelado enquanto esperava
      rodar(job);
    }
  }

  async function rodar(job) {
    rodando.set(job.id, { pid: null });
    con.prepare(`UPDATE job SET status='rodando', iniciado_em=? WHERE id=?`).run(Date.now(), job.id);
    emitir({ tipo: 'iniciado', jobId: job.id, comando: job.comando });

    const arquivo = path.join(dirResultados, `${job.id}.json`);
    let r;
    try {
      r = await executarFn(job.comando, job.params, {
        arquivoSaida: arquivo,
        aoIniciar: (pid) => {
          const atual = rodando.get(job.id);
          if (atual) atual.pid = pid;
          con.prepare('UPDATE job SET pid=? WHERE id=?').run(pid, job.id);
        },
      });
    } catch (e) {
      r = { ok: false, total: 0, resultados: [], arquivo: null, erro: e.message };
    }

    rodando.delete(job.id);

    // Se foi cancelado no meio, o cancelamento manda: nao sobrescreve.
    if (obter(job.id).status === 'cancelado') { setImmediate(bombear); return; }

    if (r.ok) {
      con.prepare(`UPDATE job SET status='concluido', total=?, arquivo=?, terminado_em=? WHERE id=?`)
        .run(r.total, r.arquivo || arquivo, Date.now(), job.id);
      emitir({ tipo: 'concluido', jobId: job.id, total: r.total });
    } else {
      con.prepare(`UPDATE job SET status='erro', erro=?, terminado_em=? WHERE id=?`)
        .run(r.erro || 'falha desconhecida', Date.now(), job.id);
      emitir({ tipo: 'erro', jobId: job.id, erro: r.erro });
    }
    setImmediate(bombear);
  }

  function cancelar(id) {
    const job = obter(id);
    if (!job || ['concluido', 'erro', 'cancelado'].includes(job.status)) return false;
    const vivo = rodando.get(id);
    if (vivo && vivo.pid) executorPadrao.matarGrupo(vivo.pid);
    rodando.delete(id);
    con.prepare(`UPDATE job SET status='cancelado', terminado_em=? WHERE id=?`).run(Date.now(), id);
    emitir({ tipo: 'cancelado', jobId: id });
    setImmediate(bombear);
    return true;
  }

  function resultados(id, offset = 0, limite = 20) {
    const job = obter(id);
    if (!job || !job.arquivo || !fs.existsSync(job.arquivo)) return { total: job ? job.total : 0, itens: [] };
    let bruto;
    try {
      bruto = JSON.parse(fs.readFileSync(job.arquivo, 'utf8'));
    } catch {
      return { total: job.total, itens: [] };
    }
    const lista = Array.isArray(bruto) ? bruto : (bruto.results || bruto.resultados || []);
    return { total: lista.length, itens: lista.slice(offset, offset + limite) };
  }

  function aguardar(id) {
    const job = obter(id);
    if (job && !['enfileirado', 'rodando'].includes(job.status)) return Promise.resolve(job);
    return new Promise((resolve) => {
      if (!esperando.has(id)) esperando.set(id, []);
      esperando.get(id).push(resolve);
    });
  }

  return {
    enfileirar, obter, listar, cancelar, resultados, aguardar,
    aoEvento: (fn) => ouvintes.add(fn),
    removerOuvinte: (fn) => ouvintes.delete(fn),
    concorrencia,
  };
}

module.exports = { criarFila, CONCORRENCIA_PADRAO };
