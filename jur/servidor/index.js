const http = require('node:http');
const path = require('node:path');
const { criarRoteador } = require('./http');
const db = require('./db');
const jobs = require('./jobs');
const chaves = require('./chaves');
const conversas = require('./conversas');
const autenticacao = require('./autenticacao');

function criarApp(deps = {}) {
  const guarda = autenticacao.criarGuarda({ chaves: deps.chaves, exigir: deps.exigirChave });
  const roteador = criarRoteador({ guarda });
  require('./rotas/tribunais').registrar(roteador);
  require('./rotas/buscas').registrar(roteador, deps);
  require('./rotas/chat').registrar(roteador, deps);
  require('./rotas/chaves').registrar(roteador, deps);
  require('./rotas/conversas').registrar(roteador, deps);
  require('./mcp').registrar(roteador, deps);
  require('./rotas/docs').registrar(roteador, deps);
  roteador.estaticos(path.join(__dirname, '..', 'publico'), '/');
  return roteador;
}

function iniciar() {
  const con = db.abrir();
  const fila = jobs.criarFila({ con });
  const gerenciadorChaves = chaves.criarGerenciador(con);
  const repositorioConversas = conversas.criarRepositorio(con);
  const porta = Number(process.env.PORT || 3000);
  // C2: default de loopback, NAO 0.0.0.0. A guarda (exigirChave abaixo) cobre quem nao
  // tem chave, mas continua levando a chave da Anthropic do operador atras dela
  // (POST /api/v1/chat) — publicado na LAN sem pensar, e mais uma superficie para
  // alguem tentar. Quem QUER expor declara JUR_BIND (ex.: JUR_BIND=0.0.0.0), e ai
  // assume a decisao explicitamente. Ver infra/README.md.
  const endereco = process.env.JUR_BIND || '127.0.0.1';
  // Ligado por padrao: sem isto, qualquer site cross-origin (achado da revisao final)
  // enfileira busca real contra tribunal usando o IP do operador via POST /buscas, e
  // /mcp e /api/v1/chat ficam abertos para qualquer cliente que saiba a porta. Desligar
  // exige a variavel explicitamente — quem faz isso assume a decisao, como o JUR_BIND
  // acima.
  const exigirChave = process.env.JUR_EXIGIR_CHAVE !== '0';
  const servidor = http.createServer(
    criarApp({ fila, chaves: gerenciadorChaves, conversas: repositorioConversas, exigirChave }).handler,
  );
  servidor.listen(porta, endereco, () => {
    console.log(`jur ouvindo em http://${endereco}:${porta} (concorrencia ${fila.concorrencia})`);
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };
