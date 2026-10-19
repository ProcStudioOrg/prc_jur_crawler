const crypto = require('node:crypto');

/**
 * Feedback do usuario vira card no Linear (BRU-91).
 *
 * Porte em JS puro do nucleo que ja roda no FullFucker Dashboard (issue-reporter/
 * linear.ts) e no WhatsOrganizer (lib/issue_reporter.rb). Mesmo contrato de fio
 * (GET <base>/meta, POST <base>), mesma composicao de titulo e de corpo — o widget
 * (publico/feedback.js) e literalmente o mesmo arquivo. O que muda aqui:
 *
 *  - quem reporta e um usuario AUTENTICADO do ProcStudio (req.principal): a identidade
 *    vai no card como contexto do servidor, nunca e pedida no formulario;
 *  - a chave do Linear so existe no ambiente do servidor. Nada dela sai em /meta,
 *    em log ou em resposta — o browser so fica sabendo se o recurso esta ligado e o
 *    nome/chave do time;
 *  - prefixo `[jurCrawler] `, estado inicial `Todo` e checklist de QA sao fixos no
 *    servidor: o browser nao escolhe time, labels arbitrarias nem GraphQL;
 *  - rate limit por principal (5/hora) e idempotencia (mesmo principal + mesmo titulo
 *    e corpo em 10 min devolvem o MESMO card): duplo clique e retentativa nao criam
 *    dois cards.
 *
 * Sem dependencia nova: sao duas queries GraphQL e o fetch nativo do Node 22. O
 * `transport` e injetavel para os testes nao tocarem a rede.
 */

const GRAPHQL_URL = 'https://api.linear.app/graphql';

const MAX_TITULO = 160;
const MAX_CORPO = 6000;
const MAX_ENTRADAS = 20;
const MAX_ENTRADA = 400;
const MAX_EXTRA = 20;

const PREFIXO_TITULO = '[jurCrawler] ';
const ESTADO_INICIAL = 'Todo';
const NOME_APP = 'JurCrawler';

const TETO_POR_JANELA = 5;
const JANELA_TAXA_MS = 60 * 60 * 1000;
const JANELA_IDEMPOTENCIA_MS = 10 * 60 * 1000;
const CACHE_TIME_MS = 5 * 60 * 1000;

const PRIORIDADES = [
  { value: 1, label: 'Urgente — produção quebrada ou você travado' },
  { value: 2, label: 'Alta — atinge usuário, mas tem contorno' },
  { value: 3, label: 'Média — o padrão' },
  { value: 4, label: 'Baixa — melhoria sem prazo' },
];

/** Erro do outro lado (chave invalida, Linear fora). Vira 502 na rota. */
class ErroLinear extends Error {}

/** Erro de quem enviou. Vira 400 (ou o status que carregar: 429, 503). */
class ErroEnvio extends Error {
  constructor(mensagem, status = 400, extra = {}) {
    super(mensagem);
    this.status = status;
    Object.assign(this, extra);
  }
}

const QUERY_TIME = `
  query TeamMeta($teamId: String!) {
    team(id: $teamId) {
      id key name
      states(first: 100) { nodes { id name type position } }
    }
    issueLabels(first: 250) {
      nodes { id name isGroup team { id } parent { id name } }
    }
  }`;

