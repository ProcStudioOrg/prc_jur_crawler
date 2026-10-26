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

  it('duas conexões no mesmo arquivo: a escrita da segunda espera a da primeira em vez de SQLITE_BUSY', async () => {
    const { Worker } = require('node:worker_threads');
    const arquivo = arquivoTmp();
    db.abrir(arquivo).close();
    // A primeira conexão segura uma escrita por 300 ms em outra thread (como o registrar de um
    // turno vivo); a segunda, aberta por db.abrir (como o varredor do boot), escreve no meio.
    const outra = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const con = new DatabaseSync(workerData);
      con.exec('BEGIN IMMEDIATE');
      con.prepare("INSERT INTO cobranca_pendente (request_id, payload, tentativas, criado_em, em_voo) VALUES ('a', '{}', 0, 1, 1)").run();
      parentPort.postMessage('travado');
      setTimeout(() => { con.exec('COMMIT'); con.close(); parentPort.postMessage('liberado'); }, 300);
    `, { eval: true, workerData: arquivo });
    const mensagens = [];
    const liberado = new Promise((resolve, reject) => {
      outra.on('message', (m) => { mensagens.push(m); if (m === 'liberado') resolve(); });
      outra.on('error', reject);
    });
    await new Promise((resolve) => outra.once('message', resolve));
    // abrir() já escreve (user_version do schema): a espera pode cair nele ou no UPDATE.
    const inicio = Date.now();
    const con = db.abrir(arquivo);
    try {
      con.prepare("UPDATE cobranca_pendente SET em_voo = 0 WHERE em_voo = 1").run();
      con.prepare("INSERT INTO cobranca_pendente (request_id, payload, tentativas, criado_em, em_voo) VALUES ('b', '{}', 0, 2, 0)").run();
      assert.ok(Date.now() - inicio >= 100, 'a escrita esperou o lock da outra conexão');
      await liberado;
      assert.deepStrictEqual(con.prepare('SELECT request_id FROM cobranca_pendente ORDER BY request_id').all().map((l) => l.request_id), ['a', 'b']);
    } finally {
      con.close();
      await outra.terminate();
    }
  });
});
