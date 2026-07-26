// src/STJNavigator.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator do SCON — Pesquisa de Jurisprudência do STJ
 * https://scon.stj.jus.br/SCON/
 *
 * O SCON é um BRS/Oracle Text clássico: TODA a busca cabe numa querystring
 * `GET /SCON/pesquisar.jsp?...`. Não há sessão de formulário, não há viewState,
 * não há POST. Isso faria dele um crawler `http` puro perfeito — se não fosse o
 * bloqueio.
 *
 * POR QUE BROWSER, E POR QUE HEADFUL (a ressalva mais cara deste tribunal)
 * ----------------------------------------------------------------------
 * `scon.stj.jus.br` está atrás de um desafio Cloudflare gerido pela CSID/STJ
 * ("Verificação automática em andamento", RAY ID, cookie `cf_clearance`).
 * Medido em 25/07/2026:
 *   - curl / node fetch ............................ 403 sempre
 *   - Playwright headless (headless shell) ......... 403 em 4/4 tentativas
 *   - Playwright headless channel=chromium ......... 403 em 4/4
 *   - Playwright headless channel=chrome ........... 403 em 4/4
 *   - Playwright HEADFUL ........................... passa na 1ª ou 2ª
 * Ou seja: o desafio não cai em headless, seja qual for o User-Agent. O crawler
 * roda headful por padrão (como o TRF3) — `--headless` existe para testar se o
 * bloqueio caiu, não para uso normal.
 *
 * Depois de vencido o desafio, o mesmo `context.request` fala HTTP puro com o
 * host (é assim que buscamos cada página e o inteiro teor): um browser aberto,
 * N requisições rápidas.
 *
 * ENCODING — a segunda armadilha
 * ------------------------------
 * O SCON declara `charset=ISO-8859-1` e interpreta a QUERYSTRING nesse charset.
 * `usucapião` percent-encodado em UTF-8 devolve **0 resultados em silêncio**;
 * em latin-1 devolve 2.356. Toda montagem de URL passa por `encLatin1()` e toda
 * resposta é lida como latin-1. Não use `URLSearchParams` aqui.
 *
 * O módulo de PRECEDENTES QUALIFICADOS (temas repetitivos, IACs) vive em outro
 * host — `processo.stj.jus.br` — que **não** tem Cloudflare. Ver STJRepetitivos
 * dentro deste arquivo.
 */

const HOME = 'https://scon.stj.jus.br/SCON/';
const PESQUISAR = 'https://scon.stj.jus.br/SCON/pesquisar.jsp';
const ORIGEM = 'https://scon.stj.jus.br';

/**
 * Bases documentais do SCON (parâmetro `b`).
 * ACOR é a base de jurisprudência propriamente dita — é o default e a única
 * cuja tela de resultados tem o layout `.documento` que sabemos extrair.
 */
const BASES = {
  acordao: 'ACOR',      // Acórdãos — o espelho do acórdão, com ementa e tese
  monocratica: 'DTXT',  // Decisões monocráticas (base MUITO maior; ver ressalvas)
  sumula: 'SUMU',       // Súmulas — layout próprio, não extraído por este navigator
  informativo: 'INFJ',  // Informativo de Jurisprudência — layout próprio
  tese: 'TESE',         // Jurisprudência em Teses — layout próprio
};

const BASES_ALIAS = {
  acordao: 'acordao', acordaos: 'acordao', acor: 'acordao', acordão: 'acordao', acórdão: 'acordao',
  monocratica: 'monocratica', monocraticas: 'monocratica', dtxt: 'monocratica', 'decisao-monocratica': 'monocratica',
  sumula: 'sumula', sumulas: 'sumula', sumu: 'sumula', súmula: 'sumula',
  informativo: 'informativo', informativos: 'informativo', infj: 'informativo',
  tese: 'tese', teses: 'tese',
};

