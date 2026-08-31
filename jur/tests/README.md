# tests/

Dois níveis, com propósitos distintos.

## 1. Smoke recorrente — `tests/smoke.js`

Responde uma pergunta só: **os tribunais que deveriam funcionar ainda funcionam?**
Lê `cobertura/tribunais.json`, roda uma busca mínima por tribunal (termo neutro, último ano,
`-m 1 --json`) em paralelo, e classifica cada resposta.

```bash
npm run smoke                      # todos os tribunais 🟢
node tests/smoke.js tjgo tjpa      # só esses
node tests/smoke.js --todos        # inclui instáveis/quebrados/bloqueados
node tests/smoke.js --json         # para cron/CI
node tests/smoke.js --timeout 150  # segundos por tribunal (default 90)
```

Exit code **0** = nenhuma regressão · **1** = tribunal que deveria funcionar falhou · **2** = erro de setup.
Cada execução grava `resultados/smoke-<timestamp>.json`.

### Classificação — por que ela existe

O conserto é diferente para cada classe, e é isso que a skill `fixer` usa:

| Status | Significado | Ação |
|---|---|---|
| 🟢 `ok` | `success:true` com resultados | nada |
| 🟡 `vazio` | `success:true` com 0 resultados | filtro/encoding quebrado — quase nunca é "a base está vazia" |
| 🔴 `bloqueio` | Cloudflare / Turnstile / captcha / 403 na saída | bloqueio, não bug — ver `skills/fixer` §4 |
| 🔴 `timeout` | sem resposta no limite | site lento ou fora; repita antes de culpar o código |
| 🔴 `erro` | exceção, DNS, seletor não encontrado | layout ou host mudou — ver `skills/fixer` §2 |

**Regressão** = o tribunal está marcado `ok` na cobertura mas não retornou `ok`.
Tribunais marcados `instavel` / `quebrado` / `sem-acesso` podem falhar sem quebrar o exit code —
é o esperado deles.

### Rodando periodicamente

O ponto do smoke é detectar mudança de site **antes** do usuário. Um cron diário basta:

```cron
0 6 * * * cd /caminho/para/jur && node tests/smoke.js --json >> resultados/smoke.log 2>&1
```

Antes de investigar código depois de uma falha, confirme fora do crawler — foi assim que
descobrimos que o TRF2 tinha migrado de host:

```bash
nslookup <host>
curl -sS -o /dev/null -w "http=%{http_code}\n" --max-time 20 "<url>"
```

## 2. Testes unitários e de integração

```bash
npm test              # node --test "tests/*.test.js"  (puro, sem rede)
npm run test:tjgo     # integração TJGO (rede)
npm run test:tjpa     # integração TJPA (rede) — aceita --rapido
npm run test:tjrs     # integração TJRS (rede) — aceita --rapido
npm run test:tjsc     # integração TJSC (rede + browser, ~3 min) — aceita --rapido
npm run test:trt9     # integração TRT9/FALCÃO (rede) — aceita --rapido
```

- `tests/inteiroTeorFetcher.test.js` — `stripHtml` e `sanitizeFilename`, sem rede.
- `src/TJGOTestes.js`, `src/TJPATestes.js`, `src/TJRSTestes.js`, `src/TJSCTestes.js`,
  `src/TRT9Testes.js` — suítes
  de integração dos tribunais com stack completa (Crawler + Navigator + Checker). A do TJRS
  inclui o teste de desambiguação Justiça Comum × Turmas Recursais por **comparação de
  contagens**; a do TJSC faz o mesmo (Justiça Comum × Turmas Recursais × Uniformização,
  conferindo que a soma das origens fecha com `--origem todas`) e é a única que sobe
  browser — reaproveita **uma** sessão para os 15 testes porque o portal do TJSC cobra
  uma verificação de segurança a cada abertura; a do TRT9 faz o equivalente para 1º grau ×
  2º grau da Justiça do Trabalho (as 4 coleções do FALCÃO) e ainda checa quais operadores
  de busca de fato funcionam.

Tribunal novo com stack completa deve ganhar seu `src/<T>Testes.js` — ver
`CLAUDE-CODEGEN.md` §5, fase 4.

## 3. Testes de browser (Chromium real) — `tests/browser/`

```bash
npm run test:browser    # node --test "tests/browser/*.test.js"
```

Sobem um Chromium de verdade (via Playwright) contra o servidor da interface — não um
`fetch` do Node, que deixa o site escolher headers que nenhum browser real deixaria (ex.:
`Origin` setado à mão). Sobem com `exigirChave:true`, o mesmo padrão de produção
(`infra/Dockerfile` não seta `JUR_EXIGIR_CHAVE`). Todas as suítes recebem uma chave de
conexão real: a interface a salva como `jur.chaveConexao` e envia Bearer nas operações
protegidas.

Ficam fora do glob de `npm test` de propósito: lançar um Chromium custa ~1-2s por suíte, e
essa suíte já tem 188 testes rápidos.

| Arquivo | O que cobre |
|---|---|
| `interface-real.test.js` | a página pública carrega; com uma chave de conexão real em `jur.chaveConexao`, a interface envia Bearer e acessa a API; um `curl` sem credencial continua tomando 401 |
| `chat-fluxo.test.js` | regressão dos três achados da revisão da Task 7 — trocar de modelo para o Haiku não quebra o chat mandando um campo que ele rejeita; trocar de conversa no meio do streaming não vaza texto/histórico para a conversa errada; dois `Enter` quase simultâneos na tela inicial criam só uma conversa |

**6 testes** ao todo. Teste que ninguém sabe que existe não protege ninguém — rode este
`npm run test:browser` sempre que mexer em `jur/servidor/autenticacao.js` ou em
`jur/publico/*.js`.
