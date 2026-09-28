const { obterPonte } = require('./navegadorAssistido');

function instrumentarChromium(chromium, ponte, { cdp } = {}) {
  const launch = chromium.launch.bind(chromium);
  let ocupado = false;
  chromium.launch = async (...args) => {
    if (ocupado) throw new Error('Esta execução já possui um navegador em uso.');
    ocupado = true;
    try {
      // A URL vem somente da sessão provisionada pelo pai; nunca é enviada à UI.
      const browser = cdp ? await chromium.connectOverCDP(cdp) : await launch(...args);
      const contextos = new WeakSet();
      const anexarContexto = (context) => {
        if (contextos.has(context)) return;
        contextos.add(context);
        context.on('page', (page) => ponte.anexarPagina(page));
        for (const page of context.pages()) ponte.anexarPagina(page);
      };
      for (const context of browser.contexts()) anexarContexto(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...opcoes) => {
        const context = await newContext(...opcoes);
        anexarContexto(context);
        return context;
      };
      browser.once('disconnected', () => { ocupado = false; ponte.encerrar(); });
      return browser;
    } catch (erro) {
      ocupado = false;
      // Erros de CDP podem conter o token do provedor na URL.
      if (cdp) throw new Error('Não foi possível conectar ao navegador remoto.');
      throw erro;
    }
  };
}

const ponte = obterPonte();
if (ponte || process.env.JUR_BROWSER_CDP) {
  instrumentarChromium(require('playwright').chromium, ponte || { anexarPagina() {}, encerrar() {} }, { cdp: process.env.JUR_BROWSER_CDP });
}

module.exports = { instrumentarChromium };
