/**
 * TCEBAChecker — consulta por numero e auditoria do TCE-BA.
 *
 * 🔴 NAO usa src/cnj.js nem DataJud, e as duas ausencias sao ESTRUTURAIS:
 *   - o TCE-BA nao e Judiciario, entao o processo nao tem numero CNJ: ele e
 *     "TCE/<sequencial 6 digitos>/<ano>" (ex. "TCE/000405/2025");
 *   - o DataJud e a base do CNJ para o Judiciario e nao tem alias para contas.
 *     NAO existe o plano B de TJMA/TJRN — se o portal cair, nao ha para onde ir.
 *
 * 🔴 `numeroProtocolo` CASA POR SUBSTRING, NAO POR IGUALDADE — e o sintoma e um
 * numero PLAUSIVEL, nao um erro. Medido em 17/08/2026:
 *     numeroProtocolo=000405 & anoProtocolo=2025 → 2 documentos, todos de
 *                                                   TCE/000405/2025          ✅
 *     numeroProtocolo=405    & anoProtocolo=2025 → 6 documentos, de
 *                                                   TCE/000405/2025,
 *                                                   TCE/003405/2025,
 *                                                   TCE/004050/2025          🔴
 * Ou seja: mandar o sequencial SEM os zeros a esquerda arrasta processo alheio,
 * com HTTP 200 e cards validos. Por isso este Checker (a) normaliza para 6
 * digitos com zero a esquerda e (b) CONFERE no cliente que o `numeroProtocolo`
 * devolvido e exatamente o pedido, descartando o resto e avisando quanto caiu.
 *
 * ⚠️ E ele confirma DOCUMENTO DE JURISPRUDENCIA, nao existencia de processo: a
 * base e a das pecas decisorias indexadas. Resposta negativa significa "nao ha
 * peca indexada para este processo", nao "este processo nao existe".
 */

const TCEBANavigator = require('./TCEBANavigator');

/**
 * "TCE/000405/2025" | "405/2025" | "000405" + ano → { sequencial, ano }.
 * O sequencial vai para 6 digitos porque a API casa por substring.
 */
function normalizar(numero, anoExplicito) {
  if (!numero) return { sequencial: null, ano: anoExplicito || null };
  const s = String(numero).trim();

  // TCE/000405/2025 ou 000405/2025
  let m = s.match(/(?:TCE\/)?(\d{1,6})\/(\d{4})/i);
  if (m) return { sequencial: m[1].padStart(6, '0'), ano: m[2] };

  // so digitos: 0004052025 (10) → 6 + 4
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return { sequencial: d.slice(0, 6), ano: d.slice(6) };
  if (d) return { sequencial: d.padStart(6, '0'), ano: anoExplicito || null };

  return { sequencial: null, ano: anoExplicito || null };
}

class TCEBAChecker {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.navigator = options.navigator || new TCEBANavigator({ log: this.log });
  }

  /**
   * Confirma que ha peca decisoria indexada para um processo.
   * Devolve { encontrado, processo, documentos, descartados, aviso }.
   */
  async consultarProcesso(numero, anoExplicito) {
    const { sequencial, ano } = normalizar(numero, anoExplicito);
    if (!sequencial) {
      return { encontrado: false, erro: `numero de processo irreconhecivel: ${numero}` };
    }
    if (!ano) {
      return {
        encontrado: false,
        erro:
          'informe o ANO do processo (ex. "TCE/000405/2025"): sem ano a busca por ' +
          'numero casa por substring em todos os anos',
      };
    }

    const alvo = `TCE/${sequencial}/${ano}`;
    const r = await this.navigator.buscar({
      numeroProtocolo: sequencial,
      anoProtocolo: ano,
      qtRegistros: 5000,
    });

    if (r.excedeuTeto) {
      return { encontrado: false, erro: 'a consulta por numero estourou o limiar', alvo };
    }

    // 🔴 O recorte de cliente que desfaz o casamento por substring.
    const exatos = r.documentos.filter((d) => d.numeroProtocolo === alvo);
    const descartados = r.documentos.length - exatos.length;
    if (descartados > 0) {
      this.log(
        `⚠️  ${descartados} documentos vieram de OUTROS processos (a API casa ` +
          `numeroProtocolo por substring) e foram descartados.`
      );
    }

    return {
      encontrado: exatos.length > 0,
      processo: alvo,
      total: exatos.length,
      descartadosPorSubstring: descartados,
      documentos: exatos.map((d) => ({
        id: d.idDocumentoDecisao,
        idProtocolo: d.idProtocolo,
        tipo: d.nomeTipoDecisao,
        colegiado: d.nomeColegiado,
        relator: d.nomeRelator,
        dataSessao: d.dataSessaoJulgamento,
        temEmenta: !!d.resumoDocumento,
        chars: (d.resumoExibicao || '').length,
      })),
      aviso:
        'Confirma peca decisoria INDEXADA na base de jurisprudencia do TCE-BA. ' +
        'Resposta negativa nao prova que o processo nao existe.',
    };
  }

  /**
   * Auditoria: pega N resultados e confirma que o PDF do documento existe e
   * comeca em %PDF. E a unica verificacao possivel aqui — nao ha permalink de
   * documento nem base externa para conferir.
   */
  async verificar(resultados, amostra = 3) {
    const alvo = resultados.slice(0, amostra);
    const relatorio = [];
    for (const r of alvo) {
      try {
        const pdf = await this.navigator.baixarPdf(r.idProtocolo, r.id);
        relatorio.push({
          id: r.id,
          processo: r.processo,
          pdfOk: !!(pdf.ok && pdf.ehPdf),
          bytes: pdf.ok ? pdf.buffer.length : 0,
          arquivo: pdf.ok ? pdf.nomeArquivo : null,
        });
      } catch (e) {
        relatorio.push({ id: r.id, processo: r.processo, pdfOk: false, erro: e.message });
      }
    }
    const ok = relatorio.filter((x) => x.pdfOk).length;
    this.log(`🔍 Auditoria: ${ok}/${relatorio.length} documentos com PDF publico valido`);
    return { conferidos: relatorio.length, ok, relatorio };
  }
}

module.exports = TCEBAChecker;
module.exports.normalizar = normalizar;
