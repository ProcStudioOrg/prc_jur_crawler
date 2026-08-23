const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
/* user_version = 3: v1 era o schema inicial sem migração. v2 acrescentou chave_conexao
   (chaves emitidas para clientes externos). v3 acrescenta conversa_busca, o vínculo
   entre uma conversa e os jobs de busca que ela disparou. Continuamos sem migração
   automática — as três mudanças foram aditivas, então CREATE TABLE IF NOT EXISTS já
   cobre banco antigo. A coluna user_version fica registrada para uma versão futura
   decidir o que fazer se o schema evoluir de um jeito que exija migração de verdade
   (renomear/remover coluna, por exemplo). */
PRAGMA user_version = 3;

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

/* Quais buscas cada conversa disparou. É o que responde "o que ESTA análise leu" — sem
   isso os job_id só existiam dentro do TEXTO dos tool_result, e sumiam de vista depois
   de um F5. Não dá para ser uma coluna na tabela mensagem: um turno pode disparar
   várias buscas em paralelo (o modelo paraleliza tool_use) e uma coluna não comporta N.
   A PK composta faz o vínculo repetido ser idempotente em vez de duplicar a linha. */
CREATE TABLE IF NOT EXISTS conversa_busca (
  conversa_id  TEXT NOT NULL REFERENCES conversa(id),
  job_id       TEXT NOT NULL,
  criado_em    INTEGER NOT NULL,
  PRIMARY KEY (conversa_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_conversa_busca ON conversa_busca (conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS sessao (
  comando      TEXT PRIMARY KEY,
  segredo_json TEXT NOT NULL,
  validado_em  INTEGER,
  expira_em    INTEGER
);

CREATE TABLE IF NOT EXISTS chave_conexao (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE,
  prefixo       TEXT NOT NULL,
  criado_em     INTEGER NOT NULL,
  ultimo_uso_em INTEGER,
  revogado_em   INTEGER
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
