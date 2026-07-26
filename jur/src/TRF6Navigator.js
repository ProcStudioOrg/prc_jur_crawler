// src/TRF6Navigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator do módulo de jurisprudência do TRF6 (Minas Gerais).
 *
 *   https://eproc-jur.trf6.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
 *
 * É o MESMO módulo `eproc-jur` do TRF2, do TRF4 e do TJSC — mesmos ids
 * (#txtPesquisa, #selOrigem, #dtDecisaoInicio), mesma marcação de resultado
 * (.resultadoItem, .resLabel/.resValue) e mesma paginação. O TRF6, porém, roda
 * uma versão MAIS NOVA (9.21.6 contra 9.21.0 do TRF2), e a diferença importa —
 * ver `normalizarQuery()` logo abaixo.
 *
 * POR QUE `http` E NÃO `browser`:
 *   não há Cloudflare, captcha nem verificação F5/Shape. O POST de busca responde
 *   200 com a listagem completa sem cookie de sessão nenhum (medido). Seguindo
 *   `api-oficial > api > http > browser`, o crawler é HTTP puro (~0,4 s por
 *   busca). Não existe API oficial de jurisprudência do TRF6 — ver CLAUDE-TRF6.md.
 *   (O mapeamento, esse sim, foi feito no Playwright — ver human-codegen/TRF6/.)
 *
 * ENDPOINTS (todos POST, form urlencoded, resposta em ISO-8859-1):
 *   .../jurisprudencia/listar_resultados             busca (página 1)
 *   .../jurisprudencia/ajax_paginar_resultado        páginas 2..N (mesmo corpo + hdnPaginaAtual)
 *   .../jurisprudencia/ajax_listar_tipo_documento    JSON dos tipos por origem
 *   .../jurisprudencia/ajax_carregar_listas_pesquisa JSON de classe/relator/órgão
 *   .../jurisprudencia/download_inteiro_teor         inteiro teor (HTML, ISO-8859-1)
 */

const HOST = 'eproc-jur.trf6.jus.br';
const BASE = `https://${HOST}/eproc/`;
const acao = (a) => `${BASE}externo_controlador.php?acao=jurisprudencia@jurisprudencia/${a}`;

const PAGE_URL = acao('pesquisar');
const LIST_URL = acao('listar_resultados');
const PAGINAR_URL = acao('ajax_paginar_resultado');
const TIPOS_URL = acao('ajax_listar_tipo_documento');
const LISTAS_URL = acao('ajax_carregar_listas_pesquisa');
/** Entrada divulgada pelo tribunal; redireciona para PAGE_URL. */
const PORTAL_URL = 'https://eproc-jur.trf6.jus.br/';

/**
 * Combo "Origem" (#selOrigem) — É AQUI QUE MORA A DESAMBIGUAÇÃO entre a Justiça
 * Federal comum de 2º grau e os Juizados Especiais Federais.
 * Valores lidos do DOM vivo (human-codegen/TRF6/01-eproc-jurisprudencia/02-origens.json).
 *
 * ⚠️ São QUATRO, uma a mais que no TRF2: o TRF6 declara também "Varas Federais"
 * (1º grau). Ela está VAZIA — ver ORIGENS_VAZIAS.
 */
const ORIGENS = {
  trf6: '1',    // TRF6             -> 2º grau da JUSTIÇA FEDERAL COMUM (Turmas/Seções)
  tru: '2',     // TRU6             -> Turma Regional de Uniformização dos JUIZADOS
  turmas: '3',  // Turmas Recursais -> 2º grau dos JUIZADOS ESPECIAIS FEDERAIS (6 turmas, MG)
  varas: '4',   // Varas Federais   -> 1º grau — DECLARADA E VAZIA (0 documentos)
};

const ORIGENS_LABEL = {
  1: 'TRF6 (Justiça Federal comum, 2º grau)',
  2: 'TRU6 (Turma Regional de Uniformização — Juizados)',
  3: 'Turmas Recursais (Juizados Especiais Federais de MG)',
  4: 'Varas Federais (1º grau — base vazia)',
};

/**
 * Origens que o site oferece mas que não têm documento nenhum. Medido em
 * 25/07/2026 com o curinga `*`: TRF6 216.706 · TRU6 139 · Turmas 59.484 ·
 * Varas Federais **0**. Não é bug do crawler — é a base.
 */
const ORIGENS_VAZIAS = ['varas'];

/** Aliases aceitos na CLI -> chave de ORIGENS (ou 'todas'). */
const ORIGENS_ALIAS = {
  trf6: 'trf6', trf: 'trf6', comum: 'trf6', 'justica-comum': 'trf6', 'justiça-comum': 'trf6',
  'segundo-grau': 'trf6', tribunal: 'trf6',
  turmas: 'turmas', 'turmas-recursais': 'turmas', juizados: 'turmas', juizado: 'turmas',
  'juizados-especiais': 'turmas', recursal: 'turmas', jef: 'turmas', tr: 'turmas',
  tru: 'tru', tru6: 'tru', uniformizacao: 'tru', 'uniformização': 'tru',
  'turma-regional-uniformizacao': 'tru',
  varas: 'varas', 'varas-federais': 'varas', 'primeiro-grau': 'varas', '1grau': 'varas',
  sentencas: 'varas', 'sentenças': 'varas',
  todas: 'todas', todos: 'todas', ambas: 'todas', tudo: 'todas',
};

/**
 * Combo "Tipo de documento" (#selTipoDocumento).
 * Como no TRF2, os CÓDIGOS NÃO MUDAM com a origem; o que muda é quais existem.
 * Medido em human-codegen/TRF6/01-eproc-jurisprudencia/03-tipos-documento-por-origem.json.
 */
const TIPOS_DOCUMENTO = {
  acordao: '1',
  monocratica: '2',
  sumula: '3',
  'despacho-vice': '4',
  sentenca: '5',
};
const TIPOS_POR_ORIGEM = {
  trf6: ['acordao', 'monocratica', 'sumula', 'despacho-vice'],
  tru: ['acordao', 'monocratica'],
  turmas: ['acordao'],
  varas: ['sentenca'],
};

/** #selTamanhoPagina — as únicas opções aceitas pelo servidor. */
const TAMANHOS_PAGINA = [10, 25, 50, 100];
/** #selOrdenacao */
const ORDENACAO = { recentes: '1', antigos: '2' };

/** Percent-encode como bytes ISO-8859-1 (charset do módulo). */
function encodeLatin1(value) {
  return Array.from(Buffer.from(String(value ?? ''), 'latin1'))
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9_.~*-]/.test(c)) return c;
      if (b === 0x20) return '+';
      return '%' + b.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}

