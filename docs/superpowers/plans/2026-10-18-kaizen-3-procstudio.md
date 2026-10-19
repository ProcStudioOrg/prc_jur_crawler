# Kaizen entrega 3 — ProcStudio manda relatos ao FFD (user-issues) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo relato do widget "Reportar" do ProcStudio também chega ao FFD (`POST /api/webhooks/user-issues`) por um job Sidekiq, e uma queda do Linear deixa de virar 502 quando o relato foi enfileirado para o FFD.

**Architecture:** A cola muda; o núcleo `api/app/services/issue_reporter.rb` não. `IssueReporterSettings` passa a ler `FFD_USER_ISSUES_URL`/`FFD_USER_ISSUES_TOKEN`. `IssueReportsController#create` monta o payload `user-issues` (fatos do servidor: usuário, time, plano) depois do `submit`, com o card ou com `linear: nil` no `LinearError`, e enfileira `FfdUserIssueJob`. O job faz o POST com header `x-webhook-token`. 408/429/5xx/rede levantam erro e caem no retry padrão do Sidekiq; os demais 4xx são descartados e vão ao Sentry, como no `FfdBotAlertJob`.

**Tech Stack:** Rails 8 API, ActiveJob sobre Sidekiq (fila `low`), HTTParty, RSpec + WebMock, RuboCop. O repo é `/Users/brpl/code/ProcStudio/ProcStudio-Docker`.

**Spec:** `/Users/brpl/code/ProcStudio/prc_jur_crawler/docs/superpowers/specs/2026-10-18-kaizen-falhas-design.md`. Valem a seção 8, o payload `user-issues` da seção 6, as Restrições e a decisão 5 de "Decisões após a revisão do builder".

## Global Constraints

- Contrato `user-issues`, copiado da seção 6: `{ servico, titulo, descricao (até 2000), autor_email, autor_nome?, equipe?, rota?, versao?, linear: { identifier, url } | null, contexto: {chave: valor}, em }`, com `servico: "procstudio"`. As chaves são strings no hash do job.
- `api/app/services/issue_reporter.rb` não muda (`git diff origin/development -- api/app/services/issue_reporter.rb` vazio no fim).
- Envs: `FFD_USER_ISSUES_URL` (URL completa, sem `?token=`: `https://ffd.belzinhos.com.br/api/webhooks/user-issues`) e `FFD_USER_ISSUES_TOKEN` (endpoint key do FFD com escopo `user-issues`). Se faltar uma das duas, nada é enfileirado nem enviado.
- O token vai no header `x-webhook-token`, nunca na URL nem no log.
- Retry: o padrão do Sidekiq (sem `retry_on`) para 408/429/5xx/rede. Os demais 4xx são descartados com Sentry. É o que a spec chama de "Retry padrão do Sidekiq", acrescido do descarte de 4xx que é o padrão do repo (`FfdBotAlertJob`).
- O job vai na fila `:low`.
- Comportamento HTTP: com `submit` ok, a resposta continua igual. Com `LinearError` e envio enfileirado, a resposta é `200 {ok:true, identifier:nil, url:nil}`. O widget é montado com `showIssueLink:false` (`frontend/src/lib/components/IssueReporter.svelte:54`) e mostra "Recebido. Obrigado — vamos olhar." Com `LinearError` e sem enfileirar, continua `502` com a mesma mensagem de hoje. `SubmissionError` (400/422/503) nunca enfileira.
- Branch `feat/ffd-user-issues` saída de `origin/development`. PR contra `development`. Sem deploy.
- Regras do repo: Conventional Commits; RuboCop `Layout/LineLength` 120, `Metrics/MethodLength` 20, `Metrics/AbcSize` 20; testes via `docker exec procstudio_api bundle exec rspec …` (o container monta `ProcStudio-Docker/api`); racional salvo em `agents/prompts/`.

## Review Focus

