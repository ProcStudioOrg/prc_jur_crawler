# JurCrawler + ProcStudio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Native execution selected under the main repository instruction to choose the execution method; invoke its required QA agent after implementation.

**Goal:** Entrar no JurCrawler com ProcStudio, manter dados e chaves privados por usuário, escolher provedor/modelo e usar a identidade visual ProcStudio.

**Architecture:** Rails autoriza uma delegação exclusiva ao crawler, que mantém uma sessão opaca no navegador e confirma sua identidade no Rails. SQLite armazena recursos com proprietário e credenciais cifradas; adaptadores de LLM preservam ferramentas e streaming. SvelteKit participa somente do SSO; a interface do crawler permanece no seu repositório.

**Tech Stack:** Rails 8 / PostgreSQL / RSpec; SvelteKit / TypeScript / Vitest; Node >=22 / SQLite / node:test / Playwright; Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-19-procstudio-llm-design.md`, aprovada na conversa em 2026-09-19.

## Global Constraints

- Não haverá migração, compatibilidade com o armazenamento anterior ou preservação dos dados do crawler.
- Essa autorização não se aplica aos usuários, equipes ou dados do ProcStudio.
- Não compartilhar secret_key_base. Identidade confirmada no Rails; nenhum user_id/team_id do browser concede acesso.
- Não há compartilhamento implícito por equipe nem chave global de LLM.
- Chaves persistidas cifradas com AES-256-GCM e chave de criptografia exclusiva do ambiente.
- Não usar docker compose down -v. Reset somente no deploy do crawler novo, delimitado ao serviço.
- Cores #0277EE, #01013D, #FEFEFA, #F0F4F3 e #373F45; cânone visual do frontend ProcStudio.
- Segredos fora de logs, URLs, histórico, SSE e erros. Exceção de protocolo: código temporário no callback, sem logging e removido por redirect imediato.
- Nenhuma alteração no checkout principal em uso: branch/checkout isolado e remoto para mudanças do ProcStudio.
- Sem deploy do principal fora de seu processo de revisão/merge; preparar mudanças e configurações revisáveis.

## Review Focus

1. Usuários da mesma equipe também são isolados: testar IDs de conversa/job/chave/SSE cruzados na tarefa 3.
2. Duas trocas simultâneas do mesmo código: somente uma pode emitir sessão, tarefa 1.
3. Logout/troca de conta com chat aberto: limpar memória e interromper acesso ao stream antigo, tarefas 2/6.
4. Histórico com tool calls trocando entre Anthropic e OpenRouter: preservar IDs/resultados sem novo crawl, tarefa 5.
5. Endpoint aparentemente público que resolve para endereço privado ou redireciona: recusar antes de transmitir segredo, tarefa 4.

## Contratos comuns

```ts
type Principal = { issuer: string; userId: string; teamId: string; expiresAt: number };
type Owner = Pick<Principal, 'issuer' | 'userId' | 'teamId'>;
type Connection = { id: string; provider: string; name: string;
  model: string; endpoint?: string; maskedKey: string };
type Model = { id: string; name: string; tools: boolean | null;
  reasoning: boolean | null };
