const crypto = require('node:crypto');

const PREFIXO = 'jur_';
const BYTES = 32;

/** Hash de comparacao. Chave e segredo de alta entropia gerado por nos —
 *  sha256 basta e e deterministico, o que permite achar por indice unico. */
function hashDe(valor) {
  return crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
}

function criarGerenciador(con) {
  function gerar(nome) {
    const id = crypto.randomUUID();
    const valor = PREFIXO + crypto.randomBytes(BYTES).toString('base64url');
    const prefixo = valor.slice(0, PREFIXO.length + 6);
    const criadoEm = Date.now();
    con.prepare(`INSERT INTO chave_conexao (id, nome, hash, prefixo, criado_em)
                 VALUES (?, ?, ?, ?, ?)`).run(id, String(nome || 'sem nome'), hashDe(valor), prefixo, criadoEm);
    return { id, nome: String(nome || 'sem nome'), prefixo, valor, criadoEm };
  }

  function listar() {
    return con.prepare('SELECT id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em FROM chave_conexao ORDER BY criado_em DESC')
      .all()
      .map((l) => ({
        id: l.id, nome: l.nome, prefixo: l.prefixo,
        criadoEm: l.criado_em, ultimoUsoEm: l.ultimo_uso_em, revogadoEm: l.revogado_em,
      }));
  }

  function verificar(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    const linha = con.prepare('SELECT id, nome, revogado_em FROM chave_conexao WHERE hash = ?').get(hashDe(valor));
    if (!linha || linha.revogado_em) return null;
    con.prepare('UPDATE chave_conexao SET ultimo_uso_em = ? WHERE id = ?').run(Date.now(), linha.id);
    return { id: linha.id, nome: linha.nome };
  }

  function revogar(id) {
    const r = con.prepare('UPDATE chave_conexao SET revogado_em = ? WHERE id = ? AND revogado_em IS NULL')
      .run(Date.now(), id);
    return r.changes > 0;
  }

  return { gerar, listar, verificar, revogar, _paraTeste: () => con };
}

module.exports = { criarGerenciador, PREFIXO };
