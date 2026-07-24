// src/TJGOChecker.js
const TJGONavigator = require('./TJGONavigator');
const cnj = require('./cnj');

/**
 * Checker for TJGO: consulta direta por número de processo no Novo Módulo
 * de Pesquisa de Jurisprudência e auditoria de resultados de busca.
 *
 * Use cases:
 *  - Validar/normalizar números CNJ (Resolução CNJ 65/2008);
 *  - Confirmar que um processo realmente possui atos publicados na base
 *    (campo "Número do Processo" do formulário);
 *  - Auditar um lote de resultados reamostrando cada processo por número
 *    e confirmando que o mesmo id de arquivo retorna (anti-alucinação).
 *
 * Verification workflow doc: skills/TJGO-VERIFICACAO.md
 * CLI: node src/TJGOChecker.js <numero-processo>
 */
class TJGOChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJGONavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
  }

  // Validação/normalização CNJ é genérica (todos os tribunais): src/cnj.js.

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /**
   * @see cnj.validar
   * Trate DV inválido como aviso, nunca como veto — a prova definitiva é
   * consultarProcesso() retornar atos publicados.
   */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True when the number belongs to TJGO's segment (J=8, TR=09). */
  ehProcessoTJGO(numero) {
    return cnj.pertenceA(numero, 8, 9);
  }

  /**
   * Consulta todos os atos publicados de um processo pelo número CNJ.
   * @returns {Object} {numero, numeroValido, tjgo, encontrado, atos: [...]}
   */
  async consultarProcesso(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return { numero: String(numero), numeroValido: false, tjgo: false, encontrado: false, atos: [] };
    }
    const numeroValido = this.validarNumeroCNJ(fmt);
    const { total, resultados } = await this.navigator.buscar({ ProcessoNumero: fmt });
    return {
      numero: fmt,
      numeroValido,
      tjgo: this.ehProcessoTJGO(fmt),
      encontrado: (total ?? 0) > 0 && resultados.length > 0,
      totalAtos: total ?? resultados.length,
      atos: resultados.map(r => ({
        idArquivo: r.idArquivo,
        tipoAto: r.tipoAto,
        numeroProcesso: r.numeroProcesso,
        classe: r.classe,
        orgaoJulgador: r.serventia,
        magistrado: r.magistrado,
        cargoMagistrado: r.cargoMagistrado,
        dataJulgamento: r.dataJulgamento,
        dataPublicacao: r.dataPublicacao,
        trecho: (r.texto || '').substring(0, 2000),
      })),
    };
  }

  /**
   * Audita resultados de busca: reamostra N itens, reconsulta cada processo
   * por número e confirma que o mesmo idArquivo existe na base.
   * Funciona com resultados mapeados (id) ou crus (idArquivo).
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
      const idArquivo = r.id || r.idArquivo;
      const item = { indice: i, numeroProcesso: numero, idArquivo, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere (verificar numeração legada/convertida)';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo sem atos publicados na base';
        } else if (idArquivo && !res.atos.some(a => String(a.idArquivo) === String(idArquivo))) {
          item.motivo = `processo existe mas idArquivo ${idArquivo} não retornou ` +
            `(ids: ${res.atos.map(a => a.idArquivo).join(', ')})`;
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

module.exports = TJGOChecker;

// CLI: node src/TJGOChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJGOChecker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  const checker = new TJGOChecker();
  checker.consultarProcesso(numero)
    .then(res => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch(err => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
