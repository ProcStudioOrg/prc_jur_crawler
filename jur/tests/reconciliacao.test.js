const assert = require('node:assert');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

// O crps existe na CLI mas NAO e comando de busca (e --login/--status/--capturar).
const FORA_DE_BUSCA = new Set(['crps']);

describe('reconciliacao catalogo x CLI', () => {
  it('todo comando de busca da CLI esta no catalogo', () => {
    const naCli = catalogo.comandosDaCli().filter((c) => !FORA_DE_BUSCA.has(c));
    const noCatalogo = new Set(catalogo.listar().map((t) => t.comando));
    const faltando = naCli.filter((c) => !noCatalogo.has(c));
    assert.deepStrictEqual(faltando, [], `comandos da CLI ausentes do catalogo: ${faltando.join(', ')}`);
  });

  it('todo comando do catalogo existe na CLI', () => {
    const naCli = new Set(catalogo.comandosDaCli());
    const sobrando = catalogo.listar().map((t) => t.comando).filter((c) => !naCli.has(c));
    assert.deepStrictEqual(sobrando, [], `comandos do catalogo que a CLI nao roda: ${sobrando.join(', ')}`);
  });

  it('o crps esta no catalogo como exige-sessao', () => {
    const crps = catalogo.obter('crps');
    assert.ok(crps, 'crps deve existir no catalogo');
    assert.strictEqual(crps.estado, 'exige-sessao');
    assert.strictEqual(crps.disponivel, false);
  });
});
