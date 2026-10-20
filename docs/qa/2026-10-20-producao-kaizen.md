# Produção 20/10/2026 — release 1.2.0 (Kaizen: falhas, sentinela e Relatar)

## Release

- `origin/main` `b80d430` (`chore(release): versão 1.2.0`, sobre o merge `d6501e7` do Kaizen com a 1.1.0).
- `infra/deploy-h2.sh b80d430 1.2.0` executado do Mac mini às 21:08 UTC.
- Release `20261020-210840-b80d430`; anterior `20261020-204822-7fd6b96` (1.1.0, lote dos cards), gravada em `.previous-release`.
- Pacote `1b351464…c65c`; imagem `jur:b80d430` (`sha256:4d8271ec…`).
- Envs acrescentadas ao `infra/.env` da release anterior antes do deploy (o script copiou para a nova):
  `KAIZEN_WEBHOOK_URL` (41 caracteres), `KAIZEN_WEBHOOK_TOKEN` (50, endpoint key `jurcrawler` do FFD, criada em 19/10),
  `KAIZEN_SALT` (44, `openssl rand -base64 32` no h2), `JUR_SENTINELA=0`. `LINEAR_API_KEY` e `LINEAR_TEAM_ID` já existiam.
  O token do FFD respondeu 400 (corpo vazio) e não 401 no `/jur-diagnostico`: aceito.

## O que mudou em relação à 1.1.0

- Kaizen completo (`docs/kaizen.md`): captura de falha, conferência de filtros, resgates, outbox para o FFD, botão Relatar, sentinela (desligada).
- O botão "Reportar" do BRU-91 (`/api/v1/feedback`, `publico/feedback.js`) saiu: o Relatar (`/api/v1/relatos`) o absorve e ganhou a idempotência dele.
- `deploy-h2.sh`: o container de validação roda com `KAIZEN_WEBHOOK_URL`, `LINEAR_API_KEY` vazios e `JUR_SENTINELA=0`.

## Validação

| Verificação | Resultado |
|---|---|
| gate local | `npm test` 672/672 · `test:browser` 102/102 (1 timeout isolado, passou sozinho) · `aceite --rapido` aprovado |
| container temporário (`jurpre`, porta 3100) | `{"ok":true,"versao":"1.2.0"}`; me=401, painel=404, docs=200, login=303, entrada=200, robo=`image/webp`, favicon=`image/svg+xml`; sem aviso de deploy (esperado) |
| SHA de `index.html` / `entrada.js` / `estilo.css` (pré e pós) | iguais a `jur/publico/` |
| backup dos volumes | `jur_jur-dados.tgz: OK`, `jur_jur-cache.tgz: OK` |
| container `jur-jur-1` | `jur:b80d430 healthy` |
| `https://jurcrawler.com.br/api/v1/saude` | 200, `{"ok":true,"versao":"1.2.0"}` |
| `/api/v1/me` · `/__local/painel.js` · `/docs` · `/auth/login` | 401 · 404 · 200 · 303 |
| `/relatar.js` · `/issue-reporter/widget.js` · `/feedback.js` | 200 · 200 · **404** (BRU-91 removido) |
| dentro do container | `JUR_SENTINELA=0`; `KAIZEN_WEBHOOK_TOKEN` presente |
| log do boot | `aviso de deploy: enviado`; nenhuma linha `[kaizen]` |

## Pendente (fora deste deploy)

- Validar os casos da sentinela no h2 (`docker exec jur-jur-1 node tests/sentinela.js --json`) antes de `JUR_SENTINELA=1`.
- Smoke do Kaizen de ponta a ponta: forçar uma falha e conferir `/jur-falhas` no FFD; um relato pelo botão Relatar (card BRU + User Issues).
- Rotacionar `LINEAR_API_KEY` (a chave atual apareceu num log de sessão local em 20/10) e trocar no `infra/.env` da release atual.

## Rollback

Conforme `AGENTS.md`: `ln -sfn $(cat .previous-release) current` e `docker compose -p jur -f current/infra/compose.yml up -d --no-build`, preservando volumes.
