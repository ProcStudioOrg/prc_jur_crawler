/**
 * TCESCChecker — consulta por numero e auditoria do TCE-SC.
 *
 * 🔴 NAO usa src/cnj.js nem DataJud, e as duas ausencias sao ESTRUTURAIS:
 *   - o TCE-SC nao e Judiciario, entao o processo nao tem numero CNJ: ele e
 *     "<SIGLA> <AA>/<sequencial>" (ex. "REP 26/00137305");
 *   - o DataJud e a base do CNJ para o Judiciario e nao tem alias para contas,
 *     logo NAO existe o plano B de TJMA/TJRN. Se o portal cair, nao ha para
 *     onde apelar — e nao e preciso, porque a consulta por numero responde.
 *
 * 🔴 O FORMATO QUE A TELA EXIBE NAO E O QUE A API ACEITA. O card imprime
 * "REP 26/00137305" e a query `pesquisarProcessoPorNumero` quer "2600137305" —
 * dez digitos, SEM a sigla e SEM a barra. Mandar o formato do card devolve
 * vazio, nao erro. normalizar() faz a traducao.
 */

const TCESCNavigator = require('./TCESCNavigator');

/**
 * "REP 26/00137305" | "26/00137305" | "2600137305" → "2600137305".
 * Tira sigla, barras, pontos e espacos; sobra so digito.
 */
function normalizar(numero) {
  if (!numero) return null;
  const digitos = String(numero).replace(/\D/g, '');
  return digitos || null;
}

class TCESCChecker {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.navigator = new TCESCNavigator({ timeout: options.timeout || 120000, log: this.log });
  }

  /**
   * Confirma que um processo existe e devolve os documentos dele.
   * ⚠️ Um processo rende VARIOS documentos — quem identifica o julgado e o
   * identificadorDocumento, nao o numero do processo.
   */
  async consultarProcesso(numero) {
    const norm = normalizar(numero);
    if (!norm) {
      return { encontrado: false, numero, erro: 'numero vazio ou sem digitos' };
    }
    // Duas chamadas, porque uma so nao basta:
    //  (1) metadados do processo — confirma que o processo EXISTE;
    //  (2) busca filtrada por numeroProcesso — traz os JULGADOS.
    // Um processo pode existir e nao ter julgado indexado na jurisprudencia.
    // ⚠️ pesquisarProcessoPorNumero devolve um ARRAY (vazio quando nao existe),
    // apesar de o nome estar no singular. Tratar como objeto faz [] virar
    // "encontrado" — numero inventado passaria como valido.
    const meta = (await this.navigator.processoPorNumero(norm) || [])[0] || null;
    const busca = await this.navigator.pesquisar({ numeroProcesso: norm, tamanhoPagina: 50 });
    const resultados = (busca && busca.resultados) || [];

    // ⚠️ `numeroProcesso` com valor NAO-NUMERICO e IGNORADO e a busca devolve o
    // ACERVO INTEIRO com HTTP 200 (medido: 'abc' -> 27.783). normalizar() so
    // deixa passar digito, o que fecha esse buraco.
    if (!meta && !resultados.length) {
      return {
        encontrado: false,
        numero,
        numeroConsultado: norm,
        total: 0,
        nota: 'Nem o processo nem julgados foram achados. Confira o formato: a API quer so os digitos (2600137305), nao "REP 26/00137305".',
      };
    }
    return {
      encontrado: true,
      numero,
      numeroConsultado: norm,
      processo: meta
        ? {
          numeroFormatado: meta.numeroFormatado,
          sigla: meta.sigla,
          assunto: meta.assunto,
          dataEntrada: meta.dataEntrada,
          sigiloso: meta.sigiloso,
        }
        : null,
      // ⚠️ processo existente com 0 julgados NAO e o mesmo que processo inexistente.
      total: busca.totalResultados,
      documentos: resultados.map((x) => ({
        processo: x.processoNumeroFormatado,
        relator: x.relator,
        tipoProcesso: x.tipoProcesso,
        unidadeGestora: x.unidadeGestora,
        dataDecisao: x.dataDecisao,
        dataSessao: x.dataSessao,
        dataPublicacao: x.dataPublicacao,
        citacaoOficial: x.textoCopiarEmenta,
        inteiroTeorLink: (x.documentos && x.documentos[0] && x.documentos[0].linkPublico) || null,
      })),
    };
  }

  /**
   * Auditoria: reabre o PDF publico de N resultados em requisicao LIMPA
   * (sem cookie, sem Referer) e confirma que ele existe e e um PDF.
   * ✅ E isto que torna a citacao verificavel por terceiro — o linkPublico do
   * storage e permalink de verdade, confirmado em requisicao limpa.
   */
  async auditar(resultados, amostra = 3) {
    const alvo = resultados.slice(0, amostra);
    let confirmados = 0;
    const detalhes = [];
    for (const r of alvo) {
      if (!r.inteiroTeorLink) {
        detalhes.push({ processo: r.processo, ok: false, motivo: 'sem linkPublico' });
        continue;
      }
      const res = await this.navigator.baixarPdf(r.inteiroTeorLink);
      const ok = !!(res.ok && res.buffer && res.buffer.length > 1000 && res.ehPdf);
      if (ok) confirmados++;
      detalhes.push({
        processo: r.processo,
        ok,
        status: res.status,
        bytes: res.buffer ? res.buffer.length : 0,
        ehPdf: !!res.ehPdf,
      });
    }
    return { amostra: alvo.length, confirmados, detalhes };
  }
}

module.exports = TCESCChecker;
module.exports.normalizar = normalizar;
