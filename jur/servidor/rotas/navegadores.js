const { json, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const tratar = (fn) => async (req, res) => {
    if (!deps.navegadores || !deps.pool) return json(res, 503, { erro: 'Acompanhamento não configurado.' });
    try { return await fn(req, res); }
    catch (e) { return json(res, [400, 404, 409, 429, 504].includes(e.status) ? e.status : 400, { erro: e.message }); }
  };
  roteador.rota('GET', '/api/v1/navegadores', tratar((req, res) => json(res, 200, {
    ...deps.pool.estado(), preferencias: deps.navegadores.preferencias(), provedores: deps.navegadores.provedores,
    sessoes: deps.navegadores.listar(deps.pool),
  })));
  roteador.rota('POST', '/api/v1/navegadores/preferencias', tratar(async (req, res) => {
    const body = await lerCorpo(req);
    json(res, 200, deps.navegadores.salvar(body));
  }));
  const operar = (tipo) => tratar(async (req, res) => {
      // Resolver o job no banco DA CONTA, antes de qualquer operação sobre a sessão.
      if (!deps.fila.obter(req.params.id)) return json(res, 404, { erro: 'Sessão não encontrada.' });
      const acao = tipo === 'acao' ? await lerCorpo(req) : undefined;
      res.setHeader('cache-control', 'no-store');
      json(res, 200, await deps.navegadores.requisitar(req.params.id, tipo, acao));
    });
  roteador.rota('GET', '/api/v1/navegadores/:id/tela', operar('tela'));
  roteador.rota('POST', '/api/v1/navegadores/:id/acao', operar('acao'));
}
module.exports = { registrar };
