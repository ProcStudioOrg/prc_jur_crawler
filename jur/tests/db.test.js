const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');

const arquivoTmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-db-')), 'jur.db');

describe('db', () => {
  it('v5: banco antigo ganha resolvido_pelo_usuario e navegador_falhas', () => {
    const { DatabaseSync } = require('node:sqlite');
    const arquivo = arquivoTmp();
    const velho = new DatabaseSync(arquivo);
    velho.exec(`CREATE TABLE job (id TEXT PRIMARY KEY, comando TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, criado_em INTEGER NOT NULL, iniciado_em INTEGER, terminado_em INTEGER, pid INTEGER,
      exit_code INTEGER, erro TEXT, total INTEGER NOT NULL DEFAULT 0, arquivo TEXT, avisos_json TEXT NOT NULL DEFAULT '[]');
      PRAGMA user_version = 3;`);
    velho.prepare(`INSERT INTO job (id, comando, status, criado_em) VALUES ('v','stf','concluido',1)`).run();
    velho.close();
    const con = db.abrir(arquivo);
    const cols = Object.fromEntries(con.prepare('PRAGMA table_info(job)').all().map((c) => [c.name, c]));
    assert.ok(cols.navegador && cols.navegador_falhas && cols.resolvido_pelo_usuario);
    assert.strictEqual(cols.resolvido_pelo_usuario.notnull, 1);
    assert.strictEqual(con.prepare('PRAGMA user_version').get().user_version, 7);
    assert.ok(con.prepare("SELECT name FROM sqlite_master WHERE name='cobranca_pendente'").get(), 'v6: banco antigo ganha cobranca_pendente');
    assert.ok(con.prepare("SELECT name FROM sqlite_master WHERE name='custo_turno'").get(), 'v7: banco antigo ganha custo_turno');
    const l = con.prepare("SELECT resolvido_pelo_usuario, navegador_falhas FROM job WHERE id='v'").get();
    assert.deepStrictEqual([l.resolvido_pelo_usuario, l.navegador_falhas], [0, null]);
    con.close();
    db.abrir(arquivo).close(); // reabrir não tenta o ALTER de novo
  });

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
