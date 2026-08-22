const http = require('node:http');
const path = require('node:path');
const { criarRoteador } = require('./http');
const db = require('./db');
const jobs = require('./jobs');
const chaves = require('./chaves');

function criarApp(deps = {}) {
  const roteador = criarRoteador();
  require('./rotas/tribunais').registrar(roteador);
  require('./rotas/buscas').registrar(roteador, deps);
  require('./rotas/chat').registrar(roteador, deps);
  require('./rotas/chaves').registrar(roteador, deps);
  require('./mcp').registrar(roteador, deps);
  roteador.estaticos(path.join(__dirname, '..', 'publico'), '/');
  return roteador;
}

function iniciar() {
  const con = db.abrir();
  const fila = jobs.criarFila({ con });
  const gerenciadorChaves = chaves.criarGerenciador(con);
  const porta = Number(process.env.PORT || 3000);
  // C2: default de loopback, NAO 0.0.0.0. Este servico nao tem autenticacao e leva a
  // chave da Anthropic do operador atras dele (POST /api/v1/chat) — publicado na LAN,
  // qualquer um da rede enfileira jobs contra tribunais com o IP do operador, le o
  // acervo de resultados e gasta o dinheiro dele. Quem QUER expor declara JUR_BIND
  // (ex.: JUR_BIND=0.0.0.0), e ai assume a decisao explicitamente. Ver infra/README.md.
  const endereco = process.env.JUR_BIND || '127.0.0.1';
  const servidor = http.createServer(criarApp({ fila, chaves: gerenciadorChaves }).handler);
  servidor.listen(porta, endereco, () => {
    console.log(`jur ouvindo em http://${endereco}:${porta} (concorrencia ${fila.concorrencia})`);
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };
