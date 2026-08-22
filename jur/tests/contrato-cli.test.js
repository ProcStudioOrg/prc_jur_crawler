// jur/tests/contrato-cli.test.js
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

const CLI = path.join(__dirname, '..', 'bin', 'jur');
// O crps nao e comando de busca (--login/--status/--capturar) e nao tem -o.
// O tjrn so consulta por numero e nao pagina.
const SEM_OUTPUT = new Set(['crps']);

function ajuda(comando) {
  return execFileSync(process.execPath, [CLI, comando, '--help'], { encoding: 'utf8', timeout: 20000 });
}

describe('contrato da CLI que o executor assume', () => {
  it('todo subcomando aceita --json', () => {
    const falhas = catalogo.comandosDaCli().filter((c) => !ajuda(c).includes('--json'));
    assert.deepStrictEqual(falhas, [], `sem --json: ${falhas.join(', ')}`);
  });

  it('todo subcomando de busca aceita -o e -q', () => {
    const semSaida = [];
    const semQuery = [];
    for (const c of catalogo.comandosDaCli()) {
      if (SEM_OUTPUT.has(c)) continue;
      const texto = ajuda(c);
      if (!texto.includes('--output')) semSaida.push(c);
      if (!texto.includes('--query')) semQuery.push(c);
    }
    assert.deepStrictEqual(semSaida, [], `sem --output: ${semSaida.join(', ')}`);
    assert.deepStrictEqual(semQuery, [], `sem --query: ${semQuery.join(', ')}`);
  });
});
