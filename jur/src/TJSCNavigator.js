// src/TJSCNavigator.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator do portal de jurisprudência do TJSC (o NOVO, dentro do e-Proc):
 * https://eprocwebcon.tjsc.jus.br/consulta1g/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 *
 * É o mesmo módulo `eproc-jur` do TRF4 (mesmos ids: #txtPesquisa, #selOrigem,
 * #dtDecisaoInicio, .resultadoItem, .paginaProxima), com um combo de origem
 * próprio e um bloqueio na frente.
 *
 * POR QUE BROWSER (e não HTTP direto, que seria o preferido):
 *   O host está atrás de um F5/Shape ("Verificação de segurança do portal
 *   institucional", cookies `TS...` e `f5avraaa...`). A primeira resposta é SEMPRE uma
 *   página de desafio que só resolve executando JavaScript. Sem browser não há
 *   como obter os cookies. Depois de resolvido, o mesmo contexto serve para
 *   baixar o inteiro teor por HTTP (ctx.request) sem abrir aba nova.
 *
 * DUAS ARMADILHAS confirmadas na prática (ver CLAUDE-TJSC.md):
 *   1. Com o User-Agent padrão do Playwright (`HeadlessChrome/...`) o desafio
 *      NUNCA libera — 8 tentativas seguidas devolveram a página de bloqueio.
 *      Com um UA de Chrome comum libera na 1ª. Por isso o UA é fixado aqui.
 *   2. Mesmo com UA bom o desafio às vezes precisa de um segundo GET (o 1º só
 *      instala o cookie). Daí o laço de `abrir()`.
 *
 * O portal ANTIGO (https://busca.tjsc.jus.br/jurisprudencia/) continua no ar e
 * fala HTTP puro, mas é base histórica congelada — ver CLAUDE-TJSC.md.
 */

const BASE = 'https://eprocwebcon.tjsc.jus.br/consulta1g/';
const PAGE_URL = `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`;
/** Entrada divulgada pelo tribunal; redireciona para PAGE_URL. */
const PORTAL_URL = 'https://eproc1g.tjsc.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar';

/**
 * Combo "Origem" (#selOrigem) — É AQUI QUE MORA A DESAMBIGUAÇÃO
 * Justiça Comum × Juizados Especiais. Valores lidos do DOM vivo
 * (human-codegen/TJSC/01-eproc-jurisprudencia/02-origens.json).
 */
const ORIGENS = {
  comum: '1',          // TJSC                     -> JUSTIÇA COMUM (2º grau)
  turmas: '3',         // Turmas Recursais         -> JUIZADOS ESPECIAIS
  uniformizacao: '4',  // Turmas de Uniformização  -> JUIZADOS ESPECIAIS (uniformização)
  conselho: '5',       // Conselho da Magistratura -> administrativo
};

const ORIGENS_LABEL = {
  1: 'TJSC (Justiça Comum)',
  3: 'Turmas Recursais (Juizados Especiais)',
  4: 'Turmas de Uniformização (Juizados Especiais)',
  5: 'Conselho da Magistratura',
};

/** Aliases aceitos na CLI -> chave de ORIGENS (ou 'todas'). */
const ORIGENS_ALIAS = {
  comum: 'comum', 'justica-comum': 'comum', tjsc: 'comum', tj: 'comum', 'segundo-grau': 'comum',
  turmas: 'turmas', 'turmas-recursais': 'turmas', juizados: 'turmas', juizado: 'turmas',
  'juizados-especiais': 'turmas', recursal: 'turmas',
  uniformizacao: 'uniformizacao', 'turmas-uniformizacao': 'uniformizacao', tu: 'uniformizacao',
  conselho: 'conselho', 'conselho-magistratura': 'conselho', cm: 'conselho',
  todas: 'todas', todos: 'todas', ambas: 'todas',
};

/**
 * Combo "Tipo de documento" (#selTipoDocumento). ATENÇÃO: os valores MUDAM
 * conforme a origem escolhida — o combo é recarregado por AJAX. Um id de
 * acórdão de Turma Recursal (7) não existe quando a origem é TJSC.
 */
const TIPOS_DOCUMENTO = {
  comum: { acordao: '1', monocratica: '2', despacho: '3' },
  turmas: { acordao: '7', monocratica: '10' },
  uniformizacao: { acordao: '9', monocratica: '5' },
  conselho: { acordao: '6' },
};

/** #selTamanhoPagina — as únicas opções aceitas pelo servidor. */
const TAMANHOS_PAGINA = [10, 25, 50, 100];

class TJSCNavigator {
  constructor(options = {}) {
    this.headless = options.headless ?? true;
    this.timeout = options.timeout ?? 60000;
    this.slowMo = options.slowMo ?? 0;
    this.log = options.log ?? (() => {});
    this.tentativasDesafio = options.tentativasDesafio ?? 10;
    // Ver ressalva 1 no cabeçalho: UA de HeadlessChrome é barrado pelo F5.
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /** Sobe o browser (idempotente). @private */
  async _init() {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.slowMo,
      args: this.headless ? ['--disable-blink-features=AutomationControlled'] : [],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1200 },
      locale: 'pt-BR',
      userAgent: this.userAgent,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);
  }

  async fechar() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null; this.context = null; this.page = null;
    }
  }

  /**
   * Abre a tela de pesquisa, atravessando o desafio do F5.
   * O sinal de sucesso é o campo #txtPesquisa existir — o `<title>` da página
   * de bloqueio ("Verificação de segurança do portal institucional") não é
   * confiável porque muda entre variantes do desafio.
   */
  async abrir() {
    await this._init();
    for (let i = 0; i < this.tentativasDesafio; i++) {
      await this.page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: this.timeout })
        .catch((e) => this.log(`  goto falhou (${e.message.split('\n')[0]}), retentando`));
      await this.page.waitForTimeout(1500);
      // `#txtPesquisa` EXISTE TAMBÉM na página de resultados, então sua presença
      // não prova que voltamos ao formulário. Sem checar a URL, um goto que não
      // completou deixa a sessão na listagem anterior e a busca seguinte é
      // disparada da página velha — foi o que fazia consultas em sequência
      // (a auditoria do Checker) falharem de forma intermitente.
      const naListagem = /listar_resultados/.test(this.page.url());
      if (!naListagem && (await this.page.locator('#txtPesquisa').count())) {
        if (i) this.log(`Verificação de segurança liberada na tentativa ${i + 1}.`);
        await this._abrirAvancada();
        return this.page;
      }
      this.log(`Verificação de segurança do TJSC ainda ativa (tentativa ${i + 1}/${this.tentativasDesafio})...`);
      await this.page.waitForTimeout(3000);
    }
    throw new Error(
      'TJSC: a verificação de segurança (F5) do portal não liberou. ' +
      'Tente novamente, use --headed, ou consulte as ressalvas em CLAUDE-TJSC.md.',
    );
  }

  /** O painel "Pesquisa avançada" começa colapsado; sem abrir, os filtros não são enviados. @private */
  async _abrirAvancada() {
    await this.page.evaluate(() => {
      const d = document.getElementById('divPesquisaAvancada');
      if (d) { d.classList.add('show'); d.style.height = ''; }
      if (window.jQuery && jQuery.fn.collapse) jQuery('#divPesquisaAvancada').collapse('show');
    });
    await this.page.waitForTimeout(300);
  }

  /**
   * Marca opções de um `<select multiple>` do bootstrap-select.
   * `selectOption` do Playwright não serve: o select real fica escondido atrás
   * do widget, então mexemos no DOM e disparamos o `change` na mão.
   * @private
   */
  async _selecionar(id, valores) {
    await this.page.evaluate(({ id, valores }) => {
      const s = document.getElementById(id);
      if (!s) return;
      for (const o of s.options) o.selected = valores.includes(o.value);
      if (window.jQuery && jQuery.fn.selectpicker) jQuery(`#${id}`).selectpicker('refresh');
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, { id, valores });
  }

  /** Opções atuais de um combo: [{id, label}]. */
  async opcoes(id) {
    return this.page.locator(`#${id} option`)
      .evaluateAll((os) => os.map((o) => ({ id: o.value, label: o.textContent.trim() })).filter((o) => o.label));
  }

  /** Códigos atualmente marcados no #selOrigem. @private */
  async _origemAtual() {
    return this.page.$eval('#selOrigem', (s) => [...s.selectedOptions].map((o) => o.value)).catch(() => []);
  }

  /**
   * Escolhe a origem e ESPERA os combos dependentes recarregarem.
   * Sem a espera, um filtro de órgão/tipo aplicado logo depois é perdido.
   *
   * IDEMPOTENTE de propósito. O `change` do #selOrigem dispara um reload AJAX
   * dos quatro combos dependentes, e esse reload pode LIMPAR a seleção do
   * próprio #selOrigem se um segundo `change` chegar no meio. Quando isso
   * acontecia (crawler e pesquisar chamando os dois), a busca ia ao servidor
   * sem origem marcada e voltava 0 — de forma intermitente, o pior modo de
   * falha. Por isso: não redefine se já está marcado, e CONFERE se ficou.
   */
  async definirOrigem(codigos) {
    const iguais = (a) => a.length === codigos.length && codigos.every((c) => a.includes(c));
    if (iguais(await this._origemAtual())) return;

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      await this._selecionar('selOrigem', codigos);
      await this.page.waitForTimeout(2500);
      if (iguais(await this._origemAtual())) return;
      this.log(`AVISO: a seleção de origem não fixou (tentativa ${tentativa + 1}/3); repetindo.`);
    }
    throw new Error(
      `TJSC: não foi possível fixar a origem (${codigos.join(',')}) no combo #selOrigem. ` +
      'Buscar sem origem marcada devolveria 0 em silêncio, então a busca foi abortada.',
    );
  }

  /**
   * Preenche o formulário e submete.
   *
   * @param {Object} f
   * @param {string} f.query          termo livre (#txtPesquisa)
   * @param {string[]} f.origens      códigos do #selOrigem (a desambiguação)
   * @param {string[]} f.tiposDocumento códigos do #selTipoDocumento
   * @param {string} f.escopo         'ementa' | 'inteiroTeor'
   * @param {string} f.dataDecisaoInicio/Fim, f.dataPublicacaoInicio/Fim  DD/MM/YYYY
   * @param {string} f.processo       nº do processo (#txtProcesso)
   * @param {string[]} f.orgaos, f.relatores, f.classes  labels exatos dos combos
   * @param {boolean} f.precedenteRelevante
   * @param {string} f.ordenacao      'recentes' | 'antigos'
   * @param {number} f.tamanhoPagina  10 | 25 | 50 | 100
   * @returns {{total:number|null}}
   */
  async pesquisar(f = {}) {
    const p = this.page;
    await this._abrirAvancada();

    if (f.origens && f.origens.length) await this.definirOrigem(f.origens);

    // TODO campo é escrito SEMPRE, inclusive vazio. Não é preciosismo:
    // o eproc guarda o estado da última busca em COOKIES (pesquisarEm, origem,
    // tipoDocumento...) e repõe o formulário ao reabrir a página. Um
    // `if (f.processo)` deixaria o nº de processo da consulta anterior no campo
    // e a busca seguinte voltaria 0 resultados sem qualquer aviso.
    await p.fill('#txtPesquisa', f.query ?? '');
    await p.fill('#txtProcesso', f.processo ? String(f.processo) : '');
    for (const [sel, valor] of [
      ['#dtDecisaoInicio', f.dataDecisaoInicio], ['#dtDecisaoFim', f.dataDecisaoFim],
      ['#dtPublicacaoInicio', f.dataPublicacaoInicio], ['#dtPublicacaoFim', f.dataPublicacaoFim],
    ]) {
      await p.fill(sel, valor ?? '');
    }
    // os hidden espelham as datas; limpá-los junto evita filtro fantasma
    await p.evaluate((limpar) => {
      for (const id of ['hdnDecisaoInicio', 'hdnDecisaoFim', 'hdnPublicacaoInicio', 'hdnPublicacaoFim']) {
        const e = document.getElementById(id);
        if (e && limpar) e.value = '';
      }
    }, !(f.dataDecisaoInicio || f.dataDecisaoFim || f.dataPublicacaoInicio || f.dataPublicacaoFim));

    // o site marca "Inteiro Teor" por padrão; reafirmamos para não herdar cookie
    const alvoEscopo = f.escopo === 'ementa' ? '#optEmenta' : '#optInteiroTeor';
    await p.evaluate(({ alvo, precedente }) => {
      const r = document.querySelector(alvo);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      const c = document.getElementById('chkPrecedenteRelevante');
      if (c) { c.checked = !!precedente; c.dispatchEvent(new Event('change', { bubbles: true })); }
    }, { alvo: alvoEscopo, precedente: f.precedenteRelevante });

    await this._selecionar('selTipoDocumento', f.tiposDocumento ?? []);
    await this._selecionar('selOrgao', f.orgaos ?? []);
    await this._selecionar('selRelator', f.relatores ?? []);
    await this._selecionar('selClasse', f.classes ?? []);

    // Esperar a NAVEGAÇÃO, não só o clique. O submit é um POST de documento; se
    // seguirmos direto para _esperarResultados() ainda estamos na página velha,
    // e o contador dela ("0 documentos encontrados" de uma consulta anterior)
    // é lido como se fosse o resultado desta busca — outro falso zero silencioso.
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.timeout }).catch(() => null),
      p.locator('#btnConsultar, button:has-text("Pesquisar")').first().click(),
    ]);
    let estado = await this._esperarResultados();

    if (f.ordenacao === 'antigos') estado = (await this._ordenar('antigos')) ?? estado;
    // o total é lido ANTES de trocar o tamanho de página: é ele que diz quantos
    // cards esperar na recarga
    const total = await this.total();
    if (f.tamanhoPagina && Number(f.tamanhoPagina) !== 10) {
      await this.definirTamanhoPagina(f.tamanhoPagina, total);
    }

    // `estado` é o que permite ao chamador distinguir "não achou" de
    // "não carregou" — ver _esperarResultados()
    return { total, estado };
  }

  /**
   * Espera a lista de resultados REALMENTE renderizar.
   *
   * Esperar por um seletor não basta: `#divResultados` já existe no DOM antes de
   * o POST terminar, então quem espera só por ele lê a página no meio da troca e
   * extrai zero.
   *
   * E "zero cards" é ambíguo — pode ser busca vazia ou página não carregada.
   * A ambiguidade é perigosa: no Checker ela virou um "processo não encontrado"
   * falso, num processo que existe (visto em uma rodada em que o site levou
   * minutos por consulta). Por isso aqui devolvemos QUAL dos três casos é:
   *
   *   'itens'      -> há cards na tela
   *   'vazio'      -> o contador diz "0 documentos encontrados" (vazio de verdade)
   *   'indefinido' -> nem um nem outro dentro do teto: NÃO conclua nada
   *
   * @private
   * @returns {'itens'|'vazio'|'indefinido'}
   */
  async _esperarResultados(esperaMax = 60000) {
    await this.page.waitForLoadState('networkidle', { timeout: this.timeout }).catch(() => {});
    const limite = Date.now() + esperaMax;
    while (Date.now() < limite) {
      if (await this.page.locator('.resultadoItem').count()) {
        await this.page.waitForTimeout(300);
        return 'itens';
      }
      const txt = await this.page.locator('body').innerText().catch(() => '');
      if (/\b0\s+documentos?\s+encontrados?/i.test(txt)) return 'vazio';
      await this.page.waitForTimeout(500);
    }
    return 'indefinido';
  }

  /** Ordenação por data — o combo é rotulado, não numerado; casamos pelo texto. @private */
  async _ordenar(modo) {
    const alvo = modo === 'antigos' ? /antigo/i : /recente/i;
    const valor = await this.page.locator('#selOrdenacao option')
      .evaluateAll((os, re) => {
        const r = new RegExp(re, 'i');
        const o = os.find((x) => r.test(x.textContent || ''));
        return o ? o.value : null;
      }, alvo.source);
    if (!valor) return null;
    await this.page.selectOption('#selOrdenacao', valor).catch(() => {});
    return this._esperarResultados();
  }

  /**
   * Resultados por página (10/25/50/100). Recarrega a lista.
   *
   * ARMADILHA: durante a recarga a lista passa por ZERO cards antes de voltar
   * com os N novos. Quem espera só por "o número de cards mudou" lê a página no
   * vale e extrai 0. Aqui esperamos o número ALVO — min(n, total).
   *
   * @param {number} n tamanho pedido
   * @param {number|null} total total da busca (para saber quando N é inalcançável)
   */
  async definirTamanhoPagina(n, total = null) {
    if (!TAMANHOS_PAGINA.includes(Number(n))) {
      throw new Error(`tamanho de página inválido: ${n} (use ${TAMANHOS_PAGINA.join(', ')})`);
    }
    const alvo = total === null ? Number(n) : Math.min(Number(n), total);
    await this.page.selectOption('#selTamanhoPagina', String(n)).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: this.timeout }).catch(() => {});
    const limite = Date.now() + 30000;
    while (Date.now() < limite) {
      if ((await this.page.locator('.resultadoItem').count()) >= alvo) return;
      await this.page.waitForTimeout(500);
    }
    this.log(`AVISO: a lista não chegou a ${alvo} cards após trocar o tamanho de página.`);
  }

  /**
   * Total de documentos da busca.
   * Duas fontes na tela: o contador "N documentos encontrados" e o cabeçalho de
   * cada card ("Documento 1 de N"). Usamos a primeira e caímos na segunda.
   */
  async total() {
    const txt = await this.page.locator('body').innerText().catch(() => '');
    const m = txt.match(/([\d.]+)\s+documentos?\s+encontrados?/i) ||
              txt.match(/Documento\s+[\d.]+\s+de\s+([\d.]+)/i);
    return m ? Number(m[1].replace(/\./g, '')) : null;
  }

  /** Extrai os cards da página atual (formato cru, ainda com o texto do site). */
  async extrair() {
    return this.page.locator('.resultadoItem').evaluateAll((els, base) => {
      const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      return els.map((el) => {
        const porRotulo = (rotulo) => {
          for (const lab of el.querySelectorAll('.resLabel')) {
            if (lab.textContent.trim().toUpperCase().includes(rotulo)) {
              const v = lab.nextElementSibling;
              if (v && v.classList.contains('resValue')) return limpar(v.textContent);
            }
          }
          return '';
        };
        const proc = el.querySelector('a.numero-processo');
        const it = el.querySelector('a.inteiroTeor');
        let inteiroTeorLink = it ? it.getAttribute('data-link') || '' : '';
        if (inteiroTeorLink && !/^https?:/.test(inteiroTeorLink)) inteiroTeorLink = base + inteiroTeorLink;
        const chk = el.querySelector('input.chkDocumento');
        return {
          id: chk ? chk.value : (el.id || '').replace(/^resultado/, ''),
          tipoDocumento: limpar(el.querySelector('.resValueTipoJurisprudencia')?.textContent),
          numeroProcesso: limpar(proc?.textContent),
          processoUrl: proc?.href || '',
          classe: limpar(proc?.closest('.row')?.querySelectorAll('span')[0]?.textContent),
          uf: porRotulo('UF'),
          orgaoJulgador: porRotulo('ÓRGÃO JULGADOR'),
          dataJulgamento: porRotulo('DATA DO JULGAMENTO'),
          dataPublicacao: porRotulo('DATA DA PUBLICAÇÃO'),
          relator: porRotulo('RELATOR'),
          decisao: porRotulo('DECISÃO'),
          ementa: porRotulo('EMENTA'),
          citacao: limpar(el.querySelector('a.copiarCitacao')?.getAttribute('data-citacao')),
          inteiroTeorLink,
        };
      });
    }, BASE);
  }

  /** Há próxima página? (o ícone recebe .iconeDesativado quando acaba) */
  async temProximaPagina() {
    return (await this.page.locator('.paginaProxima:not(.iconeDesativado)').count()) > 0;
  }

  /** id do primeiro card da página atual (null se não houver). @private */
  async _primeiroId() {
    return this.page.locator('.resultadoItem').first().evaluate((e) => e.id).catch(() => null);
  }

  /**
   * Vai para a próxima página.
   *
   * ARMADILHA: os cards da página ANTERIOR continuam no DOM durante a troca.
   * Quem espera só por "existe .resultadoItem" (ou por networkidle) lê a página
   * velha, conclui que nada mudou e para a paginação na página 1 — foi
   * exatamente isso que o teste de aceite pegou. O único sinal confiável é o id
   * do primeiro card MUDAR.
   *
   * @returns {boolean} true se avançou de fato
   */
  async proximaPagina() {
    const antes = await this._primeiroId();
    await this.page.locator('.paginaProxima:not(.iconeDesativado)').first().click();
    await this.page.waitForLoadState('networkidle', { timeout: this.timeout }).catch(() => {});
    const limite = Date.now() + 60000;
    while (Date.now() < limite) {
      const agora = await this._primeiroId();
      if (agora && agora !== antes) {
        await this.page.waitForTimeout(300);
        return true;
      }
      await this.page.waitForTimeout(500);
    }
    this.log('AVISO: a paginação não avançou (o primeiro documento continua o mesmo).');
    return false;
  }

  /**
   * Baixa o inteiro teor de um resultado.
   * Vai por `context.request` (reaproveita os cookies do desafio), não por aba
   * nova. RESSALVA DE ENCODING: o documento vem em ISO-8859-1 mesmo declarando
   * `<?xml encoding="ISO-8859-1"?>`; ler como UTF-8 produz mojibake.
   * @returns {{html:string, texto:string}}
   */
  async baixarInteiroTeor(link) {
    if (!link) throw new Error('resultado sem link de inteiro teor');
    const url = /^https?:/.test(link) ? link : BASE + link;
    const decodificar = (buf) => {
      // RESSALVA: o documento vem em ISO-8859-1 ainda que declare
      // `<?xml encoding="ISO-8859-1"?>`; ler como UTF-8 produz mojibake.
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        return new TextDecoder('windows-1252').decode(buf);
      }
    };

    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const res = await this.context.request.get(url, {
          timeout: this.timeout,
          headers: { Referer: PAGE_URL },
        });
        if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
        const html = decodificar(await res.body());
        return { html, texto: stripHtml(html) };
      } catch (err) {
        // ECONNRESET acontece de vez em quando neste host; vale retentar
        ultimoErro = err;
        await this.page.waitForTimeout(1500 * (tentativa + 1));
      }
    }

    // Último recurso: abrir numa aba. Mais lento, mas passa quando o
    // request context é derrubado pelo F5.
    try {
      const aba = await this.context.newPage();
      try {
        await aba.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
        const html = await aba.content();
        return { html, texto: stripHtml(html) };
      } finally {
        await aba.close();
      }
    } catch (err) {
      throw new Error(`falha ao baixar inteiro teor (${ultimoErro?.message || err.message})`);
    }
  }

  /** Grava o inteiro teor de um lote + index.json (mesmo contrato do TJRS/TJGO). */
  async baixarLote(resultados, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const index = [];
    for (let i = 0; i < resultados.length; i++) {
      const r = resultados[i];
      const rotulo = r.numeroProcesso || r.id || `#${i}`;
      const base = sanitizeFilename(`${r.numeroProcesso || 'sem-numero'}-${r.id || ''}`.replace(/-$/, ''));
      try {
        const { html, texto } = await this.baixarInteiroTeor(r.inteiroTeorLink);
        const arquivos = [];
        if (formats.includes('txt')) {
          fs.writeFileSync(path.join(outputDir, `${base}.txt`), texto || r.ementa || '', 'utf-8');
          arquivos.push(`${base}.txt`);
        }
        if (formats.includes('html')) {
          fs.writeFileSync(path.join(outputDir, `${base}.html`), html, 'utf-8');
          arquivos.push(`${base}.html`);
        }
        log(`  [${i + 1}/${resultados.length}] ${rotulo} -> ${arquivos.join(', ')}`);
        index.push({ ...r, arquivo: arquivos[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${resultados.length}] FALHOU ${rotulo}: ${err.message}`);
        index.push({ ...r, arquivo: null, downloadError: err.message });
      }
    }
    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    log(`Index saved to: ${indexPath}`);
    return index;
  }

  /**
   * Lista os combos de uma origem, abrindo o browser e fechando no fim.
   * Usado pelas flags --listar-* da CLI.
   * @param {string[]} origens códigos do #selOrigem
   */
  async listarCombos(origens = ['1']) {
    await this.abrir();
    const origensDisponiveis = await this.opcoes('selOrigem');
    if (origens && origens.length) await this.definirOrigem(origens);
    return {
      origens: origensDisponiveis,
      tiposDocumento: await this.opcoes('selTipoDocumento'),
      orgaos: await this.opcoes('selOrgao'),
      relatores: await this.opcoes('selRelator'),
      classes: await this.opcoes('selClasse'),
    };
  }
}

TJSCNavigator.BASE = BASE;
TJSCNavigator.PAGE_URL = PAGE_URL;
TJSCNavigator.PORTAL_URL = PORTAL_URL;
TJSCNavigator.ORIGENS = ORIGENS;
TJSCNavigator.ORIGENS_LABEL = ORIGENS_LABEL;
TJSCNavigator.ORIGENS_ALIAS = ORIGENS_ALIAS;
TJSCNavigator.TIPOS_DOCUMENTO = TIPOS_DOCUMENTO;
TJSCNavigator.TAMANHOS_PAGINA = TAMANHOS_PAGINA;

module.exports = TJSCNavigator;
