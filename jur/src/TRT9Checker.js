// src/TRT9Checker.js
const FalcaoChecker = require('./FalcaoChecker');
const TRT9Navigator = require('./TRT9Navigator');

/**
 * Checker do TRT9: confirma que um julgado existe na base oficial da
 * Justiça do Trabalho (FALCÃO), consultando por número de processo.
 *
 * Número CNJ do TRT9: NNNNNNN-DD.AAAA.5.09.OOOO  (J=5 Justiça do Trabalho, TR=09).
 *
 * CLI: node src/TRT9Checker.js <numero-processo>
 *      ./bin/jur trt9 -n <numero-processo>
 */
class TRT9Checker extends FalcaoChecker {
  constructor(options = {}) {
    super({
      ...options,
      tribunal: 'TRT9',
      codigoCNJ: TRT9Navigator.CODIGO_CNJ,
      navigator: options.navigator ?? new TRT9Navigator({
        timeout: options.timeout ?? 60000,
        log: options.log ?? (() => {}),
      }),
    });
  }
}

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
