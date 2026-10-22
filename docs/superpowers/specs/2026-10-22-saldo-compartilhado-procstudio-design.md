# Saldo compartilhado ProcStudio ↔ JurCrawler — design

Data: 2026-10-22. Status: aprovado pelo Bruno em 2026-10-22 (após revisão do builder).
Repositórios envolvidos: `prc_jur_crawler` (este) e `ProcStudio-Docker` (Rails + frontend Svelte).

## 1. Intenção

Hoje o chat do JurCrawler só funciona se o usuário cadastrar a própria chave de LLM
(BYOK) em Configurações → IA. Isso quebra a experiência: o usuário já tem um saldo de
créditos de IA no ProcStudio (carteira do time, R$ 10,00 de boas-vindas, recarga por
Stripe) e espera que o JurCrawler consuma dali, como o IA Chat e as transcrições fazem.

Depois desta entrega:

- O usuário entra no JurCrawler com a conta ProcStudio e conversa **sem configurar chave**.
- Cada rodada de LLM é cobrada do saldo de IA do time no ProcStudio, aparece no extrato
  `/ia-uso` como qualquer outro uso e o saldo do topo do ProcStudio reflete o gasto.
- O usuário vê, dentro do JurCrawler, o **saldo atual** e o **custo de cada resposta**.
- Saldo esgotado interrompe a conversa com uma mensagem clara e um caminho de volta ao
  ProcStudio para recarregar.
- BYOK continua existindo como opção **avançada**, não como pré-requisito.

### Por que GLM-5.3 Flash e por que via OpenRouter

O JurCrawler consome muitos tokens por turno (até 12 chamadas ao modelo, cada uma com o
histórico e resultados de busca inteiros). Nesta fase o modelo da conexão ProcStudio fica
**travado em GLM-5.3 Flash**. Outros modelos entram depois; a estrutura já suporta.

A chamada sai pelo **OpenRouter**, com o provedor upstream fixado em Z.AI, porque o OpenRouter
devolve o custo exato em dólar de cada geração no próprio stream. Isso dá conciliação por
chamada entre o que pagamos e o que cobramos, que é o que precisamos enquanto calibramos
o produto. Ir direto na Z.ai depois é trocar variáveis de ambiente, não código.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

1. Conexão "ProcStudio" nativa no JurCrawler, selecionada por padrão, sem chave do usuário.
2. Cobrança por rodada de LLM debitada no `TeamAiBalance` do time, com `AiUsageLog` próprio.
3. Saldo e custo visíveis no JurCrawler; custo por resposta e total da conversa.
4. Bloqueio por saldo com a mesma política de tolerância do ProcStudio e link de recarga.
5. BYOK preservado, rebaixado a "Avançado".
6. Interruptor de desligamento: sem a chave do operador configurada, o JurCrawler se comporta
   exatamente como hoje (só BYOK).

**Não-objetivos (ficam para depois)**

- Repasse dos custos de navegador remoto (Kernel/Steel/captcha do STJ). Continua em
  `docs/custos-navegadores-remotos.md`.
- Mais de um modelo na conexão ProcStudio; seletor de modelo para essa conexão.
- Cotas por usuário dentro do time (o saldo é do time; cada débito identifica o usuário).
- Cobrar buscas feitas por REST/MCP (`/api/v1/buscas`): não usam LLM, continuam gratuitas.
- Mostrar custo em reais para conexões BYOK (não sabemos o preço que o usuário paga).

**Anti-objetivos (o que tornaria isto um fracasso mesmo funcionando)**

- Cobrar zero por engano. Modelo sem preço no catálogo deve **recusar** a operação, nunca
  registrar R$ 0,00. É o oposto do comportamento do chat do ProcStudio (que loga WARN e
  cobra zero); aqui o volume de tokens torna o vazamento caro.
- Perder cobrança por falha de rede entre JurCrawler e Rails. Uso concluído no provedor
  precisa virar débito, mesmo que atrasado.
- Mandar a chave de LLM do operador ou o segredo de serviço para o navegador.
- Cobrar o usuário duas vezes pela mesma rodada (retry sem idempotência).
- Trocar o tribunal ou "achatar" o histórico para economizar tokens. Os invariantes do
  crawler não mudam por causa de custo.

## 3. Restrições herdadas (já existem, não se mexe)

