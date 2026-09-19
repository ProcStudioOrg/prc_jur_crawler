// Legacy chat/rendering regression fixtures use the low-level router with a fake
// LLM. SSO and credential persistence are exercised separately by provedores.test.
function gerarChaveBrowser(gerenciador) {
  return gerenciador.gerar("suite de browser").valor;
}
async function injetarChave(page, valor) {
  let selected = { conexaoId: "fixture", modelo: "claude-opus-5" };
  const conexao = {
    id: "fixture",
    provider: "anthropic",
    name: "Fixture de renderização",
    model: selected.modelo,
    maskedKey: "••••test",
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const reply = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/api/v1/me")
      return reply({
        issuer: "fixture",
        userId: "fixture",
        teamId: "test",
        expiresAt: Date.now() + 600000,
      });
    if (p === "/api/v1/conexoes-llm") return reply({ conexoes: [conexao] });
    if (p === "/api/v1/preferencias") {
      if (route.request().method() === "PATCH")
        selected = route.request().postDataJSON();
      return reply({ ia: selected });
    }
    if (p === "/api/v1/conexoes-llm/fixture/modelos")
      return reply({
        modelos: [
          { id: "claude-opus-5", name: "Opus", tools: true },
          { id: "claude-haiku-4-5", name: "Haiku", tools: true },
        ],
      });
    return route.fallback({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${valor}`,
      },
    });
  });
}
module.exports = { gerarChaveBrowser, injetarChave };
