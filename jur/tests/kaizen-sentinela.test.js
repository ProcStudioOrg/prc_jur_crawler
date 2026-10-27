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
// Remoto avisa o fornecedor como executarNaRota faz: é isso que o teto de sessões conta.
const falsoQueFalhaEm = (alvo) => async (tribunal, params, extra) => {
  if (tribunal === 'trf3') extra.aoNavegador({ fornecedor: 'kernel', nome: 'Kernel' });
  return tribunal === alvo
    ? { ok: false, total: 0, resultados: [], erro: 'page.waitForSelector: Timeout 30000ms exceeded.' }
    : okCom(5);
};

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
    casos: [caso('trf4'), caso('tjpr')], kaizen: espiao, esperaEntreMs: 60, esperaRetentativaMs: 0, home: tmp(), enviar: false,
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

test('ligarSentinela: desligada por padrao; ligada usa o kaizen e o ocupado da aplicacao', () => {
  const dir = tmp();
  const pedidos = [];
  const agenda = { iniciarAgenda: (o) => { pedidos.push(o); return { parar() {} }; } };
  const app = { kaizen: espiao, ocupado: () => true };
  assert.equal(ligarSentinela({ app, dir, versao: '1.1.0', env: {}, agenda }), null);
  assert.equal(pedidos.length, 0);
  assert.ok(ligarSentinela({ app, dir, versao: '1.1.0', revisao: 'abc1234', env: { JUR_SENTINELA: '1' }, agenda }));
  assert.equal(pedidos[0].versaoNova, true);
  assert.ok(fs.existsSync(path.join(dir, 'sentinela', 'resultados')));
});

test('dois boots da mesma versao: so o primeiro tem rodada remota de boot, com ou sem FFD', () => {
  const dir = tmp();
  const pedidos = [];
  const agenda = { iniciarAgenda: (o) => { pedidos.push(o); return { parar() {} }; } };
  const ligar = (revisao) => ligarSentinela({ app: { kaizen: espiao, ocupado: () => false }, dir, versao: '1.1.0', revisao, env: { JUR_SENTINELA: '1' }, agenda });
  ligar('abc1234');
  assert.equal(pedidos[0].versaoNova, true);
  pedidos[0].aoBoot(); // a rodada de boot começou
  ligar('abc1234'); // restart (OOM, reboot): mesma versão
  assert.equal(pedidos[1].versaoNova, false);
  ligar('def5678'); // deploy novo
  assert.equal(pedidos[2].versaoNova, true);
});

test('prazo da rodada: o que sobra depois dele e pulado', async () => {
  let chamadas = 0;
  const r = await rodarSentinela({
    casos: [caso('trf4'), caso('tjpr'), caso('tjgo')], kaizen: espiao, esperaEntreMs: 0, home: tmp(), prazoMs: 20,
    executarFn: async () => { chamadas++; await new Promise((ok) => setTimeout(ok, 40)); return okCom(5); },
  });
  assert.equal(chamadas, 1);
  assert.deepEqual([r.rodados, r.pulados], [1, 2]);
  assert.match(r.itens[2].detalhe, /prazo/);
});

test('ocupado alem do teto pula o resto da rodada sem esperar de novo', async () => {
  let consultas = 0;
  const r = await rodarSentinela({
    casos: [caso('trf4'), caso('tjpr'), caso('tjgo')], executarFn: async () => okCom(5), kaizen: espiao, esperaEntreMs: 0, home: tmp(),
    ocupado: () => { consultas++; return true; }, esperaOcupadoMs: 1, tetoOcupadoMs: 5,
  });
  assert.equal(r.pulados, 3);
  const depoisDoPrimeiro = consultas;
  assert.ok(depoisDoPrimeiro >= 2);
  assert.ok(r.itens.every((i) => /ocupado/.test(i.detalhe)));
});

