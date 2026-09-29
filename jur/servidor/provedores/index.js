const { randomUUID } = require("node:crypto");
const { requisitar } = require("../destinos-llm");
const SDK = require("@anthropic-ai/sdk");
const ENDPOINTS = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
function erroProvedor(status) {
  return new Error(
    status === 401 || status === 403
      ? "Chave recusada pelo provedor. Substitua a credencial."
      : status === 429
        ? "Limite ou saldo do provedor atingido. Tente novamente mais tarde."
        : status === 404
          ? "Modelo indisponível neste provedor."
          : status === 400
            ? "Modelo ou parâmetros incompatíveis. Escolha um modelo com suporte a ferramentas."
            : "Não foi possível concluir a resposta do provedor.",
  );
}
function blocos(content) {
  return typeof content === "string"
    ? [{ type: "text", text: content }]
    : content || [];
}
function paraOpenAI(messages, system) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    const bs = blocos(m.content);
    const text = bs
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const calls = bs.filter((b) => b.type === "tool_use");
    if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((b) => ({
                id: b.id,
                type: "function",
                function: { name: b.name, arguments: JSON.stringify(b.input) },
              })),
            }
          : {}),
      });
    else {
      const results = bs.filter((b) => b.type === "tool_result");
      for (const b of results)
        out.push({
          role: "tool",
          tool_call_id: b.tool_use_id,
          content:
            typeof b.content === "string"
              ? b.content
              : JSON.stringify(b.content),
        });
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}
function paraGemini(messages) {
  const names = new Map();
  const contents = [];
  for (const m of messages) {
    const parts = [];
    for (const b of blocos(m.content)) {
      if (b.type === "text" && b.text) parts.push({ text: b.text });
      if (b.type === "tool_use") {
        names.set(b.id, b.name);
        parts.push({
          functionCall: { name: b.name, args: b.input, id: b.id },
          ...(b.geminiSignature ? { thoughtSignature: b.geminiSignature } : {}),
        });
      }
      if (b.type === "tool_result")
        parts.push({
          functionResponse: {
            name: names.get(b.tool_use_id) || "resultado",
            id: b.tool_use_id,
            response: { result: b.content },
          },
        });
    }
    if (parts.length)
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}
async function* eventos(response) {
  if (!response.body) throw erroEOFPrematuro();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  async function* corpoComErroTipado() {
    try {
      for await (const chunk of response.body) yield chunk;
    } catch (cause) {
      const error = new Error("Falha ao ler o stream do provedor.");
      error.name = "ProviderResponseBodyError";
      error.cause = cause;
      throw error;
    }
  }
  for await (const chunk of corpoComErroTipado()) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) throw new Error("Resposta excedeu o limite.");
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let at;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
  if (buffer.trim()) throw erroEOFPrematuro();
}
function diagnosticoPadrao(evento) {
  console.error(JSON.stringify(evento));
}
function erroAbortado() {
  return Object.assign(new Error("Requisição cancelada."), {
    name: "APIUserAbortError",
  });
}
function erroStreamInterrompido() {
  return Object.assign(
    new Error(
      "A conexão com o provedor foi interrompida antes de concluir. Tente novamente.",
    ),
    { name: "ProviderStreamError", code: "PROVIDER_STREAM_INTERRUPTED" },
  );
}
function erroEOFPrematuro() {
  return Object.assign(new Error("Resposta interrompida pelo provedor."), {
    name: "ProviderPrematureEOFError",
    code: "PREMATURE_EOF",
  });
}
function registrarDiagnosticoSeguro(registrar, evento) {
  try {
    const resultado = registrar(evento);
    if (resultado && typeof resultado.catch === "function") {
      resultado.catch(() => {});
    }
  } catch {
    // Observabilidade nunca substitui a falha original do provedor.
  }
}
function criarCliente(
  connection,
  transport = requisitar,
  registrarDiagnostico = diagnosticoPadrao,
) {
  const endpoint = ENDPOINTS[connection.provider] || connection.endpoint;
  if (!endpoint) throw new Error("Provedor não configurado.");
  if (connection.provider === "anthropic") {
    const client = new (SDK.default || SDK)({
      apiKey: connection.apiKey,
      maxRetries: 0,
      fetch: transport,
    });
    return {
      messages: {
        stream(params, options) {
          const clean = {
            ...params,
            messages: params.messages.map((m) => ({
              ...m,
              content: blocos(m.content).map((b) => {
                const { geminiSignature, ...rest } = b;
                return rest;
              }),
            })),
          };
          const stream = client.messages.stream(clean, options);
          const wrapper = {
            on: (event, fn) => {
              stream.on(event, fn);
              return wrapper;
            },
            finalMessage: async () => {
              try {
                return await stream.finalMessage();
              } catch (e) {
                if (e.name === "APIUserAbortError") throw e;
                throw erroProvedor(e.status);
              }
            },
          };
          return wrapper;
        },
      },
    };
  }
  return {
    messages: {
      stream(params, { signal } = {}) {
        const listeners = [];
        const stream = {
          on(event, fn) {
            if (event === "text") listeners.push(fn);
            return stream;
          },
          async finalMessage() {
            const gemini = connection.provider === "gemini";
            const model = params.model;
            let url,
              body,
              headers = { "content-type": "application/json" };
            if (gemini) {
              url = `${endpoint}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`;
              headers["x-goog-api-key"] = connection.apiKey;
              body = {
                systemInstruction: { parts: [{ text: params.system }] },
                contents: paraGemini(params.messages),
                tools: [
                  {
                    functionDeclarations: params.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.input_schema,
                    })),
                  },
                ],
              };
            } else {
              url = endpoint.replace(/\/$/, "") + "/chat/completions";
              headers.authorization = `Bearer ${connection.apiKey}`;
              body = {
                model,
                stream: true,
                messages: paraOpenAI(params.messages, params.system),
                ...(params.tools.length
                  ? {
                      tools: params.tools.map((t) => ({
                        type: "function",
                        function: {
                          name: t.name,
                          description: t.description,
                          parameters: t.input_schema,
                        },
                      })),
                    }
                  : {}),
              };
            }
            let response;
            try {
              response = await transport(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal,
              });
            } catch (e) {
              if (signal?.aborted)
                throw Object.assign(new Error("Requisição cancelada."), {
                  name: "APIUserAbortError",
                });
              throw erroProvedor();
            }
            if (!response.ok) {
              await response.body?.cancel();
              throw erroProvedor(response.status);
            }
            const content = [];
            const calls = new Map();
            let text = "",
              finished = false,
              stop = "end_turn";
            let generationId = null;
            try {
              for await (const raw of eventos(response)) {
                if (signal?.aborted) throw erroAbortado();
                if (raw === "[DONE]") {
                  break;
                }
                let data;
                try {
                  data = JSON.parse(raw);
                } catch {
                  throw new Error("Resposta inválida do provedor.");
                }
                const idGeracao = gemini ? data.responseId : data.id;
                if (typeof idGeracao === "string") {
                  generationId = idGeracao.slice(0, 256);
                }
                if (data.error) throw erroProvedor(data.error.code);
                if (gemini) {
                  const candidate = data.candidates?.[0];
                  if (data.promptFeedback?.blockReason)
                    throw new Error("O provedor recusou esta solicitação.");
                  for (const part of candidate?.content?.parts || []) {
                    if (part.text && !part.thought) {
                      text += part.text;
                      listeners.forEach((fn) => fn(part.text));
                    }
                    if (part.functionCall) {
                      const f = part.functionCall;
                      content.push({
                        type: "tool_use",
                        id: f.id || randomUUID(),
                        name: f.name,
                        input: f.args || {},
                        ...(part.thoughtSignature
                          ? { geminiSignature: part.thoughtSignature }
                          : {}),
                      });
                    }
                  }
                  if (candidate?.finishReason) {
                    finished = true;
                    if (candidate.finishReason !== "STOP")
                      throw new Error("O provedor interrompeu a resposta.");
                  }
                } else {
                  const choice = data.choices?.[0];
                  const delta = choice?.delta;
                  if (delta?.content) {
                    text += delta.content;
                    listeners.forEach((fn) => fn(delta.content));
                  }
                  for (const t of delta?.tool_calls || []) {
                    const old = calls.get(t.index) || {
                      id: "",
                      name: "",
                      args: "",
                    };
                    old.id += t.id || "";
                    old.name += t.function?.name || "";
                    old.args += t.function?.arguments || "";
                    calls.set(t.index, old);
                  }
                  if (choice?.finish_reason) {
                    finished = true;
                    if (!["stop", "tool_calls"].includes(choice.finish_reason))
                      throw new Error("O provedor interrompeu a resposta.");
                  }
                }
              }
              if (!finished) throw erroEOFPrematuro();
            } catch (error) {
              const erroDoCorpo = error.name === "ProviderResponseBodyError";
              const eofPrematuro = error.name === "ProviderPrematureEOFError";
              const abortoDoSinal =
                error.name === "APIUserAbortError" && signal?.aborted;
              if (!erroDoCorpo && !eofPrematuro && !abortoDoSinal) throw error;
              const cause = erroDoCorpo ? error.cause || error : error;
              const diagnostico = {
                event: "llm_stream_failure",
                provider: connection.provider,
                model,
                origin: signal?.aborted ? "signal" : "provider",
                phase: "response_body",
                generationId,
                errorName: cause.name || "Error",
                errorCode: cause.code || null,
              };
              registrarDiagnosticoSeguro(registrarDiagnostico, diagnostico);
              if (abortoDoSinal || signal?.aborted) throw erroAbortado();
              throw erroStreamInterrompido();
            }
            for (const call of calls.values()) {
              let input;
              try {
                input = JSON.parse(call.args);
              } catch {
                throw new Error("Argumentos de ferramenta inválidos.");
              }
              if (
                !call.id ||
                !call.name ||
                !input ||
                Array.isArray(input) ||
                typeof input !== "object"
              )
                throw new Error("Chamada de ferramenta inválida.");
              content.push({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input,
              });
            }
            if (text) content.unshift({ type: "text", text });
            if (content.some((b) => b.type === "tool_use")) stop = "tool_use";
            return { content, stop_reason: stop };
          },
        };
        return stream;
      },
    },
  };
}
async function listarModelos(connection, transport = requisitar) {
  const base = ENDPOINTS[connection.provider] || connection.endpoint;
  let url = base.replace(/\/$/, "") + "/models";
  const headers = {};
  if (connection.provider === "anthropic") {
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (connection.provider === "gemini")
    headers["x-goog-api-key"] = connection.apiKey;
  else headers.authorization = `Bearer ${connection.apiKey}`;
  let response;
  try {
    response = await transport(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw erroProvedor();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw erroProvedor(response.status);
  }
  let data;
  try {
    const chunks = [];
    let bytes = 0;
    if (!response.body) throw new Error();
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object") throw new Error();
  } catch {
    throw new Error("Catálogo indisponível. Informe o ID do modelo.");
  }
  const list = data.data || data.models;
  if (!Array.isArray(list))
    throw new Error("Catálogo indisponível. Informe o ID do modelo.");
  return list
    .filter((m) => m && typeof (m.id || m.name) === "string")
    .map((m) => ({
      id: (m.id || m.name).replace(/^models\//, ""),
      name: m.display_name || m.displayName || m.name || m.id,
      tools: Array.isArray(m.supported_parameters)
        ? m.supported_parameters.includes("tools")
        : null,
      reasoning: false,
    }));
}
module.exports = {
  criarCliente,
  paraOpenAI,
  paraGemini,
  listarModelos,
  ENDPOINTS,
  erroProvedor,
};
