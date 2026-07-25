// src/TJPRChecker.js
const TJPRNavigator = require('./TJPRNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJPR: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar o número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que o processo REALMENTE tem julgado na base de jurisprudência
 *    do TJPR — é o campo "NUMERAÇÃO PROCESSUAL" da tela (`processo`), que é
 *    uma consulta direta, independente do termo de busca;
 *  - auditar um lote de resultados, reconsultando cada processo da amostra e
 *    conferindo se o mesmo documento (id) volta da base.
 *
 * A consulta é feita com `ambito=-1` (TODAS as bases) e **sem** filtro de
 * foro, de propósito: o julgado pode estar na Justiça Comum ou nas Turmas
 * Recursais, e verificar existência não pode depender de acertar isso antes.
 *
 * Workflow de verificação: skills/verificador/tribunais/tjpr.md
 * CLI: node src/TJPRChecker.js <numero-processo>
 */
class TJPRChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJPRNavigator({
      timeout: options.timeout ?? 90000,
      log: options.log ?? (() => {}),
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /**
   * @see cnj.validar
   * DV inválido é AVISO, não veto: o acervo do TJPR tem numeração antiga
   * (pré-Resolução 65/2008) que nunca fecha o dígito verificador e existe.
   * A prova é `consultarProcesso()` devolver o julgado.
   */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando é número CNJ da Justiça Estadual (8) do TJPR (tribunal 16). */
  ehProcessoTJPR(numero) {
    return cnj.pertenceA(numero, 8, 16);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   * Aceita CNJ com ou sem máscara e também numeração legada.
   *
   * @param {string} numero
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.comInteiroTeor] baixa também a página de cada julgado
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjpr,
   *                    encontrado, total, foros, decisoes:[...]}
   */
  async consultarProcesso(numero, opcoes = {}) {
    const digitos = String(numero ?? '').replace(/\D/g, '');
    const vazio = {
      numero: String(numero ?? ''), numeroConsultado: '', formatoCNJ: false,
      numeroValido: false, tjpr: false, encontrado: false, total: 0, decisoes: [],
    };
    if (!digitos) return vazio;

    const formatoCNJ = this.ehFormatoCNJ(digitos);
    const mascarado = formatoCNJ ? this.normalizarNumeroCNJ(digitos) : digitos;

    // o campo aceita o número com máscara; é como a tela envia
    const r = await this.navigator.buscar({
      query: '',
      processo: mascarado,
      ambito: TJPRNavigator.AMBITOS.todas,
      tipo: TJPRNavigator.TIPOS.todas,
      escopo: TJPRNavigator.ESCOPOS.ementa,
    });

    const decisoes = r.resultados;
    if (opcoes.comInteiroTeor) {
      for (const d of decisoes) {
        try {
          const doc = await this.navigator.documento(d.id);
          d.comarca = doc.comarca;
          d.citacao = doc.citacao;
          d.inteiroTeor = doc.inteiroTeor;
        } catch { /* documento indisponível não invalida a existência */ }
      }
    }

    return {
      numero: mascarado,
      numeroConsultado: digitos,
      formatoCNJ,
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digitos) : null,
      tjpr: formatoCNJ ? this.ehProcessoTJPR(digitos) : null,
      encontrado: decisoes.length > 0,
      total: decisoes.length,
      totalRelatadoPeloSite: r.totais.tj,
      foros: [...new Set(decisoes.map((d) => d.foro))],
      decisoes,
    };
  }

  /** Consulta pelo número do ACÓRDÃO (campo "NUMERAÇÃO DO ACÓRDÃO"). */
  async consultarAcordao(numeroAcordao) {
    const r = await this.navigator.buscar({
      query: '', acordao: String(numeroAcordao ?? '').trim(),
      ambito: TJPRNavigator.AMBITOS.todas, tipo: TJPRNavigator.TIPOS.todas,
    });
    return { acordao: String(numeroAcordao), encontrado: r.resultados.length > 0, total: r.resultados.length, decisoes: r.resultados };
  }

  /**
   * Auditoria de resultados: amostra N itens, reconsulta cada um por número e
   * confirma que o mesmo id volta da base. Confere também o foro declarado.
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
      const item = { indice: i, numeroProcesso: numero, id: r.id, foro: r.foro, confirmado: false, motivo: '' };
      try {
        if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        } else if (!this.ehFormatoCNJ(numero)) {
          item.avisoDV = 'numeração fora do padrão CNJ (acervo antigo) — DV não se aplica';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base';
        } else if (r.id && !res.decisoes.some((d) => String(d.id) === String(r.id))) {
          item.motivo = `processo existe, mas o documento ${r.id} não retornou (ids: ${res.decisoes.map((d) => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
          item.orgaoJulgador = res.decisoes.find((d) => String(d.id) === String(r.id))?.orgaoJulgador ?? res.decisoes[0].orgaoJulgador;
          if (r.foro && TJPRNavigator.foro(item.orgaoJulgador) !== r.foro) {
            item.avisoForo = `foro divergente: busca disse "${r.foro}", órgão é "${item.orgaoJulgador}"`;
          }
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

module.exports = TJPRChecker;

// CLI: node src/TJPRChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJPRChecker.js <numero-processo (CNJ ou legado)>');
    process.exit(2);
  }
  new TJPRChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
