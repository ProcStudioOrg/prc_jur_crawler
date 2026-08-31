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
mostra a mesma coisa arredondada. Existe também um "content size" de **567 MB** que
aparece em `docker image inspect`/`docker images` em algumas versões do Docker Desktop:
esse número é a soma dos **blobs de camada comprimidos** (o que seria transferido num
`push`/`pull`), não o espaço em disco depois de descompactado — **não usar esse valor
para comparar com estimativas de tamanho de imagem**: o custo real de disco é o de
2.25 GB acima, não os 567 MB do content size.
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

## Exposição na rede — `JUR_BIND` e a porta publicada

**Default: o serviço só responde em loopback**, e as rotas de API exigem chave.

`POST /api/v1/chat` gasta a chave da Anthropic do operador (Opus 5, `max_tokens: 64000`),
e `POST /api/v1/buscas` enfileira crawl real contra os portais dos tribunais usando o IP
dele. Publicado em `0.0.0.0` sem nada na frente, quem alcança a porta enfileira jobs,
lê o acervo de resultados já baixado e gasta o dinheiro do operador no chat. Isso foi
**medido** na revisão final: com `ports: "3000:3000"` o serviço respondia da LAN em
`http://192.168.0.78:3000`.

⚠️ **Um turno de chat não morre junto com a conexão.** Desde a mudança de continuidade,
fechar o navegador (ou perder a rede) **não** aborta a chamada à Anthropic nem cancela as
buscas daquela conversa: o turno vai até o fim, é persistido, e reabrir a conversa
reconecta ao que já chegou (`GET /api/v1/conversas/{id}/stream`). Foi uma troca
deliberada — buscas de jurisprudência levam minutos, e perder o crawl custa mais que
terminar a chamada. Operacionalmente isso significa que **um POST que ninguém está mais
ouvindo continua gastando a chave**, limitado pelo teto de passos do turno
(`MAX_ITERACOES` em `servidor/llm.js`). Vale só quando há onde voltar: sem `conversaId`
(persistência desligada) a política antiga continua valendo, e a desconexão aborta.
Os turnos vivos ficam **em memória** — reiniciar o container mata todos.

Duas travas de exposição, em camadas diferentes:

| Onde | Variável / linha | Default | O que controla |
|---|---|---|---|
| Processo Node | `JUR_BIND` | `127.0.0.1` | em qual endereço o `servidor.listen()` escuta |
| Docker | `ports:` no `compose.yml` | `127.0.0.1:3000:3000` | em qual interface do **host** a porta é publicada |

No `compose.yml` o `JUR_BIND` vale `0.0.0.0` **de propósito**: dentro do container o
processo precisa escutar em todas as interfaces para o Docker conseguir encaminhar a
porta. Quem limita a exposição ali é o prefixo `127.0.0.1:` do `ports`.

**Para expor de propósito** (ex.: outro computador da casa vai usar a interface), mude
as duas pontas conscientemente:

    # docker: publica na LAN
    ports:
      - "3000:3000"          # ou "192.168.0.78:3000:3000" para uma interface só

    # fora do container:
    JUR_BIND=0.0.0.0 node jur/servidor/index.js

Antes de fazer isso, leia a seção seguinte: uma instalação exposta precisa de controle de
acesso de borda. A porta 3000 local deve continuar limitada ao loopback.

## Autenticação — o que a chave de conexão protege e o que ela não protege

As operações de API e MCP passam por uma guarda única no roteador
(`jur/servidor/autenticacao.js`). `GET /api/v1/saude`, `GET /api/v1/openapi.json` e
`GET /docs` são operações públicas; os estáticos, incluindo a página da interface, também
são públicos para que a aplicação possa carregar. Toda operação protegida exige Bearer —
inclusive uma chamada disparada pela interface.

**O que existe:**

- **Chave de conexão.** Todo cliente de uma operação protegida — interface, Claude Code,
  MCP, script ou `curl` — precisa mandar `Authorization: Bearer <chave>`. A interface a
  guarda em `localStorage` como `jur.chaveConexao`. A chave é gerada em
  **Configurações → Chaves de conexão**, e o valor completo aparece **uma vez só**, na
  criação — o servidor guarda hash e prefixo. Bearer ausente, inválido ou revogado recebe
  **401**.
- **Desligar.** `JUR_EXIGIR_CHAVE=0` desliga a exigência de chave inteira
  (`servidor/index.js`). O default — inclusive no `Dockerfile`, que não seta a variável —
  é **ligada**.
- **Barreira de origem.** Antes de qualquer outra coisa — mesmo com `JUR_EXIGIR_CHAVE=0`
  —, a guarda recusa com **403** requisição com `Origin` que não seja loopback nem igual
  ao `Host`. Isso vale para toda rota, com a chave exigida ligada ou desligada: um
  `Origin` hostil recebe **403**.

Mantenha a instalação de desenvolvimento em loopback. A página pública planejada é
`https://jurcrawler.com.br`; para disponibilizá-la fora da máquina, use controle de acesso
de borda (proxy autenticado ou firewall) e não publique `3000` diretamente.

Multiusuário e login continuam fora de escopo (spec §5): as chaves de conexão autenticam
*clientes*, não pessoas — e qualquer chave válida pode emitir outras.

## Comandos

    docker build -f infra/Dockerfile -t jur:dev .
    docker run --rm jur:dev node bin/jur tcu -q "licitacao" -m 1 --json
