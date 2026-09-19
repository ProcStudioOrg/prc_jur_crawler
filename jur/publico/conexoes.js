(function () {
  const names = {
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
      if (!selected && lista.find((c) => c.model)) {
        const c = lista.find((c) => c.model);
        await this.selecionar(c.id, c.model);
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
