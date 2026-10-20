# Produção 20/10/2026 — release 1.1.0 (lote dos cards do Linear)

## Release

- `origin/main` `7fd6b96` (`chore(release): versão 1.1.0`, sobre o merge `50202d2`).
- `infra/deploy-h2.sh 7fd6b96 1.1.0` executado da máquina `debian2` com a chave `jurcrawler-deploy-debian2-2026-10-20`, autorizada no h2 no mesmo dia.
- Release `20261020-204822-7fd6b96`; anterior `20261019-175149-9558950` (gravada em `.previous-release`).
- Pacote `d6a037d2…8007`; imagem `jur:7fd6b96` (`sha256:bdb3f661…`).
- Antes do deploy, `LINEAR_API_KEY` e `LINEAR_TEAM_ID` (time BrunoDev) entraram no `infra/.env` da release anterior; o script copiou para a nova (18 variáveis).

## Validação

| Verificação | Resultado |
|---|---|
| container temporário (`jurpre`, porta 3100) | `{"ok":true,"versao":"1.1.0"}`; me=401, painel=404, docs=200, login=303, entrada=200, robo=`image/webp`, favicon=`image/svg+xml` |
| SHA de `index.html` / `entrada.js` / `estilo.css` (pré e pós) | iguais a `jur/publico/` |
| backup dos volumes | `SHA256SUMS` OK |
| container `jur-jur-1` | `jur:7fd6b96 healthy` |
| `https://jurcrawler.com.br/api/v1/saude` | 200, `{"ok":true,"versao":"1.1.0"}` |
| `/api/v1/me` · `/__local/painel.js` · `/docs` · `/auth/login` | 401 · 404 · 200 · 303 |
| `/api/v1/openapi.json` | 200; lista `/api/v1/feedback/meta`, `/api/v1/feedback`, `/api/v1/tribunais/{comando}` e a resposta 429 em `POST /api/v1/buscas` |
| log do boot | `aviso de deploy: enviado` |

## O que entrou

BRU-88 TJPR juizados, BRU-75 catálogo enxuto e rota de detalhe, BRU-87 tetos da fila (429 + Retry-After), BRU-76 conversa vazia, BRU-77 gate de aceite, BRU-91 feedback para o Linear. Detalhe em `docs/qa/2026-10-19-cards-linear-jurcrawler.md`.

## Rollback

Conforme `AGENTS.md`: `ln -sfn $(cat .previous-release) current` e `docker compose -p jur -f current/infra/compose.yml up -d --no-build`, preservando volumes.

## Observações do servidor

- h2: 8 vCPU, 31 GiB, disco 387 GB (17 GB usados); produção com `JUR_CONCORRENCIA=5`, `JUR_MEM_LIMIT=4g`, remotos Kernel e Steel.
- Pendências fora do deploy: login por senha no sshd ainda aceito; 13 releases (2,1 GB), 4 tarballs antigos soltos em `apps/prc_jur_crawler` e cache de build do Docker (5 GB) para limpar.
