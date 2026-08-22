# Frontend estilo Claude + integração — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refazer a interface do `jur` como um chat no estilo Claude — histórico na lateral, disponibilidade abaixo do chat, seletor de modelo — e construir o que ela exige: escolha de modelo no backend, persistência de conversa, chaves de conexão e documentação OpenAPI.

**Architecture:** As quatro primeiras tasks são backend puro (validação de modelo, chaves de conexão, autenticação, conversas), a quinta é documentação da API, e as quatro últimas constroem a interface sobre elas. A camada de chaves substitui o remendo de `Origin` como defesa principal.

**Tech Stack:** Node 22 (CommonJS) · `node:sqlite` · `node:http` · `node:crypto` · `node:test` · `@anthropic-ai/sdk` 0.120 · HTML/CSS/JS puro, sem build.

**Spec:** `docs/superpowers/specs/2026-08-22-frontend-chat-design.md` — leia antes de começar.

## Global Constraints

- Node >= 22, **CommonJS**. Nada de `import`, nada de `.mjs`.
- Testes com `node:test` + `node:assert`, estilo `describe`/`it`. Suíte atual: **138 testes**.
- Português nos identificadores de domínio e em toda a interface.
- **Sem framework e sem build step**, no servidor e no frontend. Nenhuma dependência nova além do que já existe.
- **Ambiente fechado:** nenhum script, fonte ou CSS de CDN. Tudo servido localmente.
- Model ids exatos: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`. Sem sufixo de data.
- **`effort` só vale para `claude-opus-5` e `claude-sonnet-5`.** `claude-haiku-4-5` **rejeita** o parâmetro — para ele, `output_config` não é enviado.
- `effort` viaja em `output_config: {effort}`, nunca no topo do payload.
- Proibidos no payload da Anthropic: `budget_tokens`, `temperature`, `top_p`, prefill de assistant, `thinking:{type:'disabled'}`. `max_tokens: 64000` em streaming.
- A chave da LLM **nunca** é persistida no servidor.
- Paleta: claro `#FAF9F5` / `#1F1E1D`; escuro `#262624` / `#FAF9F5`; acento `#D97757`.
- Rode tudo de dentro de `jur/`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `jur/servidor/validacao.js` (modificar) | ganha `validarModelo` e `validarEsforco` |
| `jur/servidor/llm.js` (modificar) | aceita `model`/`effort`; monta `output_config` só quando cabe |
| `jur/servidor/chaves.js` (criar) | gerar, verificar, listar e revogar chave de conexão |
| `jur/servidor/rotas/chaves.js` (criar) | rotas de chave |
| `jur/servidor/autenticacao.js` (criar) | middleware: exige Bearer ou origem local |
| `jur/servidor/conversas.js` (criar) | CRUD de conversa e mensagem sobre o SQLite |
| `jur/servidor/rotas/conversas.js` (criar) | rotas de conversa |
| `jur/servidor/openapi.js` (criar) | documento OpenAPI 3.1 |
| `jur/servidor/rotas/docs.js` (criar) | `/api/v1/openapi.json` e `/docs` |
| `jur/publico/index.html` (reescrever) | esqueleto: lateral + centro |
| `jur/publico/estilo.css` (reescrever) | paleta clara/escura, layout |
| `jur/publico/app.js` (reescrever) | orquestração |
| `jur/publico/disponibilidade.js` (criar) | bloco de tribunais + painel de ressalva |
| `jur/publico/config.js` (criar) | painel de chaves |

---

### Task 1: escolha de modelo e esforço

**Files:**
- Modify: `jur/servidor/validacao.js`, `jur/servidor/llm.js`, `jur/servidor/rotas/chat.js`
- Test: `jur/tests/validacao.test.js` (criar), `jur/tests/llm.test.js` (acrescentar)

**Interfaces:**
- Produces: `validarModelo(valor) -> {ok, valor, erro}`, `validarEsforco(valor, modelo) -> {ok, valor, erro}`, `MODELOS`, `ESFORCOS`
- `conversar()` passa a aceitar `modelo` e `esforco` no objeto de argumentos

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/validacao.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const v = require('../servidor/validacao');

describe('validarModelo', () => {
  it('aceita os tres modelos suportados', () => {
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      assert.strictEqual(v.validarModelo(m).ok, true, m);
      assert.strictEqual(v.validarModelo(m).valor, m);
    }
  });

  it('usa opus-5 quando ausente', () => {
    const r = v.validarModelo(undefined);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.valor, 'claude-opus-5');
  });

  it('recusa modelo desconhecido e nao coage', () => {
    for (const ruim of ['gpt-4', 'claude-opus-5-20250101', 'opus', true, 5, ['claude-opus-5'], {}]) {
      const r = v.validarModelo(ruim);
      assert.strictEqual(r.ok, false, JSON.stringify(ruim));
      assert.match(r.erro, /modelo/i);
    }
  });
});

describe('validarEsforco', () => {
  it('aceita low/medium/high nos modelos que suportam', () => {
    for (const e of ['low', 'medium', 'high']) {
      assert.strictEqual(v.validarEsforco(e, 'claude-opus-5').ok, true);
      assert.strictEqual(v.validarEsforco(e, 'claude-sonnet-5').ok, true);
    }
  });

  it('usa high quando ausente', () => {
    assert.strictEqual(v.validarEsforco(undefined, 'claude-opus-5').valor, 'high');
  });

  it('RECUSA esforco no haiku, que rejeita o parametro na API', () => {
    const r = v.validarEsforco('high', 'claude-haiku-4-5');
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /haiku/i);
  });

  it('aceita esforco ausente no haiku', () => {
    const r = v.validarEsforco(undefined, 'claude-haiku-4-5');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.valor, null);
  });

  it('recusa valor invalido sem coagir', () => {
    for (const ruim of ['alto', 'HIGH', true, 1, {}]) {
      assert.strictEqual(v.validarEsforco(ruim, 'claude-opus-5').ok, false, JSON.stringify(ruim));
    }
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/validacao.test.js`
Expected: FAIL — `v.validarModelo is not a function`

- [ ] **Step 3: Implemente em `validacao.js`**

Acrescente ao arquivo existente (não reescreva o que já está lá) e inclua os novos nomes no `module.exports`:

```js
/**
 * Modelos aceitos. Ids exatos, sem sufixo de data.
 * `esforco: false` marca modelo que REJEITA output_config.effort na API —
 * mandar esforco para ele devolve erro, entao barramos antes de sair daqui.
 */
const MODELOS = {
  'claude-opus-5': { esforco: true },
  'claude-sonnet-5': { esforco: true },
  'claude-haiku-4-5': { esforco: false },
};
const MODELO_PADRAO = 'claude-opus-5';
const ESFORCOS = ['low', 'medium', 'high'];
const ESFORCO_PADRAO = 'high';

function validarModelo(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: MODELO_PADRAO, erro: null };
  }
  if (typeof valor !== 'string') {
    return { ok: false, valor: null, erro: `modelo invalido: use um de ${Object.keys(MODELOS).join(', ')}` };
  }
  if (!Object.prototype.hasOwnProperty.call(MODELOS, valor)) {
    return { ok: false, valor: null, erro: `modelo invalido: "${valor}". Use um de ${Object.keys(MODELOS).join(', ')}` };
  }
  return { ok: true, valor, erro: null };
}

function validarEsforco(valor, modelo) {
  const suporta = MODELOS[modelo] && MODELOS[modelo].esforco;
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: suporta ? ESFORCO_PADRAO : null, erro: null };
  }
  if (!suporta) {
    return { ok: false, valor: null, erro: `o modelo ${modelo} (haiku) nao aceita nivel de esforco — remova o campo` };
  }
  if (typeof valor !== 'string' || !ESFORCOS.includes(valor)) {
    return { ok: false, valor: null, erro: `esforco invalido: use um de ${ESFORCOS.join(', ')}` };
  }
  return { ok: true, valor, erro: null };
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/validacao.test.js`
Expected: PASS (8 testes)

- [ ] **Step 5: Teste que `llm.js` monta o payload certo**

Acrescente a `jur/tests/llm.test.js` (não altere os testes existentes):

```js
  it('manda output_config.effort no opus e sonnet', async () => {
    for (const modelo of ['claude-opus-5', 'claude-sonnet-5']) {
      let capturado = null;
      const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
      const original = cliente.messages.stream.bind(cliente.messages);
      cliente.messages.stream = (p) => { capturado = p; return original(p); };
      await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, modelo, esforco: 'low' });
      assert.strictEqual(capturado.model, modelo);
      assert.deepStrictEqual(capturado.output_config, { effort: 'low' });
      assert.ok(!('effort' in capturado), 'effort nao pode ir no topo do payload');
    }
  });

  it('NAO manda output_config no haiku, que rejeita o parametro', async () => {
    let capturado = null;
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p) => { capturado = p; return original(p); };
    await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, modelo: 'claude-haiku-4-5' });
    assert.strictEqual(capturado.model, 'claude-haiku-4-5');
    assert.ok(!('output_config' in capturado), 'haiku nao aceita output_config');
  });
