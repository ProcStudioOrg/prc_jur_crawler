const { json, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const repo = deps.conversas;
  if (!repo) return;

  roteador.rota('POST', '/api/v1/conversas', async (req, res) => {
    try { await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    json(res, 201, repo.criar());
  });

  roteador.rota('GET', '/api/v1/conversas', (req, res) => {
    json(res, 200, { conversas: repo.listar(Number(req.query.limite) || 100) });
  });

  roteador.rota('GET', '/api/v1/conversas/:id', (req, res) => {
    // obter() busca direto por PK — nao varre nem fica cego para uma conversa fora
    // das N mais recentes, ao contrario de listar(N).find(...).
    const conversa = repo.obter(req.params.id);
    if (!conversa) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { ...conversa, mensagens: repo.mensagens(req.params.id) });
  });

  roteador.rota('DELETE', '/api/v1/conversas/:id', (req, res) => {
    if (!repo.apagar(req.params.id)) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { id: req.params.id, apagada: true });
  });
}

module.exports = { registrar };
