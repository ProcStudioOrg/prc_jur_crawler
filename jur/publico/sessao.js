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
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("jur.tribunaisDesligados.")) localStorage.removeItem(k);
    }
  } catch {}
  const MSG_SESSAO_INVALIDA =
    "Sua conta do ProcStudio está inativa ou a sessão expirou; entre de novo.";
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
  // 401 de sessão em qualquer pedido: volta ao login. Com `sessao_invalida` (ProcStudio respondeu
  // que o usuário/time não vale mais) a tela diz por quê, em vez de só pedir o login de novo.
  document.addEventListener("jur:autenticacao-negada", (e) => {
    const veioDeSessaoAtiva = principal !== null;
    sair();
    if (e.detail?.tipo === "sessao_invalida" || veioDeSessaoAtiva)
      document.querySelector("#login-erro").textContent = MSG_SESSAO_INVALIDA;
  });
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
