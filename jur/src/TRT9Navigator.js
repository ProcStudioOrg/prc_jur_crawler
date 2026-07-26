// src/TRT9Navigator.js
const { classes } = require('./FalcaoTribunais');

/**
 * Navigator do TRT da 9ª Região (Paraná).
 *
 * O TRT9 não tem base própria de jurisprudência: o portal
 * https://www.trt9.jus.br/bancojurisprudencia só hospeda Precedentes
 * Qualificados e ele mesmo manda o usuário para o FALCÃO
 * ("Para pesquisa avançada dos precedentes julgados e decisões do Regional,
 * acesse o Sistema Falcão"). O acervo decisório do TRT9 vive no Falcão,
 * que é a base nacional da Justiça do Trabalho — e que é desenvolvida
 * pelo próprio TRT9.
 *
 * Toda a lógica está em `FalcaoNavigator`; a tabela dos 26 acervos, em
 * `FalcaoTribunais`. Este arquivo é só um atalho nomeado por compatibilidade —
 * os outros 25 tribunais saem de `classes('TRT2').Navigator`, sem arquivo próprio.
 */
module.exports = classes('TRT9').Navigator;
