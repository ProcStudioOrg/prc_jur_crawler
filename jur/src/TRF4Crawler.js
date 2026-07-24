const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TRF4 (Tribunal Regional Federal da 4ª Região) jurisprudência
 * https://eproc-jur.trf4.jus.br
 */
class TRF4Crawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar';
  }

  /**
   * Navigate to the jurisprudência search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl);
    await this.waitForLoad();

    // Wait for page scripts to fully initialize
    await this.page.waitForTimeout(2000);

    // Expand "Pesquisa avançada" - try multiple approaches
    const expanded = await this.page.evaluate(() => {
      // Approach 1: jQuery Bootstrap collapse
      if (typeof jQuery !== 'undefined') {
        jQuery('#divPesquisaAvancada').collapse('show');
        return 'jquery';
      }
      return null;
    });

    if (expanded) {
      await this.page.waitForTimeout(1000);
    }

    // Verify and fallback: force click the toggle link
    const isExpanded = await this.page.locator('#divPesquisaAvancada.show').count() > 0;
    if (!isExpanded) {
      // Try clicking the toggle with force
      const toggle = this.page.locator('[data-target="#divPesquisaAvancada"], a:has-text("Pesquisa avançada")').first();
      if (await toggle.count() > 0) {
        await toggle.click({ force: true });
        await this.page.waitForTimeout(1500);
      }
    }

    // Final fallback: direct DOM manipulation
    const stillCollapsed = await this.page.evaluate(() => {
      const div = document.getElementById('divPesquisaAvancada');
      if (!div) return true;
      if (!div.classList.contains('show')) {
        div.classList.add('show');
        div.style.height = '';
        return false;
      }
      return false;
    });

    await this.page.waitForTimeout(500);
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.dataDecisaoInicio - Start date for decision (DD/MM/YYYY)
   * @param {string} filters.dataDecisaoFim - End date for decision (DD/MM/YYYY)
   * @param {string} filters.dataDisponibilizacaoInicio - Start date for publication (DD/MM/YYYY)
   * @param {string} filters.dataDisponibilizacaoFim - End date for publication (DD/MM/YYYY)
   * @param {Array<string>} filters.orgaos - Organs to search (e.g., ['TRF4', 'TURMA REGIONAL'])
   */
  async configureFilters(filters = {}) {
    // Configure origin selection
    if (filters.origem === 'turmas-recursais') {
      // Use jQuery selectpicker if available, otherwise direct DOM
      await this.page.evaluate(() => {
        const sel = document.getElementById('selOrigem');
        if (!sel) return;
        // Deselect all, then select "Turmas Recursais" (value="3")
        for (const opt of sel.options) {
          opt.selected = opt.value === '3';
        }
        // Use jQuery selectpicker refresh if available
        if (typeof jQuery !== 'undefined' && jQuery.fn.selectpicker) {
          jQuery('#selOrigem').selectpicker('refresh');
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      console.log('Set origin: Turmas Recursais');
    } else if (filters.orgaos && filters.orgaos.length > 0) {
      await this.page.evaluate((orgaos) => {
        const sel = document.getElementById('selOrigem');
        if (!sel) return;
        for (const opt of sel.options) {
          opt.selected = orgaos.some(o => opt.textContent.includes(o));
        }
        if (typeof jQuery !== 'undefined' && jQuery.fn.selectpicker) {
          jQuery('#selOrigem').selectpicker('refresh');
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, filters.orgaos);
    }

    // Configure date filters using Playwright fill with force
    const fillDate = async (selector, value) => {
      const field = this.page.locator(selector);
      if (await field.count() > 0) {
        await field.fill(value, { force: true });
      }
    };

    if (filters.dataDecisaoInicio) {
      await fillDate('#dtDecisaoInicio', filters.dataDecisaoInicio);
      console.log(`Set decision start date: ${filters.dataDecisaoInicio}`);
    }
    if (filters.dataDecisaoFim) {
      await fillDate('#dtDecisaoFim', filters.dataDecisaoFim);
      console.log(`Set decision end date: ${filters.dataDecisaoFim}`);
    }
    if (filters.dataDisponibilizacaoInicio) {
      await fillDate('#dtPublicacaoInicio', filters.dataDisponibilizacaoInicio);
      console.log(`Set publication start date: ${filters.dataDisponibilizacaoInicio}`);
    }
    if (filters.dataDisponibilizacaoFim) {
      await fillDate('#dtPublicacaoFim', filters.dataDisponibilizacaoFim);
      console.log(`Set publication end date: ${filters.dataDisponibilizacaoFim}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text
   */
  async executeSearch(query) {
    const searchBox = this.page.locator('#txtPesquisa');
    await searchBox.click();
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    // Click the search button
    await this.page.locator('button:has-text("Pesquisar"), #btnConsultar').first().click();
    await this.waitForLoad();

    // Wait for results to load
    await this.page.waitForTimeout(2000);
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const results = [];

    // Wait for results to load
    await this.page.waitForSelector('.resultadoItem', { timeout: 10000 }).catch(() => {});

    // Extract each result item using the correct selector
    const items = await this.page.locator('.resultadoItem').all();
    console.log(`Found ${items.length} result items on page`);

    for (const item of items) {
      try {
        // Extract data from each result card using the exact structure
        const result = await item.evaluate(el => {
          // Helper to get text by label
          const getValueByLabel = (labelText) => {
            const labels = el.querySelectorAll('.resLabel');
            for (const label of labels) {
              if (label.textContent.trim().toUpperCase().includes(labelText.toUpperCase())) {
                const valueEl = label.nextElementSibling;
                if (valueEl && valueEl.classList.contains('resValue')) {
                  return valueEl.textContent.trim();
                }
              }
            }
            return '';
          };

          // Get tipo documento
          const tipoDocumento = el.querySelector('.resValueTipoJurisprudencia')?.textContent?.trim() || '';

          // Get processo number
          const processoLink = el.querySelector('.numero-processo');
          const numeroProcesso = processoLink?.textContent?.trim() || '';
          const processoUrl = processoLink?.href || '';

          // Get other fields by label
          const orgaoJulgador = getValueByLabel('ÓRGÃO JULGADOR');
          const dataJulgamento = getValueByLabel('DATA DO JULGAMENTO');
          const dataPublicacao = getValueByLabel('DATA DA PUBLICAÇÃO');
          const relator = getValueByLabel('RELATOR');
          const uf = getValueByLabel('UF');

          // Get inteiro teor link from data attribute (may be relative URL)
          const inteiroTeorEl = el.querySelector('a.inteiroTeor');
          let inteiroTeorLink = inteiroTeorEl?.getAttribute('data-link') || '';
          if (inteiroTeorLink && !inteiroTeorLink.startsWith('http')) {
            inteiroTeorLink = new URL(inteiroTeorLink, window.location.origin + window.location.pathname).href;
          }

          // Get citation/ementa from data attribute (contains full decision text)
          const citacaoEl = el.querySelector('a.copiarCitacao');
          const ementa = citacaoEl?.getAttribute('data-citacao') || '';

          return {
            id: el.id || '',
            tipoDocumento,
            numeroProcesso,
            processoUrl,
            orgaoJulgador,
            dataJulgamento,
            dataPublicacao,
            relator,
            uf,
            ementa: ementa.substring(0, 10000),
            inteiroTeorLink,
          };
        });

        if (result.numeroProcesso || result.tipoDocumento) {
          results.push(result);
        }
      } catch (e) {
        console.error('Error extracting result:', e.message);
      }
    }

    return results;
  }

  /**
   * Check if there's a next page of results
   * @returns {boolean}
   */
  async hasNextPage() {
    try {
      // Check if the next page icon is not disabled
      const nextButton = this.page.locator('.paginaProxima:not(.iconeDesativado)');
      return await nextButton.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    const nextButton = this.page.locator('.paginaProxima:not(.iconeDesativado)').first();
    await nextButton.click();
    await this.waitForLoad();
    await this.page.waitForTimeout(1500); // Wait for results to load
  }

  /**
   * Get the total number of results (if displayed)
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      // Pattern: "Documento 1 de 16756" — found in parent div of .chkDocumento
      const firstResult = this.page.locator('div:has(> div > input.chkDocumento)').first();
      const text = await firstResult.textContent({ timeout: 5000 });
      const match = text.match(/Documento\s+\d+\s+de\s+([\d.]+)/i);
      if (match) {
        return parseInt(match[1].replace(/\./g, ''), 10);
      }
      return null;
    } catch {
      return null;
    }
  }
}

module.exports = TRF4Crawler;
