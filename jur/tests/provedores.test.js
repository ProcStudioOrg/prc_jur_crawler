const { test } = require("node:test");
const assert = require("node:assert/strict");
const { criarCliente, paraOpenAI } = require("../servidor/provedores");
const event = (o) => "data: " + JSON.stringify(o) + "\n\n";
test("OpenRouter streaming fragmentado preserva tool calls e texto", async () => {
  const chunks = [
    { choices: [{ delta: { content: "Olá " } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                function: { name: "listar_tribunais", arguments: "{" },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];
  const content = chunks.map(event).join("") + "data: [DONE]\n\n";
  let sent;
  const cliente = criarCliente(
    { provider: "openrouter", apiKey: "fixture", model: "vendor/model" },
    async (u, o) => {
      sent = JSON.parse(o.body);
      return new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < content.length; i += 7)
              c.enqueue(new TextEncoder().encode(content.slice(i, i + 7)));
            c.close();
          },
        }),
      );
    },
  );
  let text = "";
  const r = await cliente.messages
    .stream(
      {
        model: "vendor/model",
        system: "system",
        messages: [{ role: "user", content: "oi" }],
        tools: [],
      },
      {},
    )
    .on("text", (t) => (text += t))
    .finalMessage();
  assert.equal(text, "Olá ");
  assert.equal(sent.model, "vendor/model");
  assert.equal(r.stop_reason, "tool_use");
  assert.deepEqual(r.content[1], {
    type: "tool_use",
    id: "c1",
    name: "listar_tribunais",
    input: {},
  });
});
test("histórico converte resultados sem perder ID nem recrawlear", () => {
  const out = paraOpenAI(
    [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "job-call",
            name: "buscar_jurisprudencia",
            input: { tribunal: "stf" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "job-call",
            content: "job secreto-do-dono",
          },
        ],
      },
    ],
    "system",
  );
  assert.equal(out[1].tool_calls[0].id, "job-call");
  assert.equal(out[2].tool_call_id, "job-call");
  assert.equal(out[2].content, "job secreto-do-dono");
});
test("erro do provedor não expõe credencial nem resposta bruta", async () => {
  const c = criarCliente(
    { provider: "openai", apiKey: "secret-fixture" },
    async () => new Response("secret-fixture", { status: 401 }),
  );
  await assert.rejects(
    c.messages
      .stream({ model: "x", system: "", messages: [], tools: [] }, {})
      .finalMessage(),
    (e) => /Chave/.test(e.message) && !e.message.includes("secret-fixture"),
  );
});
test("stream interrompido não anuncia conclusão", async () => {
  const diagnosticos = [];
  const c = criarCliente(
    { provider: "openai", apiKey: "fixture" },
    async () =>
      new Response(
        event({
          id: "gen-fixture-eof",
          choices: [{ delta: { content: "parcial" } }],
        }),
      ),
    (evento) => diagnosticos.push(evento),
  );
  await assert.rejects(
    c.messages
      .stream({ model: "x", system: "", messages: [], tools: [] }, {})
      .finalMessage(),
    (e) => e.name === "ProviderStreamError" && /interrompida/.test(e.message),
  );
  assert.deepEqual(diagnosticos, [
    {
      event: "llm_stream_failure",
      provider: "openai",
      model: "x",
      origin: "provider",
      phase: "response_body",
      generationId: "gen-fixture-eof",
      errorName: "ProviderPrematureEOFError",
      errorCode: "PREMATURE_EOF",
    },
  ]);
});

test("frame SSE truncado também passa pelo diagnóstico de EOF prematuro", async () => {
  const diagnosticos = [];
  const c = criarCliente(
    { provider: "openrouter", apiKey: "fixture" },
    async () => new Response('data: {"id":"gen-truncada"'),
    (evento) => diagnosticos.push(evento),
  );

  await assert.rejects(
    c.messages
      .stream({ model: "vendor/model", system: "", messages: [], tools: [] }, {})
      .finalMessage(),
    (e) => e.name === "ProviderStreamError",
  );
  assert.deepEqual(diagnosticos, [
    {
      event: "llm_stream_failure",
      provider: "openrouter",
      model: "vendor/model",
      origin: "provider",
      phase: "response_body",
      generationId: null,
      errorName: "ProviderPrematureEOFError",
      errorCode: "PREMATURE_EOF",
    },
  ]);
});

