// src/TJMACrawler.js
const TJMANavigator = require('./TJMANavigator');

/**
 * Crawler for TJMA (Tribunal de Justiça do Maranhão) jurisprudência.
 * Portal: https://jurisconsult.tjma.jus.br/#/sg-jurisprudence-form
 *
 * ⚠️ STATUS: SEM ACESSO. A busca do TJMA é barrada por captcha de imagem +
 * reCAPTCHA v2 invisible, ambos validados no servidor, e este repositório não
 * automatiza resolução de captcha. `search()` monta a requisição corretamente
 * e falha de forma explícita (CaptchaBloqueadoError) no portão.
 *
 * Isto NÃO é código morto. Ele existe para três coisas:
 *   1. guardar o contrato completo da API, verificado no DOM vivo em
 *      25/07/2026 (human-codegen/TJMA/09-jurisconsult/);
 *   2. dar ao `jur-fixer` um ponto de partida: `diagnosticar()` diz, ao vivo,
 *      se o bloqueio ainda existe;
 *   3. voltar a funcionar sem reescrita no dia em que o TJMA desligar o
 *      reCAPTCHA — só o captcha de imagem restaria, e ele é respondível
 *      por uma pessoa via `credenciais`.
 *
 * Como o TJPA, não estende BaseCrawler/Playwright: a conversa é HTTP puro.
 * O contrato público é o mesmo dos irmãos: search(query, filters, options).
 */
class TJMACrawler {
  constructor(options = {}) {
    this.pageSize = options.pageSize ?? 20;
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJMANavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    /** {tokenCaptcha, respostaCaptcha, tokenG, keyId} — fornecidos por uma pessoa. */
    this.credenciais = options.credenciais ?? {};
  }