```

- [ ] **Step 6: Rode e confirme que falha**

Run: `cd jur && node --test tests/llm.test.js`
Expected: FAIL — o payload ainda usa o modelo fixo e não tem `output_config`

- [ ] **Step 7: Implemente em `llm.js`**

Troque a montagem do payload dentro de `conversar()`. A assinatura ganha `modelo` e `esforco`:

```js
async function conversar({ mensagens, apiKey, cliente, deps, aoTexto, aoFerramenta, sinal,
                          modelo = MODELO, esforco = 'high', maxIteracoes = MAX_ITERACOES }) {
```

e onde hoje monta os parâmetros do `stream`:

```js
    const parametros = {
      model: modelo,
      max_tokens: MAX_TOKENS,
      system: SISTEMA,
      tools: ferramentas.definicoes(),
      messages: historico,
    };
    // O haiku rejeita output_config.effort; validacao.js devolve esforco null para ele.
    if (esforco) parametros.output_config = { effort: esforco };

    const stream = anthropic.messages.stream(parametros);
```

- [ ] **Step 8: Ligue na rota `rotas/chat.js`**

Depois da validação de mensagens que já existe, antes de chamar `conversar`:

```js
    const vModelo = validacao.validarModelo(corpo.modelo);
    if (!vModelo.ok) return json(res, 400, { erro: vModelo.erro });
    const vEsforco = validacao.validarEsforco(corpo.esforco, vModelo.valor);
    if (!vEsforco.ok) return json(res, 400, { erro: vEsforco.erro });
```

e repasse `modelo: vModelo.valor, esforco: vEsforco.valor` para `llm.conversar`.

- [ ] **Step 9: Rode a suíte inteira**

Run: `cd jur && npm test`
Expected: PASS. 138 + 10 = 148 testes. **Nenhum teste existente pode mudar de comportamento.**

- [ ] **Step 10: Commit**

```bash
git add jur/servidor/validacao.js jur/servidor/llm.js jur/servidor/rotas/chat.js jur/tests/validacao.test.js jur/tests/llm.test.js
git commit -m "deixa o modelo e o esforco serem escolhidos por requisicao — e barra o esforco no haiku, que rejeita o parametro na API"
```

---

### Task 2: chaves de conexão

**Files:**
- Modify: `jur/servidor/db.js` (schema + `user_version`)
- Create: `jur/servidor/chaves.js`, `jur/servidor/rotas/chaves.js`
- Modify: `jur/servidor/index.js` (registrar a rota)
- Test: `jur/tests/chaves.test.js`

**Interfaces:**
- Consumes: `db.abrir(caminho)`
- Produces:
  - `criarGerenciador(con) -> Gerenciador`
  - `Gerenciador.gerar(nome) -> {id, nome, prefixo, valor, criadoEm}` — `valor` aparece **uma vez**
  - `Gerenciador.listar() -> [{id, nome, prefixo, criadoEm, ultimoUsoEm, revogadoEm}]`
  - `Gerenciador.verificar(valor) -> {id, nome} | null` — atualiza `ultimo_uso_em`
  - `Gerenciador.revogar(id) -> boolean`
- Rotas: `POST /api/v1/chaves`, `GET /api/v1/chaves`, `DELETE /api/v1/chaves/:id`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/chaves.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const chaves = require('../servidor/chaves');

let g;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-chaves-'));
  g = chaves.criarGerenciador(db.abrir(path.join(dir, 'jur.db')));
});

describe('chaves de conexao', () => {
  it('gera chave com prefixo reconhecivel e valor de tamanho util', () => {
    const c = g.gerar('claude code');
    assert.ok(c.valor.startsWith('jur_'), 'valor precisa ser reconhecivel como chave do jur');
    assert.ok(c.valor.length >= 40, `valor curto demais: ${c.valor.length}`);
    assert.ok(c.prefixo.length > 0 && c.valor.startsWith(c.prefixo));
    assert.strictEqual(c.nome, 'claude code');
  });

  it('NAO guarda o valor em claro no banco', () => {
    const c = g.gerar('teste');
    const linha = g._paraTeste().prepare('SELECT * FROM chave_conexao WHERE id=?').get(c.id);
    assert.ok(linha.hash && linha.hash !== c.valor, 'o hash nao pode ser o proprio valor');
    const bruto = JSON.stringify(linha);
    assert.ok(!bruto.includes(c.valor), 'o valor da chave vazou para alguma coluna');
  });

  it('verifica chave valida e recusa invalida', () => {
    const c = g.gerar('valida');
    const achou = g.verificar(c.valor);
    assert.ok(achou);
    assert.strictEqual(achou.id, c.id);
    assert.strictEqual(g.verificar('jur_naoexiste'), null);
    assert.strictEqual(g.verificar(''), null);
    assert.strictEqual(g.verificar(null), null);
    assert.strictEqual(g.verificar(undefined), null);
  });

  it('registra o ultimo uso', () => {
    const c = g.gerar('uso');
    assert.strictEqual(g.listar().find((x) => x.id === c.id).ultimoUsoEm, null);
    g.verificar(c.valor);
    assert.ok(g.listar().find((x) => x.id === c.id).ultimoUsoEm > 0);
  });

  it('chave revogada para de funcionar e aparece como revogada', () => {
    const c = g.gerar('revogar');
    assert.strictEqual(g.revogar(c.id), true);
    assert.strictEqual(g.verificar(c.valor), null, 'chave revogada nao pode autenticar');
    assert.ok(g.listar().find((x) => x.id === c.id).revogadoEm > 0);
    assert.strictEqual(g.revogar(c.id), false, 'revogar duas vezes nao e sucesso');
    assert.strictEqual(g.revogar('nao-existe'), false);
  });

  it('listar nunca devolve valor nem hash', () => {
    g.gerar('sigilo');
    for (const c of g.listar()) {
      assert.ok(!('valor' in c), 'listar nao pode devolver valor');
      assert.ok(!('hash' in c), 'listar nao pode devolver hash');
    }
  });

  it('duas chaves geradas sao diferentes', () => {
    assert.notStrictEqual(g.gerar('a').valor, g.gerar('b').valor);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/chaves.test.js`
Expected: FAIL — `Cannot find module '../servidor/chaves'`

- [ ] **Step 3: Acrescente a tabela em `db.js`**

Dentro da constante `SCHEMA`, depois da tabela `sessao`:

```sql
CREATE TABLE IF NOT EXISTS chave_conexao (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE,
  prefixo       TEXT NOT NULL,
  criado_em     INTEGER NOT NULL,
  ultimo_uso_em INTEGER,
  revogado_em   INTEGER
);
```

E troque `PRAGMA user_version = 1;` por `PRAGMA user_version = 2;`, ajustando o comentário de bloco para registrar que a versão 2 acrescentou `chave_conexao` — e que continuamos sem migração automática, com `CREATE TABLE IF NOT EXISTS` cobrindo banco antigo porque a mudança foi **aditiva**.

- [ ] **Step 4: Implemente `chaves.js`**

```js
// jur/servidor/chaves.js
const crypto = require('node:crypto');

const PREFIXO = 'jur_';
const BYTES = 32;

/** Hash de comparacao. Chave e segredo de alta entropia gerado por nos —
 *  sha256 basta e e deterministico, o que permite achar por indice unico. */
function hashDe(valor) {
  return crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
}

function criarGerenciador(con) {
  function gerar(nome) {
    const id = crypto.randomUUID();
    const valor = PREFIXO + crypto.randomBytes(BYTES).toString('base64url');
    const prefixo = valor.slice(0, PREFIXO.length + 6);
    const criadoEm = Date.now();
    con.prepare(`INSERT INTO chave_conexao (id, nome, hash, prefixo, criado_em)
                 VALUES (?, ?, ?, ?, ?)`).run(id, String(nome || 'sem nome'), hashDe(valor), prefixo, criadoEm);
    return { id, nome: String(nome || 'sem nome'), prefixo, valor, criadoEm };
  }

  function listar() {
    return con.prepare('SELECT id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em FROM chave_conexao ORDER BY criado_em DESC')
      .all()
      .map((l) => ({
        id: l.id, nome: l.nome, prefixo: l.prefixo,
        criadoEm: l.criado_em, ultimoUsoEm: l.ultimo_uso_em, revogadoEm: l.revogado_em,
      }));
  }

  function verificar(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    const linha = con.prepare('SELECT id, nome, revogado_em FROM chave_conexao WHERE hash = ?').get(hashDe(valor));
    if (!linha || linha.revogado_em) return null;
    con.prepare('UPDATE chave_conexao SET ultimo_uso_em = ? WHERE id = ?').run(Date.now(), linha.id);
    return { id: linha.id, nome: linha.nome };
  }

  function revogar(id) {
    const r = con.prepare('UPDATE chave_conexao SET revogado_em = ? WHERE id = ? AND revogado_em IS NULL')
      .run(Date.now(), id);
    return r.changes > 0;
  }

  return { gerar, listar, verificar, revogar, _paraTeste: () => con };
}

module.exports = { criarGerenciador, PREFIXO };
```

- [ ] **Step 5: Rode e confirme que passa**

Run: `cd jur && node --test tests/chaves.test.js`
Expected: PASS (7 testes)

- [ ] **Step 6: Implemente `rotas/chaves.js`**

```js
// jur/servidor/rotas/chaves.js
const { json, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const g = deps.chaves;
  if (!g) return;

  roteador.rota('POST', '/api/v1/chaves', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    const nome = typeof corpo.nome === 'string' && corpo.nome.trim() ? corpo.nome.trim().slice(0, 80) : 'sem nome';
    const c = g.gerar(nome);
    // Unica vez em que `valor` sai do servidor.
    json(res, 201, { ...c, aviso: 'guarde este valor agora — ele nao sera exibido de novo' });
  });

  roteador.rota('GET', '/api/v1/chaves', (req, res) => {
    json(res, 200, { chaves: g.listar() });
  });

  roteador.rota('DELETE', '/api/v1/chaves/:id', (req, res) => {
    if (!g.revogar(req.params.id)) return json(res, 404, { erro: 'chave nao encontrada ou ja revogada' });
    json(res, 200, { id: req.params.id, revogada: true });
  });
}

module.exports = { registrar };
```

- [ ] **Step 7: Ligue no `index.js`**

Em `criarApp`, junto dos outros `registrar`, acrescente `require('./rotas/chaves').registrar(roteador, deps);`. Em `iniciar()`, construa o gerenciador com a mesma conexão da fila e passe em `deps`:

```js
  const con = db.abrir();
  const fila = jobs.criarFila({ con });
  const gerenciadorChaves = chaves.criarGerenciador(con);
  ...criarApp({ fila, chaves: gerenciadorChaves })
```

(`iniciar()` hoje cria a conexão dentro de `criarFila`; extraia para uma variável, como acima, para as duas coisas compartilharem a mesma conexão.)

- [ ] **Step 8: Rode a suíte**

Run: `cd jur && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add jur/servidor/db.js jur/servidor/chaves.js jur/servidor/rotas/chaves.js jur/servidor/index.js jur/tests/chaves.test.js
git commit -m "emite chaves de conexao guardando so o hash — o valor aparece uma vez e some"
```

---

### Task 3: exigir autenticação nas rotas de API

Fecha o achado residual da revisão final: `POST /api/v1/buscas` aceitava requisição cross-origin e enfileirava busca real contra tribunal com o IP do operador.

**Files:**
- Create: `jur/servidor/autenticacao.js`
- Modify: `jur/servidor/http.js` (ponto de entrada do roteador), `jur/servidor/index.js`
- Test: `jur/tests/autenticacao.test.js`

**Interfaces:**
- Consumes: `chaves.verificar(valor)` (Task 2)
- Produces: `criarGuarda({chaves, exigir}) -> (req, res) -> boolean` — devolve `true` se **bloqueou** (já respondeu), `false` se pode seguir

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/autenticacao.test.js
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const chaves = require('../servidor/chaves');
const { criarApp } = require('../servidor/index');

let servidor; let base; let chaveValida;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-auth-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({ con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [], arquivo: null, erro: null }) });
  const g = chaves.criarGerenciador(con);
  chaveValida = g.gerar('teste').valor;
  servidor = http.createServer(criarApp({ fila, chaves: g, exigirChave: true }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const post = (caminho, corpo, cab = {}) => fetch(base + caminho, {
  method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: JSON.stringify(corpo),
});

describe('autenticacao', () => {
  it('recusa POST /buscas sem chave', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' });
    assert.strictEqual(r.status, 401);
    assert.match((await r.json()).erro, /chave/i);
  });

  it('aceita POST /buscas com chave valida', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' },
      { authorization: `Bearer ${chaveValida}` });
    assert.strictEqual(r.status, 202);
  });

  it('recusa chave invalida e chave revogada', async () => {
    const r = await post('/api/v1/buscas', { tribunal: 'stf', query: 'x' },
      { authorization: 'Bearer jur_naoexiste' });
    assert.strictEqual(r.status, 401);
  });

  it('recusa /mcp sem chave', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.strictEqual(r.status, 401);
  });

  it('deixa /api/v1/saude passar sem chave — e o healthcheck do container', async () => {
    assert.strictEqual((await fetch(`${base}/api/v1/saude`)).status, 200);
  });

  it('deixa passar sem chave quando a requisicao vem da propria interface', async () => {
    // O frontend e servido pela mesma origem; nesse caso o Origin bate com o Host.
    const r = await fetch(`${base}/api/v1/tribunais`, { headers: { origin: base } });
    assert.strictEqual(r.status, 200);
  });

  it('recusa origem hostil mesmo sem exigir chave para GET', async () => {
    const r = await fetch(`${base}/api/v1/tribunais`, { headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.status, 403);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/autenticacao.test.js`
Expected: FAIL — `criarApp` ainda não conhece `exigirChave`

- [ ] **Step 3: Implemente `autenticacao.js`**

```js
// jur/servidor/autenticacao.js
const { json } = require('./http');

/** Rotas que nunca exigem chave. `saude` fica de fora porque e o healthcheck
 *  do container, que roda de dentro e nao tem como carregar segredo. */
const LIVRES = new Set(['/api/v1/saude']);

function ehLocal(host) {
  if (!host) return false;
  const h = host.replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '[::1]' || h === '::1';
}

/** A propria interface: mesma origem que serviu a pagina. */
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return false;
  try {
    const u = new URL(origem);
    return u.host === req.headers.host && ehLocal(u.hostname);
  } catch { return false; }
}

function criarGuarda(opcoes = {}) {
  const gerenciador = opcoes.chaves;
  const exigir = Boolean(opcoes.exigir);

  return function guarda(req, res, caminho) {
    if (LIVRES.has(caminho)) return false;

    // Barreira 1: origem declarada e hostil.
    const origem = req.headers.origin;
    if (origem) {
      let hostil = true;
      try {
        const u = new URL(origem);
        hostil = !(ehLocal(u.hostname) || u.host === req.headers.host);
      } catch { hostil = true; }
      if (hostil) {
        json(res, 403, { erro: 'origem nao permitida' });
        return true;
      }
    }

    if (!exigir || !gerenciador) return false;

    // Barreira 2: a propria interface passa; qualquer outro cliente precisa de chave.
    if (mesmaOrigem(req)) return false;

    const cab = req.headers.authorization || '';
    const valor = cab.startsWith('Bearer ') ? cab.slice(7).trim() : '';
    if (gerenciador.verificar(valor)) return false;

    json(res, 401, { erro: 'chave de conexao ausente ou invalida — gere uma na interface, em Configuracoes' });
    return true;
  };
}

module.exports = { criarGuarda, ehLocal };
```

- [ ] **Step 4: Ligue no roteador**

Em `http.js`, `criarRoteador()` passa a aceitar `criarRoteador({guarda})`, e o `handler` chama a guarda logo depois de calcular `caminho`, antes de procurar rota:

```js
    if (guarda && guarda(req, res, caminho)) return undefined;
```

Em `index.js`, `criarApp(deps)` monta a guarda e a passa ao roteador:

```js
  const guarda = autenticacao.criarGuarda({ chaves: deps.chaves, exigir: deps.exigirChave });
  const roteador = criarRoteador({ guarda });
```

Em `iniciar()`, ligue por ambiente: `exigirChave: process.env.JUR_EXIGIR_CHAVE !== '0'` (ligado por padrão).

**Remova a verificação de `Origin` que hoje vive dentro de `mcp.js` e `rotas/chat.js`** — ela passou a ser responsabilidade da guarda, e deixar as duas cópias é a divergência que já custou uma rodada neste projeto. Confirme que os testes daquelas rotas continuam passando.

- [ ] **Step 5: Rode a suíte inteira**

Run: `cd jur && npm test`
Expected: PASS. Os testes de `Origin` que existiam em `mcp.test.js`/`chat.test.js` devem continuar verdes pela guarda. **Se algum falhar, pare e reporte** — pode significar que a guarda cobre menos que as cópias antigas.

- [ ] **Step 6: Commit**

```bash
git add jur/servidor/autenticacao.js jur/servidor/http.js jur/servidor/index.js jur/servidor/mcp.js jur/servidor/rotas/chat.js jur/tests/autenticacao.test.js
git commit -m "poe a exigencia de chave numa guarda unica no roteador — fecha o POST /buscas que qualquer site podia disparar e acaba com as duas copias da checagem de origem"
```

---

### Task 4: persistência de conversa

Hoje o histórico vive só no `localStorage` do browser e morre no F5. Pior: como só o texto é guardado, os blocos `tool_use`/`tool_result` se perdem, e no turno seguinte o modelo esquece os `job_id` das buscas que ele mesmo fez.

**Files:**
- Create: `jur/servidor/conversas.js`, `jur/servidor/rotas/conversas.js`
- Modify: `jur/servidor/rotas/chat.js` (gravar o turno), `jur/servidor/index.js`
- Test: `jur/tests/conversas.test.js`

**Interfaces:**
- Consumes: `db.abrir(caminho)`
- Produces:
  - `criarRepositorio(con) -> Repo`
  - `Repo.criar(titulo?) -> {id, titulo, criadoEm}`
  - `Repo.listar(limite?) -> [{id, titulo, criadoEm, atualizadoEm}]`
  - `Repo.mensagens(id) -> [{papel, conteudo}]` — `conteudo` **desserializado**
  - `Repo.acrescentar(conversaId, papel, conteudo, jobId?)`
  - `Repo.renomearSePrimeira(conversaId, textoDoUsuario)`
  - `Repo.apagar(id) -> boolean`
- Rotas: `POST/GET /api/v1/conversas`, `GET/DELETE /api/v1/conversas/:id`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/conversas.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const conversas = require('../servidor/conversas');

let repo;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-conv-'));
  repo = conversas.criarRepositorio(db.abrir(path.join(dir, 'jur.db')));
});

describe('conversas', () => {
  it('cria, lista e apaga', () => {
    const c = repo.criar();
    assert.ok(c.id);
    assert.ok(repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), true);
    assert.ok(!repo.listar().some((x) => x.id === c.id));
    assert.strictEqual(repo.apagar(c.id), false);
  });

  it('PRESERVA blocos estruturados de tool_use e tool_result', () => {
    const c = repo.criar();
    const usoDeFerramenta = [
      { type: 'text', text: 'vou buscar' },
      { type: 'tool_use', id: 'tu1', name: 'buscar_jurisprudencia', input: { tribunal: 'stf', query: 'x' } },
    ];
    const resultado = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'job abc: 3 resultados' }];
    repo.acrescentar(c.id, 'user', 'busque no stf');
    repo.acrescentar(c.id, 'assistant', usoDeFerramenta);
    repo.acrescentar(c.id, 'user', resultado);

    const m = repo.mensagens(c.id);
    assert.strictEqual(m.length, 3);
    assert.strictEqual(m[0].conteudo, 'busque no stf');
    assert.deepStrictEqual(m[1].conteudo, usoDeFerramenta, 'o bloco tool_use precisa voltar intacto');
    assert.deepStrictEqual(m[2].conteudo, resultado, 'o tool_result precisa voltar intacto');
    assert.strictEqual(m[1].conteudo[1].input.tribunal, 'stf');
  });

  it('deriva o titulo da primeira mensagem do usuario e nao troca depois', () => {
    const c = repo.criar();
    repo.renomearSePrimeira(c.id, 'acordaos do trf4 sobre auxilio-acidente em 2024');
    const t1 = repo.listar().find((x) => x.id === c.id).titulo;
    assert.match(t1, /trf4/);
    assert.ok(t1.length <= 60, `titulo longo demais: ${t1.length}`);
    repo.renomearSePrimeira(c.id, 'outra coisa completamente diferente');
    assert.strictEqual(repo.listar().find((x) => x.id === c.id).titulo, t1, 'titulo nao pode mudar depois');
  });

  it('ordena por atualizacao, mais recente primeiro', () => {
    const a = repo.criar(); const b = repo.criar();
    repo.acrescentar(a.id, 'user', 'oi');
    const ids = repo.listar().map((x) => x.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), 'a conversa com atividade recente vem antes');
  });

  it('mensagens de conversa inexistente e lista vazia, nao erro', () => {
    assert.deepStrictEqual(repo.mensagens('nao-existe'), []);
  });

  it('apagar conversa leva as mensagens junto', () => {
    const c = repo.criar();
    repo.acrescentar(c.id, 'user', 'oi');
    repo.apagar(c.id);
    assert.deepStrictEqual(repo.mensagens(c.id), []);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/conversas.test.js`
Expected: FAIL — `Cannot find module '../servidor/conversas'`

- [ ] **Step 3: Implemente `conversas.js`**

```js
// jur/servidor/conversas.js
const crypto = require('node:crypto');

const TITULO_MAX = 60;

function criarRepositorio(con) {
  function criar(titulo = null) {
    const id = crypto.randomUUID();
    const agora = Date.now();
    con.prepare('INSERT INTO conversa (id, titulo, criado_em, atualizado_em) VALUES (?,?,?,?)')
      .run(id, titulo, agora, agora);
    return { id, titulo, criadoEm: agora };
  }

  function listar(limite = 100) {
    return con.prepare(`SELECT id, titulo, criado_em, atualizado_em FROM conversa
                        ORDER BY atualizado_em DESC LIMIT ?`).all(limite)
      .map((l) => ({ id: l.id, titulo: l.titulo, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em }));
  }

  /**
   * `conteudo` pode ser string (texto simples) ou array de blocos da Messages API.
   * Guardamos SEMPRE serializado com uma marca de forma, para os blocos tool_use e
   * tool_result voltarem intactos — sem eles o modelo perde os job_id no turno seguinte.
   */
  function acrescentar(conversaId, papel, conteudo, jobId = null) {
    const bruto = JSON.stringify({ forma: typeof conteudo === 'string' ? 'texto' : 'blocos', valor: conteudo });
    const agora = Date.now();
    con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, job_id, criado_em)
                 VALUES (?,?,?,?,?)`).run(conversaId, papel, bruto, jobId, agora);
    con.prepare('UPDATE conversa SET atualizado_em = ? WHERE id = ?').run(agora, conversaId);
  }

  function mensagens(id) {
    return con.prepare('SELECT papel, conteudo, job_id FROM mensagem WHERE conversa_id = ? ORDER BY id ASC')
      .all(id)
      .map((l) => {
        let conteudo;
        try {
          const envelope = JSON.parse(l.conteudo);
          conteudo = envelope && 'valor' in envelope ? envelope.valor : l.conteudo;
        } catch {
          conteudo = l.conteudo;
        }
        return { papel: l.papel, conteudo, jobId: l.job_id };
      });
  }

  function renomearSePrimeira(conversaId, texto) {
    const atual = con.prepare('SELECT titulo FROM conversa WHERE id = ?').get(conversaId);
    if (!atual || atual.titulo) return;
    const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return;
    const titulo = limpo.length > TITULO_MAX ? `${limpo.slice(0, TITULO_MAX - 1)}…` : limpo;
    con.prepare('UPDATE conversa SET titulo = ? WHERE id = ?').run(titulo, conversaId);
  }

  function apagar(id) {
    con.prepare('DELETE FROM mensagem WHERE conversa_id = ?').run(id);
    return con.prepare('DELETE FROM conversa WHERE id = ?').run(id).changes > 0;
  }

  return { criar, listar, mensagens, acrescentar, renomearSePrimeira, apagar };
}

