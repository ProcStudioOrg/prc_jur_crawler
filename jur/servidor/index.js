const http = require('node:http');
const path = require('node:path');
const { criarRoteador } = require('./http');
const db = require('./db');
const jobs = require('./jobs');

function criarApp(deps = {}) {
  const roteador = criarRoteador();
  require('./rotas/tribunais').registrar(roteador);
  require('./rotas/buscas').registrar(roteador, deps);
  require('./rotas/chat').registrar(roteador, deps);
  require('./mcp').registrar(roteador, deps);
  roteador.estaticos(path.join(__dirname, '..', 'publico'), '/');
  return roteador;
}

function iniciar() {
  const fila = jobs.criarFila({ con: db.abrir() });
  const porta = Number(process.env.PORT || 3000);
  const servidor = http.createServer(criarApp({ fila }).handler);
  servidor.listen(porta, () => {
    console.log(`jur ouvindo em http://localhost:${porta} (concorrencia ${fila.concorrencia})`);
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };
