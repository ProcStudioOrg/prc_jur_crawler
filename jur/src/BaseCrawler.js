const { chromium, firefox } = require('playwright');

/**
 * Abstract base class for web crawlers.
 * Extend this class and implement the abstract methods for specific websites.
 */
class BaseCrawler {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.slowMo = options.slowMo ?? 0;
    this.timeout = options.timeout ?? 30000;
    this.extraArgs = options.extraArgs ?? [];
    this.browserType = options.browserType ?? 'chromium'; // 'chromium' or 'firefox'
    this.useSystemChrome = options.useSystemChrome ?? false;
  }

  /**
   * Initialize the browser and page
   */
  async init() {
    const launcher = this.browserType === 'firefox' ? firefox : chromium;
    const defaultArgs = this.browserType === 'chromium' && this.headless
      ? ['--disable-blink-features=AutomationControlled']
      : [];

    const launchOptions = {
      headless: this.headless,
      slowMo: this.slowMo,
      args: [...defaultArgs, ...this.extraArgs],
    };

    // Use system Chrome if specified
    if (this.useSystemChrome) {
      launchOptions.channel = 'chrome';
    }

    this.browser = await launcher.launch(launchOptions);
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);
  }

  /**
   * Close browser and cleanup
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  /**
   * Abstract method - Navigate to the search page
   * @throws {Error} Must be implemented by subclass
   */
  async navigateToSearch() {
    throw new Error('navigateToSearch() must be implemented by subclass');
  }

  /**
   * Abstract method - Configure search filters (dates, categories, etc.)
   * @param {Object} filters - Filter configuration
   * @throws {Error} Must be implemented by subclass
   */
  async configureFilters(filters) {
    throw new Error('configureFilters() must be implemented by subclass');
  }

  /**
   * Abstract method - Execute the search with given query
   * @param {string} query - Search query text
   * @throws {Error} Must be implemented by subclass
   */
  async executeSearch(query) {
    throw new Error('executeSearch() must be implemented by subclass');
  }

  /**
   * Abstract method - Extract results from current page
   * @returns {Array} Array of result objects
   * @throws {Error} Must be implemented by subclass
   */
  async extractResults() {
    throw new Error('extractResults() must be implemented by subclass');
  }

  /**
   * Abstract method - Check if there's a next page
   * @returns {boolean}
   * @throws {Error} Must be implemented by subclass
   */
  async hasNextPage() {
    throw new Error('hasNextPage() must be implemented by subclass');
  }

  /**
   * Abstract method - Navigate to next page
   * @throws {Error} Must be implemented by subclass
   */
  async goToNextPage() {
    throw new Error('goToNextPage() must be implemented by subclass');
  }

  /**
   * Main search method that orchestrates the crawling
   * @param {string} query - Search query
   * @param {Object} filters - Filter options (dates, etc.)
   * @param {Object} options - Additional options
   * @returns {Array} All collected results
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? Infinity;
    const maxResults = options.maxResults ?? Infinity;
    const allResults = [];
    let currentPage = 1;
    let totalResults = null;

    try {
      await this.init();
      await this.navigateToSearch();
      await this.configureFilters(filters);
      await this.executeSearch(query);

      // Try to get total results count after search executes
      if (typeof this.getTotalResults === 'function') {
        totalResults = await this.getTotalResults();
        if (totalResults !== null) {
          console.log(`Total results on server: ${totalResults}`);
        }
      }

      while (currentPage <= maxPages) {
        console.log(`Extracting results from page ${currentPage}...`);
        const results = await this.extractResults();
        allResults.push(...results);
        console.log(`Found ${results.length} results on page ${currentPage} (total: ${allResults.length})`);

        if (allResults.length >= maxResults) {
          console.log(`Reached maxResults limit (${maxResults}), stopping.`);
          allResults.length = maxResults;
          break;
        }

        if (!(await this.hasNextPage()) || currentPage >= maxPages) {
          break;
        }

        await this.goToNextPage();
        currentPage++;
      }

      // Attach metadata to the results array so callers can access totalResults
      allResults.totalResults = totalResults;

      return allResults;
    } finally {
      await this.close();
    }
  }

  /**
   * Helper to wait for navigation
   */
  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Helper to take screenshot
   * @param {string} filename
   */
  async screenshot(filename) {
    await this.page.screenshot({ path: filename, fullPage: true });
  }
}

module.exports = BaseCrawler;
