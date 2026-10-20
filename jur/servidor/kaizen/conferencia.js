// Conferência pura dos filtros pedidos contra os resultados devolvidos. Um falso positivo aqui vira
// card falso no Linear, então toda dúvida resolve para 'nao_verificavel'. Módulo puro, sem I/O.
const { ALIASES, parseData, normalizarResultado } = require('./normalizar');
const relatorCap = require('../relator');

const FILTROS = ['periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'numero'];

const MIN_COM_CAMPO = 3; // abaixo disso a amostra não prova nada (numero: 1)
const DIA = 24 * 60 * 60 * 1000;
const MAX_EXEMPLOS = 5;
// Títulos e cargos que variam entre o filtro digitado e o que o tribunal exibe.
const TOKENS_TITULO = new Set(['des', 'desa', 'min', 'ministro', 'ministra', 'juiz', 'juiza', 'desembargador', 'desembargadora', 'convocado', 'convocada']);

function normalizarNome(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !TOKENS_TITULO.has(t))
    .join(' ');
}

// Valor cru do campo (para exemplos): o primeiro alias preenchido, sem normalizar.
function cru(r, campo) {
  for (const k of ALIASES[campo]) {
    const v = r?.[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return v;
  }
  return null;
}

function item(filtro, veredito, detalhe, comCampo = 0, violam = 0, exemplos = []) {
  return { filtro, veredito, detalhe, comCampo, violam, exemplos };
}

// Regra comum: precisa de amostra mínima; só "mais de 50%" violando conta como ignorado.
function decidir(filtro, comCampo, violadores, campos, minimo = MIN_COM_CAMPO) {
  const violam = violadores.length;
  if (comCampo < minimo) return item(filtro, 'nao_verificavel', `só ${comCampo} resultado(s) com o campo legível (mínimo ${minimo})`, comCampo, violam);
  const exemplos = violadores.slice(0, MAX_EXEMPLOS).map(({ bruto, norm }) => {
    const e = {};
    for (const c of campos) e[c] = cru(bruto, c);
    e.numeroProcesso = norm.numeroProcesso ?? cru(bruto, 'numeroProcesso');
    return e;
  });
  if (violam * 2 > comCampo) return item(filtro, 'ignorado', `${violam} de ${comCampo} violam o filtro`, comCampo, violam, exemplos);
  return item(filtro, 'ok', `${violam} de ${comCampo} fora do filtro`, comCampo, violam, exemplos);
}

function conferirPeriodo(filtro, campo, ini, fim, lista, tolerancia) {
  const ti = ini ? parseData(ini) : null;
  const tf = fim ? parseData(fim) : null;
  if ((ini && ti === null) || (fim && tf === null) || (ti === null && tf === null)) {
    return item(filtro, 'nao_verificavel', 'data do filtro em formato não reconhecido');
  }
  const comValor = lista.filter((x) => x.norm[campo] !== null);
  // Tolerância nas duas pontas: fuso e data de sessão vs. de registro (publicação atrasa mais).
  const tol = tolerancia * DIA;
  const violadores = comValor.filter(({ norm }) => (ti !== null && norm[campo] < ti - tol) || (tf !== null && norm[campo] > tf + tol));
  return decidir(filtro, comValor.length, violadores, [campo]);
}

// "Juiz 1 Turma Recursal Unificada", "Gabinete 3": o campo relator traz o órgão, não a pessoa.
const RE_ORGAO_NO_RELATOR = /turma|camara|gabinete|vice-?presid|presid|secao|plenario|colegiado|unificada|\d/;
const STOPWORDS_NOME = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const tokensNome = (s) => normalizarNome(s).split(' ').filter((t) => t && !STOPWORDS_NOME.has(t));
// Inicial ("p" de "P.") casa qualquer token que comece com ela.
const casaToken = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
const cobre = (menor, maior) => menor.length > 0 && menor.every((t) => maior.some((u) => casaToken(t, u)));

// 'ok' | 'viola' | 'sem'. Sobreposição parcial de nome fica 'sem': na dúvida, não conta.
function classificarRelator(pedidos, relator) {
  const nomes = relator.split(';').map((n) => n.trim()).filter(Boolean)
    .filter((n) => !RE_ORGAO_NO_RELATOR.test(n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()));
  if (!nomes.length) return 'sem';
  let parcial = false;
  for (const n of nomes) {
    const rt = tokensNome(n);
    for (const pt of pedidos) {
      if (cobre(pt, rt) || cobre(rt, pt)) return 'ok';
      if (pt.some((t) => t.length > 1 && rt.includes(t))) parcial = true;
    }
  }
  return parcial ? 'sem' : 'viola';
}

function conferirMagistrado(relator, lista, comando) {
  const cap = relatorCap.obter(comando);
  if (!cap || !cap.suportado) return item('magistrado', 'nao_verificavel', 'tribunal sem filtro de magistrado');
  if (cap.forma === 'codigo') return item('magistrado', 'nao_verificavel', 'filtro por código, não por nome');
  // O TRF2/TRF4 etc. aceitam vários nomes separados por vírgula.
  const pedidos = String(relator).split(',').map(tokensNome).filter((t) => t.length);
  if (!pedidos.length) return item('magistrado', 'nao_verificavel', 'nome do magistrado vazio');
  const cls = lista.filter((x) => x.norm.relator !== null).map((x) => ({ x, c: classificarRelator(pedidos, x.norm.relator) }))
    .filter(({ c }) => c !== 'sem');
  return decidir('magistrado', cls.length, cls.filter(({ c }) => c === 'viola').map(({ x }) => x), ['relator']);
}

// Só viola quando o órgão é positivamente um colegiado comum; gabinete/vazio/desconhecido = sem campo.
const RE_JUIZADO = /turmas? (recursa(l|is)|de recursos|de uniformiza|regional de uniformiza|nacional de uniformiza)|col[eé]gio recursal|c[aâ]mara recursal|juizado|\bjef\b|\btru\b|\btnu\b|\btr\b/i;
const RE_COMUM = /c[aâ]mara (c[ií]vel|criminal|de direito)|\bse[cç][aã]o\b|plen[aá]rio|corte especial|grupo de c[aâ]maras|\bturma\b(?!.*(recurs|uniformiza))/i;

function conferirJuizados(lista) {
  // 'ok' | 'viola' | null
  const e = (x) => {
    if (typeof x.norm.juizado === 'boolean') return x.norm.juizado ? 'ok' : 'viola';
    const o = x.norm.orgaoJulgador;
    if (o === null) return null;
    if (RE_JUIZADO.test(o)) return 'ok';
    return RE_COMUM.test(o) ? 'viola' : null;
  };
  const cls = lista.map((x) => ({ x, c: e(x) })).filter(({ c }) => c !== null);
  return decidir('juizados', cls.length, cls.filter(({ c }) => c === 'viola').map(({ x }) => x), ['juizado', 'orgaoJulgador']);
}

// Dígitos do trecho antes de '/', sem zeros à esquerda.
const digitos = (s) => String(s).split('/')[0].replace(/\D/g, '').replace(/^0+/, '');
const MIN_DIGITOS_CNJ = 15;

// Todos os valores de número que o resultado traz (vários aliases); só os com forma de CNJ.
function numerosDoResultado(bruto) {
  const out = [];
  for (const k of ALIASES.numeroProcesso) {
    const v = bruto?.[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const d = digitos(v);
    if (d.length >= MIN_DIGITOS_CNJ) out.push(d);
  }
  return out;
}

function conferirNumero(numero, lista) {
  const alvos = String(numero).split(/[,;\s]+/).map(digitos).filter(Boolean);
  if (!alvos.length) return item('numero', 'nao_verificavel', 'número do filtro sem dígitos');
  const comValor = lista.map((x) => ({ x, nums: numerosDoResultado(x.bruto) })).filter(({ nums }) => nums.length);
  const violadores = comValor.filter(({ nums }) => !nums.some((n) => alvos.includes(n))).map(({ x }) => x);
  return decidir('numero', comValor.length, violadores, [], 1);
}

function conferir(params, resultados, { comando } = {}) {
  const p = params || {};
  const lista = (Array.isArray(resultados) ? resultados : []).map((bruto) => ({ bruto, norm: normalizarResultado(bruto) }));
  const out = [];
  if (p.dataInicio || p.dataFim) out.push(conferirPeriodo('periodoJulgamento', 'dataJulgamento', p.dataInicio, p.dataFim, lista, 1));
  if (p.dataPubInicio || p.dataPubFim) out.push(conferirPeriodo('periodoPublicacao', 'dataPublicacao', p.dataPubInicio, p.dataPubFim, lista, 4));
  if (p.relator) out.push(conferirMagistrado(p.relator, lista, comando));
  if (p.juizados === true) out.push(conferirJuizados(lista));
  if (p.numero) out.push(conferirNumero(p.numero, lista));
  return out;
}

const COMPLEMENTO = {
  periodoJulgamento: 'o tribunal parece ter ignorado o filtro de data: {v} de {c} resultados fora do período',
  periodoPublicacao: 'o tribunal parece ter ignorado o filtro de data de publicação: {v} de {c} resultados fora do período',
  magistrado: 'o tribunal parece ter ignorado o filtro de magistrado: {v} de {c} resultados de outro relator',
  juizados: 'o tribunal parece ter ignorado o filtro de juizados: {v} de {c} resultados fora de turmas recursais e juizados',
  numero: 'o tribunal parece ter ignorado o filtro de número: {v} de {c} resultados com outro número',
};

function avisoDoFiltro(it) {
  return COMPLEMENTO[it.filtro].replace('{v}', it.violam).replace('{c}', it.comCampo);
}

module.exports = { FILTROS, conferir, normalizarNome, avisoDoFiltro };
