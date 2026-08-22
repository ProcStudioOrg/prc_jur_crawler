const catalogo = require('../catalogo');
const { json } = require('../http');

function registrar(roteador) {
  roteador.rota('GET', '/api/v1/saude', (req, res) => {
    json(res, 200, { ok: true, versao: require('../../package.json').version });
  });

  roteador.rota('GET', '/api/v1/tribunais', (req, res) => {
    const { segmento, uf, estado } = req.query;
    json(res, 200, { tribunais: catalogo.listar({ segmento, uf, estado }) });
  });
}

module.exports = { registrar };
