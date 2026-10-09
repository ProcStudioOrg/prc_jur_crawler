# Implantação em produção — painel de tribunais redesenhado

Data: 2026-10-09. Ambiente: produção (`https://jurcrawler.com.br`).

- Commit: `96b244a` (merge de `redesign/painel-tribunais` na `main`).
- Imagem: `jur:96b244a` (`sha256:e6ad68ef…`), revisão gravada no label OCI.
- Release: `/home/brpl/apps/prc_jur_crawler/releases/20261009-092529-96b244a`.
- Release anterior: `releases/20260929-133356-7e25ea8` (`jur:7e25ea8`, imagem preservada).
- Pacote: `git archive` da `origin/main`, SHA-256 `65b2d03a…` conferido antes e depois do envio.
- Sem mudança em `infra/`, `package-lock.json` ou variáveis de ambiente; `.env` copiado da release anterior trocando só `JUR_IMAGE`.

## O que entra

Escopo de busca por seleção com a barra "Buscar em", grade de tribunais agrupada por
segmento, ficha do tribunal com resumo e tabela de capacidades, consulta por número
pelo chat e pela API, período de publicação, juizados e inteiro teor sob demanda.

## Validação antes da troca

| Verificação | Resultado |
|---|---|
| `npm test` (branch e após o merge) | 431/431 |
| `npm run test:browser` | 100/100 |
| `npm run aceite -- TJSC --rapido` | 6/6 obrigatórios |
| Container temporário `jurpre` (volumes próprios, porta 3100 em loopback) | healthy; `/saude` 200, `/me` 401, `/__local/painel.js` 404, `/auth/login` 303 → ProcStudio |
| Arquivos públicos do painel no temporário | SHA-256 idênticos aos da release |
| Busca real TJSC dentro da imagem nova | `success: true`, 10 resultados |

O container temporário e seus volumes foram removidos antes da troca.

## Validação após a troca

| Verificação | Resultado |
|---|---|
| Container `jur-jur-1` | `jur:96b244a`, healthy |
| `/api/v1/saude` | 200 |
| `/api/v1/me` sem sessão | 401 |
| `/__local/painel.js` | 404 |
| `/auth/login` | 303 para `procstudio.com.br/_auth/jurcrawler`; cookie `jur_attempt` HttpOnly + Secure |
| `/docs` | 200 |
| `index.html`, `app.js`, `escopo.js`, `disponibilidade.js`, `estilo.css` | SHA-256 idênticos ao commit `96b244a` |

## Backup e rollback

Snapshot de `jur_jur-dados` e `jur_jur-cache` com pausa breve do container anterior em
`backups/20261009-092529-96b244a/` (`dados-cache.tar.gz`, `SHA256SUMS` conferido,
`previous.env`, `release.json`). Durante a pausa o healthcheck do container antigo
marcou `unhealthy`; voltou a `healthy` sozinho antes da troca. `.previous-release`
aponta para `7e25ea8`; o rollback de [AGENTS.md](../../AGENTS.md) reativa essa imagem
sem tocar nos volumes.

## Limites desta validação

Não foi feito login com conta real nem chamada paga a LLM nesta publicação; o percurso
autenticado do painel novo segue coberto pelos testes de navegador.
