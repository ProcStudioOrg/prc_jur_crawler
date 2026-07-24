// src/TJPAChecker.js
const TJPANavigator = require('./TJPANavigator');
const cnj = require('./cnj');

/**
 * Checker for TJPA: direct lookup by processo/documento number and
 * verification of search results against the court's own base.
 *
 * Use cases:
 *  - Validate/normalize CNJ process numbers (Resolução CNJ 65/2008);
 *  - Confirm that a processo really exists in the jurisprudence base
 *    ("Consultar por Processo / Acórdão / Decisão Monocrática" tab);
 *  - Audit a batch of search results by re-querying each sampled processo
 *    and confirming the same document id comes back (anti-hallucination).
 *
 * Verification workflow doc: skills/TJPA-VERIFICACAO.md
 * CLI: node src/TJPAChecker.js <numero-processo-ou-documento>
 */
class TJPAChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJPANavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
  }

  // Validação/normalização CNJ é genérica (todos os tribunais): src/cnj.js.
  // Os wrappers abaixo existem por conveniência de API do checker.

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /**
   * @see cnj.validar
   * ATENÇÃO: processos antigos do TJPA migrados do sistema Libra (ex.: 2007-2011)
   * carregam números convertidos que NÃO fecham o DV CNJ, mas existem na base.
   * Trate DV inválido como aviso, nunca como veto — a prova definitiva é
   * consultarProcesso() retornar o julgado.
   */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True when the number belongs to TJPA's segment (J=8, TR=14). */
  ehProcessoTJPA(numero) {
    return cnj.pertenceA(numero, 8, 14);
  }

  /**
   * Look up a processo in the jurisprudence base by its CNJ number.
   * @returns {Object} {numero, numeroValido, tjpa, encontrado, decisoes:[...]}
   */
  async consultarProcesso(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return { numero: String(numero), numeroValido: false, tjpa: false, encontrado: false, decisoes: [] };
    }
    const numeroValido = this.validarNumeroCNJ(fmt);
    const decisoes = await this.navigator.buscarPorProcesso(fmt);
    return {
      numero: fmt,
      numeroValido,
      tjpa: this.ehProcessoTJPA(fmt),
      encontrado: decisoes.length > 0,
      decisoes: decisoes.map(d => ({
        id: d.id,
        tipo: d.tipo,
        numeroProcesso: d.numeroprocesso,
        classe: d.classe?.nome || '',
        orgaoJulgadorColegiado: d.orgaojulgadorcolegiado?.nome || '',
        relator: (d.pessoas || []).join('; '),
        dataJulgamento: d.datajulgamento || '',
        url: this.navigator.documentoUrl(d.id),
        ementa: (d.ementatextopuro || '').substring(0, 2000),
      })),
    };
  }

  /**
   * Look up by acórdão/decisão number (as shown on the site's result card).
   */
  async consultarDocumento(numeroDocumento) {
    const decisoes = await this.navigator.buscarPorDocumento(numeroDocumento);
    return {
      numeroDocumento: String(numeroDocumento),
      encontrado: decisoes.length > 0,
      decisoes: decisoes.map(d => ({
        id: d.id,
        tipo: d.tipo,
        numeroProcesso: d.numeroprocesso,
        dataJulgamento: d.datajulgamento || '',
        url: this.navigator.documentoUrl(d.id),
      })),
    };
  }

  /**
   * Audit search results: sample N items, re-query each by processo number
   * and confirm the same document id exists in the base.
   * Works with mapped results (numeroProcesso) or raw ones (numeroprocesso).
   *
   * @param {Array<Object>} results
   * @param {Object} options - {amostra: number = 5, log}
   * @returns {Object} {verificados, confirmados, divergentes, detalhes: [...]}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.numeroProcesso || r.numeroprocesso;
      const item = { indice: i, numeroProcesso: numero, id: r.id, confirmado: false, motivo: '' };
      try {
        // DV CNJ é só aviso: números legados (Libra) não fecham o dígito
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere (provável numeração legada/convertida)';
        }
        const found = await this.navigator.buscarPorProcesso(numero);
        if (!found.length) {
          item.motivo = 'processo não encontrado na base';
        } else if (r.id && !found.some(d => String(d.id) === String(r.id))) {
          item.motivo = `processo existe mas id ${r.id} não retornou (ids: ${found.map(d => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter(d => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      detalhes,
    };
  }
}

module.exports = TJPAChecker;

// CLI: node src/TJPAChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJPAChecker.js <numero-processo-CNJ | numero-documento>');
    process.exit(2);
  }
  const checker = new TJPAChecker();
  const digits = numero.replace(/\D/g, '');
  const isCNJ = digits.length >= 14; // doc numbers are short; CNJ has 20 digits
  (isCNJ ? checker.consultarProcesso(numero) : checker.consultarDocumento(numero))
    .then(res => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch(err => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
