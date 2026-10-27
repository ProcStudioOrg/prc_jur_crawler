// jur/servidor/kaizen/payload.js
// Corpos dos webhooks `jur-diagnostico` e `user-issues` do FFD. A outbox descarta qualquer 4xx
// sem repetir, então cada campo sai aqui já dentro do que o FFD valida (lib/jur-diagnostico/
// contracts.ts e lib/user-issues/contracts.ts): válido por construção, nunca "deixa o FFD cortar".
// Módulo puro: sem I/O, sem relógio próprio além do fallback de `em`.
const { createHash } = require('node:crypto');
const { sanitizar } = require('./assinatura');
const { ALIASES } = require('./normalizar');

const SERVICO = 'jurcrawler';
// Espelho de ORIGENS_JUR do FFD (lib/jur-diagnostico/contracts.ts).
const ORIGENS = new Set(['busca', 'sentinela', 'cobranca']);
const CHAVES_FILTRO = ['query', 'dataInicio', 'dataFim', 'dataPubInicio', 'dataPubFim', 'relator', 'juizados', 'numero'];
const MAX_FILTROS = 4 * 1024;
const MAX_LISTA = 8 * 1024;
const MAX_CONTEXTO = 8 * 1024;
// O FFD aceita até 4 MB de gzip por arquivo; base64 cresce 4/3.
const MAX_GZIP_B64 = Math.floor((4 * 1024 * 1024 * 4) / 3);

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const cortar = (s, max) => (typeof s === 'string' && s.length > max ? s.slice(0, max) : s);

function hashUsuario(id, salt) {
  if (id === null || id === undefined || id === '' || !salt) return null;
  return createHash('sha256').update(String(id) + String(salt)).digest('hex');
}

// Caractere de controle e surrogate solto viram `\uXXXX` no JSON (6 bytes cada): sem isso,
// 100 caracteres "cabem" no corte mas estouram o teto em bytes do FFD.
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const limparTexto = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(SURROGATE_SOLTO, '\uFFFD');

function valorFiltro(v, max) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return cortar(limparTexto(sanitizar(s)), max);
}

/** As oito chaves sempre presentes; o FFD guarda até 4 KB: o valor mais longo encolhe até caber. */
function filtrosDe(params) {
  const p = params && typeof params === 'object' ? params : {};
  const f = {};
  for (const k of CHAVES_FILTRO) f[k] = valorFiltro(p[k], k === 'query' ? 1000 : 100);
  while (bytes(f) > MAX_FILTROS) {
    const k = CHAVES_FILTRO.reduce((a, b) => (bytes(f[b]) > bytes(f[a]) ? b : a));
    f[k] = typeof f[k] === 'string' && f[k].length > 1 ? f[k].slice(0, Math.floor(f[k].length / 2)) : null;
  }
  return f;
}

// --- normalização dos campos que o FFD valida por regex -------------------------------------

