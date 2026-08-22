const catalogo = require('../catalogo');
const { json, sse, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const fila = deps.fila;

  roteador.rota('POST', '/api/v1/buscas', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const { tribunal, query, dataInicio, dataFim, maxPaginas } = corpo;
    if (!tribunal) return json(res, 400, { erro: 'campo obrigatorio: tribunal' });
    if (!query) return json(res, 400, { erro: 'campo obrigatorio: query' });

    const info = catalogo.obter(tribunal);
    if (!info) return json(res, 404, { erro: `tribunal desconhecido: ${tribunal}` });
    if (!info.disponivel) {
      // A nota vai junto: "indisponivel" sem motivo faz o usuario tentar de novo.
      return json(res, 409, { erro: `tribunal indisponivel (${info.estado})`, estado: info.estado, nota: info.nota });
    }

    try {
      const { id, status } = fila.enfileirar(tribunal, { query, dataInicio, dataFim, maxPaginas });
      return json(res, 202, { id, status });
    } catch (e) {
      return json(res, 409, { erro: e.message });
    }
  });

  roteador.rota('GET', '/api/v1/buscas', (req, res) => {
    json(res, 200, { buscas: fila.listar(Number(req.query.limite) || 50) });
  });

  roteador.rota('GET', '/api/v1/buscas/:id', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    const info = catalogo.obter(job.comando);
    // total 0 nunca viaja sozinho: a nota do tribunal e o que impede ler
    // "zero" como "nao ha jurisprudencia" (ex.: base do TRF1 congelada em 07/2025).
    const avisos = [];
    if (job.status === 'concluido' && job.total === 0 && info && info.nota) avisos.push(info.nota);
    json(res, 200, { ...job, estadoTribunal: info ? info.estado : null, avisos });
  });

  roteador.rota('GET', '/api/v1/buscas/:id/resultados', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    const offset = Number(req.query.offset) || 0;
    const limite = Math.min(Number(req.query.limite) || 20, 100);
    json(res, 200, { ...fila.resultados(req.params.id, offset, limite), offset, limite });
  });

  roteador.rota('DELETE', '/api/v1/buscas/:id', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    if (!fila.cancelar(req.params.id)) return json(res, 409, { erro: `busca ja ${job.status}` });
    json(res, 200, { id: req.params.id, status: 'cancelado' });
  });

  roteador.rota('GET', '/api/v1/buscas/:id/eventos', (req, res) => {
    const id = req.params.id;
    const job = fila.obter(id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });

    const canal = sse(res);
    canal.enviar('estado', job);

    const ouvinte = (evento) => {
      if (evento.jobId !== id) return;
      canal.enviar(evento.tipo, fila.obter(id));
      if (['concluido', 'erro', 'cancelado'].includes(evento.tipo)) encerrar();
    };
    function encerrar() {
      fila.removerOuvinte(ouvinte);
      canal.fechar();
    }
    fila.aoEvento(ouvinte);
    req.on('close', encerrar);

    if (['concluido', 'erro', 'cancelado'].includes(job.status)) encerrar();
  });
}

module.exports = { registrar };
