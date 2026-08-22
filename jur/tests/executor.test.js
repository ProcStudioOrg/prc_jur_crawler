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

    const promessa = executor.executar('trava-neto-ignora-sigterm', { query: 'x' },
      { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 50 });

    // Busy-poll via setImmediate (NAO mockado) ate o NETO sinalizar que ja
    // instalou o handler de SIGTERM — sem isso ha uma corrida contra o boot
    // dos processos filho e neto.
    while (!fs.existsSync(sentinela)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const netoPid = Number(fs.readFileSync(netoPidFile, 'utf8'));

    t.mock.timers.tick(50); // dispara o relogio do timeout -> matarGrupo -> SIGTERM no grupo inteiro

    // Espera o `close' real do filho DIRETO (que morre rapido, sem handler) —
    // isso resolve a promessa antes do SIGKILL de garantia disparar.
    const r = await promessa;
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /timeout/i);

    // Confirma que o cenario e real: o neto sobreviveu ao SIGTERM (senao este
    // teste nao provaria nada sobre a garantia do SIGKILL).
    let netoVivoAntes = true;
    try { process.kill(netoPid, 0); } catch { netoVivoAntes = false; }
    assert.strictEqual(netoVivoAntes, true, 'o neto deveria sobreviver ao SIGTERM ignorado');

    t.mock.timers.tick(5000); // dispara o SIGKILL de garantia dentro de matarGrupo

    // O SIGKILL e real; espera o SO propagar antes de checar (busy-poll leve).
    let netoVivoDepois = true;
    for (let tentativas = 0; tentativas < 50 && netoVivoDepois; tentativas++) {
      try { process.kill(netoPid, 0); } catch { netoVivoDepois = false; }
      if (netoVivoDepois) await new Promise((resolve) => setImmediate(resolve));
    }
    assert.strictEqual(netoVivoDepois, false, 'o SIGKILL de garantia deveria ter terminado o neto');
  });

  it('informa o pid assim que o processo nasce', async () => {
    let visto = null;
    await executor.executar('inline', { query: 'x' },
      { arquivoSaida: tmp(), cliPath: CLI_FALSA, aoIniciar: (pid) => { visto = pid; } });
    assert.strictEqual(typeof visto, 'number');
    assert.ok(visto > 0);
  });

  function executar_(arquivo, modo, extras = {}, params = { query: 'x' }) {
    return executor.executar(modo, params, { arquivoSaida: arquivo, cliPath: CLI_FALSA, ...extras });
  }
});
