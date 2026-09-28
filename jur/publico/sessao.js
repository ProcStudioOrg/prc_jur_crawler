(function () {
  const login = document.querySelector("#login-procstudio");
  let principal = null;
  for (const key of [
    "jur.chaveLlm",
    "jur.chaveConexao",
    "jur.modelo",
    "jur.esforco",
    "jur.tribunaisDesligados",
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  function sair() {
    principal = null;
    window.jurConexoes.limpar();
    document.body.classList.add("aguardando-sessao");
    login.hidden = false;
    document.dispatchEvent(new Event("jur:sair"));
  }
  window.jurSessao = {
    get principal() {
      return principal;
    },
  };
  document.addEventListener("jur:autenticacao-negada", sair);
  document.querySelector("#sair-conta").addEventListener("click", async () => {
    try {
      await window.jurApi.pedir("/auth/logout", { method: "POST", body: "{}" });
    } catch {
    } finally {
      sair();
      location.replace("/");
    }
  });
  if (new URLSearchParams(location.search).get("login") === "erro")
    document.querySelector("#login-erro").textContent =
      "Não foi possível entrar. Tente novamente com sua conta ProcStudio.";
  (async () => {
    try {
      principal = await window.jurApi.pedir("/api/v1/me");
      await window.jurConexoes.carregar();
      document.querySelector("#conta-nome").textContent =
        "Conta ProcStudio · " + principal.userId;
      login.hidden = true;
      document.body.classList.remove("aguardando-sessao");
      document.dispatchEvent(new Event("jur:sessao"));
    } catch (e) {
      sair();
      if (e.status !== 401)
        document.querySelector("#login-erro").textContent = e.message;
    }
  })();
})();
