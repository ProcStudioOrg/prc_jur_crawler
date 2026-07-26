// src/TRT9Checker.js
const { classes } = require('./FalcaoTribunais');

/**
 * Checker do TRT9: confirma que um julgado existe na base oficial da
 * Justiça do Trabalho (FALCÃO), consultando por número de processo.
 *
 * Número CNJ do TRT9: NNNNNNN-DD.AAAA.5.09.OOOO  (J=5 Justiça do Trabalho, TR=09).
 *
 * Atalho nomeado sobre `FalcaoTribunais.classes('TRT9')`. Para os outros 25
 * acervos use `classes('TRT2').Checker` ou `./bin/jur trt2 -n <numero>`.
 * ⚠️ O Checker do TST aceita processo de QUALQUER TRT de origem — ver a
 * armadilha do `codigoCNJ` no cabeçalho de `FalcaoTribunais.js`.
 *
 * CLI: node src/TRT9Checker.js <numero-processo>
 *      ./bin/jur trt9 -n <numero-processo>
 */
const TRT9Checker = classes('TRT9').Checker;

module.exports = TRT9Checker;

// CLI: node src/TRT9Checker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TRT9Checker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  new TRT9Checker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