function tribunalValido(t) {
  const s = String(t ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
  return s.length >= 2 ? s : 'desconhecido';
}

function classeValida(c) {
  const s = String(c ?? '');
  return /^[a-z_]+(:[A-Za-z0-9_]+)?$/.test(s) && s.length <= 80 ? s : 'desconhecido';
}

function passoValido(p) {
  const s = String(p ?? '').trim().toLowerCase().replace(/[^a-z0-9_:./#-]/g, '_').slice(0, 80);
  return s || 'desconhecido';
}

function versaoValida(v) {
  const s = String(v ?? '').trim();
  return /^[0-9A-Za-z.+-]{1,32}$/.test(s) ? s : '0.0.0';
}

function revisaoValida(r) {
  const s = String(r ?? '').trim();
  return /^[0-9A-Za-z._-]{1,40}$/.test(s) ? s : null;
}

// O FFD recusa data inválida ou mais de 1 dia à frente (relógio errado): nesses casos vai "agora".
function emIso(em) {
  const d = em instanceof Date ? em : new Date(em ?? NaN);
  const agora = Date.now();
  return Number.isNaN(d.getTime()) || d.getTime() > agora + 3600e3 ? new Date(agora).toISOString() : d.toISOString();
}

function urlSemQuery(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // `;jsessionid=...` (parâmetro de matriz) carrega sessão no próprio caminho.
    return (url.origin + url.pathname.replace(/;[^/]*/g, '')).slice(0, 2000);
  } catch { return null; }
}

const erroEnviado = (e) => (e === null || e === undefined || e === '' ? null : sanitizar(e).slice(0, 2000) || null);
const jobIdValido = (id) => (id === null || id === undefined ? null : (String(id).length <= 64 ? String(id) : null));
const hashValido = (h) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null);
const rotaValida = (r) => (r ? String(r).slice(0, 40) : null);

/** Lista JSON com teto em bytes: tira itens do fim até caber (o começo é o que importa). */
function listaLimitada(lista, max, maxItens) {
  const out = (Array.isArray(lista) ? lista : []).slice(0, maxItens);
  while (out.length && bytes(out) > max) out.pop();
  return out;
}

// Exemplo traz valores crus do tribunal (relator, órgão, datas): corta cada texto.
function exemploEnviado(e) {
  const o = {};
  for (const [k, v] of Object.entries(e && typeof e === 'object' ? e : {})) {
    o[k] = typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v))
      ? v
      : cortar(limparTexto(sanitizar(typeof v === 'string' ? v : JSON.stringify(v) ?? '')), 300);
  }
  return o;
}

const conferenciaEnviada = (lista) => listaLimitada((Array.isArray(lista) ? lista : []).map((it) => ({
  filtro: it?.filtro ?? null,
  veredito: it?.veredito ?? null,
  detalhe: cortar(limparTexto(sanitizar(it?.detalhe ?? '')), 300),
  comCampo: Number(it?.comCampo) || 0,
  violam: Number(it?.violam) || 0,
})), MAX_LISTA, 50);

function base({ versao, revisao, origem, tipo, em }) {
  return {
    servico: SERVICO,
    versao: versaoValida(versao),
    revisao: revisaoValida(revisao),
    origem: ORIGENS.has(origem) ? origem : 'busca',
    tipo,
    em: emIso(em),
  };
}

const b64Ok = (v) => (typeof v === 'string' && v.length > 0 && v.length <= MAX_GZIP_B64 ? v : null);

/**
 * `tela_png_gzip_b64` só vem se quem leu a captura já confirmou a assinatura PNG
 * (o FFD recusa o item inteiro se não for PNG). Sem captura, as cinco chaves não vão.
 */
function payloadFalha({
  versao, revisao, origem, tribunal, classe, passo, assinatura, erro, rota, params, jobId, usuarioHash, em,
  captura, conferencia, exemplos,
}) {
  const classeOk = classeValida(classe);
  const corpo = {
    ...base({ versao, revisao, origem, tipo: 'falha', em }),
    tribunal: tribunalValido(tribunal),
    classe: classeOk,
    passo: passoValido(passo),
    assinatura: String(assinatura || 'desconhecido').slice(0, 200).trim() || 'desconhecido',
    erro: erroEnviado(erro),
    rota: rotaValida(rota),
    filtros: filtrosDe(params),
  };
  if (classeOk.startsWith('filtro_ignorado:')) {
    corpo.conferencia = conferenciaEnviada(conferencia);
    corpo.exemplos = listaLimitada((Array.isArray(exemplos) ? exemplos : []).map(exemploEnviado), MAX_LISTA, 5);
  }
  corpo.job_id = jobIdValido(jobId);
  corpo.usuario_hash = hashValido(usuarioHash);
  if (captura) {
    const meta = captura.meta || {};
    const html = b64Ok(captura.html_gzip_b64);
    corpo.tela_png_gzip_b64 = b64Ok(captura.tela_png_gzip_b64);
    corpo.html_gzip_b64 = html;
    corpo.html_sha256 = html && /^[0-9a-f]{64}$/.test(captura.html_sha256 || '') ? captura.html_sha256 : null;
    corpo.url = meta.url ? urlSemQuery(meta.url) : null;
    corpo.titulo = meta.titulo ? cortar(sanitizar(meta.titulo), 500) : null;
  }
  return corpo;
}

