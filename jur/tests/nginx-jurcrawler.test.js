const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const raiz = path.join(__dirname, '..', '..', 'infra', 'nginx');
const ler = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8');

describe('proxy publico do jurcrawler', () => {
  it('encaminha somente ao loopback e preserva SSE', () => {
    const conf = ler('jurcrawler.conf');
    assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
    assert.match(conf, /proxy_buffering off;/);
    assert.match(conf, /proxy_read_timeout 3600s;/);
    assert.doesNotMatch(conf, /proxy_pass http:\/\/0\.0\.0\.0/);
  });

  it('mantem ACME, HTTPS e os dois nomes', () => {
    for (const nome of ['jurcrawler-http.conf', 'jurcrawler.conf']) {
      const conf = ler(nome);
      assert.match(conf, /jurcrawler\.com\.br www\.jurcrawler\.com\.br/);
      assert.match(conf, /\.well-known\/acme-challenge/);
    }
    assert.match(ler('jurcrawler.conf'), /listen 443 ssl/);
  });
});
