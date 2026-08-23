const catalogo = require('./catalogo');
const relator = require('./relator');
const executorPadrao = require('./executor');
const { validarMaxPaginas, validarData, normalizarPaginacao } = require('./validacao');

const LIMITE_MAX = 20;
const LIMITE_PADRAO = 5;

// Mesmo teto que a rota HTTP usa para maxPaginas (rotas/buscas.js) — o teto de
// maxPaginas nao muda entre as duas superficies, so o de paginacao de resultados
// muda (100 na rota, LIMITE_MAX aqui, para nao estourar o contexto do modelo).
const MAX_PAGINAS_TETO = 50;

// I5 (revisao final): `buscar_jurisprudencia` chamava fila.aguardar(id) SEM TIMEOUT, e
// o executor da CLI so desiste em 10 minutos. Nesse meio tempo o POST /mcp fica aberto,
// o cliente MCP desiste antes — e quando desiste, o chamador NUNCA RECEBEU O job_id.
// Resultado: `ler_resultados` fica inutil (ninguem sabe o id) e o crawler segue rodando
// sem ninguem ouvindo; o trabalho vira irrecuperavel. O chat resolveu isso com
// AbortController (rotas/chat.js), mas o MCP nao herdou nada disso.
//
// A saida e devolver, dentro do prazo, um texto UTIL que carrega o job_id e ensina o
// caminho de volta (`ler_resultados`), em vez de segurar a conexao ate ela morrer. O job
// continua rodando: nada e cancelado aqui de proposito — quem chamou pode buscar o
// resultado depois.
const TIMEOUT_BUSCA_MS = Number(process.env.JUR_TIMEOUT_BUSCA_MS || 60_000);

// Sentinela propria em vez de null: `fila.aguardar` ja usa null para "job_id que nao
// existe", e confundir os dois transformaria um timeout em "job desconhecido".
const EXPIROU = Symbol('busca ainda rodando');

function aguardarComTimeout(fila, id, ms) {
  if (!(ms > 0)) return fila.aguardar(id);
  let relogio;
  const espera = fila.aguardar(id).then((j) => { clearTimeout(relogio); return j; });
  const limite = new Promise((resolve) => {
    // Sem unref() de proposito: o timer PRECISA segurar o event loop enquanto a espera
    // corre, senao um processo que nao tem mais nada agendado (a fila esta bloqueada
    // justamente esperando o crawler) sai antes de o prazo vencer e a promise fica
    // pendente para sempre. Nao vaza: o caminho feliz limpa o timer no .then acima, e
    // o caminho de timeout ja disparou.
    relogio = setTimeout(() => resolve(EXPIROU), ms);
  });
  return Promise.race([espera, limite]);
}

