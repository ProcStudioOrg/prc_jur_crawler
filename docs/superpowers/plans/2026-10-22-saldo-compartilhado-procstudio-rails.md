# Saldo compartilhado — lado ProcStudio (Rails + frontend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor ao JurCrawler, pelo canal servidor-a-servidor já existente, consulta de saldo e registro de uso de LLM que debita a carteira de IA do time e aparece no extrato `/ia-uso`.

**Architecture:** Duas actions novas em `Api::V1::ServiceAccessController` (`ai_balance`, `ai_usage`) autenticadas pelo segredo de serviço, no balde Rack::Attack `client:jurcrawler`. O débito reaproveita `Ai::Billing::BillingService` com um `usage_type` novo `jurcrawler_chat`, idempotente por `external_request_id`, e enfileira `TokenUsageWebhook` para o FFD. Frontend só ganha rótulos e contagens do tipo novo.

**Tech Stack:** Rails 7 (RSpec, FactoryBot), Rack::Attack, Svelte 5 + TypeScript (vitest), Bruno.

**Spec:** `/Users/brpl/code/ProcStudio/prc_jur_crawler/docs/superpowers/specs/2026-10-22-saldo-compartilhado-procstudio-design.md` (seções 3, 4.2, 4.4, 4.5)

**Repositório de trabalho:** `/Users/brpl/code/ProcStudio/ProcStudio-Docker`, branch nova a partir de `main` (ex.: `feat/jurcrawler-ai-billing`). PR ao final; o deploy de HML/prod segue o fluxo do repositório (`CLAUDE-DOCKER-AWS.md`).

## Global Constraints

- Preço cobrado = `ai_model.raw_cost_brl(tokens…, usd_to_brl) × (1 + markup/100)`, markup de `ai_model.effective_markup_pct` (padrão `DEFAULT_MARKUP_PCT = 60`); câmbio fotografado em `usd_to_brl_rate`. Nunca recalcular histórico.
- Débito sempre dentro de `ActiveRecord::Base.transaction` com `balance.lock!` e `deduct!(…, completed_usage: true)`.
- Modelo sem preço (`has_pricing?` false) → HTTP 503 `{ error: 'pricing_unavailable' }` e **nenhum** `AiUsageLog`. Modelo fora do catálogo → 422 `{ error: 'unknown_model' }`.
- `request_id` é idempotente por time: reenvio devolve o mesmo resultado com `duplicate: true` e não debita.
- `ai_balance` exige usuário pertencendo ao time (como `subject`); `ai_usage` exige time existente e não-demo e usuário existente, **sem** exigir pertencimento atual. Usuário inexistente → 410 `{ error: 'user_gone' }`.
- Todas as respostas com `Cache-Control: no-store`; as duas rotas entram em `SERVICE_ACCESS_PATHS`; `SERVICE_ACCESS_LIMIT` passa de 3_000 para 6_000.
- `usage_type` novo: `jurcrawler_chat`. `feature` do webhook FFD: `jurcrawler_chat`; `provider`: `openrouter`.
- Comando de teste Rails: `docker exec procstudio_api bundle exec rspec <caminho>`; frontend: `cd frontend && npx vitest run <caminho>`.
- Mensagens ao usuário em pt-BR; nunca logar segredo de serviço.

## Review Focus

- `ai_usage` com `input_tokens`/`output_tokens` negativos, não inteiros ou ausentes → 422, nada debitado (teste na Task 3).
- `ai_usage` concorrente com o mesmo `request_id` (duas requisições simultâneas) → exatamente um débito; o índice único é quem garante, e o código precisa capturar `ActiveRecord::RecordNotUnique` e responder como duplicata (teste na Task 2).
- Time com saldo abaixo da tolerância ainda recebe o débito do uso concluído (`completed_usage: true`), e `can_operate` volta `false` na resposta (teste na Task 3).
- `ai_balance` para time demo → `can_operate: false` com a mensagem de demo, saldo informado mesmo assim (teste na Task 3).
- `team_id` de outro time no `ai_usage` com usuário válido → o time informado é quem paga; o teste garante que o débito cai no `team_id` do corpo e não no `user.team` (teste na Task 3).

