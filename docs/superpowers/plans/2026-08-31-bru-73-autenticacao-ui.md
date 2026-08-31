# BRU-73: autenticação obrigatória da UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover a confiança em `Sec-Fetch-Site` e fazer a interface enviar uma chave de conexão Bearer para toda rota protegida.

**Architecture:** Arquivos estáticos, documentação e saúde continuam públicos. O guarda exige Bearer em toda outra rota de API e no MCP; a UI centraliza os `fetch` em `window.jurApi.requisitar`, lê uma chave separada do `localStorage` e mostra um estado bloqueado quando ela falta ou é recusada.

**Tech Stack:** Node.js 22, `node:test`, SQLite, JavaScript no browser, Playwright/Chromium.

**Spec:** `docs/superpowers/specs/2026-08-31-autenticacao-e-publicacao-jurcrawler-design.md`

## Global Constraints

- Produção mantém `JUR_EXIGIR_CHAVE=1` e o bind Docker em `127.0.0.1:3000`.
- `Sec-Fetch-Site`, `Origin` e `Host` nunca autenticam um cliente.
- `Origin` hostil continua bloqueado como defesa adicional.
- Chave de conexão e chave Anthropic permanecem separadas.
- Nenhum segredo entra em Git, logs, aliases ou fixtures.
- Não instalar dependência nova.
- Não incluir no commit alterações preexistentes do worktree.

---

### Task 1: Fechar a fronteira de autenticação no servidor

**Files:**
- Modify: `jur/servidor/autenticacao.js:1-84`
- Test: `jur/tests/autenticacao.test.js:30-110`

**Interfaces:**
- Consumes: `bloquearOrigemHostil(req, res)` e `chaves.verificar(valor)`.
- Produces: `ehRotaProtegida(caminho): boolean`, `PUBLICOS: Set<string>` e `criarGuarda(opcoes)`.

- [ ] **Step 1: Mover BRU-73 para InProgress**

```bash
linear whoami
linear move BRU-73 InProgress
```

Expected: `linear show BRU-73` apresenta `[InProgress]`.

- [ ] **Step 2: Substituir os testes que legitimavam o bypass**

Em `jur/tests/autenticacao.test.js`, manter os testes de Bearer e adicionar:

```js
it('mantem interface, docs, OpenAPI e saude publicos', async () => {
  for (const caminho of ['/', '/docs', '/api/v1/openapi.json', '/api/v1/saude']) {
    const r = await fetch(base + caminho);
    assert.strictEqual(r.status, 200, caminho);
  }
});

it('Sec-Fetch-Site forjado nunca substitui Bearer', async () => {
  for (const valor of ['same-origin', 'none', 'same-site', 'cross-site']) {
    const r = await fetch(`${base}/api/v1/chaves`, {
      headers: { 'sec-fetch-site': valor },
    });
    assert.strictEqual(r.status, 401, valor);
  }
});

it('Bearer valido continua aceito com qualquer Sec-Fetch-Site', async () => {
  const r = await fetch(`${base}/api/v1/chaves`, {
    headers: {
      authorization: `Bearer ${chaveValida}`,
      'sec-fetch-site': 'cross-site',
    },
  });
  assert.strictEqual(r.status, 200);
});
```

Preservar o teste que envia `Origin: https://evil.example` e espera `403`.

- [ ] **Step 3: Executar a regressão e provar o estado vermelho**

Run: `cd jur && node --test tests/autenticacao.test.js`

Expected: FAIL porque `same-origin` ainda recebe `200` e `/` recebe `401`.

- [ ] **Step 4: Implementar a política por caminho**

Substituir as funções `ehProprioFrontend`/`ehOutroSite` e a lista atual por:

```js
const PUBLICOS = new Set([
  '/api/v1/saude',
  '/api/v1/openapi.json',
  '/docs',
]);

function ehRotaProtegida(caminho) {
  if (PUBLICOS.has(caminho)) return false;
  return caminho === '/mcp' || caminho.startsWith('/api/v1/');
}
```

O guarda deve seguir esta ordem:

```js
return function guarda(req, res, caminho) {
  if (bloquearOrigemHostil(req, res)) return true;
  if (!exigir || !gerenciador || !ehRotaProtegida(caminho)) return false;

  const cabecalho = req.headers.authorization || '';
  const valor = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
  if (gerenciador.verificar(valor)) return false;

  json(res, 401, {
    erro: 'chave de conexao ausente ou invalida — salve uma chave valida em Configuracoes',
  });
  return true;
};
```