const MUTATION_CRIAR = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { identifier url } }
  }`;

function configurar(env = process.env) {
  const lista = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    ligado: String(env.LINEAR_ENABLED || 'true') !== 'false',
    apiKey: String(env.LINEAR_API_KEY || ''),
    teamId: String(env.LINEAR_TEAM_ID || ''),
    grupoModulo: String(env.LINEAR_MODULE_GROUP || ''),
    grupoTipo: String(env.LINEAR_TYPE_GROUP || ''),
    labelsSempre: lista(env.LINEAR_ALWAYS_LABELS),
  };
}

function criarFeedback(opcoes = {}) {
  const env = opcoes.env || process.env;
  const transport = opcoes.transport || fetch;
  const agora = opcoes.agora || Date.now;
  const config = configurar(env);
  const versao = opcoes.versao || require('../package.json').version;
  const revisao = opcoes.revisao || '';
  const ambiente = opcoes.ambiente || 'production';

  const configurado = () => config.ligado && Boolean(config.apiKey) && Boolean(config.teamId);

  // ---------- Linear ----------
  async function gql(query, variables) {
    let resposta;
    try {
      resposta = await transport(GRAPHQL_URL, {
        method: 'POST',
        headers: { authorization: config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new ErroLinear(`Não foi possível falar com o Linear: ${e.message}`);
    }
    if (resposta.status === 401 || resposta.status === 403) throw new ErroLinear('Chave do Linear inválida ou sem permissão.');
    if (resposta.status !== 200) throw new ErroLinear(`Linear respondeu ${resposta.status}.`);
    let corpo;
    try { corpo = await resposta.json(); } catch { throw new ErroLinear('Linear respondeu algo que não é JSON.'); }
    if (Array.isArray(corpo.errors) && corpo.errors.length) {
      throw new ErroLinear(corpo.errors.map((e) => e.message).join('; '));
    }
    if (!corpo.data) throw new ErroLinear('Linear respondeu sem dados.');
    return corpo.data;
  }

  // Vocabulario do time (estados, labels), cacheado por 5 min: muda raramente e e
  // lido a cada abertura do widget.
  let cacheTime = null;
  async function metaDoTime() {
    if (cacheTime && agora() - cacheTime.em < CACHE_TIME_MS) return cacheTime.meta;
    const dados = await gql(QUERY_TIME, { teamId: config.teamId });
    const time = dados.team;
    if (!time) throw new ErroLinear('Time do Linear não existe ou a chave não o enxerga.');
    const labels = (dados.issueLabels?.nodes || [])
      .filter((l) => !l.team || l.team.id === config.teamId)
      .map((l) => ({ id: l.id, name: l.name, group: Boolean(l.isGroup), parent: l.parent ? l.parent.name : null }));
    const meta = {
      key: time.key,
      name: time.name,
      labels,
      states: [...(time.states?.nodes || [])].sort((a, b) => a.position - b.position),
    };
    cacheTime = { em: agora(), meta };
    return meta;
  }

  const filhosDoGrupo = (meta, grupo) => (!grupo ? [] : meta.labels
    .filter((l) => !l.group && l.parent === grupo)
    .map((l) => ({ value: l.name, label: l.name }))
    .sort((a, b) => a.label.localeCompare(b.label)));

  // Aceita so o que o grupo contem: o browser manda um NOME de label e nada o impede
  // de mandar outro — "qualquer label" inclui as internas.
  const escolherDoGrupo = (meta, grupo, pedido) => {
    if (!grupo || !pedido) return null;
    const achada = meta.labels.find((l) => !l.group && l.parent === grupo && l.name === pedido);
    return achada ? achada.name : null;
  };

  const resolverLabels = (meta, nomes) => [...new Set(nomes
    .map((nome) => meta.labels.find((l) => !l.group && l.name === nome)?.id)
    .filter(Boolean))];

  // ---------- GET /meta ----------
  // Nunca lanca: widget quebrado nao pode quebrar a tela. E nunca inclui a chave.
  async function meta() {
    const base = {
      enabled: false,
      app: { name: NOME_APP, version: versao, commit: revisao || null, env: ambiente },
      team: null,
      author: '',
      modules: [],
      types: [],
      priorities: PRIORIDADES,
      moduleByPath: {},
      requireContact: false,
    };
    if (!configurado()) return base;
    try {
      const m = await metaDoTime();
      return {
        ...base,
        enabled: true,
        team: { key: m.key, name: m.name },
        modules: filhosDoGrupo(m, config.grupoModulo),
        types: filhosDoGrupo(m, config.grupoTipo),
      };
    } catch (e) {
      // Mensagem generica: o detalhe (que pode citar a chave) fica no log do servidor.
      console.error('[feedback] meta:', e.message);
      return { ...base, error: 'Integração indisponível no momento.' };
    }
  }

  // ---------- rate limit e idempotencia, por principal ----------
  const envios = new Map();      // chave do principal -> [timestamps]
  const recentes = new Map();    // chave do principal + hash(titulo+corpo) -> {em, resultado}

  const chaveDe = (principal) => `${principal.issuer}|${principal.userId}`;

  function limpar(chave) {
    const limite = agora() - JANELA_TAXA_MS;
    const lista = (envios.get(chave) || []).filter((t) => t > limite);
    if (lista.length) envios.set(chave, lista); else envios.delete(chave);
    for (const [k, v] of recentes) if (agora() - v.em > JANELA_IDEMPOTENCIA_MS) recentes.delete(k);
    return lista;
  }

  // ---------- POST ----------
  async function enviar(principal, corpo) {
    if (!principal || typeof principal.userId !== 'string' || !principal.userId) {
      throw new ErroEnvio('Entre com sua conta ProcStudio.', 401);
    }
    if (!configurado()) throw new ErroEnvio('Integração de feedback não está configurada.', 503);
    const dados = corpo && typeof corpo === 'object' ? corpo : {};

    const titulo = cortar(dados.title, MAX_TITULO);
    const texto = cortar(dados.body, MAX_CORPO);
    if (titulo.length < 4) throw new ErroEnvio('Dê um título com pelo menos 4 caracteres.');
    if (!texto) throw new ErroEnvio('Descreva o que aconteceu.');

    const chave = chaveDe(principal);
    const assinatura = `${chave}|${crypto.createHash('sha256').update(`${titulo}\n${texto}`).digest('hex')}`;
    const lista = limpar(chave);

    // Idempotencia ANTES do rate limit: a retentativa do mesmo envio nao conta como
    // envio novo nem pode cair no 429 por causa do proprio duplo clique.
    const repetido = recentes.get(assinatura);
    if (repetido) return { ...repetido.resultado, repetido: true };

    if (lista.length >= TETO_POR_JANELA) {
      const esperaS = Math.max(1, Math.ceil((lista[0] + JANELA_TAXA_MS - agora()) / 1000));
      throw new ErroEnvio('Muitos envios. Tente de novo mais tarde.', 429, { retryAfter: esperaS });
    }

    const m = await metaDoTime();
    const contexto = normalizarContexto(dados.context);
    const modulo = escolherDoGrupo(m, config.grupoModulo, dados.module);
    const tipo = escolherDoGrupo(m, config.grupoTipo, dados.type);
    const labelIds = resolverLabels(m, [...config.labelsSempre, modulo, tipo].filter(Boolean));
    const prioridade = PRIORIDADES.some((p) => p.value === Number(dados.priority)) ? Number(dados.priority) : undefined;
    const estado = m.states.find((s) => s.name.toLowerCase() === ESTADO_INICIAL.toLowerCase());

    const input = {
      teamId: config.teamId,
      title: comporTitulo(titulo, modulo),
      description: comporDescricao(texto, contexto, principal),
    };
    if (prioridade) input.priority = prioridade;
    if (labelIds.length) input.labelIds = labelIds;
    if (estado) input.stateId = estado.id;

    const resultado = (await gql(MUTATION_CRIAR, { input })).issueCreate;
    if (!resultado || !resultado.success || !resultado.issue) throw new ErroLinear('O Linear recusou a criação do card.');

    const saida = { ok: true, identifier: resultado.issue.identifier, url: resultado.issue.url };
    lista.push(agora());
    envios.set(chave, lista);
    recentes.set(assinatura, { em: agora(), resultado: saida });
    return saida;
  }

  // ---------- composicao ----------
  function comporTitulo(titulo, modulo) {
    return `${PREFIXO_TITULO}${modulo ? `${modulo} -> ` : ''}${titulo}`.trim();
  }

  function comporDescricao(texto, ctx, principal) {
    const partes = [
      texto,
      '\n---\n',
      '## Contexto (capturado pelo sistema)\n',
      tabelaDeContexto(ctx, principal),
      blocoConsole(ctx),
      blocoRede(ctx),
      BLOCO_QA,
      `\n<sub>Aberta pelo reporter embutido em ${NOME_APP}.</sub>`,
    ];
    return partes.filter((p) => p).join('\n');
  }

  function tabelaDeContexto(ctx, principal) {
    const carimbo = [versao && `v${versao}`, revisao && `\`${revisao}\``, ambiente].filter(Boolean).join(' · ');
    const linhas = [
      ['Origem', `**${celula(NOME_APP)}** — ${celula(carimbo)}`],
      ['Tela', ctx.screen ? `\`${celula(ctx.path)}\` — ${celula(ctx.screen)}` : `\`${celula(ctx.path)}\``],
      ['URL', ctx.url ? `<${celula(ctx.url)}>` : '—'],
      ['Quando', `${celula(ctx.at)} (${celula(ctx.timezone)})`],
      ['Sessão', celula([ctx.viewport, ctx.language].filter(Boolean).join(' · '))],
      ['Navegador', `\`${celula(ctx.userAgent)}\``],
    ];
    if (ctx.referrer) linhas.push(['Veio de', `<${celula(ctx.referrer)}>`]);
    for (const [k, v] of Object.entries(ctx.extra)) linhas.push([celula(k), celula(v)]);
    // Por ultimo, o que o SERVIDOR sabe: quem esta logado, de que equipe, por qual
    // emissor. Vem do principal autenticado, nao do browser — e afirmacao do servidor,
    // nao do cliente, e por isso tem a palavra final.
    linhas.push(['Usuário', celula(principal.userId)]);
    linhas.push(['Equipe', celula(principal.teamId || '')]);
    linhas.push(['Emissor', celula(principal.issuer || '')]);
    return ['| | |', '|---|---|', ...linhas.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
  }

  function blocoConsole(ctx) {
    if (!ctx.console.length) return '';
    const linhas = ctx.console.map((c) => `[${c.at}] ${c.level.toUpperCase()} ${c.message}`);
    return `\n### Console (${ctx.console.length})\n\n\`\`\`\n${linhas.join('\n')}\n\`\`\`\n`;
  }

  function blocoRede(ctx) {
    if (!ctx.network.length) return '';
    const linhas = ctx.network.map((n) => `| \`${n.status}\` | ${celula(n.method)} | ${celula(n.url)} | ${celula(n.at)} |`);
    return [`\n### Requisições que falharam (${ctx.network.length})\n`, '| status | método | url | quando |', '|---|---|---|---|', ...linhas, ''].join('\n');
  }

  return {
    meta,
    enviar,
    configurado,
    limparCache: () => { cacheTime = null; },
  };
}

