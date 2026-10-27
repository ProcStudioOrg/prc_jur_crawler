const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { criarAplicacao } = require("../servidor/aplicacao");

const SALDO = {
  ativo: true,
  podeOperar: true,
  saldoCents: 1234,
  saldoBrl: 12.34,
  mensagem: "Saldo disponível.",
  topupPath: "/ai/creditos",
  modelo: { modelId: "glm-5.3-flash", nome: "GLM", entradaPor1MBrl: 1.5, saidaPor1MBrl: 6 },
};

async function subir({ chave, saldo, pendencia }) {
  const antes = process.env.PROCSTUDIO_LLM_API_KEY;
  const antesRotulo = process.env.PROCSTUDIO_LLM_ROTULO;
  if (chave) process.env.PROCSTUDIO_LLM_API_KEY = chave;
  else delete process.env.PROCSTUDIO_LLM_API_KEY;
  process.env.PROCSTUDIO_LLM_ROTULO = "GLM Rotulo";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-saldo-"));
  const principal = { issuer: "https://rails.example", userId: "u1", teamId: "t1", expiresAt: Date.now() + 60000 };
  const chamadas = [];
  const revogados = [];
  const procstudio = {
    exchange: async (code) => ({ token: code, principal }),
    introspect: async () => principal,
    revoke: async (token) => { revogados.push(token); },
    subject: async () => true,
    saldo: async (p) => {
      chamadas.push(p.userId);
      return saldo();
    },
    registrarUso: async () => ({}),
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
  const r = await fetch(base + "/auth/login", { redirect: "manual" });
  const loc = new URL(r.headers.get("location"));
  const c0 = r.headers.get("set-cookie").split(";")[0];
  const cb = await fetch(`${base}/auth/callback?code=u1&state=${loc.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: c0 } });
  const cookie = cb.headers.get("set-cookie").split(";")[0];
  const get = (u) => fetch(base + u, { headers: { cookie } });
  const postarChat = () => fetch(base + "/api/v1/chat", {
    method: "POST",
    headers: { cookie, origin: "http://127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({ conexaoId: "procstudio", mensagens: [{ role: "user", content: "oi" }] }),
  });
  return {
    get, postarChat, chamadas, revogados, dir,
    async fechar() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      app.fechar();
      fs.rmSync(dir, { recursive: true, force: true });
      if (antes === undefined) delete process.env.PROCSTUDIO_LLM_API_KEY; else process.env.PROCSTUDIO_LLM_API_KEY = antes;
      if (antesRotulo === undefined) delete process.env.PROCSTUDIO_LLM_ROTULO; else process.env.PROCSTUDIO_LLM_ROTULO = antesRotulo;
    },
  };
}

test("sem conexao gerenciada: disponivel false e o Rails nao e chamado", async () => {
  const a = await subir({ chave: "", saldo: () => SALDO });
  try {
    const r = await a.get("/api/v1/saldo");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { disponivel: false });
    assert.equal(a.chamadas.length, 0);
  } finally { await a.fechar(); }
});

test("com conexao gerenciada: saldo, topupUrl e modelo; cache de 30 s e ?forcar=1", async () => {
  const a = await subir({ chave: "sk-operador", saldo: () => SALDO });
  try {
    const r = await a.get("/api/v1/saldo");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      disponivel: true,
      saldoBrl: 12.34,
      podeOperar: true,
      mensagem: "Saldo disponível.",
      topupUrl: "https://proc.example/ai/creditos",
      modelo: { rotulo: "GLM Rotulo", entradaPor1MBrl: 1.5, saidaPor1MBrl: 6 },
    });
    await a.get("/api/v1/saldo");
    assert.equal(a.chamadas.length, 1, "segunda leitura usa o cache");
    await a.get("/api/v1/saldo?forcar=1");
    assert.equal(a.chamadas.length, 2, "forcar ignora o cache");
  } finally { await a.fechar(); }
});

test("Rails falha: 503 com disponivel true e erro", async () => {
  const a = await subir({ chave: "sk-operador", saldo: () => { throw Object.assign(new Error("ProcStudio indisponível. Tente novamente."), { status: 503 }); } });
  try {
    const r = await a.get("/api/v1/saldo");
    assert.equal(r.status, 503);
    const c = await r.json();
    assert.equal(c.disponivel, true);
    assert.match(c.erro, /saldo de IA/);
  } finally { await a.fechar(); }
});

const MSG_SESSAO = "Sua conta do ProcStudio está inativa ou a sessão expirou; entre de novo.";

async function confereSessaoEncerrada(a, r) {
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /^Session/);
  assert.match(r.headers.get("set-cookie"), /^jur_session=; .*Max-Age=0/);
  assert.deepEqual(await r.json(), { erro: MSG_SESSAO, tipo: "sessao_invalida" });
  assert.equal(a.revogados.length, 1, "o logout revoga a sessão no ProcStudio, como o POST /auth/logout");
  const me = await a.get("/api/v1/me");
  assert.equal(me.status, 401, "a sessão some: o próximo pedido já não autentica");
  await me.text();
}

test("conta inativa no Rails (active:false): 401 sessao_invalida e a sessão do JurCrawler acaba", async () => {
  const a = await subir({ chave: "sk-operador", saldo: () => ({ ativo: false }) });
  try {
    await confereSessaoEncerrada(a, await a.get("/api/v1/saldo"));
  } finally { await a.fechar(); }
});

test("chat com conta inativa: a pré-checagem responde 401 sessao_invalida e encerra a sessão", async () => {
  const a = await subir({ chave: "sk-operador", saldo: () => ({ ativo: false }) });
  try {
    await confereSessaoEncerrada(a, await a.postarChat());
  } finally { await a.fechar(); }
});

test("conta que fica inativa depois de um saldo ok: o ok em cache não segura a sessão", async () => {
  let ativo = true;
  const a = await subir({ chave: "sk-operador", saldo: () => (ativo ? SALDO : { ativo: false }) });
  try {
    const ok = await a.get("/api/v1/saldo");
    assert.equal(ok.status, 200);
    await ok.json();
    ativo = false;
    await confereSessaoEncerrada(a, await a.get("/api/v1/saldo?forcar=1"));
    assert.equal(a.chamadas.length, 2);
  } finally { await a.fechar(); }
});

test("Rails fora ou credencial de serviço recusada no saldo: 503, a sessão continua", async () => {
  for (const e of [
    Object.assign(new Error("ProcStudio indisponível. Tente novamente."), { status: 503 }),
    Object.assign(new Error("Credencial de serviço recusada."), { status: 401, code: "SERVICE_AUTH" }),
  ]) {
    const a = await subir({ chave: "sk-operador", saldo: () => { throw e; } });
    try {
      const r = await a.get("/api/v1/saldo");
      assert.equal(r.status, 503);
      assert.equal(r.headers.get("set-cookie"), null);
      assert.equal((await r.json()).disponivel, true);
      const chat = await a.postarChat();
      assert.equal(chat.status, 503);
      assert.equal((await chat.json()).tipo, "procstudio_indisponivel");
      const me = await a.get("/api/v1/me");
      assert.equal(me.status, 200, "queda do Rails não derruba a sessão");
      await me.json();
      assert.equal(a.revogados.length, 0);
    } finally { await a.fechar(); }
  }
});
