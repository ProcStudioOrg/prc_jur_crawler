const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { criarCofre } = require("../servidor/cofre");
const { criarSessoes } = require("../servidor/sessoes-web");
const principal = {
  issuer: "https://rails.example",
  userId: "alice",
  teamId: "team",
  expiresAt: Date.now() + 60000,
};
test("attempt is bound to browser and consumed once; delegated credentials encrypted", async () => {
  const con = new DatabaseSync(":memory:");
  const service = {
    exchange: async () => ({ token: "delegated-fixture", principal }),
    introspect: async () => principal,
    revoke: async () => {},
  };
  const repo = criarSessoes({
    con,
    cofre: criarCofre(Buffer.alloc(32, 9).toString("base64")),
    procstudio: service,
  });
  const attempt = repo.iniciar();
  assert.equal(
    await repo.concluir({
      state: attempt.state,
      cookie: "wrong",
      code: "code",
      redirectUri: "https://jur.example/auth/callback",
    }),
    null,
  );
  const session = await repo.concluir({
    state: attempt.state,
    cookie: attempt.cookie,
    code: "code",
    redirectUri: "https://jur.example/auth/callback",
  });
  assert.equal((await repo.autenticar(session.token)).userId, "alice");
  assert.equal(
    await repo.concluir({
      state: attempt.state,
      cookie: attempt.cookie,
      code: "code",
      redirectUri: "https://jur.example/auth/callback",
    }),
    null,
  );
  assert.ok(
    !JSON.stringify(con.prepare("SELECT * FROM sessao_web").all()).includes(
      "delegated-fixture",
    ),
  );
  await repo.sair(session.token);
  assert.equal(await repo.autenticar(session.token), null);
});
test("identity changes and expiration invalidate session", async () => {
  const con = new DatabaseSync(":memory:");
  let returned = principal;
  const repo = criarSessoes({
    con,
    cofre: criarCofre(Buffer.alloc(32, 9).toString("base64")),
    procstudio: {
      exchange: async () => ({ token: "delegated", principal }),
      introspect: async () => returned,
    },
  });
  const a = repo.iniciar();
  const s = await repo.concluir({
    state: a.state,
    cookie: a.cookie,
    code: "code",
    redirectUri: "https://jur.example/auth/callback",
  });
  returned = { ...principal, userId: "bob" };
  assert.equal(await repo.autenticar(s.token), null);
});