function payloadResgate({ versao, revisao, origem, tribunal, tipo, assinatura, erro, rota, params, jobId, usuarioHash, em }) {
  const falhas = Array.isArray(erro) ? erro.filter(Boolean).map(String) : (erro ? [String(erro)] : []);
  return {
    ...base({ versao, revisao, origem, tipo: 'resgate', em }),
    tribunal: tribunalValido(tribunal),
    classe: tipo === 'captcha_manual' ? 'resgate:captcha_manual' : 'resgate:reserva',
    passo: 'resgate',
    assinatura: String(assinatura || 'desconhecido').slice(0, 200).trim() || 'desconhecido',
    erro: erroEnviado(falhas.join('; ')),
    rota: rotaValida(rota),
    filtros: filtrosDe(params),
    job_id: jobIdValido(jobId),
    usuario_hash: hashValido(usuarioHash),
  };
}

/**
 * Alerta ao operador da cobrança (Rails fora, preço ausente, provedor sem saldo). Não vem de
 * tribunal: o FFD exige os campos de falha, então vão `tribunal: 'procstudio'`, `passo: 'cobranca'`
 * e a assinatura `cobranca|<classe>`; `status` e `suprimidos` seguem como detalhe.
 */
function payloadCobranca({ versao, revisao, em, classe, erro, status, suprimidos }) {
  const classeOk = classeValida(classe);
  return {
    ...base({ versao, revisao, origem: 'cobranca', tipo: 'falha', em }),
    tribunal: 'procstudio',
    classe: classeOk,
    passo: 'cobranca',
    assinatura: `cobranca|${classeOk}`,
    erro: erroEnviado(erro),
    rota: null,
    filtros: {},
    job_id: null,
    usuario_hash: null,
    status: Number.isFinite(status) ? status : null,
    suprimidos: contador(suprimidos),
  };
}

const contador = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
};

function payloadResumo({ versao, revisao, em, resumo }) {
  const r = resumo || {};
  return {
    ...base({ versao, revisao, origem: 'sentinela', tipo: 'resumo', em }),
    tribunal: null,
    classe: 'resumo',
    passo: null,
    assinatura: 'sentinela|resumo',
    erro: null,
    rota: null,
    filtros: {},
    job_id: null,
    usuario_hash: null,
    resumo: { rodados: contador(r.rodados), ok: contador(r.ok), falhas: contador(r.falhas), nao_verificaveis: contador(r.nao_verificaveis) },
  };
}

// --- jur-processos (banco de processos) --------------------------------------------------------

const MAX_ALVOS = 50; // uma página de resultado da sentinela tem 10-20; o FFD aceita 200
const MIN_DIGITOS_CNJ = 15; // o FFD decide a forma CNJ; aqui só se evita mandar lixo óbvio
const digitosDe = (v) => String(v).split('/')[0].replace(/\D/g, '');

/**
 * Números de processo de uma busca que deu certo, para o FFD enfileirar como alvos de captura.
 * Só identificadores públicos de julgado (número, data de julgamento) saem daqui: nem texto do
 * acórdão, nem usuário. Resultado sem número com forma de CNJ (TCs, CARF) fica de fora.
 */
