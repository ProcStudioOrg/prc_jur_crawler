const catalogo = require('../catalogo');
const { json, sse, lerCorpo } = require('../http');

// Cada pagina de maxPaginas e uma requisicao real ao portal do tribunal — nao e so
// lentidao nossa, e uso do recurso de terceiro. 50 e 5x o default da CLI (10), folga
// suficiente para uma busca legitimamente ampla sem abrir espaco para varrer o
// acervo inteiro por engano (ou de proposito) num unico job.
const MAX_PAGINAS_TETO = 50;

// Aviso generico para quando total===0 e o tribunal nao tem `nota` no catalogo (ex.:
// tcu, disponivel mas sem ressalva registrada). A garantia de que zero nunca viaja
// sozinho nao pode depender de todo tribunal ter nota preenchida — ver Important 3.
const AVISO_ZERO_SEM_NOTA = 'zero resultados nao comprova que nao ha jurisprudencia sobre o tema — este tribunal nao tem ressalva registrada no catalogo.';

/**
 * Aceita ausente/vazio (usa o default da CLI). Rejeita qualquer coisa que nao seja
 * um inteiro positivo dentro do teto: string nao numerica ("abc"), negativo/zero e
 * valor acima do teto. Sem essa checagem, "abc" vira literalmente `-m abc` na linha
 * de comando (Commander nao converte tipo) e o crawler processa 0 paginas em
 * silencio — a mesma ambiguidade "zero resultados vs argumento invalido" que a regra
 * do zero existe para evitar, so que entrando por outra porta.
 */
function maxPaginasInvalida(valor) {
  if (valor === undefined || valor === null || valor === '') return false;
  const n = Number(valor);
  return !Number.isInteger(n) || n < 1 || n > MAX_PAGINAS_TETO;
}

function registrar(roteador, deps) {
  const fila = deps.fila;

  roteador.rota('POST', '/api/v1/buscas', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const { tribunal, query, dataInicio, dataFim, maxPaginas } = corpo;
    if (!tribunal) return json(res, 400, { erro: 'campo obrigatorio: tribunal' });
    if (!query) return json(res, 400, { erro: 'campo obrigatorio: query' });
    if (maxPaginasInvalida(maxPaginas)) {
      return json(res, 400, {
        erro: `maxPaginas invalido: precisa ser um inteiro entre 1 e ${MAX_PAGINAS_TETO}`,
      });
    }

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
    // total 0 nunca viaja sozinho: SEMPRE que total===0 ha pelo menos um aviso, com
    // ou sem nota no catalogo (ex.: tcu, disponivel mas sem ressalva registrada).
    // Depender so de `info.nota` deixaria exatamente esses tribunais reproduzir a
    // armadilha que a regra existe para evitar — a garantia precisa ser estrutural,
    // nao depender de dado que pode faltar.
    const avisos = [];
    if (job.status === 'concluido' && job.total === 0) {
      avisos.push(info && info.nota ? info.nota : AVISO_ZERO_SEM_NOTA);
    }
    json(res, 200, { ...job, estadoTribunal: info ? info.estado : null, avisos });
  });

  roteador.rota('GET', '/api/v1/buscas/:id/resultados', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    // Paginacao e tolerante por design, nao 400: um offset negativo ou um limite fora
    // da faixa e erro de cliente inofensivo (o pior caso e ver a pagina errada), nao
    // motivo pra recusar a requisicao — corrigir em silencio mantem funcionando uma
    // URL editada a mao ou um estado de UI defasado. Sem o clamp, offset negativo cai
    // na semantica de indice negativo do Array.slice (conta a partir do fim), que
    // ninguem espera de uma API de paginacao.
    const offsetBruto = Number(req.query.offset);
    const offset = Number.isFinite(offsetBruto) && offsetBruto > 0 ? Math.floor(offsetBruto) : 0;
    const limiteBruto = Number(req.query.limite);
    const limite = Number.isFinite(limiteBruto) && limiteBruto > 0 ? Math.min(Math.floor(limiteBruto), 100) : 20;
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
