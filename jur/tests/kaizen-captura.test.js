const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { dirFalha, lerCaptura, marcarAssinatura, assinaturaDaCaptura, limparCaptura } = require('../servidor/kaizen/captura');

function montarFalha({ html, png, meta = { passo: 'pagina:x', tribunal: 'trf4' } } = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-captura-')), 'job.falha');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  if (html !== undefined) fs.writeFileSync(path.join(dir, 'pagina.html'), html);
  if (png !== undefined) fs.writeFileSync(path.join(dir, 'tela.png'), png);
  return dir;
}

test('lerCaptura: gzip+base64 e sha do html; html grande truncado com aviso', async () => {
  const dir = montarFalha({ html: 'a'.repeat(5 * 1024 * 1024), png: Buffer.from([137, 80]) });
  const c = await lerCaptura(dir);
  const html = zlib.gunzipSync(Buffer.from(c.html_gzip_b64, 'base64')).toString();
  assert.ok(html.length < 4 * 1024 * 1024 + 200);
  assert.match(html, /<!-- kaizen: HTML truncado em 4 MB de \d+ bytes -->$/);
  assert.equal(c.html_sha256, createHash('sha256').update(html).digest('hex'));
  assert.deepEqual(zlib.gunzipSync(Buffer.from(c.tela_png_gzip_b64, 'base64')), Buffer.from([137, 80]));
  assert.equal(c.meta.tribunal, 'trf4');
});

test('lerCaptura: html pequeno vai inteiro, sem aviso', async () => {
  const c = await lerCaptura(montarFalha({ html: '<p>oi</p>' }));
  assert.equal(zlib.gunzipSync(Buffer.from(c.html_gzip_b64, 'base64')).toString(), '<p>oi</p>');
  assert.equal(c.tela_png_gzip_b64, undefined);
});

test('lerCaptura: so meta.json e diretorio ausente', async () => {
  assert.deepEqual(Object.keys(await lerCaptura(montarFalha({}))), ['meta']);
  assert.equal(await lerCaptura('/nao/existe'), null);
  assert.equal(dirFalha('/d/r/abc.json'), '/d/r/abc.falha');
});

test('lerCaptura: meta.json corrompido nao lanca', async () => {
  const dir = montarFalha({});
  fs.writeFileSync(path.join(dir, 'meta.json'), '{quebrado');
  assert.equal(await lerCaptura(dir), null);
});

test('marcarAssinatura grava no meta.json e assinaturaDaCaptura le de volta', () => {
  const dir = montarFalha({});
  assert.equal(assinaturaDaCaptura(dir), null);
  marcarAssinatura(dir, 'trf4|seletor|pagina:x|timeout');
  assert.equal(assinaturaDaCaptura(dir), 'trf4|seletor|pagina:x|timeout');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).tribunal, 'trf4');
  assert.deepEqual(fs.readdirSync(dir), ['meta.json'], 'gravacao atomica nao deixa .tmp para tras');
  assert.equal(assinaturaDaCaptura('/nao/existe'), null);
  assert.doesNotThrow(() => marcarAssinatura('/nao/existe', 'x'));
});

test('limparCaptura apaga print e HTML e mantem o meta.json', () => {
  const dir = montarFalha({ html: 'x', png: Buffer.from([1]) });
  limparCaptura(dir);
  assert.deepEqual(fs.readdirSync(dir), ['meta.json']);
  assert.doesNotThrow(() => limparCaptura('/nao/existe'));
});
