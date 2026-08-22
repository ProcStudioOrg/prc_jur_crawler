const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const openapi = require('../servidor/openapi');

/** Varre os arquivos de rota e extrai (metodo, caminho) de cada roteador.rota(...). */
function rotasRegistradas() {
  const dirs = [path.join(__dirname, '..', 'servidor'), path.join(__dirname, '..', 'servidor', 'rotas')];
  const achadas = [];
  for (const dir of dirs) {
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('.js')) continue;
      const texto = fs.readFileSync(path.join(dir, arquivo), 'utf8');
      for (const m of texto.matchAll(/roteador\.rota\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g)) {
        achadas.push(`${m[1]} ${m[2]}`);
      }
    }
  }
  return [...new Set(achadas)];
}

describe('openapi', () => {
  it('e um documento 3.1 com titulo e versao', () => {
    const d = openapi.documento();
    assert.match(d.openapi, /^3\.1/);
    assert.ok(d.info.title && d.info.version);
  });

  it('documenta TODA rota registrada', () => {
    const d = openapi.documento();
    const documentadas = new Set();
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      for (const metodo of Object.keys(metodos)) documentadas.add(`${metodo.toUpperCase()} ${caminho}`);
    }
    const faltando = rotasRegistradas().filter((r) => !documentadas.has(r));
    assert.deepStrictEqual(faltando, [], `rotas sem documentacao: ${faltando.join(', ')}`);
  });

  it('nao documenta rota que nao existe', () => {
    const d = openapi.documento();
    const registradas = new Set(rotasRegistradas());
    const sobrando = [];
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      for (const metodo of Object.keys(metodos)) {
        const chave = `${metodo.toUpperCase()} ${caminho}`;
        if (!registradas.has(chave)) sobrando.push(chave);
      }
    }
    assert.deepStrictEqual(sobrando, [], `documentadas mas inexistentes: ${sobrando.join(', ')}`);
  });

  it('declara o esquema de autenticacao por chave', () => {
    const d = openapi.documento();
    assert.ok(d.components.securitySchemes, 'precisa declarar securitySchemes');
    const s = Object.values(d.components.securitySchemes)[0];
    assert.strictEqual(s.type, 'http');
    assert.strictEqual(s.scheme, 'bearer');
  });
});
