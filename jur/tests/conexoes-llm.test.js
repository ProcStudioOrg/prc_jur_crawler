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
