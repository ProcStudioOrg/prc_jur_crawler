// Classe da falha, na ordem em que a evidência é mais confiável. A rota importa:
// 403/reset no navegador local é IP do servidor bloqueado; no remoto, é o fornecedor.
const { FALHA_DO_FORNECEDOR } = require('../navegadores/remotos');

const REMOTO_INDISPONIVEL = /Nenhum navegador remoto disponível|Não foi possível conectar ao navegador remoto|Navegador remoto não configurado/i;
const BLOQUEIO_IP = /HTTP 403|\b403\b|ERR_CONNECTION_(REFUSED|RESET|CLOSED)|ERR_HTTP2_PROTOCOL_ERROR/;
const CAPTCHA = /captcha|turnstile|recaptcha|verificação ainda não foi concluída/i;
// Timeout do executor: "timeout apos 600000ms", sempre no começo da mensagem, e é ele que
// precede o seletor.
const TIMEOUT_DO_EXECUTOR = /^timeout ap[oó]s \d+\s*ms/i;
// Timeout de qualquer outra origem: Playwright ("Timeout 30000ms exceeded", "TimeoutError") e
// cada Navigator com sua redação — "Timeout após 60000ms: <url>" (CARF, STF,
// TJCE), "timeout em /search/varios_parametros/" (TJRO), "timeout falando com o graphql do TJBA",
// "timeout de 30000ms em /jurisprudences/search" (TJPI). Reconhecer a palavra basta e é o que
// importa: só a classe 'timeout' recebe retentativa e alimenta o disjuntor da sentinela; em
// 'desconhecido' a falha passa direto. Vem depois da regra de seletor, senão rouba o call log do
// Playwright, que diz mais (qual seletor faltou) do que o estouro em si.
const TIMEOUT_DE_NAVEGADOR = /\btimeouts?\b/i;

function classificar({ erro, rota }) {
  const e = String(erro ?? '');
  if (REMOTO_INDISPONIVEL.test(e) || (rota === 'remoto' && FALHA_DO_FORNECEDOR.test(e))) return 'fornecedor_remoto';
  if (rota !== 'remoto' && BLOQUEIO_IP.test(e)) return 'bloqueio_ip';
  if (CAPTCHA.test(e)) return 'captcha';
  // o timeout do executor precede o seletor: a mensagem dele não é de Playwright
  if (TIMEOUT_DO_EXECUTOR.test(e)) return 'timeout';
  if (/waiting for (locator|selector)|waitForSelector/i.test(e)) return 'seletor';
  if (TIMEOUT_DE_NAVEGADOR.test(e)) return 'timeout';
  return 'desconhecido';
}

// Rótulo mostrado no painel (remotos.rotulo) -> rota usada na classificação.
function rotaDoNavegador(rotulo) {
  if (!rotulo) return null;
  if (/^Servidor ProcStudio/i.test(rotulo)) return 'local';
  if (/^(Kernel|Steel|Browserbase)\b/i.test(rotulo)) return 'remoto';
  return null;
}

module.exports = { classificar, rotaDoNavegador };
