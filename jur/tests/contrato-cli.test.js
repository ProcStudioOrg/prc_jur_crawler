// jur/tests/contrato-cli.test.js
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const catalogo = require("../servidor/catalogo");
const relator = require("../servidor/relator");

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
  if (!ajuda.memo.has(comando)) {
    ajuda.memo.set(
      comando,
      execFileSync(process.execPath, [CLI, comando, '--help'], { encoding: 'utf8', timeout: 20000 }),
    );
  }
  return ajuda.memo.get(comando);
}
// Memo entre os testes deste arquivo: cada chamada e um processo node novo, e sao ~75
// comandos vezes cinco testes. Sem cache o arquivo sozinho leva minutos.
ajuda.memo = new Map();

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

/**
 * O mapa de servidor/relator.js diz, por tribunal, se a busca por magistrado existe e
 * em que forma o valor precisa vir. Ele so vale enquanto bater com a CLI — e o motivo
 * de existir e uma pergunta que o usuario fez depois de tentar buscar por magistrado no
 * TJPR e nao conseguir: o portal do TJPR nao tem esse filtro, e o servidor nao tinha
 * como dizer isso porque nao sabia. Um mapa que apodrece em silencio devolveria a mesma
 * mentira ao contrario.
 */
describe('mapa de busca por magistrado x o que a CLI oferece', () => {
  it('todo comando da CLI esta classificado no mapa', () => {
    const semClassificacao = catalogo.comandosDaCli().filter((c) => !relator.obter(c));
    assert.deepStrictEqual(semClassificacao, [],
      `sem entrada em servidor/relator.js: ${semClassificacao.join(', ')}`);
  });

  it('o mapa nao inventa tribunal que a CLI nao tem', () => {
    const daCli = new Set(catalogo.comandosDaCli());
    const fantasmas = relator.comandos().filter((c) => !daCli.has(c));
    assert.deepStrictEqual(fantasmas, [],
      `no mapa mas nao na CLI: ${fantasmas.join(', ')}`);
  });

  it('todo tribunal marcado como suportado tem mesmo a flag --relator', () => {
    const mentindo = relator.comandos()
      .filter((c) => relator.obter(c).suportado)
      .filter((c) => !ajuda(c).includes('--relator'));
    assert.deepStrictEqual(mentindo, [],
      `marcados suportado mas SEM --relator na CLI: ${mentindo.join(', ')}`);
  });

  // O lado que fecha o achado do TJPR: dizer "nao suportado" para um tribunal que na
  // verdade suporta e negar ao usuario uma busca que existe.
  it('todo tribunal marcado como nao suportado realmente nao tem --relator', () => {
    const injusticados = relator.comandos()
      .filter((c) => !relator.obter(c).suportado)
      .filter((c) => ajuda(c).includes('--relator'));
    assert.deepStrictEqual(injusticados, [],
      `marcados sem suporte mas a CLI TEM --relator: ${injusticados.join(', ')}`);
  });

  it('toda flag de listagem declarada existe de verdade na CLI', () => {
    const inexistentes = [];
    for (const c of relator.comandos()) {
      const info = relator.obter(c);
      if (!info.listagem) continue;
      const flag = info.listagem.args[0];
      if (!ajuda(c).includes(flag)) inexistentes.push(`${c}:${flag}`);
    }
    // Esta e a asserção que pegou o `--listar-ministros` do stj: a descricao do
    // -r manda usar uma flag que a CLI nunca registrou. O mapa nao pode repetir isso.
    assert.deepStrictEqual(inexistentes, [],
      `flag de listagem declarada que nao existe na CLI: ${inexistentes.join(', ')}`);
  });

  it('todo tribunal suportado declara uma forma conhecida para o valor', () => {
    const ruins = relator.comandos()
      .filter((c) => relator.obter(c).suportado)
      .filter((c) => !relator.FORMAS.includes(relator.obter(c).forma));
    assert.deepStrictEqual(ruins, [], `forma invalida: ${ruins.join(', ')}`);
  });

  it('todo tribunal sem suporte explica o que fazer no lugar', () => {
    const mudos = relator.comandos()
      .filter((c) => !relator.obter(c).suportado)
      .filter((c) => !relator.obter(c).nota);
    assert.deepStrictEqual(mudos, [],
      `sem nota explicando a ausencia: ${mudos.join(', ')}`);
  });
});
