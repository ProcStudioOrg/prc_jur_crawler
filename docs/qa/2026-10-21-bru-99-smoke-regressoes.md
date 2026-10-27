# QA local — BRU-99: as 5 regressões do smoke de 19/10 (21/10/2026)

Branch `brpl/bru-99-jurcrawler-smoke-1910-corrigir-5-regressoes-tjgo-tjmt-tcdf`. Nada foi
implantado no h2 por este lote. Diagnóstico pelo `jur-fixer` (classe layout × bloqueio ×
infraestrutura), um commit por tribunal.

## Antes (21/10, 12:56) — `node tests/smoke.js tjgo tjmt tcdf tcego tcepa`

| Tribunal | Status | Detalhe |
|---|---|---|
| TJGO | vazio | `success:true` mas 0 resultados |
| TJMT | erro | `HTTP 503 da API do TJMT (<!DOCTYPE html>` |
| TCDF | erro | `unable to verify the first certificate` |
| TCEGO | erro | `HTTP 404 em iago-search-api.tce.go.gov.br/decisions/search` |
| TCEPA | bloqueio | CAPTCHA |

0/5 ok · 5 regressões (`jur/resultados/smoke-2026-10-21-12-56-34.json`, fora do git).

## Diagnóstico e ação

| Tribunal | Classe (fixer) | O que mudou no portal | Ação | Commit |
|---|---|---|---|---|
| TCDF | **infra** — cadeia TLS incompleta | Os dois hosts mandam só a folha, agora emitida pela intermediária nova do Let's Encrypt `YR1`, cuja raiz `ISRG Root YR` (05/2026) não está no trust store do Node 22. `curl` no macOS passa (AIA); o Node não. | Embute `YR1` + `Root YR` cross-assinada pela `X1` em `src/certs/` e passa `ca` só no `TCDFNavigator`. Teste cru da suíte usa a mesma cadeia. | `fix(tcdf)`, `test(tcdf)` |
| TCEGO | **D — contrato da API** | (1) host direto `iago-search-api` responde 404 em tudo; a API vive em `decisoes.tce.go.gov.br/api/proxy` (baseURL literal no bundle novo). (2) A busca exige o cookie `_tce_nav_ctx` do GET da home e, sem ele, responde HTTP 200 com total 0 e `size` ignorado — e o cookie tem idade mínima (300 ms falha, 700 ms passa). (3) Rate limit `x-ratelimit-limit: 20`. | Navigator fala com o proxy, colhe o cookie, espera 1,5 s uma vez por processo, guarda o cookie original, trata 429 e transforma a casca em erro explícito. | `fix(tcego)` |
| TJMT | **infra** — manutenção declarada | Todo caminho de `hellsgate-preview` responde HTTP 503 (BigIP) com "Site em manutenção — TJMT". SPA, host e token não mudaram; `hellsgate` sem `-preview` é 404; `www.tjmt.jus.br` no ar. | Navigator nomeia a manutenção; catálogo `instavel` com nota e instrução de retorno; casos da sentinela em `_pendentes`. | `fix(tjmt)` |
| TJGO | **C — bloqueio** (Turnstile na busca) | Zera sem período, com período e com termo alternativo. O POST devolve a própria tela do formulário sem painel de resultados — com token vazio, falso e com `JSESSIONID`. O `#btnBuscar` nasce desabilitado e só o callback do Turnstile o habilita (`js/ConsultaJurisprudencia.js v0.0.7`). Lupas AJAX seguem livres. | Navigator lança erro explícito (zero por bloqueio não vira "0 resultados"); catálogo `sem-acesso`; print `01.15-turnstile-na-busca.png`; ressalva 00 no guia. Não automatizamos captcha. | `fix(tjgo)` |
| TCEPA | **C — bloqueio** (captcha de imagem) | O F5 Shape devolve o captcha já no **primeiro** request de `/pesquisaintegrada/`, três vezes após 5, 18 e 20+ min de silêncio; a home do portal responde normal. O cooldown de 6–7 min não destrava. | Catálogo `sem-acesso` com nota; ressalva 0 no guia com o procedimento de reavaliação. O crawler já abortava com erro explícito. | `fix(tcepa)` |

