const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TRF5 (Tribunal Regional Federal da 5a Regiao) jurisprudencia
 * https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa
 * Sistema: Julia | Pesquisa Inteligente
 */
class TRF5Crawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa#consulta';
    this.tipoConsulta = options.tipoConsulta || 'segundoGrau'; // segundoGrau, turmaRecursal, tru
    this.estados = options.estados || []; // AL, CE, PB, PE, RN, SE (only for turmaRecursal)
  }

  /**
   * Navigate to the jurisprudencia search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForSelector('input[placeholder="Informe o termo desejado"]', { timeout: 30000 });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.tipoConsulta - 'segundoGrau', 'turmaRecursal', or 'tru'
   * @param {Array<string>} filters.estados - States for turmaRecursal (AL, CE, PB, PE, RN, SE)
   * @param {string} filters.numeroProcesso - Process number
   * @param {string} filters.relator - Judge name
   * @param {string} filters.orgaoJulgador - Judging body
   * @param {string} filters.dataInicio - Start date (DD/MM/YYYY)
   * @param {string} filters.dataFim - End date (DD/MM/YYYY)
   */
  async configureFilters(filters = {}) {
    // Select tipo de consulta
    if (filters.tipoConsulta === 'turmaRecursal') {
      await this.page.click('text=Turma Recursal');
      await this.page.waitForTimeout(500);

      // Select estados if specified
      if (filters.estados && filters.estados.length > 0) {
        for (const estado of filters.estados) {
          try {
            await this.page.click(`text=${estado}`);
          } catch (e) {
            console.log(`Could not select state: ${estado}`);
          }
        }
      }
    } else if (filters.tipoConsulta === 'tru') {
      await this.page.click('text=TRU');
      await this.page.waitForTimeout(500);
    }

    // Configure numero do processo
    if (filters.numeroProcesso) {
      const field = this.page.locator('input[placeholder="Informe o número do processo"]');
      await field.click();
      await field.fill(filters.numeroProcesso);
      console.log(`Set process number: ${filters.numeroProcesso}`);
    }

    // Configure relator (combobox)
    if (filters.relator) {
      try {
        const relatorInput = this.page.locator('input[placeholder="Selecione o(a) relator(a)"]');
        await relatorInput.click();
        await this.page.waitForTimeout(300);
        // Type to filter and select
        await relatorInput.fill(filters.relator);
        await this.page.waitForTimeout(300);
        // Click on the first matching option
        await this.page.click(`text=${filters.relator}`).catch(() => {
          console.log('Relator option not found in dropdown');
        });
        console.log(`Set relator: ${filters.relator}`);
      } catch (e) {
        console.log(`Could not set relator: ${e.message}`);
      }
    }

    // Configure orgao julgador (combobox)
    if (filters.orgaoJulgador) {
      try {
        const orgaoInput = this.page.locator('input[placeholder*="Selecione o órgão julgador"]');
        await orgaoInput.click();
        await this.page.waitForTimeout(300);
        await this.page.click(`text=${filters.orgaoJulgador}`);
        console.log(`Set orgao julgador: ${filters.orgaoJulgador}`);
      } catch (e) {
        console.log(`Could not set orgao julgador: ${e.message}`);
      }
    }

    // Configure dates
    if (filters.dataInicio) {
      try {
        const field = this.page.locator('input[placeholder="de (dd/mm/aaaa)"]');
        await field.click();
        await field.fill(filters.dataInicio);
        console.log(`Set start date: ${filters.dataInicio}`);
      } catch (e) {
        console.log(`Could not set start date: ${e.message}`);
      }
    }

    if (filters.dataFim) {
      try {
        const field = this.page.locator('input[placeholder="até (dd/mm/aaaa)"]');
        await field.click();
        await field.fill(filters.dataFim);
        console.log(`Set end date: ${filters.dataFim}`);
      } catch (e) {
        console.log(`Could not set end date: ${e.message}`);
      }
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text
   */
  async executeSearch(query) {
    // Fill search field
    const searchBox = this.page.locator('input[placeholder="Informe o termo desejado"]');
    await searchBox.click();
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    // Click search button
    await this.page.click('button:has-text("Pesquisar")');

    // Wait for results page (URL changes to #resultado)
    await this.page.waitForURL(/.*#resultado/, { timeout: 30000 });
    await this.waitForLoad();

    // Wait for results to appear
    await this.page.waitForSelector('text=documentos localizados', { timeout: 30000 }).catch(() => {
      console.log('Warning: No results indicator found');
    });

    await this.page.waitForTimeout(1500);
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const results = [];

    // Wait for results to load - try multiple selectors
    await this.page.waitForTimeout(2000);
    await this.page.waitForSelector('[role="gridcell"], [role="row"], a[href*="consulta-processual"]', { timeout: 15000 }).catch(() => {
      console.log('Warning: Could not find result elements');
    });

    // Extract results using page.evaluate for better performance
    const extractedData = await this.page.evaluate(() => {
      const items = [];

      // Try multiple selectors for gridcells
      let gridcells = document.querySelectorAll('[role="gridcell"]');
      if (gridcells.length === 0) {
        // Fallback: find containers with processo links
        const processoLinks = document.querySelectorAll('a[href*="consulta-processual"]');
        gridcells = Array.from(processoLinks).map(link => {
          // Go up to find the container
          let parent = link.parentElement;
          while (parent && !parent.querySelector('[role="gridcell"]') && parent.tagName !== 'BODY') {
            if (parent.innerText && parent.innerText.length > 500) {
              return parent;
            }
            parent = parent.parentElement;
          }
          return parent;
        }).filter(Boolean);
      }

      gridcells.forEach(cell => {
        // Find processo link
        const processoLink = cell.querySelector('a[href*="consulta-processual"]');
        if (!processoLink) return;

        const numeroProcesso = processoLink.textContent?.trim().replace(/\s/g, '') || '';

        // Helper to get text after label
        const getTextAfterLabel = (label) => {
          const allText = cell.innerText;
          const regex = new RegExp(`${label}:\\s*([^\\n]+)`, 'i');
          const match = allText.match(regex);
          return match ? match[1].trim() : '';
        };

        const orgaoJulgador = getTextAfterLabel('Órgão Julgador');
        const classe = getTextAfterLabel('Classe');
        const dataJulgamento = getTextAfterLabel('Data Julgamento');
        const relator = getTextAfterLabel('Relator\\(a\\)');
        const dataAutuacao = getTextAfterLabel('Data Autuação');

        // Get ementa - find the last large text block
        const textDivs = cell.querySelectorAll('div');
        let ementa = '';
        for (let i = textDivs.length - 1; i >= 0; i--) {
          const text = textDivs[i].innerText?.trim() || '';
          if (text.length > 200 && (text.includes('EMENTA') || text.includes('PROCESSO'))) {
            ementa = text;
            break;
          }
        }

        if (!ementa) {
          // Fallback: get all text after "Texto"
          const allText = cell.innerText;
          const textoIndex = allText.indexOf('Copiar texto');
          if (textoIndex > -1) {
            ementa = allText.substring(textoIndex + 12).trim();
          }
        }

        items.push({
          numeroProcesso,
          orgaoJulgador,
          classe,
          dataJulgamento,
          relator,
          dataAutuacao,
          ementa: ementa.substring(0, 15000)
        });
      });

      return items;
    });

    console.log(`Found ${extractedData.length} result items on page`);
    return extractedData;
  }

  /**
   * Check if there's a next page of results
   * @returns {boolean}
   */
  async hasNextPage() {
    try {
      const nextBtn = this.page.locator('a:has-text("Próximo")');
      if (!(await nextBtn.isVisible())) {
        return false;
      }
      // Check if button is not disabled
      const isDisabled = await nextBtn.evaluate(el => {
        return el.classList.contains('disabled') ||
               el.getAttribute('disabled') !== null ||
               el.parentElement?.classList.contains('disabled');
      });
      return !isDisabled;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    await this.page.click('a:has-text("Próximo")');
    await this.page.waitForTimeout(1500);
    await this.page.waitForSelector('[role="gridcell"]', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const statusText = await this.page.locator('[role="status"]').textContent();
      const match = statusText.match(/de\s+([\d.]+)\s*registros/);
      if (match) {
        return parseInt(match[1].replace(/\./g, ''), 10);
      }

      // Fallback: look for "documentos localizados"
      const totalText = await this.page.locator('text=documentos localizados').textContent();
      const match2 = totalText.match(/(\d+)\s*documentos/);
      return match2 ? parseInt(match2[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the tipo de consulta
   * @param {string} tipo - 'segundoGrau', 'turmaRecursal', or 'tru'
   */
  setTipoConsulta(tipo) {
    this.tipoConsulta = tipo;
  }

  /**
   * Set estados for Turma Recursal
   * @param {Array<string>} estados - Array of state codes (AL, CE, PB, PE, RN, SE)
   */
  setEstados(estados) {
    this.estados = estados;
  }
}

module.exports = TRF5Crawler;
