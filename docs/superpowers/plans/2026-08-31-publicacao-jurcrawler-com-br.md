# Publicação de `jurcrawler.com.br` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar a release corrigida do BRU-73 no h2 com HTTPS, persistência, rollback e operação documentada.

**Architecture:** O app permanece em Docker no loopback do h2. Nginx termina TLS para `jurcrawler.com.br`, serve o desafio ACME e encaminha HTTP/SSE para `127.0.0.1:3000`; DNS e certificado só são ativados depois de a release privada passar nos probes de autenticação.

**Tech Stack:** SSH, Docker Compose, Nginx, Certbot/Let’s Encrypt, DNS automático do Registro.br, Linear CLI.

**Spec:** `docs/superpowers/specs/2026-08-31-autenticacao-e-publicacao-jurcrawler-design.md`

## Global Constraints

- Este plano começa somente após o plano BRU-73 estar verde e enviado ao `origin/main`.
- A porta 3000 nunca será publicada fora de `127.0.0.1`.
- O volume `jur_jur-dados` é preservado e copiado antes da troca de release.
- Nenhum valor Bearer ou Anthropic aparece em log, alias, commit ou comentário do Linear.
- Não tocar nos virtual hosts `whatsorganizer` e `nginx_legendator.conf`.
- Toda alteração do Nginx passa por `nginx -t` antes de reload.
- O gate DNS/TLS aguarda o ping humano confirmando pagamento/ativação.

---

### Task 1: Emitir a chave inicial e publicar a release ainda privada

**Files:**
- Remote create: diretório resolvido por `jur_release` sob `/home/brpl/apps/prc_jur_crawler/releases`
- Remote modify: `/home/brpl/apps/prc_jur_crawler/current`
- Remote create: backup sob `/home/brpl/apps/prc_jur_crawler/backups`

**Interfaces:**
- Consumes: `origin/main` corrigido, SSH do h2 e `infra/compose.yml`.
- Produces: release saudável no loopback, chave inicial no clipboard e `.previous-release`.

- [ ] **Step 1: Provar que a revisão é a revisão testada**

```bash
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git diff --exit-code -- jur/servidor jur/publico infra
```

Expected: os arquivos executáveis não têm mudanças fora dos commits testados.

- [ ] **Step 2: Emitir a chave inicial sem mostrá-la**

Enquanto a release antiga continua privada:

```bash
set -o pipefail
ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  "curl -fsS -X POST http://127.0.0.1:3000/api/v1/chaves \
    -H 'Sec-Fetch-Site: same-origin' \
    -H 'content-type: application/json' \
    -d '{\"nome\":\"browser principal jurcrawler.com.br\"}'" \
  | jq -er .valor | pbcopy
```

Expected: exit `0`, stdout vazio e `pbpaste | cut -c1-4` devolve apenas `jur_`.

- [ ] **Step 3: Copiar a revisão imutável e construir sem trocar o serviço**

Executar no mesmo shell:

```bash
set -euo pipefail
jur_release_stamp=$(date -u +%Y%m%d-%H%M%S)
jur_release="/home/brpl/apps/prc_jur_crawler/releases/$jur_release_stamp"
git archive --format=tar HEAD | ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  "mkdir -p '$jur_release' && tar -xf - -C '$jur_release'"
ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  "docker compose -p jur -f '$jur_release/infra/compose.yml' build && printf '%s' '$jur_release' > /home/brpl/apps/prc_jur_crawler/.candidate-release"
```

Expected: build remoto termina com exit `0`; o container atual continua atendendo.

- [ ] **Step 4: Parar, copiar dados e trocar a release**

```bash
ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 '
set -euo pipefail
jur_app=/home/brpl/apps/prc_jur_crawler
jur_atual=$(readlink -f "$jur_app/current")
jur_candidata=$(cat "$jur_app/.candidate-release")
printf "%s" "$jur_atual" > "$jur_app/.previous-release"
mkdir -p "$jur_app/backups"
docker compose -p jur -f "$jur_atual/infra/compose.yml" stop jur
jur_imagem=$(docker inspect -f "{{.Image}}" jur-jur-1)
docker run --rm --user 0:0 --entrypoint tar \
  -v jur_jur-dados:/source:ro -v "$jur_app/backups:/backup" \
  "$jur_imagem" -czf "/backup/dados-$(date -u +%Y%m%d-%H%M%S).tgz" -C /source .
ln -sfn "$jur_candidata" "$jur_app/current"
docker compose -p jur -f "$jur_app/current/infra/compose.yml" up -d
'
```

