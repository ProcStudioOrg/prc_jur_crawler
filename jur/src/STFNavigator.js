// src/STFNavigator.js
//
// Cliente da API de pesquisa de jurisprudência do STF.
//
//   SPA:  https://jurisprudencia.stf.jus.br/pages/search        (Angular)
//   API:  POST https://jurisprudencia.stf.jus.br/api/search/search
//
// A API é um *passthrough de Elasticsearch*: o corpo do POST é a própria query
// DSL. Este arquivo reimplementa, fielmente, o construtor de query da SPA
// (módulo `KLra` do bundle `main-es2015.*.js`) — inclusive o
// `_preprocessQueryString`, que traduz os operadores em português
// (`e`/`ou`/`não` → `AND`/`OR`/`NOT`, `$` → `*`) ANTES de mandar ao servidor.
// Sem essa tradução os operadores viram termo literal e a contagem muda.
//
// Três armadilhas do portal, todas confirmadas ao vivo em 25/07/2026:
//
//  1. **AWS WAF** — `jurisprudencia.stf.jus.br` responde `202 + x-amzn-waf-action:
//     challenge` a qualquer cliente sem o cookie `aws-waf-token`. O desafio é
//     JavaScript; resolvemos UMA vez com Playwright e guardamos o cookie em
//     disco (validade ~4 dias). Depois disso tudo roda em HTTP puro.
//  2. **Cadeia TLS incompleta** — o servidor manda só o certificado folha, sem o
//     intermediário GlobalSign. `curl` no macOS passa (keychain), Node não.
//     `_garantirCA()` busca o intermediário pela extensão AIA do próprio
//     certificado e o adiciona ao bundle de CAs — sem desligar a verificação.
//  3. **Limiar de 8 KB do WAF** — corpos com ATÉ 8192 bytes são inspecionados;
//     expressões com `) OR (` viram assinatura de SQL injection e levam 403.
//     A SPA nunca esbarra nisso porque sempre manda o bloco `highlight`, que
//     empurra o corpo acima de 8 KB. Fazemos o mesmo (ver `_setHighlight`).

const https = require('https');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = 'jurisprudencia.stf.jus.br';
const BASE_URL = `https://${HOST}`;
const SEARCH_URL = `${BASE_URL}/api/search/search`;
const CONFIG_URL = `${BASE_URL}/api/admin/loadConfig`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CACHE_TOKEN = path.join(os.tmpdir(), 'jur-stf-waf-token.json');
const CACHE_CA = path.join(os.tmpdir(), 'jur-stf-ca.pem');

/** As 4 bases + a sub-base Repercussão Geral (que é um filtro sobre acordaos). */
const BASES = {
  acordaos: 'acordaos',
  decisoes: 'decisoes',
  sumulas: 'sumulas',
  informativos: 'novo_informativo',
};

/** Órgãos julgadores da base Acórdãos (enumerados pela agregação, 25/07/2026). */
const ORGAOS = ['Tribunal Pleno', 'Primeira Turma', 'Segunda Turma', 'Terceira Turma'];

