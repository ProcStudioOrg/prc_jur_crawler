const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const chaves = require('../servidor/chaves');

let g;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chaves-'));
  g = chaves.criarGerenciador(db.abrir(path.join(dir, 'jur.db')));
});

describe('chaves de conexao', () => {
  it('gera chave com prefixo reconhecivel e valor de tamanho util', () => {
    const c = g.gerar('claude code');
    assert.ok(c.valor.startsWith('jur_'), 'valor precisa ser reconhecivel como chave do jur');
    assert.ok(c.valor.length >= 40, `valor curto demais: ${c.valor.length}`);
    assert.ok(c.prefixo.length > 0 && c.valor.startsWith(c.prefixo));
    assert.strictEqual(c.nome, 'claude code');
  });

  it('NAO guarda o valor em claro no banco', () => {
    const c = g.gerar('teste');
    const linha = g._paraTeste().prepare('SELECT * FROM chave_conexao WHERE id=?').get(c.id);
    assert.ok(linha.hash && linha.hash !== c.valor, 'o hash nao pode ser o proprio valor');
    const bruto = JSON.stringify(linha);
    assert.ok(!bruto.includes(c.valor), 'o valor da chave vazou para alguma coluna');
  });

  it('verifica chave valida e recusa invalida', () => {
    const c = g.gerar('valida');
    const achou = g.verificar(c.valor);
    assert.ok(achou);
    assert.strictEqual(achou.id, c.id);
    assert.strictEqual(g.verificar('jur_naoexiste'), null);
    assert.strictEqual(g.verificar(''), null);
    assert.strictEqual(g.verificar(null), null);
    assert.strictEqual(g.verificar(undefined), null);
  });

  it('registra o ultimo uso', () => {
    const c = g.gerar('uso');
    assert.strictEqual(g.listar().find((x) => x.id === c.id).ultimoUsoEm, null);
    g.verificar(c.valor);
    assert.ok(g.listar().find((x) => x.id === c.id).ultimoUsoEm > 0);
  });

  it('chave revogada para de funcionar e aparece como revogada', () => {
    const c = g.gerar('revogar');
    assert.strictEqual(g.revogar(c.id), true);
    assert.strictEqual(g.verificar(c.valor), null, 'chave revogada nao pode autenticar');
    assert.ok(g.listar().find((x) => x.id === c.id).revogadoEm > 0);
    assert.strictEqual(g.revogar(c.id), false, 'revogar duas vezes nao e sucesso');
    assert.strictEqual(g.revogar('nao-existe'), false);
  });

  it('listar nunca devolve valor nem hash', () => {
    g.gerar('sigilo');
    for (const c of g.listar()) {
      assert.ok(!('valor' in c), 'listar nao pode devolver valor');
      assert.ok(!('hash' in c), 'listar nao pode devolver hash');
    }
  });

  it('duas chaves geradas sao diferentes', () => {
    assert.notStrictEqual(g.gerar('a').valor, g.gerar('b').valor);
  });
});