- **Card nulo apagado pelo `compact`:** `linear: nil` é parte do contrato e precisa ir como `null`. Só as chaves opcionais (`autor_nome`, `equipe`, `rota`, `versao`) saem quando vazias. O teste fica na Task 3 (`'Linear fora … enfileira com linear nil'` confere `'linear' => nil` com a chave presente).
- **Usuário sem `user_profile`:** `User#full_name` é `delegate` sem `allow_nil` e levanta erro. O payload usa `user.user_profile&.full_name`, e o relato não pode virar 500. O teste fica na Task 3 (`'usuário sem perfil …'`).
- **Redis fora na hora de enfileirar:** se `perform_later` levantar, o caso de sucesso do Linear continua 200 e o caso de Linear fora continua 502, nunca 500. Os testes ficam na Task 3.
- **Descrição longa:** o núcleo aceita até 6000 caracteres, e o contrato do FFD aceita 2000. `descricao` é cortada em 2000. O teste fica na Task 3.
- **Token errado ou source sem escopo (401/403 do FFD):** não pode ficar 25 vezes na fila de retry. É descartado e vai ao Sentry sem o token. O teste fica na Task 2.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| Modify `api/app/services/issue_reporter_settings.rb` | lê as duas envs, diz se o envio ao FFD está ligado e define o teto da descrição |
| Modify `api/spec/services/issue_reporter_settings_spec.rb` | testes das três leituras |
| Create `api/app/jobs/ffd_user_issue_job.rb` | POST `user-issues`, classificação da resposta, retry/descarte |
| Create `api/spec/jobs/ffd_user_issue_job_spec.rb` | testes do transporte |
| Modify `api/app/controllers/api/v1/issue_reports_controller.rb` | monta o payload, enfileira e decide 200/502 no `LinearError` |
| Modify `api/spec/requests/api/v1/issue_reports_spec.rb` | testes do fluxo do relato |
| Modify `api/.env.example` | documenta as duas envs ao lado do bloco do Linear (linha ~277) |
| Modify `frontend/static/changelog.md` | linha de 18/10/2026 (o relato não se perde com o Linear fora) |
| Create `agents/prompts/ffd-user-issues-2026-10-18.md` | racional curto, com link para a spec do jur |

---

### Task 1: Settings do FFD na cola

**Files:**
- Modify: `api/app/services/issue_reporter_settings.rb` (depois de `presence`, ou junto de `app_options`)
- Modify: `api/.env.example` (bloco do Linear, depois da linha `LINEAR_TEAM_ID=`)
- Test: `api/spec/services/issue_reporter_settings_spec.rb`

**Interfaces:**
- Produces:
  - `IssueReporterSettings::FFD_USER_ISSUES_MAX_DESCRICAO = 2000`
  - `IssueReporterSettings.ffd_user_issues_url -> String | nil` (de `ENV['FFD_USER_ISSUES_URL']` via `presence`)
  - `IssueReporterSettings.ffd_user_issues_token -> String | nil` (de `ENV['FFD_USER_ISSUES_TOKEN']` via `presence`)
  - `IssueReporterSettings.ffd_user_issues_enabled? -> Boolean` (as duas presentes)

- [ ] **Step 1: Criar a branch**

```bash
cd /Users/brpl/code/ProcStudio/ProcStudio-Docker
git status --short   # só os 3 untracked de agents/prompts são tolerados; ver agents/chat se houver outro agente
git fetch origin && git switch -c feat/ffd-user-issues origin/development
docker compose -f devops/docker-compose.yml ps --format "{{.Name}} {{.State}}"   # procstudio_api running
```

- [ ] **Step 2: Escrever os testes que falham** em `issue_reporter_settings_spec.rb`, num `describe 'FFD user-issues'` com `around` que salva e restaura as duas envs (padrão de `spec/jobs/tool_usage_report_job_spec.rb`):

