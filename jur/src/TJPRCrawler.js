const fs = require('fs');
const path = require('path');
const BaseCrawler = require('./BaseCrawler');
const { sanitizeFilename } = require('./inteiroTeorFetcher');

/**
 * Crawler for TJPR (Tribunal de Justiça do Paraná) jurisprudência
 * https://portal.tjpr.jus.br/jurisprudencia/
 *
 * TJPR is unusual: the íntegra do acórdão is not exposed as a downloadable URL.
 * It is loaded inline on the processo page after clicking a JS trigger
 * ("Íntegra do Acórdão" / "Carregar documento"). Hence the Playwright-based
 * fetchInteiroTeorBatch below — the generic HTTP-based inteiroTeorFetcher
 * cannot serve TJPR.
 */
class TJPRCrawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=iniciar';
  }

  /**
   * Navigate to the jurisprudência search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl);
    await this.waitForLoad();
    // Wait for the main search form to be ready
    await this.page.waitForSelector('#criterioPesquisa', { timeout: 15000 });
  }

  /**
   * Configure search filters
   * @param {Object} filters
   * @param {string} filters.dataJulgamentoInicio - Start date for judgment (DD/MM/YYYY)
   * @param {string} filters.dataJulgamentoFim - End date for judgment (DD/MM/YYYY)
   * @param {string} filters.localPesquisa - Search scope: 1=EMENTA, 2=INTEIRO TEOR, 99=AMBAS (default: 2)
   */
  async configureFilters(filters = {}) {
    // Advanced filter panel (date range, scope) is hidden by default since the
    // 2026 portal redesign — open it via toggleFiltros() before touching fields.
    await this.page.evaluate(() => {
      if (typeof toggleFiltros === 'function') toggleFiltros();
    });
    await this.page.waitForSelector('#idLocalPesquisa', { state: 'visible', timeout: 10000 });

    // Set search scope (default: INTEIRO TEOR = value 2)
    const localPesquisa = filters.localPesquisa || '2';
    await this.page.selectOption('#idLocalPesquisa', localPesquisa);
    console.log(`Set search scope: ${localPesquisa === '1' ? 'EMENTA' : localPesquisa === '2' ? 'INTEIRO TEOR' : 'AMBAS'}`);

    // Configure judgment start date
    if (filters.dataJulgamentoInicio) {
      const field = this.page.locator('#dataJulgamentoInicio');
      await field.click();
      await field.fill(filters.dataJulgamentoInicio);
      console.log(`Set judgment start date: ${filters.dataJulgamentoInicio}`);
    }

    // Configure judgment end date
    if (filters.dataJulgamentoFim) {
      const field = this.page.locator('#dataJulgamentoFim');
      await field.click();
      await field.fill(filters.dataJulgamentoFim);
      console.log(`Set judgment end date: ${filters.dataJulgamentoFim}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text (supports operators: E, OU, !NAO, PROX, $)
   */
  async executeSearch(query) {
    const searchBox = this.page.locator('#criterioPesquisa');
    await searchBox.click();
    await searchBox.fill(query);
    console.log(`Set search query: ${query}`);

    // Click the Pesquisar button
    await this.page.locator('input[name="iniciar"]').click();
    await this.waitForLoad();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    // Wait for the results table to load
    await this.page.waitForSelector('table.resultTable.jurisprudencia', { timeout: 10000 }).catch(() => {});

    const pageResults = await this.page.evaluate(() => {
      const items = [];
      const table = document.querySelector('table.resultTable.jurisprudencia');
      if (!table) return items;

      // Skip header row (index 0)
      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dadosCell = row.querySelector('td.juris-tabela-dados');
        const ementaCell = row.querySelector('td.juris-tabela-ementa');
        if (!dadosCell) continue;

        // Extract ID from checkbox
        const checkbox = dadosCell.querySelector('input[name="idsSelecionados"]');
        const id = checkbox ? checkbox.value : '';

        // Extract process link and number (class is "decisao negrito" or "acordao negrito")
        const processLink = dadosCell.querySelector('a[href*="/jurisprudencia/j/"]');
        const numeroProcesso = processLink ? processLink.textContent.trim() : '';
        const processoUrl = processLink ? processLink.href : '';

        // Extract type from the font element after the link, e.g., "(Acórdão)" or "(Decisão monocrática)"
        let tipoDocumento = '';
        const typeFonts = dadosCell.querySelectorAll('font:not(.negrito)');
        for (const f of typeFonts) {
          const typeMatch = f.textContent.match(/\(([^)]+)\)/);
          if (typeMatch) { tipoDocumento = typeMatch[1].trim(); break; }
        }
        // Fallback: extract type from the URL pattern /jurisprudencia/j/ID/TYPE-PROCESS
        if (!tipoDocumento && processoUrl) {
          const urlTypeMatch = decodeURIComponent(processoUrl).match(/\/jurisprudencia\/j\/\d+\/([^-]+)-/);
          tipoDocumento = urlTypeMatch ? urlTypeMatch[1].trim() : '';
        }

        // Extract fields from the properties div
        const propsDiv = dadosCell.querySelector('.juris-tabela-propriedades');
        const propsText = propsDiv ? propsDiv.textContent : '';

        // Relator
        const relatorMatch = propsText.match(/Relator:\s*([\s\S]*?)(?=\n\s*Processo:)/);
        const relator = relatorMatch ? relatorMatch[1].replace(/\s+/g, ' ').trim() : '';

        // Orgao Julgador
        const orgaoMatch = propsText.match(/Órgão Julgador:\s*(.+?)(?=\n|Data)/);
        const orgaoJulgador = orgaoMatch ? orgaoMatch[1].trim() : '';

        // Data Julgamento
        const dataMatch = propsText.match(/Data Julgamento:\s*(\d{2}\/\d{2}\/\d{4})/);
        const dataJulgamento = dataMatch ? dataMatch[1] : '';

        // Extract ementa from the ementa cell
        let ementa = '';
        if (ementaCell) {
          const ementaDiv = ementaCell.querySelector('div[id^="ementa"]');
          if (ementaDiv) {
            ementa = ementaDiv.textContent.trim();
          } else {
            // Fallback: get text from the cell, excluding "Leia mais" link
            ementa = ementaCell.textContent.replace(/Leia mais\.\./, '').trim();
          }
        }

        if (numeroProcesso || id) {
          items.push({
            id,
            tipoDocumento,
            numeroProcesso,
            processoUrl,
            orgaoJulgador,
            dataJulgamento,
            relator,
            ementa: ementa.substring(0, 10000),
          });
        }
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
      // Active next page link has class "arrowNextOn"; disabled is "arrowNextOff"
      const nextLink = this.page.locator('a.arrowNextOn').first();
      return await nextLink.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Navigate to the next page of results
   */
  async goToNextPage() {
    // TJPR pagination uses form submission via JavaScript href
    // Extract the next page number from the "Próxima Página" link and submit the form
    await this.page.evaluate(() => {
      const nextLink = document.querySelector('a.arrowNextOn');
      if (nextLink) {
        // Extract page number from the href JavaScript
        const match = nextLink.href.match(/pageNumber.*?value='(\d+)'/);
        if (match) {
          const form = document.forms['pesquisaForm'];
          form['pageNumber'].value = match[1];
          form['sortColumn'].value = 'processo_sDataJulgamento';
          form['sortOrder'].value = 'DESC';
          form.submit();
        }
      }
    });
    await this.waitForLoad();
    await this.page.waitForTimeout(1500);
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    try {
      const bodyText = await this.page.locator('body').textContent();
      const match = bodyText.match(/([\d.]+)\s*registro\(s\)\s*encontrado\(s\)/);
      if (match) {
        return parseInt(match[1].replace(/\./g, ''), 10);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Download the inteiro teor for each result using a fresh browser session.
   * Each result must carry a `processoUrl`; the íntegra is captured by clicking
   * the inline trigger on that page and dumping the rendered text.
   *
   * @param {Array<Object>} results - Results from search() with processoUrl set
   * @param {string} outputDir - Directory to save .txt files into
   * @param {Object} options
   * @param {Function} options.log - Logger (defaults to console.log)
   * @param {number} options.minCachedSize - Skip re-download if existing file > N bytes (default 5000)
   * @returns {Array<Object>} results enriched with `arquivo` (filename) or `downloadError`
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const minCachedSize = options.minCachedSize ?? 5000;

    fs.mkdirSync(outputDir, { recursive: true });
    await this.init();

    const downloaded = [];
    try {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.processoUrl) {
          log(`  [${i + 1}/${results.length}] skip — no processoUrl`);
          downloaded.push({ ...r, arquivo: null, downloadError: 'no processoUrl' });
          continue;
        }

        const baseName = sanitizeFilename(r.numeroProcesso || r.id || `r${i}`);
        const filename = `${baseName}.txt`;
        const filepath = path.join(outputDir, filename);

        if (fs.existsSync(filepath) && fs.statSync(filepath).size > minCachedSize) {
          log(`  [${i + 1}/${results.length}] cached ${baseName}`);
          downloaded.push({ ...r, arquivo: filename });
          continue;
        }

        log(`  [${i + 1}/${results.length}] ${baseName}`);
        try {
          const text = await this._fetchInteiroTeorPage(r.processoUrl);
          fs.writeFileSync(filepath, text, 'utf-8');
          log(`    saved ${text.length} chars`);
          downloaded.push({ ...r, arquivo: filename });
        } catch (err) {
          log(`    FAILED: ${err.message}`);
          downloaded.push({ ...r, arquivo: null, downloadError: err.message });
        }
      }

      const indexPath = path.join(outputDir, 'index.json');
      fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
      log(`Index saved to: ${indexPath}`);

      return downloaded;
    } finally {
      await this.close();
    }
  }

  /**
   * Visit a processo page, click the inline "carregar" trigger, and capture
   * the rendered body + frame text. Used by fetchInteiroTeorBatch.
   * @private
   */
  async _fetchInteiroTeorPage(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForTimeout(2000);

    const triggers = [
      'a:has-text("Íntegra do Acórdão")',
      'a:has-text("Integra do Acordao")',
      'a:has-text("Carregar documento")',
      'a:has-text("Carregar")',
      'a:has-text("Inteiro Teor")',
    ];
    for (const sel of triggers) {
      try {
        const loc = this.page.locator(sel).first();
        if (await loc.count()) {
          await loc.click({ timeout: 5000 });
          await this.page.waitForTimeout(4000);
          break;
        }
      } catch {}
    }

    // Heuristic: wait until the body looks like an acórdão (has currency,
    // VOTO/Acordam/etc., and is reasonably long). Best-effort, not strict.
    try {
      await this.page.waitForFunction(() => {
        const t = document.body.innerText || '';
        return /R\$\s*\d|VOTO|Vistos,|Acordam|Relatório/i.test(t) && t.length > 4000;
      }, { timeout: 10000 });
    } catch {}

    let combined = await this.page.evaluate(() => document.body.innerText || '');
    for (const fr of this.page.frames()) {
      try {
        const t = await fr.evaluate(() => (document.body && document.body.innerText) || '');
        if (t && !combined.includes(t)) combined += '\n\n=== FRAME ===\n' + t;
      } catch {}
    }
    return combined;
  }
}

module.exports = TJPRCrawler;
