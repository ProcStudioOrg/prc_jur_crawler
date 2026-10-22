const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { criarCofre } = require("../servidor/cofre");
const { criarConexoes } = require("../servidor/conexoes-llm");
test("CRUD nunca devolve chave, exige nova chave ao trocar provedor e cifra conteúdo", () => {
  const con = new DatabaseSync(":memory:");
  const repo = criarConexoes({
    con,
    owner: "alice",
    cofre: criarCofre(Buffer.alloc(32, 3).toString("base64")),
  });
  const created = repo.salvar({
    provider: "openrouter",
    apiKey: "fixture-secret",
    model: "vendor/model",
  });
  assert.ok(created.id);
  assert.ok(!JSON.stringify(repo.listar()).includes("fixture-secret"));
  assert.ok(
    !JSON.stringify(con.prepare("SELECT * FROM conexao_llm").all()).includes(
      "fixture-secret",
    ),
  );
  assert.equal(repo.obterSegredo(created.id).apiKey, "fixture-secret");
  assert.throws(
    () => repo.salvar({ provider: "openai", model: "x" }, created.id),
    /nova chave/,
  );
  repo.salvar({ model: "vendor/new" }, created.id);
  assert.equal(repo.obterSegredo(created.id).model, "vendor/new");
  assert.equal(repo.apagar(created.id), true);
  assert.equal(repo.obterSegredo(created.id), null);
  const short = repo.salvar({ provider: "custom", endpoint: "https://example.com/v1", apiKey: "abcd" });
  assert.equal(short.maskedKey, "••••");
  assert.equal(repo.obterSegredo(short.id).apiKey, "abcd");
  con.close();
});

const gerenciada = {
  apiKey: "k-operador-secreta",
  endpoint: "https://openrouter.ai/api/v1",
  modelo: "z-ai/glm-5.3-flash",
  modeloCatalogo: "glm-5.3-flash",
  upstream: "z-ai",
  rotulo: "GLM-5.3 Flash",
  extras: { usage: { include: true } },
};
function repoGerenciado(transport) {
  const con = new DatabaseSync(":memory:");
  return criarConexoes({
    con,
    owner: "alice",
    cofre: criarCofre(Buffer.alloc(32, 3).toString("base64")),
    gerenciada,
    transport,
  });
}
test("conexão procstudio aparece primeiro, sem chave, e é a preferência padrão", () => {
  const repo = repoGerenciado();
  repo.salvar({ provider: "openai", apiKey: "x-user", model: "m" });
  const [p, outra] = repo.listar();
  assert.deepEqual(p, {
    id: "procstudio",
    provider: "procstudio",
    name: "ProcStudio",
    model: "glm-5.3-flash",
    endpoint: null,
    maskedKey: null,
    fixa: true,
    rotulo: "GLM-5.3 Flash",
  });
  assert.equal(outra.provider, "openai");
  assert.deepEqual(repo.obter("procstudio"), p);
  assert.ok(!JSON.stringify(repo.listar()).includes("k-operador-secreta"));
  assert.deepEqual(repo.preferencias(), { conexaoId: "procstudio", modelo: "glm-5.3-flash" });
  assert.equal(repo.ehProcstudio("procstudio"), true);
  assert.equal(repo.ehProcstudio("outra"), false);
  assert.equal(repo.modeloEnviado(), "z-ai/glm-5.3-flash");
});
test("procstudio é somente leitura e só aceita o modelo do catálogo", async () => {
  const repo = repoGerenciado();
  assert.throws(() => repo.salvar({ model: "x" }, "procstudio"), { status: 400, message: "Conexão gerenciada pelo ProcStudio." });
  assert.throws(() => repo.apagar("procstudio"), { status: 400, message: "Conexão gerenciada pelo ProcStudio." });
  assert.throws(() => repo.selecionar("procstudio", "outro"), /Modelo inválido/);
  assert.deepEqual(repo.selecionar("procstudio", "glm-5.3-flash"), { conexaoId: "procstudio", modelo: "glm-5.3-flash" });
  assert.deepEqual(await repo.modelos("procstudio"), [{ id: "glm-5.3-flash", name: "GLM-5.3 Flash", tools: true }]);
  assert.ok(repo.cliente("procstudio"));
});
test("sem gerenciada nada muda", () => {
  const repo = criarConexoes({
    con: new DatabaseSync(":memory:"),
    owner: "alice",
    cofre: criarCofre(Buffer.alloc(32, 3).toString("base64")),
  });
  assert.deepEqual(repo.listar(), []);
  assert.equal(repo.preferencias(), null);
  assert.equal(repo.ehProcstudio("procstudio"), false);
  assert.throws(() => repo.selecionar("procstudio", "x"), /não encontrada/);
});
