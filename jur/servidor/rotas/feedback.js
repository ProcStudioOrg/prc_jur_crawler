const { json, lerCorpo } = require('../http');
const feedbackPadrao = require('../feedback');

/**
 * As duas rotas do reporter embutido (o botao "Reportar" na borda da tela):
 *
 *   GET  /api/v1/feedback/meta  -> o widget se configura sozinho (nunca traz a chave)
 *   POST /api/v1/feedback       -> cria o card no Linear e devolve identifier + url
 *
 * Ambas ficam sob /api/v1/, entao a aplicacao (servidor/aplicacao.js) ja exige sessao
 * ProcStudio ou Bearer antes de chegar aqui — nao ha autenticacao propria. O principal
 * autenticado chega em req.principal (producao) ou em deps.conta (roteador interno de
 * testes), e e ele que assina o card; o corpo do browser nunca diz quem e.
 */
function registrar(roteador, deps = {}) {
  const feedback = deps.feedback || feedbackPadrao.criarFeedback({
    revisao: require('../aviso-deploy').revisaoDaImagem(process.env.JUR_IMAGE),
  });

  roteador.rota('GET', '/api/v1/feedback/meta', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    json(res, 200, await feedback.meta());
  });

  roteador.rota('POST', '/api/v1/feedback', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { error: e.message, erro: e.message }); }
    const principal = req.principal || deps.conta || null;
    try {
      const r = await feedback.enviar(principal, corpo);
      return json(res, 200, r);
    } catch (e) {
      if (e instanceof feedbackPadrao.ErroEnvio) {
        if (e.retryAfter) res.setHeader('retry-after', String(e.retryAfter));
        // `error` e o que o widget le; `erro` e a convencao do resto da API.
        return json(res, e.status, { error: e.message, erro: e.message });
      }
      if (e instanceof feedbackPadrao.ErroLinear) {
        // 502, nao 500: a falha e do outro lado. O detalhe fica no log; o usuario
        // recebe uma mensagem generica e o widget preserva o rascunho.
        console.error('[feedback] Linear:', e.message);
        const msg = 'Não conseguimos registrar agora. Tente de novo em alguns minutos.';
        return json(res, 502, { error: msg, erro: msg });
      }
      throw e;
    }
  });
}

module.exports = { registrar };
