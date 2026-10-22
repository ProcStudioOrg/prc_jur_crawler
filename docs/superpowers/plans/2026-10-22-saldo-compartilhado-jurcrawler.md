# Saldo compartilhado — lado JurCrawler (Node) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conexão "ProcStudio" nativa no chat do JurCrawler (GLM-5.3 Flash via OpenRouter), cobrada por rodada do saldo de IA do time, com saldo e custo visíveis e bloqueio por saldo; BYOK vira opção avançada.

**Architecture:** O adaptador de provedores passa a devolver `usage`; uma conexão virtual `procstudio` é injetada no repositório de conexões a partir do ambiente; um módulo `cobranca` por conta faz pré-checagem, registro idempotente com retentativa e fila local de pendências contra os endpoints `ai_balance`/`ai_usage` do Rails; `llm.conversar` ganha ganchos por rodada; a rota de chat emite `custo` e bloqueia com 402; a interface mostra saldo, custo por resposta e o cartão de recarga.

**Tech Stack:** Node 22 (`node --test`, `node:sqlite`), Playwright para testes de navegador, vanilla JS no `publico/`.

**Spec:** `/Users/brpl/code/ProcStudio/prc_jur_crawler/docs/superpowers/specs/2026-10-22-saldo-compartilhado-procstudio-design.md` (seções 3, 4.1, 4.3, 4.4, 4.5). O contrato dos endpoints Rails está no plano irmão `2026-10-22-saldo-compartilhado-procstudio-rails.md`, Task 3.

**Repositório de trabalho:** `/Users/brpl/code/ProcStudio/prc_jur_crawler`, diretório `jur/`. Testes: `cd jur && npm test` (unitário) e `npm run test:browser`.

## Global Constraints

- Variáveis de ambiente: `PROCSTUDIO_LLM_API_KEY` (vazia = conexão ProcStudio não existe), `PROCSTUDIO_LLM_ENDPOINT` (padrão `https://openrouter.ai/api/v1`), `PROCSTUDIO_LLM_MODELO` (padrão `z-ai/glm-5.3-flash`), `PROCSTUDIO_LLM_MODELO_CATALOGO` (padrão `glm-5.3-flash`), `PROCSTUDIO_LLM_UPSTREAM` (padrão `z-ai`; vazio = sem `provider` no corpo), `PROCSTUDIO_LLM_ROTULO` (padrão `GLM-5.3 Flash`).
- Id da conexão virtual: `'procstudio'`; `provider: 'procstudio'`. Nunca gravada no `jur.db` do usuário; nunca devolve a chave.
- Nenhuma chamada ao provedor na conexão ProcStudio sem `canOperate` verdadeiro obtido há menos de 30 s.
- `request_id` = `${conversaId || 'avulso-' + uuid}:${turnoId}:${rodada}`, onde `turnoId` é um UUID gerado por tentativa de turno (nunca índice derivado da contagem de mensagens).
- Falha ao registrar uso: 2 retentativas (1 s, 3 s); depois grava em `cobranca_pendente` e encerra o turno com erro. Estados terminais da pendência: HTTP 410, 422, 401 (do design) e também 403/404 (`TEAM_REJECTED`: time demo ou inexistente não muda com o tempo; decisão do plano, mesma lógica). Varredor a cada 60 s enquanto houver pendência, e no boot.
- Stream da conexão ProcStudio sem `usage` → erro `code: 'USAGE_MISSING'`, turno para, log `event: "llm_usage_missing"`.
- Falha da chave do operador (402/429/5xx do OpenRouter, `pricing_unavailable` do Rails) → erro `code: 'PROCSTUDIO_LLM_INDISPONIVEL'`, mensagem "A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.", log `event: "procstudio_llm_operator_failure"`, payload `jur-diagnostico` na outbox do Kaizen.
- Mensagem de saldo: "Seu saldo de IA do ProcStudio acabou (R$ −0,52). Adicione créditos para continuar." (valor formatado pt-BR).
- Timeout das chamadas ao Rails: 5 s (mesmo `pedir` de `procstudio.js`). 400/401/403 do Rails continuam virando `null`/falha fechada como hoje, exceto onde a Interfaces abaixo diz o contrário.
- Textos em pt-BR; código e comentários no estilo do repositório (pt-BR sem acento nos nomes de função).