Expected: backup não vazio, symlink novo e `jur-jur-1` saudável.

- [ ] **Step 5: Validar saúde, bypass e Bearer pelo loopback**

```bash
test "$(ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/v1/saude")" = 200
test "$(ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  "curl -sS -o /dev/null -w '%{http_code}' -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:3000/api/v1/chaves")" = 401
pbpaste | ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 '
  IFS= read -r jur_chave
  test "$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $jur_chave" http://127.0.0.1:3000/api/v1/chaves)" = 200
'
```

Expected: `200`, `401`, `200`; nenhum segredo no stdout.

- [ ] **Step 6: Executar rollback somente em falha**

```bash
jur_app=/home/brpl/apps/prc_jur_crawler
jur_anterior=$(cat "$jur_app/.previous-release")
ln -sfn "$jur_anterior" "$jur_app/current"
docker compose -p jur -f "$jur_app/current/infra/compose.yml" up -d --build
curl -fsS http://127.0.0.1:3000/api/v1/saude
```

Expected: usado apenas em falha; volumes permanecem intactos.

---

### Task 2: Versionar o virtual host e seu ativador idempotente

**Files:**
- Create: `infra/nginx/jurcrawler-http.conf`
- Create: `infra/nginx/jurcrawler.conf`
- Create: `infra/nginx/ativar-jurcrawler.sh`
- Test: `jur/tests/nginx-jurcrawler.test.js`

**Interfaces:**
- Consumes: Nginx/Certbot existentes e app em `127.0.0.1:3000`.
- Produces: bootstrap HTTP, proxy TLS e script root idempotente.

- [ ] **Step 1: Escrever o teste de invariantes**

```js
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
```

- [ ] **Step 2: Rodar o teste vermelho**

Run: `cd jur && node --test tests/nginx-jurcrawler.test.js`

Expected: FAIL com `ENOENT`.

- [ ] **Step 3: Criar o bootstrap HTTP**

Conteúdo de `jurcrawler-http.conf`:

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name jurcrawler.com.br www.jurcrawler.com.br;

  location ^~ /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
  }

  location / {
    return 503;
  }
}
```

O bootstrap não encaminha ao app antes do certificado.

- [ ] **Step 4: Criar a configuração TLS final**

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name jurcrawler.com.br www.jurcrawler.com.br;
  location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 301 https://jurcrawler.com.br$request_uri; }
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name www.jurcrawler.com.br;
  ssl_certificate /etc/letsencrypt/live/jurcrawler.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jurcrawler.com.br/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
  return 301 https://jurcrawler.com.br$request_uri;
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name jurcrawler.com.br;
  ssl_certificate /etc/letsencrypt/live/jurcrawler.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jurcrawler.com.br/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header X-Frame-Options DENY always;
  client_max_body_size 1m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
```

- [ ] **Step 5: Criar o ativador**

Conteúdo de `ativar-jurcrawler.sh`:

```bash
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
```

Tornar o script executável. A regra de firewall abre somente TCP/80 quando UFW está ativo; 443 já está em uso pelo Nginx atual.

- [ ] **Step 6: Rodar testes**

```bash
cd jur
node --test tests/nginx-jurcrawler.test.js
cd ..
bash -n infra/nginx/ativar-jurcrawler.sh
```

Expected: PASS.

- [ ] **Step 7: Commitar e publicar**

```bash
git add infra/nginx/jurcrawler-http.conf infra/nginx/jurcrawler.conf \
  infra/nginx/ativar-jurcrawler.sh jur/tests/nginx-jurcrawler.test.js
git diff --cached --check
git commit -m "feat: prepara proxy HTTPS do jurcrawler"
git push origin main
```

---

### Task 3: Aguardar ativação e apontar DNS

**Files:**
- External: DNS de `jurcrawler.com.br` no Registro.br

**Interfaces:**
- Consumes: pagamento confirmado e DNS automático.
- Produces: A para raiz e `www`, ambos em `168.231.91.47`.

- [ ] **Step 1: Confirmar saída de waiting activation**

```bash
curl -fsS https://rdap.registro.br/domain/jurcrawler.com.br \
  | jq -e 'all(.status[]?; contains("waiting activation") | not)'
```

Expected: `true`. Enquanto falhar, não emitir certificado.

- [ ] **Step 2: Obter consentimento específico para o Registro.br**

Antes de abrir o site, perguntar se o usuário prefere browser visível conduzido pelo agente, instruções manuais ou adiamento. O humano faz login, CAPTCHA e confirmações.