// ---------- normalizacao do que chega do browser ----------
const BLOCO_QA = '\n## Critério de QA\n\n- [ ] Passo reproduzível:\n- [ ] Resultado esperado:\n- [ ] Evidência:\n';

function cortar(valor, max) {
  const s = (typeof valor === 'string' ? valor : String(valor ?? '')).trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Celula de tabela markdown: sem pipe e sem quebra de linha. */
function celula(valor) {
  return String(valor ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function normalizarContexto(bruto) {
  const c = bruto && typeof bruto === 'object' ? bruto : {};
  const entradas = Array.isArray(c.console) ? c.console.slice(-MAX_ENTRADAS) : [];
  const rede = Array.isArray(c.network) ? c.network.slice(-MAX_ENTRADAS) : [];
  const extra = c.extra && typeof c.extra === 'object' && !Array.isArray(c.extra) ? c.extra : {};
  const caminho = cortar(c.path, 200);
  const quando = cortar(c.at, 40);
  return {
    url: cortar(c.url, 500),
    path: caminho || '/',
    screen: cortar(c.screen, 120),
    referrer: cortar(c.referrer, 500),
    viewport: cortar(c.viewport, 40),
    userAgent: cortar(c.userAgent, 300),
    language: cortar(c.language, 20),
    timezone: cortar(c.timezone, 60),
    at: quando || new Date().toISOString(),
    console: entradas.map((e) => {
      const x = e && typeof e === 'object' ? e : {};
      return { level: x.level === 'warn' ? 'warn' : 'error', message: cortar(x.message, MAX_ENTRADA), at: cortar(x.at, 40) };
    }),
    network: rede.map((n) => {
      const x = n && typeof n === 'object' ? n : {};
      return { method: cortar(x.method, 10) || 'GET', url: cortar(x.url, 300), status: Number(x.status) || 0, at: cortar(x.at, 40) };
    }),
    extra: Object.fromEntries(Object.entries(extra).slice(0, MAX_EXTRA).map(([k, v]) => [cortar(k, 40), cortar(v, 200)])),
  };
}

module.exports = {
  criarFeedback, configurar, ErroLinear, ErroEnvio, normalizarContexto,
  PREFIXO_TITULO, ESTADO_INICIAL, TETO_POR_JANELA, JANELA_TAXA_MS, JANELA_IDEMPOTENCIA_MS, PRIORIDADES,
};
