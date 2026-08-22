const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS job (
  id           TEXT PRIMARY KEY,
  comando      TEXT NOT NULL,
  params_json  TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL,
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
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const con = new DatabaseSync(caminho);
  con.exec('PRAGMA journal_mode = WAL;');
  con.exec('PRAGMA foreign_keys = ON;');
  con.exec(SCHEMA);
  return con;
}

module.exports = { abrir, caminhoPadrao };
