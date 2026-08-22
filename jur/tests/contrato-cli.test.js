// jur/tests/contrato-cli.test.js
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

const CLI = path.join(__dirname, '..', 'bin', 'jur');

// O crps nao e comando de busca (--login/--status/--capturar) e nao tem -o.
const SEM_OUTPUT = new Set(['crps']);

// Sem --max-pages: nao paginam.
const SEM_PAGINACAO = new Set([
  'tjrn', // busca por texto BLOQUEADA (403 Akamai); so consulta por numero via DataJud, sem paginacao
  'crps', // nao e comando de busca
]);

// Sem --data-inicio/--data-fim: nao filtram por data de sessao/julgamento.
const SEM_FILTRO_DATA = new Set([
  'tjma', // busca por texto BLOQUEADA (captcha); so numero (DataJud) ou -dpi/-dpf (data de PUBLICACAO, campo diferente)
  'tjrn', // busca por texto BLOQUEADA (403 Akamai); so consulta por numero via DataJud, sem filtro de data
  'crps', // nao e comando de busca
]);

// Sem --numero: nao expoem consulta direta por numero de processo.
const SEM_NUMERO = new Set([
  'tcu', // nao expoe consulta direta por numero de processo no --help
  'tjsp', // nao expoe consulta direta por numero de processo no --help
  'crps', // nao e comando de busca
]);

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

  // O executor injeta cinco parametros (PARAMS_ACEITOS): query, dataInicio, dataFim,
  // maxPaginas, numero. O teste acima so prova query (via --query). Este prova as
  // outras quatro flags (--max-pages, --data-inicio, --data-fim, --numero), com
  // excecao nomeada e comentada para cada tribunal que nao as tem.
  it('todo subcomando de busca aceita as flags dos outros quatro parametros do executor', () => {
    const semPaginacao = [];
    const semData = [];
    const semNumero = [];
    for (const c of catalogo.comandosDaCli()) {
      const texto = ajuda(c);
      if (!SEM_PAGINACAO.has(c) && !texto.includes('--max-pages')) semPaginacao.push(c);
      if (!SEM_FILTRO_DATA.has(c) && !(texto.includes('--data-inicio') && texto.includes('--data-fim'))) semData.push(c);
      if (!SEM_NUMERO.has(c) && !texto.includes('--numero')) semNumero.push(c);
    }
    assert.deepStrictEqual(semPaginacao, [], `sem --max-pages: ${semPaginacao.join(', ')}`);
    assert.deepStrictEqual(semData, [], `sem --data-inicio/--data-fim: ${semData.join(', ')}`);
    assert.deepStrictEqual(semNumero, [], `sem --numero: ${semNumero.join(', ')}`);
  });
});