## Review Focus

- Usuário com BYOK selecionado não passa por `ai_balance` nem `ai_usage`, e a pílula de saldo continua visível (teste na Task 6 e Task 9).
- Turno que o cliente abandona (aba fechada) continua cobrando por rodada e persiste os custos; ao reabrir a conversa os custos aparecem (teste na Task 6).
- Duas rodadas concorrentes do mesmo time (duas conversas) não compartilham cache de `canOperate` indevidamente: o cache é por conta (owner), e o `ai_usage` de uma atualiza o cache da outra se devolveu `can_operate: false` (teste na Task 4).
- Evento `custo` chega antes do `fim` e também em `GET /conversas/:id/stream` para quem reanexa (teste na Task 6).
- `PROCSTUDIO_LLM_API_KEY` vazia: nada da conexão aparece, `GET /saldo` devolve `disponivel: false`, chat exige BYOK como hoje (teste na Task 2 e Task 7).

---

### Task 1: Adaptador devolve `usage` e aceita extras no corpo

**Files:**
- Modify: `jur/servidor/provedores/index.js`
- Test: `jur/tests/provedores.test.js`

**Interfaces:**
- Produces: `finalMessage()` devolve `{ content, stop_reason, usage }` com `usage = { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, generation_id }` (`null` nos campos que o provedor não informou; `usage` inteiro `null` se nenhum chegou). Conexão aceita `extras: Object` que é mesclado no corpo do pedido OpenAI-compatível (ex.: `{ provider: {...}, usage: { include: true } }`). Pedidos OpenAI-compatíveis sempre enviam `stream_options: { include_usage: true }`.

- [ ] **Step 1: Testes**

```js
test('OpenAI-compatível envia stream_options e captura usage com cost do OpenRouter', async () => {
  // chunks: texto, depois chunk final com usage {prompt_tokens: 120, completion_tokens: 30,
  // prompt_tokens_details: {cached_tokens: 20}, cost: 0.0042}, id 'gen-abc', finish_reason 'stop'
  // conexão openrouter com extras: { provider: { order: ['z-ai'], allow_fallbacks: false }, usage: { include: true } }
  assert.deepEqual(sent.stream_options, { include_usage: true });
  assert.deepEqual(sent.provider, { order: ['z-ai'], allow_fallbacks: false });
  assert.deepEqual(sent.usage, { include: true });
  assert.deepEqual(r.usage, { input_tokens: 120, output_tokens: 30, cache_read_tokens: 20, cache_write_tokens: null, cost_usd: 0.0042, generation_id: 'gen-abc' });
});
test('OpenAI-compatível sem chunk de usage devolve usage null', …);
test('Anthropic devolve usage a partir de finalMessage().usage', …); // input 10, output 5, cache_read_input_tokens 3, cache_creation_input_tokens 1 → cost_usd null, generation_id = message.id
test('Gemini devolve usage a partir de usageMetadata', …); // promptTokenCount, candidatesTokenCount, cachedContentTokenCount
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/provedores.test.js`
Expected: FAIL (`usage` undefined; `stream_options` ausente).

- [ ] **Step 3: Implementar** em `criarCliente`: ler `data.usage` nos chunks OpenAI (guardar o último não-nulo), `data.usageMetadata` no Gemini, `mensagem.usage` + `mensagem.id` no wrapper Anthropic; mesclar `connection.extras` no corpo; normalizar com a função `normalizarUso(provider, bruto, generationId)` exportada para teste.

- [ ] **Step 4: Rodar** `node --test tests/provedores.test.js` → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(provedores): usage por rodada e extras no corpo"`

---

### Task 2: Configuração e conexão virtual `procstudio`

