const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const conversas = require('../servidor/conversas');

let repo;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-'));
  repo = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
});

describe('conversas', () => {
  it('cria, lista e apaga', () => {
    const c = repo.criar();
    assert.ok(c.id);
    assert.ok(repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), true);
    assert.ok(!repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), false);
  });

  it('PRESERVA blocos estruturados de tool_use e tool_result', () => {
    const c = repo.criar();
    const usoDeFerramenta = [
      { type: 'text', text: 'vou buscar' },
      { type: 'tool_use', id: 'tu1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } },
    ];
    const resultado = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'job abc: 3 resultados' }];
    repo.acrescentar(c.id, 'user', 'busque no stf');
    repo.acrescentar(c.id, 'assistant', usoDeFerramenta);
    repo.acrescentar(c.id, 'user', resultado);

    const m = repo.mensagens(c.id);
    assert.strictEqual(m.length, 3);
    assert.strictEqual(m[0].conteudo, 'busque no stf');
    assert.deepStrictEqual(m[1].conteudo, usoDeFerramenta, 'o bloco tool_use precisa voltar intacto');
    assert.deepStrictEqual(m[2].conteudo, resultado, 'o tool_result precisa voltar intacto');
    assert.strictEqual(m[1].conteudo[1].input.tribunal, 'stf');
  });

  it('deriva o titulo da primeira mensagem do usuario e nao troca depois', () => {
    const c = repo.criar();
    repo.renomearSePrimeira(c.id, 'acordaos do trf4 sobre auxilio-acidente em 2024');
    const t1 = repo.listar().find((x) => x.id === c.id).titulo;
    assert.match(t1, /trf4/);
    assert.ok(t1.length <= 60, `titulo longo demais: ${t1.length}`);
    repo.renomearSePrimeira(c.id, 'outra coisa completamente diferente');
    assert.strictEqual(repo.listar().find((x) => x.id === c.id).titulo, t1, 'titulo nao pode mudar depois');
  });

  it('ordena por atualizacao, mais recente primeiro', () => {
    const a = repo.criar(); const b = repo.criar();
    repo.acrescentar(a.id, 'user', 'oi');
    const ids = repo.listar().map((x) => x.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), 'a conversa com atividade recente vem antes');
  });

  it('mensagens de conversa inexistente e lista vazia, nao erro', () => {
    assert.deepStrictEqual(repo.mensagens('nao-existe'), []);
  });

  it('apagar conversa leva as mensagens junto', () => {
    const c = repo.criar();
    repo.acrescentar(c.id, 'user', 'oi');
    repo.apagar(c.id);
    assert.deepStrictEqual(repo.mensagens(c.id), []);
  });
});
