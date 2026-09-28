const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarDestino, publico } = require("../servidor/destinos-llm");
test("recusa destinos privados, credenciais e protocolos antes de enviar uma chave", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(publico(ip), false, ip);
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/#x",
    "https://127.0.0.1",
  ])
    await assert.rejects(validarDestino(url));
  await assert.rejects(
    validarDestino("https://api.example", {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }),
  );
  const dest = await validarDestino("https://api.example/v1", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
  });
  assert.equal(dest.address, "8.8.8.8");
});

test("resposta HTTP sem corpo do provedor não derruba o processo", () => {
  const { spawnSync } = require("node:child_process");
  const script = `
 const https=require('node:https');const {Readable}=require('node:stream');const {EventEmitter}=require('node:events');
 https.request=(_url,_opts,callback)=>{const req=new EventEmitter();req.end=()=>setImmediate(()=>{const res=Readable.from([]);res.statusCode=204;res.headers={};callback(res);});return req;};
 require(${JSON.stringify(require.resolve("../servidor/destinos-llm"))}).requisitar('https://8.8.8.8/models').then(r=>{if(r.status!==204)process.exitCode=2;},()=>{});
 `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("normaliza Headers de fetch usados pelo SDK Anthropic para o transporte Node", async () => {
  const https = require("node:https");
  const { Readable } = require("node:stream");
  const { EventEmitter } = require("node:events");
  const original = https.request;
  let sent;
  https.request = (_url, options, callback) => {
    sent = options.headers;
    const req = new EventEmitter();
    req.end = () =>
      setImmediate(() => {
        const res = Readable.from([Buffer.from("{}")]);
        res.statusCode = 200;
        res.headers = {};
        callback(res);
      });
    return req;
  };
  try {
    const { requisitar } = require("../servidor/destinos-llm");
    const response = await requisitar("https://8.8.8.8/messages", {
      headers: new Headers({
        "x-api-key": "fixture-key",
        "content-type": "application/json",
      }),
    });
    await response.text();
    assert.equal(sent["x-api-key"], "fixture-key");
    assert.equal(sent["content-type"], "application/json");
  } finally {
    https.request = original;
  }
});
