// Conexão de IA gerenciada pelo ProcStudio: a chave é do OPERADOR e vem só do ambiente.
// Nunca é gravada no banco do usuário nem devolvida por rota alguma.
const PADRAO = {
  endpoint: "https://openrouter.ai/api/v1",
  modelo: "z-ai/glm-5.3-flash",
  modeloCatalogo: "glm-5.3-flash",
  upstream: "z-ai",
  rotulo: "GLM-5.3 Flash",
};
function doAmbiente(env = process.env) {
  const apiKey = (env.PROCSTUDIO_LLM_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const pega = (nome, padrao) => (env[nome] ?? padrao).trim() || padrao;
  const endpoint = pega("PROCSTUDIO_LLM_ENDPOINT", PADRAO.endpoint);
  // Vazio é válido (sem fixar provedor); só o padrão vale quando a variável não existe.
  const upstream = (env.PROCSTUDIO_LLM_UPSTREAM ?? PADRAO.upstream).trim();
  let host = "";
  try {
    host = new URL(endpoint).hostname;
  } catch {}
  const openrouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  return {
    apiKey,
    endpoint,
    modelo: pega("PROCSTUDIO_LLM_MODELO", PADRAO.modelo),
    modeloCatalogo: pega("PROCSTUDIO_LLM_MODELO_CATALOGO", PADRAO.modeloCatalogo),
    upstream,
    rotulo: pega("PROCSTUDIO_LLM_ROTULO", PADRAO.rotulo),
    extras:
      openrouter && upstream
        ? {
            usage: { include: true },
            provider: { order: [upstream], allow_fallbacks: false },
          }
        : {},
  };
}
module.exports = { doAmbiente };
