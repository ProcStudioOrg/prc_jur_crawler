const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const raiz = path.join(__dirname, '..', '..', 'infra', 'nginx');
const ler = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8');
const ativador = path.join(raiz, 'ativar-jurcrawler.sh');

describe('proxy publico do jurcrawler', () => {
  it('encaminha somente ao loopback e preserva SSE', () => {
    const conf = ler('jurcrawler.conf');
    assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
    assert.match(conf, /proxy_http_version 1\.1;/);
    assert.match(conf, /proxy_set_header Host \$host;/);
    assert.match(conf, /proxy_set_header X-Real-IP \$remote_addr;/);
    assert.match(conf, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
    assert.match(conf, /proxy_set_header X-Forwarded-Proto https;/);
    assert.match(conf, /proxy_buffering off;/);
    assert.match(conf, /proxy_cache off;/);
    assert.match(conf, /proxy_read_timeout 3600s;/);
    assert.match(conf, /proxy_send_timeout 3600s;/);
    assert.doesNotMatch(conf, /proxy_pass http:\/\/0\.0\.0\.0/);
  });

  it('mantem ACME, HTTPS e os dois nomes', () => {
    for (const nome of ['jurcrawler-http.conf', 'jurcrawler.conf']) {
      const conf = ler(nome);
      assert.match(conf, /jurcrawler\.com\.br www\.jurcrawler\.com\.br/);
      assert.match(conf, /\.well-known\/acme-challenge/);
    }
    const bootstrap = ler('jurcrawler-http.conf');
    const conf = ler('jurcrawler.conf');
    assert.match(bootstrap, /location \/ \{\s*return 503;/);
    assert.doesNotMatch(bootstrap, /proxy_pass/);
    assert.match(conf, /listen 443 ssl/);
    assert.match(conf, /server_name www\.jurcrawler\.com\.br;/);
    assert.match(conf, /return 301 https:\/\/jurcrawler\.com\.br\$request_uri;/);
    assert.match(conf, /ssl_certificate \/etc\/letsencrypt\/live\/jurcrawler\.com\.br\/fullchain\.pem;/);
    assert.match(conf, /ssl_certificate_key \/etc\/letsencrypt\/live\/jurcrawler\.com\.br\/privkey\.pem;/);
  });

  it('aplica os headers de seguranca e limite de corpo', () => {
    const conf = ler('jurcrawler.conf');
    assert.match(conf, /add_header X-Content-Type-Options nosniff always;/);
    assert.match(conf, /add_header Referrer-Policy no-referrer always;/);
    assert.match(conf, /add_header X-Frame-Options DENY always;/);
    assert.match(conf, /client_max_body_size 1m;/);
  });

  it('ativa de forma recuperavel, valida SAN e limita as operacoes do host', () => {
    const script = ler('ativar-jurcrawler.sh');
    assert.doesNotThrow(() => execFileSync('bash', ['-n', ativador]));
    assert.match(script, /\[\[ \$\{EUID\} -ne 0 \]\]/);
    assert.match(script, /ufw allow 80\/tcp/);
    assert.doesNotMatch(script, /ufw allow 443/);
    assert.match(script, /openssl x509 -in "\$jur_cert" -noout -ext subjectAltName/);
    assert.match(script, /grep -Fxq 'jurcrawler\.com\.br'/);
    assert.match(script, /grep -Fxq 'www\.jurcrawler\.com\.br'/);
    assert.match(script, /if ! jur_cert_tem_nomes; then[\s\S]*?jurcrawler-http\.conf/);
    assert.match(script, /certbot certonly --webroot -w \/var\/www\/letsencrypt[\s\S]*?--cert-name jurcrawler\.com\.br[\s\S]*?-d jurcrawler\.com\.br -d www\.jurcrawler\.com\.br/);
    assert.match(script, /if ! jur_cert_tem_nomes; then[\s\S]*?certbot certonly/);
    assert.match(script, /trap 'jur_restaurar "\$\?"' ERR/);
    assert.match(script, /jur_restaurar\(\)[\s\S]*?nginx -t[\s\S]*?systemctl reload nginx/);
    assert.match(script, /if \(\(jur_had_site\)\); then[\s\S]*?cp -a -- "\$jur_backup_site" "\$jur_site"[\s\S]*?else[\s\S]*?rm -f -- "\$jur_site"/);
    assert.match(script, /if \(\(jur_had_enabled\)\); then[\s\S]*?cp -a -- "\$jur_backup_enabled" "\$jur_enabled"[\s\S]*?else[\s\S]*?rm -f -- "\$jur_enabled"/);
    assert.match(script, /nginx -t\n\s*systemctl reload nginx/);
    assert.match(script, /certbot renew --dry-run --cert-name jurcrawler\.com\.br/);
    assert.match(script, /certbot renew --dry-run --cert-name jurcrawler\.com\.br\n+jur_rollback=0/);
  });
});
