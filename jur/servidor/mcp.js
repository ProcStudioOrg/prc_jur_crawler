const ferramentas = require('./ferramentas');
const { json, lerCorpo } = require('./http');

// Fixo de proposito (decisao consciente, nao descuido): nao negociamos com o
// protocolVersion que o cliente propoe em `initialize`. So os quatro metodos deste
// arquivo sao suportados, entao nao ha comportamento condicional por versao para
// negociar — anunciar sempre a mesma versao testada evita um cliente mais novo/velho
// assumir uma capacidade que este servidor nao tem.
const PROTOCOLO = '2025-06-18';

function registrar(roteador, deps) {
  roteador.rota('POST', '/mcp', async (req, res) => {
    // C2: a checagem de Origin que vivia aqui (antes de ler o corpo — sem ela uma
    // pagina qualquer que o usuario visite dirigia a superficie MCP inteira do browser
    // dele) agora e responsabilidade da guarda unica do roteador — ver
    // servidor/autenticacao.js. Ela roda antes desta rota ser encontrada.

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
      // executarDetalhado (nao executar) porque isError precisa refletir se a
      // ferramenta EXECUTOU, nao so se o nome bate com uma tool conhecida — ver o
      // comentario da fronteira ok/isError em servidor/ferramentas.js.
      const { texto, ok } = await ferramentas.executarDetalhado(nome, (params && params.arguments) || {}, deps);
      return responder({
        content: [{ type: 'text', text: texto }],
        isError: !ok,
      });
    }

    return falhar(-32601, `metodo nao suportado: ${method}`);
  });
}

module.exports = { registrar };