module.exports = { criarRepositorio, TITULO_MAX };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/conversas.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Implemente `rotas/conversas.js`**

```js
// jur/servidor/rotas/conversas.js
const { json, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const repo = deps.conversas;
  if (!repo) return;

  roteador.rota('POST', '/api/v1/conversas', async (req, res) => {
    try { await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    json(res, 201, repo.criar());
  });

  roteador.rota('GET', '/api/v1/conversas', (req, res) => {
    json(res, 200, { conversas: repo.listar(Number(req.query.limite) || 100) });
  });

  roteador.rota('GET', '/api/v1/conversas/:id', (req, res) => {
    const lista = repo.listar(1000).find((c) => c.id === req.params.id);
    if (!lista) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { ...lista, mensagens: repo.mensagens(req.params.id) });
  });

  roteador.rota('DELETE', '/api/v1/conversas/:id', (req, res) => {
    if (!repo.apagar(req.params.id)) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { id: req.params.id, apagada: true });
  });
}

module.exports = { registrar };
```

- [ ] **Step 6: Grave o turno no `rotas/chat.js`**

Se o corpo trouxer `conversaId` e `deps.conversas` existir:
- antes de chamar `conversar`, grave a última mensagem do usuário e chame `renomearSePrimeira` com o texto dela;
- ao terminar (no evento `fim`), grave as mensagens **novas** que `conversar` devolveu em `r.mensagens` — as que vieram depois das que entraram. Compare por índice: `r.mensagens.slice(mensagensEnviadas.length)`.

