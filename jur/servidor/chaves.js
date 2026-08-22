const crypto = require('node:crypto');

const PREFIXO = 'jur_';
const BYTES = 32;

/** Hash de comparacao. Chave e segredo de alta entropia gerado por nos —
 *  sha256 basta e e deterministico, o que permite achar por indice unico. */
function hashDe(valor) {
  return crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
}

// SQLite reporta colisao de indice unico assim — sem .code padronizado do
// node:sqlite, so a mensagem crua do driver.
function ehColisaoDeHash(e) {
  return e && e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed.*\bhash\b/i.test(e.message || '');
}

// Guarda a conexao de cada gerenciador FORA do objeto que index.js repassa em
// `deps` — se ela fosse uma propriedade do gerenciador (ex.: `_paraTeste`),
// qualquer codigo que segurasse `deps.chaves` alcancaria o banco bruto. O
// WeakMap so e navegavel por quem tem a referencia do modulo (o teste).
const conexoesPorGerenciador = new WeakMap();

function _conexaoParaTeste(gerenciador) {
  return conexoesPorGerenciador.get(gerenciador);
}

function criarGerenciador(con) {
  function inserir(nome) {
    const id = crypto.randomUUID();
    const valor = PREFIXO + crypto.randomBytes(BYTES).toString('base64url');
    const prefixo = valor.slice(0, PREFIXO.length + 6);
    const criadoEm = Date.now();
    con.prepare(`INSERT INTO chave_conexao (id, nome, hash, prefixo, criado_em)
                 VALUES (?, ?, ?, ?, ?)`).run(id, nome, hashDe(valor), prefixo, criadoEm);
    return { id, nome, prefixo, valor, criadoEm };
  }

  function gerar(nome) {
    const nomeFinal = String(nome || 'sem nome');
    // Colisao de hash (dois valores de 256 bits aleatorios com o mesmo sha256) e
    // astronomicamente improvavel — isto existe so por higiene, para nao devolver
    // o 500 cru do SQLite no dia em que a moeda cair do lado errado. Uma segunda
    // tentativa com um valor novo basta; se colidir de novo tambem, alguma coisa
    // mais fundamental esta quebrada (RNG, por exemplo) e reportamos em portugues
    // em vez de propagar o erro interno do driver.
    try {
      return inserir(nomeFinal);
    } catch (e) {
      if (!ehColisaoDeHash(e)) throw e;
      try {
        return inserir(nomeFinal);
      } catch (e2) {
        throw new Error('nao foi possivel gerar uma chave de conexao unica — tente novamente');
      }
    }
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

  const gerenciador = { gerar, listar, verificar, revogar };
  conexoesPorGerenciador.set(gerenciador, con);
  return gerenciador;
}

module.exports = { criarGerenciador, PREFIXO, _conexaoParaTeste };