// ---------------------------------------------------------------------------
// Configuração copiada do módulo `ZgHd` do bundle da SPA
// ---------------------------------------------------------------------------
const CFG = {
  mainQueryFilterFields: ['processo_codigo_completo', 'acordao_ata', 'documental_acordao_mesmo_sentido_lista_texto', 'documental_doutrina_texto', 'documental_indexacao_texto', 'documental_jurisprudencia_citada_texto', 'documental_legislacao_citada_texto', 'documental_observacao_texto', 'documental_publicacao_lista_texto', 'documental_tese_tema_texto', 'documental_tese_texto', 'ementa_texto', 'ministro_facet', 'revisor_processo_nome', 'orgao_julgador', 'partes_lista_texto', 'procedencia_geografica_completo', 'processo_classe_processual_unificada_extenso', 'titulo', 'colac_numero', 'colac_pagina', 'decisao_texto', 'documental_decisao_mesmo_sentido_lista_texto', 'processo_precedente_texto', 'sumula_texto', 'ramo_direito', 'situacao_sumula', 'materia_noticia', 'titulo_noticia', 'resumo_noticia', 'conteudo_noticia', 'ramo_noticia'],
  mainQueryShouldFields: ['acordao_ata', 'documental_doutrina_texto', 'documental_indexacao_texto', 'documental_jurisprudencia_citada_texto', 'documental_observacao_texto', 'documental_tese_tema_texto', 'documental_tese_texto', 'ementa_texto', 'titulo', 'decisao_texto', 'sumula_texto', 'ramo_direito', 'situacao_sumula', 'materia_noticia', 'titulo_noticia', 'resumo_noticia', 'conteudo_noticia', 'ramo_noticia'],
  mainQueryPhraseBigSlopFields: ['acordao_ata', 'documental_tese_tema_texto', 'documental_tese_texto', 'ementa_texto', 'decisao_texto', 'situacao_sumula', 'titulo_noticia', 'resumo_noticia', 'conteudo_noticia'],
  mainQueryPhraseSmallSlopFields: ['documental_acordao_mesmo_sentido_lista_texto', 'documental_doutrina_texto', 'documental_indexacao_texto', 'documental_jurisprudencia_citada_texto', 'documental_legislacao_citada_texto', 'documental_observacao_texto', 'partes_lista_texto', 'processo_precedente_texto', 'documental_decisao_mesmo_sentido_lista_texto'],
  mainQueryPhraseHighlightMatcher: ['documental_publicacao_lista_texto', 'ministro_facet', 'revisor_processo_nome', 'orgao_julgador', 'ramo_direito', 'ramo_noticia', 'procedencia_geografica_completo', 'processo_classe_processual_unificada_extenso', 'titulo', 'colac_numero', 'colac_pagina', 'sumula_texto'],
  fieldWeights: { decisao_texto: 2, acordao_ata: 3, documental_tese_tema_texto: 3, documental_tese_texto: 3, ementa_texto: 3, sumula_texto: 3, titulo: 6, ramo_direito: 1, situacao_sumula: 1, ramo_noticia: 1, titulo_noticia: 3, resumo_noticia: 3, materia_noticia: 1, conteudo_noticia: 1 },
  queryFieldsWithoutSuffix: ['volume_informativo', 'julgamento_data'],
  advancedFilters: {
    classeNumeroIncidente: ['titulo', 'processo_codigo_completo', 'processo_classe_processual_unificada_extenso', 'documental_acordao_mesmo_sentido_lista_texto', 'documental_decisao_mesmo_sentido_lista_texto'],
    ementaAtaIndexacao: ['acordao_ata', 'documental_indexacao_texto', 'ementa_texto'],
    tese: ['documental_tese_texto'],
    tema: ['documental_tese_tema_texto'],
    partes: ['partes_lista_texto'],
    legislacao: ['documental_legislacao_citada_texto'],
    observacao: ['documental_observacao_texto'],
    numero: ['volume_informativo'],
  },
  advWeights: { ementaAtaIndexacao: { acordao_ata: 3, ementa_texto: 3 }, tese: { documental_tese_texto: 3 }, tema: { documental_tese_tema_texto: 3 } },
  aggregations: {
    acordaos: ['is_repercussao_geral', 'is_repercussao_geral_admissibilidade', 'is_repercussao_geral_merito', 'is_iac', 'is_iac_admissibilidade', 'is_iac_merito', 'is_questao_ordem', 'is_colac', 'orgao_julgador', 'ministro_facet', 'processo_classe_processual_unificada_classe_sigla', 'procedencia_geografica_uf_sigla'],
    decisoes: ['is_decisao_presidencia', 'orgao_julgador', 'ministro_facet', 'processo_classe_processual_unificada_classe_sigla', 'procedencia_geografica_uf_sigla'],
    sumulas: ['is_vinculante', 'ramo_direito', 'situacao_sumula'],
    informativos: ['is_repercussao_geral', 'ramo_noticia', 'orgao_julgador', 'ministro_facet', 'processo_classe_processual_unificada_classe_sigla', 'procedencia_geografica_uf_sigla'],
  },
  baseFilters: ['is_repercussao_geral', 'is_repercussao_geral_admissibilidade', 'is_repercussao_geral_merito', 'is_iac', 'is_iac_admissibilidade', 'is_iac_merito', 'is_questao_ordem', 'is_colac', 'is_decisao_presidencia', 'is_vinculante'],
  baseFiltersPorBase: ['is_repercussao_geral', 'is_iac'],
  camposKeyword: ['processo_classe_processual_unificada_classe_sigla', 'ministro_facet', 'orgao_julgador', 'tribunal_sigla', 'ramo_noticia', 'ramo_direito', 'situacao_sumula'],
  highlightFields: ['ementa_texto', 'sumula_texto', 'materia_noticia', 'titulo_noticia', 'resumo_noticia', 'conteudo_noticia', 'acordao_ata', 'decisao_texto', 'documental_tese_texto', 'documental_tese_tema_texto', 'documental_observacao_texto', 'documental_indexacao_texto', 'documental_legislacao_citada_texto', 'documental_jurisprudencia_citada_texto', 'documental_doutrina_texto', 'partes_lista_texto', 'documental_publicacao_lista_texto', 'documental_acordao_mesmo_sentido_lista_texto', 'documental_decisao_mesmo_sentido_lista_texto', 'processo_precedente_texto', 'procedencia_geografica_completo'],
};