Grave o `content` como veio (array de blocos quando for o caso), não só o texto.

- [ ] **Step 7: Ligue no `index.js`**

`require('./rotas/conversas').registrar(roteador, deps);` em `criarApp`, e em `iniciar()` construa `conversas.criarRepositorio(con)` com a mesma conexão, passando em `deps`.

- [ ] **Step 8: Rode a suíte**

Run: `cd jur && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add jur/servidor/conversas.js jur/servidor/rotas/conversas.js jur/servidor/rotas/chat.js jur/servidor/index.js jur/tests/conversas.test.js
git commit -m "guarda a conversa no banco preservando os blocos de ferramenta — sem eles o modelo esquece no turno 2 os job_id das buscas que ele mesmo fez"
```

---

### Task 5: documentação da API

Hoje são 10 rotas no ar e uma documentada por um `curl` de exemplo no README. Com as tasks 2 e 4, são 17.

**Files:**
- Create: `jur/servidor/openapi.js`, `jur/servidor/rotas/docs.js`
- Modify: `jur/servidor/index.js`
- Test: `jur/tests/openapi.test.js`

**Interfaces:**
- Produces: `documento() -> object` (OpenAPI 3.1); rotas `GET /api/v1/openapi.json` e `GET /docs`

- [ ] **Step 1: Escreva o teste que falha**

O teste mais valioso aqui não é o formato — é a **reconciliação**: rota registrada e não documentada é o defeito que documentação de API sempre tem.

```js
// jur/tests/openapi.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const openapi = require('../servidor/openapi');

/** Varre os arquivos de rota e extrai (metodo, caminho) de cada roteador.rota(...). */
function rotasRegistradas() {
  const dirs = [path.join(__dirname, '..', 'servidor'), path.join(__dirname, '..', 'servidor', 'rotas')];
  const achadas = [];
  for (const dir of dirs) {
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('.js')) continue;
      const texto = fs.readFileSync(path.join(dir, arquivo), 'utf8');
      for (const m of texto.matchAll(/roteador\.rota\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g)) {
        achadas.push(`${m[1]} ${m[2]}`);
      }
    }
  }
  return [...new Set(achadas)];
}

describe('openapi', () => {
  it('e um documento 3.1 com titulo e versao', () => {
    const d = openapi.documento();
    assert.match(d.openapi, /^3\.1/);
    assert.ok(d.info.title && d.info.version);
  });

  it('documenta TODA rota registrada', () => {
    const d = openapi.documento();
    const documentadas = new Set();
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      for (const metodo of Object.keys(metodos)) documentadas.add(`${metodo.toUpperCase()} ${caminho}`);
    }
    const faltando = rotasRegistradas().filter((r) => !documentadas.has(r));
    assert.deepStrictEqual(faltando, [], `rotas sem documentacao: ${faltando.join(', ')}`);
  });

  it('nao documenta rota que nao existe', () => {
    const d = openapi.documento();
    const registradas = new Set(rotasRegistradas());
    const sobrando = [];
    for (const [caminho, metodos] of Object.entries(d.paths)) {
      for (const metodo of Object.keys(metodos)) {
        const chave = `${metodo.toUpperCase()} ${caminho}`;
        if (!registradas.has(chave)) sobrando.push(chave);
      }
    }
    assert.deepStrictEqual(sobrando, [], `documentadas mas inexistentes: ${sobrando.join(', ')}`);
  });

  it('declara o esquema de autenticacao por chave', () => {
    const d = openapi.documento();
    assert.ok(d.components.securitySchemes, 'precisa declarar securitySchemes');
    const s = Object.values(d.components.securitySchemes)[0];
    assert.strictEqual(s.type, 'http');
    assert.strictEqual(s.scheme, 'bearer');
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/openapi.test.js`
Expected: FAIL — `Cannot find module '../servidor/openapi'`

- [ ] **Step 3: Implemente `openapi.js`**

Escreva o documento à mão, cobrindo **todas** as rotas que o teste do Step 1 encontrar — rode-o para ver a lista. O esqueleto:

```js
// jur/servidor/openapi.js
const { version } = require('../package.json');

const ERRO = { type: 'object', properties: { erro: { type: 'string' } }, required: ['erro'] };

function documento() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'jur — jurisprudência dos tribunais brasileiros',
      version,
      description:
        'Busca de jurisprudência em 75 acervos de tribunais brasileiros.\n\n'
        + 'Regra que atravessa toda a API: **zero resultados nunca significa ausência de '
        + 'jurisprudência**. Quando `total` é 0, a resposta carrega `avisos[]` com a ressalva '
        + 'do tribunal — vários acervos têm recorte de período. Uma busca que **falhou** '
        + 'é sempre distinguível de uma busca vazia: o job fica com `status: "erro"`.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'local' }],
    components: {
      securitySchemes: {
        chaveDeConexao: {
          type: 'http', scheme: 'bearer',
          description: 'Chave gerada em POST /api/v1/chaves. A interface local, servida pela mesma origem, dispensa a chave.',
        },
      },
      schemas: { Erro: ERRO /* ...demais esquemas */ },
    },
    security: [{ chaveDeConexao: [] }],
    paths: { /* uma entrada por rota registrada */ },
  };
}

module.exports = { documento };
```

Cada operação precisa de `summary`, `description` quando a rota tem ressalva, os parâmetros, e os códigos de resposta reais (incluindo `400`, `401`, `403`, `404`, `409` onde existirem). Documente que `GET /api/v1/saude` é a única rota livre de autenticação.

- [ ] **Step 4: Implemente `rotas/docs.js`**

`GET /api/v1/openapi.json` devolve o documento. `GET /docs` devolve uma página HTML **autocontida** que lê o mesmo documento e renderiza — sem CDN, sem Swagger UI externo (a restrição de ambiente fechado vale aqui). Uma lista de rotas agrupadas por recurso, com método, caminho, descrição e códigos de resposta, é suficiente e honesta.

- [ ] **Step 5: Ligue no `index.js` e rode**

Run: `cd jur && npm test`
Expected: PASS — em especial os dois testes de reconciliação.