- Saldo é por **time** (`TeamAiBalance`, centavos). Tolerância negativa por plano: free
  bloqueia em ≤ −R$ 0,50, pago em ≤ −R$ 3,00 (`Ai::Billing::Limits`). Requisição já
  iniciada termina e é cobrada; a próxima bloqueia. Não há reserva prévia de saldo.
- Preço cobrado = tokens × preço LiteLLM do catálogo (`AiModel`) × câmbio USD→BRL × 1,60
  (`DEFAULT_MARKUP_PCT = 60`). Câmbio fotografado por log (`usd_to_brl_rate`).
- Times de demonstração (`settings.demo_seed`) não consomem IA: `check_balance!` já falha.
- Canal servidor-a-servidor JurCrawler → Rails: `POST /api/v1/service_access/*` com Bearer
  do segredo de serviço, balde de rate limit `client:jurcrawler` (3.000/5 min).
- O JurCrawler nunca recebe o JWT do usuário; conhece o principal `{issuer, userId, teamId}`.
- Acesso ao JurCrawler exige plano pago (gate só no `authorize`). Não muda.
- Catálogo do ProcStudio já tem `glm-5.3-flash` (provider `zai`, capabilities chat +
  function_calling + vision).
- Adaptador de LLM do JurCrawler (`jur/servidor/provedores/index.js`) já fala Anthropic,
  OpenAI-compatível (inclui OpenRouter) e Gemini, com streaming SSE e ferramentas.

## 4. Desenho

### 4.1 Visão geral

```
navegador ──cookie──▶ JurCrawler (Node, H2) ──Bearer segredo──▶ Rails ProcStudio
                          │                                        │
                          │  chave do operador                     │ TeamAiBalance
                          └──────▶ OpenRouter (upstream Z.AI) ◀────┘ AiUsageLog
                                   z-ai/glm-5.3-flash                 /ia-uso, badge
```

Por rodada de LLM dentro de um turno de chat:

1. JurCrawler pergunta ao Rails se o time pode operar (saldo acima da tolerância).
2. Se pode, chama o OpenRouter com `stream_options.include_usage` e `usage.include`, e lê
   no último chunk os tokens e o `cost` em USD daquela geração.
3. Reporta ao Rails: modelo, tokens, custo do provedor, id da geração, id idempotente da
   rodada. Rails cria o `AiUsageLog`, debita, devolve valor cobrado e saldo novo.
4. JurCrawler emite ao navegador o evento `custo` com o cobrado e o saldo.

Por que **por rodada** e não por turno: um turno pode levar minutos (buscas) e sobreviver ao
fechamento da aba. Cobrar só no fim deixaria um saldo de R$ 0,10 bancar um turno de R$ 2,00.
Por rodada, o estouro máximo é uma chamada, o que casa com a semântica do ProcStudio.

### 4.2 Lado ProcStudio (Rails + frontend)

#### Dois endpoints novos, mesmo grupo `service_access`

Ambos: POST, Bearer do segredo de serviço (`authenticate_service`), `Cache-Control: no-store`,
`client_id` obrigatório no corpo, usuário precisa existir e pertencer ao `team_id` informado
(mesma regra do `subject`). Entram em `SERVICE_ACCESS_PATHS` do Rack::Attack, no balde
`client:jurcrawler`. Como um turno pode gerar até 24 chamadas (12 rodadas × 2), o teto desse
balde sobe para **6.000 / 5 min**; `exchange` mantém o balde próprio de 100.

**`POST /api/v1/service_access/ai_balance`**

Entrada: `{ client_id, user_id, team_id }`.
Saída 200:

```json
{
  "active": true,
  "can_operate": true,
  "balance_cents": 987,
  "balance_brl": 9.87,
  "negative_limit_cents": -300,
  "message": null,
  "topup_path": "/equipe?tab=billing",
  "model": {
    "model_id": "glm-5.3-flash",
    "name": "GLM-5.3 Flash",
    "input_per_1m_brl": 1.23,
    "output_per_1m_brl": 4.56
  }
}
```

- `can_operate` vem de `Ai::Billing::BillingService.check_balance!(team).success?` (cobre
  tolerância do plano e time demo). `message` é a mensagem do `Limits` quando bloqueado.
