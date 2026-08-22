const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { describe, it, before, after } = require('node:test');
const { chromium } = require('playwright');
const db = require('../../servidor/db');
const jobs = require('../../servidor/jobs');
const chaves = require('../../servidor/chaves');
const { criarApp } = require('../../servidor/index');

const execFileAsync = promisify(execFile);

/**
 * Este e o teste que teria pego o bug bloqueante da revisao: a guarda (Barreira 2)
 * usava `Origin` como sinal de "e a propria interface", mas o browser NAO manda Origin
 * em GET de mesma origem — nem na navegacao (GET /) nem no fetch que a propria pagina
 * dispara. O teste HTTP direto (tests/autenticacao.test.js) nao pegava isso porque o
 * `fetch` do Node permite SETAR Origin manualmente — um header que nenhum browser de
 * verdade deixa o site escolher. So um browser real, que decide sozinho o que manda,
 * expoe a diferenca.
 *
 * Sobe o servidor com exigirChave:true (o padrao em producao — ver infra/Dockerfile,
 * que nao seta JUR_EXIGIR_CHAVE) e dirige um Chromium de verdade contra ele.
 *
 * Fica fora de `tests/*.test.js` (o glob do `npm test`) de proposito: subir um Chromium
 * custa ~1-2s de lancamento por suite, e essa suite ja tem 165 testes rapidos. Rodar
 * via `npm run test:browser`.
 */

let servidor; let base; let porta; let browser;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-ui-real-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  const g = chaves.criarGerenciador(con);
  servidor = http.createServer(criarApp({ fila, chaves: g, exigirChave: true }).handler);
  await new Promise((r) => servidor.listen(0, r));
  porta = servidor.address().port;
  base = `http://127.0.0.1:${porta}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

describe('interface real em Chromium, com exigencia de chave ligada (fix Sec-Fetch-Site)', () => {
  it('a pagina carrega (200, nao 401) e o fetch que ELA MESMA dispara tambem funciona', async () => {
    const page = await browser.newPage();
    try {
      const respostaNavegacao = await page.goto(base + '/');
      assert.strictEqual(
        respostaNavegacao.status(), 200,
        'GET / nao pode exigir chave — e a propria interface carregando pela primeira vez',
      );

      // fetch same-origin disparado de DENTRO da pagina, exatamente como o app.js real
      // disparado o proprio browser — nao setamos nenhum header a mao.
      const resultado = await page.evaluate(async () => {
        const r = await fetch('/api/v1/tribunais');
        return { status: r.status };
      });
      assert.strictEqual(
        resultado.status, 200,
        'fetch de mesma origem disparado pela propria pagina nao pode exigir chave',
      );
    } finally {
      await page.close();
    }
  });

  it('gerar chave pela interface funciona (POST /api/v1/chaves disparado de dentro da pagina)', async () => {
    // A UI ainda nao tem um botao de "gerar chave" (nao faz parte desta task); o que
    // importa aqui e o caminho que esse botao vai usar quando existir: um fetch
    // same-origin disparado do browser real, carregado a partir desta mesma pagina.
    const page = await browser.newPage();
    try {
      await page.goto(base + '/');
      const resultado = await page.evaluate(async () => {
        const r = await fetch('/api/v1/chaves', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nome: 'gerada no teste de browser real' }),
        });
        return { status: r.status, corpo: await r.json() };
      });
      assert.strictEqual(resultado.status, 201, JSON.stringify(resultado));
      assert.ok(
        typeof resultado.corpo.valor === 'string' && resultado.corpo.valor.startsWith('jur_'),
        'a chave gerada pela interface precisa ter o formato esperado',
      );
    } finally {
      await page.close();
    }
  });

  it('um cliente sem credencial nenhuma (curl real, sem Sec-Fetch-Site) continua tomando 401', async () => {
    const { stdout } = await execFileAsync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}',
      '-X', 'POST', `${base}/api/v1/buscas`,
      '-H', 'content-type: application/json',
      '-d', JSON.stringify({ tribunal: 'stf', query: 'x' }),
    ]);
    assert.strictEqual(stdout.trim(), '401', 'curl sem chave e sem Sec-Fetch-Site precisa continuar recusado');
  });
});