test('teto remoto conta sessoes abertas, nao casos (Kernel + Steel de reserva = 2)', async () => {
  let chamadas = 0;
  const executarFn = async (t, p, extra) => {
    chamadas++;
    extra.aoNavegador({ fornecedor: 'kernel', nome: 'Kernel' });
    extra.aoNavegador({ fornecedor: 'steel', nome: 'Steel' });
    return okCom(5);
  };
  const r = await rodarSentinela({ casos: [caso('trf3'), caso('trf3', 'numero'), caso('trf4')], executarFn, kaizen: espiao, maxRemoto: 2, esperaEntreMs: 0, home: tmp() });
  assert.equal(chamadas, 2, 'trf3 e trf4; o segundo trf3 fica fora');
  assert.deepEqual(r.itens.map((i) => i.status), ['ok', 'pulado', 'ok']);
  assert.match(r.itens[1].detalhe, /sessões remotas/);
});

test('vazio_suspeito ou timeout: tenta de novo uma vez antes de acusar', async () => {
  let n = 0;
  const volta = await rodarSentinela({
    casos: [caso('trf4')], kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 1, home: tmp(),
    executarFn: async () => (n++ === 0 ? okCom(0) : okCom(5)),
  });
  assert.deepEqual([n, volta.ok, volta.falhas], [2, 1, 0]);
  assert.equal(espiao.sentinela.length, 0);

  let m = 0;
  const persiste = await rodarSentinela({
    casos: [caso('trf4')], kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 1, home: tmp(),
    executarFn: async () => { m++; return { ok: false, resultados: [], erro: `timeout apos 180000ms` }; },
  });
  assert.deepEqual([m, persiste.falhas, persiste.rodados], [2, 1, 1]);
  assert.equal(espiao.sentinela.length, 1);
  assert.equal(espiao.sentinela[0].avaliacao.classe, 'timeout');

  let k = 0;
  await rodarSentinela({ casos: [caso('tjpr')], kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 1, home: tmp(), executarFn: async (t, p, e) => { k++; return falsoQueFalhaEm('tjpr')(t, p, e); } });
  assert.equal(k, 1, 'seletor quebrado nao e duvida: sem nova tentativa');
});

test('retentativa que nao chega a rodar: o card leva o arquivo e a captura da primeira', async () => {
  const home = tmp();
  let n = 0; let livre = true;
  const executarFn = async (t, p, e) => {
    n++;
    // o preload deixa a captura ao lado do arquivo quando o crawler falha
    const falha = e.arquivoSaida.replace(/\.json$/, '.falha');
    fs.mkdirSync(falha, { recursive: true });
    fs.writeFileSync(path.join(falha, 'meta.json'), '{}');
    livre = false; // um usuario comeca a buscar durante a espera
    return { ok: false, resultados: [], erro: 'timeout apos 180000ms' };
  };
  let capturaExistia = null;
  espiao.registrarSentinela = async function (d) { this.sentinela.push(d); capturaExistia = fs.existsSync(path.join(d.arquivo.replace(/\.json$/, '.falha'), 'meta.json')); };
  const r = await rodarSentinela({
    casos: [caso('trf4')], executarFn, kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 1, home,
    ocupado: () => !livre, esperaOcupadoMs: 1, tetoOcupadoMs: 5,
  });
  assert.equal(n, 1, 'a segunda tentativa nao rodou');
  assert.equal(r.falhas, 1);
  assert.equal(capturaExistia, true);
  assert.deepEqual(fs.readdirSync(path.join(home, 'resultados')), [], 'limpo depois do registro');
});

test('retentativa que roda: o card leva a segunda tentativa e a primeira e limpa', async () => {
  const home = tmp();
  const arquivos = [];
  const r = await rodarSentinela({
    casos: [caso('trf4')], kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 1, home,
    executarFn: async (t, p, e) => { arquivos.push(e.arquivoSaida); fs.writeFileSync(e.arquivoSaida, '[]'); return okCom(0); },
  });
  assert.equal(arquivos.length, 2);
  assert.equal(r.falhas, 1);
  assert.equal(espiao.sentinela[0].arquivo, arquivos[1]);
  assert.deepEqual(fs.readdirSync(path.join(home, 'resultados')), []);
});

