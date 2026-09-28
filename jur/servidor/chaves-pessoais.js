const { randomBytes, randomUUID } = require("node:crypto");
const { hash, dono } = require("./sessoes-web");
function criarChaves(con) {
  con.exec(
    `CREATE TABLE IF NOT EXISTS chave_pessoal(id TEXT PRIMARY KEY, dono TEXT NOT NULL, nome TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, prefixo TEXT NOT NULL, criadoEm INTEGER NOT NULL, ultimoUsoEm INTEGER, revogadoEm INTEGER)`,
  );
  const select =
    "SELECT id,nome,prefixo,criadoEm,ultimoUsoEm,revogadoEm FROM chave_pessoal";
  return {
    verificar(valor) {
      if (typeof valor !== "string" || valor.length > 256) return null;
      const row = con
        .prepare(
          "SELECT * FROM chave_pessoal WHERE hash=? AND revogadoEm IS NULL",
        )
        .get(hash(valor));
      if (!row) return null;
      con
        .prepare("UPDATE chave_pessoal SET ultimoUsoEm=? WHERE id=?")
        .run(Date.now(), row.id);
      const [issuer, userId, teamId] = JSON.parse(row.dono);
      return { issuer, userId, teamId };
    },
    para(principal) {
      const owner = JSON.stringify(dono(principal));
      return {
        gerar(nome) {
          const id = randomUUID(),
            valor = "jur_" + randomBytes(32).toString("base64url"),
            prefixo = valor.slice(0, 10),
            criadoEm = Date.now();
          con
            .prepare(
              "INSERT INTO chave_pessoal(id,dono,nome,hash,prefixo,criadoEm) VALUES (?,?,?,?,?,?)",
            )
            .run(
              id,
              owner,
              String(nome || "Integração").slice(0, 80),
              hash(valor),
              prefixo,
              criadoEm,
            );
          return { id, nome, prefixo, valor, criadoEm };
        },
        listar() {
          return con
            .prepare(select + " WHERE dono=? ORDER BY criadoEm DESC")
            .all(owner);
        },
        revogar(id) {
          return (
            con
              .prepare(
                "UPDATE chave_pessoal SET revogadoEm=? WHERE id=? AND dono=? AND revogadoEm IS NULL",
              )
              .run(Date.now(), id, owner).changes > 0
          );
        },
      };
    },
  };
}
module.exports = { criarChaves };
