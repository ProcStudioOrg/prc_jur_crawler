const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
/* user_version = 1: schema v1 sem migração. A coluna user_version fica registrada
   para uma versão futura decidir o que fazer se o schema evoluir — mas hoje ninguém
   tem banco em produção, então este é o momento barato de registrar. */
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS job (
  id           TEXT PRIMARY KEY,
  comando      TEXT NOT NULL,
  params_json  TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL CHECK (status IN ('enfileirado', 'rodando', 'concluido', 'erro', 'cancelado', 'expirado')),
  criado_em    INTEGER NOT NULL,
  iniciado_em  INTEGER,
  terminado_em INTEGER,
  pid          INTEGER,
  exit_code    INTEGER,
  erro         TEXT,
  total        INTEGER NOT NULL DEFAULT 0,
  arquivo      TEXT,
  avisos_json  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_job_status ON job (status, criado_em);

CREATE TABLE IF NOT EXISTS conversa (
  id           TEXT PRIMARY KEY,
  titulo       TEXT,
  criado_em    INTEGER NOT NULL,
  atualizado_em INTEGER
);

CREATE TABLE IF NOT EXISTS mensagem (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id  TEXT NOT NULL REFERENCES conversa(id),
  papel        TEXT NOT NULL,
  conteudo     TEXT NOT NULL,
  job_id       TEXT,
  criado_em    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mensagem_conversa ON mensagem (conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS sessao (
  comando      TEXT PRIMARY KEY,
  segredo_json TEXT NOT NULL,
  validado_em  INTEGER,
  expira_em    INTEGER
);
`;

function caminhoPadrao() {
  return path.join(process.env.JUR_DADOS || '/dados', 'jur.db');
}

function abrir(caminho = caminhoPadrao()) {
  const dir = path.dirname(caminho);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (erro) {
    throw new Error(
      `Não foi possível criar o diretório ${dir}. ` +
      `O padrão /dados é o caminho dentro do container. ` +
      `Para rodar local, exporte JUR_DADOS=/seu/caminho`
    );
  }
  const con = new DatabaseSync(caminho);
  con.exec('PRAGMA journal_mode = WAL;');
  con.exec('PRAGMA foreign_keys = ON;');
  con.exec(SCHEMA);

  // Garante permissão 600 no arquivo de banco e nos arquivos WAL (segredo)
  try {
    fs.chmodSync(caminho, 0o600);
  } catch (e) {
    // Arquivo pode não existir ainda em algumas operações
  }
  try {
    fs.chmodSync(caminho + '-wal', 0o600);
  } catch (e) {
    // Arquivo WAL criado por demanda
  }
  try {
    fs.chmodSync(caminho + '-shm', 0o600);
  } catch (e) {
    // Arquivo SHM criado por demanda
  }

  return con;
}

module.exports = { abrir, caminhoPadrao };