test("reset do socket no meio do stream vira erro seguro, diagnosticável e não repete a cobrança", async () => {
  const diagnosticos = [];
  let requisicoes = 0;
  const segredo = "sk-or-segredo-fixture";
  const prompt = "conteudo sigiloso do processo";
  const erroSocket = Object.assign(new Error("aborted"), {
    code: "ECONNRESET",
  });
  const c = criarCliente(
    { provider: "openrouter", apiKey: segredo },
    async () => {
      requisicoes++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event({
                  id: "gen-fixture-reset",
                  choices: [{ delta: { content: "parcial" } }],
                }),
              ),
            );
            setTimeout(() => controller.error(erroSocket), 0);
          },
        }),
      );
    },
    (evento) => diagnosticos.push(evento),
  );

  await assert.rejects(
    c.messages
      .stream(
        {
          model: "vendor/model",
          system: "system",
          messages: [{ role: "user", content: prompt }],
          tools: [],
        },
        {},
      )
      .finalMessage(),
    (e) =>
      e.name === "ProviderStreamError" &&
      e.message ===
        "A conexão com o provedor foi interrompida antes de concluir. Tente novamente.",
  );
  assert.equal(requisicoes, 1);
  assert.deepEqual(diagnosticos, [
    {
      event: "llm_stream_failure",
      provider: "openrouter",
      model: "vendor/model",
      origin: "provider",
      phase: "response_body",
      generationId: "gen-fixture-reset",
      errorName: "Error",
      errorCode: "ECONNRESET",
    },
  ]);
  assert.ok(!JSON.stringify(diagnosticos).includes(segredo));
  assert.ok(!JSON.stringify(diagnosticos).includes(prompt));
});

test("aborto pelo sinal no meio do stream fica distinto de queda do provedor", async () => {
  const diagnosticos = [];
  const abortar = new AbortController();
  const c = criarCliente(
    { provider: "openrouter", apiKey: "fixture" },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event({
                  id: "gen-fixture-signal",
                  choices: [{ delta: { content: "parcial" } }],
                }),
              ),
            );
            setTimeout(() => {
              abortar.abort();
              controller.enqueue(
                new TextEncoder().encode(
                  event({ choices: [{ delta: { content: "ignorado" } }] }),
                ),
              );
              controller.close();
            }, 0);
          },
        }),
      ),
    (evento) => diagnosticos.push(evento),
  );

  await assert.rejects(
    c.messages
      .stream(
        {
          model: "vendor/model",
          system: "system",
          messages: [{ role: "user", content: "oi" }],
          tools: [],
        },
        { signal: abortar.signal },
      )
      .finalMessage(),
    (e) => e.name === "APIUserAbortError",
  );
  assert.deepEqual(diagnosticos, [
    {
      event: "llm_stream_failure",
      provider: "openrouter",
      model: "vendor/model",
      origin: "signal",
      phase: "response_body",
      generationId: "gen-fixture-signal",
      errorName: "APIUserAbortError",
      errorCode: null,
    },
  ]);
});

test("reset do Gemini registra responseId como identificador da geração", async () => {
  const diagnosticos = [];
  const erroSocket = Object.assign(new Error("aborted"), {
    code: "ECONNRESET",
  });
  const c = criarCliente(
    { provider: "gemini", apiKey: "fixture" },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event({
                  responseId: "gemini-response-fixture",
                  candidates: [
                    { content: { parts: [{ text: "parcial" }] } },
                  ],
                }),
              ),
            );
            setTimeout(() => controller.error(erroSocket), 0);
          },
        }),
      ),
    (evento) => diagnosticos.push(evento),
  );

  await assert.rejects(
    c.messages
      .stream(
        {
          model: "gemini-3-pro",
          system: "",
          messages: [{ role: "user", content: "oi" }],
          tools: [],
        },
        {},
      )
      .finalMessage(),
    (e) => e.name === "ProviderStreamError",
  );
  assert.equal(diagnosticos[0].generationId, "gemini-response-fixture");
});

test("diagnóstico assíncrono rejeitado não interfere na falha original", async () => {
  let rejeicaoConsumida = false;
  const erroSocket = Object.assign(new Error("aborted"), {
    code: "ECONNRESET",
  });
  const c = criarCliente(
    { provider: "openrouter", apiKey: "fixture" },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => controller.error(erroSocket), 0);
          },
        }),
      ),
    () => ({
      catch() {
        rejeicaoConsumida = true;
      },
    }),
  );

  await assert.rejects(
    c.messages
      .stream({ model: "vendor/model", system: "", messages: [], tools: [] }, {})
      .finalMessage(),
    (e) => e.name === "ProviderStreamError",
  );
  assert.equal(rejeicaoConsumida, true);
});

test("catálogo com JSON inválido não devolve corpo bruto nem credencial no erro", async () => {
  const { listarModelos } = require("../servidor/provedores");
  await assert.rejects(
    listarModelos(
      { provider: "openai", apiKey: "sk-abcd" },
      async () => new Response("sk-abcd not json"),
    ),
    (e) => !e.message.includes("sk-abcd"),
  );
});

