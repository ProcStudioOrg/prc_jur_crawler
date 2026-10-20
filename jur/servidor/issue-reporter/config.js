// Cola do JurCrawler com o núcleo do issue-reporter (report.js): o que é do FFD fica lá, o que
// é deste app — time BRU, título, fatos do servidor e conversa na tela — fica aqui.
const { sanitizar } = require('../kaizen/assinatura');
const { filtrosDe } = require('../kaizen/payload');

const MAX_ERRO = 300;
const MAX_MENSAGENS = 12;
const MAX_HISTORICO = 6 * 1024;
const MAX_CONTEXTO = 8 * 1024;
const MAX_MENSAGEM = 1500;
const MAX_ARGS = 120;
const CHAVE_HISTORICO = 'Conversa (últimas mensagens)';

const bytes = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));

function ambiente(env) {
  try { return new URL(env.JUR_PUBLIC_URL).protocol === 'https:' ? 'production' : 'development'; } catch { return 'development'; }
}

/** ReporterConfig do JurCrawler. Sem LINEAR_API_KEY + LINEAR_TEAM_ID, `enabled:false` e o widget nem aparece. */
function configDoRelator({ env = process.env, principal, versao, revisao, serverContext = {}, appendix = '' }) {
  return {
    enabled: Boolean(env.LINEAR_API_KEY && env.LINEAR_TEAM_ID),
    apiKey: env.LINEAR_API_KEY || '',
    teamId: env.LINEAR_TEAM_ID || '',
    author: `usuário ${principal.userId}`,
    titleTemplate: '[jur] {title} ({author})',
    moduleGroup: null,
    typeGroup: null,
    alwaysLabels: [],
    initialStateName: 'Todo',
    app: { name: 'JurCrawler', version: versao, commit: revisao || null, env: ambiente(env) },
    requireContact: false,
    qaChecklist: true,
    moduleByPath: {},
    serverContext,
    appendix,
  };
}

/**
 * Fatos que o servidor afirma — o `extra` do browser é só alegação. O job só entra se for da
 * fila desta conta (quem chama já resolveu: job de outra conta chega aqui como null).
 */
function contextoDoServidor({ principal, versao, revisao, job, captura = false, assinatura = null, linkFalha = null }) {
  const ctx = {
    'ID do usuário': String(principal.userId),
    Equipe: String(principal.teamId),
    Versão: revisao ? `${versao} · ${revisao}` : String(versao),
  };
  if (!job) return ctx;
  ctx.Busca = String(job.id);
  ctx.Tribunal = String(job.comando);
  ctx.Filtros = JSON.stringify(filtrosDe(job.params));
  ctx.Rota = job.navegador || '—';
  ctx.Status = String(job.status);
  if (job.erro) ctx.Erro = sanitizar(job.erro).slice(0, MAX_ERRO);
  ctx['Captura de falha'] = captura ? `sim — ${linkFalha || assinatura || 'sem assinatura'}` : 'não';
  // O link do FFD carrega a assinatura na query, e o contexto do FFD tira query de URL.
  if (assinatura) ctx['Assinatura da falha'] = assinatura;
  return ctx;
}

// ─── conversa aberta na tela ────────────────────────────────────────────────

function resumoDeBloco(b) {
  if (!b || typeof b !== 'object') return '';
  if (b.type === 'text') return String(b.text || '');
  if (b.type === 'tool_use') {
    let args = '';
    try { args = JSON.stringify(b.input ?? {}); } catch { args = '{}'; }
    return `[ferramenta ${b.name}(${args.length > MAX_ARGS ? `${args.slice(0, MAX_ARGS)}…` : args})]`;
  }
  if (b.type === 'tool_result') {
    const c = typeof b.content === 'string' ? b.content
      : Array.isArray(b.content) ? b.content.map((x) => x?.text || '').join(' ') : '';
    return `[resultado: ${c.length > MAX_ARGS ? `${c.slice(0, MAX_ARGS)}…` : c}]`;
  }
  return '';
}

function linhaDeMensagem(m) {
  const texto = typeof m.conteudo === 'string'
    ? m.conteudo
    : Array.isArray(m.conteudo) ? m.conteudo.map(resumoDeBloco).filter(Boolean).join(' ') : '';
  const limpo = sanitizar(texto).replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  const curto = limpo.length > MAX_MENSAGEM ? `${limpo.slice(0, MAX_MENSAGEM)}…` : limpo;
  return `${m.papel === 'user' ? 'usuário' : 'assistente'}: ${curto}`;
}

/**
 * Últimas 12 mensagens, já sanitizadas, cabendo em 6 KB e — junto com `base` — no teto de 8 KB
 * do contexto do FFD (acima dele o FFD corta cada valor a 300 caracteres). Corta das mais antigas.
 */
function historicoDaConversa(mensagens, base = {}) {
  const linhas = (Array.isArray(mensagens) ? mensagens : []).map(linhaDeMensagem).filter(Boolean).slice(-MAX_MENSAGENS);
  const cabe = (ls) => {
    const texto = ls.join('\n');
    return bytes(texto) <= MAX_HISTORICO && bytes({ ...base, [CHAVE_HISTORICO]: texto }) <= MAX_CONTEXTO;
  };
  while (linhas.length && !cabe(linhas)) linhas.shift();
  return linhas;
}

/** Bloco recolhido do card no Linear; crase tripla do texto não pode fechar o bloco de código. */
function blocoDoCard(linhas) {
  if (!linhas.length) return '';
  const corpo = linhas.map((l) => l.replace(/`{3,}/g, "''")).join('\n');
  return [
    '<details>',
    `<summary>Conversa na tela (últimas ${linhas.length} mensagens)</summary>`,
    '',
    '```',
    corpo,
    '```',
    '</details>',
  ].join('\n');
}

module.exports = { configDoRelator, contextoDoServidor, historicoDaConversa, blocoDoCard, CHAVE_HISTORICO };
