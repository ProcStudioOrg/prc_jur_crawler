const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { criarAplicacao } = require("../../servidor/aplicacao");
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jur-browser-sso-"));
  const principals = new Map();
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const procstudio = {
    exchange: async (code) => {
      const principal = {
        issuer: "https://rails.test",
        userId: code,
        teamId: "team",
        expiresAt: Date.now() + 600000,
      };
      principals.set(code, principal);
      return { token: code, principal };
    },
    introspect: async (token) => principals.get(token) || null,
    revoke: async (token) => principals.delete(token),
    subject: async () => true,
  };
  app = criarAplicacao({
    dir,
    cofreKey: Buffer.alloc(32, 5).toString("base64"),
    procstudio,
    publicUrl: base,
    frontendUrl: "https://proc.test",
    clientId: "jur",
    llmTransport: async () =>
      Response.json({
        data: [
          {
            id: "vendor/model",
            name: "Modelo de teste",
            supported_parameters: ["tools"],
          },
        ],
      }),
    executarFn: async () => ({ ok: true, total: 0, resultados: [] }),
  });
  return {
    base,
    dir,
    principals,
    async login(page, user = "alice") {
      const r = await page.request.get(base + "/auth/login", {
        maxRedirects: 0,
      });
      const state = new URL(r.headers().location).searchParams.get("state");
      await page.goto(base + `/auth/callback?code=${user}&state=${state}`);
      await page.locator("#login-procstudio").waitFor({ state: "hidden" });
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      app.fechar();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
module.exports = { fixture };
