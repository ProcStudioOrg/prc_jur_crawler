const assert = require('node:assert');
const { describe, it } = require('node:test');
const v = require('../servidor/validacao');

describe('validarModelo', () => {
  it('aceita os tres modelos suportados', () => {
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      assert.strictEqual(v.validarModelo(m).ok, true, m);
      assert.strictEqual(v.validarModelo(m).valor, m);
    }
  });

  it('usa opus-5 quando ausente', () => {
    const r = v.validarModelo(undefined);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.valor, 'claude-opus-5');
  });

  it('recusa modelo desconhecido e nao coage', () => {
    for (const ruim of ['gpt-4', 'claude-opus-5-20250101', 'opus', true, 5, ['claude-opus-5'], {}]) {
      const r = v.validarModelo(ruim);
      assert.strictEqual(r.ok, false, JSON.stringify(ruim));
      assert.match(r.erro, /modelo/i);
    }
  });
});

describe('validarEsforco', () => {
  it('aceita low/medium/high nos modelos que suportam', () => {
    for (const e of ['low', 'medium', 'high']) {
      assert.strictEqual(v.validarEsforco(e, 'claude-opus-5').ok, true);
      assert.strictEqual(v.validarEsforco(e, 'claude-sonnet-5').ok, true);
    }
  });

  it('usa high quando ausente', () => {
    assert.strictEqual(v.validarEsforco(undefined, 'claude-opus-5').valor, 'high');
  });

  it('RECUSA esforco no haiku, que rejeita o parametro na API', () => {
    const r = v.validarEsforco('high', 'claude-haiku-4-5');
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /haiku/i);
  });

  it('aceita esforco ausente no haiku', () => {
    const r = v.validarEsforco(undefined, 'claude-haiku-4-5');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.valor, null);
  });

  it('recusa valor invalido sem coagir', () => {
    for (const ruim of ['alto', 'HIGH', true, 1, {}]) {
      assert.strictEqual(v.validarEsforco(ruim, 'claude-opus-5').ok, false, JSON.stringify(ruim));
    }
  });
});
