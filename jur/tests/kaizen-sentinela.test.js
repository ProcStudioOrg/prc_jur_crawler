// jur/tests/kaizen-sentinela.test.js
// Nenhuma busca real: executor falso, ou o executor de verdade com a CLI falsa.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carregarCasos, selecionarCasos, avaliarCaso, rodarSentinela, ligarSentinela } = require('../servidor/kaizen/sentinela');
const capacidades = require('../servidor/capacidades');
const executor = require('../servidor/executor');
const { executarNaRota } = require('../servidor/escopo');
const { tribunais } = require('../cobertura/tribunais.json');

const CLI_FALSA = path.join(__dirname, 'fixtures', 'cli-falsa.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jur-sentinela-'));

const caso = (tribunal, capacidade = 'periodoJulgamento') => ({
  tribunal, capacidade,
  params: capacidade === 'numero' ? { numero: '5057135-38.2021.4.04.7100' } : { query: 'dano moral', dataInicio: '01/08/2026', dataFim: '31/08/2026' },
  espera: capacidade === 'numero' ? { encontrado: true } : { minimo: 1 },
});
const okCom = (n, dataJulgamento = '15/08/2026') => ({
  ok: true, total: n, erro: null,
  resultados: Array.from({ length: n }, (_, i) => ({ numeroProcesso: `5057135-38.2021.4.04.71${String(i).padStart(2, '0')}`, dataJulgamento })),
});
const falsoQueFalhaEm = (alvo) => async (tribunal) => (tribunal === alvo
  ? { ok: false, total: 0, resultados: [], erro: 'page.waitForSelector: Timeout 30000ms exceeded.' }
  : okCom(5));

let espiao;
beforeEach(() => {
  espiao = {
    sentinela: [], resumos: [],
    async registrarSentinela(d) { this.sentinela.push(d); },
    enviarResumo(r) { this.resumos.push(r); },
  };
});

test('casos.json: tribunal ok, canario de familia, capacidade que funciona, sem codigo', () => {
  const casos = carregarCasos();
  assert.ok(casos.length > 0);
  for (const c of casos) {
    const t = tribunais.find((x) => x.jurisprudencia.comando === c.tribunal);
    assert.ok(t, c.tribunal);
    assert.equal(t.jurisprudencia.status, 'ok', c.tribunal);
    assert.ok(!t.jurisprudencia.familia || t.jurisprudencia.canario, `${c.tribunal} nao e canario`);
    assert.equal(capacidades.obter(c.tribunal).funcionalidades[c.capacidade].estado, 'funciona', `${c.tribunal}/${c.capacidade}`);
    assert.ok(c.espera && (c.espera.minimo >= 1 || c.espera.encontrado === true), `${c.tribunal}/${c.capacidade} sem espera`);
  }
  assert.ok(casos.some((c) => c.tribunal === 'trf4' && c.params.numero === '5057135-38.2021.4.04.7100'));
  const chaves = casos.map((c) => `${c.tribunal}/${c.capacidade}`);
  assert.equal(new Set(chaves).size, chaves.length, 'um caso por tribunal x capacidade');
});

test('carregarCasos ignora _pendentes e recusa capacidade desconhecida', () => {
  const dir = tmp();
  const arq = path.join(dir, 'casos.json');
  fs.writeFileSync(arq, JSON.stringify({ _pendentes: { tjxx: 'motivo' }, casos: [caso('trf4')] }));
  assert.deepEqual(carregarCasos(arq).map((c) => c.tribunal), ['trf4']);
  fs.writeFileSync(arq, JSON.stringify({ casos: [{ ...caso('trf4'), capacidade: 'inexistente' }] }));
  assert.throws(() => carregarCasos(arq), /inexistente/);
});

test('zero onde se espera >=1 e vazio_suspeito', () => {
  assert.deepEqual(avaliarCaso({ capacidade: 'periodoJulgamento', espera: { minimo: 1 }, params: {} }, { ok: true, resultados: [] }).classe, 'vazio_suspeito');
  assert.equal(avaliarCaso(caso('trf4', 'numero'), { ok: true, resultados: [] }).classe, 'vazio_suspeito');
});

test('avaliarCaso: erro classificado, filtro ignorado, nao verificavel e ok', () => {
  const erro = avaliarCaso(caso('trf4'), { ok: false, resultados: [], erro: 'page.waitForSelector: Timeout 30000ms exceeded.' });
  assert.deepEqual([erro.status, erro.classe], ['falha', 'seletor']);
  const fora = avaliarCaso(caso('trf4'), okCom(5, '10/10/2026'));
  assert.deepEqual([fora.status, fora.classe], ['falha', 'filtro_ignorado:periodoJulgamento']);
  assert.ok(fora.conferencia.some((x) => x.veredito === 'ignorado'));
  const pouco = avaliarCaso(caso('trf4'), okCom(1));
  assert.deepEqual([pouco.status, pouco.classe], ['nao_verificavel', null]);
  const bom = avaliarCaso(caso('trf4'), okCom(5));
  assert.deepEqual([bom.status, bom.classe], ['ok', null]);
  const numero = avaliarCaso(caso('trf4', 'numero'), { ok: true, resultados: [{ numeroProcesso: '5057135-38.2021.4.04.7100/TRF4' }] });
  assert.equal(numero.status, 'ok');
});

