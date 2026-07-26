// src/TRT9Crawler.js
const { classes } = require('./FalcaoTribunais');

/**
 * Crawler de jurisprudência do TRT da 9ª Região (Paraná).
 * Acervo: FALCÃO (https://jurisprudencia.jt.jus.br) — ver src/FalcaoCrawler.js.
 *
 * A separação de instância é feita pela COLEÇÃO (filters.colecoes):
 *   sentencas            -> 1º grau (Varas do Trabalho)
 *   acordaos             -> 2º grau colegiado (Turmas / Seção Especializada)
 *   decisoesmonocraticas -> 2º grau monocrático (gabinetes)
 *   recursorevista       -> juízo de admissibilidade do RR
 *
 * Atalho nomeado sobre `FalcaoTribunais.classes('TRT9')`, que serve os 26 acervos.
 */
module.exports = classes('TRT9').Crawler;
