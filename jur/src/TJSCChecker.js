// src/TJSCChecker.js
const TJSCNavigator = require('./TJSCNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJSC: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que um processo REALMENTE existe na base de jurisprudência
 *    oficial (é o campo "N. do processo" da tela, `#txtProcesso`);
 *  - auditar um lote de resultados, reconsultando cada processo da amostra e
 *    conferindo se o mesmo documento volta.
 *
 * A consulta é feita com TODAS as origens marcadas de propósito: um julgado
 * pode estar na Justiça Comum, nas Turmas Recursais, nas Turmas de
 * Uniformização ou no Conselho da Magistratura, e a verificação não deve
 * depender de acertar isso antes. O campo `origem` de cada decisão devolvida é
 * justamente o que responde "isso é Justiça Comum ou Juizado?".
 *
 * Workflow de verificação: skills/verificador/tribunais/tjsc.md
 * CLI: node src/TJSCChecker.js <numero-processo>
 */
class TJSCChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJSCNavigator({
      headless: options.headless ?? true,
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
    this.ownsNavigator = !options.navigator;
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /**
   * @see cnj.validar
   * DV inválido é AVISO, nunca veto: acervos migrados exibem números cujo
   * dígito não fecha e que existem na base. A prova é consultarProcesso().
   */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando o número é CNJ do TJSC (Justiça Estadual = 8, tribunal = 24). */
  ehProcessoTJSC(numero) {
    return cnj.pertenceA(numero, 8, 24);
  }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) {
    return String(numero ?? '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, tjsc,
   *                    encontrado, total, decisoes:[...]}
   */
  async consultarProcesso(numero) {
    const digits = String(numero ?? '').replace(/\D/g, '');
    const base = {
      numero: String(numero ?? ''),
      numeroConsultado: digits,
      formatoCNJ: false,
      numeroValido: false,
      tjsc: false,
      encontrado: false,
      total: 0,
      decisoes: [],
    };
    if (!digits) return base;

    const formatoCNJ = this.ehFormatoCNJ(digits);
    const formatado = formatoCNJ ? this.normalizarNumeroCNJ(digits) : digits;

    try {
      await this.navigator.abrir();
      // todas as origens: não presumir onde o julgado está
      const { estado } = await this.navigator.pesquisar({
        query: '',
        processo: formatado,
        origens: Object.values(TJSCNavigator.ORIGENS),
      });
      const crus = await this.navigator.extrair();
      const total = await this.navigator.total();

      // NUNCA transformar "a página não carregou" em "o julgado não existe".
      // Isso já produziu um falso negativo numa rodada em que o site ficou
      // lento: o processo existia, com o mesmo id, e a auditoria o reprovou.
      // Para um verificador, errar aqui é pior do que falhar alto.
      if (!crus.length && estado === 'indefinido') {
        throw new Error(
          `TJSC: a página de resultados não carregou a tempo para ${formatado} — ` +
          'NÃO é possível afirmar que o julgado não existe. Repita a consulta.',
        );
      }

      return {
        ...base,
        numero: formatado,
        formatoCNJ,
        // só faz sentido cobrar DV de número em formato CNJ
        numeroValido: formatoCNJ ? this.validarNumeroCNJ(digits) : null,
        tjsc: formatoCNJ ? this.ehProcessoTJSC(digits) : null,
        encontrado: crus.length > 0,
        total: total ?? crus.length,
        decisoes: crus.map((d) => ({
          id: d.id,
          tipoDocumento: d.tipoDocumento,   // diz se é acórdão do TJ ou de Turma Recursal
          numeroProcesso: (d.numeroProcesso || '').split('/')[0],
          origemProcesso: (d.numeroProcesso || '').split('/')[1] || '',
          orgaoJulgador: d.orgaoJulgador,
          classe: d.classe,
          relator: d.relator,
          dataJulgamento: d.dataJulgamento,
          dataPublicacao: d.dataPublicacao,
          processoUrl: d.processoUrl,
          inteiroTeorLink: d.inteiroTeorLink,
          ementa: (d.ementa || d.citacao || '').substring(0, 2000),
        })),
      };
    } finally {
      if (this.ownsNavigator) await this.navigator.fechar();
    }
  }

  /**
   * Auditoria de resultados: amostra N itens, reconsulta cada um por número e
   * confirma que o mesmo documento volta da base.
   *
   * Reaproveita UMA sessão de browser para a amostra inteira — subir um browser
   * por processo levaria minutos e reabriria o desafio F5 toda vez.
   *
   * @returns {Object} {verificados, confirmados, divergentes, detalhes:[...]}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    const externo = !this.ownsNavigator;
    try {
      if (!externo) await this.navigator.abrir();
      // dentro do laço o navigator já está aberto: usamos um checker "filho"
      // que não fecha a sessão a cada consulta
      const filho = new TJSCChecker({ navigator: this.navigator });

      for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
        const r = results[i];
        const numero = r.numeroProcesso ?? r.processo;
        const id = r.id;
        const item = { indice: i, numeroProcesso: numero, id, confirmado: false, motivo: '' };
        try {
          if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
            item.avisoDV = 'dígito verificador CNJ não confere';
          } else if (!this.ehFormatoCNJ(numero)) {
            item.avisoDV = 'número fora do formato CNJ (20 dígitos)';
          }
          const res = await filho.consultarProcesso(numero);
          if (!res.encontrado) {
            item.motivo = 'processo não encontrado na base';
          } else if (id && !res.decisoes.some((d) => String(d.id) === String(id))) {
            item.motivo = `processo existe mas o documento ${id} não retornou (ids: ${res.decisoes.map((d) => d.id).join(', ')})`;
          } else {
            item.confirmado = true;
            item.tipoDocumento = res.decisoes[0].tipoDocumento;
            item.orgaoJulgador = res.decisoes[0].orgaoJulgador;
          }
        } catch (err) {
          item.motivo = `erro na consulta: ${err.message}`;
        }
        log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
        detalhes.push(item);
      }
    } finally {
      if (!externo) await this.navigator.fechar();
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

module.exports = TJSCChecker;

// CLI: node src/TJSCChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJSCChecker.js <numero-processo (CNJ)>');
    process.exit(2);
  }
  new TJSCChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