/** Pares [chave, valor] -> corpo urlencoded latin-1 (aceita chaves repetidas). */
function formEncodeLatin1(pares) {
  return pares.map(([k, v]) => `${encodeLatin1(k)}=${encodeLatin1(v)}`).join('&');
}

function limparHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * ⚠️ NÃO COPIE A CORREÇÃO DO TRF2 PARA CÁ — aqui ela QUEBRARIA a busca.
 *
 * No TRF2 (e-Proc 9.21.0) o espaço entre termos faz o servidor injetar o operador
 * em inglês como se fosse mais um termo buscado, e o crawler de lá une os termos
 * com hífen para contornar. No TRF6 (e-Proc 9.21.6) esse bug NÃO existe, e o
 * remédio do TRF2 seria veneno. Medido em 25/07/2026, origem TRF6, escopo
 * inteiro teor:
 *
 *   dano = 21.079 · moral = 2.488
 *   "dano moral"  (espaço)  ->  2.201   termos que o servidor montou: dano|moral   ✅
 *   "dano-moral"  (hífen)   ->  2.201   termos: dano|moral                          ✅ igual
 *   "dano e moral"          ->  2.201                                               ✅
 *   "dano ou moral"         -> 21.366 = 21.079 + 2.488 − 2.201                      ✅ exato
 *   "dano nao moral"        -> 18.878 = 21.079 − 2.201                              ✅ exato
 *
 * MAS com hífen os operadores viram lixo silencioso:
 *   "dano-ou-moral"  -> 216.419  (a base quase inteira; o `ou` some)
 *   "dano-nao-moral" ->   2.201  (idêntico ao E; o `nao` some)
 *
 * Ou seja: hifenizar aqui destruiria `ou` e `não`. Por isso esta função é
 * DELIBERADAMENTE uma identidade — ela existe para documentar a decisão e para
 * emitir o único aviso que ainda faz sentido neste portal.
 *
 * O que continua valendo: os operadores em inglês (`and`, `or`, `not`) NÃO são
 * operadores — viram termo literal (`dano and moral` = 6 documentos, porque
 * exige a palavra "and", que aparece em 309 documentos). Use os portugueses.
 *
 * @param {string} q
 * @returns {{query: string, aviso: string|null, alterada: boolean}}
 */
