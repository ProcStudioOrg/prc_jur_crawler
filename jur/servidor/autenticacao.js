const { json, bloquearOrigemHostil } = require('./http');

/** Rotas que nunca exigem chave. `saude` fica de fora porque e o healthcheck
 *  do container, que roda de dentro e nao tem como carregar segredo. */
const LIVRES = new Set(['/api/v1/saude']);

/**
 * O sinal de "isto e a nossa propria interface" NAO pode ser `Origin` — achado da
 * revisao (bloqueante, confirmado com Chromium real): o browser SO manda `Origin` em
 * POST/PUT/DELETE e em requisicao cross-origin. Um `GET /` de navegacao (a pagina
 * carregando) e um `fetch('/api/v1/tribunais')` que a propria pagina dispara (GET,
 * mesma origem) NUNCA levam `Origin` — usar `Origin` aqui trancava a interface do lado
 * de fora dela mesma (401 na propria pagina, com exigirChave ligado, que e o padrao).
 *
 * O sinal certo e `Sec-Fetch-Site`, um Fetch Metadata Request Header que todo browser
 * moderno manda em TODA requisicao que ele origina — navegacao GET incluida — e que
 * cliente nao-browser (curl, script, cliente MCP nativo) nao manda:
 *   - "none": navegacao digitada na barra de enderecos / favorito / primeira carga.
 *   - "same-origin": e exatamente o que a propria pagina dispara (fetch, XHR) contra o
 *     mesmo host — o caso que precisa passar sem chave.
 *   - "same-site" / "cross-site": a requisicao partiu de outro lugar (outro site, ou
 *     outro subdominio do mesmo site) — nao e a nossa interface, recusa.
 *   - ausente: nenhum browser manda `Sec-Fetch-Site`; e um cliente que nao e browser,
 *     entao a regra normal se aplica — exige `Authorization: Bearer`.
 */
function ehProprioFrontend(req) {
  const sfs = req.headers['sec-fetch-site'];
  return sfs === 'same-origin' || sfs === 'none';
}

function ehOutroSite(req) {
  const sfs = req.headers['sec-fetch-site'];
  return sfs === 'same-site' || sfs === 'cross-site';
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
 * a interface local fala com o servidor como "propria interface" (Barreira 2 abaixo),
 * entao a primeira chave e emitida no browser em localhost sem precisar de chave
 * nenhuma. Dai em diante, qualquer chave valida tambem pode emitir outras chaves —
 * aceitavel numa ferramenta local de um usuario so; nao aceitavel se este servico um
 * dia ganhar usuarios multiplos ou sair de localhost.
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
    // Ver ehProprioFrontend acima para o porque de usar Sec-Fetch-Site e nao Origin.
    if (ehProprioFrontend(req)) return false;
    if (ehOutroSite(req)) {
      json(res, 403, { erro: 'origem nao permitida' });
      return true;
    }

    const cabecalho = req.headers.authorization || '';
    const valor = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (gerenciador.verificar(valor)) return false;

    json(res, 401, { erro: 'chave de conexao ausente ou invalida — gere uma na interface, em Configuracoes' });
    return true;
  };
}

module.exports = { criarGuarda, ehProprioFrontend, ehOutroSite, LIVRES };