**Files:**
- Create: `jur/servidor/conexao-procstudio.js`
- Modify: `jur/servidor/conexoes-llm.js`
- Modify: `jur/servidor/rotas/conexoes-llm.js`
- Modify: `jur/servidor/aplicacao.js` (passar `gerenciada` ao `criarConexoes`)
- Modify: `infra/.env.example`, `infra/compose.yml`
- Test: `jur/tests/conexao-procstudio.test.js`, `jur/tests/conexoes-llm.test.js`

**Interfaces:**
- Produces:
  - `conexaoProcstudio.doAmbiente(env = process.env)` → `null` quando `PROCSTUDIO_LLM_API_KEY` vazia; senão `{ apiKey, endpoint, modelo, modeloCatalogo, upstream, rotulo, extras }` com `extras = { usage: { include: true }, provider: { order: [upstream], allow_fallbacks: false } }` só quando o endpoint é `openrouter.ai` e `upstream` não vazio.
  - `criarConexoes({ con, owner, cofre, transport, gerenciada })`: `listar()` começa por `{ id: 'procstudio', provider: 'procstudio', name: 'ProcStudio', model: modeloCatalogo, endpoint: null, maskedKey: null, fixa: true, rotulo }`; `obter('procstudio')` idem; `cliente('procstudio')` = `criarCliente({ provider: 'custom', endpoint, apiKey, extras }, transport)`; `modelos('procstudio')` → `[{ id: modeloCatalogo, name: rotulo, tools: true }]`; `salvar(_, 'procstudio')` e `apagar('procstudio')` lançam `{ status: 400, message: 'Conexão gerenciada pelo ProcStudio.' }`; `preferencias()` devolve `{ conexaoId: 'procstudio', modelo: modeloCatalogo }` quando não há preferência gravada e `gerenciada` existe; `selecionar('procstudio', modeloCatalogo)` grava; `selecionar('procstudio', outro)` lança "Modelo inválido."; `ehProcstudio(id)` → boolean.
  - `modeloEnviado()` → `gerenciada.modelo` (o id que vai ao endpoint; o chat usa este, não o do catálogo).

- [ ] **Step 1: Testes** (`conexao-procstudio.test.js`: `doAmbiente` com e sem chave, com endpoint Z.ai direto sem `provider`; `conexoes-llm.test.js`: os seis comportamentos da Interfaces, mais "sem `gerenciada` nada muda: `listar()` vazio e `preferencias()` null").

- [ ] **Step 2: Rodar** `node --test tests/conexao-procstudio.test.js tests/conexoes-llm.test.js` → FAIL.

- [ ] **Step 3: Implementar.** Em `aplicacao.js`, `gerenciada = conexaoProcstudio.doAmbiente()` uma vez por processo. `.env.example` e `compose.yml` ganham as seis variáveis com os defaults das Global Constraints e o comentário "chave do OPERADOR".

- [ ] **Step 4: Rodar** os dois arquivos + `tests/aplicacao.test.js` → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(conexoes): conexão ProcStudio gerenciada a partir do ambiente"`

---

### Task 3: Cliente Rails: `saldo` e `registrarUso`

**Files:**
- Modify: `jur/servidor/procstudio.js`
- Test: `jur/tests/procstudio.test.js`

**Interfaces:**
- Produces (no objeto devolvido por `criarCliente`):
  - `saldo(principal)` → `{ ativo: true, podeOperar, saldoCents, saldoBrl, limiteNegativoCents, mensagem, topupPath, modelo: { modelId, nome, entradaPor1MBrl, saidaPor1MBrl } }` ou `{ ativo: false }`; 503 com `error: 'pricing_unavailable'` → lança `{ status: 503, code: 'PRICING_UNAVAILABLE' }`; outras falhas → o `indisponivel()` de hoje.
  - `registrarUso(principal, uso)` com `uso = { requestId, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, provider, providerModel, providerCostUsd, providerGenerationId, conversationId }` → `{ cobradoCents, cobradoBrl, saldoCents, saldoBrl, podeOperar, duplicado }`; 410 → lança `{ status: 410, code: 'USER_GONE' }`; 422 → `{ status: 422, code: 'INVALID_USAGE' }`; 401 → `{ status: 401, code: 'SERVICE_AUTH' }`; 403/404 → `{ status, code: 'TEAM_REJECTED' }`; 503 `pricing_unavailable` → `PRICING_UNAVAILABLE`; demais → `indisponivel()`.
  - Os dois mandam `client_id`, `user_id: principal.userId`, `team_id: principal.teamId` e recusam `principal.issuer !== issuer` (lançam `{ status: 401, code: 'SERVICE_AUTH' }`).