```ruby
it 'liga só com URL e token' do
  ENV['FFD_USER_ISSUES_URL'] = 'https://ffd.example/api/webhooks/user-issues'
  ENV['FFD_USER_ISSUES_TOKEN'] = 'tok'
  expect(described_class.ffd_user_issues_enabled?).to be(true)
  expect(described_class.ffd_user_issues_url).to eq('https://ffd.example/api/webhooks/user-issues')
  expect(described_class.ffd_user_issues_token).to eq('tok')
end

it 'string vazia conta como ausente' do
  ENV['FFD_USER_ISSUES_URL'] = 'https://ffd.example/api/webhooks/user-issues'
  ENV['FFD_USER_ISSUES_TOKEN'] = ''
  expect(described_class.ffd_user_issues_token).to be_nil
  expect(described_class.ffd_user_issues_enabled?).to be(false)
end

it 'sem URL fica desligado' do
  ENV.delete('FFD_USER_ISSUES_URL')
  ENV['FFD_USER_ISSUES_TOKEN'] = 'tok'
  expect(described_class.ffd_user_issues_enabled?).to be(false)
end
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/services/issue_reporter_settings_spec.rb`
Expected: FAIL com `undefined method 'ffd_user_issues_enabled?'`

- [ ] **Step 4: Implementar** as três funções e a constante (dentro do `module_function`, reaproveitando `presence`). Em `.env.example`, comentar as duas linhas: `# FFD_USER_ISSUES_URL=https://ffd.belzinhos.com.br/api/webhooks/user-issues` e `# FFD_USER_ISSUES_TOKEN=` (endpoint key do FFD com source `user-issues`; sem as duas, o relato vai só ao Linear; em HML/prod vêm de `/…/PROCSTUDIO/API/ENV/*` e têm que estar nas taskdefs de api **e** sidekiq).

- [ ] **Step 5: Rodar e ver passar**

Run: `docker exec procstudio_api bundle exec rspec spec/services/issue_reporter_settings_spec.rb`
Expected: PASS (inclusive os testes antigos de cobertura de rotas)

- [ ] **Step 6: Commit**

```bash
git add api/app/services/issue_reporter_settings.rb api/spec/services/issue_reporter_settings_spec.rb api/.env.example
git commit -m "feat(issue-reporter): le FFD_USER_ISSUES_URL/TOKEN na cola"
```

---

### Task 2: `FfdUserIssueJob`

**Files:**
- Create: `api/app/jobs/ffd_user_issue_job.rb`
- Test: `api/spec/jobs/ffd_user_issue_job_spec.rb`

**Interfaces:**
- Consumes: `IssueReporterSettings.ffd_user_issues_url`, `.ffd_user_issues_token`, `.ffd_user_issues_enabled?` (Task 1)
- Produces:
  - `FfdUserIssueJob.perform_later(payload)`, em que `payload` é `Hash{String => Object}` no contrato `user-issues`
  - `FfdUserIssueJob#perform(payload) -> void`
  - `FfdUserIssueJob::RequestFailed < StandardError` (pede retry) e `FfdUserIssueJob::RequestRejected < StandardError` (descartado). As duas são **irmãs**, nenhuma herda da outra.

- [ ] **Step 1: Escrever os testes que falham.** `RSpec.describe FfdUserIssueJob, type: :job`, com `around` setando `FFD_USER_ISSUES_URL='https://ffd.example/api/webhooks/user-issues'` e `FFD_USER_ISSUES_TOKEN='tok'`. O `payload` é `{ 'servico' => 'procstudio', 'titulo' => 'Lista não carrega', 'descricao' => 'x', 'autor_email' => 'a@b.co', 'linear' => nil, 'contexto' => { 'Plano' => 'Pro' }, 'em' => '2026-10-18T12:00:00Z' }`.