test("Gemini preserva thoughtSignature opaca e vínculo de tool após salvar/recarregar conversa", async () => {
  const db = require("../servidor/db");
  const conversas = require("../servidor/conversas");
  const { paraGemini } = require("../servidor/provedores");
  const con = db.abrir(":memory:");
  try {
    const repo = conversas.criarRepositorio(con);
    const conversation = repo.criar("Gemini");
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: "listar_tribunais", args: {} },
                thoughtSignature: "opaque-signature",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    const client = criarCliente(
      { provider: "gemini", apiKey: "fixture" },
      async () => new Response(event(payload)),
    );
    const message = await client.messages
      .stream(
        {
          model: "gemini-3-pro",
          system: "",
          messages: [{ role: "user", content: "oi" }],
          tools: [],
        },
        {},
      )
      .finalMessage();
    repo.acrescentar(conversation.id, "assistant", message.content);
    repo.acrescentar(conversation.id, "user", [
      {
        type: "tool_result",
        tool_use_id: message.content[0].id,
        content: "resultado",
      },
    ]);
    const history = repo
      .mensagens(conversation.id)
      .map((m) => ({ role: m.papel, content: m.conteudo }));
    const converted = paraGemini(history);
    assert.equal(converted[0].parts[0].thoughtSignature, "opaque-signature");
    assert.equal(
      converted[1].parts[0].functionResponse.name,
      "listar_tribunais",
    );
    assert.equal(
      converted[0].parts[0].functionCall.id,
      converted[1].parts[0].functionResponse.id,
    );
  } finally {
    con.close();
  }
});

function clienteSse(conn, chunks, capturar) {
  const content = chunks.map(event).join("") + "data: [DONE]\n\n";
  return criarCliente(conn, async (u, o) => {
    capturar?.(JSON.parse(o.body));
    return new Response(content);
  });
}
const paramsUso = {
  model: "z-ai/glm",
  system: "s",
  messages: [{ role: "user", content: "oi" }],
  tools: [],
};
test("OpenAI-compatível envia stream_options e captura usage com cost do OpenRouter", async () => {
  let sent;
  const c = clienteSse(
    {
      provider: "openrouter",
      apiKey: "fixture",
      extras: {
        provider: { order: ["z-ai"], allow_fallbacks: false },
        usage: { include: true },
      },
    },
    [
      { id: "gen-abc", choices: [{ delta: { content: "oi" } }] },
      { id: "gen-abc", choices: [{ delta: {}, finish_reason: "stop" }] },
      {
        id: "gen-abc",
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 20 },
          cost: 0.0042,
        },
      },
    ],
    (b) => (sent = b),
  );
  const r = await c.messages.stream(paramsUso, {}).finalMessage();
  assert.deepEqual(sent.stream_options, { include_usage: true });
  assert.deepEqual(sent.provider, { order: ["z-ai"], allow_fallbacks: false });
  assert.deepEqual(sent.usage, { include: true });
  assert.deepEqual(r.usage, {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_tokens: 20,
    cache_write_tokens: null,
    cost_usd: 0.0042,
    generation_id: "gen-abc",
  });
});
test("OpenAI-compatível sem chunk de usage devolve usage null", async () => {
  const c = clienteSse({ provider: "openai", apiKey: "fixture" }, [
    { id: "g1", choices: [{ delta: { content: "oi" }, finish_reason: "stop" }] },
  ]);
  const r = await c.messages.stream(paramsUso, {}).finalMessage();
  assert.equal(r.usage, null);
});
test("Anthropic devolve usage a partir de finalMessage().usage", async () => {
  const { normalizarUso } = require("../servidor/provedores");
  assert.deepEqual(
    normalizarUso(
      "anthropic",
      {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 1,
      },
      "msg_1",
    ),
    {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 3,
      cache_write_tokens: 1,
      cost_usd: null,
      generation_id: "msg_1",
    },
  );
  assert.equal(normalizarUso("anthropic", null, "msg_1"), null);
});
test("Anthropic via SDK: wrapper anexa usage e id da mensagem", async () => {
  const body = [
    ["message_start", { type: "message_start", message: { id: "msg_9", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "oi" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
  const c = criarCliente(
    { provider: "anthropic", apiKey: "fixture" },
    async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
  );
  const r = await c.messages.stream(paramsUso, {}).finalMessage();
  assert.deepEqual(r.usage, {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 3,
    cache_write_tokens: 1,
    cost_usd: null,
    generation_id: "msg_9",
  });
});
test("Gemini devolve usage a partir de usageMetadata", async () => {
  const c = clienteSse({ provider: "gemini", apiKey: "fixture" }, [
    {
      responseId: "gem-1",
      candidates: [{ content: { parts: [{ text: "oi" }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 7,
        cachedContentTokenCount: 4,
      },
    },
  ]);
  const r = await c.messages.stream(paramsUso, {}).finalMessage();
  assert.deepEqual(r.usage, {
    input_tokens: 50,
    output_tokens: 7,
    cache_read_tokens: 4,
    cache_write_tokens: null,
    cost_usd: null,
    generation_id: "gem-1",
  });
});
