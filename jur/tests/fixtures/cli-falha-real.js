// jur/tests/fixtures/cli-falha-real.js
// CLI de teste com Chromium REAL: abre a pagina local de FIXTURE_URL, espera um seletor que nao
// existe e sai com 1 deixando o browser aberto, como um crawler cujo site mudou. Quem captura
// print/HTML e o preload (--require), exatamente como em producao.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.env.FIXTURE_URL);
  try {
    await page.waitForSelector('#resultado-que-sumiu', { timeout: 1500 });
  } catch (e) {
    // O erro leva um Bearer de proposito: nada disso pode chegar ao FFD.
    process.stdout.write(JSON.stringify({
      success: false, error: `Timeout esperando o seletor #resultado-que-sumiu (Authorization: Bearer SEGREDO-DO-TESTE-123)`,
    }) + '\n');
    process.exit(1);
  }
  process.exit(0);
})();