Exportar somente `{ criarGuarda, ehRotaProtegida, PUBLICOS }`.

- [ ] **Step 5: Executar os testes do guarda**

Run: `cd jur && node --test tests/autenticacao.test.js tests/http.test.js`

Expected: PASS, com cabeçalho forjado em `401`, Bearer válido em `200` e origem hostil em `403`.

- [ ] **Step 6: Commitar somente o servidor e sua regressão**

```bash
git add jur/servidor/autenticacao.js jur/tests/autenticacao.test.js
git diff --cached --check
git commit -m "fix: exige Bearer nas rotas protegidas"
```

---

### Task 2: Centralizar Bearer no cliente da interface

**Files:**
- Modify: `jur/publico/app.js:1-27,278-288,435-446,522-524`
- Modify: `jur/publico/index.html:30-51`
- Modify: `jur/publico/estilo.css`
- Test: `jur/tests/browser/interface-real.test.js`

**Interfaces:**
- Consumes: `localStorage`, `fetch`, `CustomEvent` e a política criada na Task 1.
- Produces: `window.jurApi.chaveConexao()`, `chaveLlm()`, `salvarChaveConexao(valor)`, `requisitar(caminho, opcoes)` e `pedir(caminho, opcoes)`.

- [ ] **Step 1: Reescrever o teste de Chromium**

No `before`, guardar `chaveValida = g.gerar('interface real').valor`. Adicionar:

```js
it('carrega a pagina, mas a API recusa o browser sem chave', async () => {
  const page = await browser.newPage();
  try {
    assert.strictEqual((await page.goto(base + '/')).status(), 200);
    const status = await page.evaluate(() => fetch('/api/v1/tribunais').then((r) => r.status));
    assert.strictEqual(status, 401);
    assert.strictEqual(await page.isVisible('#estado-conexao'), true);
  } finally { await page.close(); }
});

it('a UI salva Bearer e volta a acessar a API', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript((valor) => {
      localStorage.setItem('jur.chaveConexao', valor);
    }, chaveValida);
    await page.goto(base + '/');
    const resultado = await page.evaluate(() => window.jurApi.pedir('/api/v1/tribunais'));
    assert.ok(resultado.tribunais.length > 0);
    assert.strictEqual(await page.isHidden('#estado-conexao'), true);
  } finally { await page.close(); }
});
```

Manter um `curl` real com `Sec-Fetch-Site: same-origin` esperando `401`.

- [ ] **Step 2: Rodar o teste e observar a falha**

Run: `cd jur && node --test tests/browser/interface-real.test.js`

Expected: FAIL porque a chave, o banner e o Bearer central ainda não existem.

- [ ] **Step 3: Criar o cliente HTTP autenticado**

Em `app.js`, adicionar `const CHAVE_CONEXAO = 'jur.chaveConexao';` e substituir `window.jurApi` por:

```js
window.jurApi = {
  chaveLlm: () => guardado.ler(CHAVE_LLM).trim(),
  chaveConexao: () => guardado.ler(CHAVE_CONEXAO).trim(),
  salvarChaveConexao(valor) {
    guardado.escrever(CHAVE_CONEXAO, String(valor || '').trim());
    document.dispatchEvent(new CustomEvent('jur:chave-conexao-alterada'));
  },
  async requisitar(caminho, opcoes = {}) {
    const headers = new Headers(opcoes.headers || {});
    if (opcoes.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const chave = window.jurApi.chaveConexao();
    if (chave) headers.set('authorization', `Bearer ${chave}`);
    const resposta = await fetch(caminho, { ...opcoes, headers });
    if (resposta.status === 401) {
      document.dispatchEvent(new CustomEvent('jur:autenticacao-negada'));
    }
    return resposta;
  },
  async pedir(caminho, opcoes = {}) {
    const r = await window.jurApi.requisitar(caminho, opcoes);
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      const erro = new Error(corpo.erro || `HTTP ${r.status}`);
      erro.status = r.status;
      throw erro;
    }
    return r.status === 204 ? null : r.json();
  },
};
```

