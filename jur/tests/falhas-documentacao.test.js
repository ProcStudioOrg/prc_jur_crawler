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
