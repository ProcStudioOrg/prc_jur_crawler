const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { criarAplicacao } = require("../servidor/aplicacao");
test("SSO HTTP e recursos isolados: cookies, CSRF, API keys e conversas", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-app-"));
  const principals = new Map();
  const procstudio = {
    exchange: async (code) => {
      const principal = {
        issuer: "https://rails.example",
        userId: code,
        teamId: "team",
        expiresAt: Date.now() + 60000,
      };
      principals.set(code, principal);
      return { token: code, principal };
    },
    introspect: async (t) => principals.get(t) || null,
    revoke: async (t) => principals.delete(t),
    subject: async () => true,
  };
  const app = criarAplicacao({
    dir,
    cofreKey: Buffer.alloc(32, 8).toString("base64"),
    procstudio,
    publicUrl: "http://127.0.0.1",
    frontendUrl: "https://proc.example",
    clientId: "jur",
    executarFn: async () => ({ ok: true, total: 0, resultados: [] }),
  });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(user) {
    const r = await fetch(base + "/auth/login", { redirect: "manual" });
    const location = new URL(r.headers.get("location"));
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const cb = await fetch(
      base +
        `/auth/callback?code=${user}&state=${location.searchParams.get("state")}`,
      { redirect: "manual", headers: { cookie } },
    );
    assert.equal(cb.status, 303);
    return cb.headers.get("set-cookie").split(";")[0];
  }
  const call = (cookie, url, method = "GET", body) =>
    fetch(base + url, {
      method,
      headers: {
        cookie,
        origin: "http://127.0.0.1",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await fetch(base + "/api/v1/conversas")).status, 401);
    const a = await login("alice");
    const b = await login("bob");
    assert.equal((await (await call(a, "/api/v1/me")).json()).userId, "alice");
    const cr = await call(a, "/api/v1/conversas", "POST", {});
    assert.equal(cr.status, 201);
    const conversation = await cr.json();
    assert.equal(
      (await call(b, `/api/v1/conversas/${conversation.id}`)).status,
      404,
    );
    assert.deepEqual(
      (await (await call(b, "/api/v1/conversas")).json()).conversas,
      [],
    );
    const key = await (
      await call(a, "/api/v1/chaves", "POST", { nome: "MCP pessoal" })
    ).json();
    assert.ok(key.valor.startsWith("jur_"));
    assert.equal(
      (await (await call(b, "/api/v1/chaves")).json()).chaves.length,
      0,
    );
    assert.equal(
      (await call(b, `/api/v1/chaves/${key.id}`, "DELETE")).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + `/api/v1/conversas/${conversation.id}`, {
          headers: { authorization: `Bearer ${key.valor}` },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/v1/conversas", {
          method: "POST",
          headers: { cookie: a, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/v1/conversas", {
          method: "POST",
          headers: {
            cookie: a,
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    await call(a, "/auth/logout", "POST", {});
    assert.equal((await call(a, "/api/v1/me")).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
