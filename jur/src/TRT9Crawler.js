// src/TRT9Crawler.js
const FalcaoCrawler = require('./FalcaoCrawler');
const TRT9Navigator = require('./TRT9Navigator');

/**
 * Crawler de jurisprudência do TRT da 9ª Região (Paraná).
 * Acervo: FALCÃO (https://jurisprudencia.jt.jus.br) — ver src/FalcaoCrawler.js.
 *
 * A separação de instância é feita pela COLEÇÃO (filters.colecoes):
 *   sentencas            -> 1º grau (Varas do Trabalho)
 *   acordaos             -> 2º grau colegiado (Turmas / Seção Especializada)
 *   decisoesmonocraticas -> 2º grau monocrático (gabinetes)
 *   recursorevista       -> juízo de admissibilidade do RR
 */
class TRT9Crawler extends FalcaoCrawler {
  constructor(options = {}) {
    super({
      ...options,
      tribunal: 'TRT9',
      navigator: options.navigator ?? new TRT9Navigator({
        timeout: options.timeout ?? 60000,
        log: options.log ?? console.log,
      }),
    });
  }
}

module.exports = TRT9Crawler;