- `active: false` quando usuário/time não conferem (mesmo contrato do `subject`).
- `model` é o preço com markup do catálogo, para a interface mostrar "quanto custa".
- **Se o modelo não tem preço sincronizado (`has_pricing?` false): 503 com
  `{ error: 'pricing_unavailable' }`.** O JurCrawler trata como "conexão ProcStudio
  indisponível no momento", nunca como saldo.

**`POST /api/v1/service_access/ai_usage`**

Entrada:

```json
{
  "client_id": "jurcrawler",
  "user_id": "123", "team_id": "45",
  "request_id": "conv-7f3a…:turno-2:rodada-3",
  "model_id": "glm-5.3-flash",
  "input_tokens": 18231, "output_tokens": 912,
  "cache_read_tokens": 0, "cache_write_tokens": 0,
  "provider": "openrouter",
  "provider_model": "z-ai/glm-5.3-flash",
  "provider_cost_usd": 0.00412,
  "provider_generation_id": "gen-…",
  "conversation_id": "7f3a…"
}
```

Saída 200:

```json
{ "billed_cents": 4, "billed_brl": 0.04, "balance_cents": 983, "balance_brl": 9.83,
  "can_operate": true, "usage_log_id": 9912, "duplicate": false }
```

- Novo `usage_type` em `AiUsageLog::USAGE_TYPES`: **`jurcrawler_chat`**. `loggable` nulo.
- Idempotência: `request_id` único por time. Reenvio devolve o mesmo resultado com
  `duplicate: true` e **não debita de novo**. Implementação sugerida: colunas
  `external_request_id` (string) e `metadata` (jsonb) em `ai_usage_logs`, índice único
  parcial em `(team_id, external_request_id)`; `metadata` guarda `provider`,
  `provider_model`, `provider_cost_usd`, `provider_generation_id`, `conversation_id`,
  `client_id`. Se o builder preferir uma tabela de recibos à parte, o contrato não muda.
- Cálculo e débito: novo método `BillingService.record_jurcrawler_usage!` com o mesmo
  miolo de `record_chat_usage!` (câmbio, `raw_cost_brl`, markup, transação com `lock!`,
  `deduct!(..., completed_usage: true)`). **Modelo sem preço → 503 `pricing_unavailable`,
  sem criar log.** Modelo fora do catálogo → 422.
- Telemetria para o FFD: enfileirar `TokenUsageWebhook` com `feature: 'jurcrawler_chat'`
  (o mesmo valor do `usage_type`, que é o que `LLMTracker` valida contra
  `AiUsageLog::USAGE_TYPES`), `provider: 'openrouter'` (é quem nos cobra; o FFD resolve o
  cartão por provider), `model: 'glm-5.3-flash'` e os tokens. Builder reaproveita o
  montador do `LLMTracker` e confere no handler do FFD
  (`/Users/brpl/code/fullFuckerDashboard/ai-dashboard/app/api/webhooks/[source]/route.ts`)
  que uma feature nova não é descartada; se o FFD tiver lista fechada, a mudança no FFD
  entra antes do deploy do Rails.
- Validação do par usuário/time no `ai_usage` é **mais frouxa que no `subject`**, de
  propósito: o uso já aconteceu e o time é quem paga. Regra: o time precisa existir e não
  ser demo; o usuário precisa existir (o `AiUsageLog` referencia o usuário responsável),
  mas **não** precisa ainda pertencer ao time. Usuário excluído → 410 `user_gone`, sem
  débito. Esse 410 é terminal para o JurCrawler (ver 4.3, item 4). O `ai_balance` continua
  exigindo pertencimento atual, como o `subject`.
- `can_operate` na resposta evita uma segunda chamada quando o JurCrawler vai emendar a
  próxima rodada: ele só chama `ai_balance` de novo se a última resposta disse que pode
  operar há mais de 30 s ou se outro turno do mesmo time está em curso. Regra simples que o
  builder pode ajustar: o importante é **nunca** chamar o provedor sem ter um `can_operate`
  verdadeiro com menos de 30 s.

#### Extrato e badge

- `GET /ai_usage/summary` ganha `jurcrawler_requests` e `jurcrawler_billed_brl`.
- `AiUsageLogTable.svelte` ganha rótulo e ícone para `jurcrawler_chat` ("JurCrawler");
  `billing.types.ts` amplia a união de `usage_type`.
- `AiUsageBadge.svelte` (hover do saldo no topo) ganha a linha "JurCrawler · N usos".
- Página pública `/ia` e `public/ai_pricing`: não mudam nesta fase (GLM-5.3 Flash já consta).

