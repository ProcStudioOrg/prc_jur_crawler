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

test("kaizen: um por aplicacao, criado no dir de dados se nao vier, fechado no fechar", () => {
  const base = {
    cofreKey: Buffer.alloc(32, 8).toString("base64"),
    procstudio: {}, publicUrl: "http://127.0.0.1", frontendUrl: "https://proc.example", clientId: "jur",
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-app-"));
  const app = criarAplicacao({ ...base, dir });
  assert.ok(fs.existsSync(path.join(dir, "kaizen.db")));
  assert.equal(typeof app.kaizen.registrarErro, "function");
  assert.equal(app.ocupado(), false);
  app.fechar();
  let fechou = 0;
  const proprio = { registrarErro: async () => {}, registrarConcluido: () => ({ avisos: [] }), fechar: () => { fechou++; } };
  const app2 = criarAplicacao({ ...base, dir: fs.mkdtempSync(path.join(os.tmpdir(), "jur-app-")), kaizen: proprio });
  assert.equal(app2.kaizen, proprio);
  app2.fechar();
  assert.equal(fechou, 1);
});

test("boot: recibo pendente gravado num jur.db de conta e reenviado pelo varredor", async () => {
  const { criarEscopos } = require("../servidor/escopo");
  const db = require("../servidor/db");
  const { dono, hash } = require("../servidor/sessoes-web");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-boot-"));
  const principal = { issuer: "https://rails.example", userId: "u9", teamId: "t9", expiresAt: Date.now() + 60000 };
  const owner = JSON.stringify(dono(principal));
  const home = path.join(dir, "usuarios", hash(owner));
  fs.mkdirSync(home, { recursive: true });
  const con = db.abrir(path.join(home, "jur.db"));
  const uso = { requestId: "c1:t1:1", modelId: "glm", inputTokens: 5, outputTokens: 7 };
  const recibo = { principal: { issuer: principal.issuer, userId: "u9", teamId: "t9" }, uso };
  // em_voo = 1: processo anterior morreu no meio da tentativa; o boot precisa recuperar.
  con.prepare("INSERT INTO cobranca_pendente (request_id, payload, tentativas, criado_em, em_voo) VALUES (?,?,0,?,1)")
    .run(uso.requestId, JSON.stringify(recibo), Date.now());
  // conta sem pendencia: nao pode gerar chamada.
  const home2 = path.join(dir, "usuarios", "vazia");
  fs.mkdirSync(home2, { recursive: true });
  db.abrir(path.join(home2, "jur.db")).close();
  con.close();
  const chamadas = [];
  const procstudio = {
    registrarUso: async (p, u) => {
      chamadas.push({ p, u });
      return { cobradoBrl: 0.01, saldoBrl: 1, podeOperar: true, duplicado: false };
    },
  };
  const escopos = criarEscopos({ dir });
  try {
    const r = await escopos.varrerPendencias({ procstudio });
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0].u, uso);
    assert.equal(chamadas[0].p.userId, "u9");
    assert.deepEqual(r, { contas: 1, enviados: 1, descartados: 0, adiados: 0 });
    const c2 = db.abrir(path.join(home, "jur.db"));
    assert.equal(c2.prepare("SELECT COUNT(*) AS n FROM cobranca_pendente").get().n, 0);
    c2.close();
  } finally {
    escopos.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("boot: criarAplicacao com conexao gerenciada drena pendencias sem esperar login", async () => {
  const db = require("../servidor/db");
  const { dono, hash } = require("../servidor/sessoes-web");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-boot2-"));
  const principal = { issuer: "https://rails.example", userId: "u8", teamId: "t8" };
  const home = path.join(dir, "usuarios", hash(JSON.stringify(dono(principal))));
  fs.mkdirSync(home, { recursive: true });
  const con = db.abrir(path.join(home, "jur.db"));
  const uso = { requestId: "c2:t2:1", modelId: "glm" };
  con.prepare("INSERT INTO cobranca_pendente (request_id, payload, tentativas, criado_em, em_voo) VALUES (?,?,0,?,0)")
    .run(uso.requestId, JSON.stringify({ principal, uso }), Date.now());
  con.close();
  const antes = process.env.PROCSTUDIO_LLM_API_KEY;
  process.env.PROCSTUDIO_LLM_API_KEY = "sk-operador";
  const chamadas = [];
  let app;
  try {
    app = criarAplicacao({
      dir, cofreKey: Buffer.alloc(32, 8).toString("base64"),
      procstudio: { registrarUso: async (p, u) => { chamadas.push(u.requestId); return { cobradoBrl: 0, saldoBrl: 1, podeOperar: true }; } },
      publicUrl: "http://127.0.0.1", frontendUrl: "https://proc.example", clientId: "jur",
    });
    await app.varredura;
    assert.deepEqual(chamadas, ["c2:t2:1"]);
  } finally {
    app?.fechar();
    if (antes === undefined) delete process.env.PROCSTUDIO_LLM_API_KEY; else process.env.PROCSTUDIO_LLM_API_KEY = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