- [ ] **Step 1: Testes** no molde dos existentes (`fetchFn` capturando `url`/`init`): caminho feliz dos dois; cada código de erro mapeado; snake_case → camelCase; emissor diferente recusado; `pedir` existente não muda de comportamento (os 3 testes atuais seguem verdes).

- [ ] **Step 2: Rodar** `node --test tests/procstudio.test.js` → FAIL.

- [ ] **Step 3: Implementar.** `pedir` ganha um segundo modo que devolve `{ status, body }` em vez de colapsar 400/401/403 em `null`; `saldo`/`registrarUso` usam esse modo. Nunca incluir o corpo cru do Rails na mensagem do erro.

- [ ] **Step 4: Rodar** → PASS. **Step 5: Commit** `git commit -m "feat(procstudio): saldo e registrarUso contra service_access/ai_*"`

---

### Task 4: Módulo `cobranca` por conta (pré-checagem, registro, pendências, varredor)

**Files:**
- Create: `jur/servidor/cobranca.js`
- Modify: `jur/servidor/db.js` (tabela `cobranca_pendente`)
- Test: `jur/tests/cobranca.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces: `criarCobranca({ con, procstudio, principal, kaizen, agora = Date.now, esperar = ms => new Promise(r => setTimeout(r, ms)), logar = console.error })` →
  - `podeOperar()` → `Promise<{ ok: true } | { ok: false, motivo: 'saldo', saldoBrl, mensagem, topupPath } | { ok: false, motivo: 'pendente' } | { ok: false, motivo: 'indisponivel' }>`. Cache de `ai_balance` por 30 s; `motivo: 'pendente'` quando `pendentes() > 0`; `motivo: 'indisponivel'` para `PRICING_UNAVAILABLE`/503/`ativo: false`.
  - `registrar(uso)` → `Promise<{ cobradoBrl, saldoBrl, podeOperar, duplicado }>`; em sucesso atualiza o cache de `podeOperar`; após 3 tentativas falhas grava pendência e lança `{ code: 'COBRANCA_PENDENTE', message: 'Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes.' }`; códigos terminais (`USER_GONE`, `INVALID_USAGE`, `SERVICE_AUTH`, `TEAM_REJECTED`) não geram pendência: logam `billing_receipt_dropped` e lançam `{ code: 'COBRANCA_RECUSADA' }`.
  - `falhaDoOperador(erro)` → registra `procstudio_llm_operator_failure` (log + outbox) e devolve o erro padronizado `{ code: 'PROCSTUDIO_LLM_INDISPONIVEL', message: <mensagem das Global Constraints>, status: 503 }`; usado pela rota de chat quando o **provedor** falha na conexão ProcStudio (Task 6).
  - `pendentes()` → número; `drenar()` → `Promise<{ enviados, descartados, adiados }>`, aplicando os mesmos estados terminais; `iniciarVarredor()`/`pararVarredor()` (intervalo de 60 s, `unref`, só agenda enquanto `pendentes() > 0`).
  - `saldo()` → último `ai_balance` conhecido ou busca nova (para `GET /saldo`), sem cache quando `forcar: true`.
  - Tabela `cobranca_pendente(request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, criado_em INTEGER NOT NULL, ultimo_erro TEXT)`.
  - Cada chamada ao Rails que falhar com `PRICING_UNAVAILABLE` ou status ≥ 500 grava log JSON `event: "procstudio_llm_operator_failure"` e, se `kaizen.outbox.ligado`, `kaizen.outbox.enfileirar('jur-diagnostico', payload)` com `{ origem: 'cobranca', classe: 'operador', erro, status }` (sem segredos).

- [ ] **Step 1: Testes** com `procstudio` falso programável (lista de respostas/erros) e `esperar` instantâneo: cache de 30 s (duas chamadas em 10 s = uma ida ao Rails; avançar `agora` 31 s = nova ida); `registrar` com 2 falhas e sucesso na 3ª não gera pendência; 3 falhas geram pendência e `podeOperar()` passa a `motivo: 'pendente'`; `drenar()` com sucesso zera; 410 na drenagem descarta e loga; `can_operate: false` na resposta de `registrar` faz `podeOperar()` devolver `motivo: 'saldo'` sem nova ida ao Rails; dois `criarCobranca` com `con` diferentes não compartilham cache.

- [ ] **Step 2: Rodar** `node --test tests/cobranca.test.js` → FAIL. **Step 3: Implementar.** **Step 4: Rodar** `tests/cobranca.test.js tests/db.test.js` → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(cobranca): pré-checagem, registro idempotente e pendências por conta"`

