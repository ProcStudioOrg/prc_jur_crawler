// src/CARFNavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename } = require('./inteiroTeorFetcher');

/**
 * Navigator do CARF (Conselho Administrativo de Recursos Fiscais) — a primeira
 * instância ADMINISTRATIVA do repo depois do TCU. Contencioso tributário
 * federal, 2ª instância do processo administrativo fiscal (PAF).
 *
 * A BASE É UM SOLR PÚBLICO — E ISSO É OFICIAL
 * -------------------------------------------
 * A "Nova Pesquisa de Acórdãos" do portal do CARF é um 302 direto para a UI
 * Velocity do próprio Solr (/solr/acordaos2/browse). O crawler fala com o MESMO
 * handler da tela oficial, só que com wt=json:
 *
 *   GET https://acordaos.economia.gov.br/solr/acordaos2/browse
 *       ?q=<termos>&wt=json&rows=N&start=M [&fq=...]... [&sort=...] [&fl=...]
 *
 * Sem auth, sem cookie, sem sessão, sem captcha — busca E download.
 * 580.565 docs em 27/07/2026, sessões de 07/07/2026 já indexadas (base viva).
 *
 * RESSALVAS QUE CUSTAM CARO (todas medidas em 27/07/2026):
 *   1. NÃO usar o handler /select para busca textual: sem df configurado,
 *      q=termo devolve HTTP 400. Só o /browse tem o edismax da tela.
 *   2. NÃO usar o nome de shard que a action do form vaza
 *      (acordaos2_shardN_replica_nM — muda a cada requisição de nó).
 *      Sempre o alias /solr/acordaos2/.
 *   3. `OR` É ACEITO E IGNORADO (mm=100% do edismax): "vale OR transporte" =
 *      "vale AND transporte" = 28.655. Não existe disjunção. O default entre
 *      termos é E. NOT/- funcionam; "frase" e "frase"~N funcionam; * funciona.
 *      Os operadores em português do guia oficial (e/ou/não/$) são da
 *      INTERFACE ANTIGA (JSF do sincon) e aqui não valem.
 *   4. conteudo_txt (inteiro teor) vem com ~600 chars de METADADOS TIKA na
 *      frente, até o marcador "Conteúdo =>", e o texto é cheio de NBSP (\xa0)
 *      e soft hyphen (\xad). Ver inteiroTeor().
 *   5. O PDF baixado NÃO começa em %PDF: vem embrulhado num dump COPY BINARY
 *      do PostgreSQL (assinatura PGCOPY, 25 bytes na frente + 4 no fim).
 *      Leitores toleram; parser estrito não. Ver _desembrulharPdf().
 *   6. Sort por data pega LIXO na base (doc com dt_sessao_tdt ano 19944 vem
 *      primeiro no desc). Ao ordenar por data, cercar com fq de range sadio.
 *   7. Números SÓ COM MÁSCARA: processo "13890.000160/2006-17" e decisão
 *      "2802-000.639". Sem pontuação devolve 0 EM SILÊNCIO.
 *   8. 1.551 docs (0,3%) têm arquivo_indexado_s:N — sem conteudo_txt (o PDF
 *      não foi extraído); ementa_s e decisao_txt existem mesmo assim.
 */

const BASE_URL = 'https://acordaos.economia.gov.br';
const API_URL = `${BASE_URL}/solr/acordaos2/browse`;
const PDF_BASE = `${BASE_URL}/acordaos2/pdfs/processados`;

/** rows medido até 10.000 sem erro; 100 é um teto operacional saudável. */
const ROWS_MAX = 100;

/** Range sadio para sort por data — cerca o lixo (ano 19944, ano 0001). */
const RANGE_DATA_SADIO = '[1970-01-01T00:00:00Z TO NOW+1YEAR]';

/** Campos de facet expostos na tela oficial (o 8º, "Decisão", é inútil — tokens). */
const FACETS = {
  turma: 'turma_s',
  camara: 'camara_s',
  secao: 'secao_s',
  materia: 'materia_s',
  relator: 'nome_relator_s',
  anoSessao: 'ano_sessao_s',
  anoPublicacao: 'ano_publicacao_s',
};

class CARFNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 3;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /** GET com backoff. @private */
  _get(url, attempt = 0, binario = false) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent, Accept: binario ? '*/*' : 'application/json' },
      }, (res) => {
        // o link http:// do card dá 302 para https://; segue uma vez
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(this._get(res.headers.location, attempt, binario));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} em ${url}: ${buf.toString('utf-8').slice(0, 200)}`));
          }
          resolve(binario ? buf : buf.toString('utf-8'));
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout após ${this.timeout}ms: ${url}`)));
      req.on('error', reject);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 3000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} em ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay)).then(() => this._get(url, attempt + 1, binario));
      }
      throw err;
    });
  }

  /** DD/MM/YYYY (ou YYYY-MM-DD) → fq de range Solr no campo dado. */
  static rangeData(campo, inicio, fim) {
    const iso = (d, fimDoDia) => {
      if (!d) return fimDoDia ? 'NOW+1YEAR' : '*';
      const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const ymd = br ? `${br[3]}-${br[2]}-${br[1]}` : String(d).match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
      if (!ymd) throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
      return `${ymd}T${fimDoDia ? '23:59:59Z' : '00:00:00Z'}`;
    };
    if (!inicio && !fim) return null;
    return `${campo}:[${iso(inicio, false)} TO ${iso(fim, true)}]`;
  }

  /** ISO da API → DD/MM/YYYY. */
  static fromApiDate(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  /**
   * Máscara do processo administrativo fiscal: 17 dígitos →
   * NNNNN.NNNNNN/AAAA-DD. Sem máscara a base devolve 0 em silêncio (medido).
   * Números legados com outro comprimento passam intocados.
   */
  static formatarProcesso(numero) {
    const d = String(numero || '').replace(/\D/g, '');
    if (d.length === 17) {
      return `${d.slice(0, 5)}.${d.slice(5, 11)}/${d.slice(11, 15)}-${d.slice(15)}`;
    }
    return String(numero || '').trim();
  }

  /** Máscara do nº de decisão: 10 dígitos → NNNN-NNN.NNN (ex.: 2802-000.639). */
  static formatarDecisao(numero) {
    const bruto = String(numero || '').trim();
    if (/^\d{4}-\d{3}\.\d{3}$/.test(bruto)) return bruto;
    const d = bruto.replace(/\D/g, '');
    if (d.length === 10) return `${d.slice(0, 4)}-${d.slice(4, 7)}.${d.slice(7)}`;
    return bruto;
  }

  /**
   * A busca. `start` é offset 0-based; `params`:
   *   q (string), fq (Array<string>), sort (string|null), fl (string|null)
   * @returns {Object} {numFound, numFoundExact, docs}
   */
  async buscar(params, start = 0, rows = 20) {
    const qs = new URLSearchParams();
    qs.set('q', params.q ?? '*:*');
    qs.set('wt', 'json');
    qs.set('rows', String(Math.min(rows, ROWS_MAX)));
    qs.set('start', String(start));
    for (const fq of params.fq ?? []) qs.append('fq', fq);
    if (params.sort) qs.set('sort', params.sort);
    if (params.fl) qs.set('fl', params.fl);
    const text = await this._get(`${API_URL}?${qs}`);
    let json;
    try { json = JSON.parse(text); } catch (e) {
      throw new Error(`JSON inválido do Solr: ${e.message} — corpo: ${text.slice(0, 200)}`);
    }
    if (json.error) throw new Error(`Solr ${json.error.code}: ${json.error.msg}`);
    return json.response || { numFound: 0, docs: [] };
  }

  /** Valores de um facet com contagem. `campo` é chave de FACETS ou nome _s. */
  async facetar(campo, limite = -1) {
    const field = FACETS[campo] ?? campo;
    const qs = new URLSearchParams({
      q: '*:*', wt: 'json', rows: '0',
      facet: 'true', 'facet.field': field,
      'facet.limit': String(limite), 'facet.mincount': '1',
    });
    const json = JSON.parse(await this._get(`${API_URL}?${qs}`));
    const flat = json.facet_counts?.facet_fields?.[field] ?? [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ valor: flat[i], docs: flat[i + 1] });
    return out;
  }

  /** Ementa completa (o card oficial imprime o campo inteiro, sem highlight). */
  ementa(doc) {
    const v = doc.ementa_s;
    return String(Array.isArray(v) ? v[0] : v || '').trim();
  }

  /** Dispositivo (ACORDAM.../RESOLVEM...). */
  dispositivo(doc) {
    const v = doc.decisao_txt;
    return String(Array.isArray(v) ? v[0] : v || '').trim();
  }

  /**
   * A base NÃO tem campo de tipo: acórdão e resolução têm o mesmo padrão de
   * número e o mesmo nome de arquivo. A heurística é o prefixo do dispositivo
   * (30.619 docs começam "RESOLVEM").
   */
  tipoDocumento(doc) {
    return /^\s*resolvem\b/i.test(this.dispositivo(doc)) ? 'RESOLUÇÃO' : 'ACÓRDÃO';
  }

  /**
   * Inteiro teor em texto, que JÁ VEIO na busca (conteudo_txt) — zero request
   * por documento. Ressalva 4: corta o prefixo de metadados do Tika (tudo até
   * "Conteúdo =>") e normaliza NBSP/soft-hyphen.
   */
  inteiroTeor(doc) {
    const v = doc.conteudo_txt;
    let texto = String(Array.isArray(v) ? v[0] : v || '');
    const marco = texto.indexOf('Conteúdo =>');
    if (marco >= 0) texto = texto.slice(marco + 'Conteúdo =>'.length);
    return texto.replace(/­/g, '').replace(/ /g, ' ').trim();
  }

  /** Melhor texto citável: ementa quando existe, senão o inteiro teor. */
  textoCitavel(doc) {
    return this.ementa(doc) || this.inteiroTeor(doc);
  }

  /** URL estável (permalink) do PDF original do documento. */
  pdfUrl(doc) {
    return doc.nome_arquivo_pdf_s ? `${PDF_BASE}/${doc.nome_arquivo_pdf_s}` : null;
  }

  /**
   * Ressalva 5: o corpo servido é um COPY BINARY do PostgreSQL com o PDF
   * dentro. Fatia de %PDF até o último %%EOF; se não achar, devolve como veio.
   * @private
   */
  static _desembrulharPdf(buf) {
    const ini = buf.indexOf('%PDF');
    if (ini < 0) return buf;
    const fim = buf.lastIndexOf('%%EOF');
    return buf.slice(ini, fim >= 0 ? fim + 5 : buf.length);
  }

  /** Baixa o PDF original, já desembrulhado do PGCOPY. @returns {Buffer} */
  async baixarPdf(doc) {
    const url = this.pdfUrl(doc);
    if (!url) throw new Error(`documento ${doc.id} sem nome_arquivo_pdf_s`);
    return CARFNavigator._desembrulharPdf(await this._get(url, 0, true));
  }

  /** Grava txt (e opcionalmente o PDF) de um documento. @returns {Array<string>} */
  async salvarDocumento(doc, outputDir, options = {}) {
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });
    const base = sanitizeFilename(doc.numero_decisao_s || doc.id);
    const written = [];
    if (formats.includes('txt')) {
      const texto = this.inteiroTeor(doc);
      if (!texto) throw new Error('documento sem conteudo_txt (arquivo_indexado_s:N)');
      const file = `${base}.txt`;
      fs.writeFileSync(path.join(outputDir, file), texto, 'utf-8');
      written.push(file);
    }
    if (formats.includes('pdf')) {
      const file = `${base}.pdf`;
      fs.writeFileSync(path.join(outputDir, file), await this.baixarPdf(doc));
      written.push(file);
    }
    return written;
  }

  /** Grava um lote com index.json, no contrato de batchDownload. */
  async baixarLote(docs, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const downloaded = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const label = d.numero_decisao_s || d.id;
      try {
        const files = await this.salvarDocumento(d, outputDir, { formats });
        log(`  [${i + 1}/${docs.length}] ${label} → ${files.join(', ')}`);
        downloaded.push({ id: d.id, numeroDecisao: d.numero_decisao_s, arquivo: files[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${docs.length}] FALHOU ${label}: ${err.message}`);
        downloaded.push({ id: d.id, numeroDecisao: d.numero_decisao_s, arquivo: null, downloadError: err.message });
      }
    }

    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(downloaded, null, 2), 'utf-8');
    log(`Index salvo em: ${indexPath}`);
    return downloaded;
  }
}

CARFNavigator.BASE_URL = BASE_URL;
CARFNavigator.API_URL = API_URL;
CARFNavigator.PDF_BASE = PDF_BASE;
CARFNavigator.ROWS_MAX = ROWS_MAX;
CARFNavigator.RANGE_DATA_SADIO = RANGE_DATA_SADIO;
CARFNavigator.FACETS = FACETS;

module.exports = CARFNavigator;
