const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { fixture } = require("./sso-fixture");
test("credenciais: validação, segredo não retornado, edição e remoção", async () => {
  const f = await fixture();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await f.login(page);
    await page.click("#abrir-config");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#painel-config [role="status"]').textContent
          .length > 0,
    );
    assert.equal(
      await page.locator("#painel-config input[type=password]").count(),
      1,
    );
    await page
      .getByLabel("Chave de API", { exact: true })
      .fill("test-private-credential");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page
      .getByRole("button", { name: "Modelo de teste", exact: false })
      .click();
    await page.getByRole("button", { name: "Usar este modelo" }).click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    assert.equal(
      await page.getByLabel("Chave de API", { exact: true }).inputValue(),
      "",
    );
    await page.getByRole("button", { name: "Salvar e continuar" }).click();
    await page.getByRole("button", { name: "Usar este modelo" }).click();
    const metadata = await page.evaluate(() =>
      window.jurApi.pedir("/api/v1/conexoes-llm"),
    );
    assert.equal(metadata.conexoes.length, 1);
    assert.ok(!JSON.stringify(metadata).includes("test-private-credential"));
    await page.getByRole("button", { name: "Remover", exact: true }).click();
    await page.getByLabel("Provedor", { exact: true }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.jurApi.pedir("/api/v1/conexoes-llm")))
        .conexoes.length,
      0,
    );
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByLabel("Chave de API", { exact: true })
      .fill("unsaved-secret");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#painel-config input").count(), 0);
  } finally {
    await browser.close();
    await f.close();
  }
});
