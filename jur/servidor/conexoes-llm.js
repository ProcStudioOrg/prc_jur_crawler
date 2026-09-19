const { randomUUID } = require("node:crypto");
const { ENDPOINTS, listarModelos, criarCliente } = require("./provedores");
function criarConexoes({ con, owner, cofre, transport }) {
  con.exec(
    `CREATE TABLE IF NOT EXISTS conexao_llm(id TEXT PRIMARY KEY,provider TEXT NOT NULL,nome TEXT NOT NULL,modelo TEXT NOT NULL,endpoint TEXT,segredo TEXT NOT NULL,mascara TEXT NOT NULL);`,
  );
  con.exec(
    `CREATE TABLE IF NOT EXISTS preferencia_llm (id INTEGER PRIMARY KEY CHECK(id=1), conexao TEXT NOT NULL, modelo TEXT NOT NULL);`,
  );
  const meta = (r) =>
    r
      ? {
          id: r.id,
          provider: r.provider,
          name: r.nome,
          model: r.modelo,
          endpoint: r.endpoint,
          maskedKey: r.mascara,
        }
      : null;
  const row = (id) =>
    con.prepare("SELECT * FROM conexao_llm WHERE id=?").get(id);
  function obterSegredo(id) {
    const r = row(id);
    return r
      ? {
          ...meta(r),
          apiKey: cofre.decifrar(r.segredo, [owner, "llm", r.provider, r.id]),
        }
      : null;
  }
  function salvar(input, id) {
    const old = id ? row(id) : null;
    if (id && !old)
      throw Object.assign(new Error("Conexão não encontrada."), {
        status: 404,
      });
    const provider = input.provider ?? old?.provider;
    if (!Object.hasOwn(ENDPOINTS, provider) && provider !== "custom")
      throw new Error("Escolha um provedor válido.");
    const model = input.model ?? old?.modelo ?? "";
    const name = input.name ?? old?.nome ?? provider;
    if (typeof model !== "string" || model.length > 256 || /\s/.test(model))
      throw new Error("ID do modelo inválido.");
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new Error("Nome de conexão inválido.");
    const apiKey = input.apiKey;
    if ((!old || old.provider !== provider) && !apiKey)
      throw new Error("Informe uma nova chave para este provedor.");
    if (
      apiKey !== undefined &&
      (typeof apiKey !== "string" ||
        !apiKey.trim() ||
        apiKey.length > 16384 ||
        /[\r\n]/.test(apiKey))
    )
      throw new Error("Chave inválida.");
    const endpoint =
      provider === "custom" ? (input.endpoint ?? old?.endpoint) : null;
    if (provider === "custom") {
      let u;
      try {
        u = new URL(endpoint);
      } catch {
        throw new Error("Informe um endpoint HTTPS.");
      }
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new Error("Endpoint HTTPS inválido.");
    }
    const newId = id || randomUUID();
    const secret = apiKey
      ? cofre.cifrar(apiKey.trim(), [owner, "llm", provider, newId])
      : old.segredo;
    const mask = apiKey ? "••••" + (apiKey.trim().length > 4 ? apiKey.trim().slice(-4) : "") : old.mascara;
    con
      .prepare(
        "INSERT INTO conexao_llm VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,nome=excluded.nome,modelo=excluded.modelo,endpoint=excluded.endpoint,segredo=excluded.segredo,mascara=excluded.mascara",
      )
      .run(newId, provider, name.trim(), model, endpoint, secret, mask);
    return meta(row(newId));
  }
  function preferencias() {
    const p = con
      .prepare("SELECT conexao,modelo FROM preferencia_llm WHERE id=1")
      .get();
    return p && row(p.conexao)
      ? { conexaoId: p.conexao, modelo: p.modelo }
      : null;
  }
  function selecionar(conexaoId, modelo) {
    if (!row(conexaoId)) throw new Error("Conexão não encontrada.");
    if (
      typeof modelo !== "string" ||
      !modelo ||
      modelo.length > 256 ||
      /\s/.test(modelo)
    )
      throw new Error("Modelo inválido.");
    con
      .prepare(
        "INSERT INTO preferencia_llm VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET conexao=excluded.conexao,modelo=excluded.modelo",
      )
      .run(conexaoId, modelo);
    return preferencias();
  }
  return {
    preferencias,
    selecionar,
    salvar,
    obterSegredo,
    obter: (id) => meta(row(id)),
    listar: () =>
      con.prepare("SELECT * FROM conexao_llm ORDER BY rowid").all().map(meta),
    apagar: (id) =>
      con.prepare("DELETE FROM conexao_llm WHERE id=?").run(id).changes > 0,
    async modelos(id) {
      const c = obterSegredo(id);
      if (!c) throw new Error("Conexão não encontrada.");
      return listarModelos(c, transport);
    },
    cliente(id) {
      const c = obterSegredo(id);
      if (!c) throw new Error("Conexão não encontrada.");
      return criarCliente(c, transport);
    },
  };
}
module.exports = { criarConexoes };