#### Catálogo e preço

- Pré-requisito de deploy: `glm-5.3-flash` com `litellm_input_cost` e `litellm_output_cost`
  preenchidos. Rodar o script de verificação do LiteLLM (`CLAUDE-LLM-PRICING-LITE-LLM.md`);
  se o feed não listar `zai/glm-5.3-flash`, configurar preço manual no catálogo antes de
  ligar a conexão em produção. O preço que o OpenRouter cobra por `z-ai/glm-5.3-flash` deve
  ser conferido contra o do catálogo; divergência acima de 10% é motivo para preço manual.

#### Documentação ProcStudio a atualizar

`docs/JurCrawler.md` (seção Cobrança), `docs/JurCrawler-SSO.md` (novas rotas, rate limit),
`CLAUDE-JURCRAWLER.md`, `CLAUDE-BILLING-AI-CREDITS.md` (tipo `jurcrawler_chat`), Bruno
collection `Service Access`, spec `service_access_spec.rb`.

### 4.3 Lado JurCrawler (Node)

#### Configuração (`infra/.env.example`)

```
# Conexão ProcStudio: chave do OPERADOR, nunca do usuário. Vazia = conexão não oferecida.
PROCSTUDIO_LLM_API_KEY=
PROCSTUDIO_LLM_ENDPOINT=https://openrouter.ai/api/v1
PROCSTUDIO_LLM_MODELO=z-ai/glm-5.3-flash          # id enviado ao endpoint
PROCSTUDIO_LLM_MODELO_CATALOGO=glm-5.3-flash      # id que o ProcStudio cobra
PROCSTUDIO_LLM_UPSTREAM=z-ai                      # só no OpenRouter: provider fixo, sem fallback
PROCSTUDIO_LLM_ROTULO=GLM-5.3 Flash
```

A chave do OpenRouter é a que o Bruno já mantém no `.env`: pertence à sua conta pessoal
no OpenRouter, operando dentro da organização ProcStudio. É a mesma organização que o Rails
usa para o Gemini, então o cartão "openrouter" do FFD soma as duas origens; a separação no
painel do OpenRouter é por chave. O builder não cria conta nem chave: usa a que estiver
provisionada e, se faltar, pede ao Bruno.

`PROCSTUDIO_LLM_API_KEY` vazia é o interruptor: sem ela nada do que segue aparece e o
produto fica como hoje. Trocar para Z.ai direta = mudar `ENDPOINT`, `MODELO` e esvaziar
`UPSTREAM`.

#### Conexão virtual "procstudio"

- `conexoes-llm.js` passa a expor, antes das conexões do usuário, uma conexão sintética
  `{ id: 'procstudio', provider: 'procstudio', name: 'ProcStudio', model: <catálogo>,
  maskedKey: null, fixa: true }`. Não é gravada no `jur.db` do usuário; o segredo vem do
  processo. `PATCH`/`DELETE /conexoes-llm/procstudio` respondem 400 ("conexão gerenciada").
  `GET /conexoes-llm/procstudio/modelos` devolve só o modelo travado.
- Preferência padrão: usuário sem preferência gravada → `procstudio`. Usuário com
  preferência BYOK gravada **mantém** a escolha (não trocamos por baixo); a interface mostra
  a conexão ProcStudio em primeiro e com o selo "recomendada". Decisão minha; fácil de
  inverter.
- `cliente('procstudio')` cria o cliente OpenAI-compatível com a chave do operador. No
  OpenRouter, o corpo ganha `provider: { order: [<UPSTREAM>], allow_fallbacks: false }` e
  `usage: { include: true }`. Builder confirma o slug exato do provedor Z.AI na documentação
  do OpenRouter antes de fixar o valor padrão.

#### Captura de uso no adaptador (vale para todos os provedores)

`provedores/index.js` passa a devolver `usage` junto de `content` e `stop_reason`:
`{ input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, generation_id }`
(campos ausentes = `null`).

- OpenAI-compatível: enviar `stream_options: { include_usage: true }`; o último chunk antes
  de `[DONE]` traz `usage` (`prompt_tokens`, `completion_tokens`,
  `prompt_tokens_details.cached_tokens`; no OpenRouter também `cost`).
