// Porta de issue-reporter/report.ts do FFD — manter em sincronia; sem build TS no JurCrawler.
//
// Núcleo do reporter, sem framework: recebe a config e um envio vindo do widget e devolve a
// issue criada. `config` segue ReporterConfig do FFD: enabled, apiKey, teamId, author,
// titleTemplate ({module} {title} {author}), moduleGroup, typeGroup, alwaysLabels,
// initialStateName, app {name, version, commit, env}, requireContact, qaChecklist,
// moduleByPath e serverContext (fatos do servidor, distintos do `extra` do browser);
// `appendix` (markdown montado pelo servidor) é extensão só do JurCrawler.

// O Linear é chamado pelo objeto do módulo (não por desestruturação) para o teste poder
// trocar as funções sem mock de loader.
const linear = require('./linear');
const { PRIORITIES } = require('./contract');

const { LinearError } = linear;

const DEFAULT_TITLE_TEMPLATE = '{module} -> {title} ({author})';

// Limites: existem por causa do app público; sem teto, um POST vira issue de 2 MB no Linear.
const MAX_TITLE = 160;
const MAX_BODY = 6000;
const MAX_ENTRIES = 20;
const MAX_ENTRY = 400;
const MAX_EXTRA_KEYS = 20;

class SubmissionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.name = 'SubmissionError';
  }
}

// Label e estado mudam raramente e são lidos a cada abertura do widget.
const META_TTL_MS = 5 * 60_000;
const metaCache = new Map();

function clearReporterCache() {
  metaCache.clear();
}

async function teamMeta(apiKey, teamId) {
  const hit = metaCache.get(teamId);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const meta = await linear.getTeamMeta(apiKey, teamId);
  metaCache.set(teamId, { at: Date.now(), meta });
  return meta;
}

