(function () {
  // `procstudio` e a conexao gerenciada (chave do operador, cobrada do saldo do time): o
  // servidor a lista mas ela nao e um provedor que o usuario cadastra.
  const names = {
    procstudio: "ProcStudio",
    anthropic: "Anthropic",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    custom: "API compatível com OpenAI",
  };
  let lista = [],
    selected = null;
  const api = () => window.jurApi;
  window.jurConexoes = {
    names,
    get lista() {
      return lista;
    },
    get selected() {
      return selected;
    },
    async carregar() {
      const [c, p] = await Promise.all([
        api().pedir("/api/v1/conexoes-llm"),
        api().pedir("/api/v1/preferencias"),
      ]);
      lista = c.conexoes;
      selected = p.ia;
      // Sem preferencia gravada: a conexao ProcStudio, quando o servidor a oferece; senao a
      // primeira conexao propria com modelo escolhido.
      if (!selected) {
        const c =
          lista.find((c) => c.provider === "procstudio") ||
          lista.find((c) => c.model);
        if (c) await this.selecionar(c.id, c.model);
      }
      document.dispatchEvent(new Event("jur:ia"));
    },
    async selecionar(conexaoId, modelo) {
      selected = (
        await api().pedir("/api/v1/preferencias", {
          method: "PATCH",
          body: JSON.stringify({ conexaoId, modelo }),
        })
      ).ia;
      document.dispatchEvent(new Event("jur:ia"));
    },
    limpar() {
      lista = [];
      selected = null;
      document.dispatchEvent(new Event("jur:ia"));
    },
    async modelos(id) {
      return (await api().pedir(`/api/v1/conexoes-llm/${id}/modelos`)).modelos;
    },
  };
})();
