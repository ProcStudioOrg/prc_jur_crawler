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
  async function pedir(action, body, { bruto = false } = {}) {
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
      if (bruto) {
        const corpo = await r.json().catch(() => null);
        return { status: r.status, body: corpo };
      }
      if ([400, 401, 403].includes(r.status)) return null;
      if (!r.ok) throw indisponivel();
      return r.status === 204 ? {} : await r.json();
    } catch {
      throw indisponivel();
    }
  }
  const erro = (status, code, message) =>
    Object.assign(new Error(message), { status, code });
  const semPrecoOuIndisponivel = (r) =>
    r.status === 503 && r.body?.error === "pricing_unavailable"
      ? erro(503, "PRICING_UNAVAILABLE", "Preço do modelo indisponível.")
      : indisponivel();
  function exigirEmissor(p) {
    if (!p || p.issuer !== issuer)
      throw erro(401, "SERVICE_AUTH", "Emissor ProcStudio não reconhecido.");
  }
  return {
    async saldo(p) {
      exigirEmissor(p);
      const r = await pedir(
        "ai_balance",
        { user_id: p.userId, team_id: p.teamId },
        { bruto: true },
      );
      // Credencial de serviço recusada é erro de operação (o operador é avisado com classe
      // própria), nunca "usuário inativo": esse vem 200 com `active: false`.
      if (r.status === 401)
        throw erro(401, "SERVICE_AUTH", "Credencial de serviço recusada.");
      if (r.status !== 200 || !r.body) throw semPrecoOuIndisponivel(r);
      const b = r.body;
      if (b.active !== true) return { ativo: false };
      return {
        ativo: true,
        podeOperar: b.can_operate === true,
        saldoCents: b.balance_cents,
        saldoBrl: b.balance_brl,
        limiteNegativoCents: b.negative_limit_cents,
        mensagem: b.message,
        topupPath: b.topup_path,
        modelo: {
          modelId: b.model?.model_id,
          nome: b.model?.name,
          entradaPor1MBrl: b.model?.input_per_1m_brl,
          saidaPor1MBrl: b.model?.output_per_1m_brl,
        },
      };
    },
    async registrarUso(p, u) {
      exigirEmissor(p);
      const r = await pedir(
        "ai_usage",
        {
          user_id: p.userId,
          team_id: p.teamId,
          request_id: u.requestId,
          model_id: u.modelId,
          input_tokens: u.inputTokens,
          output_tokens: u.outputTokens,
          cache_read_tokens: u.cacheReadTokens,
          cache_write_tokens: u.cacheWriteTokens,
          provider: u.provider,
          provider_model: u.providerModel,
          provider_cost_usd: u.providerCostUsd,
          provider_generation_id: u.providerGenerationId,
          conversation_id: u.conversationId,
        },
        { bruto: true },
      );
      if (r.status === 200 && r.body)
        return {
          cobradoCents: r.body.billed_cents,
          cobradoBrl: r.body.billed_brl,
          saldoCents: r.body.balance_cents,
          saldoBrl: r.body.balance_brl,
          podeOperar: r.body.can_operate === true,
          duplicado: r.body.duplicate === true,
        };
      if (r.status === 410)
        throw erro(410, "USER_GONE", "Usuário não existe mais no ProcStudio.");
      if (r.status === 422)
        throw erro(422, "INVALID_USAGE", "Uso de IA inválido.");
      if (r.status === 401)
        throw erro(401, "SERVICE_AUTH", "Credencial de serviço recusada.");
      if (r.status === 403 || r.status === 404)
        throw erro(r.status, "TEAM_REJECTED", "Equipe não pode ser cobrada.");
      throw semPrecoOuIndisponivel(r);
    },
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