## Depois (21/10, 14:13–14:16)

`node tests/smoke.js tjgo tjmt tcdf tcego tcepa` (só os `ok` do catálogo):

| Tribunal | Status | Detalhe |
|---|---|---|
| TCEGO | ok | 1 resultado ("dano moral", 21/10/2025–21/10/2026) |
| TCDF | ok | 53 resultados |

2/2 ok · 0 regressões. Com `--todos` (inclui os rebaixados):

| Tribunal | Esperado | Status | Detalhe |
|---|---|---|---|
| TCEPA | sem-acesso | bloqueio | CAPTCHA |
| TJGO | sem-acesso | bloqueio | Cloudflare Turnstile (erro nomeado, não mais "0 resultados") |
| TJMT | instavel | erro | `API do TJMT em MANUTENCAO: ... "Site em manutencao — TJMT" (BigIP)` |
| TCEGO | ok | ok | 1 resultado |
| TCDF | ok | ok | 53 resultados |

2/5 ok · **0 regressões** (`jur/resultados/smoke-2026-10-21-14-16-13.json`). Os três
rebaixados aparecem em `jur/cobertura/CLAUDE-FALHAS.md` com motivo.

## Suítes

| Comando | Resultado |
|---|---|
| `node src/TCDFTestes.js` | 16/18 antes do ajuste do teste cru; a falha de TLS some com `TCDFNavigator.CA`. A outra (`licitação`: total 6.684 vs 6.892 entre páginas de tamanhos diferentes) é deriva do índice do tribunal, não TLS. |
| `node src/TCEGOTestes.js` | 37/37 |
| `node tests/sentinela.js tcdf tcego` | TCDF 3 ok · `numero` n/v (número sem forma CNJ, como nos demais TCs); TCEGO sem caso (`_pendentes`) |
| `node tests/smoke.js tjgo tjmt tcdf tcego tcepa` | 2/2 ok, 0 regressões; `--todos` 2/5 ok, 0 regressões |
| `npm test` | **671/672** na rodada final. Na primeira rodada (668/672) 2 falhas eram do catálogo (`capacidades.json` sem resumo dos rebaixados; casos do TJMT na sentinela) e foram corrigidas no `chore(catalogo)`; `foto do close ≤ 1,5 s` passou na repetição. A única que resta, `llm: roda tools do mesmo turno em paralelo (~150 ms, levou ~830 ms)`, é asserção de tempo e **falha igual na `main`** (medido num worktree limpo da `main`, 18/19) — máquina carregada por 5 sessões em paralelo; não toca código deste lote. |
| `npm run docs` | regenerado (`CLAUDE-FALHAS.md`, `tribunais.json`, `INDEX.md` de TJGO e TCEGO) |

## Evidências novas em `human-codegen/`

- `TJGO/01-projudi/01.15-turnstile-na-busca.png` + adendo em `01-consulta-jurisprudencia.txt`
  (HTML do widget e o `submitForm()` novo).
- `TCEGO/01-decisoes/01.07-iago-proxy-outubro-2026.png` + adendo em `01-decisoes.txt`
  (cliente axios do bundle, REQ/RESP capturados, tabela de medições do cookie).

## Pendências abertas por este lote

- Reavaliar TJMT (manutenção), TJGO (Turnstile) e TCE-PA (captcha) e promover de volta no
  catálogo quando os portais mudarem — card de acompanhamento no Linear.
- TJGO: se a busca continuar atrás do Turnstile, avaliar o fluxo de intervenção humana do
  painel Navegadores (como STJ/TJSP), sem automatizar o desafio.
