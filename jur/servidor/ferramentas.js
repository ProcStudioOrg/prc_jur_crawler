const catalogo = require('./catalogo');
const { validarMaxPaginas, normalizarPaginacao } = require('./validacao');

const LIMITE_MAX = 20;
const LIMITE_PADRAO = 5;

// Mesmo teto que a rota HTTP usa para maxPaginas (rotas/buscas.js) — o teto de
// maxPaginas nao muda entre as duas superficies, so o de paginacao de resultados
// muda (100 na rota, LIMITE_MAX aqui, para nao estourar o contexto do modelo).
const MAX_PAGINAS_TETO = 50;

function definicoes() {
  return [
    {
      name: 'listar_tribunais',
      description:
        'Lista os tribunais brasileiros disponiveis para busca de jurisprudencia, com o estado de cada um. '
        + 'Use ANTES de buscar, para escolher o tribunal certo e evitar pedir um que esta bloqueado. '
        + 'Estados: ok (funciona), instavel (funciona com ressalva — leia a nota), '
        + 'sem-acesso (bloqueado por captcha), exige-sessao (precisa da credencial do usuario).',
      input_schema: {
        type: 'object',
        properties: {
          segmento: { type: 'string', description: 'superior, federal, estadual, trabalhista ou contas' },
          uf: { type: 'string', description: 'sigla do estado, ex.: PR' },
          estado: { type: 'string', enum: ['ok', 'instavel', 'sem-acesso', 'exige-sessao'] },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'buscar_jurisprudencia',
      description:
        'Executa uma busca de jurisprudencia num tribunal e espera ela terminar. '
        + 'Devolve o id do job e o total encontrado, NAO os julgados — use ler_resultados para os textos. '
        + 'Pode demorar minutos em tribunais que exigem navegador.',
      input_schema: {
        type: 'object',
        properties: {
          tribunal: { type: 'string', description: 'o comando do tribunal, ex.: stf, trf4, tjpr' },
          query: { type: 'string', description: 'os termos de busca' },
          dataInicio: { type: 'string', description: 'DD/MM/AAAA' },
          dataFim: { type: 'string', description: 'DD/MM/AAAA' },
          maxPaginas: { type: 'integer', description: `paginas a percorrer (default 3, maximo ${MAX_PAGINAS_TETO})` },
        },
        required: ['tribunal', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'ler_resultados',
      description:
        'Le uma FATIA dos resultados de uma busca ja concluida. Sempre pagine: pedir tudo de uma vez '
        + `estoura o contexto. Maximo de ${LIMITE_MAX} por chamada.`,
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          offset: { type: 'integer', description: 'default 0' },
          limite: { type: 'integer', description: `default ${LIMITE_PADRAO}, maximo ${LIMITE_MAX}` },
        },
        required: ['job_id'],
        additionalProperties: false,
      },
    },
  ];
}

async function listarTribunais(entrada) {
  const lista = catalogo.listar({ segmento: entrada.segmento, uf: entrada.uf, estado: entrada.estado });
  if (!lista.length) return 'Nenhum tribunal bate com esse filtro.';
  const linhas = lista.map((t) => {
    const uf = t.uf.length ? ` [${t.uf.join(',')}]` : '';
    return `${t.comando} — ${t.nome}${uf} · ${t.estado}`;
  });
  return `${lista.length} tribunais:\n${linhas.join('\n')}`;
}

async function buscar(entrada, deps) {
  const info = catalogo.obter(entrada.tribunal);
  if (!info) return `Tribunal desconhecido: "${entrada.tribunal}". Use listar_tribunais para ver os validos.`;
  if (!info.disponivel) {
    return `O tribunal ${info.comando} (${info.nome}) esta INDISPONIVEL — estado "${info.estado}".\n`
      + `Motivo registrado: ${info.nota}\n`
      + 'Nao invente resultado: diga isso ao usuario e sugira outro tribunal.';
  }

  const validacaoMaxPaginas = validarMaxPaginas(entrada.maxPaginas, MAX_PAGINAS_TETO);
  if (!validacaoMaxPaginas.valido) return validacaoMaxPaginas.motivo;

  const { id } = deps.fila.enfileirar(entrada.tribunal, {
    query: entrada.query,
    dataInicio: entrada.dataInicio,
    dataFim: entrada.dataFim,
    maxPaginas: entrada.maxPaginas || 3,
  });
  const job = await deps.fila.aguardar(id);

  if (job.status === 'erro') {
    return `A busca FALHOU (job ${job.id}): ${job.erro}\n`
      + 'Isso NAO significa que nao ha jurisprudencia — o crawler nao completou. Diga isso ao usuario.';
  }
  if (job.status === 'cancelado') return `A busca ${job.id} foi cancelada.`;

  if (job.total === 0) {
    return `job ${job.id}: 0 resultados em ${info.comando} para "${entrada.query}".\n`
      + `RESSALVA DO TRIBUNAL: ${info.nota || '(sem ressalva registrada)'}\n`
      + 'Zero aqui pode ser ausencia de julgado OU limitacao do acervo — nao afirme que "nao existe jurisprudencia".';
  }
  return `job ${job.id}: ${job.total} resultados em ${info.comando} para "${entrada.query}". `
    + 'Use ler_resultados com esse job_id para ver os julgados.';
}

async function lerResultados(entrada, deps) {
  const job = deps.fila.obter(entrada.job_id);
  if (!job) return `Job desconhecido: ${entrada.job_id}`;
  if (job.status !== 'concluido') return `O job ${job.id} esta "${job.status}", ainda nao da para ler resultados.`;
  const { offset, limite } = normalizarPaginacao(entrada.offset, entrada.limite, LIMITE_MAX, LIMITE_PADRAO);
  const { total, itens } = deps.fila.resultados(job.id, offset, limite);
  if (!itens.length) return `Sem itens em offset ${offset} (total ${total}).`;
  return `Mostrando ${offset + 1}–${offset + itens.length} de ${total}:\n\n`
    + itens.map((it, i) => `[${offset + i + 1}] ${JSON.stringify(it)}`).join('\n\n');
}

async function executar(nome, entrada = {}, deps = {}) {
  try {
    if (nome === 'listar_tribunais') return await listarTribunais(entrada);
    if (nome === 'buscar_jurisprudencia') return await buscar(entrada, deps);
    if (nome === 'ler_resultados') return await lerResultados(entrada, deps);
    return `Ferramenta desconhecida: ${nome}`;
  } catch (e) {
    return `Erro ao executar ${nome}: ${e.message}`;
  }
}

module.exports = { definicoes, executar };
