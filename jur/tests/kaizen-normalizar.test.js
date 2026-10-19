const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ALIASES, CAMPOS_IGNORADOS, parseData, normalizarResultado } = require('../servidor/kaizen/normalizar');

const DIR = path.join(__dirname, 'fixtures', 'kaizen', 'resultados');
const lerFixture = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

test('parseData aceita DD/MM/AAAA e ISO, recusa o resto', () => {
  assert.equal(parseData('05/03/2025'), Date.UTC(2025, 2, 5));
  assert.equal(parseData('2025-03-05T23:30:00-03:00'), Date.UTC(2025, 2, 5));
  assert.equal(parseData('Sessão de 12 de Setembro de 2024'), null);
  assert.equal(parseData(''), null);
  assert.equal(parseData('31/02/2025'), null);
});
test('processo e numeroProcesso dao o mesmo campo', () => {
  assert.equal(normalizarResultado({ processo: '5000167-52.2021.4.04.7014' }).numeroProcesso, '5000167-52.2021.4.04.7014');
  assert.equal(normalizarResultado({ numeroProcesso: '1', processo: '2' }).numeroProcesso, '1');
});
test('juizado booleano vale; texto nao', () => {
  assert.equal(normalizarResultado({ juizado: false }).juizado, false);
  assert.equal(normalizarResultado({ juizado: 'sim' }).juizado, null);
});
test('primeiro alias preenchido vence; vazio cai para o proximo; relatores em array viram texto', () => {
  assert.equal(normalizarResultado({ relator: '', relatorAcordao: 'Fulano' }).relator, 'Fulano');
  assert.equal(normalizarResultado({ relatores: ['A', 'B'] }).relator, 'A; B');
  assert.equal(normalizarResultado({ dataDecisao: '01/02/2024' }).dataJulgamento, Date.UTC(2024, 1, 1));
  assert.deepEqual(normalizarResultado({}), { numeroProcesso: null, dataJulgamento: null, dataPublicacao: null, relator: null, orgaoJulgador: null, juizado: null });
});
test('todo campo de data/relator/processo/orgao/juizado dos fixtures e reconhecido ou ignorado de proposito', () => {
  const conhecidos = new Set(Object.values(ALIASES).flat());
  const faltando = [];
  for (const f of fs.readdirSync(DIR)) for (const r of lerFixture(f).itens) for (const k of Object.keys(r))
    if (/data|relator|processo|orgao|juizado/i.test(k) && !conhecidos.has(k) && !CAMPOS_IGNORADOS.has(k)) faltando.push(`${f}:${k}`);
  assert.deepEqual([...new Set(faltando)], []);
});
test('cada fixture com numero tem numeroProcesso normalizado em todos os itens', () => {
  for (const f of fs.readdirSync(DIR)) {
    const itens = lerFixture(f).itens;
    if (!itens.some((r) => Object.keys(r).some((k) => ALIASES.numeroProcesso.includes(k)))) continue;
    assert.ok(itens.every((r) => normalizarResultado(r).numeroProcesso), f);
  }
});