test('rodada: falha vai ao kaizen, resumo no fim, remotos com teto', async () => {
  const casos = [caso('trf4'), caso('trf3'), caso('trf3', 'numero'), caso('tjpr')];
  const r = await rodarSentinela({ casos: selecionarCasos(casos, { remotoPermitido: true }), executarFn: falsoQueFalhaEm('tjpr'), kaizen: espiao, maxRemoto: 1, esperaEntreMs: 0, home: tmp() });
  assert.deepEqual([r.rodados, r.ok, r.falhas, r.pulados], [3, 2, 1, 1]);
  assert.equal(espiao.sentinela.length, 1);
  assert.equal(espiao.sentinela[0].caso.tribunal, 'tjpr');
  assert.equal(espiao.sentinela[0].avaliacao.classe, 'seletor');
  assert.match(espiao.sentinela[0].arquivo, /sentinela-.+-tjpr-periodoJulgamento\.json$/);
  assert.deepEqual(espiao.resumos, [{ rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 }]);
  assert.deepEqual(r.itens.map((i) => [i.tribunal, i.status]), [['trf4', 'ok'], ['trf3', 'ok'], ['trf3', 'pulado'], ['tjpr', 'falha']]);
});

test('sem remoto permitido, trf3 fica fora; pedidos filtram por tribunal', () => {
  assert.deepEqual(selecionarCasos([caso('trf3'), caso('trf4')], { remotoPermitido: false }).map((c) => c.tribunal), ['trf4']);
  assert.deepEqual(selecionarCasos([caso('trf3'), caso('trf4'), caso('tjpr')], { pedidos: ['tjpr', 'trf3'], remotoPermitido: true }).map((c) => c.tribunal), ['trf3', 'tjpr']);
});

test('espera a busca do usuario terminar antes do proximo caso', async () => {
  let livres = 0; const ocupado = () => livres++ < 3;
  const inicio = [];
  await rodarSentinela({ casos: [caso('trf4')], executarFn: async () => { inicio.push(livres); return okCom(1); }, kaizen: espiao, ocupado, esperaOcupadoMs: 1, esperaEntreMs: 0, home: tmp() });
  assert.ok(inicio[0] >= 3);
});

test('servidor ocupado alem do teto: o caso e pulado, sem rodar', async () => {
  let chamadas = 0;
  const r = await rodarSentinela({ casos: [caso('trf4'), caso('tjpr')], executarFn: async () => { chamadas++; return okCom(5); }, kaizen: espiao, ocupado: () => true, esperaOcupadoMs: 1, tetoOcupadoMs: 5, esperaEntreMs: 0, home: tmp() });
  assert.equal(chamadas, 0);
  assert.deepEqual([r.rodados, r.pulados], [0, 2]);
  assert.deepEqual(espiao.resumos, [{ rodados: 0, ok: 0, falhas: 0, nao_verificaveis: 0 }]);
});

test('casos espacados por esperaEntreMs; executor que lanca vira falha; enviar=false nao manda resumo', async () => {
  const inicios = [];
  const r = await rodarSentinela({
    casos: [caso('trf4'), caso('tjpr')], kaizen: espiao, esperaEntreMs: 60, home: tmp(), enviar: false,
    executarFn: async (t) => { inicios.push(Date.now()); if (t === 'tjpr') throw new Error('Timeout 30000ms exceeded'); return okCom(5); },
  });
  assert.ok(inicios[1] - inicios[0] >= 55, `espacamento ${inicios[1] - inicios[0]}ms`);
  assert.deepEqual([r.ok, r.falhas], [1, 1]);
  assert.equal(espiao.sentinela[0].avaliacao.classe, 'timeout');
  assert.deepEqual(espiao.resumos, []);
});

test('executor de verdade com a CLI falsa: arquivo na home da sentinela e erro classificado', async () => {
  const home = tmp();
  const opcoes = [];
  const executarFn = (modo) => (c, p, e) => { opcoes.push(e); return executarNaRota(executor.executar, c, p, { ...e, cliPath: CLI_FALSA, modo }, home); };
  const falha = await rodarSentinela({ casos: [caso('tjpr')], executarFn: executarFn('erro'), kaizen: espiao, esperaEntreMs: 0, home });
  assert.equal(falha.falhas, 1);
  assert.equal(espiao.sentinela[0].r.erro, 'tribunal fora do ar');
  assert.ok(opcoes[0].arquivoSaida.startsWith(path.join(home, 'resultados') + path.sep));
  assert.equal(opcoes[0].timeoutMs, 180e3);
  const vazio = await rodarSentinela({ casos: [caso('tjpr')], executarFn: executarFn('arquivo'), kaizen: espiao, esperaEntreMs: 0, home });
  // um resultado sem data: busca funcionou, filtro nao da para conferir
  assert.equal(vazio.nao_verificaveis, 1);
  assert.deepEqual(fs.readdirSync(path.join(home, 'resultados')), [], 'resultado da sentinela nao acumula');
});

test('ligarSentinela: desligada por padrao; ligada usa o kaizen e o ocupado da aplicacao', async () => {
  const dir = tmp();
  const pedidos = [];
  const agenda = { iniciarAgenda: (o) => { pedidos.push(o); return { parar() {} }; } };
  const app = { kaizen: espiao, ocupado: () => true };
  assert.equal(ligarSentinela({ app, dir, env: {}, agenda }), null);
  assert.equal(pedidos.length, 0);
  assert.ok(ligarSentinela({ app, dir, versaoNova: true, env: { JUR_SENTINELA: '1' }, agenda }));
  assert.equal(pedidos[0].versaoNova, true);
  assert.ok(fs.existsSync(path.join(dir, 'sentinela', 'resultados')));
});
