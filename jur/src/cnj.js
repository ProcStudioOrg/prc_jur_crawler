// src/cnj.js
// Utilidades genéricas para numeração única de processos (Resolução CNJ 65/2008).
// Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
// Usado por qualquer tribunal (TJPA, TJPR, TRFs, ...): validação de dígito
// verificador, normalização e decomposição do número.
//
// ATENÇÃO: tribunais que migraram acervos legados (ex.: TJPA/Libra) exibem
// números convertidos cujo DV NÃO fecha, mas que existem nas bases oficiais.
// Trate validar() === false como AVISO; a prova definitiva de existência é
// sempre a consulta na base do tribunal.

const JUSTICAS = {
  1: 'Supremo Tribunal Federal',
  2: 'Conselho Nacional de Justiça',
  3: 'Superior Tribunal de Justiça',
  4: 'Justiça Federal',
  5: 'Justiça do Trabalho',
  6: 'Justiça Eleitoral',
  7: 'Justiça Militar da União',
  8: 'Justiça Estadual',
  9: 'Justiça Militar Estadual',
};

/**
 * Normaliza um número CNJ: mantém só dígitos, completa com zeros à esquerda
 * até 20 e formata NNNNNNN-DD.AAAA.J.TR.OOOO.
 * @returns {string|null} null se não puder ser um número CNJ (>20 dígitos ou vazio)
 */
function normalizar(numero) {
  const digits = String(numero ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 20) return null;
  const n = digits.padStart(20, '0');
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16, 20)}`;
}

/**
 * Decompõe o número em seus campos.
 * @returns {Object|null} {numero, sequencial, dv, ano, justica, justicaNome, tribunal, origem}
 */
function decompor(numero) {
  const fmt = normalizar(numero);
  if (!fmt) return null;
  const m = fmt.match(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, sequencial, dv, ano, justica, tribunal, origem] = m;
  return {
    numero: fmt,
    sequencial,
    dv,
    ano,
    justica,
    justicaNome: JUSTICAS[Number(justica)] || 'desconhecida',
    tribunal,
    origem,
  };
}

/**
 * Valida o dígito verificador: DD === 98 - (N7+A4+J1+TR2+O4+"00" mod 97).
 * @returns {boolean}
 */
function validar(numero) {
  const d = decompor(numero);
  if (!d) return false;
  const resto = BigInt(`${d.sequencial}${d.ano}${d.justica}${d.tribunal}${d.origem}00`) % 97n;
  return Number(98n - resto) === Number(d.dv);
}

/**
 * Verifica se o número pertence a um segmento/tribunal (ex.: TJPA = J 8, TR 14;
 * TJPR = J 8, TR 16; TRF4 = J 4, TR 04).
 * @returns {boolean}
 */
function pertenceA(numero, justica, tribunal) {
  const d = decompor(numero);
  if (!d) return false;
  return Number(d.justica) === Number(justica) && Number(d.tribunal) === Number(tribunal);
}

module.exports = { normalizar, decompor, validar, pertenceA, JUSTICAS };
