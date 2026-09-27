const BaseCrawler = require('./BaseCrawler');
const { aguardarIntervencao } = require('./navegadorAssistido');

const FORMULARIO = '#iddados\\.buscaInteiroTeor';
const RESULTADOS = 'tr.fundocinza1';

/**
 * Crawler for TJSP (Tribunal de Justiça de São Paulo) jurisprudência
 * https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do
 */
class TJSPCrawler extends BaseCrawler {
  constructor(options = {}) {
    super(options);
    this.baseUrl = 'https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do';
    this.silent = options.silent ?? false;
  }

  log(message) {
    if (!this.silent) console.log(message);
  }

  /** Sinais visíveis do bloqueio, sem tratar menções em ementas como CAPTCHA. */
  async detectarDesafio() {
    return this.page.evaluate(() => {
      const visivel = (el) => {
        if (!el || !el.getClientRects().length) return false;
        const area = el.getBoundingClientRect();
        if (area.width <= 0 || area.height <= 0) return false;
        for (let atual = el; atual; atual = atual.parentElement) {
          const css = getComputedStyle(atual);
          if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
        }
        return true;
      };
      const token = [...document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]')].some((el) => el.value?.trim());
      const frames = [...document.querySelectorAll('iframe')].filter(visivel);
      if (frames.some((el) => {
        const descricao = `${el.title} ${el.src}`;
        if (!/captcha|turnstile|challenge/i.test(descricao)) return false;
        // O e-SAJ mantém o selo do reCAPTCHA invisível junto ao formulário.
        // Sua presença não é um pedido de interação; o bframe aberto é.
        if (/\/anchor(?:\?|#)/i.test(el.src) && /(?:[?&])size=invisible(?:&|$)/i.test(el.src)) return false;
        if (el.closest('.grecaptcha-badge') && !/bframe|challenge/i.test(descricao)) return false;
        // O anchor pode permanecer visível depois de uma resposta válida.
        return !token || /bframe|challenge/i.test(descricao);
      })) return true;
      if ([...document.querySelectorAll('#challenge-form, #cf-challenge-running, input[name*="captcha" i]:not([type="hidden"]), input[id*="captcha" i]:not([type="hidden"])')].some(visivel)) return true;
      if (/captcha|verifica[çc][aã]o.*(?:seguran[çc]a|human)|um momento|just a moment/i.test(document.title)) return true;
      // Textos extensos da jurisprudência podem citar robôs ou CAPTCHA.
      const portal = [...document.querySelectorAll('tr.fundocinza1, [id="iddados.buscaInteiroTeor"]')].some(visivel);
      if (portal) return false;
      const texto = document.body?.innerText || '';
      return /(?:confirme|verifique|prove).{0,65}(?:human|rob[oô])|n[aã]o sou um rob[oô]|verifica[çc][aã]o (?:de seguran[çc]a|autom[aá]tica|humana)|valid[aã][çc][aã]o de seguran[çc]a|captcha/i.test(texto);
    });
  }

  async _portalDisponivel() {
    if (await this.detectarDesafio()) return false;
    if (await this.page.locator(FORMULARIO).isVisible() || await this.page.locator(RESULTADOS).first().isVisible()) return true;
    return this._resultadoVazioExplicito();
  }

  async _resultadoVazioExplicito() {
    const texto = await this.page.locator('body').innerText();
    return /nenhum (?:resultado|ac[oó]rd[aã]o|registro|documento) (?:foi )?encontrado|n[aã]o (?:foram|foi) encontrad[oa]s? (?:resultados|ac[oó]rd[aã]os|registros|documentos)|n[aã]o h[aá] (?:resultados|ac[oó]rd[aã]os|registros|documentos)/i.test(texto);
  }

  async _aguardarDesafio() {
    if (!(await this.detectarDesafio())) return false;
    const concluido = await aguardarIntervencao(this.page, {
      verificar: () => this._portalDisponivel(),
      mensagem: 'O TJSP solicitou uma verificação. Resolva o desafio na tela e selecione Continuar.',
    });
    if (!concluido) throw new Error('TJSP: a consulta foi bloqueada por CAPTCHA ou verificação de segurança. Ative a intervenção manual para tentar novamente.');
    return true;
  }

  /**
   * Navigate to the jurisprudência search page
   */
  async navigateToSearch() {
    await this.page.goto(this.baseUrl);
    await this._aguardarDesafio();
    await this.waitForLoad();
    await this._aguardarDesafio();
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
      this.log('Enabled: 2° grau');
    } else {
      if (await grau2.isChecked()) await grau2.uncheck();
    }

    if (filters.origemRecursal !== false) {
      if (!(await recursal.isChecked())) await recursal.check();
      this.log('Enabled: Colégios Recursais');
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
      this.log(`Set judgment start date: ${filters.dataJulgamentoInicio}`);
    }
    if (filters.dataJulgamentoFim) {
      await this.page.locator('#iddados\\.dtJulgamentoFim').fill(filters.dataJulgamentoFim);
      this.log(`Set judgment end date: ${filters.dataJulgamentoFim}`);
    }

    // Configure publication dates
    if (filters.dataPublicacaoInicio) {
      await this.page.locator('#iddados\\.dtPublicacaoInicio').fill(filters.dataPublicacaoInicio);
      this.log(`Set publication start date: ${filters.dataPublicacaoInicio}`);
    }
    if (filters.dataPublicacaoFim) {
      await this.page.locator('#iddados\\.dtPublicacaoFim').fill(filters.dataPublicacaoFim);
      this.log(`Set publication end date: ${filters.dataPublicacaoFim}`);
    }
  }

  /**
   * Execute the search with the given query
   * @param {string} query - Search text (supports operators: E, OU, NAO, "")
   */
  async executeSearch(query) {
    await this.page.locator('#iddados\\.buscaInteiroTeor').fill(query);
    this.log(`Set search query: ${query}`);

    await this.page.locator('#pbSubmit').click();
    await this._aguardarDesafio();
    await this.waitForLoad();
    await this.page.waitForTimeout(3000);
    await this._aguardarDesafio();
  }

  /**
   * Extract results from the current page
   * @returns {Array<Object>} Array of result objects
   */
  async extractResults() {
    const houveIntervencao = await this._aguardarDesafio();
    await this.page.waitForSelector('tr.fundocinza1', { timeout: 15000 }).catch(() => {});
    await this._aguardarDesafio();
    // Uma verificação pode devolver o formulário em vez da página consultada.
    // Isso não demonstra que a busca teve zero resultados.
    if (!(await this.page.locator(RESULTADOS).count()) &&
        (houveIntervencao || await this.page.locator(FORMULARIO).isVisible()) &&
        !(await this._resultadoVazioExplicito())) {
      throw new Error('TJSP: a página de resultados não foi confirmada após a verificação. Inicie uma nova busca.');
    }

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

    this.log(`Found ${pageResults.length} result items on page`);
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
    await this._aguardarDesafio();
    await this.waitForLoad();
    await this.page.waitForTimeout(2000);
    await this._aguardarDesafio();
  }

  /**
   * Get the total number of results
   * @returns {number|null}
   */
  async getTotalResults() {
    await this._aguardarDesafio();
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