  /**
   * Converte DD/MM/YYYY (padrão da CLI) para YYYY-MM-DD (formato da API).
   * O próprio site faz essa conversão (setDateInicio/setDateFinal).
   * @private
   */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Converte YYYY-MM-DD para DD/MM/YYYY na saída. @private */
  _toBrDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  }

  /**
   * Resolve o relatório a partir dos filtros da CLI.
   *
   * ESTA é a desambiguação do TJMA: Justiça Comum × Turma Recursal × Juizado
   * não é um filtro dentro da busca, é a escolha do relatório — e cada um
   * bate numa rota diferente sobre uma base diferente.
   *
   *   foro=comum    + tipo=acordao      → Acórdãos (2º grau)          [rel 1]
   *   foro=comum    + tipo=monocratica  → Decisões Monocráticas       [rel 2]
   *   foro=turmas   + tipo=acordao      → Acórdãos - Turma Recursal   [rel 6]
   *   foro=turmas   + tipo=monocratica  → Dec. Monocráticas - TR      [rel 5]
   *   foro=comum    + tipo=sentenca     → Sentenças de 1º Grau        [rel 4]
   *   foro=juizados                     → Sentenças - Juizado Especial[rel 7]
   *
   * @returns {Object} entrada de TJMANavigator.RELATORIOS + a chave
   */
  resolverRelatorio(filters = {}) {
    if (filters.relatorio) {
      const r = TJMANavigator.RELATORIOS[filters.relatorio];
      if (!r) {
        throw new Error(
          `Relatório desconhecido: "${filters.relatorio}". ` +
          `Use um de: ${Object.keys(TJMANavigator.RELATORIOS).join(', ')}`,
        );
      }
      return { chave: filters.relatorio, ...r };
    }
    const foro = filters.foro ?? 'comum';
    const tipo = filters.tipo ?? 'acordao';

    if (foro === 'juizados') return { chave: 'sentencas-je', ...TJMANavigator.RELATORIOS['sentencas-je'] };
    if (foro === 'turmas') {
      const chave = tipo === 'monocratica' ? 'monocraticas-tr' : 'acordaos-tr';
      return { chave, ...TJMANavigator.RELATORIOS[chave] };
    }
    // foro comum
    const chave = tipo === 'monocratica' ? 'monocraticas'
      : tipo === 'sentenca' ? 'sentencas'
        : 'acordaos';
    return { chave, ...TJMANavigator.RELATORIOS[chave] };
  }

  /**
   * Monta os parâmetros da querystring para o relatório escolhido.
   *
   * Cuidado deliberado: o NOME do campo de id muda entre rotas
   * (pkmatricula × matricula_id, pkcamara × camara_id, id_classe × classe_id).
   * Quem trata todos os relatórios igual manda o parâmetro errado e recebe
   * silenciosamente a base inteira. Por isso `rel.chaves` existe.
   * @private
   */
  _buildParams(query, filters, rel, inicioPagina, fimPagina) {
    const avancado = this._temFiltroAvancado(filters, rel) ? 1 : 0;
    const params = {
      chave: query,
      tipoPesquisa: filters.tipoPesquisa ?? rel.tipoPesquisaPadrao,
      checkForm: avancado,
      inicioPagina,
      fimPagina,
    };

    // datas: o site só as envia quando a busca avançada está ligada
    if (avancado) {
      params.dtaInicio = this._toApiDate(filters.dataInicio);
      params.dtaFim = this._toApiDate(filters.dataFim);
    }

    const tem = (c) => rel.campos.includes(c);

    if (tem('sistema') && filters.sistema) {
      params.sistema = TJMANavigator.SISTEMAS[filters.sistema] ?? filters.sistema;
    }
    if (tem('condicao') && filters.condicao) {
      params.condicao = TJMANavigator.CONDICOES[filters.condicao] ?? filters.condicao;
    }
    if (tem('fraseExata') && filters.fraseExata) params.fraseExata = true;

    if (avancado) {
      if (tem('relator') && filters.relator) params.relator = filters.relator;
      if (tem('revisor') && filters.revisor) params.revisor = filters.revisor;
      if (tem('camara') && filters.orgao) params.camara = filters.orgao;
      if (tem('comarca') && filters.comarca) params.comarca = filters.comarca;
      if (tem('vara') && filters.vara) params.vara = filters.vara;
      if (tem('classe') && filters.classe) params.classe = filters.classe;
    }
    return params;
  }

  /** Algum filtro exige `checkForm=1` (busca avançada)? @private */
  _temFiltroAvancado(filters, rel) {
    if (filters.dataInicio || filters.dataFim) return true;
    for (const c of ['relator', 'revisor', 'classe']) {
      if (rel.campos.includes(c) && filters[c]) return true;
    }
    if (rel.campos.includes('camara') && filters.orgao) return true;
    if (rel.campos.includes('comarca') && filters.comarca) return true;
    if (rel.campos.includes('vara') && filters.vara) return true;
    return false;
  }

  /**
   * Mapeia um registro cru da API para o formato padrão do repositório.
   *
   * ⚠️ Os nomes de campo abaixo vêm do bundle da SPA (chunk build/197.js:
   * `pkProtocolo`, `txEmenta`, `int_count`, `NUMCOL`), NÃO de um payload real
   * observado — nenhuma busca chegou a completar. Se um dia a busca abrir,
   * conferir este mapa contra a resposta de verdade é o primeiro passo.
   */
  mapProcesso(p, rel) {
    return {
      id: p.NUMCOL ?? p.pkProtocolo ?? null,
      tipoDocumento: rel.titulo,
      relatorio: rel.chave,
      processo: p.pkProtocolo ?? p.numeroProcesso ?? '',
      processoUrl: this.navigator.formularioUrl(),
      orgaoJulgador: p.txCamara ?? p.camara ?? '',
      comarca: p.txComarca ?? p.comarca ?? '',
      classe: p.txClasse ?? p.classe ?? '',
      dataJulgamento: '', // o TJMA não expõe data de julgamento neste módulo
      dataPublicacao: this._toBrDate(p.dtPublicacao ?? p.dataPublicacao ?? ''),
      relator: p.txRelator ?? p.relator ?? '',
      uf: 'MA',
      ementa: String(p.txEmenta ?? '').replace(/<[^>]+>/g, '').trim().substring(0, 10000),
      inteiroTeorLink: this.navigator.formularioUrl(),
    };
  }

  /**
   * Diagnóstico ao vivo do bloqueio — o que o `jur-fixer` deve rodar primeiro.
   * Não depende de captcha: usa só rotas abertas.
   *
   * @returns {Object} {apiNoAr, relatorios, recaptcha, bloqueado, resumo}
   */
  async diagnosticar() {
    const out = { apiNoAr: false, relatorios: 0, recaptcha: null, bloqueado: true, resumo: '' };
    try {
      const rels = await this.navigator.listaRelatorios();
      out.apiNoAr = true;
      out.relatorios = rels.length;
    } catch (err) {
      out.resumo = `API do JurisConsult fora do ar ou mudou: ${err.message}`;
      return out;
    }
    try {
      out.recaptcha = await this.navigator.recaptchaHabilitado();
      out.bloqueado = out.recaptcha.habilitado;
    } catch (err) {
      out.resumo = `Não foi possível ler o estado do reCAPTCHA: ${err.message}`;
      return out;
    }
    out.resumo = out.bloqueado
      ? 'API no ar, mas o reCAPTCHA continua LIGADO: a busca segue bloqueada (esperado).'
      : 'reCAPTCHA DESLIGADO no servidor — a busca pode ter voltado a ser viável. '
        + 'Revalide src/TJMACrawler.js contra um payload real e atualize CLAUDE-TJMA.md.';
    return out;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   *
   * @param {string} query - termo (vai no parâmetro `chave`)
   * @param {Object} filters - foro ('comum'|'turmas'|'juizados'),
   *   tipo ('acordao'|'monocratica'|'sentenca'), relatorio (chave explícita),
   *   dataInicio/dataFim (DD/MM/YYYY, PUBLICAÇÃO — o TJMA não filtra por
   *   julgamento), condicao ('e'|'ou'|'unico'), fraseExata, sistema
   *   ('todos'|'themis'|'pje'), relator, revisor, orgao, comarca, vara,
   *   classe, tipoPesquisa (opcao_id)
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults
   * @throws {TJMANavigator.CaptchaBloqueadoError} enquanto o TJMA exigir captcha
   */
  async search(query, filters = {}, options = {}) {
    if (!query) throw new Error('Informe o termo de busca (-q).');

    const rel = this.resolverRelatorio(filters);
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    this.log(`Relatório: ${rel.titulo} (id ${rel.id}) — foro ${rel.foro}, ${rel.grau}º grau`);

    if (!this.credenciais.tokenG) {
      // Falha cedo e com a razão certa, em vez de bater na API para ouvir 403.
      const diag = await this.diagnosticar().catch(() => null);
      if (!diag || diag.bloqueado) {
        throw new TJMANavigator.CaptchaBloqueadoError(
          TJMANavigator.explicarBloqueio('invalid_captcha_g'),
          { status: 403, codigo: 'invalid_captcha_g' },
        );
      }
      this.log('reCAPTCHA aparentemente desligado no servidor — tentando a busca mesmo assim.');
    }

    const allResults = [];
    let totalResults = null;

    for (let page = 0; page < maxPages; page++) {
      const inicioPagina = page * this.pageSize + 1;
      const fimPagina = (page + 1) * this.pageSize;
      this.log(`Extracting results from page ${page + 1} (registros ${inicioPagina}-${fimPagina})...`);

      const params = this._buildParams(query, filters, rel, inicioPagina, fimPagina);
      const { processos, total } = await this.navigator.buscar(rel.rota, params, this.credenciais);

      if (totalResults === null) {
        totalResults = total;
        this.log(`Total results on server: ${totalResults}`);
      }
      allResults.push(...processos.map((p) => this.mapProcesso(p, rel)));
      this.log(`Found ${processos.length} results on page ${page + 1} (total: ${allResults.length})`);

      if (allResults.length >= maxResults) {
        allResults.length = maxResults;
        break;
      }
      if (processos.length < this.pageSize) break;
    }

    allResults.totalResults = totalResults;
    return allResults;
  }
}

module.exports = TJMACrawler;
