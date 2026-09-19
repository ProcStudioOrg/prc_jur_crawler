const { randomBytes, createHash } = require("node:crypto");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const aleatorio = () => randomBytes(32).toString("base64url");
const dono = (p) => [p.issuer, p.userId, p.teamId];
function criarSessoes({ con, cofre, procstudio, agora = Date.now }) {
  con.exec(`CREATE TABLE IF NOT EXISTS tentativa_login (hash TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, verifier TEXT NOT NULL, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessao_web (hash TEXT PRIMARY KEY, principal TEXT NOT NULL, segredo TEXT NOT NULL, exp INTEGER NOT NULL);`);
  function iniciar() {
    con.prepare("DELETE FROM tentativa_login WHERE exp <= ?").run(agora());
    con.prepare("DELETE FROM sessao_web WHERE exp <= ?").run(agora());
    const state = aleatorio();
    const cookie = aleatorio();
    const verifier = aleatorio();
    con
      .prepare("INSERT INTO tentativa_login VALUES (?,?,?,?)")
      .run(
        hash(state),
        hash(cookie),
        cofre.cifrar(verifier, ["attempt", hash(state)]),
        agora() + 300000,
      );
    return {
      state,
      cookie,
      challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
  }
  async function concluir({ state, cookie, code, redirectUri }) {
    if (
      ![state, cookie, code].every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 256,
      )
    )
      return null;
    const attempt = con
      .prepare(
        "DELETE FROM tentativa_login WHERE hash=? AND cookie_hash=? AND exp>? RETURNING *",
      )
      .get(hash(state), hash(cookie), agora());
    if (!attempt) return null;
    const result = await procstudio.exchange(
      code,
      cofre.decifrar(attempt.verifier, ["attempt", hash(state)]),
      redirectUri,
    );
    if (!result || result.principal.expiresAt <= agora()) return null;
    const token = aleatorio();
    const id = hash(token);
    const p = result.principal;
    con
      .prepare("INSERT INTO sessao_web VALUES (?,?,?,?)")
      .run(
        id,
        JSON.stringify(p),
        cofre.cifrar(result.token, ["session", id, ...dono(p)]),
        p.expiresAt,
      );
    return { token, principal: p };
  }
  function obter(token) {
    if (typeof token !== "string" || token.length > 256) return null;
    return con
      .prepare("SELECT * FROM sessao_web WHERE hash=? AND exp>?")
      .get(hash(token), agora());
  }
  async function autenticar(token) {
    const row = obter(token);
    if (!row) return null;
    const saved = JSON.parse(row.principal);
    const p = await procstudio.introspect(
      cofre.decifrar(row.segredo, ["session", row.hash, ...dono(saved)]),
    );
    if (
      !p ||
      JSON.stringify(dono(p)) !== JSON.stringify(dono(saved)) ||
      p.expiresAt <= agora()
    ) {
      con.prepare("DELETE FROM sessao_web WHERE hash=?").run(row.hash);
      return null;
    }
    return { ...p, expiresAt: Math.min(p.expiresAt, row.exp) };
  }
  async function sair(token) {
    const row = obter(token);
    if (!row) return;
    con.prepare("DELETE FROM sessao_web WHERE hash=?").run(row.hash);
    const p = JSON.parse(row.principal);
    await procstudio.revoke(
      cofre.decifrar(row.segredo, ["session", row.hash, ...dono(p)]),
    );
  }
  return { iniciar, concluir, autenticar, sair };
}
module.exports = { criarSessoes, dono, hash };
