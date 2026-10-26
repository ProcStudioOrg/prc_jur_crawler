const { randomUUID } = require('node:crypto');
const { sse, lerCorpo, json } = require('../http');
const llm = require('../llm');
const catalogo = require('../catalogo');
const validacao = require('../validacao');

const ROLES_VALIDOS = new Set(['user', 'assistant']);

// Quem cobra a chamada da conexao ProcStudio. Vai no recibo do ai_usage: o Rails guarda em
// metadata e o FFD resolve o cartao do custo por provider.
const PROVEDOR_PROCSTUDIO = 'openrouter';
const MSG_PENDENTE = 'Há uma cobrança pendente nesta conta; aguarde alguns instantes.';
const MSG_INDISPONIVEL = 'A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.';

/** "R$ 1.234,56" / "R$ −0,52" (sinal de menos tipografico, como no ProcStudio). */
function formatarBrl(valor) {
  const absoluto = Math.abs(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `R$ ${valor < 0 ? '\u2212' : ''}${absoluto}`;
}

/**
 * Resposta para um `podeOperar()` negado: o corpo serve tanto ao JSON da recusa antes do
 * turno quanto ao evento `erro` quando o bloqueio vem no meio dele.
 */
function bloqueioDaCobranca(veredito, frontendUrl) {
  if (veredito.motivo === 'saldo') {
    return {
      status: 402,
      corpo: {
        erro: `Seu saldo de IA do ProcStudio acabou (${formatarBrl(veredito.saldoBrl)}). Adicione créditos para continuar.`,
        tipo: 'saldo_insuficiente',
        saldoBrl: veredito.saldoBrl,
        topupUrl: frontendUrl && veredito.topupPath ? frontendUrl.replace(/\/$/, '') + veredito.topupPath : null,
      },
    };
  }
  if (veredito.motivo === 'pendente') return { status: 409, corpo: { erro: MSG_PENDENTE, tipo: 'cobranca_pendente' } };
  if (veredito.motivo === 'indisponivel') return { status: 503, corpo: { erro: MSG_INDISPONIVEL, tipo: 'procstudio_indisponivel' } };
  throw new Error(`motivo de bloqueio da cobrança desconhecido: ${veredito.motivo}`);
}

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

    let cliente = deps.clienteLLM;
    let vModelo; let vEsforco;
    // Conexao ProcStudio: a chave e do operador e cada rodada e cobrada do saldo de IA do time.
    let cobrar = false;
    // O que identifica o modelo para quem le o custo: o rotulo na ProcStudio, o id em BYOK.
    let rotuloModelo;
    let conexaoId = null;
    let modeloCatalogo = null;
    if (deps.conexoes) {
      const connection = typeof corpo.conexaoId === 'string' && deps.conexoes.obter(corpo.conexaoId);
      if (!connection) return json(res, 400, { erro: 'Configure uma conexão de IA antes de conversar.' });
      conexaoId = corpo.conexaoId;
      cobrar = deps.conexoes.ehProcstudio(conexaoId);
      if (cobrar && !deps.cobranca) {
        // Conexao gerenciada sem cobranca montada e erro de configuracao: nunca chama o
        // provedor com a chave do operador sem ter como cobrar.
        return json(res, 503, { erro: MSG_INDISPONIVEL, tipo: 'procstudio_indisponivel' });
      }
      // Na ProcStudio o modelo e o do operador, nunca o que veio no corpo.
      const modelo = cobrar ? deps.conexoes.modeloEnviado() : (corpo.modelo || connection.model);
      modeloCatalogo = connection.model;
      rotuloModelo = cobrar ? connection.rotulo : modelo;
      if (typeof modelo !== 'string' || !modelo || modelo.length > 256 || /\s/.test(modelo)) {
        return json(res, 400, { erro: 'Escolha um modelo válido para esta conexão.' });
      }
      vModelo = { ok: true, valor: modelo };
      vEsforco = { ok: true, valor: null };
      // Resolve a credencial novamente a cada chamada, inclusive após tool use.
      cliente = { messages: { stream: (...args) => deps.conexoes.cliente(corpo.conexaoId).messages.stream(...args) } };
    } else {
      vModelo = validacao.validarModelo(corpo.modelo);
      if (!vModelo.ok) return json(res, 400, { erro: vModelo.erro });
      vEsforco = validacao.validarEsforco(corpo.esforco, vModelo.valor);
      if (!vEsforco.ok) return json(res, 400, { erro: vEsforco.erro });
      rotuloModelo = vModelo.valor;
    }

    // Tribunais que o usuario deixou LIGADOS no painel de disponibilidade. Vai para dois
    // lugares: o prompt (para o modelo nao precisar chamar listar_tribunais so para
    // descobrir onde pode buscar) e as ferramentas (que recusam o que estiver fora).
    const vTribunais = validacao.validarTribunais(
      corpo.tribunais, new Set(catalogo.listar().map((t) => t.comando)),
    );
    if (!vTribunais.ok) return json(res, 400, { erro: vTribunais.erro });
    const escopo = vTribunais.valor;

    // Produção usa exclusivamente a conexão privada acima. O header abaixo pertence
    // ao roteador interno de testes, que não é exposto pela aplicação autenticada.
    const apiKey = deps.conexoes ? undefined : req.headers['x-api-key'];
    if (!apiKey && !cliente) {
      return json(res, 401, { erro: 'sem chave da Anthropic: configure uma conexão de IA' });
    }

    // Sem saldo (ou com cobranca pendente, ou ProcStudio fora) o turno e recusado antes de
    // qualquer gravacao: a pergunta nao fica na conversa sem resposta. Fica ANTES do porteiro de
    // turno abaixo porque e o unico `await` do caminho: dali ate `turnos.executar` tudo e
    // sincrono, e um await no meio deixaria dois POSTs da mesma conversa passarem juntos.
    if (cobrar) {
      const veredito = await deps.cobranca.podeOperar();
      if (!veredito.ok) {
        const { status, corpo: recusa } = bloqueioDaCobranca(veredito, deps.frontendUrl);
        return json(res, status, recusa);
      }
    }

    // Persistencia de conversa e opcional: so grava se o cliente mandou conversaId E o
    // servidor tem um repositorio (deps.conversas) configurado. Sem isso, comportamento
    // identico ao de antes desta rota saber de conversa nenhuma.
    const conversaId = deps.conversas && typeof corpo.conversaId === 'string' && corpo.conversaId
      ? corpo.conversaId
      : null;
    // Um turno vivo por conversa. Dois turnos concorrentes gravariam mensagens
    // intercaladas na mesma conversa, e o historico que volta para o modelo no turno
    // seguinte sairia fora de ordem. Antes isto nao podia acontecer porque o turno morria
    // junto com a conexao; agora que ele sobrevive, precisa de porteiro.
    if (conversaId && deps.turnos && deps.turnos.emAndamento(conversaId)) {
      return json(res, 409, {
        erro: 'ja ha uma resposta em andamento nesta conversa',
        detalhe: 'espere o turno atual terminar — ele continua rodando mesmo com a aba fechada, '
          + 'e reabrir a conversa reconecta ao que ja chegou',
      });
    }

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
    // Set para as ferramentas (consulta por pertinencia); array para o prompt (ordem).
    const escopoTribunais = escopo ? new Set(escopo) : undefined;
    const filaRastreada = deps.fila && {
      ...deps.fila,
      enfileirar(...args) {
        const r = deps.fila.enfileirar(...args);
        jobsDesteChat.add(r.id);
        return r;
      },
    };

    const controlador = new AbortController();

    // DUAS POLITICAS, e a diferenca e se ha onde voltar.
    //
    // COM conversaId (o chat da interface): o turno continua rodando depois que o cliente
    // some. Era o contrario, e era a falha relatada: fechar o navegador abortava a chamada
    // e cancelava as buscas, entao o usuario voltava para uma conversa que tinha so a
    // propria pergunta gravada. Buscas de jurisprudencia levam minutos — sair da tela
    // enquanto rodam e o caso NORMAL. O CUSTO e real e assumido: a chamada continua
    // gastando a chave da Anthropic sem ninguem ouvindo. Vale porque a chave e do proprio
    // usuario, porque o turno tem teto de passos (MAX_ITERACOES em llm.js) e porque perder
    // minutos de crawl custa mais. O trabalho nao se perde: o turno inteiro e persistido,
    // GET /api/v1/conversas marca `emAndamento` e GET /api/v1/conversas/:id/stream
    // reconecta ao que ja chegou.
    //
    // SEM conversaId (persistencia desligada): nada e gravado e nao ha stream para
    // reanexar, entao deixar o turno rodando so queimaria a chave por um resultado que
    // ninguem jamais leria. Aqui vale a politica antiga — abortar a chamada e cancelar as
    // buscas desta conversa.
    const sobreviveAoCliente = Boolean(conversaId && deps.turnos);
    function aoDesconectar() {
      if (sobreviveAoCliente) return;
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

    // request_id do ai_usage = <conversa ou avulso-uuid>:<turno>:<rodada>. O turno e um UUID
    // por tentativa, nunca derivado da contagem de mensagens: reenviar a mesma pergunta e
    // outro turno e precisa ser outra cobranca.
    const turnoId = randomUUID();
    const prefixoPedido = `${conversaId || `avulso-${randomUUID()}`}:${turnoId}`;
    // Soma do turno. Centavos para a soma das rodadas nao acumular erro de ponto flutuante.
    const custoTurno = { cobradoCents: 0, tokensEntrada: 0, tokensSaida: 0, rodadas: 0 };
    const resumoCusto = () => ({
      cobradoBrl: cobrar ? custoTurno.cobradoCents / 100 : null,
      tokensEntrada: custoTurno.tokensEntrada,
      tokensSaida: custoTurno.tokensSaida,
      rodadas: custoTurno.rodadas,
      modelo: rotuloModelo,
    });

    /** Erro do turno -> dados do evento `erro`, com o `tipo` que a interface trata. */
    function dadosDoErro(e) {
      if (e.bloqueio) return e.bloqueio;
      if (e.code === 'COBRANCA_PENDENTE') return { erro: e.message, tipo: 'cobranca_pendente' };
      if (e.code === 'USAGE_MISSING') return { erro: e.message, tipo: 'usage_missing' };
      if (cobrar && e.code === 'PROVIDER_ERROR') {
        // Erro do provedor na chave do operador nao e problema do usuario: vira
        // "indisponivel" e o operador e avisado (log + diagnostico pelo Kaizen).
        const falha = deps.cobranca.falhaDoOperador(e);
        return { erro: falha.message, tipo: 'procstudio_indisponivel' };
      }
      return { erro: e.message, tipo: e.constructor ? e.constructor.name : 'Error' };
    }

    /**
     * O turno em si. Recebe `emitir` em vez de escrever no `canal` direto: com
     * persistencia ligada, `emitir` e o do registro de turnos (servidor/turnos.js), que
     * guarda cada evento e distribui a TODOS os clientes anexados — o que postou e
     * quem reabriu a conversa depois. Sem persistencia, `emitir` e o proprio canal.
     *
     * NUNCA lanca: quem a chama e `turnos.executar`, e uma rejeicao ali deixaria o turno
     * marcado como falho sem ninguem receber a explicacao.
     */
    async function correrTurno(emitir) {
      // Antes de cada rodada: o saldo pode acabar no meio do turno (a pre-checagem acima so
      // decide se a pergunta entra).
      const antesDaRodada = cobrar
        ? async () => {
          const veredito = await deps.cobranca.podeOperar();
          if (!veredito.ok) {
            const { corpo: dados } = bloqueioDaCobranca(veredito, deps.frontendUrl);
            throw Object.assign(new Error(dados.erro), { bloqueio: dados });
          }
        }
        : undefined;

      // Depois de cada rodada que informou consumo: cobra (ProcStudio), emite `custo` e
      // regrava o custo do turno na conversa — assim ele fica mesmo se o turno morrer
      // depois, ou se ninguem estiver mais ouvindo.
      async function aoUsoDaRodada(usage, indice) {
        const rodada = indice + 1;
        const evento = { rodada, tokensEntrada: usage.input_tokens, tokensSaida: usage.output_tokens, modelo: rotuloModelo };
        if (cobrar) {
          const r = await deps.cobranca.registrar({
            requestId: `${prefixoPedido}:${rodada}`,
            modelId: modeloCatalogo,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_tokens,
            cacheWriteTokens: usage.cache_write_tokens,
            provider: PROVEDOR_PROCSTUDIO,
            providerModel: vModelo.valor,
            providerCostUsd: usage.cost_usd,
            providerGenerationId: usage.generation_id,
            conversationId: conversaId,
          });
          custoTurno.cobradoCents += Math.round(r.cobradoBrl * 100);
          evento.cobradoBrl = r.cobradoBrl;
          evento.saldoBrl = r.saldoBrl;
        }
        custoTurno.tokensEntrada += usage.input_tokens || 0;
        custoTurno.tokensSaida += usage.output_tokens || 0;
        custoTurno.rodadas += 1;
        if (conversaId) {
          deps.conversas.registrarCusto(conversaId, { turnoId, ...resumoCusto(), conexao: conexaoId });
        }
        emitir('custo', evento);
      }

      try {
        const r = await llm.conversar({
          mensagens,
          apiKey,
          cliente,
          deps: {
            ...deps, ...(filaRastreada ? { fila: filaRastreada } : {}), escopoTribunais,
            aoProgresso: (texto) => emitir('progresso', { texto }),
          },
          sinal: req.authSignal ? AbortSignal.any([controlador.signal, req.authSignal]) : controlador.signal,
          modelo: vModelo.valor,
          esforco: vEsforco.valor,
          escopo,
          antesDaRodada,
          aoUsoDaRodada,
          exigirUso: cobrar,
          aoTexto: (t) => emitir('texto', { texto: t }),
          aoFerramenta: (nome, entrada) => emitir('ferramenta', { nome, entrada }),
          // Vincula a busca a conversa ASSIM QUE ela e despachada, nao no fim do turno:
          // uma busca de minutos ficaria invisivel exatamente durante os minutos em que
          // o usuario quer abrir o painel e olhar para ela.
          aoResultadoFerramenta: (nome, entrada, resultado) => {
            if (!resultado || !resultado.jobId) return;
            if (conversaId) deps.conversas.vincularBusca(conversaId, resultado.jobId);
            // Consulta por numero nao tem query: o rotulo e o numero, nunca `undefined`.
            const rotulo = entrada.query || (entrada.numero ? `nº ${entrada.numero}` : undefined);
            emitir('busca', { jobId: resultado.jobId, tribunal: entrada.tribunal, query: rotulo, numero: entrada.numero });
          },
        });
        // r.mensagens e o historico COMPLETO depois do turno; as que entraram (mensagens)
        // ja estao no banco (a ultima delas foi gravada acima, as anteriores vieram de
        // turnos passados). So as que vieram DEPOIS sao novas neste turno — inclui
        // possiveis rodadas de tool_use/tool_result no meio, nao so a resposta final.
        // O content vai como veio (array de blocos quando for o caso), nunca achatado.
        const novas = r.mensagens.slice(mensagens.length);

        // Grava ANTES de anunciar o fim. Se a gravacao falhar, o cliente recebe 'erro' em
        // vez de um 'fim' que promete um turno que o banco nao tem — e quem so olha a
        // lista (emAndamento vira false quando `executar` retorna) nunca ve a conversa
        // "pronta" sem as mensagens dentro.
        if (conversaId) {
          // Sem isso o modelo perde os job_id das buscas no proximo turno depois de um F5.
          for (const m of novas) deps.conversas.acrescentar(conversaId, m.role, m.content);
        }

        // C1 (revisao final): o `fim` carrega o turno INTEIRO, nao so o texto. O cliente
        // monta o historico do proximo turno incrementalmente, na mesma sessao, sem
        // recarregar a pagina — e era ele, nao o banco, que achatava tudo em
        // {role:'assistant', content: texto}. Achatado aqui o modelo perde duas coisas no
        // turno 2: o `job_id` das buscas que ele mesmo fez (o usuario pede "mostra os 5
        // primeiros" e ele refaz o crawl) e, pior, a RESSALVA DO TRIBUNAL para total 0,
        // que vive dentro do `tool_result` — sem ela a vista, o modelo pode afirmar "nao
        // ha jurisprudencia", que e exatamente o invariante que este repo existe para
        // proteger. Mandamos os blocos daqui, e nao deixamos o cliente refazer
        // GET /conversas/:id, porque esta e a MESMA lista que acabou de ser persistida
        // (uma fonte so), vale mesmo sem persistencia ligada (conversaId null), nao custa
        // ida-e-volta extra e nao abre corrida com a troca de conversa no meio do stream.
        emitir('fim', { texto: r.texto, mensagens: novas, custo: custoTurno.rodadas ? resumoCusto() : null });
      } catch (e) {
        if (e && e.name === 'APIUserAbortError') {
          // So chega aqui no caminho SEM persistencia: la o cliente desconectou e nos
          // mesmos abortamos via AbortController — fluxo normal, nao falha. Nao emitimos
          // 'erro' porque nao ha ninguem ouvindo e nao ha nada de errado a reportar.
        } else {
          // Bloqueio por gancho (saldo, cobranca, uso ausente) traz o que o turno ja gerou:
          // as rodadas anteriores ja foram cobradas, entao ficam na conversa.
          if (conversaId && Array.isArray(e.mensagens)) {
            try {
              for (const m of e.mensagens.slice(mensagens.length)) deps.conversas.acrescentar(conversaId, m.role, m.content);
            } catch (eGravar) {
              console.error(JSON.stringify({ event: 'chat_turno_parcial_nao_gravado', erro: String(eGravar.message).slice(0, 300) }));
            }
          }
          emitir('erro', dadosDoErro(e));
        }
      }
    }

    let desanexar = null;
    try {
      if (!sobreviveAoCliente) {
        await correrTurno((nome, dados) => canal.enviar(nome, dados));
      } else {
        // `executar` registra o turno de forma SINCRONA antes de devolver a promise, e
        // so entao comeca a tarefa — por isso o `anexar` logo abaixo sempre encontra o
        // turno. E o que a tarefa tiver emitido antes deste ponto nao se perde: `anexar`
        // reproduz o buffer inteiro ao entrar.
        const rodando = deps.turnos.executar(conversaId, correrTurno);
        desanexar = deps.turnos.anexar(
          conversaId,
          (nome, dados) => canal.enviar(nome, dados),
          () => canal.fechar(),
        );
        await rodando;
      }
    } finally {
      res.off('close', aoDesconectar);
      if (desanexar) desanexar();
      canal.fechar();
    }
  });
}

module.exports = { registrar };
