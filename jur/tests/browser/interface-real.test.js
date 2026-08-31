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

let servidor; let base; let porta; let browser; let chaveValida;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-ui-real-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  const g = chaves.criarGerenciador(con);
  chaveValida = g.gerar('interface real').valor;
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

describe('interface real em Chromium, com exigencia de chave ligada', () => {
  it('carrega a pagina, mas a API recusa o browser sem chave', async () => {
    const page = await browser.newPage();
    try {
      assert.strictEqual((await page.goto(base + '/')).status(), 200);
      const status = await page.evaluate(() => fetch('/api/v1/tribunais').then((r) => r.status));
      assert.strictEqual(status, 401);
      assert.strictEqual(await page.isVisible('#estado-conexao'), true);
    } finally {
      await page.close();
    }
  });

  it('a UI salva Bearer e volta a acessar a API', async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript((valor) => {
        localStorage.setItem('jur.chaveConexao', valor);
      }, chaveValida);
      await page.goto(base + '/');
      const resultado = await page.evaluate(() => window.jurApi.pedir('/api/v1/tribunais'));
      assert.ok(resultado.tribunais.length > 0);
      assert.strictEqual(await page.isHidden('#estado-conexao'), true);
    } finally {
      await page.close();
    }
  });

  it('um cliente sem credencial nenhuma (curl real, com Sec-Fetch-Site forjado) continua tomando 401', async () => {
    const { stdout } = await execFileAsync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}',
      '-X', 'POST', `${base}/api/v1/buscas`,
      '-H', 'content-type: application/json',
      '-H', 'Sec-Fetch-Site: same-origin',
      '-d', JSON.stringify({ tribunal: 'stf', query: 'x' }),
    ]);
    assert.strictEqual(stdout.trim(), '401', 'curl sem chave e com Sec-Fetch-Site forjado precisa continuar recusado');
  });
});
