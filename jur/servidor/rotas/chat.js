const { sse, lerCorpo, json } = require('../http');
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

/** Extrai o texto puro de um content (string ou array de blocos da Messages API),
 *  so para alimentar renomearSePrimeira — o conteudo estruturado em si e gravado
 *  intacto por conversas.acrescentar, nunca achatado. */
function extrairTexto(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  }
  return '';
}

function registrar(roteador, deps) {
  roteador.rota('POST', '/api/v1/chat', async (req, res) => {
    // C2: esta rota gasta a chave da Anthropic do operador (Opus 5, max_tokens 64000).
    // A checagem de Origin que vivia aqui (um site hostil aberto no browser da vitima
    // consegue POSTar sem preflight, e mesmo sem LER a resposta a conta ja foi paga)
    // agora e responsabilidade da guarda unica do roteador — ver
    // servidor/autenticacao.js. Ela roda antes desta rota ser encontrada.

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

    // Persistencia de conversa e opcional: so grava se o cliente mandou conversaId E o
    // servidor tem um repositorio (deps.conversas) configurado. Sem isso, comportamento
    // identico ao de antes desta rota saber de conversa nenhuma.
    const conversaId = deps.conversas && typeof corpo.conversaId === 'string' && corpo.conversaId
      ? corpo.conversaId
      : null;
    if (conversaId) {
      // Checagem de existencia por PK antes do INSERT: sem isso, um conversaId invalido
      // (conversa apagada, digitada errada, de outro banco) batia na FK de mensagem e o
      // cliente recebia o 500 cru do SQLite ("FOREIGN KEY constraint failed"), diferente
      // de todo o resto do roteador, que nunca deixa erro sem contexto em portugues. O
      // custo e uma unica consulta indexada por chave primaria — barato, e evita o
      // INSERT que ia falhar de qualquer forma.
      if (!deps.conversas.obter(conversaId)) {
        return json(res, 404, { erro: 'conversa nao encontrada' });
      }
      const ultima = mensagens[mensagens.length - 1];
      deps.conversas.acrescentar(conversaId, 'user', ultima.content);
      deps.conversas.renomearSePrimeira(conversaId, extrairTexto(ultima.content));
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
      if (conversaId) {
        // r.mensagens e o historico COMPLETO depois do turno; as que entraram (mensagens)
        // ja estao no banco (a ultima delas foi gravada acima, as anteriores vieram de
        // turnos passados). So as que vieram DEPOIS sao novas neste turno — inclui
        // possiveis rodadas de tool_use/tool_result no meio, nao so a resposta final.
        // O content vai como veio (array de blocos quando for o caso), nunca achatado —
        // sem isso o modelo perde os job_id das buscas no proximo turno.
        const novas = r.mensagens.slice(mensagens.length);
        for (const m of novas) deps.conversas.acrescentar(conversaId, m.role, m.content);
      }
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