---

### Task 5: Ganchos por rodada em `llm.conversar`

**Files:**
- Modify: `jur/servidor/llm.js`
- Test: `jur/tests/llm.test.js`

**Interfaces:**
- Produces: `conversar({ …, antesDaRodada, aoUsoDaRodada })`:
  - `antesDaRodada(indice)` async, chamado antes de cada `stream(...)`; se lançar, `conversar` propaga o erro **sem** chamar o provedor e com o histórico já contendo o que foi gerado.
  - `aoUsoDaRodada(usage, indice, { modelo })` async, chamado depois de `finalMessage()` e antes de executar ferramentas; se lançar, propaga (ferramentas da rodada não rodam).
  - `exigirUso: boolean` (padrão `false`): quando `true` e `mensagem.usage` é `null`, lança `{ code: 'USAGE_MISSING', message: 'O provedor não informou o consumo desta resposta.' }` sem chamar `aoUsoDaRodada`.
  - Retorno ganha `rodadas: Number`.

- [ ] **Step 1: Testes** (com o `clienteFalso` existente, respostas com `usage`): ordem `antesDaRodada → stream → aoUsoDaRodada` por rodada, índices 0..n; `antesDaRodada` lançando na 2ª rodada → erro propagado, 1 chamada ao cliente, histórico com a rodada 1; `exigirUso: true` e resposta sem `usage` → `USAGE_MISSING`; sem os ganchos nada muda (testes atuais verdes).

- [ ] **Step 2: Rodar** `node --test tests/llm.test.js` → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(llm): ganchos antesDaRodada e aoUsoDaRodada"`

---

### Task 6: Rota de chat cobra por rodada, emite `custo`, bloqueia com 402; custo persistido na conversa

