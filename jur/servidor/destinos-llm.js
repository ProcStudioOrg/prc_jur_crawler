const dns = require("node:dns/promises");
const net = require("node:net");
const https = require("node:https");
const { Readable } = require("node:stream");
function publico(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return (
      /^[23][0-9a-f]{0,3}:/.test(s) &&
      !s.startsWith("2001:db8:") &&
      !s.startsWith("2001:0:") &&
      !s.startsWith("2002:")
    );
  }
  return false;
}
async function validarDestino(value, { lookup = dns.lookup } = {}) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Use um endpoint HTTPS público, sem credenciais na URL.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (!records.length || records.some((r) => !publico(r.address)))
    throw new Error("Endpoint privado ou reservado não permitido.");
  return { url, ...records[0] };
}
async function requisitar(value, options = {}) {
  if (value instanceof Request) {
    options = {
      method: value.method,
      headers: Object.fromEntries(value.headers),
      signal: value.signal,
      ...options,
      body:
        options.body ??
        (value.method === "GET" || value.method === "HEAD"
          ? undefined
          : await value.text()),
    };
    value = value.url;
  }
  const { url, address, family } = await validarDestino(value);
  const requestHeaders = Object.fromEntries(new Headers(options.headers));
  requestHeaders["accept-encoding"] = "identity";
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: options.method || "GET",
        headers: requestHeaders,
        signal: options.signal,
        lookup: (_host, opts, cb) =>
          opts.all
            ? cb(null, [{ address, family }])
            : cb(null, address, family),
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          reject(new Error("Redirecionamento de provedor não permitido."));
          return;
        }
        try {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined)
              headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          const noBody =
            [204, 205, 304].includes(res.statusCode) ||
            options.method === "HEAD";
          if (noBody) res.resume();
          resolve(
            new Response(noBody ? null : Readable.toWeb(res), {
              status: res.statusCode,
              headers,
            }),
          );
        } catch (error) {
          res.resume();
          reject(error);
        }
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Tempo limite do provedor.")),
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
module.exports = { publico, validarDestino, requisitar };