```ruby
it 'POSTa o relato no FFD com x-webhook-token' do
  stub = stub_request(:post, url)
           .with(body: payload.to_json,
                 headers: { 'Content-Type' => 'application/json', 'X-Webhook-Token' => 'tok' })
           .to_return(status: 201)
  described_class.new.perform(payload)
  expect(stub).to have_been_requested
end

it 'sem token não envia nada' do
  ENV['FFD_USER_ISSUES_TOKEN'] = ''
  expect { described_class.new.perform(payload) }.not_to raise_error   # WebMock recusaria qualquer POST
end

it 'roda na fila :low' do
  expect(described_class.new.queue_name).to eq('low')
end

[500, 503, 530, 408, 429].each do |code|
  it "#{code} levanta RequestFailed para o retry do Sidekiq" do
    stub_request(:post, url).to_return(status: code)
    expect { described_class.new.perform(payload) }.to raise_error(FfdUserIssueJob::RequestFailed, /#{code}/)
  end
end

it 'timeout de rede levanta RequestFailed' do
  stub_request(:post, url).to_timeout
  expect { described_class.new.perform(payload) }.to raise_error(FfdUserIssueJob::RequestFailed)
end

it '401 é descartado (sem retry) e vai ao Sentry sem o token nem o e-mail' do
  captured = nil
  allow(Sentry).to receive(:capture_exception) { |err, **opts| captured = [err, opts] }
  stub_request(:post, url).to_return(status: 401)
  expect { described_class.perform_now(payload) }.not_to raise_error
  expect(captured[0]).to be_a(FfdUserIssueJob::RequestRejected)
  expect(captured[1][:tags]).to eq(feature: 'ffd_user_issue')
  expect(captured.to_s).not_to include('tok', 'a@b.co')
end
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/jobs/ffd_user_issue_job_spec.rb`
Expected: FAIL com `uninitialized constant FfdUserIssueJob`

- [ ] **Step 3: Implementar** `class FfdUserIssueJob < ApplicationJob`, com `queue_as :low` e **sem** `retry_on`. `discard_on RequestRejected { |job, e| Sentry.capture_exception(e, level: :error, tags: { feature: 'ffd_user_issue' }, extra: { servico:, titulo: }) }`: no extra vão só `servico` e `titulo` do payload, sem e-mail e sem token. `perform` retorna cedo se `!IssueReporterSettings.ffd_user_issues_enabled?` e faz `HTTParty.post(url, body: payload.to_json, headers: { 'Content-Type' => 'application/json', 'x-webhook-token' => token }, timeout: 10)`. Resposta não-2xx: 408/429/≥500 levantam `RequestFailed, "FFD respondeu #{code} ao relato"`, e os demais 4xx levantam `RequestRejected`. Erros de transporte usam a mesma lista `TRANSPORT_ERRORS` do `FfdBotAlertJob` (copiar a constante, não referenciar outro job) e viram `RequestFailed`.

- [ ] **Step 4: Rodar e ver passar**