- [ ] **Step 6: Confirme na tela**

```bash
cd jur && JUR_DADOS=/tmp/jur-dev JUR_EXIGIR_CHAVE=0 node servidor/index.js &
```
Abra `http://localhost:3000/docs` e confirme que a página lista as rotas e é legível sem internet. Depois `curl -s localhost:3000/api/v1/openapi.json | head -c 300`.

- [ ] **Step 7: Commit**

```bash
git add jur/servidor/openapi.js jur/servidor/rotas/docs.js jur/servidor/index.js jur/tests/openapi.test.js
git commit -m "documenta a API em OpenAPI com teste que quebra quando alguem registra rota e nao documenta"
```

---

### Task 6: esqueleto e tema

Reescreve a interface. A lista de tribunais **sai** da lateral; a lateral passa a ser histórico e configuração.

**Files:**
- Rewrite: `jur/publico/index.html`, `jur/publico/estilo.css`

**Interfaces:**
- Produces: os ids que as tasks 7–9 usam — `#lateral`, `#nova-conversa`, `#historico`, `#abrir-config`, `#painel-config`, `#centro`, `#inicial`, `#mensagens`, `#formulario`, `#entrada`, `#enviar`, `#seletor-modelo`, `#prompts`, `#disponibilidade`, `#manual`, `#tema`

- [ ] **Step 1: Escreva `index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jur — jurisprudência dos tribunais brasileiros</title>
  <link rel="stylesheet" href="/estilo.css">
</head>
<body>
  <aside id="lateral">
    <div class="lateral-topo">
      <span class="marca">jur</span>
      <button id="tema" class="icone" title="Alternar tema" aria-label="Alternar tema">◐</button>
    </div>

    <button id="nova-conversa" class="botao-novo">
      <span aria-hidden="true">+</span> Nova conversa
    </button>

    <nav id="historico" aria-label="Conversas"></nav>

    <button id="abrir-config" class="config">
      <span class="config-avatar" aria-hidden="true">⚙</span>
      <span class="config-texto">
        <strong>Configurações</strong>
        <small>Chaves e conexão</small>
      </span>
    </button>
  </aside>

  <main id="centro">
    <section id="inicial">
      <h1 class="saudacao">Sobre o que você quer pesquisar?</h1>
      <div id="caixa-inicial" class="caixa-entrada"></div>
      <section id="prompts" aria-label="Modelos de prompt"></section>
      <section id="disponibilidade" aria-label="Disponibilidade dos tribunais"></section>
      <section id="manual" aria-label="Manual"></section>
    </section>

    <section id="conversa" hidden>
      <div id="mensagens" role="log" aria-live="polite"></div>
      <div id="caixa-conversa" class="caixa-entrada"></div>
    </section>
  </main>

  <div id="painel-config" class="painel" hidden></div>
  <div id="painel-ressalva" class="painel" hidden></div>

  <template id="tpl-entrada">
    <form class="formulario">
      <textarea class="entrada" rows="1" placeholder="Pergunte sobre jurisprudência…"></textarea>
      <div class="entrada-rodape">
        <div class="seletor-modelo">
          <select class="modelo" aria-label="Modelo">
            <option value="claude-opus-5">Opus 5</option>
            <option value="claude-sonnet-5">Sonnet 5</option>
            <option value="claude-haiku-4-5">Haiku 4.5</option>
          </select>
          <select class="esforco" aria-label="Nível de esforço">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high" selected>High</option>
          </select>
        </div>
        <button type="submit" class="enviar" aria-label="Enviar">↑</button>
      </div>
    </form>
  </template>

  <!-- app.js PRIMEIRO: ele define window.jurApi e window.jurUI, que os outros dois consomem
       ja no carregamento (disponibilidade.js busca /api/v1/tribunais de imediato). -->
  <script src="/app.js"></script>
  <script src="/disponibilidade.js"></script>
  <script src="/config.js"></script>
</body>
</html>
```

- [ ] **Step 2: Escreva `estilo.css`**

```css
/* Paleta do Claude. Claro por padrao; escuro por preferencia do sistema ou
   por data-tema="escuro" no <html>, que o alternador escreve. */
:root {
  --fundo: #FAF9F5;
  --superficie: #FFFFFF;
  --lateral: #F0EEE6;
  --texto: #1F1E1D;
  --fraco: #6F6E69;
  --borda: #E3E0D8;
  --acento: #D97757;
  --ok: #2E7D46;
  --instavel: #B7791F;
  --bloqueado: #8A8781;
  --sessao: #2C6BB0;
  --raio: 12px;
  --lateral-largura: 264px;
}
:root[data-tema="escuro"] {
  --fundo: #262624;
  --superficie: #30302E;
  --lateral: #1F1E1D;
  --texto: #FAF9F5;
  --fraco: #A3A099;
  --borda: #3E3D3A;
  --acento: #D97757;
  --ok: #4CAF6A;
  --instavel: #D6A03A;
  --bloqueado: #6F6E69;
  --sessao: #5B9BD5;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-tema="claro"]) {
    --fundo: #262624; --superficie: #30302E; --lateral: #1F1E1D;
    --texto: #FAF9F5; --fraco: #A3A099; --borda: #3E3D3A;
    --ok: #4CAF6A; --instavel: #D6A03A; --bloqueado: #6F6E69; --sessao: #5B9BD5;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0; display: flex; height: 100vh; overflow: hidden;
  background: var(--fundo); color: var(--texto);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
}

/* ---------- lateral ---------- */
#lateral {
  width: var(--lateral-largura); flex: 0 0 var(--lateral-largura);
  background: var(--lateral); border-right: 1px solid var(--borda);
  display: flex; flex-direction: column; padding: 12px;
}
.lateral-topo { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px 12px; }
.marca { font-size: 19px; font-weight: 600; letter-spacing: -.01em; }
.icone {
  background: none; border: 0; color: var(--fraco); cursor: pointer;
  font-size: 16px; padding: 4px 6px; border-radius: 6px;
}
.icone:hover { background: var(--borda); color: var(--texto); }

.botao-novo {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 9px 12px; margin-bottom: 14px;
  background: var(--superficie); color: var(--texto);
  border: 1px solid var(--borda); border-radius: var(--raio);
  font: inherit; font-weight: 500; cursor: pointer; text-align: left;
}
.botao-novo:hover { border-color: var(--acento); }

#historico { flex: 1; overflow-y: auto; margin: 0 -4px; }
#historico h2 {
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--fraco); margin: 12px 10px 6px; font-weight: 600;
}
.conversa-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  color: var(--texto); font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.conversa-item:hover { background: var(--borda); }
.conversa-item[aria-current="true"] { background: var(--borda); font-weight: 500; }
.conversa-item .apagar { margin-left: auto; opacity: 0; border: 0; background: none; color: var(--fraco); cursor: pointer; }
.conversa-item:hover .apagar { opacity: 1; }
.vazio { color: var(--fraco); font-size: 13px; padding: 8px 10px; }

.config {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 10px; margin-top: 8px;
  background: none; border: 0; border-top: 1px solid var(--borda);
  color: var(--texto); font: inherit; cursor: pointer; text-align: left;
}
.config:hover { background: var(--borda); }
.config-avatar {
  width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%;
  background: var(--acento); color: #fff;
  display: grid; place-items: center; font-size: 14px;
}
.config-texto { display: flex; flex-direction: column; line-height: 1.25; }
.config-texto small { color: var(--fraco); font-size: 12px; }

/* ---------- centro ---------- */
#centro { flex: 1; min-width: 0; overflow-y: auto; }
#inicial { max-width: 740px; margin: 0 auto; padding: 12vh 24px 80px; }
.saudacao { font-size: 30px; font-weight: 400; letter-spacing: -.02em; margin: 0 0 26px; text-align: center; }

.caixa-entrada { margin-bottom: 34px; }
.formulario {
  background: var(--superficie); border: 1px solid var(--borda);
  border-radius: 16px; padding: 12px 14px 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.formulario:focus-within { border-color: var(--acento); }
.entrada {
  width: 100%; border: 0; resize: none; background: none; color: var(--texto);
  font: inherit; outline: none; max-height: 200px;
}
.entrada-rodape { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.seletor-modelo { display: flex; gap: 4px; margin-left: auto; }
.seletor-modelo select {
  background: none; border: 0; color: var(--fraco); font: inherit; font-size: 13px;
  cursor: pointer; padding: 3px 4px; border-radius: 6px;
}
.seletor-modelo select:hover { background: var(--borda); color: var(--texto); }
.enviar {
  width: 30px; height: 30px; flex: 0 0 30px; border: 0; border-radius: 8px;
  background: var(--acento); color: #fff; cursor: pointer; font-size: 15px;
}
.enviar:disabled { opacity: .45; cursor: default; }

/* ---------- blocos da tela inicial ---------- */
#inicial section { margin-bottom: 30px; }
.titulo-bloco {
  font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--fraco); font-weight: 600; margin: 0 0 10px;
}

/* ---------- mensagens ---------- */
#conversa { display: flex; flex-direction: column; height: 100%; }
#mensagens { flex: 1; overflow-y: auto; padding: 28px 24px; }
#conversa .caixa-entrada { max-width: 740px; margin: 0 auto 20px; width: 100%; padding: 0 24px; }
.msg { max-width: 740px; margin: 0 auto 20px; white-space: pre-wrap; word-wrap: break-word; }
.msg.user { background: var(--superficie); border: 1px solid var(--borda); border-radius: var(--raio); padding: 12px 16px; }
.msg.assistant { padding: 2px 0; }
.msg.ferramenta {
  color: var(--fraco); font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, monospace;
  border-left: 2px solid var(--borda); padding-left: 10px;
}
.msg.erro { color: #B3261E; border: 1px solid #B3261E44; border-radius: var(--raio); padding: 12px 16px; }

/* ---------- paineis ---------- */
.painel {
  position: fixed; inset: 0; background: rgba(0,0,0,.35);
  display: grid; place-items: center; padding: 24px; z-index: 10;
}
.painel-caixa {
  background: var(--superficie); border: 1px solid var(--borda); border-radius: 16px;
  max-width: 620px; width: 100%; max-height: 80vh; overflow-y: auto; padding: 22px 24px;
}
.painel h2 { margin: 0 0 4px; font-size: 18px; }
.painel .fechar { float: right; background: none; border: 0; color: var(--fraco); font-size: 20px; cursor: pointer; }

@media (max-width: 860px) {
  #lateral { display: none; }
  #inicial { padding-top: 6vh; }
}
```

