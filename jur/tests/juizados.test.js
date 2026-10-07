// jur/tests/juizados.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const juizados = require('../servidor/juizados');
const catalogo = require('../servidor/catalogo');

describe('mapa de juizados', () => {
  it('traduz o recorte de juizados para os args da CLI de cada tribunal', () => {
    assert.deepStrictEqual(juizados.obter('trf4').args, ['--origem', 'turmas-recursais']);
    assert.deepStrictEqual(juizados.obter('trf1').args, ['--fontes', 'JEF1']);
    assert.deepStrictEqual(juizados.obter('tjpr').args, null);
    assert.strictEqual(juizados.obter('tjpr').suportado, false);
    assert.strictEqual(juizados.obter('nao-existe'), null);
  });

  it('classifica todo comando do catalogo', () => {
    const sem = catalogo.listar().map((t) => t.comando).filter((c) => !juizados.obter(c));
    assert.deepStrictEqual(sem, []);
  });

  it('a Justica do Trabalho nao tem juizados', () => {
    assert.strictEqual(juizados.obter('trt9').suportado, false);
    assert.strictEqual(juizados.obter('tst').suportado, false);
  });

  it('explica a ausencia sem mandar o modelo buscar sem o filtro', () => {
    const texto = juizados.explicarAusencia('tjpr', 'Tribunal de Justica do Parana');
    assert.match(texto, /NAO FOI FEITA/);
    assert.match(texto, /tjpr/);
  });
});
