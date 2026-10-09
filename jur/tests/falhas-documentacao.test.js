const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const JUR = join(__dirname, '..');
const FALHAS = join(JUR, 'cobertura', 'CLAUDE-FALHAS.md');
const COBERTURA_LEGADA = join(JUR, 'cobertura', 'CLAUDE-COBERTURA.md');

test('gera uma visão humana somente com comandos fora do caminho normal', () => {
  execFileSync(process.execPath, ['cobertura/build.js'], { cwd: JUR });

  assert.equal(existsSync(FALHAS), true, 'CLAUDE-FALHAS.md deve ser gerado');
  const markdown = readFileSync(FALHAS, 'utf8');

  assert.match(markdown, /\| STJ \| sem-acesso \| `jur stj` \|/);
  assert.match(markdown, /\| TJSP \| instavel \| `jur tjsp` \|/);
  assert.doesNotMatch(markdown, /\| TJPR \|/);
  assert.equal(
    existsSync(COBERTURA_LEGADA),
    false,
    'a matriz humana positiva não deve continuar existindo',
  );
});

// Este teste roda build.js em paralelo com outros arquivos de teste que fazem
// `require` de tribunais.json. Escrita nao atomica deixava uma janela com o arquivo
// truncado, e o outro processo quebrava com JSON invalido — o teste instavel da suite.
test('build.js troca os arquivos atomicamente: um leitor nunca ve JSON pela metade', async () => {
  const { spawn } = require('node:child_process');
  const { readdirSync } = require('node:fs');
  const JSON_TRIBUNAIS = join(JUR, 'cobertura', 'tribunais.json');
  let leituras = 0;
  const falhas = [];
  for (let rodada = 0; rodada < 20; rodada++) {
    const filho = spawn(process.execPath, ['cobertura/build.js'], { cwd: JUR, stdio: 'ignore' });
    let terminou = false;
    filho.on('exit', () => { terminou = true; });
    while (!terminou) {
      try { JSON.parse(readFileSync(JSON_TRIBUNAIS, 'utf8')); } catch (e) { falhas.push(e.message); }
      leituras++;
      await new Promise((r) => setImmediate(r));
    }
  }
  assert.ok(leituras > 0);
  assert.deepEqual(falhas, [], `${falhas.length} leituras quebradas em ${leituras}`);
  assert.deepEqual(readdirSync(join(JUR, 'cobertura')).filter((n) => n.includes('.tmp-')), [], 'sem temporario esquecido');
});
