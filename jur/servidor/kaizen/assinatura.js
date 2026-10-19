// Assinatura estável de uma falha: o mesmo defeito, com números/ids/URLs diferentes,
// tem que cair na mesma assinatura para o FFD agrupar. Módulo puro, sem I/O.

// Segredo nunca sai: URL de CDP (carrega o token do fornecedor), chaves em
// query/atribuição e Bearer são removidos antes de qualquer outra coisa.
function sanitizar(texto) {
  return String(texto ?? '')
    .replace(/wss?:\/\/\S+/gi, '[cdp]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redigido]')
    .replace(/(api[-_]?key|apikey|token|session_?id|senha|password)=[^\s&]*/gi, '[redigido]')
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
  return `${tribunal}|${classe}|${passo || 'desconhecido'}|${normalizarErro(erro)}`.slice(0, 200);
}

module.exports = { sanitizar, normalizarErro, montarAssinatura };