- [ ] **Step 3: Criar os registros**

```text
@    A    168.231.91.47
www  A    168.231.91.47
```

Não criar AAAA sem conectividade IPv6 validada.

- [ ] **Step 4: Esperar resolução**

```bash
until test "$(dig +short A jurcrawler.com.br | tail -1)" = 168.231.91.47; do sleep 15; done
until test "$(dig +short A www.jurcrawler.com.br | tail -1)" = 168.231.91.47; do sleep 15; done
```

Expected: ambos resolvem para `168.231.91.47`.

---

### Task 4: Ativar Nginx e Let’s Encrypt com sudo humano

**Files:**
- Remote create: `/home/brpl/apps/prc_jur_crawler/ativar-jurcrawler.sh`
- Remote create: `/etc/nginx/sites-available/jurcrawler.conf`
- Remote create: `/etc/nginx/sites-enabled/jurcrawler.conf`
- Remote create: `/etc/letsencrypt/live/jurcrawler.com.br`

**Interfaces:**
- Consumes: DNS validado e arquivos da Task 2.
- Produces: HTTPS público com renovação testada.

- [ ] **Step 1: Copiar os arquivos para o home remoto**

```bash
scp -i ~/.ssh/whats-organizer-backend \
  infra/nginx/ativar-jurcrawler.sh \
  infra/nginx/jurcrawler-http.conf \
  infra/nginx/jurcrawler.conf \
  brpl@168.231.91.47:/home/brpl/apps/prc_jur_crawler/
```

Expected: arquivos de `brpl`, sem segredo.

- [ ] **Step 2: Executar o único comando privilegiado**

No terminal do dono:

```bash
h2
cd /home/brpl/apps/prc_jur_crawler
sudo ./ativar-jurcrawler.sh
```

Expected: dois `nginx -t` passam, certificado cobre os dois nomes e o dry-run de renovação passa.

- [ ] **Step 3: Verificar os hosts vizinhos**

```bash
curl -fsS -o /dev/null https://whatsorganizer.com.br
curl -fsS -o /dev/null https://legendator.com.br
curl -fsS -o /dev/null https://jurcrawler.com.br/api/v1/saude
```

Expected: os três retornam exit `0`.

---

### Task 5: Executar canário público

**Files:**
- Verify only

**Interfaces:**
- Consumes: chave inicial no clipboard e domínio HTTPS.
- Produces: evidência pública de segurança, crawler e persistência.

- [ ] **Step 1: Provar redirecionamentos e rotas públicas**

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' http://jurcrawler.com.br/)" = 301
test "$(curl -sS -o /dev/null -w '%{http_code}' https://www.jurcrawler.com.br/)" = 301
test "$(curl -sS -o /dev/null -w '%{http_code}' https://jurcrawler.com.br/)" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' https://jurcrawler.com.br/docs)" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' https://jurcrawler.com.br/api/v1/saude)" = 200
```

Expected: PASS.

- [ ] **Step 2: Provar o fechamento da API e MCP**

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' https://jurcrawler.com.br/api/v1/chaves)" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Sec-Fetch-Site: same-origin' https://jurcrawler.com.br/api/v1/chaves)" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://jurcrawler.com.br/mcp)" = 401
```

Expected: `401` nos três casos.

- [ ] **Step 3: Provar Bearer sem expor o valor**

```bash
pbpaste | (
  IFS= read -r jur_chave
  test "$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $jur_chave" \
    https://jurcrawler.com.br/api/v1/chaves)" = 200
)
```

Expected: exit `0`, stdout vazio.

- [ ] **Step 4: Executar uma busca TCU curta**

```bash
set -euo pipefail
jur_key=$(pbpaste)
jur_job=$(curl -fsS -X POST https://jurcrawler.com.br/api/v1/buscas \
  -H "Authorization: Bearer $jur_key" \
  -H 'content-type: application/json' \
  -d '{"tribunal":"tcu","query":"licitação","maxPaginas":1}' | jq -er .id)
for jur_tentativa in $(seq 1 60); do
  jur_status=$(curl -fsS -H "Authorization: Bearer $jur_key" \
    "https://jurcrawler.com.br/api/v1/buscas/$jur_job" | jq -r .status)
  test "$jur_status" = concluido && break
  test "$jur_status" = erro && exit 1
  sleep 2
done
test "$jur_status" = concluido
```

Expected: job concluído sem imprimir a chave.