type Block = { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Message = { role: 'user' | 'assistant'; content: Block[] };
```

Owner é serializado como JSON do trio ordenado e transformado em hash para paths;
não concatenar valores livres com separadores. Os blocos são representação interna,
sem campos exclusivos como assinaturas de raciocínio de um provedor.

## Task 1: Delegação de acesso no Rails

**Files — ProcStudio:** Create `api/app/models/service_authorization_code.rb`,
`api/app/models/service_session.rb`, `api/app/services/service_access/issuer.rb`,
`api/app/controllers/api/v1/service_access_controller.rb`,
`api/config/initializers/service_access.rb`,
`api/spec/requests/api/v1/service_access_spec.rb`; add a timestamped migration
creating both tables; modify `api/config/routes.rb`,
`api/config/initializers/filter_parameter_logging.rb`, `api/db/schema.rb` only with
that migration. Record rationale in `agents/prompts/jurcrawler-sso.md`.

**Consumes:** existing JwtAuth, User and TeamScoped.
**Produces:** endpoints below, all responses `Cache-Control: no-store`.

- `POST /api/v1/service_access/authorize`: JWT; JSON client_id, redirect_uri,
  code_challenge, code_challenge_method=S256. Return `{code, expires_in:60}`.
- `POST /api/v1/service_access/exchange`: service credential; JSON code,
  redirect_uri, code_verifier. Return `{session_token, principal}`.
- `POST /api/v1/service_access/introspect`: service credential and session_token;
  return `{active:true, principal}` or `{active:false}`.
- `POST /api/v1/service_access/revoke`: service credential and session_token;
  idempotent 204.
- `POST /api/v1/service_access/subject`: service credential and user_id/team_id;
  return `{active:true}` only for active user still belonging to that team. This
  endpoint does not authorize operations; crawler uses it after authenticating a
  personal API key and matching its stored owner. Bind issuer/client to config.

- [ ] Confirm Docker running; create an isolated branch based on origin/development
  using the worktree skill; push the branch. Preserve the existing checkout.
- [ ] Add failing request tests with ordinary RSpec factories and existing auth
  helpers. Write the concurrency example against the database, not a mocked lock.

```ruby
it 'rejects the second exchange of a consumed code' do
  code = issue_code_for(user, challenge: pkce_challenge)
  exchange(code, verifier: pkce_verifier)
  expect(response).to have_http_status(:ok)
  exchange(code, verifier: pkce_verifier)
  expect(response).to have_http_status(:unauthorized)
end
```

Define issue_code_for/exchange in that spec using the HTTP endpoints above. Cover
invalid service credential, missing config, deleted user, changed team, expired
JWT/code/session, wrong challenge, duplicate concurrent exchange and redirect_uri
not exactly in the client registry. No wildcard callbacks or caller-defined issuer.

- [ ] Run `bundle exec rspec spec/requests/api/v1/service_access_spec.rb` inside
  the existing API development container; expect missing route failures initially.
- [ ] Implement code/session tables with user/team references, client_id, unique
  token_digest, expires_at, consumed_at/revoked_at and original authentication
  expiry. Generate random 32-byte tokens; SHA256 digests only in Rails storage.

```ruby
record.with_lock do
  raise InvalidGrant if record.consumed_at || record.expires_at <= Time.current
  raise InvalidGrant unless valid_pkce?(record, verifier)
  record.update!(consumed_at: Time.current)
  issue_session!(record)
end
```

Use the lock/transaction for this live authentication operation, not a backfill.
Authorize inherits existing authenticated controller; exchange/introspection use
dedicated service auth without invoking JWT user auth. Constant-time comparison
of service credential digests. Missing secrets disable service access, never open it.
Expiry equals the earlier of JWT expiry and 24 hours. Filter code, code_verifier,
session_token and Authorization in app/proxy logs. Reject malformed/oversized input.

- [ ] Run the request specs and scoped RuboCop; document endpoints in Bruno and
  `docs/jurcrawler-sso.md`, add env variable names without values; commit with
  `feat: autoriza sessões delegadas para o JurCrawler`.

## Task 2: Navegação SSO e sessão do crawler

**Files — ProcStudio:** Create `frontend/src/routes/_auth/jurcrawler/+server.ts`
and colocated test; review `frontend/src/lib/utils/postLoginRedirect.ts` and
`frontend/src/hooks.server.ts` for access to this route. Reuse `_auth/login`.
**Files — crawler:** Create `jur/servidor/procstudio.js`,
`jur/servidor/sessoes-web.js`, `jur/servidor/rotas/auth.js`,
`jur/tests/procstudio-auth.test.js`; modify `http.js`, `autenticacao.js`,
`index.js`, `db.js` under `jur/servidor/`.

**Consumes:** Task 1 endpoints.
**Produces:** `GET /auth/login`, `GET /auth/callback`, `GET /api/v1/me`,
`POST /auth/logout`; async guard populates `req.principal` after Rails validation.
`procstudio.introspect(sessionToken)` returns Principal or null and distinguishes
401 from upstream unavailability (503). Network timeout: five seconds.

- [ ] Write tests using a local fake Rails server and browser cookie jar: successful
  redirect, wrong state, missing cookie, expired attempt, wrong verifier, replay,
  failed introspection, cross-origin logout and switching users.

```js
assert.equal((await client.get('/api/v1/me')).status, 401);
await client.loginAs('alice'); // fixture drives login/callback against fake Rails
assert.equal((await client.get('/api/v1/me')).body.userId, 'alice');
fakeRails.expire('alice');
assert.equal((await client.get('/api/v1/me')).status, 401);
```

- [ ] Run `node --test tests/procstudio-auth.test.js` from jur; expect 404 before
  implementing routes. Helpers in this test instantiate criarApp and the fake
  Rails endpoint; they never bypass the production guard.
- [ ] Implement attempt storage with five-minute expiry and single use. SvelteKit
  accepts only configured client/callback, forwards its HttpOnly JWT to Rails and
  uses the existing safe login redirect helper when unauthenticated. Never forward
  JWT into callback query. Redirect auth failures to a generic local error state.
- [ ] Implement hashed local session identifiers; delegated token encrypted via
  the vault primitive defined in task 4 (implement primitive here for session use,
  then task 4 adds credential storage). Await async guard in the HTTP router.
  Cookies are host-only HttpOnly, SameSite=Lax, Secure in HTTPS; set Path=/.
  Validate Origin for cookie-authenticated mutations and reject missing Origin
  except authenticated Bearer clients. Do not allow both mechanisms ambiguously.
- [ ] Run Node tests plus Vitest for the SvelteKit route. Verify the generic error
  path does not log a URL containing code. Commit in each owning repository.

## Task 3: Isolamento do banco, jobs, ferramentas e integrações

**Files — crawler:** Modify `servidor/db.js`, `conversas.js`, `jobs.js`,
`chaves.js`, `turnos.js`, `executor.js`, `ferramentas.js`, `mcp.js`,
`rotas/conversas.js`, `rotas/buscas.js`, `rotas/chat.js`, `rotas/chaves.js`;
create `servidor/escopo.js`, `tests/isolamento.test.js` and update existing tests
to create principals explicitly.

**Consumes:** req.principal and Rails subject validation.
**Produces:** `escopo.criar(deps, principal)` returns scoped conversas/fila/chaves/
turnos wrappers with the existing public method names. Unscoped worker methods
remain private to the scheduler. Routes and tools receive only scoped wrappers.

- [ ] Add adversarial tests with A/B same team and C another team.

```js
const conversa = a.conversas.criar();
assert.equal(b.conversas.obter(conversa.id), null);
assert.equal(c.conversas.apagar(conversa.id), false);
assert.equal(a.conversas.obter(conversa.id).id, conversa.id);
assert.deepEqual(b.conversas.listar(), []);
```

Define a/b/c by escopo.criar with the same database and distinct Principal fixtures.
Expand HTTP cases to messages, SSE reconnect, files/results, cancel, MCP tool read,
API-key list/revoke, injected foreign conversationId and tool-result jobId.

- [ ] Run `node --test tests/isolamento.test.js`, record initial failures.
- [ ] Replace crawler schema for new databases: NOT NULL owner identity on root
  resources, composite keys/joins constraining child reads and writes. Fail with
  explicit reset-required error on old schema; never reset automatically at boot.
  Each job captures owner, including work that survives client disconnection.
  Results and browser/session dirs use owner-hash/job-id paths; no global portal
  cookie file. Keep public CLI behavior separate from authenticated HTTP execution.
- [ ] Apply scope before every repository read/write and filesystem access.
  Key listing returns no other owner's prefixes. API keys are not global admin
  keys and cannot manage another user's credentials. Expired sessions close SSE;
  revalidation at 30-second intervals closes streams on revoked/invalid identity.
  Abort future LLM/tool work when identity becomes invalid. Late worker completion
  may write only into the original owner's job.
- [ ] Run isolation and existing job/conversation/tool/MCP suites; update HTTP
  docs and commit `feat: isola recursos do crawler por usuário ProcStudio`.

## Task 4: Cofre de credenciais e endpoints seguros

**Files — crawler:** Create `servidor/cofre.js`, `servidor/conexoes-llm.js`,
`servidor/destinos-llm.js`, `servidor/rotas/conexoes-llm.js`,
`tests/cofre.test.js`, `tests/conexoes-llm.test.js`, `tests/destinos-llm.test.js`;
modify db/index/openapi and infra/compose.yml. The cofre primitive is needed in
task 2; build/test it there, retaining task 4 ownership of its credential usage.

**Consumes:** scoped Principal; `JUR_ENCRYPTION_KEY` (32-byte base64 secret).
**Produces:** `cofre.cifrar(texto,aad)` / `decifrar(envelope,aad)`;
`GET/POST /api/v1/conexoes-llm`, `PATCH/DELETE /api/v1/conexoes-llm/:id`,
`POST /api/v1/conexoes-llm/:id/validar`,
`GET /api/v1/conexoes-llm/:id/modelos`. Response connection metadata excludes key.

- [ ] Add failing crypto/ownership tests.

```js
const envelope = vault.cifrar('fixture-secret', 'alice:connection:provider');
assert.equal(vault.decifrar(envelope, 'alice:connection:provider'), 'fixture-secret');
assert.throws(() => vault.decifrar(envelope, 'bob:connection:provider'));
assert.ok(!JSON.stringify(envelope).includes('fixture-secret'));
```

- [ ] Implement AES-GCM 12-byte random nonce, 16-byte auth tag, explicit version
  in envelope and owner/provider/id AAD. Fail startup if secret absent/invalid
  where authenticated service enabled. Never serialize decrypted values.
- [ ] Implement CRUD, masked suffix only, max key length 16 KiB, names 80 chars,
  provider enum and model length 256. Validating and listing models operate only on
  the owner's connection. Validate removal/replacement with in-flight request:
  an already dispatched request may finish; no subsequent call uses removed key.
- [ ] Implement endpoint guard: https, no URL credentials/fragments, reject all
  non-public IPv4/IPv6 incl mapped addresses. Resolve before each connection and
  pin approved address to the socket while preserving hostname TLS verification;
  disable redirects. Test private DNS, rebinding, IPv6 and public-to-private redirect.
  Built-in provider URLs are code-controlled; user input cannot override them.
- [ ] Run all three test files; check errors redact mock secrets; commit.

## Task 5: Adaptadores de LLM e catálogo

**Files — crawler:** Create `servidor/provedores/anthropic.js`, `openai.js`,
`gemini.js`, `catalogo.js`, `historico.js` in that directory;
modify `servidor/llm.js`, `validacao.js`, `rotas/chat.js` and `openapi.js`;
create `tests/provedores.test.js` and `tests/historico-provedores.test.js`.

**Consumes:** connectionId from browser, owner-scoped resolved credentials;
Message[] from common contracts. Never trust browser-supplied credentials/endpoint.
**Produces:** adapter `stream({messages,system,tools,model,reasoning,signal,onText})`
returning `{content:Block[], stopReason:'end'|'tools'|'limit'}`;
`models({signal})` returning Model[]. Factory maps OpenRouter and custom-compatible
providers to the OpenAI protocol adapter with separate approved endpoint config.

- [ ] Read official docs for Anthropic Messages/tools, OpenAI Chat Completions,
  Gemini generateContent streaming/functions and OpenRouter models/chat. Record
  tested API endpoints/versions in `docs/provedores-llm.md`. Use existing Anthropic
  SDK; add dependencies only where required by safe networking/protocol support.
- [ ] Add fake-server streams containing split SSE frames, parallel tool calls,
  fragmented JSON args, usage-only chunks, provider error and premature EOF.

```js
const result = await adapter.stream(inputWithFixtureTransport);
assert.deepEqual(result.content.filter(b => b.type === 'tool_use'), [
  { type: 'tool_use', id: 'call-1', name: 'listar_tribunais', input: {} }
]);
assert.equal(result.stopReason, 'tools');
```

inputWithFixtureTransport supplies messages/system/tools/model/signal/onText and
an injected transport fixture through adapter construction. Assert no API key in
public errors. Exercise model listing unauthorized, rate limit and unavailable.

- [ ] Implement per-protocol conversion preserving call IDs and exact tool results.
  Validate tool arguments before execution; reject unknown tools. Convert Gemini
  role/parts and OpenAI tool messages into the internal blocks. Preserve max 12
  iterations, abort signals and terminal history. Unknown capabilities are null,
  not falsely advertised as supported; show explicit incompatibility on rejection.
- [ ] Replace hardcoded model validation with connection/model validation. Reasoning
  fields sent only by capable adapter/model. On provider change, translate canonical
  history without retaining provider-private signed thinking blocks. Include a test
  where existing job results answer the next turn without a second search call.
- [ ] Run provider/history/LLM/chat suites; document mocked vs real integration
  coverage; commit `feat: adiciona provedores e catálogo de modelos ao chat`.

## Task 6: Interface ProcStudio e configuração em etapas

**Files — crawler:** Modify `publico/index.html`, `estilo.css`, `app.js`,
`config.js`; create `publico/sessao.js`, `publico/conexoes.js`,
`publico/seletor-modelo.js`; update browser tests and add
`tests/browser/provedores.test.js`, `tests/browser/sessao.test.js`.

**Consumes:** me/auth endpoints and Connection/Model APIs.
**Produces:** login screen, authenticated application and private settings; no
localStorage secrets. Existing chat/API helpers use same-origin session cookies.

- [ ] Load impeccable craft-floor immediately before UI edits. Run local server;
  use existing screenshots plus ProcStudio DESIGN.md as visual authority.
- [ ] Browser test drives login A, saves a fixture OpenRouter connection, searches
  model, selects it, sends question, logs out and logs in B.

```js
await page.getByRole('button', { name: 'Configurações' }).click();
await page.getByRole('tab', { name: 'IA', exact: true }).click();
await page.getByLabel('Provedor', { exact: true }).selectOption('openrouter');
await page.getByLabel('Chave de API', { exact: true }).fill('fixture-secret');
await page.getByRole('button', { name: 'Salvar e continuar' }).click();
await expect(page.getByLabel('Buscar modelo')).toBeVisible();
```

Use selectOption only if the provider field is native; if custom, exercise its
combobox/listbox roles. Model picker must be searchable and keyboard-accessible.
Verify B never sees A's connection or previous rendered conversation.

- [ ] Implement three steps with explicit loading/error/success states. Secret
  field never repopulated from saved value. Editing a connection does not save on
  blur. Show mask and replace/remove controls. Provider changes clear incompatible
  model selection. Don't keep credential-bearing objects in global UI state.
- [ ] Apply ProcStudio tokens across sidebar/chat/settings. Use current app system
  font for consistency, document canonical Inter discrepancy without altering the
  main app. Settings tabs IA/Integrações; fixed heading/close, single scroll body,
  scrollbar inset from rounded shell; focus trap/restore, Esc and touch sizing.
- [ ] Remove legacy localStorage keys; clear rendered history/caches on logout or
  identity change; fetch preferences from scoped API. Send connectionId/model to
  chat; show reasoning controls only for known capability.
- [ ] Run browser suites. Inspect desktop/mobile together, fix the collected
  defects in one batch, confirm once. Run impeccable detector once for changed UI
  files. Commit `feat: aplica identidade ProcStudio e configuração de IA`.

## Task 7: Integração, documentação e entrega

**Files:** crawler `infra/README.md`, `infra/compose.yml`, `CLAUDE.md`,
`jur/servidor/openapi.js`, `docs/provedores-llm.md`, `docs/procstudio-sso.md`;
ProcStudio `docs/jurcrawler-sso.md`, Bruno requests,
`frontend/static/changelog.md`, `agents/prompts/jurcrawler-sso.md` and
`agents/QA/reports/`.

**Consumes:** tasks 1–6.
**Produces:** tested commits/PR in ProcStudio and tested crawler release candidate;
separate Local/HML evidence and concrete deployment configuration.

- [ ] Document env names: ProcStudio service client ID, exact callbacks and secret;
  crawler Rails internal URL, ProcStudio frontend URL, public callback origin,
  service client ID/secret and JUR_ENCRYPTION_KEY. Generate secrets via secure
  deployment mechanism, never print or commit values. Missing config fails closed.
- [ ] Run crawler gates: `npm test`, `npm run test:browser`,
  `npm run aceite -- TJSC --rapido`. Run relevant Rails RSpec/RuboCop and frontend
  Vitest/lint/check per repository scripts. No live provider claims from mocks.
- [ ] Invoke QA_Agent.md with both diffs, modules, target environments and tested
  revisions. No new Linear card required for direct user request; use CLI if any
  existing card must be updated, per user's global instruction.
- [ ] Review two-user HML login and isolation, provider connection/model selection,
  actual search, logout/expiration, network failure and SSE reconnection. If HML
  deployment or provider test credentials are unavailable, mark BLOCKED with exact
  missing dependency and preserve the ready-to-deploy candidate.
- [ ] ProcStudio: open PR from isolated work branch; follow its merger process.
  Crawler: commit/push verified changes using its main policy. Do not expose new
  crawler requiring SSO before the Rails endpoints/config are live.
- [ ] At approved release deployment, stop crawler workload, reset only its old
  database/results/session cache as user authorized, start fresh schema, switch
  immutable release, check HTTPS health/login and anonymous denial. Do not erase
  users or other service volumes. Report exact releases and checks performed.

## Self-review

Spec coverage maps authentication to tasks 1–2, owner scoping to 3, credential
storage/network restrictions to 4, provider support to 5, interface to 6 and
verification/deployment to 7. Crypto primitive is explicitly pulled into task 2
to avoid a forward implementation dependency. All changes remain within the
two repositories; deployment and external provider evidence are reported separately.