Trocar os dois `fetch` diretos de chat/stream por `window.jurApi.requisitar`. No chat, usar `window.jurApi.chaveLlm()` somente para `x-api-key`.

- [ ] **Step 4: Adicionar o estado bloqueado**

Dentro de `<main id="centro">`, antes de `#inicial`:

```html
<section id="estado-conexao" class="estado-conexao" role="status" hidden>
  <strong>Conecte esta instalação</strong>
  <span>Cole uma chave de conexão para acessar conversas, buscas e chat.</span>
  <button id="configurar-conexao" type="button">Abrir Configurações</button>
</section>
```

Em `app.js`:

```js
function sincronizarEstadoConexao() {
  $('#estado-conexao').hidden = Boolean(window.jurApi.chaveConexao());
}

$('#configurar-conexao').addEventListener('click', () => $('#abrir-config').click());
document.addEventListener('jur:chave-conexao-alterada', sincronizarEstadoConexao);
document.addEventListener('jur:autenticacao-negada', () => { $('#estado-conexao').hidden = false; });
```

Chamar `sincronizarEstadoConexao()` ao final e, no início de `enviar`, abrir Configurações e retornar quando a chave estiver vazia. Estilizar `.estado-conexao` com a largura e borda de `.caixa-entrada`.

- [ ] **Step 5: Executar o teste focado**

Run: `cd jur && node --test tests/browser/interface-real.test.js`

Expected: PASS para página pública, API sem chave, header forjado e UI autenticada.

- [ ] **Step 6: Commitar cliente, estado e teste**

```bash
git add jur/publico/app.js jur/publico/index.html jur/publico/estilo.css jur/tests/browser/interface-real.test.js
git diff --cached --check
git commit -m "feat: autentica a interface com chave de conexão"
```

---

### Task 3: Cadastrar e validar a chave de conexão

**Files:**
- Modify: `jur/publico/config.js:1-238`
- Modify: `jur/tests/browser/config-chave.test.js`

**Interfaces:**
- Consumes: `window.jurApi.salvarChaveConexao`, `pedir` e `chaveConexao`.
- Produces: `#form-chave-conexao`, `#chave-conexao` e `#status-chave-conexao`.

- [ ] **Step 1: Escrever testes de salvar, validar e remover**

O caso válido deve executar:

```js
await page.fill('#chave-conexao', chaveConexaoValida);
await Promise.all([
  page.waitForNavigation(),
  page.click('#salvar-chave-conexao'),
]);
assert.strictEqual(
  await page.evaluate(() => localStorage.getItem('jur.chaveConexao')),
  chaveConexaoValida,
);
assert.strictEqual(await page.isHidden('#estado-conexao'), true);
```

Um segundo caso salva `jur_invalida`, não navega e espera `data-estado="invalido"`. Um terceiro salva vazio, espera a recarga, confirma `localStorage.getItem('jur.chaveConexao') === ''` e vê `#estado-conexao`.

- [ ] **Step 2: Rodar o arquivo e provar o estado vermelho**

Run: `cd jur && node --test tests/browser/config-chave.test.js`

Expected: FAIL porque os seletores ainda não existem.

- [ ] **Step 3: Implementar “Acesso a esta instalação”**

Antes da lista administrativa, criar formulário com input `password`, `autocomplete="off"`, botão e região `role="status"`. O submit:

```js
formConexao.addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = campoConexao.value.trim();
  window.jurApi.salvarChaveConexao(valor);
  if (!valor) {
    pintarConexao('removido', 'Chave removida deste browser.');
    window.setTimeout(() => window.location.reload(), 150);
    return;
  }
  try {
    await window.jurApi.pedir('/api/v1/chaves');
    pintarConexao('salvo', `Chave aceita (${mascarar(valor)}).`);
    window.setTimeout(() => window.location.reload(), 150);
  } catch (erro) {
    pintarConexao('invalido', `Chave recusada: ${erro.message}`);
  }
});
```

A lista e o gerador continuam usando `jurApi.pedir`; não criar exceção de bootstrap.

- [ ] **Step 4: Rodar os testes de Configurações**

Run: `cd jur && node --test tests/browser/config-chave.test.js`

Expected: PASS para conexão válida, inválida, removida e chave Anthropic.

- [ ] **Step 5: Commitar a configuração**

