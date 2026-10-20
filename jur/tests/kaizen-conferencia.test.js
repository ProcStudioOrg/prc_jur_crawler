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

// ---- rodada de correcao 1: falsos positivos em resultados saudaveis ----
const rel = (nomes) => nomes.map((relator) => ({ relator, numeroProcesso: 'n' }));
test('relator: abreviacao, nome do meio omitido e nome parcial nao sao ignorado', () => {
  for (const [pedido, achado] of [
    ['João P. da Silva', 'JOAO PEDRO DA SILVA'],
    ['João da Silva', 'João Pedro da Silva'],
    ['Luiz Penteado', 'LUIZ FERNANDO WOWK PENTEADO'],
  ]) {
    const [c] = conferir({ relator: pedido }, rel([achado, achado, achado]), { comando: 'trf4' });
    assert.equal(c.veredito, 'ok', pedido);
  }
});
test('relator: sobreposicao parcial nao conta; nome sem nada em comum ainda viola', () => {
  const [c] = conferir({ relator: 'João Pedro Silva' }, rel(['João Carlos Souza', 'João Carlos Souza', 'João Carlos Souza']), { comando: 'trf4' });
  assert.notEqual(c.veredito, 'ignorado');
  assert.equal(conferir({ relator: 'João Silva' }, rel(['Maria Souza', 'Maria Souza', 'Maria Souza']), { comando: 'trf4' })[0].veredito, 'ignorado');
});
test('relator: orgao no lugar da pessoa (tjac/tjal) = sem campo, nao ignorado', () => {
  const r = rel(['Juiz 1 Turma Recursal Unificada', 'Gabinete do Vice-Presidente', 'Juiz 2 Turma Recursal Unificada']);
  const [c] = conferir({ relator: 'Fulano de Tal' }, r, { comando: 'tjac' });
  assert.notEqual(c.veredito, 'ignorado');
  assert.equal(c.veredito, 'nao_verificavel');
});
test('juizados: gabinete, vice-presidencia e vazio nao violam; turma recursal/TNU/colegio recursal ok', () => {
  const orgaos = ['GABINETE DO DESEMBARGADOR X', 'VICE-PRESIDÊNCIA', '', 'Colégio Recursal de Santos', 'TNU'].map((orgaoJulgador) => ({ orgaoJulgador }));
  const [c] = conferir({ juizados: true }, orgaos, { comando: 'trf4' });
  assert.notEqual(c.veredito, 'ignorado');
  assert.equal(c.violam, 0);
  const comuns = ['2ª CÂMARA CÍVEL', 'SEÇÃO CRIMINAL', '6ª TURMA CÍVEL'].map((orgaoJulgador) => ({ orgaoJulgador }));
  assert.equal(conferir({ juizados: true }, comuns, { comando: 'trf4' })[0].veredito, 'ignorado');
});
test('numero: varios numeros no filtro, zeros a esquerda, qualquer alias do resultado', () => {
  const alvo = '5057135-38.2021.4.04.7100';
  assert.notEqual(conferir({ numero: `5000167-52.2021.4.04.7014, ${alvo}` }, [{ numeroProcesso: `${alvo}/TRF4` }], { comando: 'trf4' })[0].veredito, 'ignorado');
  assert.equal(conferir({ numero: `0${alvo}` }, [{ numeroProcesso: alvo }], { comando: 'trf4' })[0].veredito, 'ok');
  // numeroProcesso e um id interno; o CNJ esta em outro alias
  assert.equal(conferir({ numero: alvo }, [{ numeroProcesso: '123', processo: alvo }], { comando: 'trf4' })[0].veredito, 'ok');
});
test('numero: valor que nao tem forma de CNJ e sem campo, nao violacao', () => {
  const [c] = conferir({ numero: '5057135-38.2021.4.04.7100' }, [{ numeroProcesso: '12345/2020' }], { comando: 'trf4' });
  assert.notEqual(c.veredito, 'ignorado');
  assert.equal(c.veredito, 'nao_verificavel');
});
test('publicacao: tolerancia de 4 dias; julgamento segue 1', () => {
  const pub = [1, 2, 3].map(() => ({ dataPublicacao: '01/03/2025' }));
  assert.equal(conferir({ dataPubInicio: '05/03/2025' }, pub, { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ dataPubInicio: '06/03/2025' }, pub, { comando: 'trf4' })[0].veredito, 'ignorado');
});
