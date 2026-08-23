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
} else if (modo === 'eco-listagem') {
  // Modo de LISTAGEM (--listar-*): nao recebe -o e nao produz arquivo. Devolve os args
  // que recebeu para o teste conferir que nada da busca (query, datas, -o) vazou.
  process.stdout.write(JSON.stringify({ success: true, args, relatores: ['FULANO DE TAL'] }) + '\n');
} else if (modo === 'eco') {
  process.stdout.write(JSON.stringify({ success: true, args }) + '\n');
} else if (modo === 'so-envelope') {
  // Nao escreve arquivo nenhum: exercita o fallback de extrairResultados que
  // varre o envelope atras do primeiro array. Nenhuma CLI real faz isso hoje
  // (todas usam {success, count, output}), mas o executor precisa cobrir o caso.
  const resultados = [{ processo: '7', ementa: 'y' }];
  process.stdout.write(JSON.stringify({ success: true, count: 1, results: resultados }) + '\n');
} else if (modo === 'trava-neto-ignora-sigterm') {
  // Reproduz a arvore real: o executor spawna ESTE processo (equivalente ao
  // node do bin/jur) com {detached:true}, e ESTE processo spawna um NETO
  // (equivalente ao Chromium) SEM detached — o neto fica no MESMO grupo.
  // Este processo (o filho direto) NAO instala handler de SIGTERM: morre
  // rapido no sinal, como o node do bin/jur morreria de verdade. O NETO
  // ignora SIGTERM de proposito, simulando um Chromium que nao morre so com
  // o sinal gentil. So o SIGKILL de garantia (broadcast por -pid no grupo)
  // deve conseguir terminar o neto.
  const { spawn } = require('node:child_process');
  const neto = spawn(process.execPath, [__filename, 'neto-ignora-sigterm', '-o', saida], { stdio: 'ignore' });
  fs.writeFileSync(saida + '.neto-pid', String(neto.pid));
  setInterval(() => {}, 1000);
} else if (modo === 'neto-ignora-sigterm') {
  process.on('SIGTERM', () => { /* ignora de proposito */ });
  fs.writeFileSync(saida + '.pronto', '1');
  setInterval(() => {}, 1000);
}