- [ ] **Step 3: Suba e confira o esqueleto**

```bash
cd jur && JUR_DADOS=/tmp/jur-dev JUR_EXIGIR_CHAVE=0 node servidor/index.js &
```
Abra `http://localhost:3000`. Confirme: lateral com marca, botão de nova conversa e bloco de configurações no rodapé; centro com saudação; **nenhum tribunal na lateral**. Os blocos ainda estão vazios — as tasks seguintes os preenchem.

Alterne o tema do sistema (macOS: Aparência clara/escura) e confirme que as cores mudam.

- [ ] **Step 4: Commit**

```bash
git add jur/publico/index.html jur/publico/estilo.css
git commit -m "refaz a interface como chat — a lista de tribunais sai da lateral e o historico entra"
```

---

### Task 7: chat, seletor de modelo e histórico

**Files:**
- Rewrite: `jur/publico/app.js`

**Interfaces:**
- Consumes: `POST /api/v1/chat` (SSE, aceita `modelo`, `esforco`, `conversaId`), `POST/GET/DELETE /api/v1/conversas`, `GET /api/v1/conversas/:id`
- Produces (globais que as tasks 8 e 9 usam): `window.jurApi.pedir(caminho, opcoes)`, `window.jurApi.chave()`, `window.jurUI.preencherEntrada(texto)`, `window.jurUI.abrirPainel(elemento, conteudoHtml)`

- [ ] **Step 1: Escreva `app.js`**

```js
// jur/publico/app.js
const $ = (s, raiz = document) => raiz.querySelector(s);
const CHAVE_LLM = 'jur.chaveLlm';
const CHAVE_TEMA = 'jur.tema';
const CHAVE_MODELO = 'jur.modelo';
const CHAVE_ESFORCO = 'jur.esforco';

const guardado = {
  ler(k, padrao = '') { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } },
  escrever(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

// ---------- API ----------
window.jurApi = {
  chave: () => guardado.ler(CHAVE_LLM).trim(),
  async pedir(caminho, opcoes = {}) {
    const r = await fetch(caminho, {
      ...opcoes,
      headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) },
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      throw new Error(corpo.erro || `HTTP ${r.status}`);
    }
    return r.status === 204 ? null : r.json();
  },
};

// ---------- tema ----------
function aplicarTema(t) {
  if (t) document.documentElement.dataset.tema = t;
  else delete document.documentElement.dataset.tema;
}
aplicarTema(guardado.ler(CHAVE_TEMA, ''));
$('#tema').addEventListener('click', () => {
  const atual = document.documentElement.dataset.tema;
  const escuroAgora = atual ? atual === 'escuro'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const novo = escuroAgora ? 'claro' : 'escuro';
  aplicarTema(novo);
  guardado.escrever(CHAVE_TEMA, novo);
});

// ---------- painéis ----------
window.jurUI = {
  abrirPainel(painel, html) {
    painel.innerHTML = `<div class="painel-caixa"><button class="fechar" aria-label="Fechar">×</button>${html}</div>`;
    painel.hidden = false;
    const fechar = () => { painel.hidden = true; };
    $('.fechar', painel).addEventListener('click', fechar);
    painel.addEventListener('click', (e) => { if (e.target === painel) fechar(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
    });
    return painel;
  },
  preencherEntrada(texto) {
    const campo = $('.entrada', caixaAtiva());
    campo.value = texto;
    campo.focus();
    ajustarAltura(campo);
  },
};

// ---------- caixa de entrada ----------
function montarCaixa(destino) {
  destino.innerHTML = '';
  destino.appendChild($('#tpl-entrada').content.cloneNode(true));
  const form = $('.formulario', destino);
  const campo = $('.entrada', destino);
  const modelo = $('.modelo', destino);
  const esforco = $('.esforco', destino);

  modelo.value = guardado.ler(CHAVE_MODELO, 'claude-opus-5');
  esforco.value = guardado.ler(CHAVE_ESFORCO, 'high');
  sincronizarEsforco(modelo, esforco);

  modelo.addEventListener('change', () => {
    guardado.escrever(CHAVE_MODELO, modelo.value);
    sincronizarEsforco(modelo, esforco);
  });
  esforco.addEventListener('change', () => guardado.escrever(CHAVE_ESFORCO, esforco.value));

  campo.addEventListener('input', () => ajustarAltura(campo));
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(campo, modelo.value, esforco.value); });
  return destino;
}

/** O haiku rejeita nivel de esforco na API — some com o seletor nele. */
function sincronizarEsforco(modelo, esforco) {
  esforco.hidden = modelo.value === 'claude-haiku-4-5';
}

function ajustarAltura(campo) {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 200)}px`;
}

const caixaAtiva = () => ($('#conversa').hidden ? $('#caixa-inicial') : $('#caixa-conversa'));

// ---------- histórico ----------
let conversaAtual = null;
/** O que vai para a API a cada turno. Reconstruido ao abrir conversa existente. */
const historicoLocal = [];

async function carregarHistorico() {
  const alvo = $('#historico');
  let lista = [];
  try { lista = (await window.jurApi.pedir('/api/v1/conversas')).conversas; } catch { /* segue vazio */ }
  if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma conversa ainda.</p>'; return; }
  alvo.innerHTML = '<h2>Conversas</h2>';
  for (const c of lista) {
    const item = document.createElement('div');
    item.className = 'conversa-item';
    item.setAttribute('aria-current', String(c.id === conversaAtual));
    const titulo = document.createElement('span');
    titulo.textContent = c.titulo || 'Sem título';
    item.appendChild(titulo);
    const apagar = document.createElement('button');
    apagar.className = 'apagar'; apagar.textContent = '×';
    apagar.title = 'Apagar conversa';
    apagar.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.jurApi.pedir(`/api/v1/conversas/${c.id}`, { method: 'DELETE' });
      if (c.id === conversaAtual) irParaInicial();
      carregarHistorico();
    });
    item.appendChild(apagar);
    item.addEventListener('click', () => abrirConversa(c.id));
    alvo.appendChild(item);
  }
}

function irParaInicial() {
  conversaAtual = null;
  $('#conversa').hidden = true;
  $('#inicial').hidden = false;
  $('#mensagens').innerHTML = '';
  carregarHistorico();
}

async function abrirConversa(id) {
  const dados = await window.jurApi.pedir(`/api/v1/conversas/${id}`);
  conversaAtual = id;
  $('#inicial').hidden = true;
  $('#conversa').hidden = false;
  montarCaixa($('#caixa-conversa'));

  const alvo = $('#mensagens');
  alvo.innerHTML = '';

  // O historico enviado ao modelo precisa voltar INTEIRO, com os blocos de ferramenta —
  // sem eles o modelo perde os job_id das buscas que ele mesmo fez nesta conversa.
  historicoLocal.length = 0;
  for (const m of dados.mensagens) {
    historicoLocal.push({ role: m.papel, content: m.conteudo });
    const texto = typeof m.conteudo === 'string'
      ? m.conteudo
      : m.conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (texto) bolha(m.papel === 'user' ? 'user' : 'assistant', texto);
  }
  carregarHistorico();
}

$('#nova-conversa').addEventListener('click', irParaInicial);

// ---------- mensagens ----------
function bolha(classe, texto) {
  const div = document.createElement('div');
  div.className = `msg ${classe}`;
  div.textContent = texto;
  $('#mensagens').appendChild(div);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  return div;
}

async function lerSSE(resposta, aoEvento, aoAtividade) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (aoAtividade) aoAtividade();
    buffer += dec.decode(value, { stream: true });
    const partes = buffer.split('\n\n');
    buffer = partes.pop();
    for (const parte of partes) {
      const nome = (parte.match(/^event: (.+)$/m) || [])[1];
      const dado = (parte.match(/^data: (.+)$/m) || [])[1];
      if (!nome || !dado) continue;
      try { aoEvento(nome, JSON.parse(dado)); } catch { /* fragmento */ }
    }
  }
}

async function enviar(campo, modelo, esforco) {
  const texto = campo.value.trim();
  if (!texto) return;

  if (!conversaAtual) {
    const c = await window.jurApi.pedir('/api/v1/conversas', { method: 'POST', body: '{}' });
    conversaAtual = c.id;
    historicoLocal.length = 0;
    $('#inicial').hidden = true;
    $('#conversa').hidden = false;
    $('#mensagens').innerHTML = '';
    montarCaixa($('#caixa-conversa'));
  }

  const botao = $('.enviar', caixaAtiva());
  botao.disabled = true;
  campo.value = ''; ajustarAltura(campo);
  bolha('user', texto);
  historicoLocal.push({ role: 'user', content: texto });

  let destino = null;
  const controle = new AbortController();
  let relogio = setTimeout(() => controle.abort(), 30000);
  const renovar = () => { clearTimeout(relogio); relogio = setTimeout(() => controle.abort(), 30000); };

  try {
    const cab = { 'content-type': 'application/json' };
    const chave = window.jurApi.chave();
    if (chave) cab['x-api-key'] = chave;

    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cab, signal: controle.signal,
      body: JSON.stringify({ mensagens: historicoLocal, modelo, esforco, conversaId: conversaAtual }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      bolha('erro', corpo.erro);
      return;
    }
    await lerSSE(r, (nome, dados) => {
      if (nome === 'texto') {
        if (!destino) destino = bolha('assistant', '');
        destino.textContent += dados.texto;
        $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
      } else if (nome === 'ferramenta') {
        bolha('ferramenta', `▸ ${dados.nome}(${JSON.stringify(dados.entrada)})`);
        destino = null;
      } else if (nome === 'fim') {
        historicoLocal.push({ role: 'assistant', content: dados.texto });
        carregarHistorico();
      } else if (nome === 'erro') {
        bolha('erro', dados.erro);
      }
    }, renovar);
  } catch (e) {
    bolha('erro', e.name === 'AbortError' ? 'A resposta demorou demais e foi interrompida.' : e.message);
  } finally {
    clearTimeout(relogio);
    botao.disabled = false;
  }
}

