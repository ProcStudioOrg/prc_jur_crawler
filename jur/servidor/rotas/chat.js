const { sse, lerCorpo, json } = require('../http');
const llm = require('../llm');

function registrar(roteador, deps) {
  roteador.rota('POST', '/api/v1/chat', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const mensagens = Array.isArray(corpo.mensagens) ? corpo.mensagens : null;
    if (!mensagens || !mensagens.length) return json(res, 400, { erro: 'campo obrigatorio: mensagens' });

    // A chave nunca e persistida: vem do header (localStorage do browser) ou do ambiente.
    const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(res, 401, { erro: 'sem chave da Anthropic: defina ANTHROPIC_API_KEY ou informe na interface' });

    const canal = sse(res);
    try {
      const r = await llm.conversar({
        mensagens,
        apiKey,
        deps,
        aoTexto: (t) => canal.enviar('texto', { texto: t }),
        aoFerramenta: (nome, entrada) => canal.enviar('ferramenta', { nome, entrada }),
      });
      canal.enviar('fim', { texto: r.texto });
    } catch (e) {
      canal.enviar('erro', { erro: e.message, tipo: e.constructor ? e.constructor.name : 'Error' });
    } finally {
      canal.fechar();
    }
  });
}

module.exports = { registrar };