- Anthropic: `finalMessage().usage` (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`).
- Gemini: `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`,
  `cachedContentTokenCount`).
- Stream que terminou sem `usage` numa conexão ProcStudio é **erro de cobrança**, não
  sucesso silencioso: o turno para, o texto já emitido fica, e o incidente vai para o log
  com `event: "llm_usage_missing"`. Em BYOK, `usage` ausente é tolerado (só não mostra
  tokens).

#### Cliente ProcStudio (`procstudio.js`)

Dois métodos novos sobre o mesmo `pedir`: `saldo(principal)` e `registrarUso(principal,
uso)`. Timeout de 5 s como os demais. `503` do Rails continua "ProcStudio indisponível";
`pricing_unavailable` vira erro próprio com mensagem "A conexão ProcStudio está
temporariamente indisponível. Use uma conexão própria ou tente mais tarde."

#### Fluxo do turno (`rotas/chat.js` + `llm.js`)

Quando a conexão do pedido é `procstudio`:

1. **Antes de gravar a mensagem do usuário**: `saldo`. Se `!can_operate` → resposta
   **402 JSON** `{ erro, tipo: 'saldo_insuficiente', saldoBrl, topupUrl }` e nada é
   persistido. Se `active: false` → 401 (sessão inválida; mesmo tratamento de hoje).
2. Em `llm.conversar`, antes de **cada** rodada: garantir `can_operate` com menos de 30 s
   (ver 4.2). Bloqueado no meio do turno → o turno termina com evento SSE
   `erro` de tipo `saldo_insuficiente` carregando `saldoBrl` e `topupUrl`; o que já foi
   gerado é persistido normalmente (as rodadas anteriores já foram cobradas).
3. Depois de cada rodada concluída: `registrarUso` com `request_id =
   <conversaId ou 'avulso-'+uuid>:<índice do turno>:<índice da rodada>`. Resposta alimenta
   o evento SSE **`custo`**: `{ rodada, tokensEntrada, tokensSaida, cobradoBrl,
   saldoBrl, modelo }`. O cliente soma as rodadas na tela.
4. Falha ao registrar (rede, 5xx): tentar mais 2 vezes com espera de 1 s e 3 s. Persistindo
   a falha, gravar o recibo em `cobranca_pendente` (tabela nova no `jur.db` do usuário:
   `request_id`, payload JSON, tentativas, criado_em) e **encerrar o turno** com `erro`
   "Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes."
   Um varredor por conta, disparado no boot e a cada 60 s enquanto houver pendência,
   reenvia; só depois de quitar as pendências a conexão ProcStudio volta a aceitar turnos
   daquela conta. Pendência com mais de 24 h vira linha no log com `event:
   "billing_pending_stale"` para o operador olhar. Idempotência no Rails garante que o
   reenvio nunca cobra duas vezes.
   Estados terminais do varredor (a pendência sai da fila, a conta desbloqueia, e o caso
   vai para o log com `event: "billing_receipt_dropped"` e motivo): 410 `user_gone`,
   422 (payload que o Rails nunca vai aceitar) e 401 (segredo de serviço inválido,
   que é erro de operação, não do usuário). 5xx e rede continuam tentando. Usuário que
   trocou de time não é terminal: o Rails aceita e debita o time informado no recibo.
6. **Falha do lado do operador** (chave do operador sem créditos → 402; 429 do OpenRouter
   na nossa chave; Z.AI fora, sem fallback → 502/503 do OpenRouter): na conexão
   ProcStudio esses erros **não** viram a mensagem genérica de provedor. Viram o mesmo
   tratamento de `pricing_unavailable`: o turno para com "A conexão ProcStudio está
   temporariamente indisponível. Use uma conexão própria ou tente mais tarde.", e o
   servidor grava `event: "procstudio_llm_operator_failure"` com status e corpo
   resumido, enviado pela outbox do Kaizen ao FFD para virar alerta ao operador (o mesmo
   caminho dos relatos). Não há desligamento automático da conexão nem troca de
   provedor por conta própria. Em BYOK o comportamento atual de `erroProvedor` não muda.
5. No `fim` do turno, além de `texto` e `mensagens`, vai `custo: { cobradoBrl, tokensEntrada,
   tokensSaida, rodadas }` do turno inteiro.

Conexões BYOK: passos 1 a 4 não acontecem; o evento `custo` sai só com tokens (sem
`cobradoBrl`/`saldoBrl`) quando o provedor informou `usage`.

#### Persistência do custo

`conversas.js`: cada turno gravado ganha o custo (`cobrado_brl`, `tokens_entrada`,
`tokens_saida`, `modelo`, `conexao`), associado à última mensagem `assistant` do turno.
`GET /conversas/:id` devolve isso junto das mensagens para a tela reconstruir a linha de
custo e o total da conversa após F5. Builder escolhe entre colunas na tabela de mensagens
ou tabela `custo_turno`; o contrato de API é o que importa.

#### Endpoint para a interface

`GET /api/v1/saldo` (autenticado, por cookie ou chave pessoal): proxy de `ai_balance`
para o principal da sessão, devolvendo `{ disponivel, saldoBrl, podeOperar, mensagem,
topupUrl, modelo: { rotulo, entradaPor1MBrl, saidaPor1MBrl } }`. `topupUrl` é
`PROCSTUDIO_FRONTEND_URL + topup_path`. Quando a conexão ProcStudio não está configurada,
`{ disponivel: false }`.

#### Interface (`jur/publico`)

- **Saldo no topo direito de `#centro`**: pílula fixa "Saldo IA · R$ 9,83". Carrega no
  login, atualiza a cada evento `custo`, a cada 2 min e ao focar a aba. Clique abre
  `PROCSTUDIO_FRONTEND_URL/ia-uso` em nova aba. Abaixo de R$ 1,00 fica âmbar; abaixo
  da tolerância fica vermelha com o texto "Sem saldo". Some quando `disponivel: false`.
- **Seletor "Configurar IA"** (`seletor-modelo.js`): com a conexão ProcStudio selecionada,
  o botão mostra "ProcStudio · GLM-5.3 Flash". O popover lista a conexão ProcStudio com o
  preço por milhão de tokens e, abaixo de um separador "Avançado — usar minha própria
  chave", as conexões BYOK como hoje. Para a conexão ProcStudio não há busca de modelo.
- **Configurações** (`config.js`): seção "IA do ProcStudio" no topo explicando que o chat usa
  o saldo do time, com o saldo e o link de recarga; a seção atual de provedores vira
  "Avançado: minha própria chave", recolhida por padrão.
- **Linha de custo em cada resposta**: sob o texto do assistente, em tipografia pequena,
  "R$ 0,04 · 19,1 mil tokens · GLM-5.3 Flash". Durante o turno a linha vai somando a cada
  evento `custo`. No topo da conversa (ou no cabeçalho dela), o total: "Esta conversa:
  R$ 0,37".
- **Bloqueio por saldo**: cartão dentro do chat: "Seu saldo de IA do ProcStudio acabou
  (R$ −0,52). Adicione créditos para continuar." com botões "Adicionar créditos" (nova
  aba, `topupUrl`) e "Tentar de novo" (refaz o `GET /saldo` e, se liberou, reenvia). O
  mesmo cartão aparece tanto no 402 inicial quanto no `erro` no meio do turno.
