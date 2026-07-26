// src/FalcaoChecker.js
const FalcaoNavigator = require('./FalcaoNavigator');
const cnj = require('./cnj');

/**
 * Checker da base FALCÃO — consulta por número de processo + auditoria
 * anti-alucinação, para os 26 acervos (TST + 24 TRTs + CSJT).
 *
 * Como o Falcão prova que um julgado existe:
 *   o campo de busca livre aceita o número CNJ COM máscara e o backend casa
 *   com o campo `numeroProcesso` do documento. Consultamos as 4 coleções do
 *   acervo do tribunal e filtramos por igualdade EXATA do número.
 *
 * RESSALVAS (verificadas):
 *  1. A busca por número é textual, não é um "consultar processo". Ela devolve
 *     também vizinhos ("0000065-19.2024.5.09.0053" traz junto
 *     "0000416-67.2024.5.09.4199"). Por isso o filtro exato abaixo NÃO é
 *     preciosismo: sem ele, o checker confirmaria processo que não existe.
 *  2. O número SEM máscara (20 dígitos corridos) devolve 0 resultados, embora a
 *     ajuda oficial do site afirme que funciona. Sempre normalize para a máscara.
 *  3. Um número pode aparecer em mais de uma coleção (sentença + acórdão + RR).
 *     Isso é informação útil: mostra a trajetória do processo entre os graus.
 */
class FalcaoChecker {
  /**
   * @param {Object} options
   * @param {string} options.tribunal   - 'TRT9' etc. Restringe a busca ao acervo.
   * @param {number} options.codigoCNJ  - o TR do número CNJ (TRT9 => 9)
   */
  constructor(options = {}) {
    this.tribunal = options.tribunal ?? null;
    this.codigoCNJ = options.codigoCNJ ?? null;
    this.colecoes = options.colecoes ?? FalcaoNavigator.COLECOES_TRIBUNAL;
    this.navigator = options.navigator ?? new FalcaoNavigator({
      tribunal: this.tribunal,
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /** @see cnj.validar — DV inválido é AVISO, nunca veto. */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /**
   * True quando o número é da Justiça do Trabalho (J=5) e, se o checker estiver
   * ligado a um tribunal, do TR daquele tribunal (TRT9 => 09).
   */
  ehProcessoDoTribunal(numero) {
    if (this.codigoCNJ == null) {
      const d = cnj.decompor(numero);
      return !!d && Number(d.justica) === 5;
    }
    return cnj.pertenceA(numero, 5, this.codigoCNJ);
  }

  /**
   * Consulta um processo na base oficial, coleção por coleção.
   * @returns {Object} {numero, numeroValido, justicaDoTrabalho, doTribunal,
   *                    encontrado, graus: [...], documentos: [...]}
   */
  async consultarProcesso(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return {
        numero: String(numero), numeroValido: false, justicaDoTrabalho: false,
        doTribunal: false, encontrado: false, graus: [], documentos: [],
      };
    }
    const decomposto = cnj.decompor(fmt);
    const documentos = [];

    for (const colecao of this.colecoes) {
      let data;
      try {
        data = await this.navigator.pesquisar({ texto: fmt, colecao, page: 0, size: 10 });
      } catch (e) {
        documentos.push({ colecao, erro: e.message });
        continue;
      }
      for (const d of data.documentos || []) {
        // filtro EXATO — a busca textual devolve vizinhos
        if (d.numeroProcesso !== fmt) continue;
        const meta = FalcaoNavigator.COLECOES[colecao];
        documentos.push({
          colecao,
          colecaoRotulo: meta.rotulo,
          grau: meta.grau,
          id: String(d.idDocumentoAcordao ?? d.idSentenca ?? d.idDocumento ?? d.idRecursoRevista ?? ''),
          tribunal: d.tribunal || '',
          tipoDocumento: d.tipoDocumento || meta.rotulo,
          numeroProcesso: d.numeroProcesso,
          classe: d.classeProcessualPorExtenso || d.classeProcesso || '',
          orgaoJulgador: d.orgaoJulgadorPorExtenso || d.turma || d.orgaoJulgador || '',
          relator: d.relator || d.nomeRelator || d.nomeRedator || '',
          dataJulgamento: d.dataJulgamento || '',
          dataJuntada: d.dataJuntada || '',
          ementa: String(this.navigator.ementa(d, colecao) || '').substring(0, 2000),
        });
      }
    }

    const achados = documentos.filter((d) => !d.erro);
    return {
      numero: fmt,
      numeroValido: this.validarNumeroCNJ(fmt),
      justicaDoTrabalho: !!decomposto && Number(decomposto.justica) === 5,
      doTribunal: this.ehProcessoDoTribunal(fmt),
      tribunalConsultado: this.tribunal,
      encontrado: achados.length > 0,
      graus: [...new Set(achados.map((d) => d.grau))].sort(),
      documentos,
      fonte: `${FalcaoNavigator.APP_URL} (FALCÃO — base oficial da Justiça do Trabalho)`,
    };
  }

  /**
   * Auditoria de uma lista de resultados: reconsulta N deles por número e
   * confirma que voltam da base com o mesmo id.
   * @returns {Object} {verificados, confirmados, divergentes, detalhes}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.numeroProcesso || r.processo;
      const item = { indice: i, numeroProcesso: numero, id: r.id, colecao: r.colecao, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        }
        const res = await this.consultarProcesso(numero);
        const mesmos = res.documentos.filter((d) => !d.erro && (!r.colecao || d.colecao === r.colecao));
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base';
        } else if (r.id && mesmos.length && !mesmos.some((d) => String(d.id) === String(r.id))) {
          item.motivo = `processo existe mas o id ${r.id} não retornou (ids: ${mesmos.map((d) => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
          item.graus = res.graus;
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

module.exports = FalcaoChecker;