/**
 * ÓRGÃO JULGADOR — a desambiguação do STJ (parâmetro `orgao`, vírgula separa).
 *
 * No STJ não existe "Juizado × Justiça Comum": é corte de superposição, todo o
 * acervo é do próprio Tribunal. A desambiguação que importa é POR ÓRGÃO, e ela
 * é substantiva: a competência de cada Seção define a matéria.
 *
 *   Primeira Seção  (T1+T2) -> direito público: tributário, administrativo, previdenciário
 *   Segunda Seção   (T3+T4) -> direito privado: civil, empresarial, consumidor
 *   Terceira Seção  (T5+T6) -> direito penal e processual penal
 *   Corte Especial          -> competência plenária (Lei de Introdução, uniformização geral)
 *
 * Códigos lidos do DOM vivo (human-codegen/STJ/01-scon-acordaos/05-orgaos-julgadores.json).
 */
const ORGAOS = {
  T1: 'PRIMEIRA TURMA', T2: 'SEGUNDA TURMA', T3: 'TERCEIRA TURMA',
  T4: 'QUARTA TURMA', T5: 'QUINTA TURMA', T6: 'SEXTA TURMA',
  S1: 'PRIMEIRA SEÇÃO', S2: 'SEGUNDA SEÇÃO', S3: 'TERCEIRA SEÇÃO',
  CE: 'CORTE ESPECIAL', PS: 'PRESIDÊNCIA', VP: 'VICE-PRESIDÊNCIA',
};

/**
 * Atalhos de órgão. As Seções (S1/S2/S3) são órgãos PRÓPRIOS no SCON — julgam
 * embargos de divergência e repetitivos —, NÃO um agregado das suas Turmas.
 * Por isso `--secao 2` manda `S2,T3,T4`: quem pede "direito privado" quer a
 * Segunda Seção E as suas duas Turmas.
 */
const ORGAOS_ALIAS = {
  'primeira-turma': 'T1', t1: 'T1', '1t': 'T1',
  'segunda-turma': 'T2', t2: 'T2', '2t': 'T2',
  'terceira-turma': 'T3', t3: 'T3', '3t': 'T3',
  'quarta-turma': 'T4', t4: 'T4', '4t': 'T4',
  'quinta-turma': 'T5', t5: 'T5', '5t': 'T5',
  'sexta-turma': 'T6', t6: 'T6', '6t': 'T6',
  'primeira-secao': 'S1', s1: 'S1', '1s': 'S1',
  'segunda-secao': 'S2', s2: 'S2', '2s': 'S2',
  'terceira-secao': 'S3', s3: 'S3', '3s': 'S3',
  'corte-especial': 'CE', ce: 'CE', corte: 'CE',
  presidencia: 'PS', ps: 'PS',
  'vice-presidencia': 'VP', vp: 'VP',
};

/** `--secao` -> lista de códigos de órgão (a Seção + as Turmas que a compõem). */
const SECOES = {
  1: ['S1', 'T1', 'T2'],
  2: ['S2', 'T3', 'T4'],
  3: ['S3', 'T5', 'T6'],
  publico: ['S1', 'T1', 'T2'],
  privado: ['S2', 'T3', 'T4'],
  penal: ['S3', 'T5', 'T6'],
  corte: ['CE'],
};

/**
 * Combo "Notas" (parâmetro `nota`) — 25 recortes temáticos PRONTOS, escritos
 * pela Secretaria de Jurisprudência do STJ na própria sintaxe do SCON.
 * São filtros de altíssimo valor: `repetitivos` isola os acórdãos julgados sob
 * o rito dos recursos repetitivos e IACs.
 * Lista completa em human-codegen/STJ/01-scon-acordaos/03-notas.json.
 */
