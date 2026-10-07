// jur/tests/capacidades.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const capacidades = require('../servidor/capacidades');
const catalogo = require('../servidor/catalogo');

describe('capacidades por tribunal', () => {
  it('devolve as sete funcionalidades, nesta ordem, para todo tribunal', () => {
    for (const t of catalogo.listar()) {
      const c = capacidades.obter(t.comando);
      assert.ok(c, t.comando);
      assert.deepStrictEqual(Object.keys(c.funcionalidades), capacidades.CHAVES, t.comando);
      for (const f of Object.values(c.funcionalidades)) {
        assert.ok(['funciona', 'ressalva', 'nao-funciona', 'nao-existe'].includes(f.estado), `${t.comando}: ${f.estado}`);
        assert.strictEqual(typeof f.nota, 'string');
      }
      assert.ok(c.resumo.length > 10, `${t.comando} precisa de resumo`);
    }
  });

  it('tribunal ok: o que existe funciona; o que nao existe e nao-existe', () => {
    const stf = capacidades.obter('stf').funcionalidades;
    assert.strictEqual(stf.termo.estado, 'funciona');
    assert.strictEqual(stf.periodoJulgamento.estado, 'funciona');
    assert.strictEqual(stf.juizados.estado, 'nao-existe');
    assert.strictEqual(stf.inteiroTeor.estado, 'funciona');
  });

  it('magistrado por nome exato ou codigo vira ressalva com nota', () => {
    assert.strictEqual(capacidades.obter('stf').funcionalidades.magistrado.estado, 'ressalva');
    assert.match(capacidades.obter('stf').funcionalidades.magistrado.nota, /exato/i);
    assert.strictEqual(capacidades.obter('tjpr').funcionalidades.magistrado.estado, 'nao-existe');
  });

  it('tribunal indisponivel: tudo que existe vira nao-funciona', () => {
    const stj = capacidades.obter('stj').funcionalidades;
    assert.strictEqual(stj.termo.estado, 'nao-funciona');
    assert.strictEqual(stj.juizados.estado, 'nao-existe');
  });

  it('tribunal instavel: busca por termo vira ressalva', () => {
    assert.strictEqual(capacidades.obter('tjsc').funcionalidades.termo.estado, 'ressalva');
  });

  it('o JSON curado sobrepoe estado e nota de uma funcionalidade', () => {
    const tjac = capacidades.obter('tjac').funcionalidades;
    assert.strictEqual(tjac.inteiroTeor.estado, 'nao-funciona');
    assert.match(tjac.inteiroTeor.nota, /reCAPTCHA/);
  });

  it('o JSON curado da o resumo, e todo tribunal fora de ok tem um', () => {
    const semResumo = catalogo.listar()
      .filter((t) => t.estado !== 'ok')
      .filter((t) => !capacidades.curado(t.comando) || !capacidades.curado(t.comando).resumo);
    assert.deepStrictEqual(semResumo.map((t) => t.comando), []);
    assert.match(capacidades.obter('stj').resumo, /Cloudflare/);
  });

  it('o resumo nunca menciona a CLI', () => {
    for (const t of catalogo.listar()) {
      const c = capacidades.obter(t.comando);
      assert.doesNotMatch(c.resumo, /\bCLI\b|bin\/jur|--[a-z]/, t.comando);
      for (const f of Object.values(c.funcionalidades)) assert.doesNotMatch(f.nota, /\bCLI\b|bin\/jur|--[a-z]/, t.comando);
    }
  });

  it('disponivel pode ser sobreposto (tentativa assistida)', () => {
    const stj = capacidades.obter('stj', { disponivel: true }).funcionalidades;
    assert.strictEqual(stj.termo.estado, 'funciona');
  });

  it('recusar explica ausencia e falha, e devolve null quando pode rodar', () => {
    assert.match(capacidades.recusar('tjpr', 'juizados', 'TJPR'), /NAO FOI FEITA/);
    assert.match(capacidades.recusar('tjac', 'inteiroTeor', 'TJAC'), /reCAPTCHA/);
    assert.strictEqual(capacidades.recusar('trf4', 'juizados', 'TRF4'), null);
    assert.strictEqual(capacidades.recusar('trf4', 'periodoPublicacao', 'TRF4'), null);
  });

  it('resumoCompacto lista so o que funciona ou tem ressalva, sem termo e numero', () => {
    const r = capacidades.resumoCompacto('trf4');
    assert.match(r, /data/);
    assert.match(r, /juizados/);
    assert.match(r, /inteiro teor/);
    assert.doesNotMatch(r, /termo/);
  });
});