Run: `docker exec procstudio_api bundle exec rspec spec/jobs/ffd_user_issue_job_spec.rb`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/jobs/ffd_user_issue_job.rb api/spec/jobs/ffd_user_issue_job_spec.rb
git commit -m "feat(issue-reporter): FfdUserIssueJob envia relato ao FFD (user-issues)"
```

---

### Task 3: Controller enfileira e responde "Recebido" com o Linear fora

**Files:**
- Modify: `api/app/controllers/api/v1/issue_reports_controller.rb:26-36` (`create`), mais métodos privados novos
- Test: `api/spec/requests/api/v1/issue_reports_spec.rb`

**Interfaces:**
- Consumes: `IssueReporterSettings.ffd_user_issues_enabled?`, `IssueReporterSettings::FFD_USER_ISSUES_MAX_DESCRICAO` (Task 1); `FfdUserIssueJob.perform_later(payload)` (Task 2); `IssueReporter::Linear.submit -> { ok:, identifier:, url: }` (núcleo, sem mudança)
- Produces (privados):
  - `enqueue_ffd_user_issue(linear) -> Boolean`: `linear` é `{ 'identifier' => String, 'url' => String }` ou `nil`. Devolve `false` se o envio está desligado ou se `perform_later` levantou (`rescue StandardError` → `Rails.logger.error("[issue-reporter] FFD: #{e.class}")`) e `true` se enfileirou.
  - `ffd_user_issue_payload(linear) -> Hash{String => Object}`, com os valores:
    - `servico`: `'procstudio'`
    - `titulo`: `report_params['title'].to_s.strip`, cortado em `IssueReporter::MAX_TITLE`
    - `descricao`: `report_params['body'].to_s.strip`, cortado em `FFD_USER_ISSUES_MAX_DESCRICAO`
    - `autor_email`: `current_user.email`
    - `autor_nome`: `current_user.user_profile&.full_name`
    - `equipe`: `current_team&.name`
    - `rota`: `report_params.dig('context','path')`, cortado em 200
    - `versao`: `ENV['APP_VERSION']`
    - `linear`: o valor recebido
    - `contexto`: `server_context` (o mesmo Hash que já vai ao Linear, com plano incluso)
    - `em`: `Time.current.utc.iso8601`
  - Só `autor_nome`/`equipe`/`rota`/`versao` são omitidos quando vazios. `linear` vai sempre, mesmo `nil`.

- [ ] **Step 1: Escrever os testes que falham.** No `before` de topo: `allow(IssueReporterSettings).to receive(:ffd_user_issues_enabled?).and_return(true)`. O teste antigo `'falha do Linear vira 502 …'` passa a declarar `ffd_user_issues_enabled?` → `false` e continua esperando 502. Testes novos em `describe 'POST … envio ao FFD'`:

```ruby
it 'com o card criado, enfileira o relato com o identificador' do
  allow(IssueReporter::Linear).to receive(:create_issue)
    .and_return({ 'identifier' => 'PRC-900', 'url' => 'https://linear.app/PRC-900' })
  expect { post '/api/v1/issue_reports', params: body, headers: auth_headers, as: :json }
    .to have_enqueued_job(FfdUserIssueJob).with(hash_including(
      'servico' => 'procstudio', 'titulo' => 'Lista de works não carrega depois do filtro',
      'autor_email' => user.email, 'equipe' => team.name, 'rota' => '/trabalhos',
      'linear' => { 'identifier' => 'PRC-900', 'url' => 'https://linear.app/PRC-900' },
      'contexto' => hash_including('Usuário' => user.email, 'Time' => team.name)
    )).on_queue('low')
  expect(response).to have_http_status(:ok)
end

it 'Linear fora: responde Recebido (200) e enfileira com linear nil' do
  allow(IssueReporter::Linear).to receive(:create_issue).and_raise(IssueReporter::LinearError, 'x')
  expect { post '/api/v1/issue_reports', params: body, headers: auth_headers, as: :json }
    .to have_enqueued_job(FfdUserIssueJob).with(hash_including('linear' => nil))
  expect(response).to have_http_status(:ok)
  expect(response.parsed_body).to eq('ok' => true, 'identifier' => nil, 'url' => nil)
end

it 'Linear fora e enfileiramento quebrado: continua 502' do
  allow(IssueReporter::Linear).to receive(:create_issue).and_raise(IssueReporter::LinearError, 'x')
  allow(FfdUserIssueJob).to receive(:perform_later).and_raise(StandardError, 'redis fora')
  post '/api/v1/issue_reports', params: body, headers: auth_headers, as: :json
  expect(response).to have_http_status(:bad_gateway)
end

it 'card criado e enfileiramento quebrado: continua 200 com o card' do
  allow(IssueReporter::Linear).to receive(:create_issue)
    .and_return({ 'identifier' => 'PRC-901', 'url' => 'https://linear.app/PRC-901' })
  allow(FfdUserIssueJob).to receive(:perform_later).and_raise(StandardError, 'redis fora')
  post '/api/v1/issue_reports', params: body, headers: auth_headers, as: :json
  expect(response).to have_http_status(:ok)
  expect(response.parsed_body['identifier']).to eq('PRC-901')
end

it 'sem FFD configurado não enfileira' do
  allow(IssueReporterSettings).to receive(:ffd_user_issues_enabled?).and_return(false)
  allow(IssueReporter::Linear).to receive(:create_issue).and_return({ 'identifier' => 'PRC-9', 'url' => 'u' })
  expect { post '/api/v1/issue_reports', params: body, headers: auth_headers, as: :json }
    .not_to have_enqueued_job(FfdUserIssueJob)
