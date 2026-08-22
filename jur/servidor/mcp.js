const ferramentas = require('./ferramentas');
const { json, lerCorpo } = require('./http');

const PROTOCOLO = '2025-06-18';

function registrar(roteador, deps) {
  roteador.rota('POST', '/mcp', async (req, res) => {
    let pedido;
    try {
      pedido = await lerCorpo(req);
    } catch (e) {
      return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } });
    }

    const { id, method, params } = pedido;
    const ehNotificacao = id === undefined || id === null;

    const responder = (resultado) => {
      if (ehNotificacao) { res.writeHead(202); return res.end(); }
      return json(res, 200, { jsonrpc: '2.0', id, result: resultado });
    };
    const falhar = (code, message) => {
      if (ehNotificacao) { res.writeHead(202); return res.end(); }
      return json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
    };

    if (method === 'initialize') {
      return responder({
        protocolVersion: PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: 'jur', version: require('../package.json').version },
      });
    }

    if (method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }

    if (method === 'tools/list') {
      return responder({
        tools: ferramentas.definicoes().map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: d.input_schema,
        })),
      });
    }

    if (method === 'tools/call') {
      const nome = params && params.name;
      const conhecidas = new Set(ferramentas.definicoes().map((d) => d.name));
      const texto = await ferramentas.executar(nome, (params && params.arguments) || {}, deps);
      return responder({
        content: [{ type: 'text', text: texto }],
        isError: !conhecidas.has(nome),
      });
    }

    return falhar(-32601, `metodo nao suportado: ${method}`);
  });
}

module.exports = { registrar };