const NOTAS = {
  repetitivos: '(JULGADO E CONFORME E ((RECURSOS ADJ REPETITIVOS) OU IAC))',
  afetacao: 'DECISAO ADJ DE ADJ (AFETACAO OU ADMISSAO)',
  'revisao-tema': 'PROPOSTA COM REVISAO COM TEMA COM RECURSO ADJ REPETITIVO',
  'tese-revisada': '(REVISAO ADJ DA ADJ TESE) OU (TESE ADJ REVISADA)',
  'reafirmacao-jurisprudencia': 'REAFIRMACAO COM JURISPRUDENCIA',
  distinguishing: 'DISTINGUISHING',
  overruling: 'OVERRULING',
  'casos-notorios': 'PROCESSO',
  'dano-moral': 'MORAL',
  'dano-estetico': 'ESTETICO',
  'dano-moral-coletivo': 'DANO ADJ MORAL ADJ COLETIVO',
  'rescisoria-procedente': '(VEJA ADJ3 (RESCISÓRIA OU AR$))',
  'juizo-retratacao': 'JUIZO ADJ2 RETRATACAO',
  'embargos-declaracao-acolhidos': '(VEJA ADJ2 (EMBARGO$ ADJ2 DECLAR$ OU EDCL$ OU DERESP$))',
  'embargos-divergencia-providos': '(VEJA ADJ2 (EMBARGOS ADJ2 DIVERGEN$ OU ERESP$))',
  'ambiental': 'AMBIENT$',
  'rol-ans': 'ANS',
  'insignificancia': 'INSIGNIFICÂNCIA',
  'penhorabilidade': '$PENHORABILIDADE',
  'quantidade-droga': 'QUANTIDAD$ COM DROGA',
  'petrechos-trafico': 'PETRECHOS',
  'puil-merito': '(JULGAMENTO E MERITO E PUIL)',
  'perspectiva-racial': '(TEMA AND RACIAL)',
  'violencia-domestica': '(TEMA COM VIOLENCIA)',
};

/** Ordenação (parâmetro `ordenacao`). O default do site é por data de publicação desc. */
const ORDENACOES = {
  recentes: '-@DTPB',
  antigos: '@DTPB',
  relevancia: '',
};

/** Parâmetros que o formulário do SCON sempre manda — inclusive vazios. */
const PARAMS_BASE = {
  acao: 'pesquisar', novaConsulta: 'true', i: '1', b: 'ACOR', livre: '',
  filtroPorOrgao: '', filtroPorMinistro: '', filtroPorNota: '', data: '',
  tipo_visualizacao: '', tp: 'T', processo: '', classe: '', uf: '', relator: '',
  dtpb: '', dtpb1: '', dtpb2: '', dtde: '', dtde1: '', dtde2: '',
  orgao: '', ementa: '', nota: '', ref: '',
};

/**
 * Percent-encoding em ISO-8859-1.
 * NÃO troque por encodeURIComponent/URLSearchParams: eles emitem UTF-8 e o SCON
 * devolve 0 resultados sem erro nenhum para qualquer termo acentuado.
 */