// ---------- início ----------
montarCaixa($('#caixa-inicial'));
carregarHistorico();
```

- [ ] **Step 2: Confira na tela**

Com o servidor no ar e uma chave da Anthropic configurada (Task 9 monta o painel; por ora exporte `ANTHROPIC_API_KEY` ao subir), verifique:
1. digitar e enviar cria conversa, que aparece na lateral com título derivado da pergunta;
2. trocar para **Haiku 4.5** faz o seletor de esforço **sumir**;
3. recarregar a página e clicar na conversa na lateral traz as mensagens de volta **e a caixa de mensagem funciona** — digite e envie de novo, e confirme que o modelo tem o contexto anterior (pergunte "o que eu perguntei antes?");
4. o botão de apagar remove da lista;
5. Enter envia, Shift+Enter quebra linha.

- [ ] **Step 3: Commit**

```bash
git add jur/publico/app.js
git commit -m "poe o chat no centro com modelo selecionavel e historico que sobrevive ao F5"
```

---

### Task 8: disponibilidade, modelos de prompt e manual

**Files:**
- Create: `jur/publico/disponibilidade.js`

**Interfaces:**
- Consumes: `GET /api/v1/tribunais`, `window.jurUI.abrirPainel`, `window.jurUI.preencherEntrada`
- Produces: nada consumido por outra task

**Requisito que não pode regredir:** a ressalva do tribunal precisa ser alcançável **sem hover**. A Task 12 do plano anterior gastou uma rodada de revisão nisso — o TRF1 tem a base congelada desde 31/07/2025, e quem buscar 2026 recebe zero. Aqui a ressalva abre num painel ao **clique**.

- [ ] **Step 1: Escreva `disponibilidade.js`**

```js
// jur/publico/disponibilidade.js
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);

  const PROMPTS = [
    { titulo: 'Tese firmada',
      texto: 'Qual a tese firmada pelo STJ sobre ' },
    { titulo: 'Comparar tribunais',
      texto: 'Compare o entendimento do TRF4 e do TRF3 sobre ' },
    { titulo: 'Verificar julgado',
      texto: 'Verifique se existe mesmo o julgado ' },
    { titulo: 'Precedentes por período',
      texto: 'Levante acórdãos do TJPR entre 01/01/2024 e 31/12/2024 sobre ' },
  ];

  const ROTULO = {
    ok: 'funcionando',
    instavel: 'com ressalva',
    'sem-acesso': 'bloqueado',
    'exige-sessao': 'exige sua sessão',
  };

  function montarPrompts() {
    const alvo = $('#prompts');
    alvo.innerHTML = '<p class="titulo-bloco">Comece por aqui</p>';
    const grade = document.createElement('div');
    grade.className = 'grade-prompts';
    for (const p of PROMPTS) {
      const b = document.createElement('button');
      b.className = 'cartao-prompt';
      b.type = 'button';
      b.textContent = p.titulo;
      b.addEventListener('click', () => window.jurUI.preencherEntrada(p.texto));
      grade.appendChild(b);
    }
    alvo.appendChild(grade);
  }

  function montarManual() {
    const alvo = $('#manual');
    alvo.innerHTML = `
      <details class="manual">
        <summary>Como usar</summary>
        <div class="manual-corpo"></div>
      </details>`;
    const corpo = $('.manual-corpo', alvo);
    const paragrafos = [
      ['O que é', 'Busca de jurisprudência em 75 acervos de tribunais brasileiros. Você pergunta em português; o assistente escolhe o tribunal, executa a busca na base oficial e resume o que encontrou.'],
      ['Como pedir', 'Diga o tribunal, o tema e, se importar, o período. "Acórdãos do TRF4 sobre auxílio-acidente em 2024" funciona melhor que "previdenciário".'],
      ['Nada é citado sem verificação', 'Todo julgado citado veio de uma consulta à base oficial do tribunal, não da memória do modelo.'],
      ['Zero resultado não é ausência', 'Vários acervos têm recorte de período ou de matéria. Quando uma busca volta vazia, a ressalva do tribunal vem junto — leia antes de concluir que não existe jurisprudência sobre o tema.'],
      ['Busca que falha é diferente de busca vazia', 'Se o crawler não completar, o assistente diz isso explicitamente em vez de reportar "não encontrei nada".'],
    ];
    for (const [titulo, texto] of paragrafos) {
      const h = document.createElement('h3'); h.textContent = titulo;
      const p = document.createElement('p'); p.textContent = texto;
      corpo.appendChild(h); corpo.appendChild(p);
    }
    const estados = document.createElement('h3'); estados.textContent = 'Os quatro estados';
    corpo.appendChild(estados);
    const ul = document.createElement('ul');
    for (const [estado, rotulo] of Object.entries(ROTULO)) {
      const li = document.createElement('li');
      const ponto = document.createElement('span');
      ponto.className = 'ponto'; ponto.dataset.e = estado;
      li.appendChild(ponto);
      li.appendChild(document.createTextNode(` ${estado} — ${rotulo}`));
      ul.appendChild(li);
    }
    corpo.appendChild(ul);
  }

  function abrirRessalva(t) {
    const caixa = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = `${t.comando} — ${t.nome}`;
    const estado = document.createElement('p');
    estado.className = 'estado-linha';
    const ponto = document.createElement('span');
    ponto.className = 'ponto'; ponto.dataset.e = t.estado;
    estado.appendChild(ponto);
    estado.appendChild(document.createTextNode(` ${t.estado} — ${ROTULO[t.estado] || t.estado}`));
    const nota = document.createElement('p');
    nota.className = 'nota';
    nota.textContent = t.nota || 'Sem ressalva registrada para este tribunal.';
    caixa.appendChild(h); caixa.appendChild(estado); caixa.appendChild(nota);
    window.jurUI.abrirPainel($('#painel-ressalva'), '');
    $('.painel-caixa', $('#painel-ressalva')).appendChild(caixa);
  }

  async function montarDisponibilidade() {
    const alvo = $('#disponibilidade');
    let tribunais = [];
    try {
      tribunais = (await window.jurApi.pedir('/api/v1/tribunais')).tribunais;
    } catch (e) {
      alvo.innerHTML = '<p class="titulo-bloco">Disponibilidade</p>';
      const erro = document.createElement('p');
      erro.className = 'vazio';
      erro.textContent = `Não foi possível carregar a lista de tribunais: ${e.message}`;
      alvo.appendChild(erro);
      return;
    }

    const conta = (e) => tribunais.filter((t) => t.estado === e).length;
    alvo.innerHTML = '<p class="titulo-bloco">Disponibilidade</p>';

    const placar = document.createElement('div');
    placar.className = 'placar';
    for (const estado of ['ok', 'instavel', 'sem-acesso', 'exige-sessao']) {
      const item = document.createElement('span');
      const ponto = document.createElement('span');
      ponto.className = 'ponto'; ponto.dataset.e = estado;
      item.appendChild(ponto);
      item.appendChild(document.createTextNode(` ${conta(estado)} ${ROTULO[estado]}`));
      placar.appendChild(item);
    }
    alvo.appendChild(placar);

    const grade = document.createElement('div');
    grade.className = 'grade-tribunais';
    for (const t of tribunais) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sigla';
      b.dataset.e = t.estado;
      b.textContent = t.comando;
      b.title = `${t.nome} — clique para ver detalhes`;
      b.addEventListener('click', () => abrirRessalva(t));
      grade.appendChild(b);
    }
    alvo.appendChild(grade);

    const dica = document.createElement('p');
    dica.className = 'vazio';
    dica.textContent = 'Clique numa sigla para ver o nome do tribunal e a ressalva registrada.';
    alvo.appendChild(dica);
  }

  montarPrompts();
  montarDisponibilidade();
  montarManual();
}());
```

- [ ] **Step 2: Acrescente o CSS destes blocos ao `estilo.css`**

```css
.grade-prompts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.cartao-prompt {
  padding: 12px 14px; text-align: left; font: inherit; font-size: 14px;
  background: var(--superficie); color: var(--texto);
  border: 1px solid var(--borda); border-radius: var(--raio); cursor: pointer;
}
.cartao-prompt:hover { border-color: var(--acento); }

.placar { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--fraco); margin-bottom: 12px; }
.ponto { display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: middle; }
.ponto[data-e="ok"] { background: var(--ok); }
.ponto[data-e="instavel"] { background: var(--instavel); }
.ponto[data-e="sem-acesso"] { background: var(--bloqueado); }
.ponto[data-e="exige-sessao"] { background: var(--sessao); }

.grade-tribunais { display: flex; flex-wrap: wrap; gap: 5px; }
.sigla {
  font: inherit; font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace;
  padding: 3px 8px; border-radius: 6px; cursor: pointer;
  background: var(--superficie); color: var(--texto);
  border: 1px solid var(--borda); border-left-width: 3px;
}
.sigla:hover { border-color: var(--acento); }
.sigla[data-e="ok"] { border-left-color: var(--ok); }
.sigla[data-e="instavel"] { border-left-color: var(--instavel); }
.sigla[data-e="sem-acesso"] { border-left-color: var(--bloqueado); opacity: .6; }
.sigla[data-e="exige-sessao"] { border-left-color: var(--sessao); }

