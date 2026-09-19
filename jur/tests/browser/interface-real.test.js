const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { fixture } = require("./sso-fixture");
test("cookies reais: login, CSRF e troca de usuário sem dados herdados", async () => {
  const f = await fixture();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(f.base);
    await page.locator("#login-procstudio").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() =>
        fetch("/api/v1/tribunais").then((r) => r.status),
      ),
      401,
    );
    await f.login(page, "alice");
    assert.ok(
      (await page.evaluate(() => window.jurApi.pedir("/api/v1/tribunais")))
        .tribunais.length > 0,
    );
    const c = await page.evaluate(() =>
      window.jurApi.pedir("/api/v1/conversas", { method: "POST", body: "{}" }),
    );
    await page.evaluate(() =>
      window.jurApi.pedir("/api/v1/conexoes-llm", {
        method: "POST",
        body: JSON.stringify({
          provider: "openrouter",
          name: "Alice privada",
          apiKey: "alice-private-key",
          model: "vendor/model",
        }),
      }),
    );
    assert.ok(
      !(await page.evaluate(() => document.cookie)).includes("jur_session"),
    );
    assert.equal(
      (
        await page.request.post(f.base + "/api/v1/conversas", { data: {} })
      ).status(),
      403,
      "POST sem Origin recusado",
    );
    await page.click("#sair-conta");
    await page.locator("#login-procstudio").waitFor({ state: "visible" });
    await f.login(page, "bob");
    const data = await page.evaluate(
      async (id) => ({
        connections: await window.jurApi.pedir("/api/v1/conexoes-llm"),
        conversations: await window.jurApi.pedir("/api/v1/conversas"),
        other: await fetch("/api/v1/conversas/" + id).then((r) => r.status),
      }),
      c.id,
    );
    assert.deepEqual(data.connections.conexoes, []);
    assert.deepEqual(data.conversations.conversas, []);
    assert.equal(data.other, 404);
    assert.ok(
      !(await page.locator("body").textContent()).includes("Alice privada"),
    );
  } finally {
    await browser.close();
    await f.close();
  }
});
