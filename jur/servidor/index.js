const http = require('node:http');
const path = require('node:path');
const { criarRoteador } = require('./http');
const turnos = require('./turnos');
const autenticacao = require('./autenticacao');

function criarApp(deps = {}) {
  // Registro dos turnos vivos. Fica por app (nao global) para cada servidor de teste ter
  // o seu. Criado aqui, e nao em iniciar(), para as rotas de chat/conversas terem acesso
  // mesmo quando o app e montado direto — que e como todo teste o monta.
  const deps2 = { ...deps, turnos: deps.turnos || turnos.criarRegistro() };
  deps = deps2;
  const guarda = autenticacao.criarGuarda({ chaves: deps.chaves, exigir: deps.exigirChave });
  const roteador = criarRoteador({ guarda });
  require('./rotas/tribunais').registrar(roteador);
  require('./rotas/buscas').registrar(roteador, deps);
  require('./rotas/chat').registrar(roteador, deps);
  require('./rotas/chaves').registrar(roteador, deps);
  require('./rotas/conexoes-llm').registrar(roteador, deps);
  require('./rotas/conversas').registrar(roteador, deps);
  require('./mcp').registrar(roteador, deps);
  require('./rotas/docs').registrar(roteador, deps);
  roteador.estaticos(path.join(__dirname, '..', 'publico'), '/');
  return roteador;
}

function iniciar() {
  const { criarCliente } = require('./procstudio');
  const { criarAplicacao } = require('./aplicacao');
  const app = criarAplicacao({
    dir: process.env.JUR_DADOS || '/dados', cofreKey: process.env.JUR_ENCRYPTION_KEY,
    publicUrl: process.env.JUR_PUBLIC_URL, frontendUrl: process.env.PROCSTUDIO_FRONTEND_URL,
    clientId: process.env.PROCSTUDIO_CLIENT_ID,
    procstudio: criarCliente({ url: process.env.PROCSTUDIO_API_URL,
      issuer: process.env.PROCSTUDIO_ISSUER, clientId: process.env.PROCSTUDIO_CLIENT_ID,
      secret: process.env.PROCSTUDIO_CLIENT_SECRET }),
  });
  const servidor = http.createServer(app.handler);
  servidor.listen(Number(process.env.PORT || 3000), process.env.JUR_BIND || '127.0.0.1');
  return servidor;
}

module.exports = { criarApp, iniciar };

if (require.main === module) iniciar();
