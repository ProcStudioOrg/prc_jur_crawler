const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizar, normalizarErro, montarAssinatura } = require('../servidor/kaizen/assinatura');
const { classificar, rotaDoNavegador } = require('../servidor/kaizen/classificar');

test('timeout do Playwright em locator: classe seletor, numeros viram #', () => {
  const erro = "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#resultado')";
  assert.equal(classificar({ erro, rota: 'local' }), 'seletor');
  assert.equal(normalizarErro(erro), "locator.click: timeout #ms exceeded. waiting for locator('#resultado')");
});
test('timeout do executor vence o seletor', () => {
  assert.equal(classificar({ erro: 'timeout apos 600000ms', rota: 'local' }), 'timeout');
});
test('403 na rota local e bloqueio_ip; na remota e fornecedor_remoto', () => {
  assert.equal(classificar({ erro: 'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://web.trf3.jus.br/x', rota: 'local' }), 'bloqueio_ip');
  assert.equal(classificar({ erro: 'HTTP 403', rota: 'remoto' }), 'fornecedor_remoto');
  assert.equal(classificar({ erro: 'Nenhum navegador remoto disponível (Kernel: HTTP 500).', rota: null }), 'fornecedor_remoto');
});
test('captcha da pausa assistida', () => {
  assert.equal(classificar({ erro: 'O prazo para resolver o CAPTCHA expirou. Inicie uma nova busca.', rota: 'remoto' }), 'captcha');
});
test('erro qualquer e desconhecido', () => {
  assert.equal(classificar({ erro: 'Cannot read properties of undefined', rota: 'local' }), 'desconhecido');
});
test('sem acento, sem URL, mesma assinatura para numeros diferentes', () => {
  assert.equal(normalizarErro('Não foi possível conectar ao navegador remoto.'), 'nao foi possivel conectar ao navegador remoto.');
  const a = montarAssinatura({ tribunal: 'trf4', classe: 'seletor', passo: '', erro: 'Timeout 30000ms exceeded' });
  const b = montarAssinatura({ tribunal: 'trf4', classe: 'seletor', passo: '', erro: 'Timeout 45000ms exceeded' });
  assert.equal(a, b);
  assert.equal(a, 'trf4|seletor|desconhecido|timeout #ms exceeded');
  assert.ok(montarAssinatura({ tribunal: 't', classe: 'c', passo: 'p', erro: 'x'.repeat(500) }).length <= 200);
});
test('segredo nunca sobrevive (Review Focus 4)', () => {
  const erro = 'connect wss://connect.steel.dev?apiKey=SEGREDO1&sessionId=abc falhou; Authorization: Bearer SEGREDO2; https://x.br/a?token=SEGREDO3';
  for (const s of [sanitizar(erro), normalizarErro(erro)]) assert.doesNotMatch(s, /SEGREDO/);
  assert.match(sanitizar('https://x.br/a/b?q=1'), /https:\/\/x\.br\/a\/b(?!\?)/);
});
test('rota pelo rotulo do navegador', () => {
  assert.equal(rotaDoNavegador('Servidor ProcStudio'), 'local');
  assert.equal(rotaDoNavegador('Steel (reserva)'), 'remoto');
  assert.equal(rotaDoNavegador(null), null);
});
