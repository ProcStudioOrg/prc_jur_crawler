const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCofre } = require("../servidor/cofre");
const key = Buffer.alloc(32, 7).toString("base64");
test("cifra sem persistir segredo, nonce único e vínculo ao dono", () => {
  const c = criarCofre(key);
  const a = c.cifrar("segredo-fixture", [
    "issuer",
    "alice",
    "team",
    "provider",
    "1",
  ]);
  const b = c.cifrar("segredo-fixture", [
    "issuer",
    "alice",
    "team",
    "provider",
    "1",
  ]);
  assert.notEqual(a, b);
  assert.ok(!a.includes("segredo-fixture"));
  assert.equal(
    c.decifrar(a, ["issuer", "alice", "team", "provider", "1"]),
    "segredo-fixture",
  );
  assert.throws(
    () => c.decifrar(a, ["issuer", "bob", "team", "provider", "1"]),
    /Credencial/,
  );
  const adulterado = JSON.parse(a);
  adulterado.tag = Buffer.alloc(16).toString("base64");
  assert.throws(
    () =>
      c.decifrar(JSON.stringify(adulterado), [
        "issuer",
        "alice",
        "team",
        "provider",
        "1",
      ]),
    /Credencial/,
  );
  assert.throws(
    () => criarCofre(Buffer.alloc(32, 8).toString("base64")).decifrar(a, []),
    /Credencial/,
  );
});
test("configuração inválida falha fechada", () => {
  for (const k of [undefined, "", "abc", Buffer.alloc(31).toString("base64")])
    assert.throws(() => criarCofre(k));
});