function encLatin1(valor) {
  let out = '';
  for (const byte of Buffer.from(String(valor ?? ''), 'latin1')) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.!~*'()-]/.test(c)) out += c;
    else if (c === ' ') out += '+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** DD/MM/YYYY -> YYYYMMDD (formato interno do campo `data`). @private */
const _iso = (d) => `${d.slice(6, 10)}${d.slice(3, 5)}${d.slice(0, 2)}`;

/**
 * Monta o valor do parâmetro `data` — o ÚNICO filtro de data que o servidor lê.
 *
 * ARMADILHA: os campos visíveis `dtde1/dtde2` (julgamento) e `dtpb1/dtpb2`
 * (publicação) são decorativos. O JS da página os concatena em `data`
 * (`@DTDE >= "20250101" AND @DTDE <= "20251231"`) e é esse que filtra. Mandar
 * só `dtde1/dtde2` devolve a busca inteira — 28.348 com e sem data — sem
 * qualquer aviso.
 */
function montarData({ dataInicio, dataFim, dataPubInicio, dataPubFim } = {}) {
  const faixa = (campo, a, b) => {
    if (a && b) return `@${campo} >= "${_iso(a)}" AND @${campo} <= "${_iso(b)}"`;
    if (a) return `@${campo} >= "${_iso(a)}"`;
    if (b) return `@${campo} <= "${_iso(b)}"`;
    return '';
  };
  const julg = faixa('DTDE', dataInicio, dataFim);
  const publ = faixa('DTPB', dataPubInicio, dataPubFim);
  if (julg && publ) return `(${publ}) AND (${julg})`;
  return julg || publ;
}

/** Monta a URL de busca do SCON. */
function montarUrl(params = {}) {
  const todos = { ...PARAMS_BASE, ...params };
  return `${PESQUISAR}?${Object.entries(todos).map(([k, v]) => `${k}=${encLatin1(v)}`).join('&')}`;
}

/**
 * Lê o total de documentos da resposta.
 * @returns {number|null|'timeout'} 'timeout' = o Oracle abortou a consulta
 */
function lerTotal(html) {
  if (/Erro ao executar pesquisa/i.test(html) || /ORA-\d+/.test(html)) return 'timeout';
  const m = html.match(/Documento\s+\d+\s+de\s+([\d.]+)/i);
  if (m) return Number(m[1].replace(/\./g, ''));
  if (/n[ãa]o (foi )?encontrad|nenhum documento/i.test(html)) return 0;
  return null;
}

/** Extrator dos cards `.documento`. Roda DENTRO da página (precisa de DOM). @private */
/* eslint-disable no-undef */
function _extrairNoDom(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const limpar = (s) => String(s ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return [...doc.querySelectorAll('.documento')].map((el) => {
    const campos = {};
    for (const par of el.querySelectorAll('.paragrafoBRS')) {
      const titulo = par.querySelector('.docTitulo');
      const texto = par.querySelector('.docTexto');
      if (!titulo || !texto) continue;
      // o rótulo traz um ícone de ajuda junto; só a 1ª linha interessa
      const rotulo = limpar(titulo.textContent).split('\n')[0].trim();
      if (!rotulo || campos[rotulo]) continue;
      // ARMADILHA: o espelho separa as linhas com <br>, e `textContent` as COLA
      // ("REsp 2031813 / SCRECURSO ESPECIAL2022/0314287-3"). Sem transformar o
      // <br> em quebra de linha, a UF e a classe saem grudadas no campo Processo.
      const clone = texto.cloneNode(true);
      for (const br of clone.querySelectorAll('br')) br.replaceWith(doc.createTextNode('\n'));
      for (const p of clone.querySelectorAll('p, div')) p.append(doc.createTextNode('\n'));
      campos[rotulo] = limpar(clone.textContent);
    }
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
    const arrancar = (re) => {
      const h = hrefs.find((x) => re.test(x)) || '';
      const m = h.match(/'([^']+)'/);
      return m ? m[1] : (h && re.test(h) ? h : null);
    };
    return {
      id: el.querySelector('.clsCheckSelecionaDocumento')?.value || null,
      registro: (el.innerHTML.match(/REGISTRO:\s*(\d+)/) || [])[1] || null,
      identificacao: limpar(el.querySelector('.clsIdentificacaoDocumento')?.textContent),
      campos,
      inteiroTeorLink: arrancar(/GetInteiroTeorDoAcordao/),
      processoUrl: arrancar(/processo\/pesquisa/),
      precedenteQualificado: limpar(el.querySelector('.barraDocRepetitivo h4')?.textContent) || null,
      tema: limpar(el.querySelector('.barraDocRepetitivo a')?.textContent) || null,
      situacaoTema: limpar(el.querySelector('.divSituacaoTema')?.textContent) || null,
    };
  });
}
/* eslint-enable no-undef */

class STJNavigator {
  constructor(options = {}) {
    // headful é o DEFAULT e não é preciosismo: o Cloudflare do STJ não libera
    // headless em nenhuma variante testada. Ver cabeçalho.
    this.headless = options.headless ?? false;
    this.timeout = options.timeout ?? 90000;
    this.slowMo = options.slowMo ?? 0;
    this.log = options.log ?? (() => {});
    this.tentativasDesafio = options.tentativasDesafio ?? 10;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /** @private */
  async _init() {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.slowMo,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1100 },
      locale: 'pt-BR',
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
   * Abre a home do SCON e atravessa o desafio Cloudflare.
   * O sinal de sucesso é `#pesquisaLivre` existir — o `<title>` da página de
   * bloqueio ("Um momento…") muda entre variantes e não é confiável.
   */
  async abrir() {
    await this._init();
    for (let i = 0; i < this.tentativasDesafio; i++) {
      await this.page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: this.timeout })
        .catch((e) => this.log(`  goto falhou (${e.message.split('\n')[0]}), retentando`));
      await this.page.waitForTimeout(2500);
      if (await this.page.locator('#pesquisaLivre').count()) {
        if (i) this.log(`Desafio do Cloudflare liberado na tentativa ${i + 1}.`);
        return this.page;
      }
      this.log(`Verificação automática do STJ ainda ativa (tentativa ${i + 1}/${this.tentativasDesafio})...`);
      await this.page.waitForTimeout(2500);
    }
    throw new Error(
      'STJ: o desafio do Cloudflare não liberou. ' +
      (this.headless
        ? 'Você está em modo headless — o SCON NÃO libera headless. Rode sem --headless.'
        : 'Tente novamente em alguns minutos; ver ressalvas em CLAUDE-STJ.md.'),
    );
  }

  /**
   * GET no SCON reaproveitando os cookies do desafio.
   * A resposta é decodificada como latin-1 (charset declarado do site).
   */
  async get(url) {
    const res = await this.context.request.get(url, {
      headers: { Referer: HOME },
      timeout: this.timeout,
    });
    return { status: res.status(), html: (await res.body()).toString('latin1') };
  }

  /**
   * Executa uma busca.
   *
   * @param {Object} f
   * @param {string} f.query        termo livre (parâmetro `livre`)
   * @param {string} f.base         chave de BASES (default 'acordao')
   * @param {string[]} f.orgaos     códigos de ORGAOS
   * @param {string} f.dataInicio/f.dataFim            julgamento, DD/MM/YYYY
   * @param {string} f.dataPubInicio/f.dataPubFim      publicação,  DD/MM/YYYY
   * @param {string} f.ementa       termos restritos ao campo Ementa
   * @param {string} f.processo     nº do recurso no STJ (ou nº de registro)
   * @param {string} f.classe       sigla da classe (RESP, ARESP, HC...)
   * @param {string} f.uf           UF de origem
   * @param {string} f.relator      código do ministro (ver 05-ministros.json)
   * @param {string} f.nota         expressão do combo Notas (chave de NOTAS já resolvida)
   * @param {string} f.ordenacao    valor de ORDENACOES
   * @param {number} f.inicio       índice do 1º documento (1, 11, 21…)
   * @param {number} f.porPagina    10 | 25 | 50 (o servidor aceita mais, ver ressalvas)
   * @param {boolean} f.porNumero   true = aba "Por número do processo" (tp=P)
   * @returns {{total:number|null|'timeout', html:string, url:string}}
   */
  async buscar(f = {}) {
    const url = montarUrl({
      b: BASES[f.base ?? 'acordao'] ?? BASES.acordao,
      livre: f.query ?? '',
      ementa: f.ementa ?? '',
      processo: f.processo ?? '',
      classe: f.classe ?? '',
      uf: f.uf ?? '',
      relator: f.relator ?? '',
      nota: f.nota ?? '',
      orgao: (f.orgaos ?? []).join(','),
      data: montarData(f),
      // os campos visíveis vão junto só para a URL ser colável no navegador;
      // quem filtra é `data` (ver montarData)
      dtde1: f.dataInicio ?? '', dtde2: f.dataFim ?? '',
      dtpb1: f.dataPubInicio ?? '', dtpb2: f.dataPubFim ?? '',
      tp: f.porNumero ? 'P' : 'T',
      i: String(f.inicio ?? 1),
      ...(f.porPagina ? { l: String(f.porPagina) } : {}),
      ...(f.ordenacao ? { ordenacao: f.ordenacao } : {}),
    });
    const { html } = await this.get(url);
    return { total: lerTotal(html), html, url };
  }

  /** Extrai os cards de uma resposta de busca (formato cru). */
  async extrair(html) {
    return this.page.evaluate(_extrairNoDom, html);
  }

  /**
   * Lê a EXPRESSÃO que o servidor de fato montou.
   *
   * A tela de resultados imprime, junto do contador, a consulta traduzida:
   *   `(t3 inpath (org) or t3 inpath (corg)) and (dano and moral)
   *    and (@dtde>="20250101" and @dtde<="20251231")`
   *
   * É o equivalente ao `filtroSolr` do TJRS e o melhor antídoto contra filtro
   * silenciosamente ignorado: se `inpath (org)` não aparece, o órgão não foi
   * aplicado; se `@dtde` não aparece, a data não foi aplicada.
   *
   * @returns {{contador:string|null, expressao:string|null}}
   */
  async lerExpressao(html) {
    return this.page.evaluate((h) => {
      const doc = new DOMParser().parseFromString(h, 'text/html');
      // vários ancestrais casam com o padrão; o certo é o MENOR deles
      const alvo = [...doc.querySelectorAll('div,span,p')]
        .filter((e) => /encontrad[oa]s? com:/i.test(e.textContent || ''))
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)
        .find((e) => (e.textContent || '').trim().length > 20);
      if (!alvo) return { contador: null, expressao: null };
      const txt = (alvo.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      const m = txt.match(/^(.*?encontrad[oa]s?) com:\s*(.*)$/i);
      return { contador: m ? m[1] : null, expressao: m ? m[2] : txt };
    }, html);
  }

  /**
   * Baixa o inteiro teor de um acórdão.
   * Link no card: `/SCON/GetInteiroTeorDoAcordao?num_registro=...&dt_publicacao=...`
   * Vem como HTML (não PDF) em latin-1, e é grande: ~1 MB por acórdão.
   */
  async baixarInteiroTeor(link) {
    if (!link) throw new Error('resultado sem link de inteiro teor');
    const url = /^https?:/.test(link) ? link : ORIGEM + link;
    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const { status, html } = await this.get(url);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        return { html, texto: stripHtml(html) };
      } catch (err) {
        ultimoErro = err;
        await this.page.waitForTimeout(1500 * (tentativa + 1));
      }
    }
    throw new Error(`falha ao baixar inteiro teor (${ultimoErro?.message})`);
  }

  /** Grava o inteiro teor de um lote + index.json (mesmo contrato do TJSC/TJRS). */
  async baixarLote(resultados, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const index = [];
    for (let i = 0; i < resultados.length; i++) {
      const r = resultados[i];
      const rotulo = r.processo || r.id || `#${i}`;
      const base = sanitizeFilename(`${r.processo || 'sem-numero'}-${r.registro || r.id || ''}`.replace(/-$/, ''));
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
}

/* ------------------------------------------------------------------------ *
 * PRECEDENTES QUALIFICADOS (temas repetitivos, controvérsias, IACs, SIRDRs,
 * PUILs) — o módulo de maior valor jurídico do STJ.
 *
 * Vive em OUTRO host: https://processo.stj.jus.br/repetitivos/temas_repetitivos/
 * — e esse host NÃO está atrás do Cloudflare. Confirmado por `curl` puro em
 * 25/07/2026 (200, 115 KB). Logo este módulo roda HEADLESS: o browser aqui
 * serve só para (a) o POST e (b) ter um DOMParser para ler o HTML.
 *
 * A busca é um POST `application/x-www-form-urlencoded` em ISO-8859-1 (mesmo
 * charset do SCON) para `pesquisa.jsp`.
 * ------------------------------------------------------------------------ */

const REP_BASE = 'https://processo.stj.jus.br/repetitivos/temas_repetitivos/';
const REP_PESQUISA = `${REP_BASE}pesquisa.jsp`;

/** Tipos de precedente qualificado (abas do módulo). */
const REP_TIPOS = {
  repetitivo: 'T',    // Recurso Repetitivo (Tema)
  controversia: 'C',  // Controvérsia
  iac: 'I',           // Incidente de Assunção de Competência
  sirdr: 'S',         // Suspensão em IRDR
  puil: 'P',          // Pedido de Uniformização de Interpretação de Lei
};

/** Extrator dos cards de tema. Roda DENTRO da página. @private */
/* eslint-disable no-undef */
function _extrairTemasNoDom(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const limpar = (s) => String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Um tema = um `.containerDocumento`. Dentro dele os campos são pares
  // `.titulo_campo[_processo]` (rótulo) + `.dados_campo[_processo]` (valor),
  // sempre dentro do mesmo `.row`.
  return [...doc.querySelectorAll('.containerDocumento')].map((cont) => {
    const campos = {};
    for (const t of cont.querySelectorAll('.titulo_campo, .titulo_campo_processo')) {
      const rotulo = limpar(t.textContent).split('\n')[0].trim();
      if (!rotulo || campos[rotulo]) continue;
      const linha = t.closest('.row') || t.parentElement;
      const dado = [...(linha?.querySelectorAll('.dados_campo, .dados_campo_processo') || [])][0]
        || t.nextElementSibling;
      const clone = dado ? dado.cloneNode(true) : null;
      if (clone) {
        for (const br of clone.querySelectorAll('br')) br.replaceWith(doc.createTextNode('\n'));
      }
      const valor = limpar(clone?.textContent);
      if (valor) campos[rotulo] = valor;
    }
    // No cabeçalho, "Tema Repetitivo 985" vem como rótulo + número no mesmo bloco
    const cab = cont.querySelector('.titulo_campo_processo');
    if (cab && !campos[limpar(cab.textContent).split('\n')[0].trim()]) {
      campos[limpar(cab.textContent).split('\n')[0].trim()] = limpar(cab.querySelector('.dados_campo_processo')?.textContent);
    }
    return {
      sequencial: cont.querySelector('input[name="seqTemaImpressao"]')?.value || null,
      campos,
    };
  }).filter((t) => Object.keys(t.campos).length);
}
/* eslint-enable no-undef */

class STJRepetitivos {
  constructor(options = {}) {
    // headless de propósito: este host não tem Cloudflare.
    this.headless = options.headless ?? true;
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.browser = null; this.context = null; this.page = null;
  }

  async abrir() {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: this.headless, args: ['--disable-blink-features=AutomationControlled'] });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR' });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);
    await this.page.goto(REP_BASE, { waitUntil: 'domcontentloaded' });
  }

  async fechar() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null; this.context = null; this.page = null;
    }
  }

  /**
   * Busca temas/controvérsias/IACs.
   *
   * @param {Object} f
   * @param {string} f.query        pesquisa livre (mesma sintaxe do SCON)
   * @param {string} f.tipo         chave de REP_TIPOS (default 'repetitivo')
   * @param {number} f.temaInicial/f.temaFinal  faixa de nº do tema
   * @param {string} f.ramo         ramo do direito, ex.: "DIREITO CIVIL"
   * @param {string} f.classe       sigla, ex.: REsp
   * @param {number} f.inicio       índice do 1º documento
   * @param {number} f.porPagina    10 | 20 | 50
   * @returns {{total:number|null, temas:Array, html:string}}
   */
  async buscar(f = {}) {
    await this.abrir();
    const campos = {
      novaConsulta: 'true',
      tipo_pesquisa: REP_TIPOS[f.tipo ?? 'repetitivo'] ?? 'T',
      pesquisa_livre: f.query ?? '',
      cod_tema_inicial: f.temaInicial ?? '',
      cod_tema_final: f.temaFinal ?? '',
      sg_ramo_direito: f.ramo ?? '',
      sg_classe: f.classe ?? '',
      num_processo_classe: f.numeroProcesso ?? '',
      i: String(f.inicio ?? 1),
      quantidadeResultadosPorPagina: String(f.porPagina ?? 10),
    };
    const body = Object.entries(campos).map(([k, v]) => `${encLatin1(k)}=${encLatin1(v)}`).join('&');
    const res = await this.context.request.post(REP_PESQUISA, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: REP_BASE },
      data: body,
      timeout: this.timeout,
    });
    const html = (await res.body()).toString('latin1');
    const m = html.match(/([\d.]+)\s+documentos?\s+encontrados?/i);
    const temas = await this.page.evaluate(_extrairTemasNoDom, html);
    return { total: m ? Number(m[1].replace(/\./g, '')) : null, temas, html };
  }
}

STJNavigator.Repetitivos = STJRepetitivos;
STJNavigator.REP_BASE = REP_BASE;
STJNavigator.REP_PESQUISA = REP_PESQUISA;
STJNavigator.REP_TIPOS = REP_TIPOS;

STJNavigator.HOME = HOME;
STJNavigator.PESQUISAR = PESQUISAR;
STJNavigator.BASES = BASES;
STJNavigator.BASES_ALIAS = BASES_ALIAS;
STJNavigator.ORGAOS = ORGAOS;
STJNavigator.ORGAOS_ALIAS = ORGAOS_ALIAS;
STJNavigator.SECOES = SECOES;
STJNavigator.NOTAS = NOTAS;
STJNavigator.ORDENACOES = ORDENACOES;
STJNavigator.encLatin1 = encLatin1;
STJNavigator.montarUrl = montarUrl;
STJNavigator.montarData = montarData;
STJNavigator.lerTotal = lerTotal;

module.exports = STJNavigator;
