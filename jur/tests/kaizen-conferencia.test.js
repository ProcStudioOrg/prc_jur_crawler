const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { conferir, avisoDoFiltro, normalizarNome, FILTROS } = require('../servidor/kaizen/conferencia');
const { parseData } = require('../servidor/kaizen/normalizar');

const DIR = path.join(__dirname, 'fixtures', 'kaizen', 'resultados');
const fx = (nome) => JSON.parse(fs.readFileSync(path.join(DIR, `${nome}.json`), 'utf8'));
const fmt = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const faixa = (itens) => {
  const ts = itens.map((r) => parseData(r.dataJulgamento)).filter((t) => t !== null);
  return [fmt(Math.min(...ts)), fmt(Math.max(...ts))];
};

test('data: resultado saudavel do trf4 nao e marcado (falso positivo)', () => {
  const { itens } = fx('trf4'); const [di, df] = faixa(itens);
  const [c] = conferir({ query: 'x', dataInicio: di, dataFim: df }, itens, { comando: 'trf4' });
  assert.deepEqual([c.filtro, c.veredito], ['periodoJulgamento', 'ok']);
});
test('data: periodo pedido dois anos antes de todos os julgados = ignorado com exemplos', () => {
  const { itens } = fx('trf4');
  const [c] = conferir({ dataInicio: '01/01/2001', dataFim: '31/12/2001' }, itens, { comando: 'trf4' });
  assert.equal(c.veredito, 'ignorado');
  assert.ok(c.exemplos.length > 0 && c.exemplos.length <= 5);
  assert.deepEqual(Object.keys(c.exemplos[0]).sort(), ['dataJulgamento', 'numeroProcesso']);
  assert.match(avisoDoFiltro(c), /^o tribunal parece ter ignorado o filtro de data: \d+ de \d+ resultados fora do período$/);
});
test('tolerancia de 1 dia', () => {
  const r = [1, 2, 3].map(() => ({ dataJulgamento: '01/03/2025', numeroProcesso: 'n' }));
  assert.equal(conferir({ dataInicio: '02/03/2025' }, r, { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ dataInicio: '03/03/2025' }, r, { comando: 'trf4' })[0].veredito, 'ignorado');
});
test('menos de 3 com data parseavel = nao_verificavel (tcepa, Review Focus 3)', () => {
  assert.equal(conferir({ dataInicio: '01/01/2001', dataFim: '31/12/2001' }, fx('tcepa').itens, { comando: 'tcepa' })[0].veredito, 'nao_verificavel');
  assert.equal(conferir({ dataInicio: '01/01/2001' }, fx('trf4').itens.slice(0, 2), { comando: 'trf4' })[0].veredito, 'nao_verificavel');
});
test('exatamente 50% violando ainda e ok', () => {
  const r = [{ dataJulgamento: '01/01/2001' }, { dataJulgamento: '01/01/2001' }, { dataJulgamento: '05/03/2025' }, { dataJulgamento: '05/03/2025' }];
  assert.equal(conferir({ dataInicio: '01/03/2025', dataFim: '31/03/2025' }, r, { comando: 'trf4' })[0].veredito, 'ok');
});
test('data de publicacao usa dataPublicacao', () => {
  const r = [1, 2, 3].map(() => ({ dataPublicacao: '01/01/2001', numeroProcesso: 'n' }));
  const [c] = conferir({ dataPubInicio: '01/01/2025' }, r, { comando: 'trf4' });
  assert.equal(c.filtro, 'periodoPublicacao');
  assert.equal(c.veredito, 'ignorado');
  assert.match(avisoDoFiltro(c), /filtro de data de publicação: 3 de 3 resultados fora do período$/);
});
test('magistrado: nome com Des. e sem acento casa; outro nome = ignorado; codigo = nao_verificavel', () => {
  const { itens } = fx('trf4'); const nome = itens.find((r) => r.relator).relator;
  const mesmos = itens.filter((r) => r.relator === nome);
  assert.equal(conferir({ relator: `Des. ${nome.normalize('NFD').replace(/\p{M}/gu, '')}` }, mesmos, { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ relator: 'Fulano Inexistente da Silva' }, itens, { comando: 'trf4' })[0].veredito, 'ignorado');
  assert.equal(conferir({ relator: '12345' }, fx('tjpb').itens, { comando: 'tjpb' })[0].veredito, 'nao_verificavel');
});
test('normalizarNome', () => {
  assert.equal(normalizarNome('Des.  João  D\'Ávila, Juíza Convocada'), 'joao d avila');
  assert.equal(normalizarNome('Ministro Luís Roberto Barroso'), 'luis roberto barroso');
});
test('juizados: booleano juizado:false do tjdft vence o texto do orgao', () => {
  assert.equal(conferir({ juizados: true }, fx('tjdft').itens, { comando: 'tjdft' })[0].veredito, 'ignorado');
  const tr = [1, 2, 3].map(() => ({ orgaoJulgador: '3ª TURMA RECURSAL DO PR' }));
  assert.equal(conferir({ juizados: true }, tr, { comando: 'trf4' })[0].veredito, 'ok');
});
test('numero: sufixo /TRF4 e mascara ignorados; basta 1 resultado', () => {
  assert.equal(conferir({ numero: '50571353820214047100' }, [{ numeroProcesso: '5057135-38.2021.4.04.7100/TRF4' }], { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ numero: '5057135-38.2021.4.04.7100' }, [{ processo: '5000167-52.2021.4.04.7014' }], { comando: 'trf4' })[0].veredito, 'ignorado');
});
test('sem filtro pedido, sem item; juizados:false nao confere', () => {
  assert.deepEqual(conferir({ query: 'x', juizados: false }, fx('trf4').itens, { comando: 'trf4' }), []);
  assert.deepEqual(FILTROS, ['periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'numero']);
});
test('falso positivo: periodo cobrindo a faixa real de cada fixture nunca e ignorado', () => {
  for (const f of fs.readdirSync(DIR)) {
    const { itens } = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!itens.some((r) => parseData(r.dataJulgamento) !== null)) continue;
    const [di, df] = faixa(itens);
    const [c] = conferir({ dataInicio: di, dataFim: df }, itens, { comando: f.replace('.json', '') });
    assert.notEqual(c.veredito, 'ignorado', f);
  }
});