**Files:**
- Modify: `jur/servidor/rotas/chat.js`
- Modify: `jur/servidor/conversas.js`, `jur/servidor/rotas/conversas.js`, `jur/servidor/db.js` (tabela `custo_turno`)
- Modify: `jur/servidor/aplicacao.js` (criar `scope.cobranca` junto de `scope.conexoes`; passar `cobranca` nas deps)
- Test: `jur/tests/chat.test.js`, `jur/tests/conversas.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces:
  - `POST /api/v1/chat` com `conexaoId: 'procstudio'`: antes de gravar a mensagem, `deps.cobranca.podeOperar()`; `motivo: 'saldo'` → **402** `{ erro: <mensagem de saldo>, tipo: 'saldo_insuficiente', saldoBrl, topupUrl }`; `motivo: 'pendente'` → 409 `{ erro: 'Há uma cobrança pendente nesta conta; aguarde alguns instantes.', tipo: 'cobranca_pendente' }`; `motivo: 'indisponivel'` → 503 `{ erro: <mensagem de indisponível>, tipo: 'procstudio_indisponivel' }`. `topupUrl = PROCSTUDIO_FRONTEND_URL + topupPath` (deps.frontendUrl).
  - Modelo enviado ao provedor = `deps.conexoes.modeloEnviado()`; `exigirUso: true`; `antesDaRodada` → `podeOperar()` (lança com `tipo` acima); `aoUsoDaRodada` → `cobranca.registrar({...})` e `emitir('custo', { rodada, tokensEntrada, tokensSaida, cobradoBrl, saldoBrl, modelo: rotulo })`.
  - Evento SSE `erro` ganha `tipo` (`'saldo_insuficiente' | 'cobranca_pendente' | 'procstudio_indisponivel' | 'usage_missing' | 'Error'`) e, no caso de saldo, `saldoBrl` e `topupUrl`.
  - Erro do **provedor** (o `erroProvedor` de `provedores/index.js`, qualquer status) dentro de um turno da conexão ProcStudio passa por `cobranca.falhaDoOperador(erro)` e sai como `erro` com `tipo: 'procstudio_indisponivel'`; em BYOK a mensagem atual segue igual.
  - `fim` ganha `custo: { cobradoBrl, tokensEntrada, tokensSaida, rodadas, modelo }` (soma do turno; `cobradoBrl` null em BYOK).
  - BYOK: `custo` só com tokens quando o provedor informou `usage`; nada de Rails.
  - `conversas.registrarCusto(conversaId, { turnoId, cobradoBrl, tokensEntrada, tokensSaida, rodadas, modelo, conexao })` e `conversas.custos(conversaId)` → lista em ordem; `GET /api/v1/conversas/:id` inclui `custos` e `custoTotalBrl`. Tabela `custo_turno(conversa_id, turno_id PRIMARY KEY, cobrado_brl REAL, tokens_entrada INTEGER, tokens_saida INTEGER, rodadas INTEGER, modelo TEXT, conexao TEXT, criado_em INTEGER)`. O custo do turno é gravado **mesmo quando o turno termina em erro** depois de ao menos uma rodada cobrada.

- [ ] **Step 1: Testes** em `chat.test.js` montando `criarApp({ fila, conexoes: <repo com gerenciada>, cobranca: <falso>, conversas, frontendUrl })` e `clienteFalso` com `usage`: 402 antes de gravar (conversa segue sem mensagens); `custo` por rodada antes do `fim` com os campos; `fim.custo` soma; `antesDaRodada` bloqueando na 2ª rodada → `erro` com `tipo: 'saldo_insuficiente'` e `topupUrl`, 1ª rodada gravada e custo persistido; `USAGE_MISSING` → `erro` `tipo: 'usage_missing'`; `clienteFalso` lançando o erro de provedor (status 402) numa rodada ProcStudio → `erro` `tipo: 'procstudio_indisponivel'` e `cobranca.falhaDoOperador` chamado (espião), enquanto em BYOK o mesmo erro sai com `tipo: 'Error'` e a mensagem atual; BYOK não chama `cobranca` (espião) e emite `custo` só com tokens; reanexo (`GET /conversas/:id/stream`) reproduz `custo`; cliente que fecha a conexão no meio de um turno com `conversaId` (padrão já usado em `chat.test.js` para o turno que sobrevive) ainda gera `registrar` em todas as rodadas e `GET /conversas/:id` traz o `custo` do turno. Em `conversas.test.js`: `registrarCusto`/`custos`/total no `GET`.

- [ ] **Step 2: Rodar** `node --test tests/chat.test.js tests/conversas.test.js` → FAIL. **Step 3: Implementar.** **Step 4: Rodar** os dois + `tests/turnos.test.js tests/aplicacao.test.js` → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(chat): cobrança por rodada, evento custo e bloqueio por saldo"`

---

### Task 7: `GET /api/v1/saldo`, OpenAPI e varredor no boot

**Files:**
- Create: `jur/servidor/rotas/saldo.js`
- Modify: `jur/servidor/index.js` (registrar rota), `jur/servidor/openapi.js`, `jur/servidor/aplicacao.js` (varredor), `jur/servidor/escopo.js` (`varrerPendencias()`)
- Test: `jur/tests/saldo.test.js`, `jur/tests/openapi.test.js`, `jur/tests/aplicacao.test.js`