function definicoes() {
  return [
    {
      name: 'listar_tribunais',
      description:
        'Lista os tribunais brasileiros disponiveis para busca de jurisprudencia, com o estado de cada um. '
        + 'Use ANTES de buscar, para escolher o tribunal certo e evitar pedir um que esta bloqueado. '
        + 'Estados: ok (funciona), instavel (funciona com ressalva — leia a nota), '
        + 'sem-acesso (bloqueado por captcha), exige-sessao (precisa da credencial do usuario). '
        + 'Cada linha traz tambem `magistrado:` — se o tribunal filtra por relator e em que forma '
        + '(nome-exato, trecho, nome, codigo) ou `nao`, quando esse filtro nao existe naquele portal.',
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
        + 'Pode demorar minutos em tribunais que exigem navegador. '
        + 'O filtro por MAGISTRADO (relator) existe em parte dos tribunais, nao em todos, '
        + 'e a forma do valor muda de um para outro — veja o campo relator.',
      input_schema: {
        type: 'object',
        properties: {
          tribunal: { type: 'string', description: 'o comando do tribunal, ex.: stf, trf4, tjpr' },
          query: { type: 'string', description: 'os termos de busca' },
          dataInicio: { type: 'string', description: 'data no formato DD/MM/AAAA, ex.: 01/01/2024. ISO (AAAA-MM-DD) e RECUSADO.' },
          dataFim: { type: 'string', description: 'data no formato DD/MM/AAAA, ex.: 31/12/2024. ISO (AAAA-MM-DD) e RECUSADO.' },
          maxPaginas: { type: 'integer', description: `paginas a percorrer (default 3, maximo ${MAX_PAGINAS_TETO})` },
          relator: {
            type: 'string',
            description: 'MAGISTRADO (relator). So funciona nos tribunais que tem esse filtro — '
              + 'listar_tribunais informa quais, e nos que nao tem a busca e RECUSADA em vez de rodar sem o filtro. '
              + 'A forma do valor varia: em uns basta um trecho do nome, em outros so o NOME EXATO do combo filtra, '
              + 'e em alguns o que filtra e um CODIGO, nao o nome. Use listar_relatores antes para pegar o valor valido.',
          },
        },
        required: ['tribunal', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'listar_relatores',
      description:
        'Lista os magistrados (relatores) que um tribunal aceita no filtro de busca, com o valor exato a usar. '
        + 'Use ANTES de buscar com relator em qualquer tribunal que exija nome exato ou codigo — '
        + 'valor aproximado nao da erro nesses tribunais, da ZERO, e zero se le como '
        + '"esse magistrado nao julgou nada sobre o tema".',
      input_schema: {
        type: 'object',
        properties: {
          tribunal: { type: 'string', description: 'o comando do tribunal, ex.: stf, tjsc, trt9' },
          termo: {
            type: 'string',
            description: 'trecho do nome. Obrigatorio so nos tribunais cuja listagem e autocomplete '
              + '(a ferramenta avisa quando for o caso).',
          },
        },
        required: ['tribunal'],
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

// Cada implementacao devolve {texto, ok}. `ok` NAO mede se a resposta e boa noticia —
// mede se a FERRAMENTA conseguiu executar. A fronteira (revisao da Task 11):
//   ok:false = falha de EXECUCAO: parametro obrigatorio ausente/invalido, referencia
//     que nao existe (job_id desconhecido, tribunal que nao esta no catalogo),
//     dependencia faltando, excecao interna. O cliente MCP deve poder decidir "retry
//     com outro input" ou "log de erro" com base nisso.
//   ok:true = resultado LEGITIMO do dominio, mesmo quando a noticia e ruim: tribunal
//     que existe mas esta indisponivel, busca com zero resultados, job cujo crawler
//     falhou ou foi cancelado, job ainda rodando. Isso e conteudo para o modelo ler e
//     explicar ao usuario, nao um erro de tool — errar essa fronteira para o lado do
//     isError faria o cliente esconder ou tentar de novo uma resposta que ja e final.

/**
 * O usuario liga e desliga tribunais no painel de disponibilidade, e a selecao chega em
 * `deps.escopoTribunais` (um Set). `undefined` significa "o cliente nao declarou escopo"
 * — catalogo inteiro, como sempre foi. Um Set VAZIO nao e a mesma coisa: significa que o
 * usuario desligou tudo, e a diferenca importa porque tratar vazio como "sem restricao"
 * faria a interface prometer um recorte que o servidor ignora.
 */
function foraDoEscopo(comando, deps) {
  return Boolean(deps.escopoTribunais) && !deps.escopoTribunais.has(comando);
}

/**
 * Texto da recusa. E aqui que mora o invariante: um tribunal desligado NAO pode virar um
 * zero. Sem estas frases o modelo reporta a recusa como "nao encontrei jurisprudencia" —
 * a mesma falha do zero do tribunal, com outra causa.
 */
function explicarDesligado(comando, nome, deps) {
  const ligados = [...deps.escopoTribunais];
  if (!ligados.length) {
    return `Nenhum tribunal esta ligado no painel do usuario, entao nao ha onde buscar.\n`
      + 'A BUSCA NAO FOI FEITA. NAO diga que nao ha jurisprudencia: ninguem procurou. '
      + 'Peca ao usuario para ligar ao menos um tribunal na Disponibilidade.';
  }
  return `O tribunal ${comando} (${nome}) esta DESLIGADO no painel do usuario.\n`
    + `Ligados agora: ${ligados.join(', ')}.\n`
    + 'A BUSCA NAO FOI FEITA. NAO diga que nao ha jurisprudencia nesse tribunal, e NAO troque '
    + `por outro em silencio como se fosse a mesma coisa. Peca ao usuario para ligar ${comando} `
    + 'na Disponibilidade, ou confirme com ele se prefere um dos que estao ligados.';
}

async function listarTribunais(entrada, deps = {}) {
  const lista = catalogo.listar({ segmento: entrada.segmento, uf: entrada.uf, estado: entrada.estado })
    .filter((t) => !foraDoEscopo(t.comando, deps));
  if (!lista.length) return { texto: 'Nenhum tribunal bate com esse filtro.', ok: true };
  const linhas = lista.map((t) => {
    const uf = t.uf.length ? ` [${t.uf.join(',')}]` : '';
    // `magistrado:` diz se o filtro por relator existe naquele tribunal e em que forma.
    // Sem isto o modelo so descobre tentando, e o TJPR (que nao tem o filtro) parecia
    // uma busca quebrada em vez de um tribunal que nao oferece o recorte.
    const r = t.relator && t.relator.suportado ? `magistrado: ${t.relator.forma}` : 'magistrado: nao';
    return `${t.comando} — ${t.nome}${uf} · ${t.estado} · ${r}`;
  });
  return { texto: `${lista.length} tribunais:\n${linhas.join('\n')}`, ok: true };
}

async function buscar(entrada, deps) {
  // Buracos de parametro obrigatorio ausente (achado da revisao): sem isso, tribunal
  // ausente cai em catalogo.obter(undefined) -> null -> mensagem de "desconhecido"
  // enganosa, e query ausente seguia ate o crawler em silencio.
  if (!entrada.tribunal) return { texto: 'tribunal e obrigatorio.', ok: false };
  if (!entrada.query) return { texto: 'query e obrigatoria.', ok: false };

  const info = catalogo.obter(entrada.tribunal);
  // Nome que nao bate com nenhum tribunal do catalogo e parametro invalido (ok:false),
  // diferente de um tribunal que existe mas esta com o acesso quebrado (ok:true abaixo).
  if (!info) {
    return {
      texto: `Tribunal desconhecido: "${entrada.tribunal}". Use listar_tribunais para ver os validos.`,
      ok: false,
    };
  }
  // Depois de `!info` (desconhecido continua sendo desconhecido, nao "desligado") e
  // antes de qualquer outra coisa: o escopo e do usuario, e nem chega a valer a pena
  // discutir disponibilidade de um tribunal que ele desligou.
  if (foraDoEscopo(entrada.tribunal, deps)) {
    return { texto: explicarDesligado(info.comando, info.nome, deps), ok: false };
  }

  if (!info.disponivel) {
    return {
      texto: `O tribunal ${info.comando} (${info.nome}) esta INDISPONIVEL — estado "${info.estado}".\n`
        + `Motivo registrado: ${info.nota}\n`
        + 'Nao invente resultado: diga isso ao usuario e sugira outro tribunal.',
      ok: true,
    };
  }

  const validacaoMaxPaginas = validarMaxPaginas(entrada.maxPaginas, MAX_PAGINAS_TETO);
  if (!validacaoMaxPaginas.valido) return { texto: validacaoMaxPaginas.motivo, ok: false };

  // Filtro por MAGISTRADO. Onde o tribunal nao tem esse filtro, o pedido e RECUSADO —
  // nao silenciosamente ignorado. Ignorar rodaria a busca sem o recorte e devolveria os
  // julgados de TODOS os desembargadores como se fossem daquele magistrado: o modelo nao
  // teria como saber, e o usuario receberia uma lista errada com cara de certa. E o
  // mesmo padrao da ressalva do zero — a falha aqui nao da sintoma.
  const relatorPedido = typeof entrada.relator === 'string' ? entrada.relator.trim() : '';
  const capacidade = relator.obter(entrada.tribunal);
  if (relatorPedido && (!capacidade || !capacidade.suportado)) {
    return { texto: relator.explicarAusencia(entrada.tribunal, info.nome), ok: false };
  }

  // I4: o schema desta tool nao e `strict`, e o modelo emite ISO com naturalidade a
  // partir de "desde 2024". Sem validar, `-di 2024-01-01` filtrava errado e o total 0
  // resultante era lido como "o acervo nao tem" — falha de parametro disfarcada de
  // busca vazia. O texto devolvido ENSINA o formato para o modelo corrigir sozinho.
  for (const campo of ['dataInicio', 'dataFim']) {
    const v = validarData(entrada[campo], campo);
    if (!v.valido) return { texto: v.motivo, ok: false };
  }

  const { id } = deps.fila.enfileirar(entrada.tribunal, {
    query: entrada.query,
    dataInicio: entrada.dataInicio,
    dataFim: entrada.dataFim,
    maxPaginas: entrada.maxPaginas || 3,
    relator: relatorPedido || undefined,
  });
  // Vai junto de TODA resposta desta busca (inclusive o zero e o timeout): quando o
  // tribunal exige nome exato ou codigo, o valor aproximado nao falha — devolve zero. Se
  // essa ressalva so aparecesse no caminho do zero, o modelo leria "0 resultados" sem
  // saber que a causa provavel foi a forma do valor.
  const ressalvaRelator = relatorPedido ? `\nRESSALVA DO FILTRO DE MAGISTRADO: ${relator.explicarForma(entrada.tribunal)}` : '';
  const prazoMs = deps.timeoutBuscaMs === undefined ? TIMEOUT_BUSCA_MS : deps.timeoutBuscaMs;
  const job = await aguardarComTimeout(deps.fila, id, prazoMs);

  // A partir daqui a busca EXISTE, entao todo retorno carrega o `jobId` — inclusive o
  // timeout e o erro. E no timeout que ele mais importa: o job continua rodando, e sem o
  // vinculo ninguem consegue achar o resultado depois.
  if (job === EXPIROU) {
    return {
      jobId: id,
      texto: `A busca ${id} em ${info.comando} AINDA ESTA RODANDO — passou de ${Math.round(prazoMs / 1000)}s `
        + 'e este canal nao pode ficar esperando mais (tribunal que exige navegador chega a levar minutos).\n'
        + `O TRABALHO NAO FOI PERDIDO. Guarde este job_id: ${id}\n`
        + `Para pegar o resultado, chame ler_resultados com job_id "${id}" daqui a pouco — `
        + 'se ainda nao tiver terminado, ele diz o status e voce tenta de novo.\n'
        + 'NAO diga ao usuario que a busca falhou nem que nao ha jurisprudencia: ela nao terminou.'
        + ressalvaRelator,
      ok: true,
    };
  }
  // Defensivo: `aguardar` resolve com null se o job sumir do banco entre o enfileirar e
  // o fim (banco indisponivel, por exemplo). Sem isto, `job.status` abaixo seria um
  // TypeError cru dentro do loop de tool-use.
  if (!job) {
    return { jobId: id, texto: `Nao foi possivel obter o estado final da busca ${id}.`, ok: false };
  }

  if (job.status === 'erro') {
    return {
      jobId: id,
      texto: `A busca FALHOU (job ${job.id}): ${job.erro}\n`
        + 'Isso NAO significa que nao ha jurisprudencia — o crawler nao completou. Diga isso ao usuario.'
        + ressalvaRelator,
      ok: true,
    };
  }
  if (job.status === 'cancelado') return { jobId: id, texto: `A busca ${job.id} foi cancelada.`, ok: true };

  if (job.total === 0) {
    return {
      jobId: id,
      texto: `job ${job.id}: 0 resultados em ${info.comando} para "${entrada.query}".\n`
        + `RESSALVA DO TRIBUNAL: ${info.nota || '(sem ressalva registrada)'}\n`
        + 'Zero aqui pode ser ausencia de julgado OU limitacao do acervo — nao afirme que "nao existe jurisprudencia".'
        + ressalvaRelator,
      ok: true,
    };
  }
  return {
    jobId: id,
    texto: `job ${job.id}: ${job.total} resultados em ${info.comando} para "${entrada.query}". `
      + 'Use ler_resultados com esse job_id para ver os julgados.'
      + ressalvaRelator,
    ok: true,
  };
}

/**
 * Lista os valores validos do filtro de magistrado de um tribunal.
 *
 * Existe porque, na maioria dos tribunais que TEM o filtro, valor aproximado nao da
 * erro: da zero. E zero de um filtro errado e indistinguivel de "este magistrado nao
 * julgou nada sobre o tema" — que e a afirmacao que este repo inteiro existe para nao
 * deixar o modelo fazer sem base.
 */
async function listarRelatores(entrada, deps) {
  if (!entrada.tribunal) return { texto: 'tribunal e obrigatorio.', ok: false };

  const info = catalogo.obter(entrada.tribunal);
  if (!info) {
    return {
      texto: `Tribunal desconhecido: "${entrada.tribunal}". Use listar_tribunais para ver os validos.`,
      ok: false,
    };
  }

  if (foraDoEscopo(entrada.tribunal, deps)) {
    return { texto: explicarDesligado(info.comando, info.nome, deps), ok: false };
  }

  const capacidade = relator.obter(entrada.tribunal);
  if (!capacidade || !capacidade.suportado) {
    return { texto: relator.explicarAusencia(entrada.tribunal, info.nome), ok: false };
  }

  if (!capacidade.listagem) {
    // Suporta o filtro mas a CLI nao expoe nenhum modo de listagem para ele. Dizer isso
    // e util: o modelo sabe que precisa do nome vindo do usuario e nao fica chamando
    // esta ferramenta em laco.
    return {
      texto: `${info.comando} aceita filtro por magistrado, mas NAO tem listagem de relatores na CLI.\n`
        + `${relator.explicarForma(entrada.tribunal)}\n`
        + 'Peca o nome ao usuario, ou busque por termo e leia o campo `relator` dos julgados devolvidos.',
      ok: true,
    };
  }

  const args = [...capacidade.listagem.args];
  if (capacidade.listagem.exigeTermo) {
    const termo = typeof entrada.termo === 'string' ? entrada.termo.trim() : '';
    if (!termo) {
      return {
        texto: `A listagem de relatores de ${info.comando} e AUTOCOMPLETE: ela exige um trecho do nome.\n`
          + 'Chame listar_relatores de novo passando `termo` com parte do nome do magistrado.',
        ok: false,
      };
    }
    args[args.indexOf('<termo>')] = termo;
  }

  const listarFn = deps.listarFn || ((comando, a) => executorPadrao.listar(comando, a));
  const r = await listarFn(entrada.tribunal, args);
  if (!r.ok) {
    // Falha de LEITURA do combo, nunca "este tribunal nao tem esses magistrados".
    return {
      texto: `FALHA AO LISTAR os relatores de ${info.comando}: ${r.erro}\n`
        + 'Isso NAO e uma lista vazia. NAO diga ao usuario que o magistrado nao existe nesse tribunal '
        + 'e nao chute o valor: sem o combo, buscar com nome aproximado devolve zero silencioso.',
      ok: false,
    };
  }

  // O envelope vem cru: cada tribunal nomeia sua chave de um jeito (`relatores`,
  // `magistrados`, dentro de `combos`…). Serializar aqui e mais honesto que adivinhar
  // um formato unico e entregar um recorte errado.
  const { success, ...dados } = r.dados || {};
  return {
    texto: `Filtro de magistrado de ${info.comando}. ${relator.explicarForma(entrada.tribunal)}\n\n`
      + `${JSON.stringify(dados)}`,
    ok: true,
  };
}

async function lerResultados(entrada, deps) {
  // Achado da revisao: job_id ausente ia direto pro bind do SQLite
  // (deps.fila.obter(undefined)) e vazava "Provided value cannot be bound to SQLite
  // parameter 1" pro cliente. Valida antes de tocar a fila.
  if (!entrada.job_id) return { texto: 'job_id e obrigatorio.', ok: false };
  const job = deps.fila.obter(entrada.job_id);
  // job_id que nao existe e referencia invalida (ok:false) — diferente de um job que
  // existe mas ainda nao terminou (ok:true abaixo).
  if (!job) return { texto: `Job desconhecido: ${entrada.job_id}`, ok: false };
  if (job.status !== 'concluido') {
    return { texto: `O job ${job.id} esta "${job.status}", ainda nao da para ler resultados.`, ok: true };
  }
  const { offset, limite } = normalizarPaginacao(entrada.offset, entrada.limite, LIMITE_MAX, LIMITE_PADRAO);
  const { total, itens, erro } = deps.fila.resultados(job.id, offset, limite);
  // C3: falha de LEITURA e falha de EXECUCAO da ferramenta (ok:false), nao conteudo do
  // dominio. Antes ela voltava como "Sem itens em offset 0 (total 42)" com ok:true, e o
  // modelo reportava ao usuario que a busca nao trouxe julgados — falha de infra
  // disfarcada de busca vazia, que e exatamente o que este repo existe para impedir.
  if (erro) {
    return {
      texto: `FALHA AO LER os resultados do job ${job.id}: ${erro}\n`
        + `A busca terminou com total ${total}, mas os julgados nao estao mais legiveis no disco.\n`
        + 'Isso NAO e uma busca vazia: NAO diga ao usuario que nao ha jurisprudencia. '
        + 'Refaca a busca com buscar_jurisprudencia.',
      ok: false,
    };
  }
  if (!itens.length) return { texto: `Sem itens em offset ${offset} (total ${total}).`, ok: true };
  return {
    texto: `Mostrando ${offset + 1}–${offset + itens.length} de ${total}:\n\n`
      + itens.map((it, i) => `[${offset + i + 1}] ${JSON.stringify(it)}`).join('\n\n'),
    ok: true,
  };
}

/**
 * Versao completa de `executar`: devolve {texto, ok} em vez de so o texto. `ok`
 * distingue falha de EXECUCAO (ver comentario acima) de resultado legitimo do
 * dominio. Usada pelo MCP (mcp.js), que precisa do booleano para popular `isError`
 * corretamente — hoje mentia, marcando isError so pelo nome da tool ser conhecido,
 * nao pelo resultado real da chamada.
 *
 * Nunca lanca, pelo mesmo motivo que `executar` nunca lanca: e chamada no meio de um
 * loop de tool-use (MCP ou, via `executar`, o chat).
 */
async function executarDetalhado(nome, entrada = {}, deps = {}) {
  try {
    if (nome === 'listar_tribunais') return await listarTribunais(entrada, deps);
    if (nome === 'buscar_jurisprudencia') return await buscar(entrada, deps);
    if (nome === 'listar_relatores') return await listarRelatores(entrada, deps);
    if (nome === 'ler_resultados') return await lerResultados(entrada, deps);
    return { texto: `Ferramenta desconhecida: ${nome}`, ok: false };
  } catch (e) {
    return { texto: `Erro ao executar ${nome}: ${e.message}`, ok: false };
  }
}

/**
 * Contrato original, intacto: SEMPRE devolve string, NUNCA lanca. `llm.js` depende
 * disso (ver comentario la) — por isso isto e so um invólucro fino sobre
 * executarDetalhado, que descarta o `ok` e devolve so o texto.
 */
async function executar(nome, entrada = {}, deps = {}) {
  const { texto } = await executarDetalhado(nome, entrada, deps);
  return texto;
}

module.exports = { definicoes, executar, executarDetalhado };
