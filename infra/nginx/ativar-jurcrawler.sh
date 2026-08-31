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
jur_backup_dir=$(mktemp -d /tmp/jurcrawler-nginx.XXXXXX)
jur_backup_site="$jur_backup_dir/site"
jur_backup_enabled="$jur_backup_dir/enabled"
jur_had_site=0
jur_had_enabled=0
jur_rollback=0

jur_cert_tem_nomes() {
  local jur_sans

  [[ -f "$jur_cert" ]] || return 1
  openssl x509 -in "$jur_cert" -checkend 0 -noout 2>/dev/null || return 1
  jur_sans=$(openssl x509 -in "$jur_cert" -noout -ext subjectAltName 2>/dev/null |
    sed 's/,/\n/g' |
    sed -n 's/^[[:space:]]*DNS://p') || return 1

  grep -Fxq 'jurcrawler.com.br' <<<"$jur_sans" &&
    grep -Fxq 'www.jurcrawler.com.br' <<<"$jur_sans"
}

jur_validar_e_recarregar() {
  nginx -t || return 1
  systemctl reload nginx
}

jur_limpar_backup() {
  rm -f -- "$jur_backup_site" "$jur_backup_enabled"
  rmdir -- "$jur_backup_dir" 2>/dev/null || true
}

jur_restaurar() {
  local jur_status=$1
  trap - ERR

  if ((jur_rollback)); then
    if ((jur_had_site)); then
      rm -f -- "$jur_site"
      cp -a -- "$jur_backup_site" "$jur_site"
    else
      rm -f -- "$jur_site"
    fi

    if ((jur_had_enabled)); then
      rm -f -- "$jur_enabled"
      cp -a -- "$jur_backup_enabled" "$jur_enabled"
    else
      rm -f -- "$jur_enabled"
    fi

    if jur_validar_e_recarregar; then
      :
    else
      echo 'falha ao validar a restauracao do vhost jurcrawler' >&2
    fi
  fi

  exit "$jur_status"
}

if [[ -e "$jur_site" || -L "$jur_site" ]]; then
  cp -a -- "$jur_site" "$jur_backup_site"
  jur_had_site=1
fi

if [[ -e "$jur_enabled" || -L "$jur_enabled" ]]; then
  cp -a -- "$jur_enabled" "$jur_backup_enabled"
  jur_had_enabled=1
fi

trap jur_limpar_backup EXIT
trap 'jur_restaurar "$?"' ERR

install -d -m 0755 /var/www/letsencrypt

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
fi

if ! jur_cert_tem_nomes; then
  jur_rollback=1
  install -m 0644 "$jur_script_dir/jurcrawler-http.conf" "$jur_site"
  ln -sfn "$jur_site" "$jur_enabled"

  jur_validar_e_recarregar

  certbot certonly --webroot -w /var/www/letsencrypt \
    --cert-name jurcrawler.com.br \
    -d jurcrawler.com.br -d www.jurcrawler.com.br
fi

if ! jur_cert_tem_nomes; then
  echo 'certificado jurcrawler nao cobre os dois nomes' >&2
  false
fi

jur_rollback=1
install -m 0644 "$jur_script_dir/jurcrawler.conf" "$jur_site"
ln -sfn "$jur_site" "$jur_enabled"
jur_validar_e_recarregar
certbot renew --dry-run --cert-name jurcrawler.com.br
jur_rollback=0