end

it 'validação (400) não enfileira' do
  expect { post '/api/v1/issue_reports', params: body.merge(title: 'ab'), headers: auth_headers, as: :json }
    .not_to have_enqueued_job(FfdUserIssueJob)
end

it 'descrição vai cortada em 2000 caracteres' do
  allow(IssueReporter::Linear).to receive(:create_issue).and_return({ 'identifier' => 'PRC-9', 'url' => 'u' })
  post '/api/v1/issue_reports', params: body.merge(body: 'a' * 2500), headers: auth_headers, as: :json
  job = ActiveJob::Base.queue_adapter.enqueued_jobs.find { |j| j['job_class'] == 'FfdUserIssueJob' }
  expect(job['arguments'].first['descricao'].length).to eq(2000)
end

it 'usuário sem perfil: relato sai sem autor_nome, não 500' do
  bare = create(:user, team: team)   # factory sem :with_lawyer_profile; se ela criar perfil, `bare.user_profile.destroy!`
  allow(IssueReporter::Linear).to receive(:create_issue).and_return({ 'identifier' => 'PRC-9', 'url' => 'u' })
  post '/api/v1/issue_reports', params: body,
       headers: { 'Authorization' => "Bearer #{bare.jwt_token}", 'Accept' => 'application/json' }, as: :json
  expect(response).to have_http_status(:ok)
  job = ActiveJob::Base.queue_adapter.enqueued_jobs.find { |j| j['job_class'] == 'FfdUserIssueJob' }
  expect(job['arguments'].first).not_to have_key('autor_nome')
end
```

(Se o `BackofficeController` recusar usuário sem perfil antes da action, troque a asserção por `user.user_profile.update!(…)` vazio e confira `autor_nome` ausente pelo nome em branco. O objetivo do teste é que nada passe a dar 500 por causa do envio ao FFD.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/issue_reports_spec.rb`
Expected: FAIL nos testes novos (`expected to enqueue FfdUserIssueJob`, `expected 200, got 502`), e os antigos continuam verdes

- [ ] **Step 3: Implementar** no `create`. Depois do `submit` ok, `enqueue_ffd_user_issue(result.slice(:identifier, :url).stringify_keys)` e `render json: result`. No `rescue IssueReporter::LinearError`, manter o log atual e responder `render json: { ok: true, identifier: nil, url: nil }` se `enqueue_ffd_user_issue(nil)`, senão o 502 de hoje. Atualizar o comentário do "ponto de troca" no topo da classe com uma linha: o relato também vai ao FFD, e o 502 só acontece quando os dois destinos falham. Os métodos ficam dentro dos limites do RuboCop (separar `ffd_optional_fields` se `AbcSize` passar de 20).

- [ ] **Step 4: Rodar e ver passar**

Run: `docker exec procstudio_api bundle exec rspec spec/requests/api/v1/issue_reports_spec.rb`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/controllers/api/v1/issue_reports_controller.rb api/spec/requests/api/v1/issue_reports_spec.rb
git commit -m "feat(issue-reporter): relato vai tambem ao FFD e Linear fora responde Recebido"
```

---

### Task 4: Verificação, docs e PR

**Files:**
- Modify: `frontend/static/changelog.md` (linha nova no topo da tabela, mesmo formato das de 17/10/2026)
- Create: `agents/prompts/ffd-user-issues-2026-10-18.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–3

- [ ] **Step 1: Suíte afetada + lint + núcleo intocado**