function payloadAlvos({ versao, revisao, origem, tribunal, em, resultados, capacidade, params }) {
  const vistos = new Set();
  const numeros = [];
  for (const r of Array.isArray(resultados) ? resultados : []) {
    if (!r || typeof r !== 'object') continue;
    for (const k of ALIASES.numeroProcesso) {
      const v = r[k];
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const d = digitosDe(v);
      if (d.length < MIN_DIGITOS_CNJ || d.length > 20 || vistos.has(d)) continue;
      vistos.add(d);
      const item = { numero: cortar(limparTexto(String(v)), 40) };
      if (capacidade) item.capacidade = cortar(String(capacidade), 40);
      const q = params && typeof params.query === 'string' ? params.query : null;
      if (q) item.query = cortar(limparTexto(sanitizar(q)), 200);
      const dj = ALIASES.dataJulgamento.map((a) => r[a]).find((x) => typeof x === 'string' && x);
      if (dj) item.dataJulgamento = cortar(limparTexto(dj), 40);
      numeros.push(item);
      break; // um número por resultado: o primeiro alias preenchido vence
    }
    if (numeros.length >= MAX_ALVOS) break;
  }
  return {
    acao: 'alvos',
    servico: SERVICO,
    versao: versaoValida(versao),
    revisao: revisaoValida(revisao),
    origem: origem === 'busca' ? 'busca' : 'sentinela',
    tribunal: tribunalValido(tribunal),
    em: emIso(em),
    numeros,
  };
}

// --- user-issues ------------------------------------------------------------------------------

function textoObrigatorio(v, max, padrao) {
  const s = String(v ?? '').trim();
  return (s || padrao).slice(0, max);
}

function textoOpcional(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() ? s.slice(0, max) : null;
}

function linearValido(l) {
  if (!l || typeof l !== 'object') return null;
  if (typeof l.identifier !== 'string' || !/^[A-Z][A-Z0-9]*-\d+$/.test(l.identifier)) return null;
  if (typeof l.url !== 'string' || l.url.length > 500) return null;
  try { if (new URL(l.url).protocol !== 'https:') return null; } catch { return null; }
  return { identifier: l.identifier, url: l.url };
}

// Contexto acima de 8 KB: corta cada valor; se ainda não couber, vai só o aviso.
// Contexto vai ao FFD e ao card: cada valor passa por `sanitizar`. Acima de 8 KB corta cada
// valor; se ainda não couber, vai só o aviso.
function contextoValido(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return {};
  const limpo = {};
  for (const [k, v] of Object.entries(c)) {
    limpo[limparTexto(k).slice(0, 200)] = typeof v === 'number' || typeof v === 'boolean' || v === null
      ? (typeof v === 'number' && !Number.isFinite(v) ? null : v)
      : limparTexto(sanitizar(typeof v === 'string' ? v : JSON.stringify(v)));
  }
  if (bytes(limpo) <= MAX_CONTEXTO) return limpo;
  const curto = {};
  for (const [k, v] of Object.entries(limpo)) curto[cortar(k, 100)] = cortar(v, 300);
  return bytes(curto) <= MAX_CONTEXTO ? curto : { aviso: 'contexto acima de 8 KB, omitido' };
}

/** Idempotente: aceita também um corpo já montado (autor_email/autor_nome), para reenviar normalizando. */
function payloadRelato(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const { titulo, descricao, equipe, rota, versao, linear, contexto, em } = d;
  const autorEmail = d.autorEmail !== undefined ? d.autorEmail : d.autor_email;
  const autorNome = d.autorNome !== undefined ? d.autorNome : d.autor_nome;
  const email = textoOpcional(autorEmail, 200);
  return {
    servico: SERVICO,
    titulo: textoObrigatorio(titulo, 200, 'Relato sem título'),
    descricao: textoObrigatorio(descricao, 2000, '(sem descrição)'),
    autor_email: email && email.includes('@') ? email : null,
    autor_nome: textoOpcional(autorNome, 200),
    equipe: textoOpcional(equipe, 200),
    rota: textoOpcional(rota, 500),
    versao: textoOpcional(versao, 64),
    linear: linearValido(linear),
    contexto: contextoValido(contexto),
    em: emIso(em),
  };
}

module.exports = {
  hashUsuario, filtrosDe, payloadFalha, payloadResgate, payloadResumo, payloadCobranca, payloadRelato, payloadAlvos,
  tribunalValido, classeValida, passoValido, SERVICO,
};
