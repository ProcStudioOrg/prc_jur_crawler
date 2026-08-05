// src/TJALChecker.js
const TJALNavigator = require('./TJALNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJAL: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar o número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que o processo REALMENTE tem julgado na base do cjsg — o campo
 *    `dados.nuProcOrigem` é consulta direta, independente do termo de busca
 *    (medido: `0701284-29.2025.8.02.0055` devolve A=1, com e sem máscara);
 *  - auditar um lote, reconsultando cada processo da amostra e conferindo se o
 *    mesmo `cdAcordao` volta da base.
 *
 * ⚠️ **No TJAL este Checker é a ÚNICA forma de verificar um julgado**, porque o
 * tribunal **não tem permalink**: o `getArquivo.do` está atrás de reCAPTCHA, o
 * popup de ementa é modal sem URL, e o `resultadoCompleta.do` colado em aba
 * limpa devolve HTTP 200 com **zero cards**. Não existe link de acórdão do TJAL
 * para colar numa resposta — a verificação é sempre por reconsulta.
 *
 * ⚠️ **Um processo costuma ter mais de um documento.** Quem identifica o
 * documento é o `cdAcordao`, não o nº do processo.
 *
 * ⚠️ Ressalva de escopo: "não encontrado" aqui significa "não está no cjsg", que
 * é **2º grau + Colégios Recursais do sistema SAJ**. Não inclui 1º grau (o
 * `cjpg` não existe neste tribunal) nem o acervo do Projudi, e a base começa por
 * volta de 2013. Leia CLAUDE-TJAL.md antes de carimbar um processo como
 * inexistente.
 *
 * ✅ Ao contrário do TJAM, a base do TJAL está **corrente** (jul/2026 com 981
 * publicações), então um processo julgado neste ano tem chance real de estar
 * aqui — um "não encontrado" recente é informação, não artefato de base parada.
 *
 * A consulta envia as DUAS origens (2º grau + Colégios Recursais) e os TRÊS
 * tipos de decisão, de propósito: verificar existência não pode depender de
 * acertar o filtro antes. (E o tipo `D` responde mesmo sem checkbox na tela —
 * ver `TJALNavigator.TIPOS`.)
 *
 * CLI: node src/TJALChecker.js <numero-processo>
 */
class TJALChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJALNavigator({
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

  /** True quando é número CNJ da Justiça Estadual (8) do TJAL (tribunal 02). */
  ehProcessoTJAL(numero) {
    return cnj.pertenceA(numero, 8, 2);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo no cjsg pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjal,
   *                    encontrado, total, decisoes:[...]}
   */
  async consultarProcesso(numero, opcoes = {}) {
    const digitos = String(numero ?? '').replace(/\D/g, '');
    const vazio = {
      numero: String(numero ?? ''), numeroConsultado: '', formatoCNJ: false,
      numeroValido: false, tjal: false, encontrado: false, total: 0, decisoes: [],
    };
    if (!digitos) return vazio;

    const formatoCNJ = this.ehFormatoCNJ(digitos);
    const mascarado = formatoCNJ ? this.normalizarNumeroCNJ(digitos) : digitos;

    const r = await this.navigator.buscar({
      query: '',
      processo: mascarado,
      escopo: 'ementa',
      origens: [TJALNavigator.ORIGENS.comum, TJALNavigator.ORIGENS.turmas],
      tipos: [TJALNavigator.TIPOS.acordao, TJALNavigator.TIPOS.homologacao, TJALNavigator.TIPOS.monocratica],
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
        d.inteiroTeorIndisponivel = 'reCAPTCHA no getArquivo.do do TJAL';
      }
    }

    return {
      numero: mascarado,
      numeroConsultado: digitos,
      formatoCNJ,
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digitos) : null,
      tjal: formatoCNJ ? this.ehProcessoTJAL(digitos) : null,
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

module.exports = TJALChecker;

// CLI: node src/TJALChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJALChecker.js <numero-processo CNJ>');
    process.exit(2);
  }
  new TJALChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
