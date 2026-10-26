const { json } = require("../http");

const MSG_INDISPONIVEL = "Não foi possível consultar o saldo de IA do ProcStudio agora. Tente novamente em instantes.";
const MSG_PENDENTE = "Há uma cobrança desta conta ainda não registrada no ProcStudio. Ela é reenviada automaticamente.";

function registrar(roteador, deps) {
  roteador.rota("GET", "/api/v1/saldo", async (req, res) => {
    // Sem conexão gerenciada (PROCSTUDIO_LLM_API_KEY vazia) não há saldo a mostrar.
    if (!deps.cobranca) return json(res, 200, { disponivel: false });
    let b;
    try {
      b = await deps.cobranca.saldo({ forcar: req.query?.forcar === "1" });
    } catch {
      return json(res, 503, { disponivel: true, erro: MSG_INDISPONIVEL });
    }
    // Conta sem acesso à IA no Rails: o bloqueio é do chat também, então não inventa saldo.
    if (b?.ativo !== true) return json(res, 503, { disponivel: true, erro: MSG_INDISPONIVEL });
    const pendente = deps.cobranca.pendentes() > 0;
    const base = deps.frontendUrl ? String(deps.frontendUrl).replace(/\/$/, "") : "";
    return json(res, 200, {
      disponivel: true,
      saldoBrl: b.saldoBrl,
      // Com recibo pendente o chat recusa (409), então a tela não pode dizer que opera.
      podeOperar: b.podeOperar === true && !pendente,
      mensagem: pendente ? MSG_PENDENTE : b.mensagem,
      topupUrl: base && b.topupPath ? base + b.topupPath : null,
      modelo: {
        rotulo: deps.conexoes?.obter("procstudio")?.rotulo ?? b.modelo?.nome ?? null,
        entradaPor1MBrl: b.modelo?.entradaPor1MBrl ?? null,
        saidaPor1MBrl: b.modelo?.saidaPor1MBrl ?? null,
      },
    });
  });
}
module.exports = { registrar };
