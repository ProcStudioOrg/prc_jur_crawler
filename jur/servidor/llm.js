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

async function conversar({ mensagens, apiKey, cliente, deps, aoTexto, aoFerramenta, maxIteracoes = MAX_ITERACOES }) {
  const anthropic = cliente || new Anthropic(apiKey ? { apiKey } : {});
  const historico = [...mensagens];
  let textoFinal = '';

  for (let i = 0; i < maxIteracoes; i++) {
    const stream = anthropic.messages.stream({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: SISTEMA,
      tools: ferramentas.definicoes(),
      messages: historico,
    });

    if (typeof aoTexto === 'function') stream.on('text', (delta) => aoTexto(delta));

    const mensagem = await stream.finalMessage();

    textoFinal = mensagem.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (mensagem.stop_reason === 'end_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      return { mensagens: historico, texto: textoFinal };
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

    // Chamadas paralelas voltam TODAS num unico turno de user; dividir em
    // varias mensagens ensina o modelo a parar de paralelizar.
    const resultados = [];
    for (const chamada of chamadas) {
      if (typeof aoFerramenta === 'function') aoFerramenta(chamada.name, chamada.input);
      const texto = await ferramentas.executar(chamada.name, chamada.input, deps);
      resultados.push({ type: 'tool_result', tool_use_id: chamada.id, content: texto });
    }
    historico.push({ role: 'user', content: resultados });
  }

  const aviso = 'Atingi o limite de passos desta conversa sem concluir. Refaca o pedido de forma mais especifica.';
  return { mensagens: historico, texto: textoFinal || aviso };
}

module.exports = { conversar, MODELO, SISTEMA, MAX_ITERACOES };
