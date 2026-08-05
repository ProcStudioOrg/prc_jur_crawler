// src/TJAMChecker.js
const TJAMNavigator = require('./TJAMNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJAM: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar o número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que o processo REALMENTE tem julgado na base do cjsg — o campo
 *    `dados.nuProcOrigem` é consulta direta, independente do termo de busca
 *    (medido: `0708349-62.2020.8.04.0001` devolve A=1, com e sem máscara);
 *  - auditar um lote, reconsultando cada processo da amostra e conferindo se o
 *    mesmo `cdAcordao` volta da base.
 *
 * ⚠️ **No TJAM este Checker é a ÚNICA forma de verificar um julgado**, porque
 * o tribunal **não tem permalink**: o `getArquivo.do` está atrás de reCAPTCHA,
 * o popup de ementa é modal sem URL, e o `resultadoCompleta.do` colado em aba
 * limpa devolve o formulário vazio. Não existe link de acórdão do TJAM para
 * colar numa resposta — a verificação é sempre por reconsulta.
 *
 * ⚠️ **Um processo costuma ter mais de um documento.** Quem identifica o
 * documento é o `cdAcordao`, não o nº do processo.
 *
 * ⚠️ Ressalva de escopo — e no TJAM ela é grave: "não encontrado" aqui
 * significa "não está no cjsg", que é **2º grau + Colégios Recursais do sistema
 * SAJ**, e cuja **base parou no começo de 2025** (medido: 2026 = 0 julgados;
 * documento mais recente publicado em 06/10/2025). Um processo julgado em 2025
 * ou 2026 **não estará aqui mesmo existindo**. Não inclui 1º grau (o `cjpg` não
 * existe neste tribunal) nem o acervo do Projudi. Leia CLAUDE-TJAM.md antes de
 * carimbar um processo como inexistente.
 *
 * A consulta envia as DUAS origens (2º grau + Colégios Recursais) e os TRÊS
 * tipos de decisão, de propósito: verificar existência não pode depender de
 * acertar o filtro antes.
 *
 * CLI: node src/TJAMChecker.js <numero-processo>
 */
class TJAMChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJAMNavigator({
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

  /** True quando é número CNJ da Justiça Estadual (8) do TJAM (tribunal 04). */
  ehProcessoTJAM(numero) {
    return cnj.pertenceA(numero, 8, 4);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo no cjsg pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjam,
   *                    encontrado, total, decisoes:[...]}
   */
  async consultarProcesso(numero, opcoes = {}) {
    const digitos = String(numero ?? '').replace(/\D/g, '');
    const vazio = {
      numero: String(numero ?? ''), numeroConsultado: '', formatoCNJ: false,
      numeroValido: false, tjam: false, encontrado: false, total: 0, decisoes: [],
    };
    if (!digitos) return vazio;

    const formatoCNJ = this.ehFormatoCNJ(digitos);
    const mascarado = formatoCNJ ? this.normalizarNumeroCNJ(digitos) : digitos;

    const r = await this.navigator.buscar({
      query: '',
      processo: mascarado,
      escopo: 'ementa',
      origens: [TJAMNavigator.ORIGENS.comum, TJAMNavigator.ORIGENS.turmas],
      tipos: [TJAMNavigator.TIPOS.acordao, TJAMNavigator.TIPOS.homologacao, TJAMNavigator.TIPOS.monocratica],
    });

    // a busca devolve a página 1 da primeira aba; quando há mais de um tipo,
    // os demais só chegam paginando cada aba
    const decisoes = [...r.resultados];
    const vistos = new Set(decisoes.map((d) => d.id));
    for (const [tipo, n] of Object.entries(r.totais)) {
      if (!n) continue;
      try {
        const p = await this.navigator.paginar(1, tipo);
        for (const d of p.resultados) {
          if (!vistos.has(d.id)) { vistos.add(d.id); decisoes.push(d); }
        }
      } catch { /* aba indisponível não invalida o que já veio */ }
    }

    // `comInteiroTeor` existe nos outros Checkers do repo; aqui ele não pode ser
    // atendido (reCAPTCHA) e dizemos isso em vez de falhar em silêncio
    if (opcoes.comInteiroTeor) {
      for (const d of decisoes) {
        d.inteiroTeorPdf = false;
        d.inteiroTeorIndisponivel = 'reCAPTCHA no getArquivo.do do TJAM';
      }
    }

    return {
      numero: mascarado,
      numeroConsultado: digitos,
      formatoCNJ,
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digitos) : null,
      tjam: formatoCNJ ? this.ehProcessoTJAM(digitos) : null,
      encontrado: decisoes.length > 0,
      total: decisoes.length,
      totalRelatadoPeloSite: r.total,
      totaisPorTipo: r.totais,
      decisoes,
    };
  }

  /**
   * Auditoria de resultados: amostra N itens, reconsulta cada um por número e
   * confirma que o mesmo `cdAcordao` volta da base.
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
      const item = { indice: i, numeroProcesso: numero, cdAcordao: r.cdAcordao, confirmado: false, motivo: '' };
      try {
        if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado no cjsg';
        } else if (r.cdAcordao && !res.decisoes.some((d) => String(d.cdAcordao) === String(r.cdAcordao))) {
          item.motivo = `processo existe, mas o documento ${r.cdAcordao} não retornou ` +
            `(cdAcordao: ${res.decisoes.map((d) => d.cdAcordao).join(', ')})`;
        } else {
          item.confirmado = true;
          const casado = res.decisoes.find((d) => String(d.cdAcordao) === String(r.cdAcordao));
          item.orgaoJulgador = (casado ?? res.decisoes[0]).orgaoJulgador;
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

module.exports = TJAMChecker;

// CLI: node src/TJAMChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJAMChecker.js <numero-processo CNJ>');
    process.exit(2);
  }
  new TJAMChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
