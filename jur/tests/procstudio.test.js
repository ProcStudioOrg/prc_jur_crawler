const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCliente } = require("../servidor/procstudio");
test("introspection validates principal and never accepts identity from caller", async () => {
  const calls = [];
  const client = criarCliente({
    url: "https://rails.example",
    issuer: "https://rails.example",
    clientId: "jur",
    secret: "fixture",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        active: true,
        principal: {
          issuer: "https://rails.example",
          userId: "1",
          teamId: "2",
          expiresAt: Date.now() + 60000,
        },
      });
    },
  });
  assert.equal((await client.introspect("delegated")).userId, "1");
  assert.equal(calls[0].init.headers.authorization, "Bearer fixture");
  assert.equal(JSON.parse(calls[0].init.body).session_token, "delegated");
});
test("rejects malformed, foreign, expired or inactive identity", async () => {
  for (const result of [
    { active: false },
    { active: true, principal: { userId: "1" } },
    {
      active: true,
      principal: {
        issuer: "evil",
        userId: "1",
        teamId: "2",
        expiresAt: Date.now() + 60000,
      },
    },
    {
      active: true,
      principal: {
        issuer: "https://rails.example",
        userId: "1",
        teamId: "2",
        expiresAt: 1,
      },
    },
  ]) {
    const client = criarCliente({
      url: "https://rails.example",
      issuer: "https://rails.example",
      clientId: "jur",
      secret: "fixture",
      fetchFn: async () => Response.json(result),
    });
    assert.equal(await client.introspect("delegated"), null);
  }
});
test("upstream failures are sanitized and fail closed", async () => {
  const client = criarCliente({
    url: "https://rails.example",
    issuer: "https://rails.example",
    clientId: "jur",
    secret: "fixture",
    fetchFn: async () => {
      throw new Error("secret-sent");
    },
  });
  await assert.rejects(
    client.introspect("delegated"),
    (e) => e.status === 503 && !e.message.includes("secret-sent"),
  );
});

