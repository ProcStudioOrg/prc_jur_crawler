const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const jobs = require("./jobs");
const conversas = require("./conversas");
const turnos = require("./turnos");
const executor = require("./executor");
const { dono, hash } = require("./sessoes-web");
function criarEscopos({ dir, executarFn, limite = 100 }) {
  const cache = new Map();
  let ativos = 0;
  const espera = [];
  async function executarLimitado(fn, comando, params, extra, home) {
    if (ativos >= 3) await new Promise((resolve) => espera.push(resolve));
    else ativos++;
    try {
      return await fn(comando, params, {
        ...extra,
        cwd: home,
        env: {
          ...process.env,
          JUR_DADOS: home,
          TMPDIR: path.join(home, "tmp"),
          JUR_SESSION_DIR: path.join(home, "sessoes"),
        },
      });
    } finally {
      const next = espera.shift();
      if (next) next();
      else ativos--;
    }
  }
  function obter(principal) {
    const identity = dono(principal);
    if (identity.some((v) => typeof v !== "string" || !v))
      throw new Error("Identidade inválida.");
    const owner = JSON.stringify(identity);
    const id = hash(owner);
    if (cache.has(id)) {
      const item = cache.get(id);
      cache.delete(id);
      cache.set(id, item);
      return item;
    }
    if (cache.size >= limite) {
      for (const [key, item] of cache) {
        if (
          !item.fila.ocupada() &&
          !item.turnos.conversasEmAndamento().length &&
          !item.emUso
        ) {
          item.con.close();
          cache.delete(key);
          break;
        }
      }
      if (cache.size >= limite)
        throw Object.assign(new Error("Servidor ocupado. Tente novamente."), {
          status: 503,
        });
    }
    const home = path.join(dir, "usuarios", id);
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    for (const part of ["tmp", "sessoes"])
      fs.mkdirSync(path.join(home, part), { recursive: true, mode: 0o700 });
    const con = db.abrir(path.join(home, "jur.db"));
    con.exec(
      "CREATE TABLE IF NOT EXISTS proprietario (id INTEGER PRIMARY KEY CHECK(id=1), identidade TEXT NOT NULL)",
    );
    con.prepare("INSERT OR IGNORE INTO proprietario VALUES (1,?)").run(owner);
    if (
      con.prepare("SELECT identidade FROM proprietario WHERE id=1").get()
        .identidade !== owner
    ) {
      con.close();
      throw new Error("Identidade do armazenamento inválida.");
    }
    const item = {
      id,
      owner,
      home,
      con,
      emUso: 0,
      conversas: conversas.criarRepositorio(con),
      turnos: turnos.criarRegistro(),
      listarFn: (c, p) => executarLimitado(executor.listar, c, p, {}, home),
      fila: jobs.criarFila({
        con,
        dirResultados: path.join(home, "resultados"),
        executarFn: (c, p, e) =>
          executarLimitado(executarFn || executor.executar, c, p, e, home),
      }),
    };
    cache.set(id, item);
    return item;
  }
  return {
    obter,
    fechar() {
      for (const item of cache.values()) item.con.close();
      cache.clear();
    },
  };
}
module.exports = { criarEscopos };