---

### Task 1: Tipo de uso `jurcrawler_chat` e idempotência no `AiUsageLog`

**Files:**
- Create: `api/db/migrate/20261022120000_add_external_request_to_ai_usage_logs.rb`
- Modify: `api/app/models/ai_usage_log.rb`
- Modify: `api/db/schema.rb` (gerado pela migration)
- Test: `api/spec/models/ai_usage_log_spec.rb` (criar se não existir)

**Interfaces:**
- Produces: colunas `ai_usage_logs.external_request_id :string` e `ai_usage_logs.metadata :jsonb, default: {}, null: false`; índice único parcial `index_ai_usage_logs_on_team_id_and_external_request_id` em `(team_id, external_request_id) WHERE external_request_id IS NOT NULL`; `AiUsageLog::USAGE_TYPES` inclui `'jurcrawler_chat'`; scope `AiUsageLog.jurcrawler_usage`.

- [ ] **Step 1: Escrever os testes que falham**

```ruby
# api/spec/models/ai_usage_log_spec.rb
RSpec.describe AiUsageLog do
  it 'aceita o usage_type jurcrawler_chat' do
    log = build(:ai_usage_log, usage_type: 'jurcrawler_chat')
    expect(log).to be_valid
  end

  it 'recusa external_request_id repetido no mesmo time e aceita em times diferentes' do
    team = create(:team)
    create(:ai_usage_log, team: team, external_request_id: 'req-1')
    expect { create(:ai_usage_log, team: team, external_request_id: 'req-1') }
      .to raise_error(ActiveRecord::RecordNotUnique)
    expect { create(:ai_usage_log, team: create(:team), external_request_id: 'req-1') }.not_to raise_error
  end

  it 'permite external_request_id nulo repetido' do
    team = create(:team)
    expect { 2.times { create(:ai_usage_log, team: team, external_request_id: nil) } }.not_to raise_error
  end

  it 'scope jurcrawler_usage filtra só o tipo novo' do
    team = create(:team)
    create(:ai_usage_log, team: team, usage_type: 'jurcrawler_chat')
    create(:ai_usage_log, team: team, usage_type: 'chat_message')
    expect(AiUsageLog.for_team(team).jurcrawler_usage.count).to eq(1)
  end
end
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/models/ai_usage_log_spec.rb`
Expected: FAIL (`usage_type` inválido; coluna `external_request_id` inexistente).

- [ ] **Step 3: Migration + modelo**

Migration adiciona as duas colunas e o índice único parcial com o nome acima. No modelo: incluir `'jurcrawler_chat'` em `USAGE_TYPES` e `scope :jurcrawler_usage, -> { where(usage_type: 'jurcrawler_chat') }`.

- [ ] **Step 4: Rodar migration e testes**

Run: `docker exec procstudio_api bundle exec rails db:migrate && docker exec procstudio_api bundle exec rspec spec/models/ai_usage_log_spec.rb`
Expected: PASS; `db/schema.rb` atualizado.

- [ ] **Step 5: Commit**

```bash
git add api/db/migrate api/db/schema.rb api/app/models/ai_usage_log.rb api/spec/models/ai_usage_log_spec.rb
git commit -m "feat(billing): usage_type jurcrawler_chat e external_request_id idempotente no AiUsageLog"
```

---

### Task 2: `BillingService.record_jurcrawler_usage!` e telemetria FFD

**Files:**
- Modify: `api/app/services/ai/billing/billing_service.rb`
- Create: `api/app/services/ai/billing/errors.rb`
- Modify: `api/app/services/llm_tracker.rb`
- Test: `api/spec/services/ai/billing/billing_service_jurcrawler_spec.rb`
- Test: `api/spec/services/llm_tracker_spec.rb` (adicionar exemplo; criar se não existir)

