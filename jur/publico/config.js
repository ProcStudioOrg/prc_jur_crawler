(function () {
  const $ = (s, root = document) => root.querySelector(s);
  const api = (url, options) => window.jurApi.pedir(url, options);
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function abrir() {
    const opener = document.activeElement;
    const panel = $("#painel-config");
    panel.replaceChildren();
    panel.hidden = false;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "config-titulo");
    const box = el("div", null, "painel-caixa config-caixa");
    const header = el("header", null, "config-cabecalho");
    const title = el("h2", "Configurações");
    title.id = "config-titulo";
    const close = el("button", "×", "fechar");
    close.setAttribute("aria-label", "Fechar");
    header.append(title, close);
    const tabs = el("div", null, "config-tabs");
    tabs.setAttribute("role", "tablist");
    const ia = el("button", "IA"),
      integrations = el("button", "Integrações");
    for (const b of [ia, integrations]) {
      b.type = "button";
      b.setAttribute("role", "tab");
      tabs.append(b);
    }
    const body = el("div", null, "config-corpo");
    const status = el("p", null, "estado-chave");
    status.setAttribute("role", "status");
    box.append(header, tabs, body, status);
    panel.append(box);
    function finish() {
      panel.hidden = true;
      panel.replaceChildren();
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("jur:sair", finish);
      opener?.focus();
    }
    function keyboard(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
      if (e.key === "Tab") {
        const focus = [...box.querySelectorAll("button,input,select,a")].filter(
          (n) => !n.disabled && n.getClientRects().length,
        );
        if (!focus.length) return;
        if (e.shiftKey && document.activeElement === focus[0]) {
          e.preventDefault();
          focus.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === focus.at(-1)) {
          e.preventDefault();
          focus[0].focus();
        }
      }
    }
    document.addEventListener("jur:sair", finish);
    close.onclick = finish;
    panel.onmousedown = (e) => {
      if (e.target === panel) finish();
    };
    document.addEventListener("keydown", keyboard);
    function tab(button) {
      for (const b of [ia, integrations])
        b.setAttribute("aria-selected", String(b === button));
      status.textContent = "";
      body.replaceChildren();
    }
    function field(label, type = "text", value = "") {
      const l = el("label", label, "config-label");
      const input = el("input", null, "campo");
      input.type = type;
      input.setAttribute("aria-label", label);
      input.value = value;
      input.autocomplete = "off";
      l.append(input);
      return { l, input };
    }
    function button(text, action, cls = "botao-secundario") {
      const b = el("button", text, cls);
      b.type = "button";
      b.onclick = action;
      return b;
    }
    async function busy(b, fn) {
      b.disabled = true;
      status.textContent = "";
      try {
        await fn();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    }
    function renderIA() {
      tab(ia);
      body.append(
        el("h3", "Suas conexões de IA"),
        el(
          "p",
          "Escolha o provedor, adicione sua chave e selecione um modelo.",
          "config-descricao",
        ),
      );
      for (const c of window.jurConexoes.lista) {
        const row = el("div", null, "conexao-linha");
        const info = el("div");
        info.append(
          el("strong", c.name),
          el(
            "small",
            `${window.jurConexoes.names[c.provider]} · ${c.maskedKey}`,
          ),
        );
        row.append(
          info,
          button("Editar", () => wizard(c)),
          button("Remover", async (e) => {
            await busy(e.currentTarget, async () => {
              await api("/api/v1/conexoes-llm/" + c.id, { method: "DELETE" });
              await window.jurConexoes.carregar();
              renderIA();
            });
          }),
        );
        body.append(row);
      }
      body.append(button("Adicionar conexão", () => wizard(), "botao-acento"));
      if (!window.jurConexoes.lista.length) wizard();
    }
    function wizard(existing) {
      body.replaceChildren();
      status.textContent = "";
      let connection = existing;
      let provider = existing?.provider || "openrouter";
      let model = existing?.model || "";
      let endpoint = existing?.endpoint || "";
      const steps = el("ol", null, "config-etapas");
      for (const name of ["Provedor", "Credencial", "Modelo"])
        steps.append(el("li", name));
      const content = el("div", null, "config-etapa");
      body.append(steps, content);
      function step(n) {
        [...steps.children].forEach((li, i) => {
          if (i === n) li.setAttribute("aria-current", "step");
          else li.removeAttribute("aria-current");
        });
        content.replaceChildren();
        status.textContent = "";
      }
      function first() {
        step(0);
        content.append(el("h3", "Qual provedor você quer usar?"));
        const label = el("label", "Provedor", "config-label");
        const select = el("select", null, "campo");
        select.setAttribute("aria-label", "Provedor");
        for (const [id, name] of Object.entries(window.jurConexoes.names))
          select.add(new Option(name, id));
        select.value = provider;
        label.append(select);
        const url = field("Endpoint da API", "url", endpoint);
        url.input.placeholder = "https://seu-provedor.com/v1";
        url.l.hidden = provider !== "custom";
        select.onchange = () => {
          provider = select.value;
          url.l.hidden = provider !== "custom";
        };
        content.append(
          label,
          url.l,
          button(
            "Continuar",
            () => {
              endpoint = url.input.value.trim();
              second();
            },
            "botao-acento",
          ),
        );
      }
      function second() {
        step(1);
        content.append(
          el("h3", "Conecte sua conta " + window.jurConexoes.names[provider]),
        );
        const name = field(
          "Nome da conexão",
          "text",
          connection?.name || window.jurConexoes.names[provider],
        );
        const key = field("Chave de API", "password");
        key.input.placeholder =
          connection?.provider === provider
            ? "Deixe vazio para manter a chave"
            : "Cole a chave do provedor";
        const privacy = el(
          "p",
          "A chave é criptografada no servidor e fica vinculada somente à sua conta.",
          "config-descricao",
        );
        const save = button(
          "Salvar e continuar",
          (e) =>
            busy(e.currentTarget, async () => {
              const data = {
                provider,
                name: name.input.value.trim(),
                model: provider === connection?.provider ? model : "",
                ...(provider === "custom" ? { endpoint } : {}),
                ...(key.input.value.trim()
                  ? { apiKey: key.input.value.trim() }
                  : {}),
              };
              connection = await api(
                "/api/v1/conexoes-llm" +
                  (connection ? "/" + connection.id : ""),
                {
                  method: connection ? "PATCH" : "POST",
                  body: JSON.stringify(data),
                },
              );
              key.input.value = "";
              await window.jurConexoes.carregar();
              third();
            }),
          "botao-acento",
        );
        content.append(
          name.l,
          key.l,
          privacy,
          save,
          button("Alterar provedor", first),
        );
      }
      async function third() {
        step(2);
        content.append(el("h3", "Escolha o modelo"));
        const search = field("Buscar modelo", "search");
        search.input.placeholder = "Busque pelo nome ou fornecedor";
        const list = el("div", null, "config-modelos");
        const manual = field("ID do modelo", "text", model);
        const hint = el("p", "Carregando catálogo…", "config-descricao");
        const save = button(
          "Usar este modelo",
          (e) =>
            busy(e.currentTarget, async () => {
              model = manual.input.value.trim();
              await api("/api/v1/conexoes-llm/" + connection.id, {
                method: "PATCH",
                body: JSON.stringify({ model }),
              });
              await window.jurConexoes.selecionar(connection.id, model);
              await window.jurConexoes.carregar();
              renderIA();
              status.textContent = "Conexão pronta para usar no chat.";
            }),
          "botao-acento",
        );
        content.append(search.l, hint, list, manual.l, save);
        let models = [];
        function render() {
          list.replaceChildren();
          const query = search.input.value.toLowerCase();
          for (const m of models
            .filter((m) => (m.name + " " + m.id).toLowerCase().includes(query))
            .slice(0, 80)) {
            const b = button(
              m.name + " · " + m.id,
              () => {
                manual.input.value = m.id;
                for (const item of list.children)
                  item.classList.remove("selecionado");
                b.classList.add("selecionado");
              },
              "config-modelo",
            );
            b.disabled = m.tools === false;
            if (b.disabled) b.textContent += " · sem ferramentas";
            list.append(b);
          }
        }
        search.input.oninput = render;
        try {
          models = await window.jurConexoes.modelos(connection.id);
          hint.textContent = "Selecione um modelo com suporte a ferramentas.";
          render();
        } catch (e) {
          hint.textContent = e.message + " Informe o ID para continuar.";
        }
      }
      first();
    }
    async function renderIntegrations() {
      tab(integrations);
      body.append(
        el("h3", "Integrações pessoais"),
        el(
          "p",
          "Crie uma chave para conectar clientes MCP ou scripts à sua conta. O valor aparece uma única vez.",
          "config-descricao",
        ),
      );
      const name = field("Nome da integração");
      const list = el("div");
      const generated = el("div", null, "chave-nova");
      generated.hidden = true;
      const create = button(
        "Gerar chave",
        (e) =>
          busy(e.currentTarget, async () => {
            const c = await api("/api/v1/chaves", {
              method: "POST",
              body: JSON.stringify({ nome: name.input.value }),
            });
            generated.replaceChildren(
              el("p", "Copie agora e guarde em um local seguro."),
              el("code", c.valor),
            );
            generated.hidden = false;
            await load();
          }),
        "botao-acento",
      );
      body.append(name.l, create, generated, list);
      async function load() {
        list.replaceChildren();
        for (const c of (await api("/api/v1/chaves")).chaves.filter(
          (c) => !c.revogadoEm,
        )) {
          const row = el("div", null, "conexao-linha");
          row.append(
            el("strong", c.nome),
            el("small", c.prefixo + "…"),
            button("Revogar", (e) =>
              busy(e.currentTarget, async () => {
                await api("/api/v1/chaves/" + c.id, { method: "DELETE" });
                await load();
              }),
            ),
          );
          list.append(row);
        }
      }
      try {
        await load();
      } catch (e) {
        status.textContent = e.message;
      }
    }
    ia.onclick = renderIA;
    integrations.onclick = renderIntegrations;
    renderIA();
    close.focus();
  }
  $("#abrir-config").addEventListener("click", abrir);
})();
