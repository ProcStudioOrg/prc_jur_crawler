# Produção 21/10/2026 — release 1.2.1 (sentinela ligada)

## Validação ao vivo dos casos (antes da release)

- `docker exec jur-jur-1 node tests/sentinela.js --timeout 120` na 1.2.0 (`jur:b80d430`), 10:42–11:03 UTC, sem `--enviar`.
- 87 casos locais (2 remotos fora): **59 ok · 16 falhas · 12 não verificáveis · 0 pulados**.
- Cada falha foi repetida do Mac para separar caso, crawler/portal e IP do H2:

| Tribunal × capacidade | H2 | Mac | Decisão |
|---|---|---|---|
| STF periodoJulgamento/periodoPublicacao/numero | WAF: sem cookie `aws-waf-token` | igual | `_pendentes` (regressão do crawler) |
| TCDF 4 capacidades | `unable to verify the first certificate` | igual | `_pendentes` (cadeia TLS do tribunal; crawler precisa da intermediária) |
| TJMS magistrado | 83/96 de outro relator | igual | `_pendentes` (filtro ignorado) |
| TJPI periodoPublicacao | 25/25 fora do período | igual | `_pendentes` (filtro ignorado) |
| TJRJ ejuris periodoJulgamento | 10/10 fora do período | igual | `_pendentes` (filtro ignorado) |
| TJES juizados/numero | HTTP 403 (`bloqueio_ip`) / 0 resultado | ok | `_pendentes` (IP do H2 bloqueado) |
| TJMT 3 capacidades | HTTP 503 da API | igual | fica (tribunal fora no dia) |
| TJRO juizados | timeout 120 s | ok | fica (transitório) |

- Não verificáveis (ficam, não geram falha): `numero` nos TCs e CARF (número sem forma CNJ), `tjrj-ejuris numero` (resultado é a consulta), `tceba numero` (prefixo `TCE/`), `tcees periodoJulgamento` (2 com campo, mínimo 3).
- Resultado: 77 casos ativos; motivos em `_pendentes` de `jur/tests/sentinela-casos.json`; lista de `jur-fixer` em `docs/kaizen.md` > Pendências.

## Release

- `origin/main` `9f42f24` (`chore(release): versão 1.2.1`).
- `JUR_SENTINELA=1` gravado no `infra/.env` da release anterior (backup `.env.bak-20261021`) antes do deploy; o script copiou para a nova.
- `infra/deploy-h2.sh 9f42f24 1.2.1` executado do Mac mini às 11:14 UTC.
- Release `20261021-111423-9f42f24`; anterior `20261020-210840-b80d430` (1.2.0).
- Pacote `9f0b852a…f2c2`; imagem `jur:9f42f24` (`sha256:94498b65…`).

## Validação

| Verificação | Resultado |
|---|---|
| gate local | `npm test` 672/672 · `test:browser` 102/102 · `aceite --rapido` aprovado |
| container temporário (`jurpre`) | `{"ok":true,"versao":"1.2.1"}`; me=401, painel=404, docs=200, login=303, entrada=200, robo=`image/webp`, favicon=`image/svg+xml` |
| SHA de `index.html` / `entrada.js` / `estilo.css` (pré e pós) | iguais a `jur/publico/` |
| backup dos volumes | `jur_jur-dados.tgz: OK`, `jur_jur-cache.tgz: OK` |
| container `jur-jur-1` | `jur:9f42f24 healthy` |
| `https://jurcrawler.com.br/api/v1/saude` | `{"ok":true,"versao":"1.2.1"}` |
| dentro do container | `JUR_SENTINELA=1`; 77 casos em `tests/sentinela-casos.json` |
| log do boot | `aviso de deploy: enviado`; `sentinela: agendada às 04:00` |
| rodada de boot (versão nova, 5 min após subir, com remotos) | `[sentinela] 77 rodados · 62 ok · 3 falhas · 12 não verificáveis · 0 pulados` (11:19–11:35 UTC); as 3 falhas são o TJMT (HTTP 503 da API, confirmado de novo às 11:40); os 2 remotos (TRF3/Falcão) passaram |
| FFD | uma linha `[kaizen] FFD indisponivel (500)` durante a rodada; a outbox (`kaizen_envio`) terminou vazia, sem `descartado`: os 4 envios (3 falhas + resumo) entraram na retentativa e foram aceitos. Conferido no `dashboard.db` do NAS: `jur_sentinela_resumos` id 1 (`1.2.1`/`9f42f24`, 77/62/3/12, `em` 11:35:06Z) e `jur_falhas` ids 2–4 (`origem: sentinela`, `tjmt`, classe `desconhecido`, assinatura `novo`). O log do container do FFD não é legível sem root no NAS (o motivo do 500 fica em aberto). |

## Pendente (fora deste deploy)

- `jur-fixer` nos 7 tribunais listados em `docs/kaizen.md` (TJGO, STF, TCDF, TJMS, TJPI, TJRJ ejuris, TJES); ao consertar, devolver o caso de `_pendentes` para `casos`.
- Smoke do Kaizen de ponta a ponta (falha forçada → `/jur-falhas`; relato → card BRU + User Issues): adiado por decisão.
