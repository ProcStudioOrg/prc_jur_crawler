const { json, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const g = deps.chaves;
  if (!g) return;

  roteador.rota('POST', '/api/v1/chaves', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    const nome = typeof corpo.nome === 'string' && corpo.nome.trim() ? corpo.nome.trim().slice(0, 80) : 'sem nome';
    const c = g.gerar(nome);
    // Unica vez em que `valor` sai do servidor.
    json(res, 201, { ...c, aviso: 'guarde este valor agora — ele nao sera exibido de novo' });
  });

  roteador.rota('GET', '/api/v1/chaves', (req, res) => {
    json(res, 200, { chaves: g.listar() });
  });

  roteador.rota('DELETE', '/api/v1/chaves/:id', (req, res) => {
    if (!g.revogar(req.params.id)) return json(res, 404, { erro: 'chave nao encontrada ou ja revogada' });
    json(res, 200, { id: req.params.id, revogada: true });
  });
}

module.exports = { registrar };