- [ ] **Step 5: Reiniciar e provar persistência**

```bash
ssh -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47 \
  'docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml restart jur'
until curl -fsS https://jurcrawler.com.br/api/v1/saude >/dev/null; do sleep 2; done
pbpaste | (
  IFS= read -r jur_chave
  test "$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $jur_chave" https://jurcrawler.com.br/api/v1/chaves)" = 200
)
```

Expected: chave continua válida.

- [ ] **Step 6: Provar que 3000 continua privada**

Run: `! nc -z -w 5 168.231.91.47 3000`

Expected: conexão recusada ou timeout.

---

### Task 6: Persistir deploy e alias da opção A

**Files:**
- Create or Modify: `AGENTS.md`
- Modify: `/Users/brpl/code/dotfiles2/aliases/aliases-base`

**Interfaces:**
- Consumes: URL e comandos validados.
- Produces: configuração de deploy e `h2jur`.

- [ ] **Step 1: Adicionar configuração ao AGENTS.md**

```markdown
## Deploy Configuration (configured by /setup-deploy)
- Platform: custom Docker Compose over SSH on h2
- Production URL: https://jurcrawler.com.br
- Deploy workflow: immutable release copied from origin/main, then current symlink switch
- Deploy status command: ssh h2 'docker compose -p jur -f /home/brpl/apps/prc_jur_crawler/current/infra/compose.yml ps'
- Merge method: direct main commits following CLAUDE-GIT.md
- Project type: web app + REST API + MCP
- Post-deploy health check: curl -fsS https://jurcrawler.com.br/api/v1/saude

### Custom deploy hooks
- Pre-merge: cd jur && npm test && npm run test:browser && npm run aceite
- Deploy trigger: manual immutable release over SSH
- Deploy status: Docker Compose health plus public authentication probes
- Health check: https://jurcrawler.com.br/api/v1/saude
- Rollback: restore /home/brpl/apps/prc_jur_crawler/.previous-release as current and run docker compose up -d
```

- [ ] **Step 2: Adicionar o alias**

```zsh
alias h2jur="ssh -N -L 3001:127.0.0.1:3000 -i ~/.ssh/whats-organizer-backend brpl@168.231.91.47"
```

- [ ] **Step 3: Validar**

```bash
grep -A 20 '## Deploy Configuration' AGENTS.md
zsh -n /Users/brpl/code/dotfiles2/aliases/aliases-base
zsh -ic 'source /Users/brpl/code/dotfiles2/aliases/aliases-base; alias h2jur'
curl -fsS https://jurcrawler.com.br/api/v1/saude
```

Expected: seção, alias e saúde válidos.

- [ ] **Step 4: Commitar os repositórios separadamente**

No crawler:

```bash
git add AGENTS.md
git diff --cached --check
git commit -m "chore: registra deploy do jurcrawler"
git push origin main
```

Nos dotfiles:

```bash
cd /Users/brpl/code/dotfiles2
git status --short
git add aliases/aliases-base
git diff --cached --check
git commit -m "feat: adiciona túnel do jurcrawler"
git push
```

---

### Task 7: Fechar BRU-73 com evidência

**Files:**
- External: Linear `BRU-73`

**Interfaces:**
- Consumes: commits, suítes e probes públicos.
- Produces: comentário verificável e issue `Done`.

- [ ] **Step 1: Confirmar identidade e estado**

```bash
linear whoami
linear show BRU-73
```

Expected: Bruno Pellizzetti e `InProgress`.

- [ ] **Step 2: Comentar evidências**

```bash
linear comment BRU-73 $'Implementado e validado em produção.\n\n## Evidências\n- `cd jur && npm test`: passou\n- `cd jur && npm run test:browser`: passou\n- `cd jur && npm run aceite`: passou\n- API sem Bearer: 401\n- API com `Sec-Fetch-Site: same-origin`: 401\n- Bearer válido: 200\n- porta pública 3000: fechada\n- persistência após restart: confirmada\n\n## Critério de QA\n- [x] Passo reproduzível: chamar `GET /api/v1/chaves` apenas com `Sec-Fetch-Site: same-origin`.\n- [x] Resultado esperado: 401; UI com chave e Bearer válido funcionam.\n- [x] Evidência: `jur/tests/autenticacao.test.js`, `jur/tests/browser/interface-real.test.js` e probes públicos.'
```

- [ ] **Step 3: Mover para Done**

```bash
linear move BRU-73 Done
linear show BRU-73
```

Expected: `[Done]` e comentário preservado.
