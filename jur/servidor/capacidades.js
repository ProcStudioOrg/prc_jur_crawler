const catalogo = require('./catalogo');
const relator = require('./relator');
const juizados = require('./juizados');
const CURADO = require('../cobertura/capacidades.json');

/**
 * As sete funcionalidades que a ficha do tribunal mostra e que a ferramenta de busca
 * do chat cobre. Duas perguntas por funcionalidade, respondidas em lugares diferentes:
 *
 *   EXISTE?   derivado da CLI (flags) — tests/contrato-cli.test.js reprova divergencia.
 *   FUNCIONA? propagado do estado do tribunal no catalogo, com sobreposicao curada em
 *             cobertura/capacidades.json para o que quebrou numa funcionalidade so
 *             (ex.: TJAC, inteiro teor exige reCAPTCHA).
 *
 * Tudo que sai daqui pode ir para a TELA: nada de mencionar CLI, comando ou flag.
 */
const CHAVES = ['termo', 'periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'inteiroTeor', 'numero'];

const ROTULOS = {
  termo: 'Busca por termo',
  periodoJulgamento: 'Período de julgamento',
  periodoPublicacao: 'Período de publicação',
  magistrado: 'Magistrado',
  juizados: 'Juizados / Turmas Recursais',
  inteiroTeor: 'Inteiro teor',
  numero: 'Consulta por número',
};

// ---------- existencia, derivada da CLI ----------
// Sem -q: so o crps, que nao e comando de busca.
const SEM_TERMO = new Set(['crps']);
// Sem -di/-df.
const SEM_FILTRO_DATA = new Set(['tjma', 'tjrn', 'crps']);
// Com -dpi/-dpf (data de PUBLICACAO).
const COM_PUBLICACAO = new Set([
  'trf4', 'trf2', 'trf6', 'carf', 'tjpr', 'tjrj', 'tjms', 'tjac', 'tjam', 'tjal', 'tjba', 'tjpi', 'tjpa',
  'tjdft', 'tjmg', 'tjrs', 'tjma', 'tjsp', 'tjsc', 'stf', 'stj', 'tjmt', 'tjpb', 'tjap', 'tjro', 'tjrr',
  'tcers', 'tcesp', 'tcerj', 'tceba', 'tcepe', 'tcdf',
]);
// Sem -n.
const SEM_NUMERO = new Set(['tcu', 'tjsp', 'crps']);
// Sem --fetch-inteiro-teor.
const SEM_INTEIRO_TEOR = new Set(['trf1', 'trf3', 'trf5', 'tcu', 'tjma', 'tjrn', 'tjsp', 'crps']);

const NOTA_FORMA = {
  'nome-exato': 'Nome exato, como aparece na listagem do tribunal. Nome parcial devolve zero.',
  codigo: 'Pelo código do magistrado, não pelo nome.',
  trecho: '',
  nome: '',
};

function existencia(comando, chave) {
  switch (chave) {
    case 'termo': return { existe: !SEM_TERMO.has(comando), nota: '' };
    case 'periodoJulgamento': return { existe: !SEM_FILTRO_DATA.has(comando), nota: '' };
    case 'periodoPublicacao': return { existe: COM_PUBLICACAO.has(comando), nota: '' };
    case 'magistrado': {
      const r = relator.obter(comando);
      if (!r || !r.suportado) return { existe: false, nota: '' };
      return { existe: true, nota: NOTA_FORMA[r.forma] || '', forma: r.forma };
    }
    case 'juizados': {
      const j = juizados.obter(comando);
      return j && j.suportado ? { existe: true, nota: j.nota } : { existe: false, nota: j ? j.nota : '' };
    }
    case 'inteiroTeor': return { existe: !SEM_INTEIRO_TEOR.has(comando), nota: '' };
    case 'numero': return { existe: !SEM_NUMERO.has(comando), nota: '' };
    default: return { existe: false, nota: '' };
  }
}

function existe(comando, chave) {
  return existencia(comando, chave).existe;
}

function curado(comando) {
  const c = CURADO[comando];
  return c && typeof c === 'object' ? c : null;
}

function resumoPadrao(tribunal, funcionalidades) {
  if (tribunal.estado === 'sem-acesso' || tribunal.estado === 'exige-sessao') return 'Indisponível no momento.';
  if (tribunal.estado === 'instavel') return 'Busca com ressalva no momento.';
  const filtros = CHAVES.filter((k) => k !== 'termo' && k !== 'numero' && funcionalidades[k].estado !== 'nao-existe')
    .map((k) => ROTULOS[k].toLowerCase());
  return filtros.length ? `Busca funcionando. Filtros disponíveis: ${filtros.join(', ')}.` : 'Busca funcionando.';
}

/**
 * `disponivel` pode ser sobreposto porque a tentativa assistida (STJ com captcha manual)
 * torna um tribunal `sem-acesso` buscavel em tempo de execucao — a rota de tribunais
 * ja faz essa troca, e a ficha precisa acompanhar.
 */
function obter(comando, { disponivel } = {}) {
  const t = catalogo.obter(comando);
  if (!t) return null;
  const podeBuscar = disponivel === undefined ? t.disponivel : disponivel;
  const sobre = curado(comando);
  const funcionalidades = {};
  for (const chave of CHAVES) {
    const ex = existencia(comando, chave);
    let estado;
    let nota = ex.nota || '';
    if (!ex.existe) estado = 'nao-existe';
    else if (!podeBuscar) estado = 'nao-funciona';
    else if (chave === 'termo' && t.estado === 'instavel') estado = 'ressalva';
    else if (chave === 'magistrado' && (ex.forma === 'nome-exato' || ex.forma === 'codigo')) estado = 'ressalva';
    else estado = 'funciona';
    const s = sobre && sobre.funcionalidades && sobre.funcionalidades[chave];
    if (s && s.estado) { estado = s.estado; nota = s.nota || nota; }
    funcionalidades[chave] = { estado, nota };
  }
  return { resumo: (sobre && sobre.resumo) || resumoPadrao(t, funcionalidades), funcionalidades };
}

/**
 * Texto para o MODELO quando ele pede uma funcionalidade que o tribunal nao tem ou que
 * nao esta funcionando. null quando pode rodar. O invariante e o mesmo do relator: a
 * busca NAO roda sem o recorte, porque rodar sem ele devolve uma lista errada com cara
 * de certa.
 */
function recusar(comando, chave, nome) {
  const c = obter(comando);
  if (!c) return null;
  const f = c.funcionalidades[chave];
  if (f.estado === 'nao-existe') {
    if (chave === 'juizados') return juizados.explicarAusencia(comando, nome);
    return `O tribunal ${comando} (${nome}) NAO tem "${ROTULOS[chave]}" na busca.${f.nota ? ` ${f.nota}` : ''}\n`
      + 'A BUSCA NAO FOI FEITA: nao apresente uma busca sem esse recorte como se fosse com ele. '
      + 'Diga isso ao usuario e pergunte se ele quer buscar sem o recorte.';
  }
  if (f.estado === 'nao-funciona') {
    return `"${ROTULOS[chave]}" NAO esta funcionando em ${comando} (${nome}).${f.nota ? ` ${f.nota}` : ''}\n`
      + 'A BUSCA NAO FOI FEITA. Diga isso ao usuario; nao invente resultado.';
  }
  return null;
}

function resumoCompacto(comando) {
  const c = obter(comando);
  if (!c) return '';
  const partes = [];
  for (const chave of CHAVES) {
    if (chave === 'termo' || chave === 'numero') continue;
    const f = c.funcionalidades[chave];
    if (f.estado !== 'funciona' && f.estado !== 'ressalva') continue;
    const rotulo = { periodoJulgamento: 'data', periodoPublicacao: 'publicacao', magistrado: 'magistrado', juizados: 'juizados', inteiroTeor: 'inteiro teor' }[chave];
    partes.push(f.estado === 'ressalva' && f.nota ? `${rotulo} (${f.nota.split('.')[0].toLowerCase()})` : rotulo);
  }
  return partes.length ? `filtros: ${partes.join(', ')}` : 'sem filtros alem do termo';
}

module.exports = {
  CHAVES, ROTULOS, obter, existe, recusar, resumoCompacto, curado,
  SEM_FILTRO_DATA, COM_PUBLICACAO, SEM_NUMERO, SEM_INTEIRO_TEOR,
};