**Interfaces:**
- Consumes: Task 1 (`external_request_id`, `metadata`, `jurcrawler_usage`).
- Produces:
  - `Ai::Billing::PricingUnavailableError < StandardError`, `Ai::Billing::UnknownModelError < StandardError` (em `errors.rb`).
  - `Ai::Billing::BillingService.record_jurcrawler_usage!(team:, user:, model_id:, request_id:, input_tokens:, output_tokens:, cache_read_tokens: 0, cache_write_tokens: 0, metadata: {})` → `Result` com `data: { usage_log:, billed_cents: Integer, balance_cents: Integer, duplicate: Boolean }`. Levanta `UnknownModelError` / `PricingUnavailableError`. Nunca levanta `InsufficientBalanceError` (uso concluído).
  - `LLMTracker.enqueue_usage(feature:, model:, provider:, input_tokens:, output_tokens:, cache_read_tokens: 0, cache_write_tokens: 0)` → enfileira `TokenUsageWebhook` com o mesmo payload de `enqueue_success` (`status: 'success'`), público, sem bloco. Respeita `LLMTracking.enabled?`.

- [ ] **Step 1: Testes do serviço**

```ruby
# api/spec/services/ai/billing/billing_service_jurcrawler_spec.rb
RSpec.describe Ai::Billing::BillingService, '.record_jurcrawler_usage!' do
  let(:team) { create(:team) }
  let(:user) { create(:user, team: team) }
  let!(:model) { create(:ai_model, :with_pricing, model_id: 'glm-5.3-flash', provider: 'zai') }
  let(:args) { { team: team, user: user, model_id: 'glm-5.3-flash', request_id: 'c1:t1:r1',
                 input_tokens: 1_000_000, output_tokens: 0, metadata: { 'provider' => 'openrouter' } } }

  before do
    team.ai_balance_or_create.update!(balance_cents: 1_000)
    allow(Ai::Billing::ExchangeRateService).to receive(:usd_to_brl).and_return(BigDecimal('5'))
  end

  it 'debita tokens × preço × câmbio × 1,60 e grava o log com metadata' do
    result = described_class.record_jurcrawler_usage!(**args)
    # 1M × 0.000003 USD = 3 USD × 5 = 15 BRL × 1.6 = 24 BRL = 2400 centavos
    expect(result.data[:billed_cents]).to eq(2_400)
    expect(result.data[:balance_cents]).to eq(1_000 - 2_400)
    log = result.data[:usage_log]
    expect(log).to have_attributes(usage_type: 'jurcrawler_chat', external_request_id: 'c1:t1:r1',
                                   usd_to_brl_rate: 5, markup_pct: 60, status: 'completed')
    expect(log.metadata).to include('provider' => 'openrouter')
  end

  it 'é idempotente por request_id: segunda chamada não debita e devolve duplicate' do
    described_class.record_jurcrawler_usage!(**args)
    second = described_class.record_jurcrawler_usage!(**args)
    expect(second.data[:duplicate]).to be(true)
    expect(team.ai_balance.reload.balance_cents).to eq(1_000 - 2_400)
    expect(AiUsageLog.jurcrawler_usage.count).to eq(1)
  end

  it 'trata corrida pelo índice único como duplicata' do
    # Simula duas requisições simultâneas: a busca prévia da segunda chamada não vê o
    # log da primeira, o create! bate no índice único e o serviço responde duplicata.
    chamadas = 0
    allow(AiUsageLog).to receive(:find_by).and_wrap_original do |original, *a, **kw|
      chamadas += 1
      kw[:external_request_id] && chamadas == 2 ? nil : original.call(*a, **kw)
    end
    described_class.record_jurcrawler_usage!(**args)
    second = described_class.record_jurcrawler_usage!(**args)
    expect(second.data[:duplicate]).to be(true)
    expect(AiUsageLog.jurcrawler_usage.count).to eq(1)
    expect(team.ai_balance.reload.balance_cents).to eq(1_000 - 2_400)
  end

  it 'modelo sem preço levanta PricingUnavailableError sem criar log' do
    model.update!(litellm_input_cost: nil, litellm_output_cost: nil)
    expect { described_class.record_jurcrawler_usage!(**args) }.to raise_error(Ai::Billing::PricingUnavailableError)
    expect(AiUsageLog.count).to eq(0)
  end

  it 'modelo fora do catálogo levanta UnknownModelError' do
    expect { described_class.record_jurcrawler_usage!(**args, model_id: 'nope') }.to raise_error(Ai::Billing::UnknownModelError)
  end

  it 'debita mesmo com saldo abaixo da tolerância (uso concluído)' do
    team.ai_balance.update!(balance_cents: -10_000)
    expect { described_class.record_jurcrawler_usage!(**args) }.not_to raise_error
    expect(team.ai_balance.reload.balance_cents).to eq(-12_400)
  end

  it 'enfileira TokenUsageWebhook com feature jurcrawler_chat e provider openrouter' do
    allow(LLMTracking).to receive(:enabled?).and_return(true)
    expect { described_class.record_jurcrawler_usage!(**args) }
      .to have_enqueued_job(TokenUsageWebhook).with(hash_including('feature' => 'jurcrawler_chat', 'provider' => 'openrouter', 'tokens_in' => 1_000_000))
  end
end
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/services/ai/billing/billing_service_jurcrawler_spec.rb`
Expected: FAIL com `NoMethodError: record_jurcrawler_usage!`.

