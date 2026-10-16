#!/usr/bin/env bash
# Deploy imutavel do jur no h2, seguindo AGENTS.md e docs/qa/*producao*. Roda de qualquer
# maquina com ~/.ssh/jurcrawler_deploy. Rascunho de 16/10/2026, ainda nao executado contra o
# servidor: antes de rodar, confira no h2 o nome do container (jur-jur-1), dos volumes
# (jur_jur-dados, jur_jur-cache) e o formato de .previous-release (caminho completo).
# Uso: infra/deploy-h2.sh <sha7 de origin/main> <versao>
set -euo pipefail
SHA=${1:?sha}; VER=${2:?versao}
S=$(dirname "$0")
SSH="ssh -o IdentitiesOnly=yes -i $HOME/.ssh/jurcrawler_deploy brpl@168.231.91.47"
A=/home/brpl/apps/prc_jur_crawler
TS=$(date -u +%Y%m%d-%H%M%S); REL=$TS-$SHA
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin
[ "$(git rev-parse --short=7 origin/main)" = "$SHA" ] || { echo "origin/main != $SHA"; exit 1; }
git archive --format=tar.gz -o "$S/jur-$SHA.tar.gz" origin/main
LOCAL_SUM=$(sha256sum "$S/jur-$SHA.tar.gz" | cut -d' ' -f1)
echo "pacote $LOCAL_SUM"
$SSH "mkdir -p $A/incoming"
scp -o IdentitiesOnly=yes -i "$HOME/.ssh/jurcrawler_deploy" "$S/jur-$SHA.tar.gz" brpl@168.231.91.47:$A/incoming/
$SSH bash -s "$SHA" "$VER" "$REL" "$LOCAL_SUM" <<'REMOTE'
set -euo pipefail
SHA=$1; VER=$2; REL=$3; LOCAL_SUM=$4
A=/home/brpl/apps/prc_jur_crawler
REMOTE_SUM=$(sha256sum $A/incoming/jur-$SHA.tar.gz | cut -d' ' -f1)
[ "$REMOTE_SUM" = "$LOCAL_SUM" ] || { echo "SHA do pacote difere"; exit 1; }
PREV=$(readlink -f $A/current)
echo "release anterior: $PREV"
mkdir -p $A/releases/$REL && tar xzf $A/incoming/jur-$SHA.tar.gz -C $A/releases/$REL
echo "$REMOTE_SUM  jur-$SHA.tar.gz" > $A/releases/$REL/pacote.sha256
cd $A/releases/$REL
docker build -q -f infra/Dockerfile -t jur:$SHA \
  --label org.opencontainers.image.revision=$SHA --label org.opencontainers.image.version=$VER . >/dev/null
echo "imagem $(docker image inspect jur:$SHA --format '{{.Id}}')"
sed "s|^JUR_IMAGE=.*|JUR_IMAGE=jur:$SHA|" $PREV/infra/.env > infra/.env && chmod 600 infra/.env
grep -q "^JUR_IMAGE=jur:$SHA$" infra/.env
# --- validação em container temporário, volumes próprios, sem aviso de deploy ---
docker rm -f jurpre >/dev/null 2>&1 || true
docker volume rm jurpre-dados jurpre-cache >/dev/null 2>&1 || true
docker run -d --name jurpre --init --shm-size=1g --env-file infra/.env \
  -e PORT=3000 -e JUR_BIND=0.0.0.0 -e JUR_DADOS=/dados -e TMPDIR=/cache -e USAGE_WEBHOOK_URL= \
  -v jurpre-dados:/dados -v jurpre-cache:/cache -p 127.0.0.1:3100:3000 jur:$SHA >/dev/null
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3100/api/v1/saude >/dev/null 2>&1 && break; sleep 2; done
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
echo "pre saude $(curl -fsS http://127.0.0.1:3100/api/v1/saude)"
echo "pre me=$(code http://127.0.0.1:3100/api/v1/me) painel=$(code http://127.0.0.1:3100/__local/painel.js) docs=$(code http://127.0.0.1:3100/docs) login=$(code http://127.0.0.1:3100/auth/login) entrada=$(code http://127.0.0.1:3100/entrada.js) robo=$(curl -s -o /dev/null -w '%{content_type}' http://127.0.0.1:3100/robo.webp) favicon=$(curl -s -o /dev/null -w '%{content_type}' http://127.0.0.1:3100/favicon.svg)"
for f in index.html entrada.js estilo.css; do
  [ "$(curl -s http://127.0.0.1:3100/$f | sha256sum | cut -d' ' -f1)" = "$(sha256sum jur/publico/$f | cut -d' ' -f1)" ] && echo "pre $f sha ok" || { echo "pre $f sha DIFERE"; exit 1; }
done
docker logs jurpre 2>&1 | grep -i "aviso de deploy" || echo "pre: sem aviso de deploy (esperado)"
docker rm -f jurpre >/dev/null && docker volume rm jurpre-dados jurpre-cache >/dev/null
# --- backup dos volumes com pausa breve ---
B=$A/backups/$REL; mkdir -p $B
docker pause jur-jur-1
docker run --rm -v jur_jur-dados:/d:ro -v $B:/b alpine tar czf /b/jur_jur-dados.tgz -C /d .
docker run --rm -v jur_jur-cache:/d:ro -v $B:/b alpine tar czf /b/jur_jur-cache.tgz -C /d .
docker unpause jur-jur-1
(cd $B && sha256sum *.tgz > SHA256SUMS && sha256sum -c SHA256SUMS)
cp $PREV/infra/.env $B/previous.env && chmod 600 $B/previous.env
printf '{"release":"%s","image":"jur:%s","version":"%s","previous":"%s","package_sha256":"%s","date":"%s"}\n' \
  "$REL" "$SHA" "$VER" "$PREV" "$REMOTE_SUM" "$(date -u +%FT%TZ)" | tee $B/release.json > $A/releases/$REL/release.json
# --- troca ---
echo "$PREV" > $A/.previous-release
ln -sfn $A/releases/$REL $A/current
docker compose -p jur -f $A/current/infra/compose.yml up -d --no-build
for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' jur-jur-1)" = healthy ] && break; sleep 3; done
docker inspect -f 'container {{.Config.Image}} {{.State.Health.Status}}' jur-jur-1
echo "pos saude $(curl -fsS https://jurcrawler.com.br/api/v1/saude)"
echo "pos me=$(code https://jurcrawler.com.br/api/v1/me) painel=$(code https://jurcrawler.com.br/__local/painel.js) docs=$(code https://jurcrawler.com.br/docs) login=$(code https://jurcrawler.com.br/auth/login) robo=$(curl -s -o /dev/null -w '%{content_type}' https://jurcrawler.com.br/robo.webp)"
for f in index.html entrada.js estilo.css; do
  [ "$(curl -s https://jurcrawler.com.br/$f | sha256sum | cut -d' ' -f1)" = "$(sha256sum jur/publico/$f | cut -d' ' -f1)" ] && echo "pos $f sha ok" || echo "pos $f sha DIFERE"
done
sleep 5; docker logs jur-jur-1 2>&1 | grep -i "aviso de deploy" | tail -1
rm -f $A/incoming/jur-$SHA.tar.gz
echo "release $REL no ar; anterior $PREV"
REMOTE