```bash
cd /Users/brpl/code/ProcStudio/ProcStudio-Docker
docker exec procstudio_api bundle exec rspec spec/services/issue_reporter_settings_spec.rb spec/services/issue_reporter_spec.rb spec/jobs/ffd_user_issue_job_spec.rb spec/requests/api/v1/issue_reports_spec.rb
docker exec procstudio_api bundle exec rubocop app/services/issue_reporter_settings.rb app/jobs/ffd_user_issue_job.rb app/controllers/api/v1/issue_reports_controller.rb spec/services/issue_reporter_settings_spec.rb spec/jobs/ffd_user_issue_job_spec.rb spec/requests/api/v1/issue_reports_spec.rb
git diff origin/development --stat -- api/app/services/issue_reporter.rb
```
Expected: `0 failures`; `no offenses detected`; o último comando sem saída.

- [ ] **Step 2: Changelog e racional.** A linha do changelog fica `| 18/10/2026 | **Reportar: o relato não se perde quando o Linear está fora.** … |`, em linguagem de usuário. O racional em `agents/prompts/ffd-user-issues-2026-10-18.md` tem até 20 linhas: pedido, link para a spec do jur, as decisões (retry/descarte, 200 "Recebido", envs nas duas taskdefs) e o que fica pendente (QA em HML depois do deploy).

- [ ] **Step 3: Commit e push**

```bash
git add frontend/static/changelog.md agents/prompts/ffd-user-issues-2026-10-18.md
git commit -m "docs(issue-reporter): changelog e racional do envio ao FFD"
git push -u origin feat/ffd-user-issues
```