- [ ] **Step 3: Implementar**

`errors.rb` com as duas classes. Em `BillingService`: procurar duplicata por `AiUsageLog.find_by(team:, external_request_id:)` antes da transação; dentro da transação `lock!`, `create!` com `usage_type: 'jurcrawler_chat'`, `loggable: nil`, `external_request_id`, `metadata`; `rescue ActiveRecord::RecordNotUnique` → reler o log existente e responder duplicata. Após a transação, `LLMTracker.enqueue_usage(feature: 'jurcrawler_chat', model: model_id, provider: metadata['provider'] || 'openrouter', …)`. Em `LLMTracker`, extrair o merge de `enqueue_success` para `enqueue_usage` e fazer `enqueue_success` delegar a ele.

- [ ] **Step 4: Rodar e ver passar (incluindo a suíte existente do tracker e do billing)**

Run: `docker exec procstudio_api bundle exec rspec spec/services/ai/billing spec/services/llm_tracker_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/services/ai/billing api/app/services/llm_tracker.rb api/spec/services
git commit -m "feat(billing): record_jurcrawler_usage! idempotente com telemetria FFD"
```

---

### Task 3: Endpoints `ai_balance` e `ai_usage`, rotas, Rack::Attack, Bruno e docs SSO

**Files:**
- Modify: `api/app/controllers/api/v1/service_access_controller.rb`
- Create: `api/app/services/service_access/ai_billing.rb`
- Modify: `api/config/routes.rb` (junto das 5 rotas `service_access/*`)
- Modify: `api/config/initializers/rack_attack.rb` (`SERVICE_ACCESS_PATHS`, `SERVICE_ACCESS_LIMIT = 6_000`)
- Create: `collection/ProcStudio/Development/Service Access/AiBalance.bru`, `AiUsage.bru`
- Modify: `docs/JurCrawler-SSO.md`, `CLAUDE-JURCRAWLER.md`
- Test: `api/spec/requests/api/v1/service_access_billing_spec.rb`
- Test: `api/spec/initializers/rack_attack_spec.rb` (adicionar exemplo)

**Interfaces:**
- Consumes: Task 2 (`record_jurcrawler_usage!`, erros), `ServiceAccess::Issuer.service_authenticated?`, `BillingService.check_balance!`, `Ai::Billing::Limits`.
- Produces:
  - `POST /api/v1/service_access/ai_balance` → 200 com `{ active, can_operate, balance_cents, balance_brl, negative_limit_cents, message, topup_path, model: { model_id, name, input_per_1m_brl, output_per_1m_brl } }`; `active: false` (200) quando usuário/time não conferem; 503 `pricing_unavailable`.
  - `POST /api/v1/service_access/ai_usage` → 200 `{ billed_cents, billed_brl, balance_cents, balance_brl, can_operate, usage_log_id, duplicate }`; 410 `user_gone`; 422 `unknown_model` | `invalid_usage`; 503 `pricing_unavailable`; 404 `{ error: 'team_not_found' }`; 403 `{ error: 'demo_team' }`.
  - `ServiceAccess::AiBilling::MODEL_ID = 'glm-5.3-flash'` (constante única do modelo travado; lida por `ai_balance`).
  - `ServiceAccess::AiBilling#balance(user_id:, team_id:)` e `#usage(params)` devolvendo `[status, body]`.

