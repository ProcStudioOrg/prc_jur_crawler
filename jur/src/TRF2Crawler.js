const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TRF2 (Tribunal Regional Federal da 2a Regiao) jurisprudencia
 * https://juris.trf2.jus.br/
 */
class TRF2Crawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://juris.trf2.jus.br/';
    this.searchUrl = 'https://juris.trf2.jus.br/consulta.php';
  }

  /**
   * Navigate to the jurisprudencia search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('input[placeholder="Digite o texto da pesquisa"]', { timeout: 30000 });
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure search filters
   * Note: Filters are only available on the results page, so this stores them for later
   * @param {Object} filters
   * @param {string} filters.dataInicio - Start date for judgment (DD/MM/YYYY)
   * @param {string} filters.dataFim - End date for judgment (DD/MM/YYYY)
   * @param {string} filters.ordenacao - Sort order: 'RELEV', 'DESC', 'ASC'
   * @param {string} filters.relator - Relator (Desembargador) name
   * @param {string} filters.orgaoColegiado - Judging body (ex: "1a. TURMA ESPECIALIZADA")
   * @param {string} filters.classe - Case class
   * @param {string} filters.competencia - Competence area
   * @param {string} filters.numeroProcesso - Case number
   * @param {boolean} filters.somenteEmenta - Search only in ementa
   * @param {boolean} filters.segundoGrau - TRF da 2a Regiao only
   * @param {boolean} filters.primeiroGrau - TRU e Turmas Recursais only
   */
  async configureFilters(filters = {}) {
    // Store filters for application after initial search
    this.pendingFilters = filters;
    console.log('Filters stored for application after search');
  }

  /**
   * Apply filters on the results page
   * @param {Object} filters
   */
  async applyFiltersOnResultsPage(filters = {}) {
    if (!filters || Object.keys(filters).every(k => !filters[k])) {
      return; // No filters to apply
    }

    // Wait for page to be ready
    await this.page.waitForTimeout(500);

    // Check if we need to apply any filters
    const hasFilters = filters.dataInicio || filters.dataFim || filters.ordenacao ||
      filters.numeroProcesso || filters.somenteEmenta || filters.segundoGrau ||
      filters.primeiroGrau || filters.relator || filters.orgaoColegiado ||
      filters.classe || filters.competencia;

    if (!hasFilters) {
      return;
    }

    // Expand "Opcoes de filtragem" accordion
    try {
      const filterBtn = this.page.locator('button:has-text("Opções de filtragem")').first();
      if (await filterBtn.isVisible()) {
        // Check if collapsed - the collapse div should have class 'show' when expanded
        const collapseDiv = this.page.locator('#collapseOne');
        const hasShow = await collapseDiv.evaluate(el => el.classList.contains('show')).catch(() => false);

        if (!hasShow) {
          await filterBtn.click();
          // Wait for the accordion to expand
          await this.page.waitForSelector('#collapseOne.show', { timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(500);
        }
      }
    } catch (e) {
      console.log('Filter accordion may already be expanded or not found');
    }

    // Configure date filters
    if (filters.dataInicio) {
      try {
        const field = this.page.locator('#DataInicial');
        await field.waitFor({ state: 'visible', timeout: 5000 });
        await field.click();
        await field.fill(filters.dataInicio);
        console.log(`Set start date: ${filters.dataInicio}`);
      } catch (e) {
        console.log(`Could not set start date: ${e.message}`);
      }
    }

    if (filters.dataFim) {
      try {
        const field = this.page.locator('#DataFinal');
        await field.waitFor({ state: 'visible', timeout: 5000 });
        await field.click();
        await field.fill(filters.dataFim);
        console.log(`Set end date: ${filters.dataFim}`);
      } catch (e) {
        console.log(`Could not set end date: ${e.message}`);
      }
    }

    // Configure sort order
    if (filters.ordenacao && filters.ordenacao !== 'RELEV') {
      try {
        await this.page.selectOption('select[name="tip_criterio_data"]', filters.ordenacao);
        console.log(`Set sort order: ${filters.ordenacao}`);
      } catch (e) {
        console.log('Could not set sort order');
      }
    }

    // Configure process number
    if (filters.numeroProcesso) {
      const field = this.page.locator('input[name="numero_processo"]');
      await field.click();
      await field.fill(filters.numeroProcesso);
      console.log(`Set process number: ${filters.numeroProcesso}`);
    }

    // Configure "somente ementa" checkbox
    if (filters.somenteEmenta) {
      const checkbox = this.page.locator('#check_ementa');
      if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
        await checkbox.click();
      }
      console.log('Set search in ementa only');
    }

    // Configure TRF da 2a Regiao checkbox
    if (filters.segundoGrau) {
      const checkbox = this.page.locator('#segundo_grau');
      if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
        await checkbox.click();
      }
      console.log('Set TRF da 2a Regiao filter');
    }

    // Configure TRU e Turmas Recursais checkbox
    if (filters.primeiroGrau) {
      const checkbox = this.page.locator('#primeiro_grau');
      if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
        await checkbox.click();
      }
      console.log('Set TRU e Turmas Recursais filter');
    }

    // Configure relator filter (dynamic checkbox)
    if (filters.relator) {
      await this.selectDynamicFilter('collapseOne_magistrado', 'fq_magistrado', filters.relator);
      console.log(`Set relator: ${filters.relator}`);
    }

    // Configure orgao colegiado filter (dynamic checkbox)
    if (filters.orgaoColegiado) {
      await this.selectDynamicFilter('collapseOne_orgao_colegiado', 'fq_orgao_colegiado', filters.orgaoColegiado);
      console.log(`Set orgao colegiado: ${filters.orgaoColegiado}`);
    }

    // Configure classe filter (dynamic checkbox)
    if (filters.classe) {
      await this.selectDynamicFilter('collapseOne_classe', 'fq_classe', filters.classe);
      console.log(`Set classe: ${filters.classe}`);
    }

    // Configure competencia filter (dynamic checkbox)
    if (filters.competencia) {
      await this.selectDynamicFilter('collapseOne_competencia', 'fq_competencia', filters.competencia);
      console.log(`Set competencia: ${filters.competencia}`);
    }

    // If any filters were applied, submit the search again
    if (hasFilters) {
      await this.page.click('button:has-text("Pesquisar"), button[onclick*="submitForm"]');
      await this.waitForLoad();
      await this.page.waitForSelector('.panel.panel-default', { timeout: 30000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Helper to select a dynamic filter checkbox
   * @param {string} accordionId - The accordion collapse ID
   * @param {string} filterPrefix - The filter name prefix (e.g., 'fq_magistrado')
   * @param {string} value - The value to search for
   */
  async selectDynamicFilter(accordionId, filterPrefix, value) {
    try {
      // Expand the accordion
      const accordionBtn = this.page.locator(`button[data-bs-target="#${accordionId}"]`);
      if (await accordionBtn.isVisible()) {
        const isExpanded = await accordionBtn.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await accordionBtn.click();
          await this.page.waitForTimeout(500);
        }
      }

      // Try to find and click the checkbox
      // The name format is: fq_magistrado[Nome do Relator]
      const checkbox = this.page.locator(`input[name*="${filterPrefix}"][name*="${value}"]`).first();
      if (await checkbox.isVisible()) {
        if (!(await checkbox.isChecked())) {
          await checkbox.click();
        }
        return true;
      }

      // If not found, try clicking "Ver mais" and search again
      const verMaisLink = this.page.locator(`#${accordionId} a:has-text("Ver mais")`);
      if (await verMaisLink.isVisible()) {
        await verMaisLink.click();
        await this.page.waitForTimeout(500);

        const checkboxAfter = this.page.locator(`input[name*="${filterPrefix}"][name*="${value}"]`).first();
        if (await checkboxAfter.isVisible()) {
          if (!(await checkboxAfter.isChecked())) {
            await checkboxAfter.click();
          }
          return true;
        }
      }

      console.log(`Warning: Filter ${filterPrefix}[${value}] not found`);
      return false;
    } catch (e) {
      console.log(`Error selecting filter ${filterPrefix}[${value}]: ${e.message}`);
      return false;
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text
   */
  async executeSearch(query) {
    // Check if we're on the initial page or results page
    const currentUrl = this.page.url();

    if (currentUrl.includes('consulta.php')) {
      // We're on the results page, use the search input there
      const searchBox = this.page.locator('#consulta_input');
      await searchBox.click();
      await searchBox.fill(query);
      console.log(`Set search query: ${query}`);

      // Click search button or submit
      await this.page.click('button:has-text("Pesquisar"), button[onclick*="submitForm"]');
    } else {
      // We're on the initial page
      const searchBox = this.page.locator('input[placeholder="Digite o texto da pesquisa"]');
      await searchBox.click();
      await searchBox.fill(query);
      console.log(`Set search query: ${query}`);

      // Submit the form
      await searchBox.press('Enter');
    }

    // Wait for results page to load
    await this.page.waitForURL(/consulta\.php/, { timeout: 30000 });
    await this.waitForLoad();

    // Wait for results to appear
    await this.page.waitForSelector('.panel.panel-default', { timeout: 30000 }).catch(() => {
      console.log('Warning: No results found or timeout waiting for results');
    });

    await this.page.waitForTimeout(1000);

    // Now apply any pending filters
    if (this.pendingFilters) {
      await this.applyFiltersOnResultsPage(this.pendingFilters);
    }
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const results = [];

    // Wait for results to load
    await this.page.waitForSelector('.panel.panel-default', { timeout: 10000 }).catch(() => {});

    // Extract each result item
    const items = await this.page.locator('.panel.panel-default').all();
    console.log(`Found ${items.length} result items on page`);

    for (const item of items) {
      try {
        const result = await item.evaluate(el => {
          // Helper to get field value from table
          const getValorCampo = (campo) => {
            const rows = el.querySelectorAll('table tr');
            for (const row of rows) {
              const cells = row.querySelectorAll('td');
              if (cells[0]?.textContent?.trim() === campo) {
                return cells[1]?.textContent?.trim() || '';
              }
            }
            return '';
          };

          // Get UUID from ementa button
          const ementaBtn = el.querySelector('button.item_button[data-id]');
          const uuid = ementaBtn?.getAttribute('data-id') || '';

          // Get process number
          const numeroProcessoEl = el.querySelector('.label-processo');
          const numeroProcesso = numeroProcessoEl?.textContent?.trim() || '';

          // Get links
          const inteiroTeorLink = el.querySelector('a[href*="documento.php"]')?.href || '';
          const processoLink = el.querySelector('a[href*="eproc"]')?.href || '';

          // Get ementa content
          const ementaEl = el.querySelector('.content_ementa');
          const ementa = ementaEl?.innerText?.trim() || '';

          return {
            uuid,
            numeroProcesso,
            classe: getValorCampo('Classe'),
            assuntos: getValorCampo('Assunto(s)'),
            competencia: getValorCampo('Competência') || getValorCampo('Competencia'),
            relator: getValorCampo('Relator Originário') || getValorCampo('Relator Originario'),
            dataAutuacao: getValorCampo('Data Autuação') || getValorCampo('Data Autuacao'),
            dataJulgamento: getValorCampo('Data Julgamento'),
            ementa: ementa.substring(0, 15000),
            inteiroTeorLink,
            processoLink
          };
        });

        if (result.numeroProcesso || result.uuid) {
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
      const pagination = this.page.locator('.pagination');
      if (!(await pagination.isVisible())) {
        return false;
      }

      // Get current active page
      const activeItem = pagination.locator('li.page-item.active');
      if (!(await activeItem.isVisible())) {
        return false;
      }

      // Check if there's a next page link after the active one
      const currentStart = parseInt(
        await activeItem.locator('a.page-link').getAttribute('start') || '0'
      );
      const nextPageLink = pagination.locator(`a.page-link[start="${currentStart + 20}"]`);

      return await nextPageLink.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    const pagination = this.page.locator('.pagination');
    const activeItem = pagination.locator('li.page-item.active');
    const currentStart = parseInt(
      await activeItem.locator('a.page-link').getAttribute('start') || '0'
    );
    const nextStart = currentStart + 20;

    // Click on the next page link
    await this.page.click(`a.page-link[start="${nextStart}"]`);
    await this.waitForLoad();
    await this.page.waitForTimeout(1500);
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const text = await this.page.locator('body').textContent();
      const match = text.match(/\((\d+)\s*resultados?\)/i);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }
}

module.exports = TRF2Crawler;
