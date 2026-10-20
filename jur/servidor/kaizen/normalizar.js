// Cada crawler nomeia os campos do resultado do seu jeito (processo/numeroProcesso, dataDecisao/
// dataJulgamento...). A conferência de filtros do Kaizen precisa de uma forma só. Módulo puro, sem I/O.

// Ordem importa: o primeiro alias preenchido vence.
const ALIASES = {
  numeroProcesso: ['numeroProcesso', 'processo', 'processoNumero', 'numero'],
  dataJulgamento: ['dataJulgamento', 'dataDecisao', 'dataSessao'],
  dataPublicacao: ['dataPublicacao', 'dataPublicacaoDoe'],
  relator: ['relator', 'relatorAcordao', 'relatores'],
  orgaoJulgador: ['orgaoJulgador', 'orgaoJulgadorColegiado', 'colegiado'],
  juizado: ['juizado'],
};

// Chaves que casam /data|relator|processo|orgao|juizado/i mas são outro dado: de propósito não
// entram na conferência (comparar com o filtro geraria falso positivo).
const CAMPOS_IGNORADOS = new Set([
  'dataAutuacao', // quando o processo nasceu, não quando foi julgado
  'dataJuntada', // juntada do documento aos autos
  'dataDocumento', // data do documento do TC, não da decisão
  'dataPublicacaoHora', // só a hora da publicação (vem vazia); a data está em dataPublicacao
  'processoUrl', // link, não identificador
  'relatorioVotoLink', // link
  'processoSemMascara', // mesmo número sem máscara: redundante com o alias
  'numeroProcessoSemMascara', // idem
  'processoEletronico', // flag do tipo de autos
  'processoClassificacao', // classe do processo (TCs)
  'processosNoMesmoDocumento', // lista de outros processos do mesmo documento
  'idProcessoVisualizador', // id interno do visualizador
  'idProcessoDocumento', // id interno do documento
  'anoProcesso', // só o ano
  'tipoProcesso', // classe processual
  'cargoRelator', // cargo (Conselheiro, Substituto), não o nome
  'relatorDesignado', // relator designado para o acórdão: outra pessoa, não o relator do filtro
  'orgaoJulgadorOrigem', // órgão de origem (1º grau), não o que julgou
  'orgaoJulgadorOrigem1Grau', // idem
  'orgaoFiscalizado', // entidade fiscalizada pelo TC, não órgão julgador
]);

// Lê a data literal do texto (sem fuso): '2025-03-05T23:30:00-03:00' é dia 5, não 6 em UTC.
function parseData(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let d, m, a;
  let x = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (x) [, d, m, a] = x;
  else if ((x = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s))) [, a, m, d] = x;
  else return null;
  const t = Date.UTC(+a, +m - 1, +d);
  const dt = new Date(t);
  // Date.UTC rola 31/02 para março; conferir que o dia sobreviveu.
  return dt.getUTCFullYear() === +a && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d ? t : null;
}

function texto(v) {
  if (Array.isArray(v)) {
    const partes = v.map(texto).filter(Boolean);
    return partes.length ? partes.join('; ') : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function primeiro(r, chaves, conv) {
  for (const k of chaves) {
    const val = conv(r[k]);
    if (val !== null) return val;
  }
  return null;
}

function normalizarResultado(r) {
  const o = r && typeof r === 'object' ? r : {};
  return {
    numeroProcesso: primeiro(o, ALIASES.numeroProcesso, texto),
    dataJulgamento: primeiro(o, ALIASES.dataJulgamento, parseData),
    dataPublicacao: primeiro(o, ALIASES.dataPublicacao, parseData),
    relator: primeiro(o, ALIASES.relator, texto),
    orgaoJulgador: primeiro(o, ALIASES.orgaoJulgador, texto),
    juizado: primeiro(o, ALIASES.juizado, (v) => (typeof v === 'boolean' ? v : null)),
  };
}

module.exports = { ALIASES, CAMPOS_IGNORADOS, parseData, normalizarResultado };