```bash
git add jur/publico/config.js jur/tests/browser/config-chave.test.js
git diff --cached --check
git commit -m "feat: configura a chave de conexão no browser"
```

---

### Task 4: Manter as suítes de browser autenticadas

**Files:**
- Create: `jur/tests/browser/chave-conexao.js`
- Modify: `jur/tests/browser/chat-fluxo.test.js`
- Modify: `jur/tests/browser/continuidade.test.js`
- Modify: `jur/tests/browser/decisoes.test.js`
- Modify: `jur/tests/browser/disponibilidade.test.js`
- Modify: `jur/tests/browser/lateral-e-apagar.test.js`
- Modify: `jur/tests/browser/markdown.test.js`

**Interfaces:**
- Consumes: gerenciador de chaves e `Page` antes da navegação.
- Produces: `gerarChaveBrowser(gerenciador): string` e `injetarChave(page, valor): Promise<void>`.

- [ ] **Step 1: Criar o helper e adaptar `disponibilidade.test.js`**

```js
function gerarChaveBrowser(gerenciador) {
  return gerenciador.gerar('suite de browser').valor;
}

async function injetarChave(page, valor) {
  await page.addInitScript((chave) => {
    localStorage.setItem('jur.chaveConexao', chave);
  }, valor);
}

module.exports = { gerarChaveBrowser, injetarChave };
```

Gerar a chave do mesmo banco no `before` e chamar `injetarChave` antes de `page.goto`.

- [ ] **Step 2: Executar a suíte adaptada**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`

Expected: PASS sem desligar `exigirChave:true`.

- [ ] **Step 3: Aplicar o helper às demais suítes**

Em cada arquivo listado, importar o helper, declarar `let chaveBrowser`, trocar a criação anônima do gerenciador pelo bloco abaixo e injetar antes de cada primeira navegação:

```js
const { gerarChaveBrowser, injetarChave } = require('./chave-conexao');

const gerenciador = chaves.criarGerenciador(con);
chaveBrowser = gerarChaveBrowser(gerenciador);

const page = await browser.newPage();
await injetarChave(page, chaveBrowser);
await page.goto(base);
```

Repassar `gerenciador` a `criarApp`, manter `exigirChave:true` e adaptar também páginas criadas dentro de cada `it`. Não usar valor fixo em fixture.

- [ ] **Step 4: Executar toda a suíte de browser**

Run: `cd jur && npm run test:browser`

Expected: todas as suítes PASS e nenhum servidor usa `exigirChave:false`.

- [ ] **Step 5: Commitar helper e adaptações**

```bash
git add jur/tests/browser/chave-conexao.js \
  jur/tests/browser/chat-fluxo.test.js \
  jur/tests/browser/continuidade.test.js \
  jur/tests/browser/decisoes.test.js \
  jur/tests/browser/lateral-e-apagar.test.js \
  jur/tests/browser/markdown.test.js
git add -p jur/tests/browser/disponibilidade.test.js
git diff --cached --check
git commit -m "test: autentica as suítes reais da interface"
```

No `git add -p`, selecionar somente hunks de autenticação e preservar os hunks preexistentes de cobertura TJSP/STJ. Antes do commit, confirmar com `git diff --cached --name-only` que somente os sete arquivos planejados estão staged.

---

### Task 5: Atualizar OpenAPI e documentação

**Files:**
- Modify: `jur/servidor/openapi.js:29-100,236-243,526-532,799-832`
- Modify: `jur/tests/openapi.test.js:65-72`
- Modify: `CLAUDE.md:29-54`
- Modify: `infra/README.md:88-187`
- Modify: `jur/tests/README.md:80-102`

**Interfaces:**
- Consumes: política observável das Tasks 1-4.
- Produces: segurança global Bearer e exceções públicas explícitas.

- [ ] **Step 1: Testar as exceções públicas**

```js
it('documenta somente saude, OpenAPI e docs como operacoes publicas', () => {
  const d = openapi.documento();
  const publicas = [];
  for (const [caminho, metodos] of Object.entries(d.paths)) {
    for (const [metodo, operacao] of Object.entries(metodos)) {
      if (Array.isArray(operacao.security) && operacao.security.length === 0) {
        publicas.push(`${metodo.toUpperCase()} ${caminho}`);
      }
    }
  }
  assert.deepStrictEqual(publicas.sort(), [
    'GET /api/v1/openapi.json',
    'GET /api/v1/saude',
    'GET /docs',
  ]);
});
```

- [ ] **Step 2: Rodar o teste e observar a falha**

Run: `cd jur && node --test tests/openapi.test.js`

Expected: FAIL porque OpenAPI e docs ainda herdam a segurança global.

- [ ] **Step 3: Atualizar contrato e textos**

Manter `security: [{ chaveDeConexao: [] }]`; adicionar `security: []` a OpenAPI/docs; remover toda dispensa por `Sec-Fetch-Site`; descrever `401` como Bearer ausente/inválido/revogado e `403` como `Origin` hostil. Adicionar `https://jurcrawler.com.br` a `servers`.

