const { json, bloquearOrigemHostil } = require('./http');

const PUBLICOS = new Set([
  '/api/v1/saude',
  '/api/v1/openapi.json',
  '/docs',
]);

function ehRotaProtegida(caminho) {
  if (PUBLICOS.has(caminho)) return false;
  return caminho === '/mcp' || caminho.startsWith('/api/v1/');
}

function criarGuarda(opcoes = {}) {
  const gerenciador = opcoes.chaves;
  const exigir = Boolean(opcoes.exigir);

  return function guarda(req, res, caminho) {
    if (bloquearOrigemHostil(req, res)) return true;
    if (!exigir || !gerenciador || !ehRotaProtegida(caminho)) return false;

    const cabecalho = req.headers.authorization || '';
    const valor = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (gerenciador.verificar(valor)) return false;

    json(res, 401, {
      erro: 'chave de conexao ausente ou invalida — salve uma chave valida em Configuracoes',
    });
    return true;
  };
}

module.exports = { criarGuarda, ehRotaProtegida, PUBLICOS };