- [ ] **Step 1: Spec de request**

```ruby
# api/spec/requests/api/v1/service_access_billing_spec.rb
RSpec.describe 'Service access AI billing', type: :request do
  let(:team) { create(:team) }
  let(:user) { create(:user, team: team) }
  let(:headers) { { 'Authorization' => 'Bearer service-fixture', 'Content-Type' => 'application/json' } }
  let!(:model) { create(:ai_model, :with_pricing, model_id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', provider: 'zai') }

  before do
    allow(ServiceAccess::Issuer).to receive(:configuration).and_return(
      { client_id: 'jur', secret: 'service-fixture', redirect_uri: 'https://jur.example/auth/callback', issuer: 'https://rails.example' }
    )
    allow(Ai::Billing::ExchangeRateService).to receive(:usd_to_brl).and_return(BigDecimal('5'))
    team.ai_balance_or_create.update!(balance_cents: 1_000)
  end

  def balance(body = {}) = post('/api/v1/service_access/ai_balance', params: { client_id: 'jur', user_id: user.id, team_id: team.id }.merge(body).to_json, headers: headers)
  def usage(body = {})
    post '/api/v1/service_access/ai_usage', params: {
      client_id: 'jur', user_id: user.id, team_id: team.id, request_id: 'c1:t1:r1', model_id: 'glm-5.3-flash',
      input_tokens: 1_000_000, output_tokens: 0, provider: 'openrouter', provider_model: 'z-ai/glm-5.3-flash',
      provider_cost_usd: 0.1, provider_generation_id: 'gen-1', conversation_id: 'c1'
    }.merge(body).to_json, headers: headers
  end

  it 'ai_balance devolve saldo, limite do plano e preço do modelo' do
    balance
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include('active' => true, 'can_operate' => true, 'balance_cents' => 1_000,
                                            'negative_limit_cents' => -50, 'topup_path' => '/equipe?tab=billing')
    expect(response.parsed_body.dig('model', 'model_id')).to eq('glm-5.3-flash')
    expect(response.parsed_body.dig('model', 'input_per_1m_brl')).to eq(24.0)
    expect(response.headers['Cache-Control']).to include('no-store')
  end

  it 'ai_balance com saldo no limite devolve can_operate false e a mensagem do plano' do
    team.ai_balance.update!(balance_cents: -50)
    balance
    expect(response.parsed_body).to include('can_operate' => false)
    expect(response.parsed_body['message']).to include('Saldo insuficiente')
  end

  it 'ai_balance de time demo devolve can_operate false' do
    team.update!(settings: { 'demo_seed' => true })
    balance
    expect(response.parsed_body).to include('active' => true, 'can_operate' => false)
  end

  it 'ai_balance com usuário de outro time devolve active false' do
    balance(team_id: create(:team).id)
    expect(response.parsed_body).to eq('active' => false)
  end

  it 'ai_balance sem preço sincronizado responde 503 pricing_unavailable' do
    model.update!(litellm_input_cost: nil, litellm_output_cost: nil)
    balance
    expect(response).to have_http_status(:service_unavailable)
    expect(response.parsed_body['error']).to eq('pricing_unavailable')
  end

  it 'ai_usage debita, grava metadata e devolve saldo novo' do
    usage
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include('billed_cents' => 2_400, 'balance_cents' => -1_400, 'can_operate' => false, 'duplicate' => false)
    log = AiUsageLog.jurcrawler_usage.last
    expect(log.metadata).to include('provider_generation_id' => 'gen-1', 'conversation_id' => 'c1', 'provider_cost_usd' => 0.1)
  end

  it 'ai_usage repetido devolve duplicate sem debitar de novo' do
    usage; usage
    expect(response.parsed_body['duplicate']).to be(true)
    expect(team.ai_balance.reload.balance_cents).to eq(-1_400)
  end

  it 'ai_usage debita o team_id do corpo mesmo que o usuário tenha trocado de time' do
    other = create(:team)
    other.ai_balance_or_create.update!(balance_cents: 5_000)
    user.update!(team: other)
    usage
    expect(response).to have_http_status(:ok)
    expect(team.ai_balance.reload.balance_cents).to eq(-1_400)
    expect(other.ai_balance.reload.balance_cents).to eq(5_000)
  end

  it 'ai_usage com usuário inexistente responde 410 user_gone' do
    usage(user_id: 0)
    expect(response).to have_http_status(:gone)
    expect(response.parsed_body['error']).to eq('user_gone')
  end

  it 'ai_usage de time demo responde 403 e não debita' do
    team.update!(settings: { 'demo_seed' => true })
    usage
    expect(response).to have_http_status(:forbidden)
    expect(AiUsageLog.count).to eq(0)
  end

  it 'ai_usage com tokens inválidos responde 422 invalid_usage sem debitar' do
    usage(input_tokens: -1)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body['error']).to eq('invalid_usage')
    usage(output_tokens: 'x')
    expect(response).to have_http_status(:unprocessable_entity)
    expect(AiUsageLog.count).to eq(0)
  end

  it 'ai_usage com modelo desconhecido responde 422 unknown_model' do
    usage(model_id: 'nope')
    expect(response.parsed_body['error']).to eq('unknown_model')
  end

  it 'sem segredo de serviço responde 401' do
    post '/api/v1/service_access/ai_usage', params: {}.to_json, headers: headers.merge('Authorization' => 'Bearer errado')
    expect(response).to have_http_status(:unauthorized)
  end
end
```