- Mensagens de erro do chat que hoje dizem "configure uma conexão de IA" passam a só
  aparecer quando a conexão ProcStudio não está disponível.

#### OpenAPI, MCP e chaves pessoais

- `openapi.js` documenta `GET /saldo`, o 402 do `POST /chat`, os eventos `custo` e o
  campo `custo` no `fim`.
- Chat via chave pessoal (Bearer) com conexão `procstudio` cobra igual: o principal da
  chave tem `userId`/`teamId`. MCP não expõe chat, nada muda.

### 4.4 Sequência de publicação

1. ProcStudio: migration + endpoints + rate limit + extrato. É aditivo; nada do fluxo atual
   depende disso. Validar em HML com spec e Bruno.
2. ProcStudio: conferir preço de `glm-5.3-flash` no catálogo de produção (script de
   verificação). Sem preço, não seguir.
3. JurCrawler: release imutável com as variáveis novas no `.env` do H2 (chave do
   OpenRouter do operador). Bump em `jur/package.json`, `CHANGELOG.md`, registro em
   `docs/qa/`.
4. Validação em produção com conta de teste: uma conversa com busca real; comparar a
   linha de `/ia-uso`, o `custo` mostrado no JurCrawler e a geração no painel do
   OpenRouter. Registrar os três valores no QA.
