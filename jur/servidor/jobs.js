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
  // opcoes.concorrencia === 0 cai no padrao por causa do `||` (0 e falsy) — e proposital:
  // uma fila com concorrencia zero nunca processaria nada (bombear() nunca entraria no
  // laco), entao 0 nao e um valor suportado e cai para o padrao em vez de travar a fila
  // em silencio.
  const concorrencia = opcoes.concorrencia || CONCORRENCIA_PADRAO;
  const dirResultados = opcoes.dirResultados || path.join(process.env.JUR_DADOS || '/dados', 'resultados');

  fs.mkdirSync(dirResultados, { recursive: true });

  const pendentes = [];
  const rodando = new Map();          // jobId -> {pid, cancelado}
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
    rodando.set(job.id, { pid: null, cancelado: false });
    con.prepare(`UPDATE job SET status='rodando', iniciado_em=? WHERE id=?`).run(Date.now(), job.id);
    emitir({ tipo: 'iniciado', jobId: job.id, comando: job.comando });

    const arquivo = path.join(dirResultados, `${job.id}.json`);
    let r;
    try {
      r = await executarFn(job.comando, job.params, {
        arquivoSaida: arquivo,
        // IMPORTANTE: isto so funciona porque o executor real chama aoIniciar de forma
        // SINCRONA logo apos o spawn (ver comentario em executor.js). Se cancelar() for
        // chamado enquanto o pid ainda e null, ele marca `atual.cancelado = true` em vez
        // de matar; e aqui, quando o pid finalmente chega, conferimos essa marca e matamos
        // o processo tardiamente — em vez de deixar o Chromium orfao porque a entrada em
        // `rodando` sumiu antes do pid aparecer.
        aoIniciar: (pid) => {
          const atual = rodando.get(job.id);
          if (atual) {
            atual.pid = pid;
            if (atual.cancelado) executorPadrao.matarGrupo(pid);
          }
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
    if (vivo) {
      if (vivo.pid) {
        executorPadrao.matarGrupo(vivo.pid);
      } else {
        // O pid ainda nao chegou (aoIniciar pode nao ter disparado). Nao apagamos a
        // entrada de `rodando` aqui — se apagassemos, quando aoIniciar chegasse depois
        // com o pid real, `rodando.get(job.id)` seria undefined e ninguem mais tentaria
        // matar aquele processo (Chromium orfao). Em vez disso marcamos "cancelado
        // aguardando pid" e deixamos o proprio aoIniciar matar assim que o pid aparecer.
        // A entrada continua existindo (e contando pra concorrencia) ate `rodar()` fazer
        // `rodando.delete()` apos o `await` resolver, o que so acontece quando o processo
        // de fato termina.
        vivo.cancelado = true;
      }
    }
    con.prepare(`UPDATE job SET status='cancelado', terminado_em=? WHERE id=?`).run(Date.now(), id);
    emitir({ tipo: 'cancelado', jobId: id });
    setImmediate(bombear);
    return true;
  }

  function resultados(id, offset = 0, limite = 20) {
    // DIVIDA TECNICA: leitura sincrona (fs.readFileSync + JSON.parse) num processo unico
    // que tambem serve HTTP, MCP, chat e despacha os outros jobs da fila. Um arquivo de
    // resultados grande bloqueia o event loop inteiro enquanto le E parseia — a CADA
    // pagina pedida, nao so na primeira, porque nada aqui e cacheado. Sob carga (varias
    // paginas pedidas em sequencia, ou um job grande concluindo enquanto alguem pagina)
    // isso trava toda a fila e todas as outras rotas por alguns ms a segundos, proporcional
    // ao tamanho do arquivo. Saida futura: (a) trocar por leitura assincrona
    // (fs.promises.readFile) — muda a assinatura de `resultados` para retornar Promise,
    // o que cascateia pelas tasks que a chamam; ou (b) cachear o array ja parseado por
    // job (invalidado quando o job muda de arquivo/termina), o que evita reparsear a
    // cada pagina sem mudar a assinatura. Nenhuma das duas foi feita aqui de proposito
    // — ver a Task 6 do plano de dockerizacao.
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
    // Id que nao existe no banco: nao ha job nenhum que algum dia dispare `emitir()` pra
    // esse jobId, entao a fila de espera nunca seria drenada — a promise travaria pra
    // sempre. Resolve na hora com null, igual `obter()` ja faz para id desconhecido.
    if (!job) return Promise.resolve(null);
    if (!['enfileirado', 'rodando'].includes(job.status)) return Promise.resolve(job);
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
