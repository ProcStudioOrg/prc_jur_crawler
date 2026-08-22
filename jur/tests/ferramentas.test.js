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

  it('os tres schemas declaram additionalProperties: false', () => {
    for (const d of ferramentas.definicoes()) {
      assert.strictEqual(d.input_schema.additionalProperties, false, `${d.name} precisa fechar o schema`);
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

  // Important 1 (revisao da Task 9): sem validar maxPaginas, um valor invalido virava
  // literalmente `-m abc`/`-m -5` na CLI e o crawler processava 0 paginas em silencio —
  // o mesmo bug que o commit 22afab6 corrigiu na rota HTTP, so que do lado da tool.
  it('buscar_jurisprudencia recusa maxPaginas invalido (nao-numerico, negativo, acima do teto) sem enfileirar', async () => {
    const antes = fila.listar(100).length;
    for (const maxPaginas of ['abc', -5, 99999]) {
      const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', maxPaginas }, { fila });
      assert.match(texto, /maxPaginas invalido/i, `maxPaginas=${maxPaginas} devia ser recusado`);
      assert.ok(!/^job /.test(texto), `maxPaginas=${maxPaginas} nao devia virar job`);
    }
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job devia ter sido enfileirado');
  });

  it('buscar_jurisprudencia aceita maxPaginas ausente ou dentro do teto', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', maxPaginas: 5 }, { fila });
    assert.match(texto, /job/i);
  });

  // Important 2 (revisao da Task 9): sem clamp, offset negativo caia na semantica de
  // indice negativo do Array.slice — o mesmo bug que o fix da Task 8 corrigiu na rota
  // HTTP (ver "ninguem espera isso de uma API de paginacao" em rotas/buscas.js).
  it('ler_resultados clampa offset e limite negativos em vez de usar indice negativo do slice', async () => {
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId, offset: -4, limite: 2 }, { fila });
    // Com o bug, offset=-4/limite=2 cai em Array.slice(-4, -2) e rotula itens com
    // indice negativo ("Mostrando -3–-2 de 2"); clampado, offset vira 0 e devolve os
    // dois itens da fixture, do inicio.
    assert.match(texto, /primeira/);
    assert.match(texto, /segunda/);
    assert.ok(!/-\d/.test(texto), `nao pode rotular item com indice negativo: ${texto}`);
  });

  it('tool desconhecida vira erro legivel, nao excecao crua', async () => {
    const texto = await ferramentas.executar('nao_existe', {}, { fila });
    assert.match(texto, /desconhecida/i);
  });
});
