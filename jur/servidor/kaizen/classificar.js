// Classe da falha, na ordem em que a evidência é mais confiável. A rota importa:
// 403/reset no navegador local é IP do servidor bloqueado; no remoto, é o fornecedor.
const { FALHA_DO_FORNECEDOR } = require('../navegadores/remotos');

const REMOTO_INDISPONIVEL = /Nenhum navegador remoto disponível|Não foi possível conectar ao navegador remoto|Navegador remoto não configurado/i;
const BLOQUEIO_IP = /HTTP 403|\b403\b|ERR_CONNECTION_(REFUSED|RESET|CLOSED)|ERR_HTTP2_PROTOCOL_ERROR/;
const CAPTCHA = /captcha|turnstile|recaptcha|verificação ainda não foi concluída/i;

function classificar({ erro, rota }) {
  const e = String(erro ?? '');
  if (REMOTO_INDISPONIVEL.test(e) || (rota === 'remoto' && FALHA_DO_FORNECEDOR.test(e))) return 'fornecedor_remoto';
  if (rota !== 'remoto' && BLOQUEIO_IP.test(e)) return 'bloqueio_ip';
  if (CAPTCHA.test(e)) return 'captcha';
  // o timeout do executor precede o seletor: a mensagem dele não é de Playwright
  if (/^timeout apos \d+ms/.test(e)) return 'timeout';
  if (/waiting for (locator|selector)|waitForSelector/i.test(e)) return 'seletor';
  if (/Timeout \d+ms exceeded|TimeoutError/.test(e)) return 'timeout';
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
