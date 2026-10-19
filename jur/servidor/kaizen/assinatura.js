// Assinatura estável de uma falha: o mesmo defeito, com números/ids/URLs diferentes,
// tem que cair na mesma assinatura para o FFD agrupar. Módulo puro, sem I/O.

// Nome de chave que carrega segredo (com prefixo livre: x-api-key, access_token, Proxy-Authorization).
const CHAVE = '[\\w-]*(?:token|key|secret|senha|password|passwd|cookie|authorization|auth|session_?id|session|signature|sig)';
// Valor: string entre aspas, esquema+credencial (Bearer x) ou palavra solta até , ; } & ou espaço.
const VALOR = '"[^"]*"|\'[^\']*\'|(?:Bearer|Basic|Token)\\s+[^\\s,;}&]+|[^\\s,;}&"\']+';
const CHAVE_VALOR = new RegExp(`(["']?)(${CHAVE})\\1(\\s*[:=]\\s*)(?:${VALOR})`, 'gi');
// Cabeçalho Cookie: só a corrida de pares nome=valor; texto depois dela fica intacto.
const PAR = '[\\w.%-]+=[^;\\s]*';
const COOKIE = new RegExp(`(cookie\\s*:\\s*)${PAR}(?:;\\s*${PAR})*`, 'gi');

// Segredo nunca sai: URL de CDP (carrega o token do fornecedor), cookies, chaves em
// JSON/cabeçalho/query/atribuição e Bearer são removidos antes de qualquer outra coisa.
function sanitizar(texto) {
  return String(texto ?? '')
    .replace(/wss?:\/\/\S+/gi, '[cdp]')
    .replace(COOKIE, '$1[redigido]')
    .replace(CHAVE_VALOR, '$1$2$1$3[redigido]')
    .replace(/Bearer\s+(?!\[redigido\])\S+/gi, 'Bearer [redigido]')
    // query some da URL: pode carregar dado de processo ou credencial que escapou acima
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1');
}

const LINHA_ESPERA = /^\s*-?\s*(waiting for .*)$/im;

function normalizarErro(texto) {
  const limpo = sanitizar(texto);
  const primeira = limpo.split('\n')[0].trim();
  // o call log do Playwright diz *qual* seletor falhou; a 1ª linha só diz que estourou
  const espera = (limpo.split('\n').slice(1).join('\n').match(LINHA_ESPERA) || [])[1];
  return [primeira, espera && espera.trim()].filter(Boolean).join(' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function montarAssinatura({ tribunal, classe, passo, erro }) {
  return `${tribunal || 'desconhecido'}|${classe || 'desconhecido'}|${passo || 'desconhecido'}|${normalizarErro(erro)}`.slice(0, 200);
}

module.exports = { sanitizar, normalizarErro, montarAssinatura };