**Interfaces:**
- Produces:
  - `GET /api/v1/saldo` → `{ disponivel: false }` sem conexão gerenciada; senão `{ disponivel: true, saldoBrl, podeOperar, mensagem, topupUrl, modelo: { rotulo, entradaPor1MBrl, saidaPor1MBrl } }`; `?forcar=1` ignora o cache de 30 s; 503 `{ disponivel: true, erro }` quando o Rails falha.
  - OpenAPI: `/api/v1/saldo`, resposta 402 em `/api/v1/chat`, evento `custo` e campo `custo` do `fim` descritos; `tests/openapi.test.js` valida presença.
  - `escopos.varrerPendencias()` no boot: percorre `usuarios/*/jur.db`, para cada um com `cobranca_pendente` não vazia instancia `criarCobranca` sem principal (o payload traz user/team) e chama `drenar()`; `aplicacao.js` chama uma vez ao iniciar e `scope.cobranca.iniciarVarredor()` ao abrir cada escopo.

- [ ] **Step 1: Testes** (`saldo.test.js` via `criarAplicacao` com `procstudio` falso contendo `saldo`; `aplicacao.test.js`: pendência gravada num `jur.db` de conta é drenada no boot com `procstudio.registrarUso` falso contando chamadas).

- [ ] **Step 2–4:** FAIL → implementar → PASS (`node --test tests/saldo.test.js tests/openapi.test.js tests/aplicacao.test.js`).

- [ ] **Step 5: Commit** `git commit -m "feat(saldo): rota de saldo, OpenAPI e varredor de pendências no boot"`

---

### Task 8: Ambiente local com ProcStudio simulado

**Files:**
- Modify: `jur/dev/local.js`
- Modify: `docs/ambiente-local.md`
- Test: `jur/tests/local.test.js`

**Interfaces:**
- Produces: o `procstudio` falso do `dev:local` ganha `saldo`/`registrarUso` com carteira em memória que começa em R$ 10,00, limite −R$ 0,50, preço por 1M fixo (R$ 1,00 entrada / R$ 4,00 saída) e idempotência por `requestId`; `JUR_LOCAL_SALDO_INICIAL` (centavos) sobrescreve o inicial para testar bloqueio. Com `PROCSTUDIO_LLM_*` no ambiente local, o chat roda contra o OpenRouter real cobrando da carteira simulada.

- [ ] **Step 1: Teste** em `local.test.js`: `GET /saldo` devolve 10,00; `registrarUso` desconta; `JUR_LOCAL_SALDO_INICIAL=-100` → `podeOperar: false`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(dev): carteira simulada no ambiente local"`

---

### Task 9: Interface — saldo, seletor, configurações, linha de custo e cartão de bloqueio

**Files:**
- Modify: `jur/publico/index.html` (`<div id="saldo-ia" hidden>` no topo direito de `#centro`), `jur/publico/estilo.css`
- Create: `jur/publico/saldo.js`
- Modify: `jur/publico/conexoes.js`, `jur/publico/seletor-modelo.js`, `jur/publico/config.js`, `jur/publico/app.js`
- Test: `jur/tests/browser/saldo.test.js` (no molde de `chat-fluxo.test.js`)

**Interfaces:**
- Consumes: Tasks 6 e 7 (eventos `custo`, `erro.tipo`, `fim.custo`, `GET /saldo`, `GET /conversas/:id` com `custos`).
- Produces (comportamento observável):
  - `window.jurSaldo = { carregar(forcar), atualizarDe(custo), montar() }`; pílula com texto `Saldo IA · R$ 9,83`, classes `saldo-baixo` (< R$ 1,00) e `saldo-zerado` (`podeOperar: false`, texto `Sem saldo`); clique abre `topupUrl` trocado por `/ia-uso` em nova aba; recarrega no `jur:ia`, a cada 2 min e no `visibilitychange`; some com `disponivel: false`.
  - `conexoes.js`: `names.procstudio = 'ProcStudio'`; `carregar()` sem preferência seleciona `procstudio` quando listado.
  - Seletor: conexão ProcStudio em primeiro com selo "recomendada" e preço "R$ X / 1M entrada · R$ Y / 1M saída"; separador "Avançado — usar minha própria chave" antes das BYOK; ao escolher ProcStudio, sem busca de modelo (único botão "Usar GLM-5.3 Flash"); botão do seletor mostra `ProcStudio · GLM-5.3 Flash`.
  - Configurações → IA: bloco "IA do ProcStudio" no topo (saldo, link de recarga, frase "O chat usa o saldo de IA do seu time no ProcStudio.") quando disponível; provedores atuais sob `<details>` "Avançado: minha própria chave" recolhido por padrão (aberto se houver BYOK selecionado).
  - Chat: evento `custo` acrescenta/atualiza `<small class="custo-resposta">R$ 0,04 · 19,1 mil tokens · GLM-5.3 Flash</small>` sob a bolha do assistente em curso (só tokens em BYOK); cabeçalho da conversa mostra `Esta conversa: R$ 0,37` somando `custos` do `GET /conversas/:id` mais os turnos da sessão; `erro.tipo === 'saldo_insuficiente'` e 402 renderizam `bolha('bloqueio')` com a mensagem, botão "Adicionar créditos" (`topupUrl`, nova aba) e "Tentar de novo" (recarrega saldo e, se `podeOperar`, reenvia a última mensagem); `tipo === 'procstudio_indisponivel'` renderiza erro com link "Configurar uma conexão própria" que abre Configurações.

