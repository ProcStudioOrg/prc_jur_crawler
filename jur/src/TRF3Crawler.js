const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TRF3 (Tribunal Regional Federal da 3a Regiao) jurisprudencia
 * https://web.trf3.jus.br/jurisprudencia/
 */
class TRF3Crawler extends BaseCrawler {
  constructor(options = {}) {
    // Use system Chrome to avoid HTTP2 issues with bundled Chromium
    super({ useSystemChrome: true, ...options });
    this.baseUrl = 'https://web.trf3.jus.br/jurisprudencia/';
    this.base = options.base || 0; // 0=TRF3, 1=Turmas Recursais, 2=Monocraticas
  }

  /**
   * Navigate to the jurisprudencia search page
   */
  async navigateToSearch() {
    // Try multiple times in case of transient errors
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await this.page.waitForSelector('input[placeholder="Digite sua Pesquisa"]', { timeout: 60000 });
        await this.page.waitForTimeout(1000);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        console.log(`Attempt ${attempt} failed: ${e.message}. Retrying...`);
        await this.page.waitForTimeout(3000);
      }
    }
    if (lastError) throw lastError;

    // Select base if not TRF3 (default)
    if (this.base === 1) {
      await this.page.click('a[href="/jurisprudencia/home/index/1"]');
      await this.page.waitForLoadState('networkidle');
    } else if (this.base === 2) {
      await this.page.click('a[href="/jurisprudencia/home/index/2"]');
      await this.page.waitForLoadState('networkidle');
    }
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.numeroProcesso - Process number
   * @param {string} filters.relator - Judge name
   * @param {string} filters.dataInicio - Start date (DD/MM/YYYY)
   * @param {string} filters.dataFim - End date (DD/MM/YYYY)
   * @param {string} filters.tipoData - Date type: 'Publicação' or 'Julgamento'
   * @param {string} filters.classe - Case class
   * @param {string} filters.orgaoJulgador - Judging body
   * @param {string} filters.ementa - Text in ementa
   * @param {number} filters.resultadosPorPagina - Results per page (10, 30, 50)
   */
  async configureFilters(filters = {}) {
    // Store filters for later use
    this.pendingFilters = filters;

    // Check if any advanced filter is needed
    const needsAdvanced = filters.numeroProcesso || filters.relator ||
      filters.dataInicio || filters.dataFim || filters.classe ||
      filters.orgaoJulgador || filters.ementa;

    if (needsAdvanced) {
      // Open advanced search
      try {
        const advancedBtn = this.page.locator('button:has-text("Abrir pesquisa Avançada")');
        if (await advancedBtn.isVisible()) {
          await advancedBtn.click();
          await this.page.waitForTimeout(500);
        }
      } catch (e) {
        console.log('Advanced search may already be open');
      }

      // Configure numero do processo
      if (filters.numeroProcesso) {
        try {
          const field = this.page.locator('input').filter({ hasText: '' }).nth(1);
          await field.fill(filters.numeroProcesso);
          console.log(`Set process number: ${filters.numeroProcesso}`);
        } catch (e) {
          console.log('Could not set process number');
        }
      }

      // Configure relator
      if (filters.relator) {
        try {
          await this.page.selectOption('select', { label: filters.relator });
          console.log(`Set relator: ${filters.relator}`);
        } catch (e) {
          // Try partial match
          try {
            const select = this.page.locator('select').first();
            const options = await select.locator('option').all();
            for (const opt of options) {
              const text = await opt.textContent();
              if (text && text.toUpperCase().includes(filters.relator.toUpperCase())) {
                await select.selectOption({ label: text.trim() });
                console.log(`Set relator: ${text.trim()}`);
                break;
              }
            }
          } catch (e2) {
            console.log(`Could not set relator: ${e.message}`);
          }
        }
      }

      // Configure dates
      if (filters.dataInicio || filters.dataFim) {
        try {
          const dateInputs = await this.page.locator('input[type="text"]').all();
          // Find date inputs (usually have date-like placeholder or are near "Data:" label)
          for (let i = 0; i < dateInputs.length; i++) {
            const placeholder = await dateInputs[i].getAttribute('placeholder');
            if (placeholder && placeholder.includes('/')) {
              if (filters.dataInicio) {
                await dateInputs[i].fill(filters.dataInicio);
                console.log(`Set start date: ${filters.dataInicio}`);
              }
              if (filters.dataFim && dateInputs[i + 1]) {
                await dateInputs[i + 1].fill(filters.dataFim);
                console.log(`Set end date: ${filters.dataFim}`);
              }
              break;
            }
          }
        } catch (e) {
          console.log('Could not set dates');
        }
      }

      // Configure tipo data
      if (filters.tipoData) {
        try {
          const selects = await this.page.locator('select').all();
          for (const select of selects) {
            const options = await select.locator('option').allTextContents();
            if (options.includes('Publicação') || options.includes('Julgamento')) {
              await select.selectOption(filters.tipoData);
              console.log(`Set date type: ${filters.tipoData}`);
              break;
            }
          }
        } catch (e) {
          console.log('Could not set date type');
        }
      }

      // Configure classe
      if (filters.classe) {
        try {
          const selects = await this.page.locator('select').all();
          for (const select of selects) {
            const options = await select.locator('option').allTextContents();
            if (options.some(o => o.includes('APELAÇÃO') || o.includes('AÇÃO'))) {
              await select.selectOption({ label: filters.classe });
              console.log(`Set classe: ${filters.classe}`);
              break;
            }
          }
        } catch (e) {
          console.log('Could not set classe');
        }
      }

      // Configure orgao julgador
      if (filters.orgaoJulgador) {
        try {
          const selects = await this.page.locator('select').all();
          for (const select of selects) {
            const options = await select.locator('option').allTextContents();
            if (options.some(o => o.includes('Turma') || o.includes('Seção'))) {
              await select.selectOption({ label: filters.orgaoJulgador });
              console.log(`Set orgao julgador: ${filters.orgaoJulgador}`);
              break;
            }
          }
        } catch (e) {
          console.log('Could not set orgao julgador');
        }
      }

      // Configure ementa
      if (filters.ementa) {
        try {
          const inputs = await this.page.locator('input[type="text"]').all();
          // Ementa input is usually one of the later ones
          for (const input of inputs) {
            const ariaLabel = await input.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.toLowerCase().includes('ementa')) {
              await input.fill(filters.ementa);
              console.log(`Set ementa: ${filters.ementa}`);
              break;
            }
          }
        } catch (e) {
          console.log('Could not set ementa');
        }
      }
    }

    // Configure results per page
    if (filters.resultadosPorPagina) {
      // Will be applied after search via URL or select
      this.resultsPerPage = filters.resultadosPorPagina;
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text
   */
  async executeSearch(query) {
    // Fill search field
    const searchBox = this.page.locator('input[placeholder="Digite sua Pesquisa"]');
    await searchBox.click();
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    // Click search button (icon button with text "Fazer Pesquisa")
    await this.page.click('button:has-text("Fazer Pesquisa")');

    // Wait for results page
    await this.page.waitForURL(/ListaResumida/, { timeout: 30000 });
    await this.waitForLoad();

    // Wait for results to appear
    await this.page.waitForSelector('ul li', { timeout: 30000 }).catch(() => {
      console.log('Warning: No results found or timeout waiting for results');
    });

    await this.page.waitForTimeout(1000);

    // Set results per page if specified
    if (this.resultsPerPage) {
      try {
        const select = this.page.locator('select').filter({ hasText: '10' }).first();
        if (await select.isVisible()) {
          await select.selectOption(String(this.resultsPerPage));
          await this.page.waitForTimeout(1000);
        }
      } catch (e) {
        console.log('Could not set results per page');
      }
    }
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const results = [];

    // Wait for results to load
    await this.page.waitForSelector('ul li a[href*="ListaColecao"]', { timeout: 10000 }).catch(() => {});

    // Get all result items
    const items = await this.page.locator('ul li').filter({
      has: this.page.locator('a[href*="ListaColecao"]')
    }).all();

    console.log(`Found ${items.length} result items on page`);

    for (const item of items) {
      try {
        const result = await item.evaluate(el => {
          const link = el.querySelector('a[href*="ListaColecao"]');
          if (!link) return null;

          // Get all direct child divs/spans
          const children = Array.from(link.children);

          // Extract process number - usually in second child
          let numeroProcesso = '';
          let classe = '';
          let orgaoJulgador = '';
          let relator = '';
          let dataPublicacao = '';
          let dataJulgamento = '';
          let ementa = '';

          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const text = child.textContent?.trim() || '';

            // Process number (format: NNNNNNN-NN.NNNN.N.NN.NNNN)
            if (text.match(/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/)) {
              numeroProcesso = text;
              continue;
            }

            // Check for metadata container (has multiple child divs with class info)
            const subChildren = Array.from(child.children);
            if (subChildren.length >= 3) {
              // This is likely the metadata container
              for (const sub of subChildren) {
                const subText = sub.textContent?.trim() || '';

                // Classe (contains " - ")
                if (subText.includes(' - ') && !classe) {
                  classe = subText;
                }
                // Orgao julgador (contains "Turma" or "Seção")
                else if ((subText.includes('Turma') || subText.includes('Seção')) && !orgaoJulgador) {
                  orgaoJulgador = subText;
                }
                // Relator (starts with "Desembargador")
                else if (subText.startsWith('Desembargador') && !relator) {
                  relator = subText;
                }
                // Data publicacao
                else if (subText.includes('DATA:') && !dataPublicacao) {
                  dataPublicacao = subText;
                }
                // Data julgamento
                else if (subText.includes('Julgamento:') && !dataJulgamento) {
                  dataJulgamento = subText;
                }
              }
            }

            // Ementa - usually the last large text block
            if (text.length > 200 && text.includes('EMENTA') || text.includes('PODER JUDICIÁRIO')) {
              ementa = text;
            }
          }

          // If ementa not found, try last child
          if (!ementa && children.length > 0) {
            const lastChild = children[children.length - 1];
            ementa = lastChild.innerText?.trim() || '';
          }

          // Clean up dates
          if (dataPublicacao) {
            const match = dataPublicacao.match(/DATA:\s*(\d{2}\/\d{2}\/\d{4})/);
            if (match) dataPublicacao = match[1];
          }
          if (dataJulgamento) {
            const match = dataJulgamento.match(/Julgamento:\s*(\d{2}\/\d{2}\/\d{4})/);
            if (match) dataJulgamento = match[1];
          }

          // Clean up relator
          if (relator) {
            relator = relator.replace(/^Desembargador(a)?\s+Federal\s+/i, '').trim();
          }

          return {
            numeroProcesso,
            classe,
            orgaoJulgador,
            relator,
            dataPublicacao,
            dataJulgamento,
            ementa: ementa.substring(0, 15000)
          };
        });

        if (result && result.numeroProcesso) {
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
      const nextBtn = this.page.locator('a:has-text("Próxima página")');
      if (!(await nextBtn.isVisible())) {
        return false;
      }
      // Check if it's not disabled by looking at the href
      const href = await nextBtn.getAttribute('href');
      return !!href && href.includes('np=');
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    await this.page.click('a:has-text("Próxima página")');
    await this.waitForLoad();
    await this.page.waitForSelector('ul li a[href*="ListaColecao"]', { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(1500);
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const totalText = await this.page.locator('div, span').filter({ hasText: /^\d+\s*~\s*\d+$/ }).first().textContent();
      const match = totalText.match(/~\s*(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the base to search
   * @param {number} base - 0=TRF3, 1=Turmas Recursais, 2=Monocraticas
   */
  setBase(base) {
    this.base = base;
  }
}

module.exports = TRF3Crawler;