function groupChildren(meta, group) {
  if (!group) return [];
  return meta.labels
    .filter((l) => !l.isGroup && l.parentName === group)
    .map((l) => ({ value: l.name, label: l.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/** GET <base>/meta. Nunca lança: widget quebrado não pode quebrar a tela. */
async function buildMeta(config) {
  const base = {
    enabled: false,
    app: config.app,
    team: null,
    author: config.author,
    modules: [],
    types: [],
    priorities: PRIORITIES,
    moduleByPath: config.moduleByPath,
    requireContact: config.requireContact,
  };

  if (!config.enabled || !config.apiKey || !config.teamId) return base;

  try {
    const meta = await teamMeta(config.apiKey, config.teamId);
    return {
      ...base,
      enabled: true,
      team: { key: meta.key, name: meta.name },
      modules: groupChildren(meta, config.moduleGroup),
      types: groupChildren(meta, config.typeGroup),
    };
  } catch (e) {
    // enabled:false com motivo: o widget some para o usuário final.
    return { ...base, error: e.message };
  }
}

// ─── Composição do texto ────────────────────────────────────────────────────

function clamp(value, max) {
  const s = typeof value === 'string' ? value : '';
  const trimmed = s.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Célula de tabela markdown: sem pipe e sem quebra de linha. */
function cell(value) {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function composeTitle(config, title, module) {
  let out = config.titleTemplate;
  out = module
    ? out.replace('{module}', module)
    : out.replace(/\{module\}\s*->\s*/, '').replace('{module}', '');
  out = config.author
    ? out.replace('{author}', config.author)
    : out.replace(/\s*\(\{author\}\)/, '').replace('{author}', '');
  return out.replace('{title}', title).trim();
}

function contextTable(config, ctx, reporter) {
  const app = config.app;
  const stamp = [app.version && `v${app.version}`, app.commit && `\`${app.commit}\``, app.env]
    .filter(Boolean)
    .join(' · ');

  const rows = [
    ['Origem', `**${cell(app.name)}** — ${cell(stamp)}`],
    ['Tela', ctx.screen ? `\`${cell(ctx.path)}\` — ${cell(ctx.screen)}` : `\`${cell(ctx.path)}\``],
    ['URL', ctx.url ? `<${cell(ctx.url)}>` : '—'],
    ['Quando', `${cell(ctx.at)} (${cell(ctx.timezone)})`],
    ['Sessão', cell([ctx.viewport, ctx.language].filter(Boolean).join(' · '))],
    ['Navegador', `\`${cell(ctx.userAgent)}\``],
  ];

  if (ctx.referrer) rows.push(['Veio de', `<${cell(ctx.referrer)}>`]);

  const who = [reporter?.name, reporter?.email].filter(Boolean).join(' · ');
  if (who) rows.push(['Relator', cell(who)]);

  for (const [k, v] of Object.entries(ctx.extra)) {
    rows.push([cell(k), cell(v)]);
  }
  // Por último: o que o servidor afirma tem a palavra final sobre o `extra` do browser.
  for (const [k, v] of Object.entries(config.serverContext ?? {})) {
    rows.push([cell(k), cell(v)]);
  }

  return ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

function consoleBlock(ctx) {
  if (!ctx.console.length) return '';
  const lines = ctx.console.map((c) => `[${c.at}] ${c.level.toUpperCase()} ${c.message}`);
  return `\n### Console (${ctx.console.length})\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
}

function networkBlock(ctx) {
  if (!ctx.network.length) return '';
  const rows = ctx.network.map((n) => `| \`${n.status}\` | ${cell(n.method)} | ${cell(n.url)} | ${cell(n.at)} |`);
  return [
    `\n### Requisições que falharam (${ctx.network.length})\n`,
    '| status | método | url | quando |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

const QA_BLOCK = `
## Critério de QA

- [ ] Passo reproduzível:
- [ ] Resultado esperado:
- [ ] Evidência:
`;

function composeDescription(config, sub) {
  const parts = [
    sub.body,
    '\n---\n',
    '## Contexto (capturado pelo sistema)\n',
    contextTable(config, sub.context, sub.reporter),
    consoleBlock(sub.context),
    networkBlock(sub.context),
    // Extensão do JurCrawler (não existe no FFD): bloco montado pelo servidor — a conversa na
    // tela — fora do corpo do usuário, para não disputar o teto de MAX_BODY com ele.
    config.appendix ? `\n${config.appendix}\n` : '',
  ];
  if (config.qaChecklist) parts.push(QA_BLOCK);
  parts.push(`\n<sub>Aberta pelo reporter embutido em ${config.app.name}.</sub>`);
  return parts.filter(Boolean).join('\n');
}

// ─── Normalização do que chega do browser ───────────────────────────────────

function normalizeContext(raw) {
  const c = raw ?? {};
  const entries = Array.isArray(c.console) ? c.console.slice(-MAX_ENTRIES) : [];
  const net = Array.isArray(c.network) ? c.network.slice(-MAX_ENTRIES) : [];
  const extraRaw = c.extra && typeof c.extra === 'object' ? c.extra : {};

  return {
    url: clamp(c.url, 500),
    path: clamp(c.path, 200) || '/',
    screen: clamp(c.screen, 120),
    referrer: clamp(c.referrer, 500),
    viewport: clamp(c.viewport, 40),
    userAgent: clamp(c.userAgent, 300),
    language: clamp(c.language, 20),
    timezone: clamp(c.timezone, 60),
    at: clamp(c.at, 40) || new Date().toISOString(),
    console: entries.map((e) => ({
      level: e?.level === 'warn' ? 'warn' : 'error',
      message: clamp(e?.message, MAX_ENTRY),
      at: clamp(e?.at, 40),
    })),
    network: net.map((n) => ({
      method: clamp(n?.method, 10) || 'GET',
      url: clamp(n?.url, 300),
      status: Number.isFinite(n?.status) ? Number(n?.status) : 0,
      at: clamp(n?.at, 40),
    })),
    extra: Object.fromEntries(
      Object.entries(extraRaw)
        .slice(0, MAX_EXTRA_KEYS)
        .map(([k, v]) => [clamp(k, 40), clamp(String(v ?? ''), 200)])
    ),
  };
}

/** POST <base>. Lança SubmissionError (400/503) ou LinearError (502). */
async function submitIssue(config, raw) {
  if (!config.enabled || !config.apiKey || !config.teamId) {
    throw new SubmissionError('Integração com o Linear não está configurada.', 503);
  }

  const input = raw ?? {};
  const title = clamp(input.title, MAX_TITLE);
  const body = clamp(input.body, MAX_BODY);

  if (title.length < 4) throw new SubmissionError('Dê um título com pelo menos 4 caracteres.');
  if (!body) throw new SubmissionError('Descreva o que aconteceu.');

  const reporter = config.requireContact
    ? {
        name: clamp(input.reporter?.name, 80),
        email: clamp(input.reporter?.email, 120),
      }
    : input.reporter
      ? { name: clamp(input.reporter.name, 80), email: clamp(input.reporter.email, 120) }
      : null;

  if (config.requireContact && !reporter?.email) {
    throw new SubmissionError('Informe um e-mail para podermos responder.');
  }
  if (reporter?.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reporter.email)) {
    throw new SubmissionError('E-mail inválido.');
  }

  const meta = await teamMeta(config.apiKey, config.teamId);
  const context = normalizeContext(input.context);

  const moduleName = pickFromGroup(meta, config.moduleGroup, input.module);
  const typeName = pickFromGroup(meta, config.typeGroup, input.type);

  const labelIds = resolveLabels(meta, [
    ...config.alwaysLabels,
    ...(moduleName ? [moduleName] : []),
    ...(typeName ? [typeName] : []),
  ]);

  const priority =
    input.priority != null && PRIORITIES.some((p) => p.value === input.priority)
      ? input.priority
      : null;

  const stateId = config.initialStateName
    ? meta.states.find((s) => s.name.toLowerCase() === config.initialStateName.toLowerCase())?.id ?? null
    : null;

  const submission = { title, body, module: moduleName, type: typeName, priority, reporter, context };

  const issue = await linear.createIssue(config.apiKey, {
    teamId: config.teamId,
    title: composeTitle(config, title, moduleName),
    description: composeDescription(config, submission),
    priority,
    labelIds,
    stateId,
  });

  return { ok: true, identifier: issue.identifier, url: issue.url };
}

/**
 * Aceita só o que o grupo de labels realmente contém: o browser manda um nome, e um POST
 * forjado poderia escolher qualquer label do workspace, inclusive as internas.
 */
function pickFromGroup(meta, group, wanted) {
  if (!group || typeof wanted !== 'string' || !wanted) return null;
  const found = meta.labels.find((l) => !l.isGroup && l.parentName === group && l.name === wanted);
  return found?.name ?? null;
}

function resolveLabels(meta, names) {
  const ids = [];
  for (const name of names) {
    const label = meta.labels.find((l) => !l.isGroup && l.name === name);
    if (label && !ids.includes(label.id)) ids.push(label.id);
  }
  return ids;
}

module.exports = {
  DEFAULT_TITLE_TEMPLATE,
  SubmissionError,
  LinearError,
  clearReporterCache,
  buildMeta,
  composeTitle,
  composeDescription,
  submitIssue,
};
