const BaseCrawler = require('./BaseCrawler');

/**
 * Crawler for TCU (Tribunal de Contas da União) jurisprudência
 * https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo
 *
 * Searches Acórdãos with optional date filters (Data da Sessão).
 * Supports search operators: E, OU, ADJ, NÃO, PROX, MESMO, $
 */
class TCUCrawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.searchUrl = 'https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo';
  }

  /**
   * Remove CDK overlay backdrops that block interactions on Angular Material pages
   */
  async _dismissOverlays() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    await this.page.evaluate(() => {
      document.querySelectorAll('.cdk-overlay-backdrop, .cdk-overlay-pane:empty').forEach(el => el.remove());
    });
    await this.page.waitForTimeout(200);
  }

  /**
   * Navigate to the TCU Acórdãos search page
   */
  async navigateToSearch() {
    await this.page.goto(this.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForSelector('#termo_pesquisado', { timeout: 30000 });
    await this.page.waitForTimeout(1500);
    await this._dismissOverlays();
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.dataInicio - Session start date (DD/MM/YYYY)
   * @param {string} filters.dataFim - Session end date (DD/MM/YYYY)
   */
  async configureFilters(filters = {}) {
    if (filters.dataInicio) {
      await this._dismissOverlays();
      const field = this.page.locator('#datainiciosessao');
      await field.fill(filters.dataInicio);
      await this._dismissOverlays();
      console.log(`Set session start date: ${filters.dataInicio}`);
    }

    if (filters.dataFim) {
      await this._dismissOverlays();
      const field = this.page.locator('#datafimsessao');
      await field.fill(filters.dataFim);
      await this._dismissOverlays();
      console.log(`Set session end date: ${filters.dataFim}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text (supports TCU operators: E, OU, ADJ, NÃO, PROX, MESMO, $)
   */
  async executeSearch(query) {
    await this._dismissOverlays();
    const searchBox = this.page.locator('#termo_pesquisado');
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    await this._dismissOverlays();

    // Click search button (force as fallback for any lingering overlays)
    const searchBtn = this.page.locator('app-barra-botoes-de-pesquisa button[type="submit"]');
    await searchBtn.click({ force: true });

    // Wait for results page to load (avoid networkidle - Angular apps keep polling)
    await this.page.waitForURL(/.*resultado\/acordao-completo/, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);

    // Wait for result items to appear
    await this.page.waitForSelector('.lista-resultado__content, .mat-mdc-paginator-range-label', { timeout: 20000 }).catch(() => {
      console.log('Warning: No result items found');
    });
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    await this.page.waitForSelector('.lista-resultado__content', { timeout: 10000 }).catch(() => {});

    const results = await this.page.evaluate(() => {
      const items = [];
      const containers = document.querySelectorAll('.lista-resultado__content');

      containers.forEach(container => {
        const titleEl = container.querySelector('h3.lista-resultado__titulo');
        const linkEl = container.querySelector('a[id^="link_resultado_"]');
        const descEl = container.querySelector('.lista-resultado__descricao');

        const titulo = titleEl?.textContent?.trim() || '';
        const link = linkEl?.getAttribute('href') || '';

        // Parse relator and sumário from description paragraphs
        let relator = '';
        let sumario = '';
        const fragmentos = [];

        if (descEl) {
          const paragraphs = descEl.querySelectorAll('p');
          paragraphs.forEach(p => {
            const text = p.textContent?.trim() || '';
            if (text.startsWith('Relator:')) {
              relator = text.replace('Relator:', '').trim();
            } else if (text.startsWith('Sumário:')) {
              sumario = text.replace('Sumário:', '').trim();
            } else if (p.classList.contains('fragmento')) {
              fragmentos.push(text);
            }
          });
        }

        // Parse título into type, number, year, colegiado
        // Format: "Acórdão 277/2026 - Plenário"
        let tipoDocumento = '';
        let numeroAcordao = '';
        let anoAcordao = '';
        let colegiado = '';

        const tituloMatch = titulo.match(/^(.+?)\s+(\d+)\/(\d{4})\s*-\s*(.+)$/);
        if (tituloMatch) {
          tipoDocumento = tituloMatch[1].trim();
          numeroAcordao = tituloMatch[2];
          anoAcordao = tituloMatch[3];
          colegiado = tituloMatch[4].trim();
        }

        if (titulo) {
          items.push({
            titulo,
            tipoDocumento,
            numeroAcordao,
            anoAcordao,
            colegiado,
            relator,
            sumario: sumario.substring(0, 10000),
            fragmentos,
            link: link ? `https://pesquisa.apps.tcu.gov.br${link}` : '',
          });
        }
      });

      return items;
    });

    return results;
  }

  /**
   * Check if there's a next page of results
   * @returns {boolean}
   */
  async hasNextPage() {
    try {
      const nextBtn = this.page.locator('button.mat-mdc-paginator-navigation-next').last();
      if (!(await nextBtn.isVisible())) return false;
      const isDisabled = await nextBtn.evaluate(el => el.disabled);
      return !isDisabled;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    await this._dismissOverlays();
    const nextBtn = this.page.locator('button.mat-mdc-paginator-navigation-next').last();
    await nextBtn.scrollIntoViewIfNeeded();
    await nextBtn.click({ force: true });
    await this.page.waitForTimeout(2000);
    await this.page.waitForSelector('.lista-resultado__content', { timeout: 15000 }).catch(() => {});
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const rangeLabel = await this.page.locator('.mat-mdc-paginator-range-label').textContent();
      // Format: "1 - 20 de 21.657"
      const match = rangeLabel.match(/de\s+([\d.]+)/);
      return match ? parseInt(match[1].replace(/\./g, ''), 10) : null;
    } catch {
      return null;
    }
  }
}

module.exports = TCUCrawler;
