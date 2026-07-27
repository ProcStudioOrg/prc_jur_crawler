// src/TJCENavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename } = require('./inteiroTeorFetcher');

/**
 * Navigator for the TJCE jurisprudence system — SJURIS (https://sjuris.tjce.jus.br).
 *
 * WHY SJURIS AND NOT THE e-SAJ
 * ----------------------------
 * The TJCE page "Jurisprudências" links BOTH the classic e-SAJ
 * (esaj.tjce.jus.br/cjsg/consultaCompleta.do) and the SJURIS. The e-SAJ works,
 * but it is the worse door on every axis:
 *   - it needs a browser (the search POST carries a reCAPTCHA v3 token; without
 *     it the server silently re-renders the empty form — no error message);
 *   - it only covers the SAJ acervo, missing everything tramitado in PJe.
 * The SJURIS is an Angular SPA over a plain JSON API, needs no browser, and
 * covers BOTH origins. Measured live on 27/07/2026 with the same query:
 *     origem PJE 1.691 + origem SAJ 3.178 = 4.869 sem filtro de origem.
 * So SJURIS is a superset of the e-SAJ base, and this navigator uses only it.
 *
 * THE API (discovered from the Network tab of the SPA; unauthenticated)
 *   POST /sjuris/api/v1/jurisprudencia/?page=N&size=M   — a busca
 *   GET  /sjuris/api/v1/jurisprudencia/buscaListaCampos/0..4 — os domínios dos
 *        filtros com contagem: 0 órgão julgador, 1 tipo de documento, 2 classe,
 *        3 base (2º GRAU × TURMA RECURSAL), 4 árvore de assuntos CNJ.
 *
 * O QUE JÁ VEM NA BUSCA (medido) — não existe request de inteiro teor:
 *   ementa               ementa completa e estruturada (~3.300 chars no acórdão)
 *   conteudo             o INTEIRO TEOR em texto puro (~29.000 chars)
 *   pdfAutenticadoBase64 o PDF autenticado do documento, em base64 (~120 KB)
 *   listaEmenta/listaConteudo  trechos com o termo em <em> — isso é HIGHLIGHT,
 *                        não ementa; nunca cite a partir deles.
 *
 * RESSALVAS QUE CUSTAM CARO (todas medidas, não presumidas):
 *   1. `size` > 20 devolve 504 SEMPRE. O teto é 20 por página.
 *   2. DECISÃO MONOCRÁTICA vem com `ementa` VAZIA (listaEmenta: []). Só o
 *      ACÓRDÃO e a TURMA RECURSAL têm ementa. Para monocrática o texto citável
 *      é o `conteudo`. É a mesma armadilha do TJMG.
 *   3. O período NÃO vai em `dataJulgamento` (esse campo fica []): vai em
 *      `dataJulgamentoInicial`/`dataJulgamentoFinal`, ISO com offset -03:00
 *      (…T03:00:00.000Z). Datas dentro de `dataJulgamento` são ignoradas em
 *      silêncio e a busca devolve 0.
 *   4. Os rótulos de base carregam o ORDINAL MASCULINO "º" (U+00BA): "2º GRAU".
 *      Trocar por "2° GRAU" (U+00B0) devolve 0.
 *   5. Não há permalink por documento — a SPA vive toda em /tela-consulta.
 *   6. 504 esporádico mesmo dentro dos limites; o retry com backoff resolve.
 */

const BASE_URL = 'https://sjuris.tjce.jus.br';
const API_URL = 'https://gateway.tjce.jus.br/sjuris/api/v1/jurisprudencia';

/** Teto medido: acima de 20 a API devolve 504 sem exceção. */
const SIZE_MAX = 20;

/** `baseDocumento` — é aqui que mora Justiça Comum × Juizado Especial. */
const BASES = {
  comum: '2º GRAU',
  turmas: 'TURMA RECURSAL',
};

/** `nomeDocumento` — tipo do documento. */
const TIPOS = {
  acordao: 'ACÓRDÃO',
  monocratica: 'DECISÃO MONOCRÁTICA',
  sumula: 'SÚMULA',
};

/** `origem` — o sistema de tramitação de onde o julgado veio. */
const ORIGENS = {
  pje: 'PJE',
  saj: 'SAJ',
};

/** Índices de /buscaListaCampos/<n>. */
const CAMPOS = {
  orgaoJulgador: 0,
  tipoDocumento: 1,
  classe: 2,
  base: 3,
  assunto: 4,
};

class TJCENavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 3;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * Low-level JSON request with backoff. The gateway answers 504 both for
   * genuinely-too-heavy queries (size > 20, very deep pages) and as a transient
   * hiccup, so a retry is worth it before giving up.
   * @private
   */
  _request(method, url, body = null, attempt = 0) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          Origin: BASE_URL,
          Referer: `${BASE_URL}/`,
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} em ${url}: ${text.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(text)); } catch (e) {
            reject(new Error(`JSON inválido de ${url}: ${e.message}`));
          }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout após ${this.timeout}ms: ${url}`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 3000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} em ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay))
          .then(() => this._request(method, url, body, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * DD/MM/YYYY (ou YYYY-MM-DD) → o ISO que a SPA manda: meia-noite de Brasília
   * expressa em UTC, isto é `YYYY-MM-DDT03:00:00.000Z`.
   */
  static toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : String(d).match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (!iso) throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
    return `${iso}T03:00:00.000Z`;
  }

  /** `[2026,2,11]` (ano, mês 1-based, dia) → `11/02/2026`. */
  static fromApiDate(v) {
    if (Array.isArray(v) && v.length >= 3) {
      const [a, m, d] = v;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const [a, m, d] = v.slice(0, 10).split('-');
      return `${d}/${m}/${a}`;
    }
    return '';
  }

  /**
   * A busca. `page` é 0-based; `size` é limitado a 20 (acima disso é 504).
   * @param {Object} payload - busca, ordenacao, nomeDocumento[], baseDocumento[],
   *   origem[], dataJulgamentoInicial/Final
   * @returns {Object} {content, totalElements, totalPages, number, ...}
   */
  async buscar(payload, page = 0, size = SIZE_MAX) {
    if (size > SIZE_MAX) {
      this.log(`AVISO: size ${size} acima do teto da API; usando ${SIZE_MAX}.`);
      size = SIZE_MAX;
    }
    const body = {
      dataJulgamento: [],
      busca: '',
      ordenacao: 'order1',
      nomeDocumento: [TIPOS.acordao],
      baseDocumento: [BASES.comum],
      ...payload,
    };
    const res = await this._request('POST', `${API_URL}/?page=${page}&size=${size}`, body);
    return res.pagina || { content: [], totalElements: 0, totalPages: 0 };
  }

  /**
   * Domínio de um filtro com as contagens. Ver CAMPOS.
   * @returns {Array} [{chave, quantidade, dados}]
   */
  async listaCampos(indice) {
    return this._request('GET', `${API_URL}/buscaListaCampos/${indice}`);
  }

  /**
   * Consulta por número de processo.
   *
   * ⚠️ A API não tem filtro por número: o jeito de achar um processo é buscar
   * o número CNJ **formatado e entre aspas** no campo de texto livre, porque é
   * assim que ele aparece dentro do `conteudo` do documento. Medido:
   *   "0169160-51.2018.8.06.0001"  (formatado, com aspas) → 1  ✅ exato
   *   "01691605120188060001"       (só dígitos, com aspas) → 3  ❌ errados
   *   0169160-51.2018.8.06.0001    (formatado, sem aspas)  → 294 ❌ ruído
   */
  async buscarPorProcesso(numeroFormatado, opcoes = {}) {
    const tipos = opcoes.tipos ?? Object.values(TIPOS);
    const bases = opcoes.bases ?? Object.values(BASES);
    const pagina = await this.buscar({
      busca: `"${numeroFormatado}"`,
      nomeDocumento: tipos,
      baseDocumento: bases,
    }, 0, SIZE_MAX);
    return pagina.content || [];
  }

  /** Ementa citável — vazia em DECISÃO MONOCRÁTICA (ver ressalva 2). */
  ementa(doc) {
    return (doc.ementa || '').trim();
  }

  /** O inteiro teor, que já veio na busca. Nunca precisa de request extra. */
  inteiroTeor(doc) {
    return (doc.conteudo || '').trim();
  }

  /** Melhor texto citável: ementa quando existe, inteiro teor quando não. */
  textoCitavel(doc) {
    return this.ementa(doc) || this.inteiroTeor(doc);
  }

  /**
   * Grava um documento em disco. `pdf` sai do campo base64 que já veio na busca
   * — não há download nem sessão envolvidos.
   * @returns {Array<string>} arquivos escritos
   */
  salvarDocumento(doc, outputDir, options = {}) {
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const base = sanitizeFilename(doc.id || doc.numeroProcesso || String(doc.idDocumento));
    const written = [];
    if (formats.includes('txt')) {
      const file = `${base}.txt`;
      fs.writeFileSync(path.join(outputDir, file), this.inteiroTeor(doc), 'utf-8');
      written.push(file);
    }
    if (formats.includes('pdf') && doc.pdfAutenticadoBase64) {
      const file = `${base}.pdf`;
      fs.writeFileSync(path.join(outputDir, file), Buffer.from(doc.pdfAutenticadoBase64, 'base64'));
      written.push(file);
    }
    return written;
  }

  /**
   * Grava um lote com index.json, no mesmo contrato de batchDownload.
   * Não faz request nenhum: o texto e o PDF vieram na busca.
   */
  async baixarLote(docs, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const downloaded = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const label = d.id || d.numeroProcesso;
      try {
        if (!this.inteiroTeor(d)) throw new Error('documento sem `conteudo` na resposta da busca');
        const files = this.salvarDocumento(d, outputDir, { formats });
        log(`  [${i + 1}/${docs.length}] ${label} → ${files.join(', ')}`);
        downloaded.push({ ...d, arquivo: files[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${docs.length}] FALHOU ${label}: ${err.message}`);
        downloaded.push({ ...d, arquivo: null, downloadError: err.message });
      }
    }

    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
    log(`Index salvo em: ${indexPath}`);
    return downloaded;
  }
}

TJCENavigator.BASE_URL = BASE_URL;
TJCENavigator.API_URL = API_URL;
TJCENavigator.SIZE_MAX = SIZE_MAX;
TJCENavigator.BASES = BASES;
TJCENavigator.TIPOS = TIPOS;
TJCENavigator.ORIGENS = ORIGENS;
TJCENavigator.CAMPOS = CAMPOS;

module.exports = TJCENavigator;
