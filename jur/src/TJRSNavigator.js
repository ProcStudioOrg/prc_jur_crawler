// src/TJRSNavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator do sistema de jurisprudência do TJRS
 * (https://www.tjrs.jus.br/buscas/jurisprudencia/?aba=jurisprudencia).
 *
 * A tela é um formulário jQuery/Angular que **não** navega: ela chama um único
 * endpoint AJAX que devolve a resposta bruta de um Solr. O crawler fala direto
 * com esse endpoint — sem browser.
 *
 *   POST /buscas/jurisprudencia/ajax.php
 *     action=consultas_solr_ajax
 *     metodo=buscar_resultados
 *     parametros=<querystring do form#form_busca, urlencoded como UM valor>
 *
 * Outros métodos do mesmo endpoint (populam os combos, todos sem autenticação):
 *   metodo=listarTribunais
 *   metodo=listarOrgaosJulgadores    &id_tribunal=<cod>
 *   metodo=listarRelatores           &id_tribunal=<cod>
 *   metodo=listarTiposDeProcessos    &id_tribunal=<cod>
 *   metodo=listarClassesCNJ
 *   metodo=listarAssuntosCnj         &codClasseCNJ=<cod>
 *
 * A resposta de buscar_resultados é o JSON do Solr:
 *   {responseHeader, response:{numFound, docs:[...]}, facet_counts, highlighting,
 *    url, query, pages, filtro, hlq}
 * `filtro` é a cláusula Solr montada pelo servidor — é o que prova qual filtro
 * de fato entrou na consulta (usado nos testes de integração).
 *
 * Cada doc já traz o INTEIRO TEOR em `documento_text` (HTML em base64), então
 * --fetch-inteiro-teor não faz nova requisição.
 */

const BASE_URL = 'https://www.tjrs.jus.br/buscas/jurisprudencia';
const AJAX_URL = `${BASE_URL}/ajax.php`;
const PAGE_URL = `${BASE_URL}/?aba=jurisprudencia`;
/** Acompanhamento processual público (link que o próprio site usa no nº do processo). */
const CONSULTA_URL = 'https://consulta.tjrs.jus.br/consulta-processual/processo/resumo?numeroProcesso=';
/** Inteiro teor em DOC — só existe para o acervo legado (cod_documento + ano_criacao). */
const INTEIRO_TEOR_URL = 'https://www.tjrs.jus.br/novo/wp-content/themes/tjrs/tjrs-apps/inteiro-teor/index.php';

/**
 * Combo "Tribunal" — É AQUI que mora a desambiguação Justiça Comum × Juizados.
 * Valores confirmados no DOM vivo (human-codegen/TJRS/01-jurisprudencia/02-tribunais.json).
 * O servidor traduz para `cod_tribunal`; `exceto-turmas` vira `cod_tribunal:[3 TO 4]`.
 */
const TRIBUNAIS = {
  todas: '-1',                // sem cláusula: Justiça Comum + Alçada + Turmas Recursais
  'exceto-turmas': '0',       // cod_tribunal:[3 TO 4]
  comum: '3',                 // Tribunal de Justiça do RS  (JUSTIÇA COMUM, 2º grau)
  alcada: '4',                // Tribunal de Alçada do RS   (extinto em 2005, acervo histórico)
  turmas: '6',                // Turmas Recursais           (2º grau dos JUIZADOS ESPECIAIS)
};

/** Rótulos oficiais, para log e para o mapa de saída. */
const TRIBUNAIS_LABEL = {
  '-1': 'Todos',
  '0': 'Todos (exceto Turmas Recursais)',
  '3': 'Tribunal de Justiça do RS',
  '4': 'Tribunal de Alçada do RS',
  '6': 'Turmas Recursais',
};

/** Checkboxes "Tipo de decisão" -> campo do form. */
const TIPOS_DECISAO = {
  acordao: 'filtroacordao',
  monocratica: 'filtroMonocratica',
  admissibilidade: 'filtroAdmissibilidade',
  duvida: 'filtroDuvida',
};

/** Radio "Pesquisar em" (índice do Solr). */
const ESCOPOS = {
  ementa: 'ementa_completa',
  inteiroTeor: 'documento_text',
};

/** 10 é fixo no servidor: `rows=10` é hardcoded no ajax.php, não vem do form. */
const RESULTADOS_POR_PAGINA = 10;

class TJRSNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 120000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * POST urlencoded para o ajax.php, com retry/backoff.
   * @private
   */
  _post(fields, attempt = 0) {
    const payload = new URLSearchParams(fields).toString();
    return new Promise((resolve, reject) => {
      const req = https.request(AJAX_URL, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(payload),
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://www.tjrs.jus.br',
          'Referer': PAGE_URL,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} em ${AJAX_URL}: ${text.slice(0, 200)}`));
          }
          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            return reject(new Error(`JSON inválido do ajax.php: ${e.message} — ${text.slice(0, 200)}`));
          }
          // O PHP devolve {"error": "<mensagem ou JSON do Solr>"} nos casos de falha.
          if (json && json.error) {
            let msg = json.error;
            try { msg = JSON.parse(json.error)?.error?.msg || msg; } catch { /* erro em texto puro */ }
            return reject(new Error(`Erro do servidor de busca: ${String(msg).slice(0, 300)}`));
          }
          resolve(json);
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout de ${this.timeout}ms em ${AJAX_URL}`)));
      req.on('error', reject);
      req.write(payload);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 2000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} em ${delay}ms: ${err.message}`);
        return new Promise(r => setTimeout(r, delay)).then(() => this._post(fields, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * Executa a busca. Recebe os campos do form#form_busca já resolvidos e
   * cuida dos hidden obrigatórios e da paginação.
   *
   * @param {Object} form - campos do formulário (ver TJRSCrawler._buildForm)
   * @param {number} pagina - 1-based (o servidor converte em start = (p-1)*10)
   * @returns {Object} JSON do Solr: {response:{numFound, docs}, filtro, pages, ...}
   */
  async buscar(form = {}, pagina = 1) {
    const parametros = new URLSearchParams({
      aba: 'jurisprudencia',
      realizando_pesquisa: '1',
      pagina_atual: String(pagina),
      q_palavra_chave: '',
      conteudo_busca: ESCOPOS.ementa,
      filtroTribunal: TRIBUNAIS.todas,
      filtroRelator: '-1',
      filtroOrgaoJulgador: '-1',
      filtroTipoProcesso: '-1',
      filtroClasseCnj: '',
      assuntoCnj: '',
      // hidden do form: parâmetros de facet/ordenação repassados ao Solr
      facet: 'on',
      'facet.sort': 'index',
      'facet.limit': 'index',
      wt: 'json',
      ordem: 'desc',
      start: '0',
      ...form,
    }).toString();

    const json = await this._post({
      action: 'consultas_solr_ajax',
      metodo: 'buscar_resultados',
      parametros,
    });
    if (!json.response) throw new Error('Resposta sem `response` — formato do ajax.php mudou');
    return json;
  }

  /**
   * {"0":{id,label},"1":{...},"url":"..."} -> [{id, label}]
   * @private
   */
  _lista(json) {
    return Object.entries(json || {})
      .filter(([k, v]) => /^\d+$/.test(k) && v && v.id !== undefined)
      .map(([, v]) => ({ id: String(v.id), label: String(v.label ?? '').trim() }))
      .filter(o => o.label);
  }

  /** Combo "Tribunal": Justiça Comum, Alçada, Turmas Recursais. */
  async listarTribunais() {
    return this._lista(await this._post({ action: 'consultas_solr_ajax', metodo: 'listarTribunais' }));
  }

  /** Combo "Órgão julgador" — depende do tribunal (-1 devolve vazio, como no site). */
  async listarOrgaosJulgadores(codTribunal) {
    return this._lista(await this._post({
      action: 'consultas_solr_ajax', metodo: 'listarOrgaosJulgadores', id_tribunal: String(codTribunal),
    }));
  }

  /** Combo "Relator do Processo/Redator do Acórdão". */
  async listarRelatores(codTribunal = '-1') {
    return this._lista(await this._post({
      action: 'consultas_solr_ajax', metodo: 'listarRelatores', id_tribunal: String(codTribunal),
    }));
  }

  /**
   * Combo "Classe Processual" (campo Solr `tipo_processo`).
   * ATENÇÃO: o `id` devolvido aqui NÃO serve para filtrar — ver _buildForm no
   * crawler e a ressalva em CLAUDE-TJRS.md. O filtro exige o **label**.
   */
  async listarTiposDeProcessos(codTribunal = '-1') {
    return this._lista(await this._post({
      action: 'consultas_solr_ajax', metodo: 'listarTiposDeProcessos', id_tribunal: String(codTribunal),
    }));
  }

  /** Combo "Classe CNJ" (filtra por `cod_classe_cnj`, o id funciona). */
  async listarClassesCNJ() {
    return this._lista(await this._post({ action: 'consultas_solr_ajax', metodo: 'listarClassesCNJ' }));
  }

  /** Combo "Assunto CNJ", dependente da Classe CNJ. */
  async listarAssuntosCnj(codClasseCNJ) {
    return this._lista(await this._post({
      action: 'consultas_solr_ajax', metodo: 'listarAssuntosCnj', codClasseCNJ: String(codClasseCNJ),
    }));
  }

  /** Ementa em texto puro de um doc cru do Solr. */
  ementa(doc) {
    const v = doc.ementa_completa ?? doc.ementa_text ?? doc.ementa ?? '';
    const txt = Array.isArray(v) ? v.join('\n') : String(v);
    return txt.replace(/^\s+/, '').trim();
  }

  /**
   * HTML do inteiro teor (base64 no campo documento_text). '' quando não houver.
   *
   * RESSALVA DE ENCODING: o blob decodificado é **ISO-8859-1/windows-1252**,
   * mesmo quando o próprio HTML declara `<?xml encoding="UTF-8"?>`. Ler como
   * UTF-8 produz mojibake ("Judici�rio"). Aqui tentamos UTF-8 estrito e, se
   * falhar, caímos para windows-1252 — que é o caso real de todos os documentos
   * observados. O JSON do Solr (ementa etc.) é UTF-8 normal; só o blob não é.
   */
  inteiroTeorHtml(doc) {
    const b64 = Array.isArray(doc.documento_text) ? doc.documento_text[0] : doc.documento_text;
    if (!b64) return '';
    let buf;
    try {
      buf = Buffer.from(String(b64), 'base64');
    } catch {
      return '';
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  /** Inteiro teor em texto puro. '' quando o registro não tem documento. */
  inteiroTeor(doc) {
    return stripHtml(this.inteiroTeorHtml(doc));
  }

  /** Link do acompanhamento processual (o mesmo que o site põe no nº). */
  processoUrl(numeroProcesso) {
    const n = String(numeroProcesso ?? '').replace(/\D/g, '');
    return n ? `${CONSULTA_URL}${n}` : null;
  }

  /**
   * Link do inteiro teor em DOC. Só existe no acervo legado (Themis):
   * processos do e-Proc não têm cod_documento e só exibem HTML.
   */
  inteiroTeorUrl(doc) {
    if (!doc.cod_documento || !doc.ano_criacao) return null;
    return `${INTEIRO_TEOR_URL}?numero_processo=${doc.numero_processo}&ano=${doc.ano_criacao}&codigo=${doc.cod_documento}`;
  }

  /**
   * Grava um julgado em disco (texto do próprio payload da busca — sem rede).
   * @returns {Array<string>} arquivos escritos
   */
  salvarDecisao(doc, outputDir, options = {}) {
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const base = sanitizeFilename(`${doc.numero_processo || 'sem-numero'}-${doc.cod_ementa || ''}`.replace(/-$/, ''));
    const written = [];
    if (formats.includes('txt')) {
      const texto = this.inteiroTeor(doc) || this.ementa(doc);
      fs.writeFileSync(path.join(outputDir, `${base}.txt`), texto, 'utf-8');
      written.push(`${base}.txt`);
    }
    if (formats.includes('html')) {
      fs.writeFileSync(path.join(outputDir, `${base}.html`), this.inteiroTeorHtml(doc), 'utf-8');
      written.push(`${base}.html`);
    }
    return written;
  }

  /**
   * Metadados de um doc cru, SEM os campos gigantes (base64 do documento e as
   * cinco variações da ementa) — é o que vai para o index.json.
   * @private
   */
  _metadados(doc) {
    const fora = new Set([
      'documento_text', 'documento_text_aspas',
      'ementa_completa_aspas', 'ementa_referencia', 'ementa_referencia_aspas', 'ementa_text',
      '_version_',
    ]);
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      if (!fora.has(k)) out[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
    }
    return out;
  }

  /** Grava um lote + index.json, no mesmo contrato de inteiroTeorFetcher.batchDownload. */
  async baixarLote(docs, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const downloaded = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const label = d.numero_processo || d.cod_ementa || `#${i}`;
      try {
        const files = this.salvarDecisao(d, outputDir, { formats });
        log(`  [${i + 1}/${docs.length}] ${label} -> ${files.join(', ')}`);
        downloaded.push({ ...this._metadados(d), arquivo: files[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${docs.length}] FALHOU ${label}: ${err.message}`);
        downloaded.push({ ...this._metadados(d), arquivo: null, downloadError: err.message });
      }
    }
    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
    log(`Index saved to: ${indexPath}`);
    return downloaded;
  }
}

TJRSNavigator.BASE_URL = BASE_URL;
TJRSNavigator.AJAX_URL = AJAX_URL;
TJRSNavigator.PAGE_URL = PAGE_URL;
TJRSNavigator.TRIBUNAIS = TRIBUNAIS;
TJRSNavigator.TRIBUNAIS_LABEL = TRIBUNAIS_LABEL;
TJRSNavigator.TIPOS_DECISAO = TIPOS_DECISAO;
TJRSNavigator.ESCOPOS = ESCOPOS;
TJRSNavigator.RESULTADOS_POR_PAGINA = RESULTADOS_POR_PAGINA;

module.exports = TJRSNavigator;
