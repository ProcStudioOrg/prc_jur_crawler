// src/TJBAChecker.js
const TJBANavigator = require('./TJBANavigator');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJBA por número de processo.
 *
 * A consulta é feita pelo campo `numeroRecurso` do DecisaoFilter — ou seja,
 * contra o MESMO índice de jurisprudência que a busca, o que é exatamente o
 * que o `verificador` precisa: confirmar que o julgado existe na base oficial.
 *
 * ⚠️ O GraphQL também expõe `detalharProcesso(numeroProcesso)`, que fala com o
 * sistema de tramitação ao vivo. Medido em 06/08/2026: ele é LENTO a ponto de
 * estourar 120s e devolve "Internal Server Error" para números que a busca
 * encontra sem problema. Não é confiável para verificação — por isso o Checker
 * usa o índice, e o detalhamento é opcional (`{ detalhar: true }`) e tolerante
 * a falha.
 */
class TJBAChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJBANavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
  }

  /**
   * Consulta um processo pelo número.
   * @param {string} numero - CNJ com ou sem máscara
   * @param {Object} opcoes - { detalhar: boolean }
   * @returns {{numero, encontrado, valido, documentos: [], erroValidacao?}}
   */
  async consultarProcesso(numero, opcoes = {}) {
    const numeroLimpo = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroLimpo,
      tribunal: 'TJBA',
      valido,
      // 8 = Justiça Estadual, 05 = TJBA
      doTribunal: cnj.pertenceA(numero, 8, 5),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';

    // A base indexa o número COM máscara (0046401-59.2024.8.05.0080).
    const comMascara = this._formatarCNJ(numeroLimpo) || numero;

    const filtro = {
      numeroRecurso: comMascara,
      orgaos: [], relatores: [], classes: [],
      dataInicial: '1980-02-01',
      segundoGrau: true,
      turmasRecursais: true,
      tipoAcordaos: true,
      tipoDecisoesMonocraticas: true,
      ordenadoPor: 'dataPublicacao',
    };

    const r = await this.navigator.buscar(filtro, 0, 20);
    saida.total = r.itemCount ?? 0;
    saida.encontrado = (r.itemCount ?? 0) > 0;
    saida.documentos = (r.decisoes || []).map(d => ({
      hash: d.hash,
      numeroProcesso: d.numeroProcesso,
      tipoDecisao: d.tipoDecisao,
      orgaoJulgador: d.orgaoJulgador?.nome || '',
      instancia: d.orgaoJulgador?.instancia || '',
      classe: d.classe?.descricao || '',
      relator: d.relator?.nome || '',
      dataPublicacao: d.dataPublicacao || '',
      dataJulgamento: d.dataJulgamento || '',
      tamanhoTexto: (d.ementa || '').length,
    }));

    if (opcoes.detalhar) {
      try {
        saida.tramitacao = await this.navigator.detalharProcesso(comMascara);
      } catch (e) {
        saida.tramitacao = null;
        saida.avisoTramitacao = `detalharProcesso indisponivel: ${e.message}`;
      }
    }
    return saida;
  }

  /** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO. @private */
  _formatarCNJ(d) {
    if (!d || d.length !== 20) return null;
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
  }

  /**
   * Audita uma amostra dos resultados de uma busca reconsultando cada número.
   * @param {Array} results
   * @param {Object} options - { amostra, log }
   */
  async verificarResultados(results, options = {}) {
    const amostra = options.amostra ?? 5;
    const log = options.log ?? (() => {});
    const alvos = results.slice(0, amostra);

    const detalhes = [];
    let confirmados = 0;
    for (const r of alvos) {
      if (!r.numeroProcesso) {
        detalhes.push({ numero: null, confirmado: false, motivo: 'resultado sem numero de processo' });
        continue;
      }
      try {
        const c = await this.consultarProcesso(r.numeroProcesso);
        if (c.encontrado) confirmados++;
        detalhes.push({
          numero: r.numeroProcesso,
          confirmado: c.encontrado,
          documentosNaBase: c.total,
        });
        log(`  ${c.encontrado ? 'OK  ' : 'FALHA'} ${r.numeroProcesso} (${c.total} doc na base)`);
      } catch (e) {
        detalhes.push({ numero: r.numeroProcesso, confirmado: false, motivo: e.message });
        log(`  ERRO ${r.numeroProcesso}: ${e.message}`);
      }
    }
    return { verificados: detalhes.length, confirmados, detalhes };
  }
}

module.exports = TJBAChecker;
