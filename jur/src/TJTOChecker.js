// src/TJTOChecker.js
const TJTONavigator = require('./TJTONavigator');
const TJTOCrawler = require('./TJTOCrawler');
const cnj = require('./cnj');

/**
 * Consulta por número de processo e auditoria de amostra no TJTO.
 *
 * ✅ O portal tem um campo `numero_processo` DEDICADO (não é a busca livre), e
 *    ele aceita **as duas formas**: 20 dígitos e CNJ mascarado. Medido:
 *    `00046977120238272737` e `0004697-71.2023.8.27.2737` devolvem o mesmo
 *    documento; um número inventado devolve 0 (sintoma visível).
 *    Isso é o oposto do TJPE (só dígitos), do TJES (só máscara) e do TJRO
 *    (só dígitos, com a tela prometendo máscara).
 *
 * ⚠️ Ele dispensa `q`: `numero_processo=<nº>` sozinho já responde.
 *
 * 🔴 UM PROCESSO COSTUMA TER MAIS DE UM DOCUMENTO, em abas diferentes. O
 *    0004697-71.2023.8.27.2737 tem 1 acórdão E 1 sentença. Por isso a consulta
 *    varre as três abas e devolve todos — quem olhasse só a aba default
 *    concluiria que o processo tem um documento só.
 */
class TJTOChecker {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TJTONavigator({ timeout: options.timeout ?? 90000, log: this.log });
    this.crawler = options.crawler ?? new TJTOCrawler({ log: this.log, navigator: this.navigator });
  }

  /** Consulta um processo pelo número. Varre as três abas. */
  async consultarProcesso(numero) {
    // validar() é AVISO, nunca veto: acervo migrado tem DV que não fecha.
    let cnjValido = null;
    try { cnjValido = cnj.validar(numero); } catch { cnjValido = null; }
    const documentos = [];
    const totais = {};

    for (const [tipo, aba] of [['acordao', 'Acórdão'], ['monocratica', 'Decisão Monocrática'], ['sentenca', 'Sentença']]) {
      const html = await this.navigator.buscar({
        numero_processo: numero,
        type_minuta_selected: TJTOCrawler.TIPOS[tipo],
        rows: 50,
        start: 0,
      });
      const cards = TJTOCrawler.fatiarCards(html);
      totais[aba] = cards.length;
      for (const c of cards) documentos.push(this.crawler.mapCard(c, aba));
    }

    return {
      numero,
      normalizado: cnj.normalizar(numero),
      cnjValido,
      encontrado: documentos.length > 0,
      totalDocumentos: documentos.length,
      documentosPorTipo: totais,
      documentos,
      fonte: 'jurisprudencia.tjto.jus.br (Jurisprudência 4.0)',
      // ⚠️ Confirma JULGADO, não só processo: a base é de jurisprudência, e o
      //    documento vem com ementa/decisão e permalink público.
      observacao: documentos.length
        ? 'Julgado confirmado na base oficial do TJTO, com permalink publico.'
        : 'Nenhum documento de jurisprudencia para este numero. O processo pode existir e nao ter julgado indexado.',
    };
  }

  /**
   * Auditoria: reabre N documentos de uma busca pelo permalink e confere que
   * o número do processo bate com o do card.
   */
  async auditar(resultados, amostra = 3) {
    const alvos = resultados.slice(0, amostra);
    const conferidos = [];
    for (const r of alvos) {
      let ok = false;
      let detalhe = '';
      try {
        const html = await this.navigator.documento(r.id);
        const texto = TJTOCrawler.limparHtml(html);
        ok = !!(r.processo && texto.includes(r.processo));
        detalhe = ok ? `permalink abriu e cita ${r.processo}` : 'permalink abriu mas o numero nao confere';
      } catch (e) {
        detalhe = `permalink falhou: ${e.message}`;
      }
      conferidos.push({ id: r.id, processo: r.processo, permalink: r.permalink, ok, detalhe });
      this.log(`${ok ? 'OK  ' : 'FALHA'} ${r.processo} — ${detalhe}`);
    }
    return { amostra: conferidos.length, confirmados: conferidos.filter((c) => c.ok).length, conferidos };
  }
}

module.exports = TJTOChecker;