test('disjuntor: duas duvidas seguidas no mesmo tribunal pulam o resto dele', async () => {
  const chamados = [];
  const casos = [caso('tjpr'), caso('tjpr', 'periodoPublicacao'), caso('tjpr', 'numero'), caso('trf4')];
  const r = await rodarSentinela({
    casos, kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 0, home: tmp(),
    executarFn: async (t, p) => { chamados.push(t); return t === 'tjpr' ? { ok: false, resultados: [], erro: 'timeout apos 180000ms' } : okCom(5); },
  });
  assert.deepEqual(r.itens.map((i) => [i.tribunal, i.capacidade, i.status]), [
    ['tjpr', 'periodoJulgamento', 'falha'], ['tjpr', 'periodoPublicacao', 'falha'], ['tjpr', 'numero', 'pulado'], ['trf4', 'periodoJulgamento', 'ok'],
  ]);
  assert.deepEqual([r.falhas, r.pulados, r.ok], [2, 1, 1]);
  assert.equal(chamados.filter((t) => t === 'tjpr').length, 4, 'duas tentativas em cada um dos dois casos');
});

test('disjuntor so conta duvidas seguidas: um ok no meio zera', async () => {
  let i = 0;
  const casos = [caso('tjpr'), caso('tjpr', 'periodoPublicacao'), caso('tjpr', 'numero')];
  const r = await rodarSentinela({
    casos, kaizen: espiao, esperaEntreMs: 0, esperaRetentativaMs: 0, home: tmp(),
    // caso 1: timeout x2; caso 2: ok; caso 3: timeout x2
    executarFn: async () => { i++; return i === 3 ? { ok: true, resultados: [{ numeroProcesso: '5057135-38.2021.4.04.7100', dataPublicacao: '15/08/2026' }] } : { ok: false, resultados: [], erro: 'timeout apos 1ms' }; },
  });
  assert.equal(r.pulados, 0);
  assert.equal(r.rodados, 3);
});

test('rodada: caso ok manda os numeros como alvos (banco de processos); falha nao manda; enviar=false nao manda', async () => {
  const alvos = [];
  const espiaoComAlvos = { ...espiao, registrarAlvos(d) { alvos.push(d); return true; } };
  // numero: o executor devolve o proprio numero pedido (conferencia ok); periodoJulgamento: okCom(5)
  const exec = async (tribunal, params, extra) => (params.numero
    ? { ok: true, total: 1, erro: null, resultados: [{ numeroProcesso: params.numero, dataJulgamento: '15/08/2026' }] }
    : falsoQueFalhaEm('tjpr')(tribunal, params, extra));
  await rodarSentinela({ casos: [caso('trf4'), caso('tjpr'), caso('trf4', 'numero')], executarFn: exec, kaizen: espiaoComAlvos, esperaEntreMs: 0, home: tmp() });
  assert.deepEqual(alvos.map((a) => [a.origem, a.tribunal, a.capacidade, a.resultados.length]), [['sentinela', 'trf4', 'periodoJulgamento', 5], ['sentinela', 'trf4', 'numero', 1]]);
  assert.equal(alvos[1].params.numero, '5057135-38.2021.4.04.7100');

  alvos.length = 0;
  await rodarSentinela({ casos: [caso('trf4')], executarFn: async () => okCom(3), kaizen: espiaoComAlvos, esperaEntreMs: 0, home: tmp(), enviar: false });
  assert.equal(alvos.length, 0, 'sem --enviar nada sai da maquina');
  // kaizen antigo sem registrarAlvos nao quebra a rodada
  const r = await rodarSentinela({ casos: [caso('trf4')], executarFn: async () => okCom(3), kaizen: espiao, esperaEntreMs: 0, home: tmp() });
  assert.equal(r.ok, 1);
});
