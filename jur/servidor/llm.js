const ferramentas = require('./ferramentas');

// O SDK e dual ESM/CJS: em CommonJS o construtor pode vir em .default.
const moduloSdk = require('@anthropic-ai/sdk');
const Anthropic = moduloSdk.default || moduloSdk;

const MODELO = 'claude-opus-5';
const MAX_TOKENS = 64000;
const MAX_ITERACOES = 12;

const SISTEMA = `Voce e um assistente de pesquisa de jurisprudencia dos tribunais brasileiros.
Voce tem acesso a um crawler que consulta as bases OFICIAIS dos tribunais.

Regras que nao se quebram:
1. NUNCA cite um julgado que nao veio de ler_resultados. Nao ha jurisprudencia "de memoria".
2. Escolha o tribunal com listar_tribunais antes de buscar. Tribunal com estado
   "sem-acesso" ou "exige-sessao" nao pode ser buscado — explique ao usuario e ofereca outro.
3. Zero resultados NAO e o mesmo que "nao existe jurisprudencia". Quando o total for 0,
   repasse a ressalva do tribunal ao usuario. Varios acervos tem recorte de periodo.
4. Busca que FALHOU e diferente de busca vazia. Diga qual das duas aconteceu.
5. Pagine com ler_resultados. Nao peca centenas de julgados de uma vez.
6. Responda em portugues do Brasil.`;

function erroAbortado() {
  // Mesmo formato do APIUserAbortError que o SDK lança quando o `signal` passado pra
  // .stream() ja chega abortado (ou aborta no meio do request): quem chama (rotas/chat.js)
  // reconhece pelo .name e trata como desconexao normal, nao como falha.
  const erro = new Error('Requisicao abortada pelo cliente.');
  erro.name = 'APIUserAbortError';
  return erro;
}

async function conversar({ mensagens, apiKey, cliente, deps, aoTexto, aoFerramenta, sinal,
                          modelo = MODELO, esforco = null, maxIteracoes = MAX_ITERACOES }) {
  const anthropic = cliente || new Anthropic(apiKey ? { apiKey } : {});
  const historico = [...mensagens];
  let textoFinal = '';

  for (let i = 0; i < maxIteracoes; i++) {
    // Checagem propria alem da que o proprio SDK faz ao receber um `signal` ja abortado:
    // garante que paramos de chamar a API mesmo com um `cliente` de teste que nao olha
    // pra `signal`, e evita abrir mais uma rodada de tool-use so pra descobrir isso depois
    // (cada rodada e uma chamada paga).
    if (sinal && sinal.aborted) throw erroAbortado();

    const parametros = {
      model: modelo,
      max_tokens: MAX_TOKENS,
      system: SISTEMA,
      tools: ferramentas.definicoes(),
      messages: historico,
    };
    // O haiku rejeita output_config.effort; validacao.js devolve esforco null para ele.
    if (esforco) parametros.output_config = { effort: esforco };

    const stream = anthropic.messages.stream(parametros, { signal: sinal });

    if (typeof aoTexto === 'function') stream.on('text', (delta) => aoTexto(delta));

    const mensagem = await stream.finalMessage();

    // textoFinal e o texto da mensagem MAIS RECENTE do loop, nao um acumulado entre
    // turnos: turnos intermediarios (tool-use) nao tem "texto final" que valha a pena
    // somar aqui, e os deltas de cada um ja saem em tempo real via aoTexto/SSE.
    textoFinal = mensagem.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (mensagem.stop_reason === 'end_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      return { mensagens: historico, texto: textoFinal };
    }

    if (mensagem.stop_reason === 'refusal') {
      // Recusa do modelo pode vir com content vazio — sem isto o 'fim' chegaria com
      // texto: '' e o usuario nao saberia se a conversa terminou ou travou.
      historico.push({ role: 'assistant', content: mensagem.content });
      const aviso = 'O modelo recusou responder a esta mensagem.';
      return { mensagens: historico, texto: textoFinal || aviso };
    }

    if (mensagem.stop_reason === 'pause_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      continue;
    }

    const chamadas = mensagem.content.filter((b) => b.type === 'tool_use');
    if (!chamadas.length) {
      historico.push({ role: 'assistant', content: mensagem.content });
      return { mensagens: historico, texto: textoFinal };
    }

    historico.push({ role: 'assistant', content: mensagem.content });

    // Chamadas paralelas voltam TODAS num unico turno de user; dividir em varias
    // mensagens ensina o modelo a parar de paralelizar. Rodamos as tools em paralelo
    // (Promise.all preserva a ordem do array de ENTRADA no array de SAIDA mesmo que
    // as chamadas terminem fora de ordem) porque buscar_jurisprudencia pode levar
    // minutos — em serie, duas buscas paralelas dobrariam o tempo a toa.
    // ferramentas.executar NUNCA lanca (sempre devolve string, ate em erro interno —
    // ver o try/catch em servidor/ferramentas.js), entao nao precisa de tratamento de
    // rejeicao por chamada aqui.
    const resultados = await Promise.all(chamadas.map(async (chamada) => {
      if (typeof aoFerramenta === 'function') aoFerramenta(chamada.name, chamada.input);
      const texto = await ferramentas.executar(chamada.name, chamada.input, deps);
      return { type: 'tool_result', tool_use_id: chamada.id, content: texto };
    }));
    historico.push({ role: 'user', content: resultados });
  }

  const aviso = 'Atingi o limite de passos desta conversa sem concluir. Refaca o pedido de forma mais especifica.';
  return { mensagens: historico, texto: textoFinal || aviso };
}

module.exports = { conversar, MODELO, SISTEMA, MAX_ITERACOES };
