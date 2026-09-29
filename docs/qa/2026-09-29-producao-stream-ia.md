# Implantação do diagnóstico de interrupções do stream de IA — 29/09/2026

Publicado em https://jurcrawler.com.br às 13:40 UTC (10:40 em São Paulo), a partir da PR #2 mergeada em `main`.

- Código implantado: `7e25ea811bc74424ca86a1c7f11228471db6655c` (merge de `fix/openrouter-stream-abort`).
- Imagem: `jur:7e25ea8`, revisão no label OCI `org.opencontainers.image.revision`.
- Release: `/home/brpl/apps/prc_jur_crawler/releases/20260929-133356-7e25ea8`.
- Release anterior: `/home/brpl/apps/prc_jur_crawler/releases/20260927-192647-8421487` (`jur:8421487`, imagem preservada).
- Configuração privada copiada da release anterior, só `JUR_IMAGE` trocado; cinco vagas e 4 GiB mantidos.

## Validação

| Verificação | Resultado |
| --- | --- |
| `npm test` na branch | 306 testes passaram |
| `npm run test:browser` na `main` mergeada | 90 testes passaram |
| Aceite rápido TJSC | 6/6 critérios obrigatórios |
| Preflight da imagem nova em container temporário com dados isolados | `/api/v1/saude` respondeu 200 |
| Container publicado | `healthy`, imagem `jur:7e25ea8` |
| Saúde pública HTTPS | 200 |
| API sem sessão (`/api/v1/me`) | 401 |
| Laboratório em produção (`/__local/painel.js`) | 404 |
| Login público (`/auth/login`) | 303 para `procstudio.com.br/_auth/jurcrawler` |

## Backup e rollback

Snapshot dos volumes `jur_jur-dados` e `jur_jur-cache` com pausa breve do container anterior em
`/home/brpl/apps/prc_jur_crawler/backups/20260929-133356-7e25ea8/` (`dados-cache.tar.gz`, `SHA256SUMS`,
`previous.env`, `release.json`). `.previous-release` aponta para a release de 27/09; o procedimento de
rollback do [AGENTS.md](../../AGENTS.md) reativa a imagem anterior sem tocar nos volumes.

Não houve login com credenciais reais nem chamada paga a LLM nesta validação.
