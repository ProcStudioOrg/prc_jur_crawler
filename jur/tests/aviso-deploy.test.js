const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { avisarDeploy, revisaoDaImagem, chaveDeploy } = require('../servidor/aviso-deploy');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aviso-deploy-'));

test('envia uma vez por versão+revisão no formato do FFD', async () => {
  const dir = tmp();
  const chamadas = [];
  const fetchFn = async (url, init) => { chamadas.push({ url, init }); return new Response('{}'); };
  const opts = { url: 'https://ffd.example/api/webhooks/usage?token=x', dir, versao: '1.0.0', revisao: 'abc1234', fetchFn };
  assert.equal(await avisarDeploy(opts), 'enviado');
  assert.equal(await avisarDeploy(opts), 'repetido');
  assert.equal(chamadas.length, 1);
  assert.deepEqual(JSON.parse(chamadas[0].init.body),
    { service: 'jurcrawler', event: 'deploy', version: '1.0.0', revision: 'abc1234' });
  assert.equal(await avisarDeploy({ ...opts, revisao: 'def5678' }), 'enviado');
  assert.equal(chamadas.length, 2);
});

test('sem URL não chama nada; falha não grava marcador e não lança', async () => {
  const dir = tmp();
  assert.equal(await avisarDeploy({ url: '', dir, versao: '1.0.0' }), 'desligado');
  let n = 0;
  const falha = async () => { n++; return new Response('', { status: 500 }); };
  const opts = { url: 'https://ffd.example', dir, versao: '1.0.0', fetchFn: falha };
  assert.equal(await avisarDeploy(opts), 'falhou');
  assert.equal(await avisarDeploy({ ...opts, fetchFn: async () => { throw new Error('rede'); } }), 'falhou');
  assert.equal(await avisarDeploy(opts), 'falhou');
  assert.equal(n, 2);
});

test('revisão só sai de tag com sha', () => {
  assert.equal(revisaoDaImagem('jur:5605c57'), '5605c57');
  assert.equal(revisaoDaImagem('jur:dev'), '');
  assert.equal(revisaoDaImagem(undefined), '');
});

test('chave do deploy: versao+revisao, a mesma do marcador', async () => {
  const dir = tmp();
  assert.equal(chaveDeploy('1.1.0', 'abc1234'), '1.1.0+abc1234');
  await avisarDeploy({ url: 'https://ffd.example', dir, versao: '1.1.0', revisao: 'abc1234', fetchFn: async () => new Response('{}') });
  assert.equal(fs.readFileSync(path.join(dir, '.ultimo-deploy-avisado'), 'utf8').trim(), chaveDeploy('1.1.0', 'abc1234'));
});
