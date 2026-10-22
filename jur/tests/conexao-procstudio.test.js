const { test } = require("node:test");
const assert = require("node:assert/strict");
const { doAmbiente } = require("../servidor/conexao-procstudio");

test("sem chave a conexão gerenciada não existe", () => {
  assert.equal(doAmbiente({}), null);
  assert.equal(doAmbiente({ PROCSTUDIO_LLM_API_KEY: "  " }), null);
});

test("com chave usa os padrões do OpenRouter e fixa o provedor de origem", () => {
  const g = doAmbiente({ PROCSTUDIO_LLM_API_KEY: "k-operador" });
  assert.equal(g.apiKey, "k-operador");
  assert.equal(g.endpoint, "https://openrouter.ai/api/v1");
  assert.equal(g.modelo, "z-ai/glm-5.3-flash");
  assert.equal(g.modeloCatalogo, "glm-5.3-flash");
  assert.equal(g.upstream, "z-ai");
  assert.equal(g.rotulo, "GLM-5.3 Flash");
  assert.deepEqual(g.extras, {
    usage: { include: true },
    provider: { order: ["z-ai"], allow_fallbacks: false },
  });
});

test("endpoint direto do Z.ai não recebe extras do OpenRouter", () => {
  const g = doAmbiente({
    PROCSTUDIO_LLM_API_KEY: "k",
    PROCSTUDIO_LLM_ENDPOINT: "https://api.z.ai/api/paas/v4",
    PROCSTUDIO_LLM_MODELO: "glm-5.3-flash",
  });
  assert.equal(g.endpoint, "https://api.z.ai/api/paas/v4");
  assert.deepEqual(g.extras, {});
});

test("upstream vazio dispensa o provider", () => {
  const g = doAmbiente({ PROCSTUDIO_LLM_API_KEY: "k", PROCSTUDIO_LLM_UPSTREAM: "" });
  assert.deepEqual(g.extras, {});
});
