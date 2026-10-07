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

  // A curadoria corrige o FUNCIONA, nunca o EXISTE: o existe vem da CLI e o contrato
  // testa. Uma entrada curada para algo que nao existe faria a ficha prometer (e a
  // ferramenta tentar) uma funcionalidade que o tribunal nao tem.
  it('o curado nao se aplica a funcionalidade que nao existe', () => {
    const sobre = { estado: 'ressalva', nota: 'curado' };
    assert.deepStrictEqual(capacidades.aplicarCurado({ existe: false }, 'nao-existe', '', sobre), { estado: 'nao-existe', nota: '' });
    assert.deepStrictEqual(capacidades.aplicarCurado({ existe: true }, 'funciona', '', sobre), { estado: 'ressalva', nota: 'curado' });
    assert.deepStrictEqual(capacidades.aplicarCurado({ existe: true }, 'funciona', 'n', undefined), { estado: 'funciona', nota: 'n' });
  });

  it('cobertura/capacidades.json so tem tribunais do catalogo, chaves conhecidas e estados validos', () => {
    const curado = require('../cobertura/capacidades.json');
    const comandos = new Set(catalogo.listar().map((t) => t.comando));
    const estados = ['funciona', 'ressalva', 'nao-funciona', 'nao-existe'];
    const problemas = [];
    for (const [comando, entrada] of Object.entries(curado)) {
      if (comando.startsWith('_')) continue;
      if (!comandos.has(comando)) problemas.push(`${comando}: nao esta no catalogo`);
      for (const [chave, f] of Object.entries(entrada.funcionalidades || {})) {
        if (!capacidades.CHAVES.includes(chave)) problemas.push(`${comando}.${chave}: chave desconhecida`);
        if (!estados.includes(f.estado)) problemas.push(`${comando}.${chave}: estado invalido ${f.estado}`);
      }
    }
    assert.deepStrictEqual(problemas, []);
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

  // As notas vao para a ficha do tribunal: portugues de tela, com acento, sem jargao
  // de implementacao ("recorte feito no cliente").
  it('as notas das funcionalidades sao texto de tela: acentuadas e sem jargao', () => {
    const SEM_ACENTO = /\b(nao|ha|esta|instancia|Justica|orgao|So|unica)\b|\b2o\b|no cliente/;
    for (const t of catalogo.listar()) {
      for (const [chave, f] of Object.entries(capacidades.obter(t.comando).funcionalidades)) {
        assert.doesNotMatch(f.nota, SEM_ACENTO, `${t.comando}.${chave}: ${f.nota}`);
      }
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

  // Sem o override, o STJ assistido (captcha resolvido pelo usuario) passava pela
  // checagem de disponibilidade e era barrado logo depois por "nao esta funcionando".
  it('recusar respeita o override de disponibilidade da tentativa assistida', () => {
    assert.match(capacidades.recusar('stj', 'periodoPublicacao', 'STJ'), /NAO FOI FEITA/);
    assert.strictEqual(capacidades.recusar('stj', 'periodoPublicacao', 'STJ', { disponivel: true }), null);
  });

  it('resumoCompacto lista so o que funciona ou tem ressalva, sem termo e numero', () => {
    const r = capacidades.resumoCompacto('trf4');
    assert.match(r, /data/);
    assert.match(r, /juizados/);
    assert.match(r, /inteiro teor/);
    assert.doesNotMatch(r, /termo/);
  });
});