Em `CLAUDE.md` e `infra/README.md`, registrar página pública, chave em `jur.chaveConexao`, operações com Bearer e porta 3000 em loopback. Em `jur/tests/README.md`, registrar que todas as suítes usam chave real.

- [ ] **Step 4: Executar contrato e documentação**

```bash
cd jur
node --test tests/openapi.test.js
npm run docs
node sync-plugin.js --check
```

Expected: PASS e nenhum arquivo gerado inesperado.

- [ ] **Step 5: Commitar sem capturar mudanças alheias**

```bash
git add jur/servidor/openapi.js jur/tests/openapi.test.js infra/README.md jur/tests/README.md CLAUDE.md
git diff --cached --check
git commit -m "docs: documenta autenticação obrigatória da interface"
```

---

### Task 6: Gate local e imagem de release

**Files:**
- Verify only

**Interfaces:**
- Consumes: todos os commits anteriores.
- Produces: imagem `jur:bru-73` e evidência reproduzível.

- [ ] **Step 1: Executar a suíte rápida**

Run: `cd jur && npm test`

Expected: PASS. Se `executor.test.js` terminar por `SIGKILL`, repetir somente esse arquivo uma vez e anexar a ocorrência ao BRU-82; não mascarar outra falha.

- [ ] **Step 2: Executar browser e aceite**

```bash
cd jur
npm run test:browser
npm run aceite
```

Expected: ambos PASS sem chamada paga à Anthropic.

- [ ] **Step 3: Construir a imagem**

Run: `docker build --pull -f infra/Dockerfile -t jur:bru-73 .`

Expected: exit `0`.

- [ ] **Step 4: Provar autenticação na imagem**

Executar em um único shell:

```bash
set -euo pipefail
docker volume create jur-bru73-dados >/dev/null
docker volume create jur-bru73-cache >/dev/null
docker run -d --name jur-bru73-test \
  -p 127.0.0.1:3300:3000 \
  -e JUR_BIND=0.0.0.0 -e JUR_EXIGIR_CHAVE=0 \
  -v jur-bru73-dados:/dados -v jur-bru73-cache:/cache \
  jur:bru-73 >/dev/null
until curl -fsS http://127.0.0.1:3300/api/v1/saude >/dev/null; do sleep 1; done
jur_test_key=$(curl -fsS -X POST http://127.0.0.1:3300/api/v1/chaves \
  -H 'content-type: application/json' -d '{"nome":"teste da imagem"}' | jq -er .valor)
docker stop jur-bru73-test >/dev/null
docker rm jur-bru73-test >/dev/null
docker run -d --name jur-bru73-test \
  -p 127.0.0.1:3300:3000 \
  -e JUR_BIND=0.0.0.0 -e JUR_EXIGIR_CHAVE=1 \
  -v jur-bru73-dados:/dados -v jur-bru73-cache:/cache \
  jur:bru-73 >/dev/null
until curl -fsS http://127.0.0.1:3300/api/v1/saude >/dev/null; do sleep 1; done
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:3300/api/v1/chaves)" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $jur_test_key" http://127.0.0.1:3300/api/v1/chaves)" = 200
docker stop jur-bru73-test >/dev/null
docker rm jur-bru73-test >/dev/null
docker volume rm jur-bru73-dados jur-bru73-cache >/dev/null
```

Expected: os dois `test` passam. A chave fica apenas em variável de shell e não vai ao stdout.

- [ ] **Step 5: Revisar e publicar os commits**

```bash
git status --short
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
git push origin main
```

Expected: somente commits intencionais são enviados; mudanças preexistentes permanecem fora deles.
