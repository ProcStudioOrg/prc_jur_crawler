const path = require('node:path');

const FONTE = path.join(__dirname, '..', 'cobertura', 'tribunais.json');
const ESTADOS = ['ok', 'instavel', 'sem-acesso', 'exige-sessao'];
const DISPONIVEIS = new Set(['ok', 'instavel']);

function carregar() {
  // require cacheia: o catalogo e estatico durante a vida do processo.
  const bruto = require(FONTE);
  return bruto.tribunais
    .filter((t) => t.jurisprudencia && t.jurisprudencia.comando)
    .map((t) => {
      const j = t.jurisprudencia;
      const estado = ESTADOS.includes(j.status) ? j.status : 'sem-acesso';
      return {
        comando: j.comando,
        codigo: t.codigo,
        nome: t.nome,
        segmento: t.segmento || null,
        uf: Array.isArray(t.uf) ? t.uf : [],
        estado,
        acesso: j.acesso || null,
        nota: j.nota || '',
        disponivel: DISPONIVEIS.has(estado),
      };
    });
}

let cache = null;
function todos() {
  if (!cache) cache = carregar();
  return cache;
}

function listar(filtros = {}) {
  return todos().filter((t) => {
    if (filtros.segmento && t.segmento !== filtros.segmento) return false;
    if (filtros.estado && t.estado !== filtros.estado) return false;
    if (filtros.uf && !t.uf.includes(filtros.uf)) return false;
    return true;
  });
}

function obter(comando) {
  return todos().find((t) => t.comando === comando) || null;
}

module.exports = { listar, obter, ESTADOS };
