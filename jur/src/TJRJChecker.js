// src/TJRJChecker.js
const TJRJNavigator = require('./TJRJNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJRJ: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar o número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que o processo REALMENTE tem julgado na base de jurisprudência
 *    do e-Proc — o campo #txtProcesso da tela é uma consulta direta,
 *    independente do termo de busca;
 *  - auditar um lote de resultados, reconsultando cada processo da amostra e
 *    conferindo se o mesmo documento (id) volta da base.
 *
 * ATENÇÃO à ressalva de escopo: "não encontrado" aqui significa "não está na
 * base do e-Proc" (2º grau da Justiça Comum, ~2023+). Julgados de Turma
 * Recursal ou anteriores à migração vivem no eJURIS legado e este Checker NÃO
 * os enxerga — ver CLAUDE-TJRJ.md antes de carimbar um processo como inexistente.
 *
 * A consulta envia os DOIS tipos de documento (acórdão + monocrática), de
 * propósito: verificar existência não pode depender de acertar o tipo antes.
 *
 * CLI: node src/TJRJChecker.js <numero-processo>
 */
class TJRJChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJRJNavigator({
      timeout: options.timeout ?? 90000,
      log: options.log ?? (() => {}),
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /** @see cnj.validar */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando é número CNJ da Justiça Estadual (8) do TJRJ (tribunal 19). */
  ehProcessoTJRJ(numero) {
    return cnj.pertenceA(numero, 8, 19);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo na base de jurisprudência do e-Proc pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.comInteiroTeor] baixa também o documento de cada julgado
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjrj,
   *                    encontrado, total, decisoes:[...]}
   */
  async consultarProcesso(numero, opcoes = {}) {
    const digitos = String(numero ?? '').replace(/\D/g, '');
    const vazio = {
      numero: String(numero ?? ''), numeroConsultado: '', formatoCNJ: false,
      numeroValido: false, tjrj: false, encontrado: false, total: 0, decisoes: [],
    };
    if (!digitos) return vazio;

    const formatoCNJ = this.ehFormatoCNJ(digitos);
    const mascarado = formatoCNJ ? this.normalizarNumeroCNJ(digitos) : digitos;

    const r = await this.navigator.buscar({
      query: '',
      processo: mascarado,
      escopo: TJRJNavigator.ESCOPOS.ementa,
      tiposDocumento: [TJRJNavigator.TIPOS_DOCUMENTO.acordao, TJRJNavigator.TIPOS_DOCUMENTO.monocratica],
    });

    const decisoes = r.resultados;
    if (opcoes.comInteiroTeor) {
      for (const d of decisoes) {
        try {
          const doc = await this.navigator.inteiroTeor(d.inteiroTeorLink || d.id);
          d.inteiroTeor = doc.texto;
        } catch { /* documento indisponível não invalida a existência */ }
      }
    }

    return {
      numero: mascarado,
      numeroConsultado: digitos,
      formatoCNJ,
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digitos) : null,
      tjrj: formatoCNJ ? this.ehProcessoTJRJ(digitos) : null,
      encontrado: decisoes.length > 0,
      total: decisoes.length,
      totalRelatadoPeloSite: r.total,
      decisoes,
    };
  }

  /**
   * Auditoria de resultados: amostra N itens, reconsulta cada um por número e
   * confirma que o mesmo id volta da base.
   *
   * @returns {Object} {verificados, confirmados, divergentes, detalhes:[...]}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.numeroProcesso;
      const item = { indice: i, numeroProcesso: numero, id: r.id, confirmado: false, motivo: '' };
      try {
        if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base do e-Proc';
        } else if (r.id && !res.decisoes.some((d) => String(d.id) === String(r.id))) {
          item.motivo = `processo existe, mas o documento ${r.id} não retornou (ids: ${res.decisoes.map((d) => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
          item.orgaoJulgador = res.decisoes.find((d) => String(d.id) === String(r.id))?.orgaoJulgador ?? res.decisoes[0].orgaoJulgador;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

module.exports = TJRJChecker;

// CLI: node src/TJRJChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJRJChecker.js <numero-processo CNJ>');
    process.exit(2);
  }
  new TJRJChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
