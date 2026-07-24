// src/TJPANavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename, stripHtml } = require('./inteiroTeorFetcher');

/**
 * Navigator for the TJPA jurisprudence system (https://jurisprudencia.tjpa.jus.br).
 *
 * The SPA is backed by an open JSON API at /bff/api/decisoes. Every search
 * result already carries the ementa AND the inteiro teor (textopuro /
 * textooriginal), so no browser is needed — this navigator talks straight
 * to the API and also saves documents to disk (.txt / .html).
 *
 * Note: the RTF/PDF buttons on the site are generated client-side (jsPDF)
 * from these same fields; the .html saved here is that same source content.
 *
 * Endpoints (discovered from the Angular bundle, all unauthenticated):
 *   POST /bff/api/decisoes/buscar                     — pesquisa livre + filtros
 *   POST /bff/api/decisoes/buscar-por-numero-processo — {numeroprocesso}
 *   POST /bff/api/decisoes/buscar-por-numero-documento— {id} (id = "9999"+nº acórdão)
 *   GET  /bff/api/decisoes/filtros                    — relatores/órgãos/classes/assuntos
 * Permalink of a decision: https://jurisprudencia.tjpa.jus.br/documento/{id}
 */

const BASE_URL = 'https://jurisprudencia.tjpa.jus.br';
const API_URL = `${BASE_URL}/bff/api/decisoes`;

const ORIGENS = {
  tjpa: 'Tribunal de Justiça do Estado do Pará',
  turmas: 'Turmas Recursais dos Juizados Especiais',
};

const TIPOS = {
  acordao: 'Acórdão',
  monocratica: 'Decisão Monocrática',
};

class TJPANavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * Low-level JSON request with retries.
   * @private
   */
  _request(method, url, body = null, attempt = 0) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/`,
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${url}: ${text.slice(0, 200)}`));
          }
          try {
            const json = JSON.parse(text);
            // API envelope: {message, data}; data === null signals a server-side failure
            if (json && Object.prototype.hasOwnProperty.call(json, 'data') && json.data === null) {
              return reject(new Error(`API error: ${json.message || 'data null'}`));
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
          }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms: ${url}`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    }).catch(err => {
      if (attempt < this.retries) {
        // backoff paciente: a API do TJPA passa por janelas de instabilidade
        // (504/lentidão) de vários segundos — retry imediato cai na mesma janela
        const delay = 3000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} after ${delay}ms: ${err.message}`);
        return new Promise(r => setTimeout(r, delay))
          .then(() => this._request(method, url, body, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * Free search. Payload fields (all optional except query):
   * query, queryType ('free'|'anywords'), queryScope ('ementa'|'inteiroTeor'),
   * origem [..], tipo [..], classe, assunto, relatores [..],
   * orgaoJulgadorColegiado, dataJulgamentoInicio/Fim, dataPublicacaoInicio/Fim
   * (YYYY-MM-DD), page, size, sortBy ('relevancia' only — the backend rejects
   * other values; date ordering is done client-side), sortOrder.
   * @returns {Object} {content: [...], totalElements, totalPages, currentPage, ...}
   */
  async buscar(payload) {
    const body = {
      queryType: 'free',
      queryScope: 'ementa',
      origem: [ORIGENS.tjpa],
      tipo: [TIPOS.acordao, TIPOS.monocratica],
      page: 0,
      size: 20,
      sortBy: 'relevancia',
      sortOrder: 'desc',
      ...payload,
    };
    const res = await this._request('POST', `${API_URL}/buscar`, body);
    return res.data;
  }

  /**
   * Direct lookup by processo number (formato CNJ).
   * @returns {Array} decisions found for that processo
   */
  async buscarPorProcesso(numeroprocesso) {
    const res = await this._request('POST', `${API_URL}/buscar-por-numero-processo`, { numeroprocesso });
    return (res.data && res.data.content) || [];
  }

  /**
   * Direct lookup by document (acórdão/decisão) number.
   * The internal id is "9999" + document number, so both are tried.
   * @returns {Array} decisions found
   */
  async buscarPorDocumento(numeroDocumento) {
    const n = String(numeroDocumento).replace(/\D/g, '');
    const ids = n.startsWith('9999') ? [Number(n)] : [Number(n), Number('9999' + n)];
    for (const id of ids) {
      try {
        const res = await this._request('POST', `${API_URL}/buscar-por-numero-documento`, { id });
        const content = (res.data && res.data.content) || [];
        if (content.length) return content;
      } catch { /* try next id form */ }
    }
    return [];
  }

  /**
   * Available filter values (relatores, órgãos julgadores, classes, assuntos,
   * origens, tipos), each with document counts.
   */
  async obterFiltros() {
    const res = await this._request('GET', `${API_URL}/filtros`);
    return res.data;
  }

  /** Public permalink of a decision. */
  documentoUrl(id) {
    return `${BASE_URL}/documento/${id}`;
  }

  /** Plain-text ementa of a raw API decision. */
  ementa(decisao) {
    return decisao.ementatextopuro || stripHtml(decisao.textoementa || '');
  }

  /** Plain-text inteiro teor of a raw API decision. */
  inteiroTeor(decisao) {
    return decisao.textopuro || stripHtml(decisao.textooriginal || '');
  }

  /**
   * Save one decision to disk.
   * @param {Object} decisao - raw API decision (needs textopuro/textooriginal)
   * @param {string} outputDir
   * @param {Object} options - {formats: ['txt','html']}
   * @returns {Array<string>} filenames written
   */
  salvarDecisao(decisao, outputDir, options = {}) {
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const base = sanitizeFilename(decisao.numeroprocesso || decisao.numeroProcesso || String(decisao.id));
    const written = [];
    if (formats.includes('txt')) {
      const file = `${base}.txt`;
      fs.writeFileSync(path.join(outputDir, file), this.inteiroTeor(decisao), 'utf-8');
      written.push(file);
    }
    if (formats.includes('html')) {
      const file = `${base}.html`;
      fs.writeFileSync(path.join(outputDir, file), decisao.textooriginal || '', 'utf-8');
      written.push(file);
    }
    return written;
  }

  /**
   * Batch-save decisions to disk with an index.json, mirroring
   * inteiroTeorFetcher.batchDownload's contract.
   * Decisions missing the full text (rare) are re-fetched by processo number.
   * @returns {Array<Object>} decisions enriched with `arquivo` or `downloadError`
   */
  async baixarLote(decisoes, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const downloaded = [];
    for (let i = 0; i < decisoes.length; i++) {
      let d = decisoes[i];
      const label = d.numeroprocesso || d.numeroProcesso || d.id;
      try {
        if (!d.textopuro && !d.textooriginal) {
          const refetched = await this.buscarPorProcesso(d.numeroprocesso || d.numeroProcesso);
          const match = refetched.find(x => x.id === d.id) || refetched[0];
          if (match) d = { ...d, ...match };
        }
        const files = this.salvarDecisao(d, outputDir, { formats });
        log(`  [${i + 1}/${decisoes.length}] ${label} → ${files.join(', ')}`);
        downloaded.push({ ...decisoes[i], arquivo: files[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${decisoes.length}] FAILED ${label}: ${err.message}`);
        downloaded.push({ ...decisoes[i], arquivo: null, downloadError: err.message });
      }
    }

    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
    log(`Index saved to: ${indexPath}`);
    return downloaded;
  }
}

TJPANavigator.ORIGENS = ORIGENS;
TJPANavigator.TIPOS = TIPOS;
TJPANavigator.BASE_URL = BASE_URL;
TJPANavigator.API_URL = API_URL;

module.exports = TJPANavigator;
