// Conferência pura dos filtros pedidos contra os resultados devolvidos. Um falso positivo aqui vira
// card falso no Linear, então toda dúvida resolve para 'nao_verificavel'. Módulo puro, sem I/O.
const { ALIASES, parseData, normalizarResultado } = require('./normalizar');
const relatorCap = require('../relator');

const FILTROS = ['periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'numero'];

const MIN_COM_CAMPO = 3; // abaixo disso a amostra não prova nada (numero: 1)
const DIA = 24 * 60 * 60 * 1000;
const MAX_EXEMPLOS = 5;
const RE_JUIZADO = /turma recursal|juizado|\bjef\b|\btr\b|turma regional de uniformiza/i;
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

function conferirPeriodo(filtro, campo, ini, fim, lista) {
  const ti = ini ? parseData(ini) : null;
  const tf = fim ? parseData(fim) : null;
  if ((ini && ti === null) || (fim && tf === null) || (ti === null && tf === null)) {
    return item(filtro, 'nao_verificavel', 'data do filtro em formato não reconhecido');
  }
  const comValor = lista.filter((x) => x.norm[campo] !== null);
  // Tolerância de 1 dia nas duas pontas: fuso e data de sessão vs. de registro.
  const violadores = comValor.filter(({ norm }) => (ti !== null && norm[campo] < ti - DIA) || (tf !== null && norm[campo] > tf + DIA));
  return decidir(filtro, comValor.length, violadores, [campo === 'dataJulgamento' ? 'dataJulgamento' : 'dataPublicacao']);
}

function conferirMagistrado(relator, lista, comando) {
  const cap = relatorCap.obter(comando);
  if (!cap || !cap.suportado) return item('magistrado', 'nao_verificavel', 'tribunal sem filtro de magistrado');
  if (cap.forma === 'codigo') return item('magistrado', 'nao_verificavel', 'filtro por código, não por nome');
  // O TRF2/TRF4 etc. aceitam vários nomes separados por vírgula.
  const pedidos = String(relator).split(',').map(normalizarNome).filter(Boolean);
  if (!pedidos.length) return item('magistrado', 'nao_verificavel', 'nome do magistrado vazio');
  const comValor = lista.filter((x) => x.norm.relator !== null);
  const casa = (rel) => rel.split(';').map(normalizarNome).filter(Boolean)
    .some((n) => pedidos.some((p) => n.includes(p) || p.includes(n)));
  const violadores = comValor.filter(({ norm }) => !casa(norm.relator));
  return decidir('magistrado', comValor.length, violadores, ['relator']);
}

function conferirJuizados(lista) {
  const e = (x) => (typeof x.norm.juizado === 'boolean' ? x.norm.juizado
    : x.norm.orgaoJulgador !== null ? RE_JUIZADO.test(x.norm.orgaoJulgador) : null);
  const comValor = lista.filter((x) => e(x) !== null);
  const violadores = comValor.filter((x) => e(x) === false);
  return decidir('juizados', comValor.length, violadores, ['juizado', 'orgaoJulgador']);
}

const digitos = (s) => String(s).split('/')[0].replace(/\D/g, '');

function conferirNumero(numero, lista) {
  const alvo = digitos(numero);
  if (!alvo) return item('numero', 'nao_verificavel', 'número do filtro sem dígitos');
  const comValor = lista.filter((x) => digitos(x.norm.numeroProcesso ?? '') !== '');
  const violadores = comValor.filter(({ norm }) => digitos(norm.numeroProcesso) !== alvo);
  return decidir('numero', comValor.length, violadores, [], 1);
}

function conferir(params, resultados, { comando } = {}) {
  const p = params || {};
  const lista = (Array.isArray(resultados) ? resultados : []).map((bruto) => ({ bruto, norm: normalizarResultado(bruto) }));
  const out = [];
  if (p.dataInicio || p.dataFim) out.push(conferirPeriodo('periodoJulgamento', 'dataJulgamento', p.dataInicio, p.dataFim, lista));
  if (p.dataPubInicio || p.dataPubFim) out.push(conferirPeriodo('periodoPublicacao', 'dataPublicacao', p.dataPubInicio, p.dataPubFim, lista));
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
