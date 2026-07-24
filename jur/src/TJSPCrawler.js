const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TJSP (Tribunal de Justiça de São Paulo) jurisprudência
 * https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do
 */
class TJSPCrawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do';
  }

  /**
   * Navigate to the jurisprudência search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl);
    await this.waitForLoad();
    await this.page.waitForSelector('#iddados\\.buscaInteiroTeor', { timeout: 15000 });
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.dataJulgamentoInicio - Start date for judgment (DD/MM/YYYY)
   * @param {string} filters.dataJulgamentoFim - End date for judgment (DD/MM/YYYY)
   * @param {string} filters.dataPublicacaoInicio - Start date for publication (DD/MM/YYYY)
   * @param {string} filters.dataPublicacaoFim - End date for publication (DD/MM/YYYY)
   * @param {boolean} filters.origem2grau - Include 2° grau (default: true)
   * @param {boolean} filters.origemRecursal - Include Colégios Recursais (default: true)
   * @param {boolean} filters.tipoAcordao - Include Acórdãos (default: true)
   * @param {boolean} filters.tipoHomologacao - Include Homologações de Acordo
   * @param {boolean} filters.tipoDecisaoMono - Include Decisões Monocráticas
   */
  async configureFilters(filters = {}) {
    // Configure origin checkboxes
    const grau2 = this.page.locator('#origem2grau');
    const recursal = this.page.locator('#origemRecursal');

    if (filters.origem2grau !== false) {
      if (!(await grau2.isChecked())) await grau2.check();
      console.log('Enabled: 2° grau');
    } else {
      if (await grau2.isChecked()) await grau2.uncheck();
    }

    if (filters.origemRecursal !== false) {
      if (!(await recursal.isChecked())) await recursal.check();
      console.log('Enabled: Colégios Recursais');
    } else {
      if (await recursal.isChecked()) await recursal.uncheck();
    }

    // Configure decision type checkboxes
    if (filters.tipoAcordao === false) {
      const cb = this.page.locator('#Acheckbox');
      if (await cb.isChecked()) await cb.uncheck();
    }
    if (filters.tipoHomologacao) {
      const cb = this.page.locator('#Hcheckbox');
      if (!(await cb.isChecked())) await cb.check();
    }
    if (filters.tipoDecisaoMono) {
      const cb = this.page.locator('#Dcheckbox');
      if (!(await cb.isChecked())) await cb.check();
    }

    // Configure judgment dates
    if (filters.dataJulgamentoInicio) {
      await this.page.locator('#iddados\\.dtJulgamentoInicio').fill(filters.dataJulgamentoInicio);
      console.log(`Set judgment start date: ${filters.dataJulgamentoInicio}`);
    }
    if (filters.dataJulgamentoFim) {
      await this.page.locator('#iddados\\.dtJulgamentoFim').fill(filters.dataJulgamentoFim);
      console.log(`Set judgment end date: ${filters.dataJulgamentoFim}`);
    }

    // Configure publication dates
    if (filters.dataPublicacaoInicio) {
      await this.page.locator('#iddados\\.dtPublicacaoInicio').fill(filters.dataPublicacaoInicio);
      console.log(`Set publication start date: ${filters.dataPublicacaoInicio}`);
    }
    if (filters.dataPublicacaoFim) {
      await this.page.locator('#iddados\\.dtPublicacaoFim').fill(filters.dataPublicacaoFim);
      console.log(`Set publication end date: ${filters.dataPublicacaoFim}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text (supports operators: E, OU, NAO, "")
   */
  async executeSearch(query) {
    await this.page.locator('#iddados\\.buscaInteiroTeor').fill(query);
    console.log(`Set search query: ${query}`);

    await this.page.locator('#pbSubmit').click();
    await this.waitForLoad();
    await this.page.waitForTimeout(3000);
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    await this.page.waitForSelector('tr.fundocinza1', { timeout: 15000 }).catch(() => {});

    const pageResults = await this.page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('tr.fundocinza1');

      for (const row of rows) {
        // Process link with cdacordao attribute
        const processLink = row.querySelector('a.esajLinkLogin.downloadEmenta');
        if (!processLink) continue;

        const cdacordao = processLink.getAttribute('cdacordao') || '';
        const numeroProcesso = processLink.textContent.trim();

        // Extract labeled fields from <strong> tags
        const fields = {};
        const strongEls = row.querySelectorAll('strong');
        for (const strong of strongEls) {
          const label = strong.textContent.trim();
          if (label.includes(':')) {
            const td = strong.closest('td');
            if (td) {
              const value = td.textContent.replace(strong.textContent, '').trim();
              fields[label.replace(':', '').trim()] = value;
            }
          }
        }

        // Extract ementa from hidden div
        let ementa = '';
        const ementaDiv = row.querySelector('#textAreaDados_' + cdacordao);
        if (ementaDiv) {
          ementa = ementaDiv.textContent.trim();
        } else if (fields['Ementa']) {
          ementa = fields['Ementa'];
        }

        items.push({
          id: cdacordao,
          numeroProcesso,
          classeAssunto: fields['Classe/Assunto'] || '',
          relator: fields['Relator(a)'] || '',
          comarca: fields['Comarca'] || '',
          orgaoJulgador: fields['Órgão julgador'] || '',
          dataJulgamento: fields['Data do julgamento'] || '',
          dataPublicacao: fields['Data de publicação'] || '',
          ementa: ementa.substring(0, 10000),
        });
      }

      return items;
    });

    console.log(`Found ${pageResults.length} result items on page`);
    return pageResults;
  }

  /**
   * Check if there's a next page of results
   * @returns {boolean}
   */
  async hasNextPage() {
    try {
      const nextLink = this.page.locator('a[title="Próxima página"]').first();
      return await nextLink.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    await this.page.locator('a[title="Próxima página"]').first().click();
    await this.waitForLoad();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const bodyText = await this.page.locator('body').textContent();
      const match = bodyText.match(/de\s+([\d.]+)\s*$/m);
      if (match) {
        return parseInt(match[1].replace(/\./g, ''), 10);
      }
      return null;
    } catch {
      return null;
    }
  }
}

module.exports = TJSPCrawler;
