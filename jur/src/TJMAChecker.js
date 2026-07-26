// src/TJMAChecker.js
const https = require('node:https');
const cnj = require('./cnj');

/**
 * Checker for TJMA: confirms that a process number really exists.
 *
 * WHY THIS IS DIFFERENT FROM THE OTHER CHECKERS
 * ---------------------------------------------
 * Every other Checker in this repo queries its own tribunal's jurisprudence
 * base. The TJMA's base (JurisConsult) is behind captcha — including the
 * "Número(s) do Processo" search — so that door is closed.
 *
 * The open door is the **API Pública do DataJud (CNJ)**, which is official,
 * documented, free, and covers TJMA in both G1 and G2. Confirmed live on
 * 25/07/2026: index `api_publica_tjma` answers with tribunal, grau, órgão
 * julgador, classe, sistema and movimentos.
 *
 * LIMIT — read before relying on this:
 *   DataJud carries **metadata only**. No ementa, no inteiro teor, no relator.
 *   So it answers "does this process exist in the TJMA?" — which is exactly
 *   the anti-hallucination invariant this repo needs — but it does NOT prove
 *   that a given *julgado* (with that ementa, that thesis) exists. A citation
 *   from TJMA can be confirmed as a *process*, never as a *decision*, until
 *   the JurisConsult block is lifted. Say so when you cite.
 *
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 * The public key is published by CNJ and may rotate — override with the
 * DATAJUD_API_KEY environment variable when it does.
 *
 * CLI: node src/TJMAChecker.js <numero-processo-CNJ>
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjma/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/** TJMA na numeração CNJ: Justiça Estadual (J=8), tribunal 10. */
const TJMA_JUSTICA = 8;
const TJMA_TRIBUNAL = 10;

class TJMAChecker {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.log = options.log ?? (() => {});
  }

  /** POST JSON no DataJud. @private */
  _post(body, attempt = 0) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`DataJud HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`DataJud JSON inválido: ${e.message}`)); }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms (DataJud)`)));
      req.on('error', reject);
      req.write(payload);
      req.end();
    }).catch((err) => {
      if (attempt < this.retries) {
        const delay = 3000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} after ${delay}ms: ${err.message}`);
        return new Promise((r) => setTimeout(r, delay)).then(() => this._post(body, attempt + 1));
      }
      throw err;
    });
  }

  // Validação/normalização CNJ é genérica (src/cnj.js); os wrappers abaixo
  // existem por conveniência de API do checker.

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /** @see cnj.validar */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número pertence ao TJMA (J=8, TR=10). */
  ehProcessoTJMA(numero) { return cnj.pertenceA(numero, TJMA_JUSTICA, TJMA_TRIBUNAL); }

  /**
   * Consulta um processo pelo número CNJ na base do DataJud (índice do TJMA).
   *
   * @param {string} numero - com ou sem máscara
   * @returns {Object} {numero, numeroValido, tjma, encontrado, fonte, processos:[...]}
   */
  async consultarProcesso(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return {
        numero: String(numero), numeroValido: false, tjma: false,
        encontrado: false, fonte: 'datajud', processos: [],
      };
    }
    const digitos = fmt.replace(/\D/g, '');
    const res = await this._post({
      size: 10,
      query: { match: { numeroProcesso: digitos } },
    });
    const hits = res.hits?.hits ?? [];
    return {
      numero: fmt,
      numeroValido: this.validarNumeroCNJ(fmt),
      tjma: this.ehProcessoTJMA(fmt),
      encontrado: hits.length > 0,
      fonte: 'datajud',
      // lembrete honesto: DataJud não tem ementa nem inteiro teor
      ressalva: 'DataJud confirma a EXISTÊNCIA do processo (metadados). '
        + 'Não confirma ementa, tese nem inteiro teor — a base de jurisprudência '
        + 'do TJMA (JurisConsult) está bloqueada por captcha.',
      processos: hits.map((h) => {
        const s = h._source ?? {};
        return {
          id: h._id,
          numeroProcesso: s.numeroProcesso ?? '',
          tribunal: s.tribunal ?? '',
          grau: s.grau ?? '',
          classe: s.classe?.nome ?? '',
          orgaoJulgador: s.orgaoJulgador?.nome ?? '',
          sistema: s.sistema?.nome ?? '',
          dataAjuizamento: s.dataAjuizamento ?? '',
          ultimaAtualizacao: s.dataHoraUltimaAtualizacao ?? '',
          movimentos: (s.movimentos ?? []).length,
        };
      }),
    };
  }

  /**
   * Audita uma lista de resultados: amostra N itens, reconsulta cada processo
   * e confirma que ele existe na base oficial (anti-alucinação).
   *
   * @param {Array<Object>} results - resultados mapeados (campo `processo` ou `numeroProcesso`)
   * @param {Object} options - {amostra: number = 5, log}
   * @returns {Object} {verificados, confirmados, divergentes, fonte, detalhes}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.processo || r.numeroProcesso || r.numeroprocesso;
      const item = { indice: i, numeroProcesso: numero, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        }
        if (!this.ehProcessoTJMA(numero)) {
          item.avisoTribunal = 'número não pertence ao TJMA (J=8, TR=10)';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) item.motivo = 'processo não encontrado no DataJud (índice api_publica_tjma)';
        else { item.confirmado = true; item.grau = res.processos[0]?.grau ?? ''; }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      fonte: 'datajud',
      detalhes,
    };
  }
}

TJMAChecker.DATAJUD_URL = DATAJUD_URL;
TJMAChecker.TJMA_JUSTICA = TJMA_JUSTICA;
TJMAChecker.TJMA_TRIBUNAL = TJMA_TRIBUNAL;

module.exports = TJMAChecker;

// CLI: node src/TJMAChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJMAChecker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  new TJMAChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
