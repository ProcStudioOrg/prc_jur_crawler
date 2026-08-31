function gerarChaveBrowser(gerenciador) {
  return gerenciador.gerar('suite de browser').valor;
}

async function injetarChave(page, valor) {
  await page.addInitScript((chave) => {
    localStorage.setItem('jur.chaveConexao', chave);
  }, valor);
}

module.exports = { gerarChaveBrowser, injetarChave };
