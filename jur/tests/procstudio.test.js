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
