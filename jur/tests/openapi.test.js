const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const openapi = require('../servidor/openapi');

/**
 * Varre os arquivos de rota e extrai (metodo, caminho) de cada roteador.rota(...).
 *
 * Normaliza parametro de caminho Express-style (`:id`) para o template OpenAPI
 * (`{id}`) ANTES de comparar. O codigo registra rotas com `:id` (e o roteador em
 * servidor/http.js entende so essa sintaxe); o documento OpenAPI usa `{id}`, porque
 * e o UNICO formato de parametro de caminho que a especificacao 3.1 reconhece —
 * `:id` e segmento literal para qualquer ferramenta que leia o documento (Swagger UI,
 * Redoc, openapi-generator, Postman, linters). A garantia que importa aqui —
 * rota registrada e documentada em sincronia — nao depende de qual sintaxe
 * representa o parametro, entao a normalizacao mora na extracao, nao no documento.
 */
function rotasRegistradas() {
  const dirs = [path.join(__dirname, '..', 'servidor'), path.join(__dirname, '..', 'servidor', 'rotas')];
  const achadas = [];
  for (const dir of dirs) {
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('.js')) continue;
      const texto = fs.readFileSync(path.join(dir, arquivo), 'utf8');
      for (const m of texto.matchAll(/roteador\.rota\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g)) {
        const caminho = m[2].replace(/:([a-zA-Z_]+)/g, '{$1}');
        achadas.push(`${m[1]} ${caminho}`);
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

  it('documenta somente saude, OpenAPI e docs como operacoes publicas', () => {
    const d = openapi.documento();
    const publicas = [];
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      for (const [metodo, operacao] of Object.entries(metodos)) {
        if (Array.isArray(operacao.security) && operacao.security.length === 0) {
          publicas.push(`${metodo.toUpperCase()} ${caminho}`);
        }
      }
    }
    assert.deepStrictEqual(publicas.sort(), [
      'GET /api/v1/openapi.json',
      'GET /api/v1/saude',
      'GET /docs',
    ]);
  });

  it('separa no chat a chave de conexao da credencial Anthropic', () => {
    const d = openapi.documento();
    const resposta = d.paths['/api/v1/chat'].post.responses[401];

    assert.match(resposta.description, /Authorization: Bearer/);
    assert.match(resposta.description, /x-api-key/);
    assert.match(resposta.description, /ANTHROPIC_API_KEY/);
    assert.match(resposta.description, /independentes/);
  });

  // Validador offline, sem dependencia nova: a regra 3.1 e que todo `parameters` com
  // `in: 'path'` precisa ter `{nome}` correspondente no template do caminho — e o
  // exato defeito que motivou trocar `:id` por `{id}` no documento (revisao). Sem
  // este teste, um path novo com parametro poderia reintroduzir `:id` (ou esquecer
  // `{...}` no template) e nada aqui acusaria — os dois testes de reconciliacao
  // acima so comparam METODO+CAMINHO, nao olham dentro de `parameters`.
  it('todo parametro de caminho tem {nome} correspondente no template', () => {
    const d = openapi.documento();
    const problemas = [];
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      const noTemplate = new Set([...caminho.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]));
      for (const [metodo, operacao] of Object.entries(metodos)) {
        for (const p of operacao.parameters || []) {
          if (p.in !== 'path') continue;
          if (!noTemplate.has(p.name)) {
            problemas.push(`${metodo.toUpperCase()} ${caminho}: parametro de path "${p.name}" sem {${p.name}} no template`);
          }
        }
      }
    }
    assert.deepStrictEqual(problemas, []);
  });
});
