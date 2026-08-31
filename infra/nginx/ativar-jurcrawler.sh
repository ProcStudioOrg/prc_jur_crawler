#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'execute com sudo' >&2
  exit 1
fi

jur_script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
jur_site=/etc/nginx/sites-available/jurcrawler.conf
jur_enabled=/etc/nginx/sites-enabled/jurcrawler.conf
jur_cert=/etc/letsencrypt/live/jurcrawler.com.br/fullchain.pem

install -d -m 0755 /var/www/letsencrypt
install -m 0644 "$jur_script_dir/jurcrawler-http.conf" "$jur_site"
ln -sfn "$jur_site" "$jur_enabled"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
fi

nginx -t
systemctl reload nginx

if [[ ! -f "$jur_cert" ]]; then
  certbot certonly --webroot -w /var/www/letsencrypt \
    --cert-name jurcrawler.com.br \
    -d jurcrawler.com.br -d www.jurcrawler.com.br
fi

install -m 0644 "$jur_script_dir/jurcrawler.conf" "$jur_site"
nginx -t
systemctl reload nginx
certbot renew --dry-run
