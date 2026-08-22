# infra — imagem e execução do `jur`

## Imagem

`node:22-slim` + `playwright install --with-deps chromium`. Firefox e webkit não são
instalados: nenhum crawler do repo os usa.

`TMPDIR=/cache` existe por causa do STF — `STFNavigator.js:43` cacheia o cookie
`aws-waf-token` em `os.tmpdir()`, e ele vale ~4 dias. Sem volume em `/cache`, todo
recreate refaz o desafio do WAF.

Build nativo arm64 (host Apple Silicon), sem emulação — `docker image inspect jur:dev`
confirma `"Architecture": "arm64"`. Não foi preciso cair para `--platform=linux/amd64`.

Imagem final: **2.25 GB em disco** (`docker system df -v`, coluna SIZE/UNIQUE SIZE —
esse é o número que importa, quanto a imagem ocupa de fato no host). `docker images`
mostra a mesma coisa arredondada. Existe também um "content size" de ~700 MB que
aparece em `docker image inspect`/`docker images` em algumas versões do Docker Desktop:
esse número é a soma dos **blobs de camada comprimidos** (o que seria transferido num
`push`/`pull`), não o espaço em disco depois de descompactado — **não usar esse valor
para comparar com estimativas de tamanho de imagem**, que sempre se referem a disco.
Medido em 22/08/2026, depois da exclusão de `jur/human-codegen/**/*.png` (ver abaixo).
Antes dessa exclusão a imagem tinha 2.53 GB em disco.

A maior parte do peso é o próprio `--with-deps` (libs de sistema do Debian que o
Chromium do Playwright precisa: X11, Mesa, NSS, fontconfig, etc.) — sozinho esse layer
pesa **1.37 GB**, contra bem menos do Chromium/Chrome-headless-shell/ffmpeg baixados
pelo `playwright install` (~195 MB comprimidos na rede, mais expandidos em disco).
Reduzir mais isso exigiria trocar de estratégia — instalar só o subconjunto mínimo de
libs em vez de `--with-deps`, ou partir de `mcr.microsoft.com/playwright` (que já as
inclui de forma mais enxuta) — o que é decisão de arquitetura de base de imagem, fora
do escopo desta task.

### Dois defeitos do Dockerfile descobertos ao vivo (e corrigidos nesta task)

O rascunho original do Step 1 tinha dois problemas que só apareceram ao rodar os
comandos dos Steps 4 e 5 — nenhum dos dois é sandbox de Chromium, são bugs comuns de
imagem Node rodando como usuário não-root:

1. **`EACCES` ao gravar resultado.** Todo comando do `jur` grava por padrão em
   `resultados/results-<tribunal>.json`, caminho relativo ao `WORKDIR` (`/app`). O
   Dockerfile original só criava e dava `chown` em `/dados/resultados`, um caminho que
   nada no código usa — `/app` continuava dono de `root` do `COPY jur/ ./`, e o
   `USER node` seguinte apanhava `EACCES: permission denied, mkdir '/app/resultados'`
   no primeiro comando (Step 4, `tcepe`). Corrigido criando e dando `chown` também em
   `/app/resultados` (mantendo `/dados/resultados` reservado para quando a Task 13
   montar um volume externo).

2. **Chromium instalado num HOME que o runtime não usa.** `npx playwright install`
   roda como `root` (antes do `USER node`), e sem `PLAYWRIGHT_BROWSERS_PATH` fixo ele
   grava em `/root/.cache/ms-playwright`. Depois do `USER node`, `HOME` vira
   `/home/node` e o `chromium.launch()` procura o browser em
   `/home/node/.cache/ms-playwright` — que não existe. Erro observado no Step 5:
   `browserType.launch: Executable doesn't exist at
   /home/node/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell`.
   Corrigido fixando `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` antes do install e
   dando `chown -R node:node /ms-playwright` na mesma camada — install-time e run-time
   passam a apontar para o mesmo lugar.

Sem essas duas correções, o Step 4 (sem browser) e o Step 5 (com browser) falhavam por
permissão/path, não por causa do container recusar rodar Chromium — por isso vale
registrar como problema de imagem, não de sandbox.

## Sandbox do Chromium

Escada testada em 22/08/2026, nesta ordem:

| Nível | Como | Resultado |
|---|---|---|
| 1 — usuário não-root, seccomp padrão | `docker run jur:dev` | **Passou.** `tcu -q "licitacao" -m 1 --json` devolveu `{"success":true,"count":20,...}`. Mesma contagem (20) rodando o mesmo comando fora do container (`cd jur && node bin/jur tcu -q "licitacao" -m 1 --json`), confirmando que não foi coincidência de rede. |
| 2 — perfil seccomp da Playwright | `--security-opt seccomp=infra/chrome-seccomp.json` | Não testado — Step 5 passou no nível 1, então os Steps 6/7 do plano foram pulados (instrução explícita do brief: "Se passar, pule os Steps 6 e 7"). |
| 3 — `--no-sandbox` | `-e JUR_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage"` | Não testado, pelo mesmo motivo. `BaseCrawler.js` **não foi alterado** — o hook de `JUR_BROWSER_ARGS` do Step 7 não foi implementado porque nunca foi necessário. |

**Nível em uso: 1 (usuário não-root `node`, seccomp padrão do Docker Desktop, sem
flags extras).** Motivo: o Chromium do Playwright sobe headless dentro do container
sem nenhuma barreira adicional — nem perfil seccomp customizado nem `--no-sandbox`
foram necessários. O sandbox nativo do Chromium permanece ligado.

## Tribunais não suportados em container

- **`trf3`** — `TRF3Crawler.js:10` passa `useSystemChrome: true`, que vira `channel: 'chrome'`
  e exige o Google Chrome proprietário, ausente da imagem. Já estava `instavel`.
- **`crps`** — exige login Gov.br com validação de dispositivo; container é, por definição,
  dispositivo desconhecido. Ver `CLAUDE-CRPS.md`.

## Comandos

    docker build -f infra/Dockerfile -t jur:dev .
    docker run --rm jur:dev node bin/jur tcu -q "licitacao" -m 1 --json
