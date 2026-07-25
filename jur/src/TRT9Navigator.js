// src/TRT9Navigator.js
const FalcaoNavigator = require('./FalcaoNavigator');

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
 * Toda a lógica está em `FalcaoNavigator`. Trocar `TRT9` por `TRT2`, `TRT4`,
 * `TST`... entrega o crawler daquele tribunal sem mais nenhuma linha.
 */
class TRT9Navigator extends FalcaoNavigator {
  constructor(options = {}) {
    super({ ...options, tribunal: 'TRT9' });
  }
}

TRT9Navigator.TRIBUNAL = 'TRT9';
TRT9Navigator.CODIGO_CNJ = 9;   // NNNNNNN-DD.AAAA.5.09.OOOO
TRT9Navigator.UF = 'PR';

module.exports = TRT9Navigator;
