const { sse, lerCorpo, json, bloquearOrigemHostil } = require('../http');
const llm = require('../llm');
const validacao = require('../validacao');

const ROLES_VALIDOS = new Set(['user', 'assistant']);

function validarMensagens(mensagens) {
  if (!Array.isArray(mensagens) || !mensagens.length) return 'campo obrigatorio: mensagens';
  for (const m of mensagens) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'cada mensagem precisa ser um objeto com role e content';
    if (!ROLES_VALIDOS.has(m.role)) return `role de mensagem invalida: "${m.role}" — use "user" ou "assistant"`;
    if (m.content === undefined || m.content === null) return 'cada mensagem precisa do campo content';
  }
  if (mensagens[mensagens.length - 1].role !== 'user') {
    // A API da Anthropic rejeita com 400 se a ultima mensagem for do assistant — isso e
    // "prefill" (comecar a resposta do modelo por fora), e nao e permitido no Opus 5.
    // Recusamos aqui com uma mensagem que explica o motivo, em vez de deixar o 400 cru
    // do SDK chegar ao usuario sem contexto.
    return 'a ultima mensagem precisa ser do usuario (role "user") — terminar com "assistant" seria prefill, que a API recusa';
  }
  return null;
}

function registrar(roteador, deps) {
  roteador.rota('POST', '/api/v1/chat', async (req, res) => {
    // C2: esta rota gasta a chave da Anthropic do operador (Opus 5, max_tokens 64000).
    // Um site hostil aberto no browser da vitima consegue POSTar aqui sem preflight
    // (requisicao simples), e mesmo sem conseguir LER a resposta a conta ja foi paga.
    if (bloquearOrigemHostil(req, res)) return undefined;

    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const motivoInvalido = validarMensagens(corpo.mensagens);
    if (motivoInvalido) return json(res, 400, { erro: motivoInvalido });
    const mensagens = corpo.mensagens;

    const vModelo = validacao.validarModelo(corpo.modelo);
    if (!vModelo.ok) return json(res, 400, { erro: vModelo.erro });
    const vEsforco = validacao.validarEsforco(corpo.esforco, vModelo.valor);
    if (!vEsforco.ok) return json(res, 400, { erro: vEsforco.erro });

    // A chave nunca e persistida: vem do header (localStorage do browser) ou do ambiente.
    // deps.clienteLLM (so em teste) dispensa a chave real.
    const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !deps.clienteLLM) {
      return json(res, 401, { erro: 'sem chave da Anthropic: defina ANTHROPIC_API_KEY ou informe na interface' });
    }

    // Rastreia so os jobs de busca que ESTA conversa criou, para cancelar so os dela
    // (nao os de outra conversa concorrente) se o cliente for embora no meio.
    const jobsDesteChat = new Set();
    const filaRastreada = deps.fila && {
      ...deps.fila,
      enfileirar(...args) {
        const r = deps.fila.enfileirar(...args);
        jobsDesteChat.add(r.id);
        return r;
      },
    };

    const controlador = new AbortController();
    function aoDesconectar() {
      // Isto e o que impede a chamada paga a Anthropic de continuar rodando sozinha
      // depois que o cliente ja foi embora: o `signal` cancela a chamada em andamento
      // (ou impede a proxima, se estivermos entre chamadas) e o cancelamento da fila
      // libera qualquer ferramentas.executar() preso esperando o job terminar, para o
      // crawler nao ficar rodando sem ninguem ouvindo.
      controlador.abort();
      for (const id of jobsDesteChat) {
        const job = deps.fila.obter(id);
        if (job && !['concluido', 'erro', 'cancelado'].includes(job.status)) deps.fila.cancelar(id);
      }
    }
    // Usa 'close' do RES, nao do REQ: o req (IncomingMessage) emite 'close' assim que o
    // corpo termina de ser lido (lerCorpo ja consumiu 'end' logo acima) — e isso e
    // artefato interno do stream, nao desconexao real (`req.aborted` fica false). O res
    // (ServerResponse) so emite 'close' quando a conexao cai de verdade antes de
    // `res.end()`, que e exatamente o sinal que queremos. O sse() abaixo tambem escuta
    // 'close' do mesmo res para se autolimpar — os dois ouvintes convivem sem conflito.
    res.on('close', aoDesconectar);

    const canal = sse(res);
    try {
      const r = await llm.conversar({
        mensagens,
        apiKey,
        cliente: deps.clienteLLM,
        deps: filaRastreada ? { ...deps, fila: filaRastreada } : deps,
        sinal: controlador.signal,
        modelo: vModelo.valor,
        esforco: vEsforco.valor,
        aoTexto: (t) => canal.enviar('texto', { texto: t }),
        aoFerramenta: (nome, entrada) => canal.enviar('ferramenta', { nome, entrada }),
      });
      canal.enviar('fim', { texto: r.texto });
    } catch (e) {
      if (e && e.name === 'APIUserAbortError') {
        // Cliente desconectou (aba fechada, rede caiu) e nos mesmos abortamos a chamada
        // em andamento via AbortController — fluxo normal, nao falha. canal.enviar ja e
        // no-op aqui na pratica (a conexao caiu), mas de qualquer forma nao emitimos
        // 'erro': o usuario nao esta mais ouvindo e nao ha nada de errado a reportar.
      } else {
        canal.enviar('erro', { erro: e.message, tipo: e.constructor ? e.constructor.name : 'Error' });
      }
    } finally {
      res.off('close', aoDesconectar);
      canal.fechar();
    }
  });
}

module.exports = { registrar };