- [ ] **Step 1: Teste de navegador** (`saldo.test.js`): app com `conexoes` gerenciada + `cobranca` falsa + `clienteFalso` com `usage`: pílula mostra `R$ 10,00`, após um turno mostra o saldo devolvido e a bolha tem `.custo-resposta` com "R$"; com `cobranca.podeOperar → saldo` o envio mostra `.bolha.bloqueio` com os dois botões e nenhuma mensagem é gravada; seletor abre com "ProcStudio" primeiro e `<details>` recolhido; BYOK selecionado: `.custo-resposta` só com "tokens".

- [ ] **Step 2: Rodar** `cd jur && node --test tests/browser/saldo.test.js` → FAIL. **Step 3: Implementar** (CSS no vocabulário do `estilo.css` atual; sem dependências novas). **Step 4: Rodar** `npm run test:browser` → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(ui): saldo ProcStudio, custo por resposta e bloqueio por saldo"`

---

### Task 10: Documentação, versão e registro de release

**Files:**
- Modify: `docs/procstudio-llm.md` (seção "Conexão ProcStudio e cobrança"), `infra/README.md` (variáveis novas), `CHANGELOG.md`, `jur/package.json` (versão minor: `1.3.0`), `jur/servidor/openapi.js` (versão vem do package)
- Create: `docs/qa/2026-10-XX-producao-saldo-compartilhado.md` (preenchido no deploy)

- [ ] **Step 1:** Escrever `docs/procstudio-llm.md`: fluxo por rodada, variáveis, estados de erro, pendências, como conferir no `/ia-uso` e no painel do OpenRouter. `CHANGELOG.md` com a entrada 1.3.0. Bump da versão.
- [ ] **Step 2:** Estender `jur/tests/manual/procstudio-sso.js` (ensaio contra Rails local, não roda no `npm test`): depois do login, `GET /api/v1/saldo` responde `disponivel: true` com `saldoBrl` numérico e um `POST /api/v1/chat` com `conexaoId: 'procstudio'` e cliente de LLM falso emite ao menos um `custo` e o `fim.custo`; o saldo final no Rails caiu pelo valor somado.
- [ ] **Step 3:** `cd jur && npm test && npm run test:browser` → tudo PASS; `curl` local de `/api/v1/saude` mostra a versão nova.
- [ ] **Step 4: Commit** `git commit -m "chore(release): versão 1.3.0 — saldo compartilhado com o ProcStudio"`

**Release (fora do loop de código, seguindo `CLAUDE.md` do workspace):** só depois do PR do Rails estar em produção e do preço de `glm-5.3-flash` conferido. Adicionar as seis variáveis no `current/infra/.env` do H2, release imutável, checar `/api/v1/saude` 200 / `/api/v1/me` 401 / `/__local/painel.js` 404, depois a validação da seção 4.4 passo 4 do design (uma conversa real com busca; registrar no `docs/qa/` os três valores: `custo` da interface, linha do `/ia-uso`, geração no painel do OpenRouter).
