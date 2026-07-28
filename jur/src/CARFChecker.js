// src/CARFChecker.js
const CARFNavigator = require('./CARFNavigator');

/**
 * Checker do CARF: consulta por número + auditoria anti-alucinação.
 *
 * ⚠️ O CARF NÃO USA NUMERAÇÃO CNJ (é processo ADMINISTRATIVO fiscal):
 *   - processo: NNNNN.NNNNNN/AAAA-DD (17 dígitos) — ex. 13890.000160/2006-17
 *   - decisão (acórdão/resolução): NNNN-NNN.NNN — ex. 2802-000.639
 * Por isso este checker NÃO importa src/cnj.js, e o DataJud NÃO cobre o CARF
 * (não é Judiciário). A única fonte é a própria base Solr.
 *
 * ⚠️ SÓ COM MÁSCARA (medido em 27/07/2026): a consulta sem pontuação devolve
 * 0 EM SILÊNCIO — numero_processo_s:13890000160200617 = 0, com máscara = 1.
 * As normalizações formatarProcesso/formatarDecisao são obrigatórias.
 *
 * CLI: node src/CARFChecker.js <numero-processo | nº-decisão --decisao>
 */
class CARFChecker {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new CARFNavigator({
      timeout: this.timeout,
      log: this.log,
    });
  }

  /**
   * Consulta por número de PROCESSO administrativo fiscal.
   * @returns {Object} {numeroProcesso, encontrado, fonte, julgados: [...]}
   */
  async consultarProcesso(numero) {
    const formatado = CARFNavigator.formatarProcesso(numero);
    const data = await this.navigator.buscar({
      q: `numero_processo_s:"${formatado}"`,
      fl: 'id,numero_decisao_s,numero_processo_s,turma_s,camara_s,secao_s,materia_s,nome_relator_s,dt_sessao_tdt,dt_publicacao_tdt,ementa_s,decisao_txt,nome_arquivo_pdf_s,arquivo_indexado_s',
    }, 0, CARFNavigator.ROWS_MAX);

    return {
      numeroProcesso: formatado,
      encontrado: (data.numFound ?? 0) > 0,
      fonte: 'solr-carf',
      julgados: (data.docs || []).map((d) => this._resumo(d)),
    };
  }

  /**
   * Consulta por número de DECISÃO (acórdão/resolução) — o número citável.
   * @returns {Object} {numeroDecisao, encontrado, fonte, julgados: [...]}
   */
  async consultarDecisao(numero) {
    const formatado = CARFNavigator.formatarDecisao(numero);
    const data = await this.navigator.buscar({
      q: `numero_decisao_s:"${formatado}"`,
    }, 0, 10);

    return {
      numeroDecisao: formatado,
      encontrado: (data.numFound ?? 0) > 0,
      fonte: 'solr-carf',
      julgados: (data.docs || []).map((d) => this._resumo(d)),
    };
  }

  /** @private */
  _resumo(d) {
    return {
      id: d.id,
      tipoDocumento: this.navigator.tipoDocumento(d),
      numeroDecisao: d.numero_decisao_s,
      numeroProcesso: d.numero_processo_s,
      orgaoJulgador: [d.turma_s, d.camara_s, d.secao_s].filter(Boolean).join(' / '),
      materia: d.materia_s || '',
      relator: (d.nome_relator_s || '').trim(),
      dataSessao: CARFNavigator.fromApiDate(d.dt_sessao_tdt),
      temEmenta: Boolean(this.navigator.ementa(d)),
      ementa: this.navigator.ementa(d).slice(0, 600),
      pdf: this.navigator.pdfUrl(d),
    };
  }

  /**
   * Auditoria: amostra N resultados e reconsulta cada um pelo número da
   * DECISÃO, confirmando que o MESMO documento (campo `id`) volta da base.
   * @returns {Object} {verificados, confirmados, divergentes, detalhes}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.numeroDecisao || r.numero_decisao_s;
      const item = { indice: i, numeroDecisao: numero, id: r.id, confirmado: false, motivo: '' };
      try {
        const res = await this.consultarDecisao(numero);
        if (!res.encontrado) {
          item.motivo = 'decisão não encontrada na base do CARF';
        } else if (r.id && !res.julgados.some((j) => String(j.id) === String(r.id))) {
          item.motivo = `decisão existe mas o documento ${r.id} não retornou ` +
            `(ids: ${res.julgados.map((j) => j.id).join(', ')})`;
        } else {
          item.confirmado = true;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      detalhes,
    };
  }
}

module.exports = CARFChecker;

// CLI: node src/CARFChecker.js <numero> [--decisao]
if (require.main === module) {
  const numero = process.argv[2];
  const porDecisao = process.argv.includes('--decisao');
  if (!numero) {
    console.error('Uso: node src/CARFChecker.js <numero-processo> | <nº-decisão> --decisao');
    process.exit(2);
  }
  const checker = new CARFChecker();
  (porDecisao ? checker.consultarDecisao(numero) : checker.consultarProcesso(numero))
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