5. Só então divulgar. Rollback: esvaziar `PROCSTUDIO_LLM_API_KEY` e subir de novo (volta
   ao BYOK) ou release anterior pelo procedimento padrão. Nunca `down -v`.

### 4.5 Testes exigidos

- Rails: spec de request para os dois endpoints (autenticação por segredo, usuário fora do
  time, time demo, saldo abaixo da tolerância, idempotência por `request_id`, modelo sem
  preço → 503, débito correto com câmbio fotografado, enfileiramento do webhook FFD).
- Node: adaptador devolve `usage` nos três formatos (fixtures de stream); conexão virtual
  aparece/não aparece conforme env; turno bloqueado antes e no meio; `custo` por rodada;
  recibo pendente e varredor; stream sem `usage` em conexão ProcStudio para o turno.
- Integrado: estender `jur/tests/manual/procstudio-sso.js` para cobrir saldo e uso contra
  Rails local. Teste automatizado não consome chave paga (provedor simulado).

## 5. Decisões já tomadas (pelo Bruno)

- Saldo compartilhado com o ProcStudio, carteira do time, nada novo de cobrança.
- Modelo único nesta fase: GLM-5.3 Flash.
- Caminho OpenRouter com upstream Z.AI fixo, pela granularidade de custo; migrar para
  Z.ai direta depois dos testes.
- Preço ao usuário segue a regra do ProcStudio (catálogo × câmbio × 1,60); o custo do
  OpenRouter é registrado só para conciliação.
- BYOK permanece, como opção avançada.
- Saldo esgotado: parar e remeter ao ProcStudio para recarregar.
- Chave OpenRouter: a já existente, da conta pessoal do Bruno dentro da organização
  ProcStudio (mesma organização do Gemini do Rails).

## 6. Decisões minhas (reverter é barato)

- Cobrança por rodada de LLM, não por turno.
- Preferência BYOK já gravada não é trocada à força para ProcStudio.
- Falha ao registrar cobrança encerra o turno e fica pendente localmente (fail-closed).
- Modelo sem preço bloqueia com 503 em vez de cobrar zero.
- `request_id` idempotente armazenado em `ai_usage_logs` (coluna + índice único parcial).
- Balde `client:jurcrawler` sobe para 6.000/5 min.
- Pílula de saldo no topo direito do centro, não na lateral.
- `ai_usage` debita o time mesmo que o usuário já tenha saído dele; usuário excluído é
  terminal (410) e a cobrança daquela rodada se perde, com registro no log.
- Falha na chave do operador para o turno com "indisponível" e alerta ao operador via
  Kaizen/FFD; nada se desliga sozinho.
- `feature` do webhook FFD = `jurcrawler_chat`.

## 7. O que fica com o builder

- Nome e forma exata das colunas/tabelas novas nos dois bancos.
- Slug do provedor Z.AI no OpenRouter e formato exato de `provider`/`usage` no corpo.
- Montagem do payload do `TokenUsageWebhook` a partir do que `LLMTracker` já faz.
- Texto final das mensagens de erro em pt-BR e estilo da pílula/linha de custo dentro do
  `estilo.css` existente.
- Como o cliente web soma as rodadas e guarda o total por conversa.

## 8. Referências

- `ProcStudio-Docker/CLAUDE-BILLING-AI-CREDITS.md`, `CLAUDE-LLM-LIMITS.md`,
  `CLAUDE-LLM-PRICING-LITE-LLM.md`, `docs/JurCrawler-SSO.md`, `docs/JurCrawler.md`.
- `ProcStudio-Docker/api/app/services/ai/billing/billing_service.rb`,
  `api/app/models/team_ai_balance.rb`, `api/app/controllers/api/v1/service_access_controller.rb`,
  `api/config/initializers/rack_attack.rb`, `api/app/jobs/token_usage_webhook.rb`.
- `prc_jur_crawler/docs/procstudio-llm.md`, `jur/servidor/provedores/index.js`,
  `jur/servidor/rotas/chat.js`, `jur/servidor/llm.js`, `jur/servidor/conexoes-llm.js`,
  `jur/servidor/procstudio.js`, `jur/publico/seletor-modelo.js`, `jur/publico/config.js`.
- `docs/qa/2026-10-08-producao-sso-isolamento.md` (GLM-5.3 Flash via OpenRouter com
  ferramentas, PASS).
