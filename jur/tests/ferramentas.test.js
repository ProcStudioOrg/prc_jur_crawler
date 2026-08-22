const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const ferramentas = require('../servidor/ferramentas');

let fila;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A', ementa: 'primeira' }, { processo: 'B', ementa: 'segunda' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }),
  });
});

describe('ferramentas', () => {
  it('publica exatamente as tres tools com schema', () => {
    const nomes = ferramentas.definicoes().map((d) => d.name).sort();
    assert.deepStrictEqual(nomes, ['buscar_jurisprudencia', 'ler_resultados', 'listar_tribunais']);
    for (const d of ferramentas.definicoes()) {
      assert.ok(d.description.length > 20, `${d.name} precisa de descricao util`);
      assert.strictEqual(d.input_schema.type, 'object');
    }
  });

  it('nenhuma tool aceita orgao', () => {
    for (const d of ferramentas.definicoes()) {
      assert.ok(!('orgao' in (d.input_schema.properties || {})), `${d.name} nao pode expor orgao`);
    }
  });

  it('listar_tribunais devolve texto com estado', async () => {
    const texto = await ferramentas.executar('listar_tribunais', { segmento: 'superior' }, { fila });
    assert.match(texto, /stf/);
    assert.match(texto, /ok|sem-acesso/);
  });

  it('buscar_jurisprudencia roda ate o fim e informa o job', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    assert.match(texto, /job/i);
    assert.match(texto, /2/);
  });

  it('buscar_jurisprudencia explica o motivo quando o tribunal esta bloqueado', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stj', query: 'x' }, { fila });
    assert.match(texto, /indispon/i);
    assert.ok(texto.length > 60, 'precisa carregar a nota, nao so o rotulo');
  });

  it('ler_resultados pagina', async () => {
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId, offset: 1, limite: 1 }, { fila });
    assert.match(texto, /segunda/);
    assert.ok(!texto.includes('primeira'), 'offset deve pular o primeiro');
  });

  it('tool desconhecida vira erro legivel, nao excecao crua', async () => {
    const texto = await ferramentas.executar('nao_existe', {}, { fila });
    assert.match(texto, /desconhecida/i);
  });
});