const SOURCE_FIELDS = ['base', 'id', 'dg_unique', 'titulo', 'ministro_facet', 'procedencia_geografica_completo', 'procedencia_geografica_uf_sigla', 'procedencia_geografica_uf_extenso', 'processo_codigo_completo', 'processo_classe_processual_unificada_extenso', 'processo_classe_processual_unificada_sigla', 'processo_classe_processual_unificada_classe_sigla', 'processo_classe_processual_unificada_incidente_sigla', 'processo_numero', 'julgamento_data', 'publicacao_data', 'relator_processo_nome', 'relator_acordao_nome', 'relator_decisao_nome', 'revisor_processo_nome', 'presidente_nome', 'orgao_julgador', 'acordao_ata', 'decisao_texto', 'ementa_texto', 'sumula_texto', 'situacao_sumula', 'ramo_direito', 'partes_lista_texto', 'documental_publicacao_lista_texto', 'documental_legislacao_citada_texto', 'documental_jurisprudencia_citada_texto', 'documental_indexacao_texto', 'documental_observacao_texto', 'documental_doutrina_texto', 'documental_tese_texto', 'documental_tese_tema_texto', 'documental_acordao_mesmo_sentido_lista_texto', 'is_vinculante', 'is_repercussao_geral', 'is_repercussao_geral_admissibilidade', 'is_repercussao_geral_merito', 'is_iac', 'is_questao_ordem', 'is_colac', 'volume_informativo', 'titulo_noticia', 'resumo_noticia', 'conteudo_noticia', 'ramo_noticia', 'inteiro_teor_url', 'inteiro_teor_texto', 'informativo_url', 'acompanhamento_processual_url', 'dje_url', 'externo_seq_objeto_incidente', 'dg_atualizado_em'];

// ---------------------------------------------------------------------------
// Pré-processamento da expressão de busca (porte de `_preprocessQueryString`)
// ---------------------------------------------------------------------------

/**
 * Expande `"a (b ou c) d"~5` em `("a b d"~5 OR "a c d"~5)`.
 * Porte das funções `l()`, `a()` e `o()` do bundle da SPA.
 * @private
 */
