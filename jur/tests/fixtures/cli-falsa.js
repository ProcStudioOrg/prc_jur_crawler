// jur/tests/fixtures/cli-falsa.js
// Imita `bin/jur <cmd> --json`. Modo escolhido pelo primeiro argumento.
const fs = require('node:fs');

const modo = process.argv[2];
const args = process.argv.slice(3);
const saida = args[args.indexOf('-o') + 1];

if (modo === 'inline') {
  // Formato dominante: 45 subcomandos devolvem os resultados no envelope.
  const resultados = [{ processo: '1', ementa: 'a' }, { processo: '2', ementa: 'b' }];
  fs.writeFileSync(saida, JSON.stringify(resultados));
  process.stdout.write(JSON.stringify({ success: true, count: 2, results: resultados }) + '\n');
} else if (modo === 'arquivo') {
  // Formato dos outros 5: so o caminho volta; os dados estao no disco.
  fs.writeFileSync(saida, JSON.stringify([{ processo: '9', ementa: 'z' }]));
  process.stdout.write(JSON.stringify({ success: true, count: 1, output: saida }) + '\n');
} else if (modo === 'erro') {
  process.stdout.write(JSON.stringify({ success: false, error: 'tribunal fora do ar' }) + '\n');
  process.exit(1);
} else if (modo === 'ruido') {
  // Aviso antes do JSON: o executor deve ler a ULTIMA linha, nao a primeira.
  process.stdout.write('aviso: base congelada\n');
  fs.writeFileSync(saida, JSON.stringify([{ processo: '3' }]));
  process.stdout.write(JSON.stringify({ success: true, count: 1 }) + '\n');
} else if (modo === 'travado') {
  setInterval(() => {}, 1000); // nunca termina: exercita o timeout
} else if (modo === 'eco') {
  process.stdout.write(JSON.stringify({ success: true, args }) + '\n');
}