E em `rack_attack_spec.rb`, um exemplo no mesmo molde dos já existentes: `POST /api/v1/service_access/ai_usage` com Bearer válido cai no balde `client:jurcrawler` e o teto é 6_000.

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/service_access_billing_spec.rb`
Expected: FAIL com 404 de rota.

- [ ] **Step 3: Implementar**

`ServiceAccess::AiBilling` concentra a lógica (o controller só chama e renderiza): validação de inteiros ≥ 0 nos tokens; `balance` reaproveita `check_balance!` e `Limits.negative_limit_cents`, `insufficient_balance_message`; preço por 1M = `litellm_*_cost × 1_000_000 × usd_to_brl × (1 + markup/100)` arredondado a 4 casas; `topup_path = PlanEnforceable::UPGRADE_PATH`. `usage` chama `record_jurcrawler_usage!` com `metadata` contendo `client_id, provider, provider_model, provider_cost_usd, provider_generation_id, conversation_id`, e mapeia exceções para os status da Interfaces. Rotas e constantes do Rack::Attack conforme Global Constraints. Bruno `.bru` seguindo `Subject.bru`.

- [ ] **Step 4: Rodar todas as specs tocadas**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/service_access_billing_spec.rb spec/requests/api/v1/service_access_spec.rb spec/initializers/rack_attack_spec.rb`
Expected: PASS.

- [ ] **Step 5: Docs**

`docs/JurCrawler-SSO.md`: tabela de rotas ganha as duas novas, balde `service_access/client` passa a 6.000, seção "Cobrança" com o contrato dos dois endpoints (copiar os JSONs da spec seção 4.2). `CLAUDE-JURCRAWLER.md`: uma linha por endpoint e a regra "modelo sem preço = 503, nunca cobra zero".

- [ ] **Step 6: Commit**

```bash
git add api/app/controllers/api/v1/service_access_controller.rb api/app/services/service_access api/config/routes.rb api/config/initializers/rack_attack.rb api/spec collection docs/JurCrawler-SSO.md CLAUDE-JURCRAWLER.md
git commit -m "feat(service_access): ai_balance e ai_usage para o JurCrawler cobrar do saldo do time"
```

---

### Task 4: Extrato, badge e docs de billing

