const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');

const arquivoTmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-db-')), 'jur.db');

describe('db', () => {
  it('cria o schema e aceita um job', () => {
    const con = db.abrir(arquivoTmp());
    con.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
                 VALUES (?, ?, ?, ?, ?)`).run('j1', 'stf', '{}', 'enfileirado', Date.now());
    const linha = con.prepare('SELECT * FROM job WHERE id = ?').get('j1');
    assert.strictEqual(linha.comando, 'stf');
    assert.strictEqual(linha.status, 'enfileirado');
    assert.strictEqual(linha.total, 0);
  });

  it('e idempotente: abrir duas vezes nao apaga nada', () => {
    const arquivo = arquivoTmp();
    const a = db.abrir(arquivo);
    a.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
               VALUES ('j2','tcu','{}','concluido',1)`).run();
    a.close();
    const b = db.abrir(arquivo);
    assert.strictEqual(b.prepare('SELECT COUNT(*) c FROM job').get().c, 1);
  });

  it('guarda conversa e mensagem ligadas', () => {
    const con = db.abrir(arquivoTmp());
    con.prepare('INSERT INTO conversa (id, titulo, criado_em) VALUES (?,?,?)').run('c1', 'teste', 1);
    con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, criado_em)
                 VALUES (?,?,?,?)`).run('c1', 'user', 'ola', 2);
    assert.strictEqual(con.prepare('SELECT COUNT(*) c FROM mensagem WHERE conversa_id=?').get('c1').c, 1);
  });

  it('rejeita mensagem com conversa_id inexistente', () => {
    const con = db.abrir(arquivoTmp());
    assert.throws(() => {
      con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, criado_em)
                   VALUES (?,?,?,?)`).run('c_inexistente', 'user', 'ola', 2);
    }, /FOREIGN KEY constraint failed/);
  });
});