function normalizarQuery(q) {
  const original = String(q ?? '').trim();
  if (!original) return { query: '', aviso: null, alterada: false };

  const semAspas = original.replace(/"[^"]*"/g, ' ');
  if (/(^|\s)(and|or|not)(\s|$)/i.test(semAspas)) {
    return {
      query: original,
      alterada: false,
      aviso: 'TRF6: "and"/"or"/"not" NÃO são operadores neste portal — viram termo literal e ' +
        'a busca devolve quase nada sem avisar. Use os operadores em português: e, ou, não, prox.',
    };
  }
  return { query: original, aviso: null, alterada: false };
}

class TRF6Navigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.log = options.log ?? (() => {});
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  }

  /** Requisição crua com retries; resposta decodificada como latin-1. @private */
  _request(method, url, bodyLatin1 = null, attempt = 0) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          Referer: PAGE_URL,
          Origin: `https://${HOST}`,
          ...(bodyLatin1 != null
            ? {
              'Content-Type': 'application/x-www-form-urlencoded; charset=ISO-8859-1',
              'Content-Length': Buffer.byteLength(bodyLatin1),
            }
            : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} em ${url}`));
          resolve({ buffer, text: buffer.toString('latin1'), headers: res.headers });
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout de ${this.timeout}ms em ${url}`)));
      req.on('error', reject);
      if (bodyLatin1 != null) req.write(bodyLatin1);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const espera = 2000 * (attempt + 1);
        this.log(`Retentativa ${attempt + 1}/${this.retries} em ${espera}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, espera)).then(() => this._request(method, url, bodyLatin1, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * Monta o corpo do formulário.
   *
   * TODO campo é escrito SEMPRE, inclusive vazio: o e-Proc repõe o formulário a
   * partir de cookies quando um campo falta, e um `txtProcesso` herdado da
   * consulta anterior faz a busca seguinte devolver 0 sem qualquer aviso
   * (armadilha já documentada no TJSC e no TRF2).
   * @private
   */
  _corpo(f = {}, pagina = null) {
    const pares = [['txtPesquisa', f.query ?? '']];
    pares.push(['hdnExibirPesquisaAvancada', '']);
    pares.push(['hdnUrlCarregarListasCombobox', 'externo_controlador.php?acao=jurisprudencia@jurisprudencia/ajax_carregar_listas_pesquisa']);
    for (const o of f.origens ?? []) pares.push(['selOrigem[]', o]);
    for (const t of f.tiposDocumento ?? []) pares.push(['selTipoDocumento[]', t]);
    for (const c of f.classes ?? []) pares.push(['selClasse[]', c]);
    for (const r of f.relatores ?? []) pares.push(['selRelator[]', r]);
    for (const o of f.orgaos ?? []) pares.push(['selOrgao[]', o]);
    if (f.precedenteRelevante) pares.push(['chkPrecedenteRelevante', 'on']);
    // "Agrupar Resultados" vem MARCADO no site; manter o default faz a contagem
    // do crawler bater com a da tela.
    if (f.agrupar !== false) pares.push(['chkAgruparResultados', 'on']);
    pares.push(['rdoCampo', f.escopo === 'ementa' ? 'E' : 'I']);
    if (f.escopo === 'ementa' && f.somenteCaput) pares.push(['chkCaput', 'on']);
    pares.push(['txtProcesso', f.processo ? String(f.processo) : '']);
    for (const [campo, valor] of [
      ['dtDecisaoInicio', f.dataDecisaoInicio], ['dtDecisaoFim', f.dataDecisaoFim],
      ['hdnDecisaoInicio', f.dataDecisaoInicio], ['hdnDecisaoFim', f.dataDecisaoFim],
      ['dtPublicacaoInicio', f.dataPublicacaoInicio], ['dtPublicacaoFim', f.dataPublicacaoFim],
      ['hdnPublicacaoInicio', f.dataPublicacaoInicio], ['hdnPublicacaoFim', f.dataPublicacaoFim],
    ]) pares.push([campo, valor ?? '']);
    pares.push(['selOrdenacao', ORDENACAO[f.ordenacao] ?? ORDENACAO.recentes]);
    pares.push(['selTamanhoPagina', String(f.tamanhoPagina ?? 10)]);
    if (pagina != null) {
      pares.push(['hdnUrlPaginar', 'externo_controlador.php?acao=jurisprudencia@jurisprudencia/ajax_paginar_resultado']);
      pares.push(['hdnTotalPaginas', String(f.totalPaginas ?? 1)]);
      pares.push(['hdnPaginaAtual', String(pagina)]);
      pares.push(['hdnTotalResultado', String(f.totalResultado ?? 0)]);
      pares.push(['hdnDocsSelecionados', '']);
    }
    return formEncodeLatin1(pares);
  }

  /**
   * Executa a busca (página 1).
   *
   * @param {Object} f
   * @param {string} f.query          termo (ver normalizarQuery — aqui NÃO se hifeniza)
   * @param {string[]} f.origens      códigos do #selOrigem — a desambiguação
   * @param {string[]} f.tiposDocumento
   * @param {string} f.escopo         'inteiroTeor' (default do site) | 'ementa'
   * @param {boolean} f.somenteCaput  só com escopo 'ementa'
   * @param {string} f.dataDecisaoInicio/Fim, f.dataPublicacaoInicio/Fim  DD/MM/YYYY
   * @param {string} f.processo       nº do processo (#txtProcesso)
   * @param {string[]} f.classes, f.relatores, f.orgaos  valores exatos dos combos
   * @param {boolean} f.precedenteRelevante
   * @param {boolean} f.agrupar       default true (é o default do site)
   * @param {string} f.ordenacao      'recentes' (default) | 'antigos'
   * @param {number} f.tamanhoPagina  10 | 25 | 50 | 100
   * @returns {{total:number|null, totalPaginas:number, paginaAtual:number,
   *            estado:'itens'|'vazio'|'indefinido', resultados:Array}}
   */
  async pesquisar(f = {}) {
    if (f.tamanhoPagina && !TAMANHOS_PAGINA.includes(Number(f.tamanhoPagina))) {
      throw new Error(`tamanho de página inválido: ${f.tamanhoPagina} (use ${TAMANHOS_PAGINA.join(', ')})`);
    }
    const res = await this._request('POST', LIST_URL, this._corpo(f));
    return this.parse(res.text);
  }

  /**
   * Busca a página N (N >= 2). Reenvia o MESMO corpo — o endpoint de paginação é
   * stateless: sem os filtros no corpo ele pagina outra consulta.
   */
  async paginar(f, pagina, contexto = {}) {
    const res = await this._request('POST', PAGINAR_URL, this._corpo({ ...f, ...contexto }, pagina));
    return this.parse(res.text);
  }

  /**
   * Lê contador, paginação e cards do HTML.
   *
   * "Zero cards" é ambíguo (busca vazia × resposta truncada), e traduzir a
   * ambiguidade em "não existe" é o pior erro possível num verificador. Por isso
   * devolvemos `estado`:
   *   'itens'      -> há cards
   *   'vazio'      -> o próprio HTML declara total 0
   *   'indefinido' -> não deu para saber; NÃO conclua ausência
   */
  parse(html) {
    const num = (re) => {
      const m = html.match(re);
      return m ? Number(String(m[1]).replace(/\./g, '')) : null;
    };
    let total = num(/id="hdnTotalResultado"[^>]*value="(\d+)"/);
    if (total === null) total = num(/([\d.]+)\s+documentos?\s+encontrados?/i);
    const totalPaginas = num(/id="hdnTotalPaginas"[^>]*value="(\d+)"/) ?? (total ? Math.ceil(total / 10) : 0);
    const paginaAtual = num(/id="hdnPaginaAtual"[^>]*value="(\d+)"/) ?? 1;
    const resultados = this.extrair(html);
    let estado = 'indefinido';
    if (resultados.length) estado = 'itens';
    else if (total === 0) estado = 'vazio';
    return { total, totalPaginas, paginaAtual, estado, resultados };
  }

  /** Extrai os cards `.resultadoItem` (mesma marcação do TRF2/TRF4/TJSC). */
  extrair(html) {
    const blocos = html.split(/<div class="card mb-3 resultadoItem"/).slice(1);
    return blocos.map((bruto) => {
      const bloco = '<div class="card mb-3 resultadoItem"' + bruto;
      const um = (re, i = 1) => {
        const m = bloco.match(re);
        return m ? limparHtml(m[i]) : '';
      };
      // Os rótulos são <div class="resLabel">X</div><div class="resValue …">…</div>.
      // ⚠️ No TRF6 o resValue vem com classes/atributos extras
      // (class="resValue limitado" data-campo="EMENTA" …). Casar `class="resValue"`
      // exato — como faz o TRF2 — perderia RELATOR, DECISÃO e EMENTA.
      const porRotulo = (rotulo) => {
        const re = new RegExp(`<div class="resLabel">\\s*${rotulo}\\s*</div>\\s*(?:<[^>]*>\\s*)*?<div class="resValue[^"]*"[^>]*>([\\s\\S]*?)</div>`, 'i');
        return um(re);
      };
      const processoBruto = um(/class="numero-processo"[^>]*>([\s\S]*?)<\/a>/);
      const [numero, sufixo] = processoBruto.split('/');
      let inteiroTeorLink = (bloco.match(/class="text-dark inteiroTeor"[^>]*data-link="([^"]+)"/) || [])[1] || '';
      inteiroTeorLink = inteiroTeorLink.replace(/&amp;/g, '&');
      if (inteiroTeorLink && !/^https?:/.test(inteiroTeorLink)) inteiroTeorLink = BASE + inteiroTeorLink;
      return {
        id: (bloco.match(/id="resultado(\d+)"/) || [])[1] || '',
        tipoDocumento: um(/class="resValueTipoJurisprudencia">([\s\S]*?)<\/div>/),
        numeroProcesso: (numero || '').trim(),
        sufixoOrigem: (sufixo || '').trim(),
        processoUrl: ((bloco.match(/class="numero-processo"[^>]*href="([^"]+)"/) ||
          bloco.match(/href="([^"]+)"[^>]*class="numero-processo"/) || [])[1] || '').replace(/&amp;/g, '&'),
        classe: um(/class="numero-processo"[\s\S]*?<span>([\s\S]*?)<\/span>/),
        uf: porRotulo('UF'),
        orgaoJulgador: porRotulo('ÓRGÃO JULGADOR'),
        dataJulgamento: porRotulo('DATA DO JULGAMENTO'),
        dataPublicacao: porRotulo('DATA DA PUBLICAÇÃO'),
        relator: porRotulo('RELATOR'),
        relatorAcordao: porRotulo('RELATOR PARA ACÓRDÃO'),
        decisao: porRotulo('DECISÃO'),
        ementa: porRotulo('EMENTA'),
        citacao: um(/class="text-dark copiarCitacao"[\s\S]*?data-citacao="([\s\S]*?)"\s*>/),
        inteiroTeorLink,
      };
    });
  }

  /** Tipos de documento existentes numa origem (JSON do próprio site). */
  async tiposDocumento(origem = '1') {
    const res = await this._request('POST', TIPOS_URL, formEncodeLatin1([['origem', origem]]));
    try {
      return JSON.parse(res.buffer.toString('utf-8')).map((t) => ({ id: String(t.id), label: t.descricao }));
    } catch {
      return [];
    }
  }

  /**
   * Classes, relatores e órgãos.
   *
   * ⚠️ Por HTTP este endpoint IGNORA o parâmetro `origem` e devolve a UNIÃO das
   * quatro origens (98 classes / 70 relatores / 24 órgãos). No browser ele
   * responde por origem, porque lê a sessão — as listas POR ORIGEM estão gravadas
   * em `human-codegen/TRF6/01-eproc-jurisprudencia/03-*.json`
   * (TRF6: 81/52/17 · TRU6: 6/9/1 · Turmas: 11/23/6 · Varas: 0/0/0).
   * Na prática não atrapalha: os `value` dos combos são o próprio texto, então
   * filtrar por um órgão que não pertence à origem escolhida devolve 0.
   */
  async listas() {
    const res = await this._request('POST', LISTAS_URL, formEncodeLatin1([['origem', '']]));
    const vazio = { classes: [], relatores: [], orgaos: [] };
    try {
      const j = JSON.parse(res.buffer.toString('utf-8'));
      const par = (o) => Object.entries(o || {}).map(([id, label]) => ({ id, label }));
      return { classes: par(j.arrClasse), relatores: par(j.arrRelator), orgaos: par(j.arrOrgao) };
    } catch {
      return vazio;
    }
  }

  /** Origens e tipos, para `--listar-combos`. */
  async combos(origem = '1') {
    const listas = await this.listas();
    return {
      origens: Object.entries(ORIGENS).map(([chave, id]) => ({ id, chave, label: ORIGENS_LABEL[id] })),
      tiposDocumento: await this.tiposDocumento(origem),
      ...listas,
      nota: 'classes/relatores/orgaos vêm na UNIÃO das quatro origens: por HTTP o endpoint do ' +
        'site ignora o filtro de origem (ver CLAUDE-TRF6.md). As listas POR ORIGEM estão em ' +
        'human-codegen/TRF6/01-eproc-jurisprudencia/03-*.json. tiposDocumento, esse sim, é da origem pedida.',
    };
  }

  /**
   * Baixa o inteiro teor. Vem em HTML declarado ISO-8859-1 — e é ISO-8859-1 de
   * verdade; decodificar como UTF-8 produz mojibake.
   * @returns {{html:string, texto:string}}
   */
  async baixarInteiroTeor(link) {
    if (!link) throw new Error('resultado sem link de inteiro teor');
    const url = /^https?:/.test(link) ? link : BASE + link;
    const res = await this._request('GET', url);
    let html;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(res.buffer);
    } catch {
      html = new TextDecoder('windows-1252').decode(res.buffer);
    }
    return { html, texto: stripHtml(html) };
  }

  /** Grava o inteiro teor de um lote + index.json (mesmo contrato do TRF2/TJSC/TJRS). */
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

  /** Compatibilidade com a interface dos navigators de browser. */
  async fechar() { /* HTTP puro: nada a fechar */ }
}

TRF6Navigator.HOST = HOST;
TRF6Navigator.BASE = BASE;
TRF6Navigator.PAGE_URL = PAGE_URL;
TRF6Navigator.LIST_URL = LIST_URL;
TRF6Navigator.PAGINAR_URL = PAGINAR_URL;
TRF6Navigator.PORTAL_URL = PORTAL_URL;
TRF6Navigator.ORIGENS = ORIGENS;
TRF6Navigator.ORIGENS_LABEL = ORIGENS_LABEL;
TRF6Navigator.ORIGENS_ALIAS = ORIGENS_ALIAS;
TRF6Navigator.ORIGENS_VAZIAS = ORIGENS_VAZIAS;
TRF6Navigator.TIPOS_DOCUMENTO = TIPOS_DOCUMENTO;
TRF6Navigator.TIPOS_POR_ORIGEM = TIPOS_POR_ORIGEM;
TRF6Navigator.TAMANHOS_PAGINA = TAMANHOS_PAGINA;
TRF6Navigator.ORDENACAO = ORDENACAO;
TRF6Navigator.normalizarQuery = normalizarQuery;
TRF6Navigator.limparHtml = limparHtml;

module.exports = TRF6Navigator;
