const { randomUUID } = require("node:crypto");
const { criarPool } = require("./navegadores/pool");
const { criarRegistro } = require("./navegadores/registro");
const { comBrowserbase } = require("./navegadores/browserbase");
const remotos = require("./navegadores/remotos");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const jobs = require("./jobs");
const conversas = require("./conversas");
const turnos = require("./turnos");
const executor = require("./executor");
const { dono, hash } = require("./sessoes-web");
function criarEscopos({ dir, executarFn, limite = 100, concorrencia }) {
  const cache = new Map();
  const pool = criarPool(concorrencia);
  // O Chromium remoto não pesa no servidor; a vaga remota só limita o processo Node do
  // crawler e respeita a concorrência dos fornecedores (Kernel Developer: 5).
  const remoto = remotos.configurados().length > 0;
  const poolRemoto = remoto ? criarPool(Number(process.env.JUR_CONCORRENCIA_REMOTA || 5)) : null;
  const provedorDe = (comando, extra) =>
    extra.navegador?.provedor || (remoto && remotos.exigeRemoto(comando) ? "remoto" : "local");
  const poolDe = (provedor) => (provedor === "remoto" ? poolRemoto : pool);
  function poolDaConta(navegadores) {
    return {
      adquirir: (id, sinal) => poolDe(navegadores.opcoes(id)?.provedor).adquirir(id, sinal),
      posicao: (id) => pool.posicao(id) ?? poolRemoto?.posicao(id) ?? null,
      estado: () => ({ ...pool.estado(), remoto: poolRemoto ? { ...poolRemoto.estado(), fornecedores: remotos.nomes() } : null }),
    };
  }
  function executarNoEscopo(fn, comando, params, extra, home) {
    const executarComCdp = (cdp = '', { captcha = false } = {}) => fn(comando, params, {
      ...extra,
      cwd: home,
      env: {
        ...process.env,
        JUR_DADOS: home,
        TMPDIR: path.join(home, "tmp"),
        JUR_SESSION_DIR: path.join(home, "sessoes"),
        JUR_ACOMPANHAR: extra.navegador?.acompanhar ? "1" : "0",
        JUR_CAPTCHA: extra.navegador?.captcha ? "1" : "0",
        JUR_BROWSER_CDP: cdp,
        // O fornecedor está resolvendo o captcha sozinho: o crawler espera antes de pedir ajuda.
        JUR_CAPTCHA_AUTOMATICO: captcha ? "1" : "0",
      },
    });
    const avisar = (info) => { try { extra.aoNavegador?.(info); } catch { /* aviso não derruba a busca */ } };
    const provedor = provedorDe(comando, extra);
    if (provedor === "remoto")
      return remotos.comNavegadorRemoto(executarComCdp, { ...remotos.opcoesPara(comando), sinal: extra.sinal, aoFornecedor: avisar });
    if (provedor === "browserbase") {
      avisar({ fornecedor: "browserbase", nome: "Browserbase" });
      return comBrowserbase(executarComCdp, { sinal: extra.sinal });
    }
    avisar({ fornecedor: "local", nome: "Servidor ProcStudio" });
    return executarComCdp();
  }
  async function listarLimitado(comando, params, home) {
    const liberar = await poolDe(provedorDe(comando, {})).adquirir(randomUUID());
    try { return await executarNoEscopo(executor.listar, comando, params, {}, home); }
    finally { liberar(); }
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
    const navegadores = criarRegistro(con, { browserbase: Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID), remoto });
    const poolConta = poolDaConta(navegadores);
    const item = {
      id,
      owner,
      home,
      con,
      emUso: 0,
      pool: poolConta,
      navegadores,
      conversas: conversas.criarRepositorio(con),
      turnos: turnos.criarRegistro(),
      listarFn: (c, p) => listarLimitado(c, p, home),
      fila: jobs.criarFila({
        con,
        pool: poolConta,
        navegadores,
        dirResultados: path.join(home, "resultados"),
        executarFn: (c, p, e) =>
          executarNoEscopo(executarFn || executor.executar, c, p, e, home),
      }),
    };
    cache.set(id, item);
    return item;
  }
  return {
    obter,
    fechar() {
      for (const item of cache.values()) { item.navegadores.fechar(); item.con.close(); }
      cache.clear();
    },
  };
}
module.exports = { criarEscopos };
