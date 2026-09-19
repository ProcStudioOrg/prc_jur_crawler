const {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");

function criarCofre(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("JUR_ENCRYPTION_KEY deve conter 32 bytes em base64.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("JUR_ENCRYPTION_KEY inválida.");
  const aadBuffer = (aad) => Buffer.from(JSON.stringify(aad));
  return {
    cifrar(texto, aad) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aadBuffer(aad));
      const data = Buffer.concat([
        cipher.update(texto, "utf8"),
        cipher.final(),
      ]);
      return JSON.stringify({
        v: 1,
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      });
    },
    decifrar(envelope, aad) {
      try {
        const { v, nonce, tag, data } = JSON.parse(envelope);
        if (v !== 1) throw new Error();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(nonce, "base64"),
        );
        decipher.setAAD(aadBuffer(aad));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(data, "base64")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("Credencial indisponível. Substitua a conexão.");
      }
    },
  };
}
module.exports = { criarCofre };
