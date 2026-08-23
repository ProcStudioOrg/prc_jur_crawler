const catalogo = require('../catalogo');
const relator = require('../relator');
const { json, sse, lerCorpo } = require('../http');
const { enriquecerJob } = require('../enriquecer');
const { validarMaxPaginas, validarData, normalizarPaginacao } = require('../validacao');

// Cada pagina de maxPaginas e uma requisicao real ao portal do tribunal — nao e so
// lentidao nossa, e uso do recurso de terceiro. 50 e 5x o default da CLI (10), folga
// suficiente para uma busca legitimamente ampla sem abrir espaco para varrer o
// acervo inteiro por engano (ou de proposito) num unico job. Esse teto e da rota HTTP
// especificamente — as tools do LLM (ferramentas.js) usam o mesmo teto de maxPaginas,
// mas um teto de paginacao menor; ver comentario em servidor/validacao.js.
const MAX_PAGINAS_TETO = 50;

// Paginacao de resultados desta rota: teto alto porque quem pagina aqui e um cliente
// HTTP normal (UI, script), nao um LLM que precisa caber no contexto — diferente do
// teto de 20 que ferramentas.js usa para ler_resultados.
const LIMITE_TETO = 100;
const LIMITE_PADRAO = 20;

// A regra do zero (e a de falha de leitura) vive em servidor/enriquecer.js, uma vez so,
// e TODA rota de leitura daqui a aplica — status, lista, resultados e SSE. Ver o
// cabecalho daquele modulo para o porque (achado I1: a regra existia so no status).

function registrar(roteador, deps) {
  const fila = deps.fila;

  roteador.rota('POST', '/api/v1/buscas', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const { tribunal, query, dataInicio, dataFim, maxPaginas, relator: relatorPedido } = corpo;
    if (!tribunal) return json(res, 400, { erro: 'campo obrigatorio: tribunal' });
    if (!query) return json(res, 400, { erro: 'campo obrigatorio: query' });
    const validacaoMaxPaginas = validarMaxPaginas(maxPaginas, MAX_PAGINAS_TETO);
    if (!validacaoMaxPaginas.valido) {
      return json(res, 400, { erro: validacaoMaxPaginas.motivo });
    }
    // I4: data em formato errado (ISO, tipicamente) chegava intacta em `-di`/`-df` e o
    // crawler filtrava errado ou nao filtrava — o job terminava com total 0 e a regra do
    // zero culpava o acervo por um filtro que o usuario nunca escreveu. Ver validacao.js
    // para a decisao de RECUSAR ISO em vez de converter em silencio.
    for (const [campo, valor] of [['dataInicio', dataInicio], ['dataFim', dataFim]]) {
      const v = validarData(valor, campo);
      if (!v.valido) return json(res, 400, { erro: v.motivo });
    }

    const info = catalogo.obter(tribunal);
    if (!info) return json(res, 404, { erro: `tribunal desconhecido: ${tribunal}` });
    if (!info.disponivel) {
      // A nota vai junto: "indisponivel" sem motivo faz o usuario tentar de novo.
      return json(res, 409, { erro: `tribunal indisponivel (${info.estado})`, estado: info.estado, nota: info.nota });
    }

    // Filtro por MAGISTRADO: RECUSA em vez de ignorar. Ignorar rodaria a busca sem o
    // recorte e devolveria julgados de todos os desembargadores como se fossem de um so
    // — e o cliente HTTP nao teria como perceber, porque a resposta seria um 202 normal.
    // Mesma politica de ferramentas.js; a diferenca e que aqui vira 400, nao texto.
    const filtroRelator = typeof relatorPedido === 'string' ? relatorPedido.trim() : '';
    if (filtroRelator) {
      const capacidade = relator.obter(tribunal);
      if (!capacidade || !capacidade.suportado) {
        return json(res, 400, {
          erro: `o tribunal ${tribunal} nao tem filtro por magistrado`,
          detalhe: capacidade ? capacidade.nota : 'a CLI do jur nao expoe esse filtro para este tribunal',
        });
      }
    }

    try {
      const { id, status } = fila.enfileirar(tribunal, {
        query, dataInicio, dataFim, maxPaginas, relator: filtroRelator || undefined,
      });
      return json(res, 202, { id, status });
    } catch (e) {
      return json(res, 409, { erro: e.message });
    }
  });

  roteador.rota('GET', '/api/v1/buscas', (req, res) => {
    json(res, 200, { buscas: fila.listar(Number(req.query.limite) || 50).map((j) => enriquecerJob(j, fila)) });
  });

  roteador.rota('GET', '/api/v1/buscas/:id', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    json(res, 200, enriquecerJob(job, fila));
  });

  roteador.rota('GET', '/api/v1/buscas/:id/resultados', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    // Paginacao e tolerante por design, nao 400: um offset negativo ou um limite fora
    // da faixa e erro de cliente inofensivo (o pior caso e ver a pagina errada), nao
    // motivo pra recusar a requisicao — corrigir em silencio mantem funcionando uma
    // URL editada a mao ou um estado de UI defasado. Sem o clamp, offset negativo cai
    // na semantica de indice negativo do Array.slice (conta a partir do fim), que
    // ninguem espera de uma API de paginacao. Regra em servidor/validacao.js,
    // compartilhada com ferramentas.js (que usa teto/default menores).
    const { offset, limite } = normalizarPaginacao(req.query.offset, req.query.limite, LIMITE_TETO, LIMITE_PADRAO);
    const pagina = fila.resultados(req.params.id, offset, limite);
    const enriquecido = enriquecerJob(job, fila);
    if (pagina.erro) {
      // C3: 500, nao 200 com lista vazia. `total: 42, itens: []` sem sinal nenhum e
      // uma contradicao que o cliente (e o modelo) leem como "a busca nao achou nada".
      return json(res, 500, {
        erro: `falha ao ler os resultados: ${pagina.erro}`,
        status: job.status,
        total: pagina.total,
        itens: [],
        offset,
        limite,
        estadoTribunal: enriquecido.estadoTribunal,
        avisos: enriquecido.avisos,
      });
    }
    json(res, 200, {
      ...pagina,
      status: job.status,
      offset,
      limite,
      estadoTribunal: enriquecido.estadoTribunal,
      avisos: enriquecido.avisos,
    });
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
    // I1: este e o canal que o spec desenhou para o fluxo POST -> 202 -> stream. Quem o
    // segue nao tem motivo nenhum para voltar a rota de status, entao mandar o job cru
    // aqui era a forma mais provavel de o usuario receber um zero sem a ressalva do
    // tribunal — e uma falha de leitura sem nenhum sinal.
    canal.enviar('estado', enriquecerJob(job, fila));

    const ouvinte = (evento) => {
      if (evento.jobId !== id) return;
      canal.enviar(evento.tipo, enriquecerJob(fila.obter(id), fila));
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