- [ ] **Step 4: Abrir o PR** com `gh pr create --base development --head feat/ffd-user-issues --title "feat(issue-reporter): relatos do widget também no FFD (user-issues)" --body-file <scratchpad>/pr-body.md`. O corpo leva: resumo, o contrato do payload, o comportamento 200/502, os testes rodados e o bloco de ops abaixo, sem mudar nada. Termina com a linha de atribuição `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

````markdown
## Ops — para quem fizer o deploy (nada disso foi executado)

Pré-requisito: entrega 1 do Kaizen no ar no FFD (source `user-issues` em `app/api/webhooks/[source]/route.ts`).
Sem ela o FFD responde 4xx, o job descarta e vai ao Sentry. Nada quebra, mas o relato não chega.

1. **FFD — endpoint key**: em FFD → Configurações → Keys de endpoint, criar a key `procstudio-issues`
   com sources `user-issues` (só esse). Copiar o token exibido uma vez.
2. **SSM** (repetir com `/DEV/...` para HML se quiser em homologação):
   ```bash
   aws ssm put-parameter --region us-east-1 --type String \
     --name /PROD/PROCSTUDIO/API/ENV/FFD_USER_ISSUES_URL \
     --value https://ffd.belzinhos.com.br/api/webhooks/user-issues
   aws ssm put-parameter --region us-east-1 --type SecureString \
     --name /PROD/PROCSTUDIO/API/ENV/FFD_USER_ISSUES_TOKEN --value '<token da key procstudio-issues>'
   ```
3. **Taskdefs de api E sidekiq** — o SSM não entra sozinho: o pipeline clona a revisão ativa e só troca a imagem.
   Partir sempre da revisão ATIVA (nunca de template — CLAUDE-DOCKER-AWS.md):
   ```bash
   reg() { # $1=família  $2=container  $3=cluster  $4=service  $5=PROD|DEV
     aws ecs describe-task-definition --region us-east-1 --task-definition "$1" --query taskDefinition > td.json
     jq --arg c "$2" --arg p "/$5/PROCSTUDIO/API/ENV" '
       .containerDefinitions |= map(if .name == $c then .secrets += [
         {name:"FFD_USER_ISSUES_URL",   valueFrom:($p+"/FFD_USER_ISSUES_URL")},
         {name:"FFD_USER_ISSUES_TOKEN", valueFrom:($p+"/FFD_USER_ISSUES_TOKEN")}] else . end)
       | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy)' \
       td.json > td-new.json
     rev=$(aws ecs register-task-definition --region us-east-1 --cli-input-json file://td-new.json \
           --query taskDefinition.revision --output text)
     aws ecs update-service --region us-east-1 --cluster "$3" --service "$4" --task-definition "$1:$rev"
   }
   reg prod-procstudio-api-task     api-prod prod-procstudio prod-procstudio-api-service     PROD
   reg prod-procstudio-sidekiq-task sidekiq  prod-procstudio prod-procstudio-sidekiq-service PROD
   # HML: reg dev-procstudio-api-task api-hml dev-procstudio dev-procstudio-api-service DEV
   #      reg dev-procstudio-sidekiq-task sidekiq dev-procstudio dev-procstudio-sidekiq-service DEV
   ```
   Conferir na revisão nova que `SECRET_KEY_BASE`, memória e `taskRoleArn` continuam lá. Conferir também que a
   execution role lê `/PROD/PROCSTUDIO/API/ENV/*` (as outras envs do mesmo caminho já são lidas assim).
   A ordem em relação ao merge não importa: o código antigo ignora as duas envs.
4. **Validação**: relatar pelo widget (Alt+I) em HML/prod. Esperado: card no Linear + linha
   `ProcStudio | <título>` no bloco User Issues do FFD. Sem a linha: `FfdUserIssueJob` na aba Retries do
   Sidekiq (5xx/rede) ou evento `feature:ffd_user_issue` no Sentry (4xx: key/escopo errados).
````

- [ ] **Step 5: Encerrar sem deploy.** Comentar no PR que o QA de HML (`agents/QA_Agent.md`) fica pendente até alguém executar o bloco de ops e fazer o deploy. Ficar na branch, conforme `CLAUDE-GIT.md`.

---

## Self-Review

1. **Cobertura da spec:** seção 8 (cola só, núcleo intocado → Task 4 Step 1 confere; job Sidekiq → Task 2; POST `user-issues` com servico/título/descrição/usuário/time/plano/rota/card → Task 3 payload; retry padrão → Task 2; envs e "sem eles não envia" → Tasks 1–2; "Recebido" em vez de 502 → Task 3; taskdef → bloco de ops). Seção 6, contrato → Global Constraints e Task 3. Decisão 5 (branch de `development`, api e sidekiq) → Task 1 Step 1 e ops passo 3. Endpoint key `procstudio-issues: user-issues` → ops passo 1.
2. **Varredura de passos:** cada passo de código tem assinatura e valores, e cada teste tem asserções concretas. Os corpos ficam com o implementador.
3. **Tipos:** `ffd_user_issues_enabled?`/`_url`/`_token`, `FFD_USER_ISSUES_MAX_DESCRICAO`, `FfdUserIssueJob::RequestFailed`/`RequestRejected` e `enqueue_ffd_user_issue(linear)` usam os mesmos nomes nas Tasks 1–3. O payload usa chaves string em todo lugar.
4. **Review Focus:** os cinco itens têm teste na Task 2 ou na Task 3.
5. **Proporção:** quatro tarefas para uma mudança de cola, e os blocos de código são quase só testes e o bloco de ops que vai literal no PR.

### Pontos em que este plano diverge da spec ou a delimita

- **Branch:** o `CLAUDE-GIT.md` do repo pede o prefixo `brpl/`. Foi usado `feat/ffd-user-issues`, como pedido.
- **"Retry padrão do Sidekiq":** mantido para 408/429/5xx/rede. Os demais 4xx são descartados com Sentry, como no `FfdBotAlertJob`. Uma key errada não fica 21 dias na fila de retry.
- **"O usuário vê erro só se os dois falharem"** vale só no `create`. Se o `/meta` falhar (Linear fora antes de abrir o widget, com o cache de falha do núcleo), o widget fica `enabled:false` e nem abre. Com o Linear sem configuração, o `submit` levanta `SubmissionError` 503 antes de qualquer envio. As duas coisas estão no núcleo, que não pode mudar.
- **"Recebido"** depende de o ProcStudio montar o widget com `showIssueLink:false`, o que já acontece hoje. A API responde `{ok:true, identifier:nil, url:nil}`.
- **PII:** `autor_email` e o `contexto` (e-mail, OAB) ficam nos argumentos do job, no Redis, e vão ao FFD, como o contrato pede. O Sentry recebe só serviço e título.
