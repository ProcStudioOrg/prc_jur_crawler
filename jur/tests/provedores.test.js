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
  const c = criarCliente(
    { provider: "openai", apiKey: "fixture" },
    async () =>
      new Response(event({ choices: [{ delta: { content: "parcial" } }] })),
  );
  await assert.rejects(
    c.messages
      .stream({ model: "x", system: "", messages: [], tools: [] }, {})
      .finalMessage(),
    /interrompida/,
  );
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