const principalOk = {
  issuer: "https://rails.example",
  userId: "1",
  teamId: "2",
};
function clienteCom(resposta) {
  const calls = [];
  const client = criarCliente({
    url: "https://rails.example",
    issuer: "https://rails.example",
    clientId: "jur",
    secret: "fixture",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (resposta instanceof Error) throw resposta;
      return Response.json(resposta.body ?? {}, { status: resposta.status });
    },
  });
  return { client, calls };
}
const uso = {
  requestId: "c1:t1:r1",
  modelId: "glm-5.3-flash",
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 1,
  cacheWriteTokens: 2,
  provider: "openrouter",
  providerModel: "z-ai/glm-5.3-flash",
  providerCostUsd: 0.1,
  providerGenerationId: "gen-1",
  conversationId: "c1",
};
test("saldo converte snake_case e envia identidade do principal", async () => {
  const { client, calls } = clienteCom({
    status: 200,
    body: {
      active: true,
      can_operate: true,
      balance_cents: 1000,
      balance_brl: 10,
      negative_limit_cents: -50,
      message: null,
      topup_path: "/equipe?tab=billing",
      model: {
        model_id: "glm-5.3-flash",
        name: "GLM",
        input_per_1m_brl: 24,
        output_per_1m_brl: 96,
      },
    },
  });
  assert.deepEqual(await client.saldo(principalOk), {
    ativo: true,
    podeOperar: true,
    saldoCents: 1000,
    saldoBrl: 10,
    limiteNegativoCents: -50,
    mensagem: null,
    topupPath: "/equipe?tab=billing",
    modelo: {
      modelId: "glm-5.3-flash",
      nome: "GLM",
      entradaPor1MBrl: 24,
      saidaPor1MBrl: 96,
    },
  });
  assert.equal(
    String(calls[0].url),
    "https://rails.example/api/v1/service_access/ai_balance",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    user_id: "1",
    team_id: "2",
    client_id: "jur",
  });
  assert.equal(calls[0].init.headers.authorization, "Bearer fixture");
});
test("saldo: inativo, pricing_unavailable e falhas", async () => {
  assert.deepEqual(
    await clienteCom({ status: 200, body: { active: false } }).client.saldo(
      principalOk,
    ),
    { ativo: false },
  );
  await assert.rejects(
    clienteCom({
      status: 503,
      body: { error: "pricing_unavailable" },
    }).client.saldo(principalOk),
    (e) => e.status === 503 && e.code === "PRICING_UNAVAILABLE",
  );
  await assert.rejects(
    clienteCom({ status: 401 }).client.saldo(principalOk),
    (e) => e.status === 401 && e.code === "SERVICE_AUTH",
    "credencial de serviço recusada não se confunde com Rails fora",
  );
  for (const r of [
    { status: 503, body: { error: "outro" } },
    { status: 500 },
    new Error("secret-sent"),
  ])
    await assert.rejects(
      clienteCom(r).client.saldo(principalOk),
      (e) =>
        e.status === 503 &&
        !e.code &&
        e.message === "ProcStudio indisponível. Tente novamente.",
    );
});
test("registrarUso envia snake_case e devolve camelCase", async () => {
  const { client, calls } = clienteCom({
    status: 200,
    body: {
      billed_cents: 24,
      billed_brl: 0.24,
      balance_cents: 976,
      balance_brl: 9.76,
      can_operate: true,
      usage_log_id: 9,
      duplicate: false,
    },
  });
  assert.deepEqual(await client.registrarUso(principalOk, uso), {
    cobradoCents: 24,
    cobradoBrl: 0.24,
    saldoCents: 976,
    saldoBrl: 9.76,
    podeOperar: true,
    duplicado: false,
  });
  assert.equal(
    String(calls[0].url),
    "https://rails.example/api/v1/service_access/ai_usage",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    user_id: "1",
    team_id: "2",
    request_id: "c1:t1:r1",
    model_id: "glm-5.3-flash",
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 1,
    cache_write_tokens: 2,
    provider: "openrouter",
    provider_model: "z-ai/glm-5.3-flash",
    provider_cost_usd: 0.1,
    provider_generation_id: "gen-1",
    conversation_id: "c1",
    client_id: "jur",
  });
});
test("registrarUso mapeia erros do Rails para codes", async () => {
  const casos = [
    [{ status: 410, body: { error: "user_gone" } }, 410, "USER_GONE"],
    [{ status: 422, body: { error: "invalid_usage" } }, 422, "INVALID_USAGE"],
    [{ status: 401 }, 401, "SERVICE_AUTH"],
    [{ status: 403, body: { error: "demo_team" } }, 403, "TEAM_REJECTED"],
    [{ status: 404, body: { error: "team_not_found" } }, 404, "TEAM_REJECTED"],
    [
      { status: 503, body: { error: "pricing_unavailable" } },
      503,
      "PRICING_UNAVAILABLE",
    ],
  ];
  for (const [resp, status, code] of casos)
    await assert.rejects(
      clienteCom(resp).client.registrarUso(principalOk, uso),
      (e) =>
        e.status === status &&
        e.code === code &&
        !e.message.includes("demo_team"),
    );
  for (const r of [
    { status: 500 },
    { status: 503, body: { error: "x" } },
    new Error("boom"),
  ])
    await assert.rejects(
      clienteCom(r).client.registrarUso(principalOk, uso),
      (e) => e.status === 503 && !e.code,
    );
});
test("saldo e registrarUso recusam emissor diferente sem chamar o Rails", async () => {
  const { client, calls } = clienteCom({ status: 200, body: {} });
  const estranho = { ...principalOk, issuer: "evil" };
  await assert.rejects(
    client.saldo(estranho),
    (e) => e.status === 401 && e.code === "SERVICE_AUTH",
  );
  await assert.rejects(
    client.registrarUso(estranho, uso),
    (e) => e.status === 401 && e.code === "SERVICE_AUTH",
  );
  assert.equal(calls.length, 0);
});