function expandirProximidade(entrada) {
  const tok = (v) => ({ kind: 'token', value: v });
  const alts = (c) => ({ kind: 'alts', children: c });
  const juntar = (pref, t) => (pref.length > 0 ? pref.map((p) => `${p} ${t}`) : [t]);

  const achatar = (arr) => {
    let out = [];
    for (const n of arr) {
      if (Array.isArray(n)) {
        const e = achatar(n); const i = [];
        for (const x of e) i.push(...juntar(out, x));
        out = i;
      } else if (n.kind === 'token') out = juntar(out, n.value);
      else if (n.kind === 'alts') {
        const e = [];
        for (const c of n.children) { const r = achatar(c); for (const x of r) e.push(...juntar(out, x)); }
        out = e;
      }
    }
    return out;
  };

  const agrupaOu = (arr) => {
    const t = []; let n = []; let i = null;
    for (const s of arr) {
      const ehOu = !Array.isArray(s) && s.kind === 'token' && s.value.toLowerCase() === 'ou';
      if (!ehOu) {
        if (i === null) i = s;
        else if (n.length > 0) { if (!Array.isArray(i)) i = [i]; n.push(i); t.push(alts(n)); n = []; i = s; }
        else { t.push(i); i = s; }
      } else {
        if (i === null) throw new Error('Expressão de busca inválida.');
        if (!Array.isArray(i)) i = [i];
        n.push(i); i = null;
      }
    }
    if (n.length > 0) {
      if (i === null) throw new Error('Expressão de busca inválida.');
      if (!Array.isArray(i)) i = [i];
      n.push(i); t.push(alts(n));
    } else if (i !== null) t.push(i);
    return t;
  };

  const parse = (str) => {
    const partes = str.split(/([() ])/i).map((x) => x.trim());
    const pilha = []; let cur = [];
    for (const p of partes) {
      if (p === '') continue;
      if (p === '(') { pilha.push(cur); cur = []; }
      else if (p === ')') {
        const e = pilha.pop();
        if (e === undefined) throw new Error('Expressão de busca inválida.');
        cur = [...e, agrupaOu(cur)];
      } else cur.push(tok(p));
    }
    if (pilha.length > 0) throw new Error('Expressão de busca inválida.');
    return agrupaOu(cur).flat();
  };

  let n = '';
  const partes = entrada.split(/("(?:~\d+)?)/).map((x) => x.trim());
  let buf; let dentro = false;
  for (const p of partes) {
    if (p === '') continue;
    if (p === '"') {
      if (buf !== undefined) { if (n.substr(-1) !== ':') n += ' '; n += dentro ? `"${buf}"` : `${buf}`; }
      buf = undefined; dentro = !dentro;
    } else if (p.substring(0, 2) === '"~') {
      const slop = parseInt(p.substring(2), 10);
      if (!dentro) throw new Error('Expressão de busca inválida.');
      const perms = achatar(parse((buf || '').trim()));
      if (n.substr(-1) !== ':') n += ' ';
      n += `(${perms.map((x) => `"${x}"~${slop}`).join(' OR ').trim()})`;
      buf = undefined; dentro = !dentro;
    } else buf = p;
  }
  if (buf !== undefined) {
    if (n.substr(-1) !== ':') n += ' ';
    if (dentro) throw new Error('Expressão de busca inválida.');
    n += `${buf}`;
  }
  return n.trim();
}

/**
 * Traduz a expressão do usuário para a sintaxe do Elasticsearch, exatamente
 * como a SPA faz no navegador.
 *
 *   `dano e moral`     → `dano AND moral`
 *   `droga ou entorpecente` → `droga OR entorpecente`
 *   `prisão não preventiva` → `prisão NOT preventiva`
 *   `indeniz$`         → `indeniz*`
 *   `"provimento cargo"~5` → `("provimento cargo"~5)`
 *
 * Os operadores só valem quando cercados por delimitador (`"'()[]<>`, espaço,
 * início/fim) e **nunca dentro de aspas** — por isso o trecho entre aspas é
 * mascarado antes da substituição.
 */
function preprocessarQuery(q) {
  if (!q) return q;
  let texto = String(q).replace(/[“”]/g, '"');
  const mapa = {}; let i = 0;
  texto = texto.replace(/"(?:[^"]*)"/g, (m) => { mapa[i] = m; return `\${${i++}}`; });

  const DELIM = '"\'()[]<> {}';
  const REP = { e: 'AND', ou: 'OR', nao: 'NOT', 'não': 'NOT' };
  for (const k of Object.keys(REP)) {
    texto = texto.replace(new RegExp(k, 'ig'), (m, off) => {
      const antes = off === 0 || DELIM.indexOf(texto.charAt(off - 1)) !== -1;
      const depois = off + m.length >= texto.length || DELIM.indexOf(texto.charAt(off + m.length)) !== -1;
      return antes && depois ? REP[m.toLowerCase()] : m;
    });
  }
  texto = texto.replace(/\$\{\d+\}/g, (m) => mapa[m.substring(2, m.length - 1)]);
  texto = expandirProximidade(texto);

  const barras = texto.match(/\//g);
  if (barras && (barras.length % 2 === 1 || texto.match(/(?:(\w)\/(\d))|(?:(\d)\/(\w))/g))) {
    texto = texto.replace(/\//g, '\\/');
  }
  return texto.replace(/\$/g, '*');
}

// ---------------------------------------------------------------------------

class STFNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.log = options.log ?? (() => {});
    this.headless = options.headless ?? true;
    this.pageSize = options.pageSize ?? 100; // teto do servidor: 250
    this._cookie = null;
    this._agent = null;
  }

  // ---------------- TLS: cadeia incompleta do servidor -----------------

  /**
   * O STF manda só o certificado folha. Buscamos o intermediário pela extensão
   * AIA do próprio certificado e o guardamos em cache — assim a verificação
   * continua LIGADA (nada de `rejectUnauthorized: false`).
   * @private
   */
  async _garantirCA() {
    if (fs.existsSync(CACHE_CA)) return fs.readFileSync(CACHE_CA, 'utf8');
    const uri = await new Promise((res, rej) => {
      const s = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false }, () => {
        const cert = s.getPeerCertificate();
        s.end();
        const info = cert && cert.infoAccess && cert.infoAccess['CA Issuers - URI'];
        res(info && info[0]);
      });
      s.setTimeout(this.timeout, () => s.destroy(new Error('timeout no handshake TLS com o STF')));
      s.on('error', rej);
    });
    if (!uri) throw new Error('não foi possível descobrir o certificado intermediário do STF (extensão AIA ausente)');
    const der = await new Promise((res, rej) => {
      const cli = uri.startsWith('https') ? https : http;
      const r = cli.get(uri, (rs) => {
        const bufs = [];
        rs.on('data', (c) => bufs.push(c));
        rs.on('end', () => res(Buffer.concat(bufs)));
      });
      r.on('error', rej);
      r.setTimeout(this.timeout, () => r.destroy(new Error(`timeout ao baixar ${uri}`)));
    });
    const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
    const pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
    fs.writeFileSync(CACHE_CA, pem);
    this.log(`  CA intermediária do STF baixada de ${uri}`);
    return pem;
  }

  /** @private */
  async _getAgent() {
    if (this._agent) return this._agent;
    const pem = await this._garantirCA();
    this._agent = new https.Agent({ ca: [...tls.rootCertificates, pem], keepAlive: true });
    return this._agent;
  }

  // ---------------- AWS WAF: cookie aws-waf-token -----------------

  /**
   * Obtém (do cache em disco, ou resolvendo o desafio no Playwright) o cookie
   * `aws-waf-token`. É a ÚNICA etapa que precisa de browser; vale ~4 dias.
   */
  async token({ forcar = false } = {}) {
    if (!forcar && this._cookie) return this._cookie;
    if (!forcar && fs.existsSync(CACHE_TOKEN)) {
      try {
        const t = JSON.parse(fs.readFileSync(CACHE_TOKEN, 'utf8'));
        if (t.expira * 1000 > Date.now() + 10 * 60 * 1000) { this._cookie = t.cookie; return t.cookie; }
      } catch (e) { /* cache corrompido: renova */ }
    }
    this.log('  resolvendo o desafio do AWS WAF no navegador (uma vez a cada ~4 dias)...');
    const { chromium } = require('playwright');
    const b = await chromium.launch({ headless: this.headless });
    try {
      const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR' });
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/pages/search`, { waitUntil: 'domcontentloaded', timeout: this.timeout + 30000 });
      let waf = null;
      for (let i = 0; i < 40; i++) {
        const cs = await ctx.cookies();
        waf = cs.find((c) => c.name === 'aws-waf-token');
        if (waf) break;
        await p.waitForTimeout(1000);
      }
      const cs = await ctx.cookies();
      if (!waf) throw new Error('o STF não emitiu o cookie aws-waf-token — o desafio do WAF pode ter mudado');
      const cookie = cs.map((c) => `${c.name}=${c.value}`).join('; ');
      fs.writeFileSync(CACHE_TOKEN, JSON.stringify({ cookie, expira: waf.expires }, null, 2));
      this._cookie = cookie;
      return cookie;
    } finally {
      await b.close();
    }
  }

  /** POST JSON com renovação automática do token quando o WAF desafia. @private */
  async _post(url, body, tentativa = 0) {
    const cookie = await this.token();
    const agent = await this._getAgent();
    const data = JSON.stringify(body);
    const resp = await new Promise((res, rej) => {
      const r = https.request(url, {
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'pt-BR',
          'user-agent': UA,
          origin: BASE_URL,
          referer: `${BASE_URL}/pages/search`,
          cookie,
          'content-length': Buffer.byteLength(data),
        },
      }, (rs) => {
        let d = '';
        rs.setEncoding('utf8');
        rs.on('data', (c) => { d += c; });
        rs.on('end', () => res({ status: rs.statusCode, waf: rs.headers['x-amzn-waf-action'], body: d }));
      });
      r.on('error', rej);
      r.setTimeout(this.timeout, () => r.destroy(new Error(`Timeout após ${this.timeout}ms (STF)`)));
      r.end(data);
    });

    if ((resp.status === 202 || resp.waf === 'challenge' || resp.status === 405) && tentativa < 1) {
      this.log('  token do WAF expirou; renovando...');
      await this.token({ forcar: true });
      return this._post(url, body, tentativa + 1);
    }
    if (resp.status !== 200) {
      let detalhe = resp.body.slice(0, 300);
      try { detalhe = JSON.parse(resp.body).detail || detalhe; } catch (e) { /* HTML */ }
      throw new Error(`STF HTTP ${resp.status}: ${detalhe}`);
    }
    try { return JSON.parse(resp.body); } catch (e) {
      throw new Error(`STF devolveu resposta não-JSON: ${resp.body.slice(0, 200)}`);
    }
  }

  /** GET de texto/HTML/PDF em qualquer host do STF (inteiro teor, portal). */
  async _get(url, { binario = false } = {}) {
    const agent = await this._getAgent();
    const cookie = url.includes(HOST) ? await this.token() : '';
    return new Promise((res, rej) => {
      const r = https.request(url, {
        method: 'GET',
        agent,
        headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'pt-BR', ...(cookie ? { cookie } : {}) },
      }, (rs) => {
        if ([301, 302, 303, 307, 308].includes(rs.statusCode) && rs.headers.location) {
          const prox = new URL(rs.headers.location, url).toString();
          rs.resume();
          return res(this._get(prox, { binario }).then((x) => ({ ...x, url: prox })));
        }
        const bufs = [];
        rs.on('data', (c) => bufs.push(c));
        rs.on('end', () => {
          const buf = Buffer.concat(bufs);
          res({ status: rs.statusCode, url, headers: rs.headers, body: binario ? buf : buf.toString('utf8') });
        });
      });
      r.on('error', rej);
      r.setTimeout(this.timeout, () => r.destroy(new Error(`Timeout após ${this.timeout}ms (${url})`)));
      r.end();
    });
  }

  // ---------------- construtor da query (porte da SPA) -----------------

  /** @private */
  _sufixos(ff) {
    const f = { sinonimo: true, plural: true, radicais: false, buscaExata: true, ...ff };
    if (f.radicais && f.plural) f.radicais = false;
    let fieldsSuffix = ''; let analyzer = null; let quoteAnalyzer = null; let quoteSuffix = null;
    if (f.plural) {
      fieldsSuffix = '.plural';
      if (f.sinonimo) { analyzer = 'legal_search_analyzer'; if (f.buscaExata) quoteAnalyzer = 'legal_index_analyzer'; }
      else analyzer = 'legal_index_analyzer';
    }
    if (f.radicais) {
      analyzer = f.sinonimo ? 'radical_search_analyzer' : 'radical_index_analyzer';
      if (f.buscaExata) { quoteSuffix = '.standard'; quoteAnalyzer = 'standard_analyzer'; }
    }
    if (!f.plural && !f.radicais) {
      fieldsSuffix = '.standard';
      analyzer = f.sinonimo ? 'tesauro_search_analyzer' : 'standard_analyzer';
      if (f.buscaExata) quoteAnalyzer = 'standard_analyzer';
    }
    return { fieldsSuffix, analyzer, quoteAnalyzer, quoteSuffix };
  }

  /**
   * Monta o corpo do POST /api/search/search.
   *
   * @param {Object} o
   * @param {string}  o.queryString   expressão livre (operadores em português)
   * @param {string}  o.base          acordaos|decisoes|sumulas|informativos
   * @param {Object}  o.fieldFilters  {sinonimo, plural, radicais, buscaExata, pesquisa_inteiro_teor}
   * @param {Object}  o.advancedFilters {classeNumeroIncidente, ementaAtaIndexacao, tese, tema, partes, legislacao, observacao, numero}
   * @param {Object}  o.filters       {orgao_julgador:[], ministro_facet:[], processo_classe_processual_unificada_classe_sigla:[], procedencia_geografica_uf_sigla:[], julgamento_data:{from,until}, publicacao_data:{from,until}}
   * @param {Object}  o.baseFilters   {is_repercussao_geral, is_vinculante, is_questao_ordem, is_colac, is_decisao_presidencia, ...}
   * @param {number}  o.page          0-based
   * @param {number}  o.pageSize      máximo 250
   * @param {string}  o.sort          '_score' (default) | 'date'
   * @param {string}  o.sortBy        'desc' (default) | 'asc'
   */
  montarQuery(o = {}) {
    const base = o.base || 'acordaos';
    if (!BASES[base]) throw new Error(`Base desconhecida: "${base}" (use ${Object.keys(BASES).join(', ')})`);
    const baseIdx = BASES[base];
    const ff = { sinonimo: true, plural: true, radicais: false, buscaExata: true, pesquisa_inteiro_teor: false, ...(o.fieldFilters || {}) };
    const { fieldsSuffix, analyzer, quoteAnalyzer, quoteSuffix } = this._sufixos(ff);
    const pageSize = Math.min(o.pageSize || 10, 250);
    const page = o.page || 0;

    const comSufixo = (arr) => arr.map((n) => {
      let s = n;
      if (fieldsSuffix && !CFG.queryFieldsWithoutSuffix.includes(n)) s += fieldsSuffix;
      if (CFG.fieldWeights[n] !== undefined) s += `^${CFG.fieldWeights[n]}`;
      return s;
    });
    const comAnalisador = (w) => {
      const qs = w.query_string;
      if (analyzer) qs.analyzer = analyzer;
      if (quoteAnalyzer) qs.quote_analyzer = quoteAnalyzer;
      if (quoteSuffix) qs.quote_field_suffix = quoteSuffix;
      return w;
    };

    const q = {
      query: { bool: { filter: [], must: [], should: [], must_not: [] } },
      _source: SOURCE_FIELDS,
      aggs: {},
      size: pageSize,
      from: pageSize * page,
    };

    // agregações (as facetas da tela; usamos para listar órgãos/ministros/classes)
    q.aggs.base_agg = { filters: { filters: { acordaos: { match: { base: 'acordaos' } }, sumulas: { match: { base: 'sumulas' } }, decisoes: { match: { base: 'decisoes' } }, informativos: { match: { base: 'novo_informativo' } } } } };
    for (const a of CFG.aggregations[base] || []) {
      if (CFG.baseFilters.includes(a)) {
        if (CFG.baseFiltersPorBase.includes(a)) {
          q.aggs[`${a}_agg`] = { filters: { filters: {
            true: { bool: { must: [{ match: { [a]: true } }, { term: { base: baseIdx } }] } },
            false: { bool: { must: [{ match: { [a]: false } }, { term: { base: baseIdx } }] } },
          } } };
        } else {
          q.aggs[`${a}_agg`] = { filters: { filters: { true: { match: { [a]: true } }, false: { match: { [a]: false } } } } };
        }
      } else {
        const campo = CFG.camposKeyword.includes(a) ? `${a}.keyword` : a;
        q.aggs[`${a}_agg`] = { aggs: { [`${a}_agg`]: { terms: { field: campo, size: 200, execution_hint: 'map' } } }, filter: { bool: { must: [{ term: { base: baseIdx } }] } } };
      }
    }

    if (o.queryString) {
      const pq = preprocessarQuery(o.queryString);
      const should1 = comSufixo(CFG.mainQueryShouldFields);
      const filt = comSufixo(CFG.mainQueryFilterFields);
      const big = comSufixo(CFG.mainQueryPhraseBigSlopFields);
      if (ff.pesquisa_inteiro_teor) {
        const it = `inteiro_teor_texto${fieldsSuffix}`;
        should1.push(it); filt.push(it); big.push(`${it}^0.5`);
      }
      q.query.bool.should.push(comAnalisador({ query_string: { default_operator: 'AND', fields: should1, query: pq, tie_breaker: 1, fuzziness: 'AUTO:4,7' } }));
      q.query.bool.filter.push(comAnalisador({ query_string: { default_operator: 'AND', fields: filt, query: pq, type: 'cross_fields', fuzziness: 'AUTO:4,7' } }));
      q.query.bool.should.push(comAnalisador({ query_string: { default_operator: 'and', type: 'phrase', tie_breaker: 1, phrase_slop: 20, fields: big, query: pq, fuzziness: 'AUTO:4,7' } }));
      q.query.bool.should.push(comAnalisador({ query_string: { default_operator: 'and', type: 'phrase', tie_breaker: 1, phrase_slop: 5, fields: comSufixo(CFG.mainQueryPhraseSmallSlopFields), query: pq, fuzziness: 'AUTO:4,7' } }));
      q.query.bool.should.push(comAnalisador({ query_string: { default_operator: 'and', type: 'phrase', phrase_slop: 1, fields: comSufixo(CFG.mainQueryPhraseHighlightMatcher), query: pq, fuzziness: 'AUTO:4,7', boost: 0 } }));
    }

    for (const [k, v] of Object.entries(o.advancedFilters || {})) {
      if (!v || !CFG.advancedFilters[k]) continue;
      const campos = CFG.advancedFilters[k].map((n) => {
        let s = n;
        if (fieldsSuffix && !CFG.queryFieldsWithoutSuffix.includes(n)) s += fieldsSuffix;
        const w = (CFG.advWeights[k] || {})[n];
        if (w) s += `^${w}`;
        return s;
      });
      q.query.bool.filter.push(comAnalisador({ query_string: { fields: campos, default_operator: 'and', query: preprocessarQuery(v), type: 'best_fields', fuzziness: 'AUTO:4,7' } }));
    }

    q.post_filter = { bool: { must: [{ term: { base: baseIdx } }], should: [] } };
    for (const [k, v] of Object.entries(o.baseFilters || {})) {
      if (v === undefined || v === null) continue;
      q.post_filter.bool.minimum_should_match = 1;
      q.post_filter.bool.should.push({ match: { [k]: v } });
    }
    for (const [k, v] of Object.entries(o.filters || {})) {
      if (Array.isArray(v)) {
        if (!v.length) continue;
        const campo = CFG.camposKeyword.includes(k) ? `${k}.keyword` : k;
        q.post_filter.bool.must.push({ terms: { [campo]: v } });
      } else if (v && typeof v === 'object') {
        const r = { [k]: { format: 'ddMMyyyy' } };
        if (v.from || v.gte) r[k].gte = v.from || v.gte;
        if (v.until || v.lte) r[k].lte = v.until || v.lte;
        if (Object.keys(r[k]).length > 1) q.query.bool.filter.push({ range: r });
      }
    }

    q.sort = [];
    const campoOrd = o.sort === 'date' ? 'julgamento_data' : (o.sort || '_score');
    q.sort.push({ [campoOrd]: o.sortBy || 'desc' });
    if (base === 'sumulas' && campoOrd !== '_score') {
      q.sort.push({ tiebreaker_sort: (o.sortBy || 'desc') === 'asc' ? { order: 'asc', missing: '_first' } : { order: 'desc', missing: '_last' } });
    }
    q.track_total_hits = true;

    // `highlight` — a SPA sempre manda. Além de destacar o termo, mantém o
    // corpo do POST acima de 8 KB: abaixo disso o WAF inspeciona o payload e
    // devolve 403 em expressões com `) OR (` (assinatura de SQL injection).
    q.highlight = {
      highlight_query: JSON.parse(JSON.stringify(q.query)),
      number_of_fragments: 64,
      fragment_size: 300,
      order: 'score',
      pre_tags: ['<em>'],
      post_tags: ['</em>'],
      fields: Object.fromEntries(CFG.highlightFields.map((f) => [f, { matched_fields: [`${f}${fieldsSuffix || '.plural'}`], type: 'fvh' }])),
    };

    if (o.sort !== 'date') {
      q.query = {
        function_score: {
          functions: [
            { exp: { julgamento_data: { origin: 'now', scale: '47450d', offset: '1095d', decay: 0.1 } } },
            { filter: { term: { 'orgao_julgador.keyword': 'Tribunal Pleno' } }, weight: 1.15 },
            { filter: { term: { is_repercussao_geral: true } }, weight: 1.1 },
          ],
          query: q.query,
        },
      };
    }
    return q;
  }

  /** Executa uma busca. @returns {{total:number, hits:Array, aggs:Object}} */
  async buscar(o = {}) {
    const r = await this._post(SEARCH_URL, this.montarQuery(o));
    const res = r.result || {};
    return {
      total: res.hits?.total?.value ?? 0,
      hits: (res.hits?.hits || []).map((h) => ({ _id: h._id, _score: h._score, ...h._source })),
      aggs: res.aggregations || {},
    };
  }

  /** Só a contagem (usado para provar que um filtro muda o resultado). */
  async contar(o = {}) {
    return (await this.buscar({ ...o, pageSize: 1 })).total;
  }

  /** Lista os ministros ativos (endpoint público da SPA). */
  async ministrosAtivos() {
    const agent = await this._getAgent();
    const cookie = await this.token();
    return new Promise((res, rej) => {
      https.get(CONFIG_URL, { agent, headers: { 'user-agent': UA, cookie, accept: 'application/json' } }, (rs) => {
        let d = '';
        rs.on('data', (c) => { d += c; });
        rs.on('end', () => { try { res(JSON.parse(d).ministros || []); } catch (e) { rej(new Error('loadConfig inválido')); } });
      }).on('error', rej);
    });
  }

  /** Enumera uma faceta (órgão, ministro, classe, UF...) da base indicada. */
  async facetas(base = 'acordaos', nome = 'orgao_julgador') {
    const { aggs } = await this.buscar({ base, pageSize: 1 });
    const a = aggs[`${nome}_agg`];
    if (!a) return [];
    const inner = a[`${nome}_agg`] || a;
    if (Array.isArray(inner.buckets)) return inner.buckets.map((b) => ({ valor: b.key, docs: b.doc_count }));
    return Object.entries(inner.buckets || {}).map(([k, v]) => ({ valor: k, docs: v.doc_count }));
  }

  /** Permalink de um documento da pesquisa de jurisprudência. */
  documentoUrl(id) {
    return `${BASE_URL}/pages/search/${id}/false`;
  }

  /**
   * Baixa o inteiro teor. Em quase todos os acórdãos o texto JÁ VEM no próprio
   * resultado da busca (`inteiro_teor_texto`); só caímos para o PDF do portal
   * quando o campo está vazio.
   * @returns {{texto:string, fonte:'indice'|'pdf'|null, url:string|null}}
   */
  async inteiroTeor(doc) {
    if (doc && doc.inteiro_teor_texto) {
      return { texto: doc.inteiro_teor_texto, fonte: 'indice', url: doc.inteiro_teor_url || null };
    }
    if (doc && doc.inteiro_teor_url) {
      const r = await this._get(doc.inteiro_teor_url, { binario: true });
      return { texto: null, fonte: 'pdf', url: r.url || doc.inteiro_teor_url, pdf: r.body };
    }
    return { texto: null, fonte: null, url: null };
  }
}

STFNavigator.BASES = BASES;
STFNavigator.ORGAOS = ORGAOS;
STFNavigator.CFG = CFG;
STFNavigator.preprocessarQuery = preprocessarQuery;
STFNavigator.BASE_URL = BASE_URL;

module.exports = STFNavigator;
