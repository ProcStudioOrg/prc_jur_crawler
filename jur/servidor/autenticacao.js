const { json, bloquearOrigemHostil } = require('./http');

/** Rotas que nunca exigem chave. `saude` fica de fora porque e o healthcheck
 *  do container, que roda de dentro e nao tem como carregar segredo. */
const LIVRES = new Set(['/api/v1/saude']);

/**
 * Local do proprio host. Isolada da regra de origemPermitida (http.js) porque a
 * Barreira 2 abaixo precisa SO disto — deliberadamente mais estrita que
 * origemPermitida, que tambem aceita "mesmo Host" numa LAN exposta via JUR_BIND. Ali a
 * intencao e nao quebrar quem expos o servico de proposito; aqui a intencao e dispensar
 * chave, e esse privilegio e so de quem roda o browser na propria maquina do servidor.
 */
function ehLocal(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** A propria interface: mesma origem que serviu a pagina, rodando localmente. */
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return false;
  let u;
  try { u = new URL(origem); } catch { return false; }
  return u.host === req.headers.host && ehLocal(u.hostname);
}

/**
 * Guarda unica do roteador. Consome chaves.verificar(valor) (Task 2) e centraliza duas
 * checagens que antes viviam espalhadas — a de Origin, duplicada dentro de mcp.js e
 * rotas/chat.js, e a de chave de conexao, que POST /api/v1/buscas simplesmente nao
 * tinha (achado da revisao final: qualquer site cross-origin enfileirava busca real
 * contra tribunal usando o IP do operador). Ter as duas copias da checagem de Origin
 * e exatamente o tipo de divergencia que ja custou uma rodada de revisao neste
 * projeto — dai centralizar aqui e chamar so daqui.
 *
 * Bootstrap das chaves: /api/v1/chaves segue esta MESMA guarda, sem excecao (ruling do
 * coordenador — nao ha rota "so para emitir a primeira chave"). Isso resolve sozinho:
 * a interface local fala com o servidor por mesma-origem (Barreira 2 abaixo), entao a
 * primeira chave e emitida no browser em localhost sem precisar de chave nenhuma. Dai
 * em diante, qualquer chave valida tambem pode emitir outras chaves — aceitavel numa
 * ferramenta local de um usuario so; nao aceitavel se este servico um dia ganhar
 * usuarios multiplos ou sair de localhost.
 */
function criarGuarda(opcoes = {}) {
  const gerenciador = opcoes.chaves;
  const exigir = Boolean(opcoes.exigir);

  return function guarda(req, res, caminho) {
    if (LIVRES.has(caminho)) return false;

    // Barreira 1: origem hostil nunca passa, mesmo com exigirChave desligado — fecha
    // para TODA rota o buraco que antes so mcp.js e rotas/chat.js fechavam cada um por
    // conta propria.
    if (bloquearOrigemHostil(req, res)) return true;

    if (!exigir || !gerenciador) return false;

    // Barreira 2: a propria interface passa sem chave; qualquer outro cliente precisa.
    if (mesmaOrigem(req)) return false;

    const cabecalho = req.headers.authorization || '';
    const valor = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (gerenciador.verificar(valor)) return false;

    json(res, 401, { erro: 'chave de conexao ausente ou invalida — gere uma na interface, em Configuracoes' });
    return true;
  };
}

module.exports = { criarGuarda, ehLocal, mesmaOrigem, LIVRES };
