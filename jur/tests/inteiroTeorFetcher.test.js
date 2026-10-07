// test/inteiroTeorFetcher.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const { stripHtml, sanitizeFilename } = require('../src/inteiroTeorFetcher');

describe('stripHtml', () => {
  it('removes HTML tags and returns plain text', () => {
    const html = '<div><p>Hello <b>world</b></p></div>';
    assert.strictEqual(stripHtml(html), 'Hello world');
  });

  it('decodes HTML entities', () => {
    const html = '<p>Art. 201 &mdash; Par&aacute;grafo &uacute;nico</p>';
    const result = stripHtml(html);
    assert.ok(result.includes('Art. 201'));
    assert.ok(result.includes('Parágrafo'));
    assert.ok(result.includes('único'));
  });

  it('collapses excessive whitespace into single newlines', () => {
    const html = '<p>Line 1</p>\n\n\n\n<p>Line 2</p>';
    const result = stripHtml(html);
    assert.ok(!result.includes('\n\n\n'));
  });

  it('preserves paragraph breaks as double newlines', () => {
    const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';
    const result = stripHtml(html);
    assert.ok(result.includes('Paragraph 1\n\nParagraph 2'));
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(stripHtml(''), '');
    assert.strictEqual(stripHtml(null), '');
    assert.strictEqual(stripHtml(undefined), '');
  });
});

describe('sanitizeFilename', () => {
  it('converts processo number to safe filename', () => {
    assert.strictEqual(
      sanitizeFilename('5015371-33.2025.4.04.7100/RS'),
      '5015371-33.2025.4.04.7100-RS'
    );
  });

  it('removes dangerous characters', () => {
    assert.strictEqual(sanitizeFilename('file:name?test'), 'filename_test');
  });
});

// As guardas do download sob demanda (ler_inteiro_teor). Servidor local de verdade:
// o que importa e o comportamento do http, nao um mock dele.
describe('httpGet — guardas do download', () => {
  const http = require('node:http');
  const { httpGet, LIMITES_DOWNLOAD } = require('../src/inteiroTeorFetcher');
  const { before, after } = require('node:test');
  let servidor; let base;

  before(async () => {
    servidor = http.createServer((req, res) => {
      if (req.url === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4 binario'); }
      if (req.url === '/laco') { res.writeHead(302, { location: '/laco' }); return res.end(); }
      if (req.url === '/grande') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('x'.repeat(5000)); }
      if (req.url === '/lento') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<p>'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<p>ok</p>');
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => { servidor.closeAllConnections(); servidor.close(); });

  it('limites padrao: 30 s, 5 MB, 5 redirecionamentos', () => {
    assert.deepStrictEqual(LIMITES_DOWNLOAD, { timeoutMs: 30_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 5 });
  });

  it('html passa', async () => {
    assert.match(await httpGet(`${base}/ok`), /ok/);
  });

  it('PDF e recusado: bytes binarios nunca voltam como texto', async () => {
    await assert.rejects(httpGet(`${base}/pdf`), /content-type/i);
  });

  it('laco de redirecionamento e recusado', async () => {
    await assert.rejects(httpGet(`${base}/laco`), /redirecionamento/i);
  });

  it('corpo acima do teto e recusado', async () => {
    await assert.rejects(httpGet(`${base}/grande`, { maxBytes: 1000 }), /tamanho|teto/i);
  });

  it('servidor que nao termina estoura o prazo', async () => {
    await assert.rejects(httpGet(`${base}/lento`, { timeoutMs: 200 }), /prazo|timeout/i);
  });

  // Portal que travou nao destrava em 1-2 s: tentar de novo so multiplica a espera de
  // 30 s por tres no servidor.
  it('prazo esgotado e erro definitivo (sem retry)', async () => {
    await assert.rejects(httpGet(`${base}/lento`, { timeoutMs: 200 }), (e) => e.definitivo === true);
  });
});
