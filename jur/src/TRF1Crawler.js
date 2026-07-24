const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TRF1 (Tribunal Regional Federal da 1a Regiao) jurisprudencia
 * https://jurisprudencia.cjf.jus.br/trf1/index.xhtml
 */
class TRF1Crawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://jurisprudencia.cjf.jus.br/trf1/index.xhtml';
  }

  /**
   * Navigate to the jurisprudencia search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });

    // Wait for form to be ready with longer timeout
    await this.page.waitForSelector('[id="formulario:textoLivre"]', { timeout: 60000 });
    await this.page.waitForTimeout(500);

    // Expand "Pesquisa avancada" section via JavaScript (element intercepts pointer)
    await this.page.evaluate(() => {
      const checkbox = document.querySelector('[id="formulario:ckbAvancada_input"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      }
    });

    // Wait for advanced search fields to appear
    await this.page.waitForTimeout(1000);
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.dataInicio - Start date (DD/MM/YYYY)
   * @param {string} filters.dataFim - End date (DD/MM/YYYY)
   * @param {string} filters.tipoData - Date type: 'DTDP' (Julgamento) or 'DTPP' (Publicacao)
   * @param {string} filters.relator - Relator name (Desembargador)
   * @param {string} filters.orgaoJulgador - Judging body (ex: "PRIMEIRA TURMA")
   * @param {string} filters.classe - Case class
   * @param {string} filters.numero - Case number
   * @param {Array<string>} filters.tiposDocumento - Document types: ACORDAO, SUMULA, ARGUICAO, DECISAOMONO
   * @param {Array<string>} filters.fontes - Sources: TRF1, JEF1
   */
  async configureFilters(filters = {}) {
    // Configure date filters
    if (filters.dataInicio) {
      const field = this.page.locator('[id="formulario:j_idt48_input"]');
      await field.click();
      await field.fill(filters.dataInicio);
      console.log(`Set start date: ${filters.dataInicio}`);
    }

    if (filters.dataFim) {
      const field = this.page.locator('[id="formulario:j_idt50_input"]');
      await field.click();
      await field.fill(filters.dataFim);
      console.log(`Set end date: ${filters.dataFim}`);
    }

    // Configure date type (Julgamento or Publicacao)
    if (filters.tipoData) {
      await this.page.evaluate((tipoData) => {
        const select = document.querySelector('[id="formulario:combo_tipo_data_input"]');
        if (select) {
          select.value = tipoData;
          // Trigger change event for PrimeFaces
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, filters.tipoData);
      console.log(`Set date type: ${filters.tipoData}`);
    }

    // Configure relator filter
    if (filters.relator) {
      const field = this.page.locator('[id="formulario:j_idt32"]');
      await field.click();
      await field.fill(filters.relator);
      console.log(`Set relator: ${filters.relator}`);
    }

    // Configure orgao julgador filter
    if (filters.orgaoJulgador) {
      const field = this.page.locator('[id="formulario:j_idt40"]');
      await field.click();
      await field.fill(filters.orgaoJulgador);
      console.log(`Set orgao julgador: ${filters.orgaoJulgador}`);
    }

    // Configure classe filter
    if (filters.classe) {
      const field = this.page.locator('[id="formulario:j_idt30"]');
      await field.click();
      await field.fill(filters.classe);
      console.log(`Set classe: ${filters.classe}`);
    }

    // Configure numero filter
    if (filters.numero) {
      const field = this.page.locator('[id="formulario:j_idt28"]');
      await field.click();
      await field.fill(filters.numero);
      console.log(`Set numero: ${filters.numero}`);
    }

    // Configure document types (optional - defaults are usually fine)
    // Note: The default is ACORDAO checked, which is what most users want
    if (filters.tiposDocumento && filters.tiposDocumento.length > 0 &&
        !(filters.tiposDocumento.length === 1 && filters.tiposDocumento[0] === 'ACORDAO')) {
      await this.page.evaluate((tipos) => {
        const checkboxes = {
          'ACORDAO': document.querySelector('[id="formulario:selectTiposDocumento:0"]'),
          'SUMULA': document.querySelector('[id="formulario:selectTiposDocumento:1"]'),
          'ARGUICAO': document.querySelector('[id="formulario:selectTiposDocumento:2"]'),
          'DECISAOMONO': document.querySelector('[id="formulario:selectTiposDocumento:3"]'),
        };

        // Uncheck all first
        Object.values(checkboxes).forEach(cb => {
          if (cb && cb.checked) cb.click();
        });

        // Check requested types
        tipos.forEach(tipo => {
          const cb = checkboxes[tipo];
          if (cb && !cb.checked) cb.click();
        });
      }, filters.tiposDocumento);
      console.log(`Set document types: ${filters.tiposDocumento.join(', ')}`);
    }

    // Configure sources (optional - defaults are usually fine)
    // Note: The default is TRF1 checked, which is what most users want
    if (filters.fontes && filters.fontes.length > 0 &&
        !(filters.fontes.length === 1 && filters.fontes[0] === 'TRF1')) {
      await this.page.evaluate((fontes) => {
        const checkboxes = {
          'TRF1': document.querySelector('[id="formulario:j_idt62:0"]'),
          'JEF1': document.querySelector('[id="formulario:j_idt62:1"]'),
        };

        // Uncheck all first
        Object.values(checkboxes).forEach(cb => {
          if (cb && cb.checked) cb.click();
        });

        // Check requested sources
        fontes.forEach(fonte => {
          const cb = checkboxes[fonte];
          if (cb && !cb.checked) cb.click();
        });
      }, filters.fontes);
      console.log(`Set sources: ${filters.fontes.join(', ')}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text
   */
  async executeSearch(query) {
    const searchBox = this.page.locator('[id="formulario:textoLivre"]');
    await searchBox.click();
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    // Click the search button
    await this.page.click('button:has-text("Pesquisar")');

    // Wait for network to settle
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for results table to appear (longer timeout for AJAX)
    await this.page.waitForSelector('.table_resultado', { timeout: 30000 }).catch(() => {
      console.log('Warning: Results table not found or empty');
    });

    // Extra wait for all results to render
    await this.page.waitForTimeout(1000);
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const results = [];

    // Wait for results to load - the actual results are in .table_resultado tables
    await this.page.waitForSelector('.table_resultado', { timeout: 10000 }).catch(() => {});

    // Extract each result item from .table_resultado tables
    const items = await this.page.locator('.table_resultado').all();
    console.log(`Found ${items.length} result items on page`);

    for (const item of items) {
      try {
        const result = await item.evaluate(el => {
          // Labels are in span.label_pontilhada, values are in the next row
          const getValorCampo = (campo) => {
            const labels = el.querySelectorAll('.label_pontilhada');
            for (const label of labels) {
              if (label.textContent.trim() === campo) {
                // The value is in the next row's td
                const labelRow = label.closest('tr');
                const valueRow = labelRow?.nextElementSibling;
                if (valueRow) {
                  return valueRow.textContent.trim();
                }
              }
            }
            return '';
          };

          // Extract structured data
          const tipo = getValorCampo('Tipo');
          const numeroProcesso = getValorCampo('Número');
          const classe = getValorCampo('Classe');
          const relator = getValorCampo('Relator(a)');
          const origem = getValorCampo('Origem');
          const orgaoJulgador = getValorCampo('Órgão julgador');
          const dataJulgamento = getValorCampo('Data');
          const dataPublicacao = getValorCampo('Data da publicação');
          const fontePublicacao = getValorCampo('Fonte da publicação');
          const decisao = getValorCampo('Decisão');
          const ementa = getValorCampo('Ementa').substring(0, 15000);

          // Get inteiro teor link
          const inteiroTeorLink = el.querySelector('a[href*="pje2g"]')?.href ||
                                  el.querySelector('a[href*="arquivo.trf1"]')?.href || '';

          return {
            tipo,
            numeroProcesso,
            classe,
            relator,
            origem,
            orgaoJulgador,
            dataJulgamento,
            dataPublicacao,
            fontePublicacao,
            ementa,
            decisao,
            inteiroTeorLink,
          };
        });

        if (result.numeroProcesso || result.tipo) {
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
      // Wait a bit for the paginator to be ready
      await this.page.waitForSelector('.ui-paginator-next', { timeout: 5000 }).catch(() => {});
      const nextButton = this.page.locator('.ui-paginator-next:not(.ui-state-disabled)');
      const count = await nextButton.count();
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to docker logs evolution-api -f
the next page of results
   */
  async goToNextPage() {
    const nextButton = this.page.locator('.ui-paginator-next:not(.ui-state-disabled)').first();
    await nextButton.click();

    // Wait for the page to update
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2000); // Extra wait for AJAX results to load
  }

  /**
   * Get the total number of results (if displayed)
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const totalText = await this.page.locator('a:has-text("Documento(s) encontrado(s)")').first().textContent();
      const match = totalText.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the number of results per page
   * @param {number} count - 10, 30, or 50
   */
  async setResultsPerPage(count) {
    if (![10, 30, 50].includes(count)) {
      throw new Error('Results per page must be 10, 30, or 50');
    }

    const select = this.page.locator('[id="formulario:tabelaDocumentos:j_id23"]');
    await select.selectOption(String(count));
    await this.waitForLoad();
    await this.page.waitForTimeout(1000);
  }
}

module.exports = TRF1Crawler;