**Files:**
- Modify: `api/app/controllers/api/v1/ai_usage_controller.rb` (`summary`)
- Modify: `frontend/src/lib/api/types/billing.types.ts`
- Modify: `frontend/src/lib/components/ai/AiUsageLogTable.svelte`
- Modify: `frontend/src/lib/components/ai/AiUsageBadge.svelte`
- Modify: `CLAUDE-BILLING-AI-CREDITS.md`, `docs/JurCrawler.md`
- Test: `api/spec/requests/api/v1/ai_usage_spec.rb` (adicionar exemplo)
- Test: `frontend/src/lib/components/ai/AiUsageLogTable.svelte.test.ts` (criar, no molde de `AiModelPicker.svelte.test.ts`)

**Interfaces:**
- Produces: `summary` com `jurcrawler_requests: Integer` e `jurcrawler_billed_brl: Float`; `AiUsageSummary` TS com os dois campos; `AiUsageLog.usage_type` TS inclui `'jurcrawler_chat'`; rótulo "JurCrawler" na tabela; linha "JurCrawler · N usos" no hover do badge.

- [ ] **Step 1: Testes**

```ruby
# em ai_usage_spec.rb, dentro de describe 'GET /api/v1/ai_usage/summary'
it 'conta e soma o uso do JurCrawler' do
  create(:ai_usage_log, team: team, user: user, usage_type: 'jurcrawler_chat', billed_amount_brl: 0.25)
  get '/api/v1/ai_usage/summary', headers: auth_headers
  expect(response.parsed_body['data']).to include('jurcrawler_requests' => 1, 'jurcrawler_billed_brl' => 0.25)
end
```

```ts
// AiUsageLogTable.svelte.test.ts
it('rotula jurcrawler_chat como JurCrawler', () => {
  render(AiUsageLogTable, { props: { logs: [{ id: 1, usage_type: 'jurcrawler_chat', model_name: 'GLM-5.3 Flash', model_id: 'glm-5.3-flash', input_tokens: 10, output_tokens: 5, duration_seconds: null, raw_cost_brl: 0.01, markup_pct: 60, billed_amount_brl: 0.02, usd_to_brl_rate: 5, status: 'completed', created_at: new Date().toISOString() }], loading: false } });
  expect(screen.getByText('JurCrawler')).toBeTruthy();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/ai_usage_spec.rb` e `cd frontend && npx vitest run src/lib/components/ai/AiUsageLogTable.svelte.test.ts`
Expected: FAIL (campos ausentes; rótulo cai no `default`).

- [ ] **Step 3: Implementar**

`summary`: `jurcrawler_requests: logs.jurcrawler_usage.count`, `jurcrawler_billed_brl: logs.jurcrawler_usage.total_billed.to_f`. Tabela: `case 'jurcrawler_chat': return 'JurCrawler'` e badge `bg-indigo-50 text-indigo-600 border border-indigo-200`. Badge do topo: linha com `summary.jurcrawler_requests` e bolinha `bg-indigo-500`. Tipos TS ampliados.

- [ ] **Step 4: Rodar e ver passar + lint**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/ai_usage_spec.rb && cd frontend && npx vitest run src/lib/components/ai && npx eslint src/lib/components/ai src/lib/api/types/billing.types.ts`
Expected: PASS, zero erros de lint.

- [ ] **Step 5: Docs**

`CLAUDE-BILLING-AI-CREDITS.md`: `jurcrawler_chat` na lista de tipos, `record_jurcrawler_usage!` na tabela de arquivos, regra "idempotente por `external_request_id`". `docs/JurCrawler.md` seção Cobrança: "cada rodada de LLM do chat é um `jurcrawler_chat`; GLM-5.3 Flash via OpenRouter; saldo esgotado interrompe".

- [ ] **Step 6: Commit e PR**

```bash
git add api/app/controllers/api/v1/ai_usage_controller.rb api/spec/requests/api/v1/ai_usage_spec.rb frontend/src/lib CLAUDE-BILLING-AI-CREDITS.md docs/JurCrawler.md
git commit -m "feat(ia-uso): JurCrawler no resumo, na tabela e no badge de saldo"
```

Abrir PR para `main` descrevendo os dois endpoints e o pré-requisito de deploy: conferir preço de `glm-5.3-flash` com `rails runner tmp/verify_litellm_pricing.rb` em produção antes de ligar a conexão no crawler.