.manual summary { cursor: pointer; font-size: 13px; color: var(--fraco); font-weight: 600; }
.manual-corpo h3 { font-size: 14px; margin: 16px 0 4px; }
.manual-corpo p { margin: 0; font-size: 14px; color: var(--fraco); }
.manual-corpo ul { padding-left: 18px; font-size: 14px; color: var(--fraco); }
.estado-linha { font-size: 13px; color: var(--fraco); }
.painel .nota { white-space: pre-wrap; font-size: 14px; line-height: 1.65; }
```

- [ ] **Step 3: Confira na tela**

Com o servidor no ar, na tela inicial:
1. quatro cartões de prompt; clicar preenche a caixa de mensagem;
2. bloco **Disponibilidade** com o placar (67 ok · 3 com ressalva · 4 bloqueados · 1 exige sessão) e a grade de 75 siglas;
3. **clicar em `trf1` abre o painel com a ressalva completa** — inclusive "A BASE CONGELOU EM 31/07/2025";
4. clicar em `tcu` (sem nota) mostra "Sem ressalva registrada para este tribunal";
5. `Esc` e clique fora fecham o painel;
6. **abrir uma conversa esconde** Disponibilidade, prompts e manual.

- [ ] **Step 4: Commit**

```bash
git add jur/publico/disponibilidade.js jur/publico/estilo.css
git commit -m "poe a disponibilidade abaixo do chat com a ressalva a um clique, mais modelos de prompt e manual"
```

---

### Task 9: painel de configuração — chave da LLM e chaves de conexão

**Files:**
- Create: `jur/publico/config.js`

**Interfaces:**
- Consumes: `POST/GET/DELETE /api/v1/chaves`, `window.jurUI.abrirPainel`
- Produces: nada consumido por outra task

**A distinção precisa ficar óbvia na tela.** São duas coisas opostas: a **chave da LLM** é sua, você cola, e ela nunca sai do seu browser. A **chave de conexão** é emitida pelo jur, você copia, e serve para outro programa falar com o jur.

- [ ] **Step 1: Escreva `config.js`**

```js
// jur/publico/config.js
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);
  const CHAVE_LLM = 'jur.chaveLlm';

  const guardado = {
    ler(k, padrao = '') { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } },
    escrever(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  };

  function quando(ms) {
    if (!ms) return 'nunca';
    return new Date(ms).toLocaleString('pt-BR');
  }

  async function listarChaves(alvo) {
    alvo.innerHTML = '';
    let chaves = [];
    try {
      chaves = (await window.jurApi.pedir('/api/v1/chaves')).chaves;
    } catch (e) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = `Não foi possível listar: ${e.message}`;
      alvo.appendChild(p);
      return;
    }
    const vivas = chaves.filter((c) => !c.revogadoEm);
    if (!vivas.length) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = 'Nenhuma chave de conexão ativa.';
      alvo.appendChild(p);
      return;
    }
    for (const c of vivas) {
      const linha = document.createElement('div');
      linha.className = 'chave-linha';
      const info = document.createElement('div');
      const nome = document.createElement('strong');
      nome.textContent = c.nome;
      const detalhe = document.createElement('small');
      detalhe.textContent = `${c.prefixo}… · criada ${quando(c.criadoEm)} · último uso ${quando(c.ultimoUsoEm)}`;
      info.appendChild(nome); info.appendChild(document.createElement('br')); info.appendChild(detalhe);
      const revogar = document.createElement('button');
      revogar.className = 'revogar';
      revogar.textContent = 'Revogar';
      revogar.addEventListener('click', async () => {
        await window.jurApi.pedir(`/api/v1/chaves/${c.id}`, { method: 'DELETE' });
        listarChaves(alvo);
      });
      linha.appendChild(info); linha.appendChild(revogar);
      alvo.appendChild(linha);
    }
  }

  function abrir() {
    const painel = window.jurUI.abrirPainel($('#painel-config'), '');
    const caixa = $('.painel-caixa', painel);

    const h = document.createElement('h2');
    h.textContent = 'Configurações';
    caixa.appendChild(h);

    // --- chave da LLM ---
    const s1 = document.createElement('section');
    s1.className = 'secao-config';
    const t1 = document.createElement('h3');
    t1.textContent = 'Chave da LLM';
    const d1 = document.createElement('p');
    d1.className = 'vazio';
    d1.textContent = 'A sua chave da Anthropic, que o jur usa para conversar. Fica só neste browser e nunca é guardada no servidor.';
    const campo = document.createElement('input');
    campo.type = 'password';
    campo.className = 'campo';
    campo.placeholder = 'sk-ant-…';
    campo.value = guardado.ler(CHAVE_LLM);
    campo.addEventListener('change', () => guardado.escrever(CHAVE_LLM, campo.value.trim()));
    s1.appendChild(t1); s1.appendChild(d1); s1.appendChild(campo);
    caixa.appendChild(s1);

    // --- chaves de conexão ---
    const s2 = document.createElement('section');
    s2.className = 'secao-config';
    const t2 = document.createElement('h3');
    t2.textContent = 'Chaves de conexão';
    const d2 = document.createElement('p');
    d2.className = 'vazio';
    d2.textContent = 'Emitidas pelo jur, para outro programa (Claude Code, cliente MCP, script) falar com esta API. O valor aparece uma única vez.';
    s2.appendChild(t2); s2.appendChild(d2);

    const form = document.createElement('form');
    form.className = 'form-chave';
    const nome = document.createElement('input');
    nome.className = 'campo';
    nome.placeholder = 'Para que serve esta chave? (ex.: claude code)';
    const gerar = document.createElement('button');
    gerar.type = 'submit';
    gerar.className = 'botao-acento';
    gerar.textContent = 'Gerar chave';
    form.appendChild(nome); form.appendChild(gerar);

    const lista = document.createElement('div');
    lista.className = 'lista-chaves';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      gerar.disabled = true;
      try {
        const nova = await window.jurApi.pedir('/api/v1/chaves', {
          method: 'POST', body: JSON.stringify({ nome: nome.value.trim() }),
        });
        nome.value = '';
        const aviso = document.createElement('div');
        aviso.className = 'chave-nova';
        const p = document.createElement('p');
        p.textContent = 'Copie agora — este valor não será exibido de novo:';
        const codigo = document.createElement('code');
        codigo.textContent = nova.valor;
        const copiar = document.createElement('button');
        copiar.className = 'botao-acento';
        copiar.textContent = 'Copiar';
        copiar.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(nova.valor); copiar.textContent = 'Copiado'; }
          catch { copiar.textContent = 'Copie manualmente'; }
        });
        aviso.appendChild(p); aviso.appendChild(codigo); aviso.appendChild(copiar);
        s2.insertBefore(aviso, lista);
        listarChaves(lista);
      } catch (err) {
        const erro = document.createElement('p');
        erro.className = 'vazio';
        erro.textContent = err.message;
        s2.insertBefore(erro, lista);
      } finally {
        gerar.disabled = false;
      }
    });

    s2.appendChild(form);
    s2.appendChild(lista);
    caixa.appendChild(s2);

    // --- como conectar ---
    const s3 = document.createElement('section');
    s3.className = 'secao-config';
    const t3 = document.createElement('h3');
    t3.textContent = 'Como conectar';
    const pre = document.createElement('pre');
    pre.className = 'exemplo';
    pre.textContent = [
      '# MCP no Claude Code',
      'claude mcp add --transport http jur http://localhost:3000/mcp \\',
      '  --header "Authorization: Bearer SUA_CHAVE"',
      '',
      '# REST',
      'curl -X POST localhost:3000/api/v1/buscas \\',
      '  -H "Authorization: Bearer SUA_CHAVE" \\',
      '  -H "content-type: application/json" \\',
      '  -d \'{"tribunal":"trf4","query":"auxilio-acidente"}\'',
      '',
      '# Documentação completa: http://localhost:3000/docs',
    ].join('\n');
    s3.appendChild(t3); s3.appendChild(pre);
    caixa.appendChild(s3);

    listarChaves(lista);
  }

  $('#abrir-config').addEventListener('click', abrir);
}());
```

- [ ] **Step 2: Acrescente o CSS ao `estilo.css`**

```css
.secao-config { margin-top: 22px; }
.secao-config h3 { margin: 0 0 4px; font-size: 15px; }
.campo {
  width: 100%; padding: 9px 11px; margin-top: 8px;
  background: var(--fundo); color: var(--texto);
  border: 1px solid var(--borda); border-radius: 9px; font: inherit;
}
.campo:focus { outline: none; border-color: var(--acento); }
.form-chave { display: flex; gap: 8px; align-items: flex-end; margin-top: 8px; }
.form-chave .campo { margin-top: 0; }
.botao-acento {
  padding: 9px 14px; border: 0; border-radius: 9px; white-space: nowrap;
  background: var(--acento); color: #fff; font: inherit; font-weight: 500; cursor: pointer;
}
.botao-acento:disabled { opacity: .5; cursor: default; }
.chave-nova {
  margin-top: 12px; padding: 12px; border-radius: var(--raio);
  background: var(--fundo); border: 1px solid var(--acento);
}
.chave-nova p { margin: 0 0 6px; font-size: 13px; }
.chave-nova code {
  display: block; word-break: break-all; font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, monospace; margin-bottom: 8px;
}
.lista-chaves { margin-top: 12px; }
.chave-linha {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 0; border-top: 1px solid var(--borda); font-size: 14px;
}
.chave-linha small { color: var(--fraco); font-size: 12px; }
.revogar {
  background: none; border: 1px solid var(--borda); border-radius: 8px;
  padding: 5px 10px; color: var(--fraco); font: inherit; font-size: 13px; cursor: pointer;
}
.revogar:hover { border-color: #B3261E; color: #B3261E; }
.exemplo {
  background: var(--fundo); border: 1px solid var(--borda); border-radius: var(--raio);
  padding: 12px; overflow-x: auto; font-size: 12.5px; line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
```

- [ ] **Step 3: Confira na tela**

Suba **com a exigência de chave ligada** (o padrão) e verifique:
1. o rodapé da lateral abre o painel;
2. as duas seções deixam claro qual chave é sua e qual é emitida;
3. gerar chave mostra o valor **uma vez**, com botão de copiar; recarregar o painel não mostra mais o valor, só o prefixo;
4. revogar tira da lista, e a chave revogada para de autenticar (teste com `curl`);
5. colar a chave da LLM e mandar uma mensagem no chat funciona;
6. o bloco "Como conectar" traz os comandos certos.

- [ ] **Step 4: Rode a suíte inteira e o compose**

Run: `cd jur && npm test`
Expected: PASS

```bash
cd infra && docker compose up -d --build && sleep 20 && docker compose ps
```
Abra `http://localhost:3000` e repita a verificação da Task 8 e desta dentro do container.

- [ ] **Step 5: Atualize o README**

Na seção "Rodar em container", acrescente: que a API exige `Authorization: Bearer <chave>` (gerada na interface, em Configurações), que `JUR_EXIGIR_CHAVE=0` desliga para desenvolvimento, e que a documentação completa está em `/docs`. Corrija o exemplo de `curl` para incluir o cabeçalho.

- [ ] **Step 6: Commit**

```bash
git add jur/publico/config.js jur/publico/estilo.css README.md
git commit -m "poe no rodape da lateral a chave da LLM que fica no browser e o gerador de chave de conexao que fica no servidor"
```
