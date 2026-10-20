// jur/tests/fixtures/cli-falha-real.js
// CLI de teste com Chromium REAL: abre a pagina local de FIXTURE_URL, espera um seletor que nao
// existe e sai com 1, como um crawler cujo site mudou. Quem captura print/HTML e o preload
// (--require), exatamente como em producao. FIXTURE_MODO escolhe a forma:
//  - aberto (padrao): sai com o browser ainda aberto.
//  - fecha: a forma dos crawlers reais (BaseCrawler.search): browser.close() no `finally`, e so
//    depois o catch externo imprime o envelope e chama exit(1) — sem nenhuma pagina aberta.
const { chromium } = require('playwright');

// A mensagem e a do proprio Playwright; o Bearer e acrescentado de proposito: nada disso pode chegar ao FFD.
const falhar = (e) => {
  process.stdout.write(JSON.stringify({ success: false, error: `${e.message} (Authorization: Bearer SEGREDO-DO-TESTE-123)` }) + '\n');
  process.exit(1);
};

async function buscar(fecharNoFinally) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.FIXTURE_URL);
    await page.waitForSelector('#nao-existe', { timeout: 1500 });
  } finally {
    if (fecharNoFinally) await browser.close();
  }
}

buscar(process.env.FIXTURE_MODO === 'fecha').then(() => process.exit(0), falhar);
