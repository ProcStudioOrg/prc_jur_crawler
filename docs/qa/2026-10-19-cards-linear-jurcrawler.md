# QA local — lote dos cards do Linear (19/10/2026)

Branch `feat/cards-linear-20261019`. Nada foi implantado no h2 por este lote; ver
`docs/qa/2026-10-19-producao-tela-entrada.md` para a release em produção (1.0.1).

## Cards atacados

| Card | O que mudou | Evidência |
|---|---|---|
| BRU-88 TJPR Juizados | A CLI já funcionava (`--foro juizados`: 40 julgados na 1ª página, 73.857 no total, 18 órgãos, 0 fora do foro). O bug estava em `servidor/juizados.js`, que marcava o TJPR como "sem recorte" — tela, REST e chat recusavam antes de chamar a CLI. Agora `tjpr: sim(['--foro','juizados'])`; o teste de contrato passou a ler também a linha `--foro` do `--help` (e pegou o TJMA de quebra). | `tests/contrato-cli.test.js`, `tests/juizados.test.js`, `tests/buscas.test.js` |
| BRU-75 Catálogo | `GET /api/v1/tribunais` deixa de carregar `nota` (≈288 KB das ≈316 KB). Novo `GET /api/v1/tribunais/{comando}` devolve o detalhe com `nota`. | listagem: 316.151 → 69.270 bytes; `tests/http.test.js` |
| BRU-87 Limites | Tetos de admissão na fila: `JUR_ATIVAS_POR_CONTA` (12), `JUR_FILA_GLOBAL` (30), `JUR_BUSCAS_POR_HORA` (60). REST responde 429 + `Retry-After`; a ferramenta do chat devolve texto mandando o modelo esperar. Benchmark de carga e parada automática por memória continuam pendentes no card. | `tests/jobs.test.js` (4 testes), `tests/buscas.test.js` (429), `infra/README.md` |
| BRU-77 Gate | `npm run aceite` sem argumento roda a amostra de release (TRT9 `-g 1,2` + TJPR `--foro comum,juizados`) e sai com o pior exit code. `--rapido` pula a rede. | `npm run aceite -- --rapido` → 6/6 + 6/6, APROVADO |
| BRU-76 Conversa vazia | Primeiro turno recusado pelo servidor apaga a conversa recém-criada, volta à tela inicial com o texto preservado e mostra o erro na caixa. | `tests/browser/chat-fluxo.test.js` (novo describe) |
| BRU-91 Feedback | Porte do reporter de issues (wao/FFD): `GET /api/v1/feedback/meta`, `POST /api/v1/feedback`, widget em `publico/feedback.js`. Chave só no servidor; 5/h por conta; idempotente por 10 min; 502 genérico. | `tests/feedback.test.js` (15 testes) |

## Suítes

| Comando | Resultado |
|---|---|
| `npm test` | 448/448 antes do merge do BRU-91 (459/459 no branch do BRU-91) |
| `npm run test:browser` | 102/102 |
| `npm run aceite -- --rapido` | gate APROVADO (TRT9 6/6, TJPR 6/6) |
| `npm run smoke` | 36/41 ok · 5 regressões (ver abaixo) |

## Smoke de 19/10 — regressões novas, não atacadas neste lote

| Tribunal | Classe | Sintoma |
|---|---|---|
| TJGO | vazio | `success:true` com 0 resultados |
| TJMT | erro | HTTP 503 da API |
| TCDF | erro | `unable to verify the first certificate` |
| TCEGO | erro | HTTP 404 em `iago-search-api.tce.go.gov.br/decisions/search` |
| TCEPA | bloqueio | CAPTCHA |

Relatório: `jur/resultados/smoke-2026-10-19-22-23-29.json`. Diagnóstico pelo `jur-fixer`.
