const assert = require('node:assert');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

describe('catalogo', () => {
  it('lista tribunais com os campos do contrato', () => {
    const todos = catalogo.listar();
    assert.ok(todos.length > 60, `esperava >60 tribunais, veio ${todos.length}`);
    const stf = todos.find((t) => t.comando === 'stf');
    assert.ok(stf, 'stf deve estar no catalogo');
    assert.strictEqual(stf.codigo, 'STF');
    assert.strictEqual(stf.estado, 'ok');
    assert.strictEqual(stf.disponivel, true);
    assert.ok(typeof stf.nome === 'string' && stf.nome.length > 0);
    assert.ok(Array.isArray(stf.uf));
  });

  it('marca tribunal bloqueado como indisponivel', () => {
    const stj = catalogo.obter('stj');
    assert.strictEqual(stj.estado, 'sem-acesso');
    assert.strictEqual(stj.disponivel, false);
  });

  it('trata instavel como disponivel, mas preserva a nota', () => {
    const trf1 = catalogo.obter('trf1');
    assert.strictEqual(trf1.estado, 'instavel');
    assert.strictEqual(trf1.disponivel, true);
    assert.ok(trf1.nota.length > 0, 'instavel sem nota e inutil para o usuario');
  });

  it('filtra por segmento e por uf', () => {
    const superiores = catalogo.listar({ segmento: 'superior' });
    assert.ok(superiores.every((t) => t.segmento === 'superior'));
    assert.ok(superiores.length >= 2);

    const doParana = catalogo.listar({ uf: 'PR' });
    assert.ok(doParana.some((t) => t.comando === 'tjpr'));
  });

  it('obter devolve null para comando desconhecido', () => {
    assert.strictEqual(catalogo.obter('tjxx'), null);
  });
});
