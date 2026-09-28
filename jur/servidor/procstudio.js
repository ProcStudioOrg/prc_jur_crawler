function criarCliente({ url, issuer, clientId, secret, fetchFn = fetch }) {
  if (!url || !issuer || !clientId || !secret)
    throw new Error("Configure a integração ProcStudio.");
  const base = new URL(url);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error("URL ProcStudio inválida.");
  const indisponivel = () =>
    Object.assign(new Error("ProcStudio indisponível. Tente novamente."), {
      status: 503,
    });
  function principal(p) {
    if (
      !p ||
      p.issuer !== issuer ||
      typeof p.userId !== "string" ||
      !p.userId ||
      typeof p.teamId !== "string" ||
      !p.teamId ||
      !Number.isFinite(p.expiresAt) ||
      p.expiresAt <= Date.now()
    )
      return null;
    return {
      issuer: p.issuer,
      userId: p.userId,
      teamId: p.teamId,
      expiresAt: p.expiresAt,
    };
  }
  async function pedir(action, body) {
    try {
      const r = await fetchFn(
        new URL(`/api/v1/service_access/${action}`, base),
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ ...body, client_id: clientId }),
        },
      );
      if ([400, 401, 403].includes(r.status)) return null;
      if (!r.ok) throw indisponivel();
      return r.status === 204 ? {} : await r.json();
    } catch {
      throw indisponivel();
    }
  }
  return {
    async exchange(code, verifier, redirectUri) {
      const r = await pedir("exchange", {
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      const p = r && principal(r.principal);
      return p && typeof r.session_token === "string"
        ? { token: r.session_token, principal: p }
        : null;
    },
    async introspect(token) {
      const r = await pedir("introspect", { session_token: token });
      return r?.active ? principal(r.principal) : null;
    },
    async revoke(token) {
      await pedir("revoke", { session_token: token });
    },
    async subject(owner) {
      if (owner.issuer !== issuer) return false;
      const r = await pedir("subject", {
        user_id: owner.userId,
        team_id: owner.teamId,
      });
      return r?.active === true;
    },
  };
}
module.exports = { criarCliente };
