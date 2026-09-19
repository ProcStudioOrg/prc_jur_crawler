const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { criarCofre } = require("./cofre");
const { criarSessoes } = require("./sessoes-web");
const { criarChaves } = require("./chaves-pessoais");
const { criarEscopos } = require("./escopo");
const { criarApp } = require("./index");
const { json } = require("./http");
function cookie(req, name) {
  const pairs = (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  return pairs.length === 1 ? pairs[0].slice(name.length + 1) : "";
}
function criarAplicacao({
  dir,
  cofreKey,
  procstudio,
  publicUrl,
  frontendUrl,
  clientId,
  executarFn,
  clienteLLM,
  llmTransport,
}) {
  const publicOrigin = new URL(publicUrl).origin;
  const frontend = new URL("/_auth/jurcrawler", frontendUrl);
  if (
    new URL(publicUrl).protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(publicUrl).hostname)
  )
    throw new Error("JurCrawler exige HTTPS.");
  if (!clientId) throw new Error("Cliente ProcStudio não configurado.");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(path.join(dir, "jur.db")))
    throw new Error(
      "Dados legados encontrados. Reinicialize somente os dados do JurCrawler antes de iniciar.",
    );
  const con = new DatabaseSync(path.join(dir, "acesso.db"));
  con.exec("PRAGMA journal_mode=WAL");
  fs.chmodSync(path.join(dir, "acesso.db"), 0o600);
  const cofre = criarCofre(cofreKey);
  const sessoes = criarSessoes({ con, cofre, procstudio });
  const chaves = criarChaves(con);
  const scopes = criarEscopos({ dir, executarFn });
  const publicApp = criarApp();
  const secure = new URL(publicUrl).protocol === "https:" ? "; Secure" : "";
  const setCookie = (name, value, age) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
  const redirect = (res, to, cookies) => {
    if (cookies) res.setHeader("set-cookie", cookies);
    res.writeHead(303, {
      location: to,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };
  const denied = (res) => {
    res.setHeader("www-authenticate", 'Session realm="jur"');
    return json(res, 401, { erro: "Entre com sua conta ProcStudio." });
  };
  async function handler(req, res) {
    try {
      const url = new URL(req.url, publicOrigin);
      const pathname = url.pathname;
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("x-content-type-options", "nosniff");
      if (pathname.startsWith("/api/") || pathname.startsWith("/auth/"))
        res.setHeader("cache-control", "no-store");
      if (pathname === "/auth/login" && req.method === "GET") {
        const attempt = sessoes.iniciar();
        const target = new URL(frontend);
        target.searchParams.set("state", attempt.state);
        target.searchParams.set("code_challenge", attempt.challenge);
        return redirect(
          res,
          target.href,
          setCookie("jur_attempt", attempt.cookie, 300),
        );
      }
      if (pathname === "/auth/callback" && req.method === "GET") {
        const s = await sessoes.concluir({
          state: url.searchParams.get("state"),
          cookie: cookie(req, "jur_attempt"),
          code: url.searchParams.get("code"),
          redirectUri: publicOrigin + "/auth/callback",
        });
        if (!s)
          return redirect(res, "/?login=erro", setCookie("jur_attempt", "", 0));
        return redirect(res, "/", [
          setCookie(
            "jur_session",
            s.token,
            Math.max(
              0,
              Math.floor((s.principal.expiresAt - Date.now()) / 1000),
            ),
          ),
          setCookie("jur_attempt", "", 0),
        ]);
      }
      const protectedRoute =
        pathname === "/mcp" ||
        pathname.startsWith("/api/v1/") ||
        pathname === "/auth/logout";
      if (
        !protectedRoute ||
        ["/api/v1/saude", "/api/v1/openapi.json"].includes(pathname)
      )
        return publicApp.handler(req, res);
      const session = cookie(req, "jur_session");
      const bearer = req.headers.authorization;
      if (session && bearer)
        return json(res, 400, { erro: "Use uma única forma de autenticação." });
      let principal;
      let authenticate;
      if (bearer) {
        const value = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
        authenticate = async () => {
          const p = chaves.verificar(value);
          return p && (await procstudio.subject(p))
            ? { ...p, expiresAt: Date.now() + 86400000 }
            : null;
        };
      } else authenticate = () => sessoes.autenticar(session);
      principal = await authenticate();
      if (!principal) return denied(res);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        !bearer &&
        req.headers.origin !== publicOrigin
      )
        return json(res, 403, { erro: "Origem não permitida." });
      if (req.headers.origin && req.headers.origin !== publicOrigin)
        return json(res, 403, { erro: "Origem não permitida." });
      if (pathname === "/api/v1/me" && req.method === "GET")
        return json(res, 200, principal);
      if (pathname === "/auth/logout" && req.method === "POST") {
        res.setHeader("set-cookie", setCookie("jur_session", "", 0));
        await sessoes.sair(session);
        return json(res, 200, { ok: true });
      }
      const scope = scopes.obter(principal);
      scope.emUso++;
      if (!scope.app) {
        scope.conexoes = require("./conexoes-llm").criarConexoes({
          con: scope.con,
          owner: scope.owner,
          cofre,
          transport: llmTransport,
        });
        scope.app = criarApp({
          ...scope,
          cofre,
          chaves: chaves.para(principal),
          clienteLLM,
          conta: principal,
        });
      }
      req.principal = principal;
      const controller = new AbortController();
      req.authSignal = controller.signal;
      let validating = false;
      const interval = setInterval(async () => {
        if (validating) return;
        validating = true;
        try {
          if (!(await authenticate())) {
            controller.abort();
            res.end();
          }
        } catch {
          controller.abort();
          res.end();
        } finally {
          validating = false;
        }
      }, 30000);
      interval.unref();
      const timer = setTimeout(
        () => {
          controller.abort();
          res.end();
        },
        Math.max(1, principal.expiresAt - Date.now()),
      );
      timer.unref();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearInterval(interval);
        clearTimeout(timer);
        scope.emUso--;
      };
      try {
        await scope.app.handler(req, res);
      } finally {
        if (res.writableEnded || res.destroyed) release();
        else res.once("close", release);
      }
    } catch (e) {
      if (res.headersSent) return res.end();
      return json(res, e.status === 503 ? 503 : 500, {
        erro:
          e.status === 503
            ? e.message
            : "Não foi possível concluir a operação.",
      });
    }
  }
  return {
    handler,
    fechar() {
      scopes.fechar();
      con.close();
    },
  };
}
module.exports = { criarAplicacao };
