const { json, lerCorpo } = require("../http");
const { validarDestino } = require("../destinos-llm");
function registrar(roteador, deps) {
  const repo = deps.conexoes;
  if (!repo) return;
  roteador.rota("GET", "/api/v1/preferencias", (_req, res) =>
    json(res, 200, { ia: repo.preferencias() }),
  );
  roteador.rota("PATCH", "/api/v1/preferencias", async (req, res) => {
    try {
      const b = await lerCorpo(req);
      return json(res, 200, { ia: repo.selecionar(b.conexaoId, b.modelo) });
    } catch (e) {
      return json(res, 400, { erro: e.message });
    }
  });
  roteador.rota("GET", "/api/v1/conexoes-llm", (_req, res) =>
    json(res, 200, { conexoes: repo.listar() }),
  );
  async function salvar(req, res) {
    try {
      const input = await lerCorpo(req);
      const previous = req.params?.id && repo.obter(req.params.id);
      if ((input.provider ?? previous?.provider) === "custom")
        await validarDestino(input.endpoint ?? previous?.endpoint);
      const r = repo.salvar(input, req.params?.id);
      return json(res, req.method === "POST" ? 201 : 200, r);
    } catch (e) {
      return json(res, e.status === 404 ? 404 : 400, { erro: e.message });
    }
  }
  roteador.rota("POST", "/api/v1/conexoes-llm", salvar);
  roteador.rota("PATCH", "/api/v1/conexoes-llm/:id", salvar);
  roteador.rota("DELETE", "/api/v1/conexoes-llm/:id", (req, res) =>
    repo.apagar(req.params.id)
      ? json(res, 200, { ok: true })
      : json(res, 404, { erro: "Conexão não encontrada." }),
  );
  async function modelos(req, res) {
    if (!repo.obter(req.params.id))
      return json(res, 404, { erro: "Conexão não encontrada." });
    try {
      return json(res, 200, { modelos: await repo.modelos(req.params.id) });
    } catch (e) {
      return json(res, 422, { erro: e.message });
    }
  }
  roteador.rota("GET", "/api/v1/conexoes-llm/:id/modelos", modelos);
  roteador.rota("POST", "/api/v1/conexoes-llm/:id/validar", modelos);
}
module.exports = { registrar };
