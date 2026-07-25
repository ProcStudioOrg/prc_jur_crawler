// src/TJRSChecker.js
const TJRSNavigator = require('./TJRSNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJRS: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que um processo REALMENTE existe na base de jurisprudência do
 *    tribunal (é o filtro "Número do Processo" da tela, campo
 *    `filtroNumeroProcesso` -> cláusula Solr `numero_processo:<digitos>`);
 *  - auditar um lote de resultados de busca, reconsultando cada processo da
 *    amostra e conferindo se o mesmo documento (cod_ementa) volta.
 *
 * A consulta é feita SEM filtro de tribunal (`filtroTribunal=-1`), de propósito:
 * um julgado pode estar na Justiça Comum, no acervo do Tribunal de Alçada ou nas
 * Turmas Recursais, e a verificação não deve depender de acertar isso antes.
 *
 * Workflow de verificação: skills/verificador/tribunais/tjrs.md
 * CLI: node src/TJRSChecker.js <numero-processo>
 */
class TJRSChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJRSNavigator({
      timeout: options.timeout ?? 120000,
      log: options.log ?? (() => {}),
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /**
   * @see cnj.validar
   * ATENÇÃO: boa parte do acervo do TJRS é PRÉ-CNJ (numeração Themis de 8-11
   * dígitos, ex.: 70084452564, 591059829). Esses números não são CNJ e nunca
   * fecham o dígito verificador — e existem na base. DV inválido é AVISO,
   * nunca veto: a prova é consultarProcesso() devolver o julgado.
   */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando o número é CNJ do TJRS (Justiça Estadual = 8, tribunal = 21). */
  ehProcessoTJRS(numero) {
    return cnj.pertenceA(numero, 8, 21);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   * Aceita CNJ com ou sem máscara e também a numeração legada (Themis).
   *
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjrs,
   *                    encontrado, total, decisoes:[...]}
   */
  async consultarProcesso(numero) {
    const digits = String(numero ?? '').replace(/\D/g, '');
    if (!digits) {
      return {
        numero: String(numero ?? ''), numeroConsultado: '', formatoCNJ: false,
        numeroValido: false, tjrs: false, encontrado: false, total: 0, decisoes: [],
      };
    }
    const formatoCNJ = this.ehFormatoCNJ(digits);
    const data = await this.navigator.buscar({
      q_palavra_chave: '',
      filtroNumeroProcesso: digits,
      filtroTribunal: TJRSNavigator.TRIBUNAIS.todas,
    }, 1);

    const docs = data.response.docs || [];
    return {
      numero: formatoCNJ ? this.normalizarNumeroCNJ(digits) : digits,
      numeroConsultado: digits,
      formatoCNJ,
      // só faz sentido cobrar DV de número em formato CNJ
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digits) : null,
      tjrs: formatoCNJ ? this.ehProcessoTJRS(digits) : null,
      encontrado: docs.length > 0,
      total: data.response.numFound ?? docs.length,
      filtroSolr: data.filtro ? decodeURIComponent(data.filtro) : '',
      decisoes: docs.map(d => ({
        id: d.cod_ementa,
        tipoDocumento: d.tipo_documento || '',
        numeroProcesso: d.numero_processo || '',
        tribunal: d.nome_tribunal || '',
        orgaoJulgador: d.orgao_julgador || '',
        classeProcessual: d.tipo_processo || '',
        relator: d.nome_relator || '',
        secao: d.secao || '',
        dataJulgamento: (d.data_julgamento || '').slice(0, 10),
        dataPublicacao: (d.data_publicacao || '').slice(0, 10),
        processoUrl: this.navigator.processoUrl(d.numero_processo),
        inteiroTeorLink: this.navigator.inteiroTeorUrl(d),
        ementa: this.navigator.ementa(d).substring(0, 2000),
      })),
    };
  }

  /**
   * Auditoria de resultados: amostra N itens, reconsulta cada um por número e
   * confirma que o mesmo cod_ementa volta da base.
   * Funciona com resultados mapeados (numeroProcesso/id) ou crus (numero_processo/cod_ementa).
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
      const numero = r.numeroProcesso ?? r.numero_processo;
      const id = r.id ?? r.cod_ementa;
      const item = { indice: i, numeroProcesso: numero, id, confirmado: false, motivo: '' };
      try {
        if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        } else if (!this.ehFormatoCNJ(numero)) {
          item.avisoDV = 'numeração legada (pré-CNJ, acervo Themis) — DV não se aplica';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base';
        } else if (id && !res.decisoes.some(d => String(d.id) === String(id))) {
          item.motivo = `processo existe mas o documento ${id} não retornou (ids: ${res.decisoes.map(d => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
          item.tribunal = res.decisoes[0].tribunal;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter(d => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

module.exports = TJRSChecker;

// CLI: node src/TJRSChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJRSChecker.js <numero-processo (CNJ ou legado)>');
    process.exit(2);
  }
  new TJRSChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
