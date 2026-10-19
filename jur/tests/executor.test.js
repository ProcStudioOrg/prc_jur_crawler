// jur/tests/executor.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const executor = require('../servidor/executor');

const CLI_FALSA = path.join(__dirname, 'fixtures', 'cli-falsa.js');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-exec-')), 'r.json');

describe('executor', () => {
  it('le resultados do arquivo quando a saida e inline', async () => {
    const arquivo = tmp();
    const r = await executor.executar('inline', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.resultados.length, 2);
    assert.strictEqual(r.resultados[0].processo, '1');
  });

  it('le resultados do arquivo quando a saida e so o caminho', async () => {
    const arquivo = tmp();
    const r = await executar_(arquivo, 'arquivo');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.resultados[0].processo, '9');
  });

  it('propaga falha do crawler sem confundir com zero resultados', async () => {
    const r = await executar_(tmp(), 'erro');
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /fora do ar/);
    assert.strictEqual(r.total, 0);
  });

  it('ignora ruido antes do JSON e usa a ultima linha', async () => {
    const r = await executar_(tmp(), 'ruido');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
  });

  it('mata o processo no timeout e reporta erro, nao sucesso vazio', async () => {
    const r = await executar_(tmp(), 'travado', { timeoutMs: 300 });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /timeout/i);
  });

  it('so repassa flags da allowlist, e nunca orgao', async () => {
    const r = await executar_(tmp(), 'eco', {}, {
      query: 'aposentadoria',
      dataInicio: '01/01/2024',
      maxPaginas: 3,
      orgao: 'PRIMEIRA TURMA',      // deve ser IGNORADO (colisao semantica)
      extra: '--rm -rf',             // deve ser IGNORADO
    });
    const args = r.envelope.args;
    assert.ok(args.includes('-q') && args.includes('aposentadoria'));
    assert.ok(args.includes('-di') && args.includes('01/01/2024'));
    assert.ok(args.includes('-m') && args.includes('3'));
    assert.ok(!args.includes('--orgao'), 'orgao jamais pode ser repassado');
    assert.ok(!args.includes('PRIMEIRA TURMA'), 'o VALOR de orgao tambem nao pode vazar');
    assert.ok(!args.includes('--extra') && !args.includes('--rm -rf'),
      'chave fora da allowlist nao pode virar argumento');
  });

  // `relator` entrou na allowlist para o filtro por magistrado existir. Diferente de
  // `orgao` (que fica fora de proposito, porque o mesmo nome significa orgao JULGADOR
  // nos tribunais judiciais e orgao FISCALIZADO nos TCEs), `-r` e a MESMA flag em todos
  // os 64 comandos que a tem — conferido em bin/jur: nenhum registra `-r` para outra coisa.
  it('repassa relator como -r', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', relator: 'GILMAR MENDES' });
    const args = r.envelope.args;
    assert.ok(args.includes('-r'), 'relator precisa virar -r');
    assert.strictEqual(args[args.indexOf('-r') + 1], 'GILMAR MENDES');
  });

  it('relator vazio nao vira flag solta', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', relator: '' });
    assert.ok(!r.envelope.args.includes('-r'),
      '-r sem valor faria a CLI consumir o proximo argumento como se fosse o nome');
  });

  it('cai no scan do envelope quando o arquivo nao existe', async () => {
    const r = await executar_(tmp(), 'so-envelope');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.resultados.length, 1);
    assert.strictEqual(r.resultados[0].processo, '7');
  });

  // Reproduz o cenario real do Achado 4 da revisao: o filho DIRETO (equivalente
  // ao node do bin/jur) morre rapido no SIGTERM (sem handler proprio, acao
  // default) e o `close` dele dispara antes dos 5s — mas o NETO (equivalente
  // ao Chromium), que recebeu o mesmo SIGTERM via broadcast do grupo, ignora e
  // continua vivo. So o SIGKILL de garantia, disparando de forma INCONDICIONAL
  // (nao cancelado pelo `close` do irmao), consegue terminar o neto. Uma
  // versao anterior cancelava esse SIGKILL no `close`, o que deixava o neto
  // orfao para sempre neste cenario — exatamente o que este teste prova que
  // nao acontece mais.
  it('mesmo com o filho direto ja fechado, o SIGKILL de garantia ainda termina o neto que ignora SIGTERM', async (t) => {
    const arquivo = tmp();
    const sentinela = arquivo + '.pronto';
    const netoPidFile = arquivo + '.neto-pid';
    // Mock timers so o setTimeout (relogio do timeout + SIGKILL de garantia
    // dentro de matarGrupo) — nao afeta os processos filho/neto, que rodam
    // separados.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sinais = [];
    const killOriginal = process.kill.bind(process);
    t.mock.method(process, 'kill', (pid, sinal) => { sinais.push([pid, sinal]); return killOriginal(pid, sinal); });
    let pidFilho = null;
    // So os sinais deste teste: SIGKILL de garantia de timeouts anteriores ainda pode disparar.
    const meus = () => sinais.filter(([p, s]) => s !== 0 && Math.abs(p) === pidFilho);

    const promessa = executor.executar('trava-neto-ignora-sigterm', { query: 'x' },
      { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 50, aoIniciar: (pid) => { pidFilho = pid; } });

    // Busy-poll via setImmediate (NAO mockado) ate o NETO sinalizar que ja
    // instalou o handler de SIGTERM — sem isso ha uma corrida contra o boot
    // dos processos filho e neto.
    while (!fs.existsSync(sentinela)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const netoPid = Number(fs.readFileSync(netoPidFile, 'utf8'));

    t.mock.timers.tick(50); // dispara o relogio do timeout -> SIGUSR2 so no filho (janela de captura)
    assert.deepStrictEqual(meus(), [[pidFilho, 'SIGUSR2']],
      'no estouro so o filho recebe SIGUSR2; o grupo ainda nao pode morrer');

    // O filho atende o SIGUSR2 (captura sem pagina) e sai; o `close` chega antes do
    // prazo e o executor mata o grupo NA HORA — o neto ignora o SIGTERM e sobrevive.
    const r = await promessa;
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /timeout/i);
    assert.ok(meus().some(([p, s]) => p === -pidFilho && s === 'SIGTERM'), 'close antes do prazo mata o grupo na hora');

    // Confirma que o cenario e real: o neto sobreviveu ao SIGTERM (senao este
    // teste nao provaria nada sobre a garantia do SIGKILL).
    let netoVivoAntes = true;
    try { process.kill(netoPid, 0); } catch { netoVivoAntes = false; }
    assert.strictEqual(netoVivoAntes, true, 'o neto deveria sobreviver ao SIGTERM ignorado');

    t.mock.timers.tick(5000); // dispara o SIGKILL de garantia dentro de matarGrupo

    // O SIGKILL e real; espera o SO propagar antes de checar (busy-poll leve).
    let netoVivoDepois = true;
    // Cinquenta voltas de setImmediate podem acabar antes de o SO recolher o
    // processo encerrado, especialmente com Chromium concorrente. Aguarda a condição real.
    const limiteReap = Date.now() + 2000;
    while (netoVivoDepois && Date.now() < limiteReap) {
      try { process.kill(netoPid, 0); } catch { netoVivoDepois = false; }
      if (netoVivoDepois) await new Promise((resolve) => setImmediate(resolve));
    }
    assert.strictEqual(netoVivoDepois, false, 'o SIGKILL de garantia deveria ter terminado o neto');
  });

  it('timeout: SIGUSR2 no filho, SIGTERM no grupo so prazoCapturaMs depois, SIGKILL 5 s apos', async (t) => {
    const arquivo = tmp();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sinais = [];
    const killOriginal = process.kill.bind(process);
    t.mock.method(process, 'kill', (pid, sinal) => { sinais.push([pid, sinal]); return killOriginal(pid, sinal); });
    let pid = null;
    const meus = () => sinais.filter(([p]) => Math.abs(p) === pid);
    const promessa = executor.executar('trava-sincrono', { query: 'x' },
      { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 50, prazoCapturaMs: 1000, aoIniciar: (p) => { pid = p; } });
    while (!fs.existsSync(arquivo + '.pronto')) await new Promise((r) => setImmediate(r));

    t.mock.timers.tick(50);
    assert.deepStrictEqual(meus(), [[pid, 'SIGUSR2']]);
    t.mock.timers.tick(999);
    assert.deepStrictEqual(meus(), [[pid, 'SIGUSR2']], 'o grupo nao morre antes do prazo de captura');
    t.mock.timers.tick(1);
    assert.deepStrictEqual(meus(), [[pid, 'SIGUSR2'], [-pid, 'SIGTERM']]);
    const r = await promessa;
    assert.strictEqual(r.erro, 'timeout apos 50ms');
    t.mock.timers.tick(5000);
    assert.deepStrictEqual(meus().at(-1), [-pid, 'SIGKILL']);
  });

  it('timeout sem captura (consulta pura por numero): SIGTERM direto no grupo, sem SIGUSR2', async (t) => {
    const arquivo = tmp();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sinais = [];
    const killOriginal = process.kill.bind(process);
    t.mock.method(process, 'kill', (pid, sinal) => { sinais.push([pid, sinal]); return killOriginal(pid, sinal); });
    let pid = null;
    const meus = () => sinais.filter(([p]) => Math.abs(p) === pid);
    const promessa = executor.executar('trava-sincrono', { numero: '1' },
      { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 50, aoIniciar: (p) => { pid = p; } });
    while (!fs.existsSync(arquivo + '.pronto')) await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(50);
    assert.deepStrictEqual(meus(), [[-pid, 'SIGTERM']]);
    const r = await promessa;
    assert.strictEqual(r.erro, 'timeout apos 50ms');
    t.mock.timers.tick(5000);
  });

  it('sempre carrega o preload e passa JUR_FALHA_DIR ao lado do -o', async () => {
    const dir = path.dirname(tmp()); const arquivo = path.join(dir, 'job1.json');
    const r = await executor.executar('falha-com-captura', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /seletor sumiu/);
    assert.ok(fs.existsSync(path.join(dir, 'job1.falha', 'meta.json')), 'preload gravou meta.json no exit(1)');
  });

  it('timeout: SIGUSR2 deixa o filho capturar e o erro continua timeout', async () => {
    const dir = path.dirname(tmp()); const arquivo = path.join(dir, 'job2.json');
    const r = await executor.executar('travado', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 300 });
    assert.match(r.erro, /^timeout apos 300ms$/);
    assert.ok(fs.existsSync(path.join(dir, 'job2.falha', 'meta.json')));
  });

  it('timeout: filho que nao atende SIGUSR2 morre pelo SIGTERM depois do prazo', async () => {
    const t0 = Date.now();
    const r = await executor.executar('trava-sincrono', { query: 'x' }, { arquivoSaida: tmp(), cliPath: CLI_FALSA, timeoutMs: 200, prazoCapturaMs: 300 });
    assert.match(r.erro, /timeout/);
    assert.ok(Date.now() - t0 < 5000);
  });

  // O executor conhece os params; o argv nao: em trf1/trf3/trf5 `-n` filtra uma busca com -q.
  it('JUR_CAPTURA=0 so na consulta pura por numero; busca com -q e -n captura', async () => {
    const env = async (params) => (await executor.executar('eco-env', params, { arquivoSaida: tmp(), cliPath: CLI_FALSA })).envelope;
    assert.strictEqual((await env({ numero: '5000' })).captura, '0');
    assert.strictEqual((await env({ query: 'x', numero: '5000' })).captura, '1');
    const e = await env({ query: 'x' });
    assert.strictEqual(e.captura, '1');
    assert.match(e.falhaDir, /r\.falha$/);
  });

  it('consulta pura por numero que sai com 1 nao grava captura', async () => {
    const dir = path.dirname(tmp()); const arquivo = path.join(dir, 'job3.json');
    await executor.executar('consulta-ausente', { numero: '1' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
    assert.ok(!fs.existsSync(path.join(dir, 'job3.falha')));
  });

  it('busca com -q e -n que falha grava captura (filtro por numero, nao consulta)', async () => {
    const dir = path.dirname(tmp()); const arquivo = path.join(dir, 'job4.json');
    await executor.executar('falha-com-captura', { query: 'x', numero: '1' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
    assert.ok(fs.existsSync(path.join(dir, 'job4.falha', 'meta.json')));
  });

  it('informa o pid assim que o processo nasce', async () => {
    let visto = null;
    await executor.executar('inline', { query: 'x' },
      { arquivoSaida: tmp(), cliPath: CLI_FALSA, aoIniciar: (pid) => { visto = pid; } });
    assert.strictEqual(typeof visto, 'number');
    assert.ok(visto > 0);
  });

  it('repassa periodo de publicacao como -dpi/-dpf', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', dataPubInicio: '01/01/2024', dataPubFim: '31/01/2024' });
    const args = r.envelope.args;
    assert.ok(args.includes('-dpi') && args[args.indexOf('-dpi') + 1] === '01/01/2024');
    assert.ok(args.includes('-dpf') && args[args.indexOf('-dpf') + 1] === '31/01/2024');
  });

  it('traduz juizados pelo mapa do tribunal, nunca por texto do modelo', async () => {
    const arquivo = tmp();
    const r = await executor.executar('trf4', { query: 'x', juizados: true }, { arquivoSaida: arquivo, cliPath: CLI_FALSA, modo: 'eco' });
    const args = r.envelope.args;
    assert.ok(args.includes('--origem') && args[args.indexOf('--origem') + 1] === 'turmas-recursais');
  });

  it('juizados num tribunal sem recorte falha ANTES de rodar, em vez de buscar sem o filtro', async () => {
    const r = await executor.executar('tjpr', { query: 'x', juizados: true }, { arquivoSaida: tmp(), cliPath: CLI_FALSA, modo: 'eco' });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /juizados/i);
    assert.strictEqual(r.envelope, null, 'a CLI nao pode ter sido chamada');
  });

  // Inteiro teor e SOB DEMANDA (ler_inteiro_teor): com --fetch-inteiro-teor a maioria
  // dos comandos grava so no --output-dir e pula o -o, e o job terminava "concluido"
  // sem arquivo de resultados — que se le como busca vazia.
  it('inteiroTeor nunca vira flag: a busca sempre grava o arquivo de resultados', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', inteiroTeor: true });
    const args = r.envelope.args;
    assert.ok(!args.includes('--fetch-inteiro-teor'));
    assert.ok(!args.includes('--output-dir'));
  });

  // A consulta por numero da CLI nao grava o -o e o envelope nao tem `count`: o
  // caminho generico pegava o primeiro array (`avisos`) e um processo ENCONTRADO
  // virava "0 resultados" — ou um aviso virava julgado.
  it('consulta por numero encontrada vira 1 resultado: o registro da consulta', async () => {
    const r = await executar_(tmp(), 'consulta-encontrada', {}, { numero: '1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.resultados[0].encontrado, true);
    assert.deepStrictEqual(r.resultados[0].documentos, [{ id: 'd1' }]);
  });

  it('consulta por numero nao encontrada e zero, e aviso nao vira julgado', async () => {
    const r = await executar_(tmp(), 'consulta-ausente', {}, { numero: '1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.resultados, []);
  });

  it('consulta por numero com `encontrados` numerico devolve os resultados, nao os avisos, e grava o -o', async () => {
    const arquivo = tmp();
    const r = await executar_(arquivo, 'numero-encontrados', {}, { numero: '1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(r.resultados, [{ processo: 'a1' }, { processo: 'a2' }]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), r.resultados);
  });

  it('consulta por numero com `encontrados` zero e 0 resultados e traz os avisos da CLI', async () => {
    const arquivo = tmp();
    const r = await executar_(arquivo, 'numero-encontrados-vazio', {}, { numero: '1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.resultados, []);
    assert.deepStrictEqual(r.avisos, ['não localizado']);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), []);
  });

  it('consulta por numero com zero traz as `ressalvas` do envelope (tcdf/tcece) como avisos', async () => {
    const r = await executar_(tmp(), 'numero-ressalvas', {}, { numero: '1' });
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.resultados, []);
    assert.ok(r.avisos.includes('Zero. Antes de concluir ausencia: confira o digito verificador.'), JSON.stringify(r.avisos));
  });

  it('`encontrados` maior que os resultados vira aviso de truncamento mesmo sem zero', async () => {
    const r = await executar_(tmp(), 'numero-encontrados-truncado', {}, { numero: '1' });
    assert.strictEqual(r.resultados.length, 10);
    assert.ok(r.avisos.includes('A consulta trouxe 10 de 25 documentos.'), JSON.stringify(r.avisos));
  });

  it('juizados e inteiroTeor falsos nao poem flag nenhuma', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', juizados: false, inteiroTeor: false });
    assert.ok(!r.envelope.args.includes('--origem'));
    assert.ok(!r.envelope.args.includes('--fetch-inteiro-teor'));
  });

  function executar_(arquivo, modo, extras = {}, params = { query: 'x' }) {
    return executor.executar(modo, params, { arquivoSaida: arquivo, cliPath: CLI_FALSA, ...extras });
  }
});

describe('executor.listar — os modos --listar-* da CLI', () => {
  const listar_ = (comando, args, opcoes = {}) =>
    executor.listar(comando, args, { cliPath: CLI_FALSA, ...opcoes });

  it('devolve o envelope da CLI', async () => {
    const r = await listar_('eco-listagem', ['--listar-relatores']);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.dados.relatores, ['FULANO DE TAL']);
  });

  it('manda a flag de listagem e --json, e NADA da busca', async () => {
    const r = await listar_('eco-listagem', ['--listar-filtros', 'magistrados']);
    const args = r.dados.args;
    assert.deepStrictEqual(args, ['--listar-filtros', 'magistrados', '--json'],
      'listagem nao tem -o nem -q: um -o solto criaria arquivo de resultado que nunca existe');
  });

  it('propaga falha da CLI como falha, nunca como listagem vazia', async () => {
    const r = await listar_('erro', ['--listar-filtros']);
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /fora do ar/);
  });

  it('recusa argumento que nao comeca com --listar', async () => {
    const r = await listar_('eco-listagem', ['-q', 'x; rm -rf /']);
    assert.strictEqual(r.ok, false,
      'so os modos --listar-* passam por aqui — este caminho nao pode virar um executor generico');
  });

  it('expira em vez de segurar o chamador para sempre', async () => {
    const r = await listar_('travado', ['--listar-filtros'], { timeoutMs: 300 });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /timeout/i);
  });
});
