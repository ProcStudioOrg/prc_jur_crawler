# Dockerização do `jur` + frontend local, API HTTP e MCP — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empacotar o crawler `jur` num container com Chromium embutido e expor três superfícies sobre um núcleo único — API HTTP, servidor MCP e um frontend local com chat e lista de tribunais.

**Architecture:** Um único container Node 22 roda tudo. Uma camada `executor` invoca a CLI existente (`node bin/jur <cmd> --json`) como **subprocesso** — a uniformidade dos tribunais só existe na CLI, não nas classes `*Crawler`. Acima dela, `catalogo` (lê o JSON de cobertura gerado), `jobs` (fila com concorrência 3, SQLite) e três superfícies finas que só conhecem `jobs`+`catalogo`.

**Tech Stack:** Node 22 (CommonJS) · `node:sqlite` embutido · `node:http` embutido · `node:test` · Playwright 1.62 (chromium) · `@anthropic-ai/sdk` · HTML/JS puro sem build.

**Spec:** `docs/superpowers/specs/2026-08-22-dockerizacao-e-frontend-design.md` — leia antes de começar. O plano argumenta a partir dele.

## Global Constraints

- **Node >= 22.** `node:sqlite` é usado sem flag; `engines` do repo é `>=20` e continua satisfeito. Imagem: `node:22-slim`.
- **CommonJS.** O repo inteiro usa `require`/`module.exports`. Nada de `import`, nada de `.mjs`.
- **Testes com `node:test` + `node:assert`**, estilo `describe`/`it`, como `jur/tests/inteiroTeorFetcher.test.js`. Rodam com `npm test` (`node --test "tests/*.test.js"`).
- **Model id da Anthropic: `claude-opus-5`.** Exatamente essa string, sem sufixo de data. Não trocar por sonnet/haiku.
- **`max_tokens: 64000`** nas chamadas em streaming.
- **Nunca usar `budget_tokens`** — foi removido e devolve 400. Thinking adaptativo é o default do Opus 5.
- **Nunca usar prefill de assistant** — devolve 400.
- **Nada acima de `executor.js` monta linha de comando.** Nenhum outro arquivo faz `spawn` nem conhece flags da CLI.
- **Só o denominador comum de filtros:** `query`, `dataInicio`, `dataFim`, `maxPaginas`, `numero`. **Nunca** repassar `orgao` — o mesmo nome significa *órgão julgador* nos tribunais judiciais e *órgão fiscalizado* nos TCEs (spec §2.4).
- **Parâmetros vêm de allowlist**, nunca de repasse livre do usuário para a linha de comando.
- **Português nos identificadores de domínio** (`buscar`, `resultados`, `tribunais`), como o resto do repo.
- Todos os caminhos abaixo são relativos à raiz do repo (`prc_jur_crawler/`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `jur/servidor/catalogo.js` | lê `cobertura/tribunais.json`; lista/filtra tribunais e seus estados |
| `jur/servidor/executor.js` | **único** que conhece a CLI: monta args, `spawn`, timeout, kill, normaliza saída |
| `jur/servidor/db.js` | abre o SQLite, cria schema, expõe o handle |
| `jur/servidor/jobs.js` | fila, concorrência, ciclo de vida, eventos de progresso |
| `jur/servidor/http.js` | roteador mínimo + helpers (`json`, `sse`, estáticos) |
| `jur/servidor/rotas/tribunais.js` | `GET /api/v1/tribunais`, `GET /api/v1/saude` |
| `jur/servidor/rotas/buscas.js` | CRUD de buscas + SSE de progresso |
| `jur/servidor/ferramentas.js` | as 3 tools (schema + implementação), compartilhadas por chat e MCP |
| `jur/servidor/llm.js` | loop de tool-use em streaming contra a API da Anthropic |
| `jur/servidor/rotas/chat.js` | `POST /api/v1/chat` (SSE) |
| `jur/servidor/mcp.js` | endpoint JSON-RPC do MCP sobre `ferramentas.js` |
| `jur/servidor/index.js` | bootstrap: monta rotas, sobe o worker, escuta |
| `jur/publico/{index.html,app.js,estilo.css}` | frontend skeleton |
| `infra/{Dockerfile,compose.yml,chrome-seccomp.json}` | a imagem e o compose |

---

### Task 1: `catalogo.js` — tribunais e seus estados

**Files:**
- Create: `jur/servidor/catalogo.js`
- Test: `jur/tests/catalogo.test.js`

**Interfaces:**
- Consumes: `jur/cobertura/tribunais.json` (já existe, gerado por `cobertura/build.js`)
- Produces:
  - `listar(filtros?) -> Tribunal[]` onde `filtros` é `{segmento?, uf?, estado?}`
  - `obter(comando) -> Tribunal | null`
  - `ESTADOS = ['ok','instavel','sem-acesso','exige-sessao']`
  - `Tribunal = {comando, codigo, nome, segmento, uf: string[], estado, acesso, nota, disponivel: boolean}`
  - `disponivel` é `true` para `ok` e `instavel`; `false` para `sem-acesso` e `exige-sessao`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/catalogo.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

describe('catalogo', () => {
  it('lista tribunais com os campos do contrato', () => {
    const todos = catalogo.listar();
    assert.ok(todos.length > 60, `esperava >60 tribunais, veio ${todos.length}`);
    const stf = todos.find((t) => t.comando === 'stf');
    assert.ok(stf, 'stf deve estar no catalogo');
    assert.strictEqual(stf.codigo, 'STF');
    assert.strictEqual(stf.estado, 'ok');
    assert.strictEqual(stf.disponivel, true);
    assert.ok(typeof stf.nome === 'string' && stf.nome.length > 0);
    assert.ok(Array.isArray(stf.uf));
  });

  it('marca tribunal bloqueado como indisponivel', () => {
    const stj = catalogo.obter('stj');
    assert.strictEqual(stj.estado, 'sem-acesso');
    assert.strictEqual(stj.disponivel, false);
  });

  it('trata instavel como disponivel, mas preserva a nota', () => {
    const trf1 = catalogo.obter('trf1');
    assert.strictEqual(trf1.estado, 'instavel');
    assert.strictEqual(trf1.disponivel, true);
    assert.ok(trf1.nota.length > 0, 'instavel sem nota e inutil para o usuario');
  });

  it('filtra por segmento e por uf', () => {
    const superiores = catalogo.listar({ segmento: 'superior' });
    assert.ok(superiores.every((t) => t.segmento === 'superior'));
    assert.ok(superiores.length >= 2);

    const doParana = catalogo.listar({ uf: 'PR' });
    assert.ok(doParana.some((t) => t.comando === 'tjpr'));
  });

  it('obter devolve null para comando desconhecido', () => {
    assert.strictEqual(catalogo.obter('tjxx'), null);
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `cd jur && node --test tests/catalogo.test.js`
Expected: FAIL — `Cannot find module '../servidor/catalogo'`

- [ ] **Step 3: Implemente**

```js
// jur/servidor/catalogo.js
const path = require('node:path');

const FONTE = path.join(__dirname, '..', 'cobertura', 'tribunais.json');
const ESTADOS = ['ok', 'instavel', 'sem-acesso', 'exige-sessao'];
const DISPONIVEIS = new Set(['ok', 'instavel']);

function carregar() {
  // require cacheia: o catalogo e estatico durante a vida do processo.
  const bruto = require(FONTE);
  return bruto.tribunais
    .filter((t) => t.jurisprudencia && t.jurisprudencia.comando)
    .map((t) => {
      const j = t.jurisprudencia;
      const estado = ESTADOS.includes(j.status) ? j.status : 'sem-acesso';
      return {
        comando: j.comando,
        codigo: t.codigo,
        nome: t.nome,
        segmento: t.segmento || null,
        uf: Array.isArray(t.uf) ? t.uf : [],
        estado,
        acesso: j.acesso || null,
        nota: j.nota || '',
        disponivel: DISPONIVEIS.has(estado),
      };
    });
}

let cache = null;
function todos() {
  if (!cache) cache = carregar();
  return cache;
}

function listar(filtros = {}) {
  return todos().filter((t) => {
    if (filtros.segmento && t.segmento !== filtros.segmento) return false;
    if (filtros.estado && t.estado !== filtros.estado) return false;
    if (filtros.uf && !t.uf.includes(filtros.uf)) return false;
    return true;
  });
}

function obter(comando) {
  return todos().find((t) => t.comando === comando) || null;
}

module.exports = { listar, obter, ESTADOS };
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `cd jur && node --test tests/catalogo.test.js`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/catalogo.js jur/tests/catalogo.test.js
git commit -m "le o catalogo de tribunais como dado, com os quatro estados e o disponivel derivado"
```

---

### Task 2: catálogo íntegro — CSJT, CRPS e o teste de reconciliação

Fecha [BRU-69](https://linear.app/brunopellizzetti/issue/BRU-69). Hoje a CLI tem **75** subcomandos e o catálogo **73**: falta `csjt` (bug — acervo funcional invisível) e `crps` (que deve entrar como `exige-sessao`).

**Files:**
- Modify: `jur/cobertura/build.js` (tabela `JURIS`)
- Modify: `jur/tests/smoke.js` (adicionar a checagem)
- Create: `jur/tests/reconciliacao.test.js`
- Regenerate: `jur/cobertura/tribunais.json`, `jur/cobertura/CLAUDE-COBERTURA.md`

**Interfaces:**
- Consumes: `catalogo.listar()` da Task 1
- Produces: `comandosDaCli() -> string[]` exportado de `jur/tests/reconciliacao.test.js`? **Não** — exporte de `jur/servidor/catalogo.js` uma função nova `comandosDaCli()` para que o teste e o MCP usem a mesma fonte.

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/reconciliacao.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

// O crps existe na CLI mas NAO e comando de busca (e --login/--status/--capturar).
const FORA_DE_BUSCA = new Set(['crps']);

describe('reconciliacao catalogo x CLI', () => {
  it('todo comando de busca da CLI esta no catalogo', () => {
    const naCli = catalogo.comandosDaCli().filter((c) => !FORA_DE_BUSCA.has(c));
    const noCatalogo = new Set(catalogo.listar().map((t) => t.comando));
    const faltando = naCli.filter((c) => !noCatalogo.has(c));
    assert.deepStrictEqual(faltando, [], `comandos da CLI ausentes do catalogo: ${faltando.join(', ')}`);
  });

  it('todo comando do catalogo existe na CLI', () => {
    const naCli = new Set(catalogo.comandosDaCli());
    const sobrando = catalogo.listar().map((t) => t.comando).filter((c) => !naCli.has(c));
    assert.deepStrictEqual(sobrando, [], `comandos do catalogo que a CLI nao roda: ${sobrando.join(', ')}`);
  });

  it('o crps esta no catalogo como exige-sessao', () => {
    const crps = catalogo.obter('crps');
    assert.ok(crps, 'crps deve existir no catalogo');
    assert.strictEqual(crps.estado, 'exige-sessao');
    assert.strictEqual(crps.disponivel, false);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/reconciliacao.test.js`
Expected: FAIL — `catalogo.comandosDaCli is not a function`

- [ ] **Step 3: Adicione `comandosDaCli()` ao catálogo**

Os 26 comandos do FALCÃO são registrados em laço (`bin/jur:3797`), então não basta ler `.command('...')` do arquivo: some `FalcaoTribunais.TRIBUNAIS`.

```js
// jur/servidor/catalogo.js — acrescente no topo:
const fs = require('node:fs');

// ...e antes do module.exports:

/**
 * Comandos que a CLI realmente registra: os estaticos, declarados com
 * .command('x'), mais os 26 do FALCAO, registrados em laco em bin/jur.
 */
function comandosDaCli() {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'bin', 'jur'), 'utf8');
  const estaticos = [...fonte.matchAll(/^\s*\.command\('([^']+)'/gm)].map((m) => m[1].split(' ')[0]);
  const falcao = Object.values(require('../src/FalcaoTribunais').TRIBUNAIS)
    .map((m) => String(m.sigla || m.codigo || '').toLowerCase())
    .filter(Boolean);
  return [...new Set([...estaticos, ...falcao])];
}

module.exports = { listar, obter, comandosDaCli, ESTADOS };
```

- [ ] **Step 4: Rode e confirme que agora falha pelo motivo certo**

Run: `cd jur && node --test tests/reconciliacao.test.js`
Expected: FAIL com `comandos da CLI ausentes do catalogo: csjt` e `crps deve existir no catalogo`

- [ ] **Step 5: Adicione CSJT e CRPS à tabela `JURIS` de `cobertura/build.js`**

Abra `jur/cobertura/build.js`, localize a tabela que mapeia sigla → `{url, comando, acesso, status, nota}` (a mesma onde está `TRF1:`). Acrescente as duas entradas, seguindo o formato exato das vizinhas:

```js
  CSJT: {
    url: 'https://jurisprudencia.jt.jus.br/',
    comando: 'csjt',
    acesso: 'api',
    status: 'ok',
    nota: 'Conselho Superior da Justica do Trabalho — orgao ADMINISTRATIVO de supervisao da JT, NAO julga reclamacao trabalhista. Acervo pequeno: acordaos 1.429 e decisoesmonocraticas 629; sentencas, recursorevista e precedentes sao estruturalmente VAZIAS (nao ha 1o grau). Numeracao CNJ propria: codigo 90 (todo o acervo e ...5.90.0000, nao ...5.00.). Servido pelo FALCAO, o mesmo indice nacional do TST e dos 24 TRTs — ver CLAUDE-FALCAO.md.',
  },
  CRPS: {
    url: 'https://jurisprudenciacrps.dataprev.gov.br/jurisprudencia',
    comando: 'crps',
    acesso: 'browser',
    status: 'exige-sessao',
    nota: 'Conselho de Recursos da Previdencia Social (contencioso administrativo do INSS). NAO ha busca funcionando: o portal exige login Gov.br, que apresenta captcha E valida o dispositivo — perfil de Chrome dedicado foi tentado em 31/07/2026 e foi RECUSADO por ser navegador desconhecido. HTTP 200 aqui e a TELA DE LOGIN, nao acesso. Os comandos existentes (--login, --status, --capturar) servem para destravar o mapeamento, nao para buscar. Ver CLAUDE-CRPS.md.',
  },
```

- [ ] **Step 6: Regenere o catálogo**

Run: `cd jur && npm run docs`
Expected: `cobertura/tribunais.json` e `cobertura/CLAUDE-COBERTURA.md` atualizados; `git diff --stat` mostra os dois arquivos.

- [ ] **Step 7: Rode a reconciliação e confirme que passa**

Run: `cd jur && node --test tests/reconciliacao.test.js`
Expected: PASS (3 testes)

- [ ] **Step 8: Ligue a reconciliação ao smoke**

Em `jur/tests/smoke.js`, antes de qualquer acesso de rede, adicione a checagem para que uma divergência de catálogo falhe cedo e barata:

```js
// no topo, junto dos outros requires
const catalogo = require('../servidor/catalogo');

// e como primeira verificacao do smoke:
{
  const FORA_DE_BUSCA = new Set(['crps']);
  const noCatalogo = new Set(catalogo.listar().map((t) => t.comando));
  const faltando = catalogo.comandosDaCli()
    .filter((c) => !FORA_DE_BUSCA.has(c) && !noCatalogo.has(c));
  if (faltando.length) {
    console.error(`FALHA: comandos da CLI ausentes do catalogo: ${faltando.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('OK  reconciliacao catalogo x CLI');
  }
}
```

- [ ] **Step 9: Rode o teste completo e o smoke**

Run: `cd jur && npm test`
Expected: PASS

Run: `cd jur && npm run smoke`
Expected: a linha `OK  reconciliacao catalogo x CLI` aparece. (O resto do smoke bate na rede; falha de tribunal ali não é regressão deste plano — registre o que falhou e siga.)

- [ ] **Step 10: Commit**

```bash
git add jur/cobertura/build.js jur/cobertura/tribunais.json jur/cobertura/CLAUDE-COBERTURA.md \
        jur/servidor/catalogo.js jur/tests/reconciliacao.test.js jur/tests/smoke.js
git commit -m "poe o CSJT no catalogo, que a CLI sabia rodar e o placar nao mostrava, e o CRPS como exige-sessao — mais o teste que teria pego os dois"
```

---

### Task 3: imagem Docker mínima — descobrir cedo se o Chromium sobe

Esta task vem **antes** do servidor de propósito: o maior risco desconhecido do projeto é o Chromium dentro do container, e descobrir isso na task 12 custaria caro. Ao fim dela, um crawler de browser real roda dentro da imagem.

**Files:**
- Create: `infra/Dockerfile`
- Create: `infra/README.md`
- Modify (só no caminho de fallback do Step 6): `jur/src/BaseCrawler.js:20-30`

**Interfaces:**
- Consumes: nada
- Produces: imagem `jur:dev` que roda `node bin/jur <cmd>` com Chromium funcional; `infra/README.md` registra qual nível da escada de sandbox foi necessário.

- [ ] **Step 1: Escreva o Dockerfile**

```dockerfile
# infra/Dockerfile
FROM node:22-slim

WORKDIR /app

# Dependencias primeiro: essa camada so muda quando o lock muda.
COPY jur/package.json jur/package-lock.json ./
RUN npm ci --omit=dev

# Chromium + libs do sistema. A versao vem travada pelo playwright do lock (1.62.0).
# Firefox e webkit NAO sao instalados: nenhum crawler do repo usa (so BaseCrawler
# importa firefox, e nenhum passa browserType:'firefox').
RUN npx playwright install --with-deps chromium

COPY jur/ ./

# O STFNavigator cacheia o cookie aws-waf-token em os.tmpdir() e ele vale ~4 dias.
# Sem apontar TMPDIR para um volume, todo recreate refaz o desafio do WAF (que
# custa um Chromium de partida). Ver CLAUDE-STF.md e STFNavigator.js:43.
ENV TMPDIR=/cache
RUN mkdir -p /cache /dados/resultados && chown -R node:node /cache /dados

# Chromium recusa rodar como root sem --no-sandbox. Usuario nao-root e o que
# permite manter o sandbox do proprio browser ligado.
USER node

EXPOSE 3000
CMD ["node", "servidor/index.js"]
```

- [ ] **Step 2: Construa a imagem**

Run: `docker build -f infra/Dockerfile -t jur:dev .`
Expected: build conclui. (Demora: o `playwright install` baixa ~150 MB.)

- [ ] **Step 3: Confirme que a CLI roda dentro da imagem**

Run: `docker run --rm jur:dev node bin/jur --help`
Expected: a lista de subcomandos do `jur` aparece. Isso prova Node + deps, sem tocar browser.

- [ ] **Step 4: Confirme que um tribunal SEM browser funciona**

`tcepe` é `acesso: api` — não abre Chromium. Serve para separar "problema de rede" de "problema de browser".

Run: `docker run --rm jur:dev node bin/jur tcepe -q "licitacao" -m 1 --json`
Expected: uma linha JSON com `"success":true`. Se vier `success:false` com erro de rede, o problema é conectividade do container, não o plano — resolva antes de seguir.

- [ ] **Step 5: Confirme que um tribunal COM browser funciona**

`tcu` é `acesso: browser` e está `ok` — é o teste de verdade.

Run: `docker run --rm jur:dev node bin/jur tcu -q "licitacao" -m 1 --json`
Expected (caminho feliz): `"success":true`. **Se passar, pule os Steps 6 e 7** e anote no Step 8 que o nível 1 bastou.

- [ ] **Step 6: SÓ SE o Step 5 falhou com erro de sandbox** — nível 2: perfil seccomp

Sintoma que caracteriza este caso: a saída contém `Failed to move to new namespace`, `clone()`, `No usable sandbox!` ou `Operation not permitted`.

Baixe o perfil que a Playwright publica e rode com ele:

```bash
curl -fsSL https://raw.githubusercontent.com/microsoft/playwright/main/utils/docker/seccomp_profile.json \
  -o infra/chrome-seccomp.json
docker run --rm --security-opt seccomp=infra/chrome-seccomp.json \
  jur:dev node bin/jur tcu -q "licitacao" -m 1 --json
```

Expected: `"success":true`. Se passar, anote nível 2 no Step 8 — e o `compose.yml` da Task 13 precisará de `security_opt`.

- [ ] **Step 7: SÓ SE o Step 6 também falhou** — nível 3: `--no-sandbox` por variável de ambiente

Este é o último recurso: desliga o sandbox do Chromium, que é a barreira do processo que abre HTML de sites hostis. Só chegue aqui se 1 e 2 falharam.

Em `jur/src/BaseCrawler.js`, dentro de `init()`, logo depois de `const defaultArgs = ...`, acrescente:

```js
    // Args extras vindos do ambiente (ex.: --no-sandbox em container sem
    // perfil seccomp). Separados por espaco. Vazio por padrao.
    const argsDoAmbiente = (process.env.JUR_BROWSER_ARGS || '')
      .split(' ')
      .map((a) => a.trim())
      .filter(Boolean);
```

e troque a montagem de `args` para incluí-los:

```js
      args: [...defaultArgs, ...argsDoAmbiente, ...this.extraArgs],
```

Run: `docker run --rm -e JUR_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage" jur:dev node bin/jur tcu -q "licitacao" -m 1 --json`
Expected: `"success":true`.

- [ ] **Step 8: Registre o resultado**

Crie `infra/README.md` com exatamente o que foi observado — este arquivo é o que evita a próxima pessoa repetir a escada:

```markdown
# infra — imagem e execução do `jur`

## Imagem

`node:22-slim` + `playwright install --with-deps chromium`. Firefox e webkit não são
instalados: nenhum crawler do repo os usa.

`TMPDIR=/cache` existe por causa do STF — `STFNavigator.js:43` cacheia o cookie
`aws-waf-token` em `os.tmpdir()`, e ele vale ~4 dias. Sem volume em `/cache`, todo
recreate refaz o desafio do WAF.

## Sandbox do Chromium

Escada testada em <DATA>, nesta ordem:

| Nível | Como | Resultado |
|---|---|---|
| 1 — usuário não-root, seccomp padrão | `docker run jur:dev` | <PREENCHER: passou / falhou com ...> |
| 2 — perfil seccomp da Playwright | `--security-opt seccomp=infra/chrome-seccomp.json` | <PREENCHER> |
| 3 — `--no-sandbox` | `-e JUR_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage"` | <PREENCHER> |

**Nível em uso: <N>.** Motivo: <...>

## Tribunais não suportados em container

- **`trf3`** — `TRF3Crawler.js:10` passa `useSystemChrome: true`, que vira `channel: 'chrome'`
  e exige o Google Chrome proprietário, ausente da imagem. Já estava `instavel`.
- **`crps`** — exige login Gov.br com validação de dispositivo; container é, por definição,
  dispositivo desconhecido. Ver `CLAUDE-CRPS.md`.

## Comandos

    docker build -f infra/Dockerfile -t jur:dev .
    docker run --rm jur:dev node bin/jur tcu -q "licitacao" -m 1 --json
```

Substitua todos os `<PREENCHER>`, `<DATA>` e `<N>` pelo que você observou. **Não deixe placeholder.**

- [ ] **Step 9: Commit**

```bash
git add infra/Dockerfile infra/README.md
# inclua os dois abaixo apenas se os Steps 6/7 foram necessarios:
# git add infra/chrome-seccomp.json jur/src/BaseCrawler.js
git commit -m "empacota o jur com o chromium travado pelo lock e descobre em qual nivel de sandbox o container aguenta rodar um crawler de browser"
```

---

### Task 4: `executor.js` — o único que conhece a CLI

**Files:**
- Create: `jur/servidor/executor.js`
- Create: `jur/tests/executor.test.js`
- Create: `jur/tests/fixtures/cli-falsa.js`

**Interfaces:**
- Consumes: nada dos anteriores
- Produces:
  - `async executar(comando, params, opcoes) -> Resultado`
  - `params = {query?, dataInicio?, dataFim?, maxPaginas?, numero?}` — **allowlist fechada**, qualquer outra chave é ignorada
  - `opcoes = {arquivoSaida, timeoutMs?, aoIniciar?}` — `aoIniciar(pid)` é chamado com o PID assim que o processo nasce
  - `Resultado = {ok: boolean, total: number, resultados: object[], arquivo: string|null, erro: string|null, codigoSaida: number|null}`
  - `PARAMS_ACEITOS` — array com as chaves da allowlist

- [ ] **Step 1: Escreva a CLI falsa que os testes usam**

Testar contra tribunais de verdade seria lento e instável. Esta fixture imita os dois formatos de saída reais da CLI.

```js
// jur/tests/fixtures/cli-falsa.js
// Imita `bin/jur <cmd> --json`. Modo escolhido pelo primeiro argumento.
const fs = require('node:fs');

const modo = process.argv[2];
const args = process.argv.slice(3);
const saida = args[args.indexOf('-o') + 1];

if (modo === 'inline') {
  // Formato dominante: 45 subcomandos devolvem os resultados no envelope.
  const resultados = [{ processo: '1', ementa: 'a' }, { processo: '2', ementa: 'b' }];
  fs.writeFileSync(saida, JSON.stringify(resultados));
  process.stdout.write(JSON.stringify({ success: true, count: 2, results: resultados }) + '\n');
} else if (modo === 'arquivo') {
  // Formato dos outros 5: so o caminho volta; os dados estao no disco.
  fs.writeFileSync(saida, JSON.stringify([{ processo: '9', ementa: 'z' }]));
  process.stdout.write(JSON.stringify({ success: true, count: 1, output: saida }) + '\n');
} else if (modo === 'erro') {
  process.stdout.write(JSON.stringify({ success: false, error: 'tribunal fora do ar' }) + '\n');
  process.exit(1);
} else if (modo === 'ruido') {
  // Aviso antes do JSON: o executor deve ler a ULTIMA linha, nao a primeira.
  process.stdout.write('aviso: base congelada\n');
  fs.writeFileSync(saida, JSON.stringify([{ processo: '3' }]));
  process.stdout.write(JSON.stringify({ success: true, count: 1 }) + '\n');
} else if (modo === 'travado') {
  setInterval(() => {}, 1000); // nunca termina: exercita o timeout
} else if (modo === 'eco') {
  process.stdout.write(JSON.stringify({ success: true, args }) + '\n');
}
```

- [ ] **Step 2: Escreva o teste que falha**

```js
// jur/tests/executor.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const executor = require('../servidor/executor');

const CLI_FALSA = path.join(__dirname, 'fixtures', 'cli-falsa.js');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-exec-')), 'r.json');

describe('executor', () => {
  it('le resultados do arquivo quando a saida e inline', async () => {
    const arquivo = tmp();
    const r = await executor.executar('inline', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.resultados.length, 2);
    assert.strictEqual(r.resultados[0].processo, '1');
  });

  it('le resultados do arquivo quando a saida e so o caminho', async () => {
    const arquivo = tmp();
    const r = await executar_(arquivo, 'arquivo');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.resultados[0].processo, '9');
  });

  it('propaga falha do crawler sem confundir com zero resultados', async () => {
    const r = await executar_(tmp(), 'erro');
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /fora do ar/);
    assert.strictEqual(r.total, 0);
  });

  it('ignora ruido antes do JSON e usa a ultima linha', async () => {
    const r = await executar_(tmp(), 'ruido');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.total, 1);
  });

  it('mata o processo no timeout e reporta erro, nao sucesso vazio', async () => {
    const r = await executar_(tmp(), 'travado', { timeoutMs: 300 });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /timeout/i);
  });

  it('so repassa flags da allowlist, e nunca orgao', async () => {
    const r = await executar_(tmp(), 'eco', {}, {
      query: 'aposentadoria',
      dataInicio: '01/01/2024',
      maxPaginas: 3,
      orgao: 'PRIMEIRA TURMA',      // deve ser IGNORADO (colisao semantica)
      extra: '--rm -rf',             // deve ser IGNORADO
    });
    const args = r.envelope.args;
    assert.ok(args.includes('-q') && args.includes('aposentadoria'));
    assert.ok(args.includes('-di') && args.includes('01/01/2024'));
    assert.ok(args.includes('-m') && args.includes('3'));
    assert.ok(!args.includes('--orgao'), 'orgao jamais pode ser repassado');
    assert.ok(!args.includes('PRIMEIRA TURMA'), 'o VALOR de orgao tambem nao pode vazar');
    assert.ok(!args.includes('--extra') && !args.includes('--rm -rf'),
      'chave fora da allowlist nao pode virar argumento');
  });

  it('informa o pid assim que o processo nasce', async () => {
    let visto = null;
    await executor.executar('inline', { query: 'x' },
      { arquivoSaida: tmp(), cliPath: CLI_FALSA, aoIniciar: (pid) => { visto = pid; } });
    assert.strictEqual(typeof visto, 'number');
    assert.ok(visto > 0);
  });

  function executar_(arquivo, modo, extras = {}, params = { query: 'x' }) {
    return executor.executar(modo, params, { arquivoSaida: arquivo, cliPath: CLI_FALSA, ...extras });
  }
});
```

- [ ] **Step 3: Rode e confirme que falha**

Run: `cd jur && node --test tests/executor.test.js`
Expected: FAIL — `Cannot find module '../servidor/executor'`

- [ ] **Step 4: Implemente**

```js
// jur/servidor/executor.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLI_PADRAO = path.join(__dirname, '..', 'bin', 'jur');
const TIMEOUT_PADRAO = 10 * 60 * 1000;

/**
 * Allowlist fechada. Só o denominador comum verificado da CLI entra aqui.
 * `orgao` esta DELIBERADAMENTE fora: o mesmo nome significa orgao JULGADOR
 * nos tribunais judiciais e orgao FISCALIZADO nos TCEs, entao um mapeamento
 * unico buscaria no campo errado e devolveria zero — que se le como
 * "nao ha julgado". Ver o spec, secao 2.4.
 */
const PARAMS_ACEITOS = ['query', 'dataInicio', 'dataFim', 'maxPaginas', 'numero'];

const BANDEIRA = {
  query: '-q',
  dataInicio: '-di',
  dataFim: '-df',
  maxPaginas: '-m',
  numero: '-n',
};

function montarArgs(cliPath, comando, params, arquivoSaida) {
  const args = [cliPath, comando, '--json', '-o', arquivoSaida];
  for (const chave of PARAMS_ACEITOS) {
    const valor = params[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    args.push(BANDEIRA[chave], String(valor));
  }
  return args;
}

/** A CLI pode imprimir aviso antes do JSON: vale a ultima linha que parseia. */
function ultimoJson(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(linhas[i]);
    } catch {
      /* linha de log, segue procurando */
    }
  }
  return null;
}

/**
 * Sempre passamos -o, entao o arquivo e a fonte primaria — o que contorna a
 * heterogeneidade do payload (45 subcomandos devolvem inline, 5 so o caminho).
 * O envelope so e consultado como plano B.
 */
function extrairResultados(envelope, arquivo) {
  if (arquivo && fs.existsSync(arquivo)) {
    try {
      const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      if (Array.isArray(bruto)) return bruto;
      if (Array.isArray(bruto.results)) return bruto.results;
      if (Array.isArray(bruto.resultados)) return bruto.resultados;
    } catch {
      /* arquivo ilegivel: cai no envelope */
    }
  }
  if (envelope) {
    for (const [chave, valor] of Object.entries(envelope)) {
      if (chave !== 'success' && Array.isArray(valor)) return valor;
    }
  }
  return [];
}

async function executar(comando, params = {}, opcoes = {}) {
  const cliPath = opcoes.cliPath || CLI_PADRAO;
  const arquivoSaida = opcoes.arquivoSaida;
  const timeoutMs = opcoes.timeoutMs || TIMEOUT_PADRAO;
  const args = montarArgs(cliPath, comando, params, arquivoSaida);

  return new Promise((resolve) => {
    // detached: o crawler abre Chromium filho. Sem grupo proprio, matar o node
    // deixaria o browser orfao consumindo memoria dentro do container.
    const filho = spawn(process.execPath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let saida = '';
    let erroPadrao = '';
    let expirou = false;

    if (typeof opcoes.aoIniciar === 'function') opcoes.aoIniciar(filho.pid);

    const relogio = setTimeout(() => {
      expirou = true;
      matarGrupo(filho.pid);
    }, timeoutMs);

    filho.stdout.on('data', (d) => { saida += d.toString(); });
    filho.stderr.on('data', (d) => { erroPadrao += d.toString(); });

    filho.on('error', (e) => {
      clearTimeout(relogio);
      resolve({ ok: false, total: 0, resultados: [], arquivo: null, erro: e.message, codigoSaida: null, envelope: null });
    });

    filho.on('close', (codigo) => {
      clearTimeout(relogio);

      if (expirou) {
        return resolve({
          ok: false, total: 0, resultados: [], arquivo: null,
          erro: `timeout apos ${timeoutMs}ms`, codigoSaida: codigo, envelope: null,
        });
      }

      const envelope = ultimoJson(saida);
      if (!envelope || envelope.success !== true) {
        const erro = (envelope && envelope.error) || erroPadrao.trim() || `saida sem envelope (codigo ${codigo})`;
        return resolve({ ok: false, total: 0, resultados: [], arquivo: null, erro, codigoSaida: codigo, envelope });
      }

      const resultados = extrairResultados(envelope, arquivoSaida);
      resolve({
        ok: true,
        total: typeof envelope.count === 'number' ? envelope.count : resultados.length,
        resultados,
        arquivo: arquivoSaida,
        erro: null,
        codigoSaida: codigo,
        envelope,
      });
    });
  });
}

/** Mata o grupo inteiro (node + Chromium filhos), com SIGKILL de garantia. */
function matarGrupo(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ja morreu */ }
  }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* ja morreu */ }
  }, 5000).unref();
}

module.exports = { executar, matarGrupo, PARAMS_ACEITOS };
```

- [ ] **Step 5: Rode e confirme que passa**

Run: `cd jur && node --test tests/executor.test.js`
Expected: PASS (7 testes)

- [ ] **Step 6: Escreva o teste de contrato dos 75 subcomandos**

O `executor` aposta que **todo** subcomando aceita `--json` e `-o`. Essa aposta precisa de prova, e ela não pode depender de rede. `--help` responde offline e mostra as flags declaradas.

```js
// jur/tests/contrato-cli.test.js
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const catalogo = require('../servidor/catalogo');

const CLI = path.join(__dirname, '..', 'bin', 'jur');
// O crps nao e comando de busca (--login/--status/--capturar) e nao tem -o.
// O tjrn so consulta por numero e nao pagina.
const SEM_OUTPUT = new Set(['crps']);

function ajuda(comando) {
  return execFileSync(process.execPath, [CLI, comando, '--help'], { encoding: 'utf8', timeout: 20000 });
}

describe('contrato da CLI que o executor assume', () => {
  it('todo subcomando aceita --json', () => {
    const falhas = catalogo.comandosDaCli().filter((c) => !ajuda(c).includes('--json'));
    assert.deepStrictEqual(falhas, [], `sem --json: ${falhas.join(', ')}`);
  });

  it('todo subcomando de busca aceita -o e -q', () => {
    const semSaida = [];
    const semQuery = [];
    for (const c of catalogo.comandosDaCli()) {
      if (SEM_OUTPUT.has(c)) continue;
      const texto = ajuda(c);
      if (!texto.includes('--output')) semSaida.push(c);
      if (!texto.includes('--query')) semQuery.push(c);
    }
    assert.deepStrictEqual(semSaida, [], `sem --output: ${semSaida.join(', ')}`);
    assert.deepStrictEqual(semQuery, [], `sem --query: ${semQuery.join(', ')}`);
  });
});
```

- [ ] **Step 7: Rode o contrato**

Run: `cd jur && node --test tests/contrato-cli.test.js`
Expected: PASS (2 testes). São ~75 execuções de `--help`, então leva ~15s — é o preço de provar a premissa em vez de assumi-la. Se algum subcomando aparecer na lista de falhas, **pare**: o `executor` precisa de exceção explícita para ele antes de seguir.

- [ ] **Step 8: Commit**

```bash
git add jur/servidor/executor.js jur/tests/executor.test.js jur/tests/fixtures/cli-falsa.js jur/tests/contrato-cli.test.js
git commit -m "isola a CLI atras de um executor com allowlist fechada — o orgao fica de fora de proposito, e matar o job mata o grupo para nao deixar Chromium orfao"
```

---

### Task 5: `db.js` — SQLite embutido

**Files:**
- Create: `jur/servidor/db.js`
- Create: `jur/tests/db.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `abrir(caminho) -> DatabaseSync` — cria o schema se não existir (idempotente)
  - `caminhoPadrao() -> string` — `process.env.JUR_DADOS || '/dados'` + `/jur.db`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/db.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');

const arquivoTmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jur-db-')), 'jur.db');

describe('db', () => {
  it('cria o schema e aceita um job', () => {
    const con = db.abrir(arquivoTmp());
    con.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
                 VALUES (?, ?, ?, ?, ?)`).run('j1', 'stf', '{}', 'enfileirado', Date.now());
    const linha = con.prepare('SELECT * FROM job WHERE id = ?').get('j1');
    assert.strictEqual(linha.comando, 'stf');
    assert.strictEqual(linha.status, 'enfileirado');
    assert.strictEqual(linha.total, 0);
  });

  it('e idempotente: abrir duas vezes nao apaga nada', () => {
    const arquivo = arquivoTmp();
    const a = db.abrir(arquivo);
    a.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
               VALUES ('j2','tcu','{}','concluido',1)`).run();
    a.close();
    const b = db.abrir(arquivo);
    assert.strictEqual(b.prepare('SELECT COUNT(*) c FROM job').get().c, 1);
  });

  it('guarda conversa e mensagem ligadas', () => {
    const con = db.abrir(arquivoTmp());
    con.prepare('INSERT INTO conversa (id, titulo, criado_em) VALUES (?,?,?)').run('c1', 'teste', 1);
    con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, criado_em)
                 VALUES (?,?,?,?)`).run('c1', 'user', 'ola', 2);
    assert.strictEqual(con.prepare('SELECT COUNT(*) c FROM mensagem WHERE conversa_id=?').get('c1').c, 1);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/db.test.js`
Expected: FAIL — `Cannot find module '../servidor/db'`

- [ ] **Step 3: Implemente**

```js
// jur/servidor/db.js
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS job (
  id           TEXT PRIMARY KEY,
  comando      TEXT NOT NULL,
  params_json  TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL,
  criado_em    INTEGER NOT NULL,
  iniciado_em  INTEGER,
  terminado_em INTEGER,
  pid          INTEGER,
  exit_code    INTEGER,
  erro         TEXT,
  total        INTEGER NOT NULL DEFAULT 0,
  arquivo      TEXT,
  avisos_json  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_job_status ON job (status, criado_em);

CREATE TABLE IF NOT EXISTS conversa (
  id           TEXT PRIMARY KEY,
  titulo       TEXT,
  criado_em    INTEGER NOT NULL,
  atualizado_em INTEGER
);

CREATE TABLE IF NOT EXISTS mensagem (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id  TEXT NOT NULL REFERENCES conversa(id),
  papel        TEXT NOT NULL,
  conteudo     TEXT NOT NULL,
  job_id       TEXT,
  criado_em    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mensagem_conversa ON mensagem (conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS sessao (
  comando      TEXT PRIMARY KEY,
  segredo_json TEXT NOT NULL,
  validado_em  INTEGER,
  expira_em    INTEGER
);
`;

function caminhoPadrao() {
  return path.join(process.env.JUR_DADOS || '/dados', 'jur.db');
}

function abrir(caminho = caminhoPadrao()) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const con = new DatabaseSync(caminho);
  con.exec('PRAGMA journal_mode = WAL;');
  con.exec('PRAGMA foreign_keys = ON;');
  con.exec(SCHEMA);
  return con;
}

module.exports = { abrir, caminhoPadrao };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/db.test.js`
Expected: PASS (3 testes). Um `ExperimentalWarning: SQLite is an experimental feature` no stderr é esperado e não é falha.

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/db.js jur/tests/db.test.js
git commit -m "persiste job, conversa e sessao no sqlite embutido do node — sem dependencia nativa e sem servico extra no compose"
```

---

### Task 6: `jobs.js` — fila, concorrência e ciclo de vida

**Files:**
- Create: `jur/servidor/jobs.js`
- Create: `jur/tests/jobs.test.js`

**Interfaces:**
- Consumes: `db.abrir` (Task 5), `executor.executar`/`executor.matarGrupo` (Task 4), `catalogo.obter` (Task 1)
- Produces:
  - `criarFila({con, executarFn?, catalogoFn?, concorrencia?, dirResultados?}) -> Fila`
  - `Fila.enfileirar(comando, params) -> {id, status}` — lança `Error` se o comando não existe ou não está `disponivel`
  - `Fila.obter(id) -> Job | null`
  - `Fila.listar(limite?) -> Job[]`
  - `Fila.cancelar(id) -> boolean`
  - `Fila.resultados(id, offset, limite) -> {total, itens}`
  - `Fila.aoEvento(fn)` / `Fila.removerOuvinte(fn)` — `fn({tipo, jobId, ...})`, `tipo` ∈ `iniciado|concluido|erro|cancelado`
  - `Fila.aguardar(id) -> Promise<Job>` — resolve quando o job sai de `enfileirado`/`rodando`
  - `Job = {id, comando, params, status, total, arquivo, erro, criadoEm, terminadoEm}`
  - `CONCORRENCIA_PADRAO = 3`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/jobs.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jur-jobs-'));

function filaDeTeste(executarFn, concorrencia = 3) {
  const dir = tmpDir();
  return jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    concorrencia,
    executarFn,
    catalogoFn: (comando) => (comando === 'inexistente' ? null
      : { comando, nome: 'X', disponivel: comando !== 'bloqueado', estado: 'ok', nota: '' }),
  });
}

describe('jobs', () => {
  it('roda um job ate concluido e guarda o total', async () => {
    const fila = filaDeTeste(async () => ({ ok: true, total: 2, resultados: [{ a: 1 }, { a: 2 }], arquivo: null, erro: null }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    const job = await fila.aguardar(id);
    assert.strictEqual(job.status, 'concluido');
    assert.strictEqual(job.total, 2);
  });

  it('marca erro quando o crawler falha, e nao concluido com zero', async () => {
    const fila = filaDeTeste(async () => ({ ok: false, total: 0, resultados: [], arquivo: null, erro: 'fora do ar' }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    const job = await fila.aguardar(id);
    assert.strictEqual(job.status, 'erro');
    assert.match(job.erro, /fora do ar/);
  });

  it('recusa tribunal inexistente e tribunal indisponivel', () => {
    const fila = filaDeTeste(async () => ({ ok: true, total: 0, resultados: [] }));
    assert.throws(() => fila.enfileirar('inexistente', {}), /desconhecido/i);
    assert.throws(() => fila.enfileirar('bloqueado', {}), /indispon/i);
  });

  it('respeita a concorrencia: nunca mais de 3 rodando ao mesmo tempo', async () => {
    let rodando = 0;
    let pico = 0;
    const fila = filaDeTeste(async () => {
      rodando++;
      pico = Math.max(pico, rodando);
      await new Promise((r) => setTimeout(r, 30));
      rodando--;
      return { ok: true, total: 1, resultados: [{}], arquivo: null, erro: null };
    }, 3);
    const ids = Array.from({ length: 9 }, () => fila.enfileirar('stf', { query: 'x' }).id);
    await Promise.all(ids.map((id) => fila.aguardar(id)));
    assert.ok(pico <= 3, `pico de concorrencia foi ${pico}, esperava <= 3`);
  });

  it('cancela um job que ainda esta na fila', async () => {
    const fila = filaDeTeste(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, total: 0, resultados: [], arquivo: null, erro: null };
    }, 1);
    const primeiro = fila.enfileirar('stf', { query: 'a' });
    const segundo = fila.enfileirar('stf', { query: 'b' });
    assert.strictEqual(fila.cancelar(segundo.id), true);
    assert.strictEqual(fila.obter(segundo.id).status, 'cancelado');
    await fila.aguardar(primeiro.id);
  });

  it('emite eventos de inicio e fim', async () => {
    const vistos = [];
    const fila = filaDeTeste(async () => ({ ok: true, total: 1, resultados: [{}], arquivo: null, erro: null }));
    fila.aoEvento((e) => vistos.push(e.tipo));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    await fila.aguardar(id);
    assert.ok(vistos.includes('iniciado'));
    assert.ok(vistos.includes('concluido'));
  });

  it('pagina os resultados a partir do arquivo', async () => {
    const dir = tmpDir();
    const arquivo = path.join(dir, 'r.json');
    fs.writeFileSync(arquivo, JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ n: i }))));
    const fila = filaDeTeste(async () => ({ ok: true, total: 25, resultados: [], arquivo, erro: null }));
    const { id } = fila.enfileirar('stf', { query: 'x' });
    await fila.aguardar(id);
    const pagina = fila.resultados(id, 10, 5);
    assert.strictEqual(pagina.total, 25);
    assert.strictEqual(pagina.itens.length, 5);
    assert.strictEqual(pagina.itens[0].n, 10);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/jobs.test.js`
Expected: FAIL — `Cannot find module '../servidor/jobs'`

- [ ] **Step 3: Implemente**

```js
// jur/servidor/jobs.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const executorPadrao = require('./executor');
const catalogoPadrao = require('./catalogo');

const CONCORRENCIA_PADRAO = Number(process.env.JUR_CONCORRENCIA || 3);

function criarFila(opcoes = {}) {
  const con = opcoes.con;
  const executarFn = opcoes.executarFn || ((comando, params, extra) => executorPadrao.executar(comando, params, extra));
  const catalogoFn = opcoes.catalogoFn || ((comando) => catalogoPadrao.obter(comando));
  const concorrencia = opcoes.concorrencia || CONCORRENCIA_PADRAO;
  const dirResultados = opcoes.dirResultados || path.join(process.env.JUR_DADOS || '/dados', 'resultados');

  fs.mkdirSync(dirResultados, { recursive: true });

  const pendentes = [];
  const rodando = new Map();          // jobId -> {pid}
  const ouvintes = new Set();
  const esperando = new Map();        // jobId -> [resolve]

  // Job que ficou 'rodando' quando o processo morreu nunca vai terminar sozinho.
  con.prepare(`UPDATE job SET status='erro', erro='interrompido por reinicio do servidor',
               terminado_em=? WHERE status IN ('rodando','enfileirado')`).run(Date.now());

  function emitir(evento) {
    for (const fn of ouvintes) {
      try { fn(evento); } catch { /* ouvinte quebrado nao derruba a fila */ }
    }
    if (['concluido', 'erro', 'cancelado'].includes(evento.tipo)) {
      const fila = esperando.get(evento.jobId) || [];
      esperando.delete(evento.jobId);
      for (const resolve of fila) resolve(obter(evento.jobId));
    }
  }

  function linhaParaJob(l) {
    if (!l) return null;
    return {
      id: l.id,
      comando: l.comando,
      params: JSON.parse(l.params_json),
      status: l.status,
      total: l.total,
      arquivo: l.arquivo,
      erro: l.erro,
      criadoEm: l.criado_em,
      terminadoEm: l.terminado_em,
    };
  }

  function obter(id) {
    return linhaParaJob(con.prepare('SELECT * FROM job WHERE id = ?').get(id));
  }

  function listar(limite = 50) {
    return con.prepare('SELECT * FROM job ORDER BY criado_em DESC LIMIT ?').all(limite).map(linhaParaJob);
  }

  function enfileirar(comando, params = {}) {
    const tribunal = catalogoFn(comando);
    if (!tribunal) throw new Error(`tribunal desconhecido: ${comando}`);
    if (!tribunal.disponivel) throw new Error(`tribunal indisponivel: ${comando} (${tribunal.estado})`);

    const id = crypto.randomUUID();
    con.prepare(`INSERT INTO job (id, comando, params_json, status, criado_em)
                 VALUES (?, ?, ?, 'enfileirado', ?)`).run(id, comando, JSON.stringify(params), Date.now());
    pendentes.push(id);
    setImmediate(bombear);
    return { id, status: 'enfileirado' };
  }

  function bombear() {
    while (rodando.size < concorrencia && pendentes.length) {
      const id = pendentes.shift();
      const job = obter(id);
      if (!job || job.status !== 'enfileirado') continue;   // cancelado enquanto esperava
      rodar(job);
    }
  }

  async function rodar(job) {
    rodando.set(job.id, { pid: null });
    con.prepare(`UPDATE job SET status='rodando', iniciado_em=? WHERE id=?`).run(Date.now(), job.id);
    emitir({ tipo: 'iniciado', jobId: job.id, comando: job.comando });

    const arquivo = path.join(dirResultados, `${job.id}.json`);
    let r;
    try {
      r = await executarFn(job.comando, job.params, {
        arquivoSaida: arquivo,
        aoIniciar: (pid) => {
          const atual = rodando.get(job.id);
          if (atual) atual.pid = pid;
          con.prepare('UPDATE job SET pid=? WHERE id=?').run(pid, job.id);
        },
      });
    } catch (e) {
      r = { ok: false, total: 0, resultados: [], arquivo: null, erro: e.message };
    }

    rodando.delete(job.id);

    // Se foi cancelado no meio, o cancelamento manda: nao sobrescreve.
    if (obter(job.id).status === 'cancelado') { setImmediate(bombear); return; }

    if (r.ok) {
      con.prepare(`UPDATE job SET status='concluido', total=?, arquivo=?, terminado_em=? WHERE id=?`)
        .run(r.total, r.arquivo || arquivo, Date.now(), job.id);
      emitir({ tipo: 'concluido', jobId: job.id, total: r.total });
    } else {
      con.prepare(`UPDATE job SET status='erro', erro=?, terminado_em=? WHERE id=?`)
        .run(r.erro || 'falha desconhecida', Date.now(), job.id);
      emitir({ tipo: 'erro', jobId: job.id, erro: r.erro });
    }
    setImmediate(bombear);
  }

  function cancelar(id) {
    const job = obter(id);
    if (!job || ['concluido', 'erro', 'cancelado'].includes(job.status)) return false;
    const vivo = rodando.get(id);
    if (vivo && vivo.pid) executorPadrao.matarGrupo(vivo.pid);
    rodando.delete(id);
    con.prepare(`UPDATE job SET status='cancelado', terminado_em=? WHERE id=?`).run(Date.now(), id);
    emitir({ tipo: 'cancelado', jobId: id });
    setImmediate(bombear);
    return true;
  }

  function resultados(id, offset = 0, limite = 20) {
    const job = obter(id);
    if (!job || !job.arquivo || !fs.existsSync(job.arquivo)) return { total: job ? job.total : 0, itens: [] };
    let bruto;
    try {
      bruto = JSON.parse(fs.readFileSync(job.arquivo, 'utf8'));
    } catch {
      return { total: job.total, itens: [] };
    }
    const lista = Array.isArray(bruto) ? bruto : (bruto.results || bruto.resultados || []);
    return { total: lista.length, itens: lista.slice(offset, offset + limite) };
  }

  function aguardar(id) {
    const job = obter(id);
    if (job && !['enfileirado', 'rodando'].includes(job.status)) return Promise.resolve(job);
    return new Promise((resolve) => {
      if (!esperando.has(id)) esperando.set(id, []);
      esperando.get(id).push(resolve);
    });
  }

  return {
    enfileirar, obter, listar, cancelar, resultados, aguardar,
    aoEvento: (fn) => ouvintes.add(fn),
    removerOuvinte: (fn) => ouvintes.delete(fn),
    concorrencia,
  };
}

module.exports = { criarFila, CONCORRENCIA_PADRAO };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/jobs.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/jobs.js jur/tests/jobs.test.js
git commit -m "enfileira busca com concorrencia de 3 e distingue crawler que morreu de busca que deu zero — job orfao de reinicio vira erro, nao fantasma eterno"
```

---

### Task 7: `http.js` + servidor + `/saude` e `/tribunais`

**Files:**
- Create: `jur/servidor/http.js`
- Create: `jur/servidor/rotas/tribunais.js`
- Create: `jur/servidor/index.js`
- Create: `jur/tests/http.test.js`

**Interfaces:**
- Consumes: `catalogo` (Task 1), `db` (Task 5), `jobs` (Task 6)
- Produces:
  - `criarRoteador() -> Roteador` com `.rota(metodo, padrao, handler)`, `.estaticos(dir, prefixo)`, `.handler` (para `http.createServer`)
  - `padrao` aceita `:param` (ex.: `/api/v1/buscas/:id`); os valores chegam em `req.params`
  - helpers: `json(res, codigo, corpo)`, `sse(res) -> {enviar(evento, dado), fechar()}`, `lerCorpo(req) -> Promise<object>`
  - `montar({fila, catalogo}) -> Roteador` exportado de `index.js` como `criarApp` para os testes usarem sem escutar porta

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/http.test.js
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor;
let base;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-http-'));
  const fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [{ processo: '1' }], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

describe('http', () => {
  it('GET /api/v1/saude responde ok', async () => {
    const r = await fetch(`${base}/api/v1/saude`);
    assert.strictEqual(r.status, 200);
    const corpo = await r.json();
    assert.strictEqual(corpo.ok, true);
  });

  it('GET /api/v1/tribunais lista com estado e disponivel', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais`)).json();
    assert.ok(corpo.tribunais.length > 60);
    const stf = corpo.tribunais.find((t) => t.comando === 'stf');
    assert.strictEqual(stf.disponivel, true);
    assert.ok('estado' in stf && 'nota' in stf);
  });

  it('GET /api/v1/tribunais?segmento=superior filtra', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais?segmento=superior`)).json();
    assert.ok(corpo.tribunais.every((t) => t.segmento === 'superior'));
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const r = await fetch(`${base}/api/v1/nao-existe`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).erro, 'rota nao encontrada');
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/http.test.js`
Expected: FAIL — `Cannot find module '../servidor/index'`

- [ ] **Step 3: Implemente `http.js`**

```js
// jur/servidor/http.js
const fs = require('node:fs');
const path = require('node:path');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, codigo, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(texto);
}

function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const batimento = setInterval(() => res.write(': ping\n\n'), 15000);
  return {
    enviar(evento, dado) {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`);
    },
    fechar() {
      clearInterval(batimento);
      res.end();
    },
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    req.on('data', (d) => {
      bruto += d;
      if (bruto.length > 1_000_000) reject(new Error('corpo grande demais'));
    });
    req.on('end', () => {
      if (!bruto) return resolve({});
      try { resolve(JSON.parse(bruto)); } catch { reject(new Error('corpo nao e JSON valido')); }
    });
    req.on('error', reject);
  });
}

function compilar(padrao) {
  const nomes = [];
  const fonte = padrao.replace(/:([a-zA-Z]+)/g, (_, nome) => { nomes.push(nome); return '([^/]+)'; });
  return { re: new RegExp(`^${fonte}$`), nomes };
}

function criarRoteador() {
  const rotas = [];
  const estaticos = [];

  function rota(metodo, padrao, handler) {
    rotas.push({ metodo, ...compilar(padrao), handler });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const caminho = url.pathname;
    req.query = Object.fromEntries(url.searchParams);

    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = caminho.match(r.re);
      if (!m) continue;
      req.params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      try {
        return await r.handler(req, res);
      } catch (e) {
        if (!res.headersSent) return json(res, 500, { erro: e.message });
        return res.end();
      }
    }

    for (const e of estaticos) {
      if (!caminho.startsWith(e.prefixo)) continue;
      const relativo = caminho.slice(e.prefixo.length) || 'index.html';
      // path.normalize + verificacao de prefixo impede subir de diretorio com ../
      const alvo = path.resolve(e.dir, relativo.replace(/^\/+/, ''));
      if (!alvo.startsWith(path.resolve(e.dir))) return json(res, 403, { erro: 'proibido' });
      if (fs.existsSync(alvo) && fs.statSync(alvo).isFile()) {
        res.writeHead(200, { 'content-type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
        return fs.createReadStream(alvo).pipe(res);
      }
    }

    return json(res, 404, { erro: 'rota nao encontrada' });
  }

  return {
    rota,
    estaticos: (dir, prefixo = '/') => estaticos.push({ dir, prefixo }),
    handler,
  };
}

module.exports = { criarRoteador, json, sse, lerCorpo };
```

- [ ] **Step 4: Implemente `rotas/tribunais.js`**

```js
// jur/servidor/rotas/tribunais.js
const catalogo = require('../catalogo');
const { json } = require('../http');

function registrar(roteador) {
  roteador.rota('GET', '/api/v1/saude', (req, res) => {
    json(res, 200, { ok: true, versao: require('../../package.json').version });
  });

  roteador.rota('GET', '/api/v1/tribunais', (req, res) => {
    const { segmento, uf, estado } = req.query;
    json(res, 200, { tribunais: catalogo.listar({ segmento, uf, estado }) });
  });
}

module.exports = { registrar };
```

- [ ] **Step 5: Implemente `index.js`**

```js
// jur/servidor/index.js
const http = require('node:http');
const path = require('node:path');
const { criarRoteador } = require('./http');
const db = require('./db');
const jobs = require('./jobs');

function criarApp(deps = {}) {
  const roteador = criarRoteador();
  require('./rotas/tribunais').registrar(roteador);
  require('./rotas/buscas').registrar(roteador, deps);
  require('./rotas/chat').registrar(roteador, deps);
  require('./mcp').registrar(roteador, deps);
  roteador.estaticos(path.join(__dirname, '..', 'publico'), '/');
  return roteador;
}

function iniciar() {
  const fila = jobs.criarFila({ con: db.abrir() });
  const porta = Number(process.env.PORT || 3000);
  const servidor = http.createServer(criarApp({ fila }).handler);
  servidor.listen(porta, () => {
    console.log(`jur ouvindo em http://localhost:${porta} (concorrencia ${fila.concorrencia})`);
  });
  return servidor;
}

if (require.main === module) iniciar();

module.exports = { criarApp, iniciar };
```

> **Nota para quem executa esta task:** `index.js` já referencia `rotas/buscas`, `rotas/chat` e `mcp`, que só existem nas Tasks 8, 10 e 11. Para o teste desta task passar, crie os três como stubs mínimos agora — arquivos com `module.exports = { registrar() {} };` — e substitua o conteúdo nas tasks seguintes. **Não** deixe stub em nenhum outro lugar.

- [ ] **Step 6: Rode e confirme que passa**

Run: `cd jur && node --test tests/http.test.js`
Expected: PASS (4 testes)

- [ ] **Step 7: Commit**

```bash
git add jur/servidor/http.js jur/servidor/rotas/ jur/servidor/index.js jur/servidor/mcp.js jur/tests/http.test.js
git commit -m "sobe o servidor com roteador proprio e serve o catalogo por HTTP — sem framework, para o container nao ganhar dependencia que o repo nao tem"
```

---

### Task 8: `rotas/buscas.js` — criar, acompanhar, paginar, cancelar

**Files:**
- Create (substituindo o stub): `jur/servidor/rotas/buscas.js`
- Create: `jur/tests/buscas.test.js`

**Interfaces:**
- Consumes: `fila` (Task 6), `json`/`sse`/`lerCorpo` (Task 7)
- Produces as rotas: `POST /api/v1/buscas` → `202 {id, status}` · `GET /api/v1/buscas` · `GET /api/v1/buscas/:id` · `GET /api/v1/buscas/:id/resultados?offset&limite` · `GET /api/v1/buscas/:id/eventos` (SSE) · `DELETE /api/v1/buscas/:id`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/buscas.test.js
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor; let base; let fila;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-buscas-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A' }, { processo: 'B' }, { processo: 'C' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 3, resultados: [], arquivo, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const criar = (corpo) => fetch(`${base}/api/v1/buscas`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

describe('rotas de busca', () => {
  it('cria busca e devolve 202 com id', async () => {
    const r = await criar({ tribunal: 'stf', query: 'aposentadoria' });
    assert.strictEqual(r.status, 202);
    const corpo = await r.json();
    assert.ok(corpo.id);
    assert.strictEqual(corpo.status, 'enfileirado');
  });

  it('recusa busca sem tribunal e sem query', async () => {
    assert.strictEqual((await criar({ query: 'x' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf' })).status, 400);
  });

  it('recusa tribunal indisponivel com 409 e explica', async () => {
    const r = await criar({ tribunal: 'stj', query: 'x' });
    assert.strictEqual(r.status, 409);
    const corpo = await r.json();
    assert.match(corpo.erro, /indispon/i);
    assert.ok(corpo.nota && corpo.nota.length > 0, 'o usuario precisa saber POR QUE');
  });

  it('acompanha ate concluido e pagina resultados', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    const job = await (await fetch(`${base}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.status, 'concluido');
    assert.strictEqual(job.total, 3);
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?offset=1&limite=1`)).json();
    assert.strictEqual(pagina.itens.length, 1);
    assert.strictEqual(pagina.itens[0].processo, 'B');
  });

  it('404 para busca inexistente', async () => {
    assert.strictEqual((await fetch(`${base}/api/v1/buscas/nao-existe`)).status, 404);
  });

  it('DELETE cancela', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    const r = await fetch(`${base}/api/v1/buscas/${id}`, { method: 'DELETE' });
    assert.ok([200, 409].includes(r.status)); // 409 se ja terminou antes do DELETE
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/buscas.test.js`
Expected: FAIL — 404 nas rotas (o stub não registra nada)

- [ ] **Step 3: Implemente**

```js
// jur/servidor/rotas/buscas.js
const catalogo = require('../catalogo');
const { json, sse, lerCorpo } = require('../http');

function registrar(roteador, deps) {
  const fila = deps.fila;

  roteador.rota('POST', '/api/v1/buscas', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const { tribunal, query, dataInicio, dataFim, maxPaginas } = corpo;
    if (!tribunal) return json(res, 400, { erro: 'campo obrigatorio: tribunal' });
    if (!query) return json(res, 400, { erro: 'campo obrigatorio: query' });

    const info = catalogo.obter(tribunal);
    if (!info) return json(res, 404, { erro: `tribunal desconhecido: ${tribunal}` });
    if (!info.disponivel) {
      // A nota vai junto: "indisponivel" sem motivo faz o usuario tentar de novo.
      return json(res, 409, { erro: `tribunal indisponivel (${info.estado})`, estado: info.estado, nota: info.nota });
    }

    try {
      const { id, status } = fila.enfileirar(tribunal, { query, dataInicio, dataFim, maxPaginas });
      return json(res, 202, { id, status });
    } catch (e) {
      return json(res, 409, { erro: e.message });
    }
  });

  roteador.rota('GET', '/api/v1/buscas', (req, res) => {
    json(res, 200, { buscas: fila.listar(Number(req.query.limite) || 50) });
  });

  roteador.rota('GET', '/api/v1/buscas/:id', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    const info = catalogo.obter(job.comando);
    // total 0 nunca viaja sozinho: a nota do tribunal e o que impede ler
    // "zero" como "nao ha jurisprudencia" (ex.: base do TRF1 congelada em 07/2025).
    const avisos = [];
    if (job.status === 'concluido' && job.total === 0 && info && info.nota) avisos.push(info.nota);
    json(res, 200, { ...job, estadoTribunal: info ? info.estado : null, avisos });
  });

  roteador.rota('GET', '/api/v1/buscas/:id/resultados', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    const offset = Number(req.query.offset) || 0;
    const limite = Math.min(Number(req.query.limite) || 20, 100);
    json(res, 200, { ...fila.resultados(req.params.id, offset, limite), offset, limite });
  });

  roteador.rota('DELETE', '/api/v1/buscas/:id', (req, res) => {
    const job = fila.obter(req.params.id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });
    if (!fila.cancelar(req.params.id)) return json(res, 409, { erro: `busca ja ${job.status}` });
    json(res, 200, { id: req.params.id, status: 'cancelado' });
  });

  roteador.rota('GET', '/api/v1/buscas/:id/eventos', (req, res) => {
    const id = req.params.id;
    const job = fila.obter(id);
    if (!job) return json(res, 404, { erro: 'busca nao encontrada' });

    const canal = sse(res);
    canal.enviar('estado', job);

    const ouvinte = (evento) => {
      if (evento.jobId !== id) return;
      canal.enviar(evento.tipo, fila.obter(id));
      if (['concluido', 'erro', 'cancelado'].includes(evento.tipo)) encerrar();
    };
    function encerrar() {
      fila.removerOuvinte(ouvinte);
      canal.fechar();
    }
    fila.aoEvento(ouvinte);
    req.on('close', encerrar);

    if (['concluido', 'erro', 'cancelado'].includes(job.status)) encerrar();
  });
}

module.exports = { registrar };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/buscas.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/rotas/buscas.js jur/tests/buscas.test.js
git commit -m "expoe a busca como job HTTP com SSE e cancelamento — e faz o zero resultados viajar sempre com a nota do tribunal"
```

---

### Task 9: `ferramentas.js` — as três tools, uma implementação

O chat (Task 10) e o MCP (Task 11) usam **este mesmo módulo**. Se cada um tivesse a sua cópia, divergiriam em uma semana.

**Files:**
- Create: `jur/servidor/ferramentas.js`
- Create: `jur/tests/ferramentas.test.js`

**Interfaces:**
- Consumes: `catalogo` (Task 1), `fila` (Task 6)
- Produces:
  - `definicoes() -> Tool[]` — formato da Messages API (`{name, description, input_schema}`)
  - `async executar(nome, entrada, deps) -> string` — sempre devolve **texto**, que é o que tanto `tool_result` quanto MCP `content[{type:'text'}]` esperam
  - Nomes: `listar_tribunais`, `buscar_jurisprudencia`, `ler_resultados`

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/ferramentas.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const ferramentas = require('../servidor/ferramentas');

let fila;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A', ementa: 'primeira' }, { processo: 'B', ementa: 'segunda' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }),
  });
});

describe('ferramentas', () => {
  it('publica exatamente as tres tools com schema', () => {
    const nomes = ferramentas.definicoes().map((d) => d.name).sort();
    assert.deepStrictEqual(nomes, ['buscar_jurisprudencia', 'listar_tribunais', 'ler_resultados']);
    for (const d of ferramentas.definicoes()) {
      assert.ok(d.description.length > 20, `${d.name} precisa de descricao util`);
      assert.strictEqual(d.input_schema.type, 'object');
    }
  });

  it('nenhuma tool aceita orgao', () => {
    for (const d of ferramentas.definicoes()) {
      assert.ok(!('orgao' in (d.input_schema.properties || {})), `${d.name} nao pode expor orgao`);
    }
  });

  it('listar_tribunais devolve texto com estado', async () => {
    const texto = await ferramentas.executar('listar_tribunais', { segmento: 'superior' }, { fila });
    assert.match(texto, /stf/);
    assert.match(texto, /ok|sem-acesso/);
  });

  it('buscar_jurisprudencia roda ate o fim e informa o job', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    assert.match(texto, /job/i);
    assert.match(texto, /2/);
  });

  it('buscar_jurisprudencia explica o motivo quando o tribunal esta bloqueado', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stj', query: 'x' }, { fila });
    assert.match(texto, /indispon/i);
    assert.ok(texto.length > 60, 'precisa carregar a nota, nao so o rotulo');
  });

  it('ler_resultados pagina', async () => {
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId, offset: 1, limite: 1 }, { fila });
    assert.match(texto, /segunda/);
    assert.ok(!texto.includes('primeira'), 'offset deve pular o primeiro');
  });

  it('tool desconhecida vira erro legivel, nao excecao crua', async () => {
    const texto = await ferramentas.executar('nao_existe', {}, { fila });
    assert.match(texto, /desconhecida/i);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/ferramentas.test.js`
Expected: FAIL — `Cannot find module '../servidor/ferramentas'`

- [ ] **Step 3: Implemente**

```js
// jur/servidor/ferramentas.js
const catalogo = require('./catalogo');

const LIMITE_MAX = 20;

function definicoes() {
  return [
    {
      name: 'listar_tribunais',
      description:
        'Lista os tribunais brasileiros disponiveis para busca de jurisprudencia, com o estado de cada um. '
        + 'Use ANTES de buscar, para escolher o tribunal certo e evitar pedir um que esta bloqueado. '
        + 'Estados: ok (funciona), instavel (funciona com ressalva — leia a nota), '
        + 'sem-acesso (bloqueado por captcha), exige-sessao (precisa da credencial do usuario).',
      input_schema: {
        type: 'object',
        properties: {
          segmento: { type: 'string', description: 'superior, federal, estadual, trabalhista ou contas' },
          uf: { type: 'string', description: 'sigla do estado, ex.: PR' },
          estado: { type: 'string', enum: ['ok', 'instavel', 'sem-acesso', 'exige-sessao'] },
        },
      },
    },
    {
      name: 'buscar_jurisprudencia',
      description:
        'Executa uma busca de jurisprudencia num tribunal e espera ela terminar. '
        + 'Devolve o id do job e o total encontrado, NAO os julgados — use ler_resultados para os textos. '
        + 'Pode demorar minutos em tribunais que exigem navegador.',
      input_schema: {
        type: 'object',
        properties: {
          tribunal: { type: 'string', description: 'o comando do tribunal, ex.: stf, trf4, tjpr' },
          query: { type: 'string', description: 'os termos de busca' },
          dataInicio: { type: 'string', description: 'DD/MM/AAAA' },
          dataFim: { type: 'string', description: 'DD/MM/AAAA' },
          maxPaginas: { type: 'integer', description: 'paginas a percorrer (default 3)' },
        },
        required: ['tribunal', 'query'],
      },
    },
    {
      name: 'ler_resultados',
      description:
        'Le uma FATIA dos resultados de uma busca ja concluida. Sempre pagine: pedir tudo de uma vez '
        + `estoura o contexto. Maximo de ${LIMITE_MAX} por chamada.`,
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          offset: { type: 'integer', description: 'default 0' },
          limite: { type: 'integer', description: `default 5, maximo ${LIMITE_MAX}` },
        },
        required: ['job_id'],
      },
    },
  ];
}

async function listarTribunais(entrada) {
  const lista = catalogo.listar({ segmento: entrada.segmento, uf: entrada.uf, estado: entrada.estado });
  if (!lista.length) return 'Nenhum tribunal bate com esse filtro.';
  const linhas = lista.map((t) => {
    const uf = t.uf.length ? ` [${t.uf.join(',')}]` : '';
    return `${t.comando} — ${t.nome}${uf} · ${t.estado}`;
  });
  return `${lista.length} tribunais:\n${linhas.join('\n')}`;
}

async function buscar(entrada, deps) {
  const info = catalogo.obter(entrada.tribunal);
  if (!info) return `Tribunal desconhecido: "${entrada.tribunal}". Use listar_tribunais para ver os validos.`;
  if (!info.disponivel) {
    return `O tribunal ${info.comando} (${info.nome}) esta INDISPONIVEL — estado "${info.estado}".\n`
      + `Motivo registrado: ${info.nota}\n`
      + 'Nao invente resultado: diga isso ao usuario e sugira outro tribunal.';
  }

  const { id } = deps.fila.enfileirar(entrada.tribunal, {
    query: entrada.query,
    dataInicio: entrada.dataInicio,
    dataFim: entrada.dataFim,
    maxPaginas: entrada.maxPaginas || 3,
  });
  const job = await deps.fila.aguardar(id);

  if (job.status === 'erro') {
    return `A busca FALHOU (job ${job.id}): ${job.erro}\n`
      + 'Isso NAO significa que nao ha jurisprudencia — o crawler nao completou. Diga isso ao usuario.';
  }
  if (job.status === 'cancelado') return `A busca ${job.id} foi cancelada.`;

  if (job.total === 0) {
    return `job ${job.id}: 0 resultados em ${info.comando} para "${entrada.query}".\n`
      + `RESSALVA DO TRIBUNAL: ${info.nota || '(sem ressalva registrada)'}\n`
      + 'Zero aqui pode ser ausencia de julgado OU limitacao do acervo — nao afirme que "nao existe jurisprudencia".';
  }
  return `job ${job.id}: ${job.total} resultados em ${info.comando} para "${entrada.query}". `
    + 'Use ler_resultados com esse job_id para ver os julgados.';
}

async function lerResultados(entrada, deps) {
  const job = deps.fila.obter(entrada.job_id);
  if (!job) return `Job desconhecido: ${entrada.job_id}`;
  if (job.status !== 'concluido') return `O job ${job.id} esta "${job.status}", ainda nao da para ler resultados.`;
  const offset = Number(entrada.offset) || 0;
  const limite = Math.min(Number(entrada.limite) || 5, LIMITE_MAX);
  const { total, itens } = deps.fila.resultados(job.id, offset, limite);
  if (!itens.length) return `Sem itens em offset ${offset} (total ${total}).`;
  return `Mostrando ${offset + 1}–${offset + itens.length} de ${total}:\n\n`
    + itens.map((it, i) => `[${offset + i + 1}] ${JSON.stringify(it)}`).join('\n\n');
}

async function executar(nome, entrada = {}, deps = {}) {
  try {
    if (nome === 'listar_tribunais') return await listarTribunais(entrada);
    if (nome === 'buscar_jurisprudencia') return await buscar(entrada, deps);
    if (nome === 'ler_resultados') return await lerResultados(entrada, deps);
    return `Ferramenta desconhecida: ${nome}`;
  } catch (e) {
    return `Erro ao executar ${nome}: ${e.message}`;
  }
}

module.exports = { definicoes, executar };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/ferramentas.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/ferramentas.js jur/tests/ferramentas.test.js
git commit -m "define as tres tools uma vez so para o chat e o MCP — e faz zero resultado e falha de crawler chegarem ao modelo com a ressalva junto"
```

---

### Task 10: `llm.js` + `rotas/chat.js` — o loop de tool-use em streaming

**Files:**
- Create: `jur/servidor/llm.js`
- Create (substituindo o stub): `jur/servidor/rotas/chat.js`
- Create: `jur/tests/llm.test.js`
- Modify: `jur/package.json` (dependência `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `ferramentas` (Task 9), `sse`/`lerCorpo`/`json` (Task 7)
- Produces:
  - `async conversar({mensagens, apiKey, deps, aoTexto, aoFerramenta}) -> {mensagens, texto}`
  - `MODELO = 'claude-opus-5'`
  - `SISTEMA` — o system prompt
  - Rota `POST /api/v1/chat` (SSE) com eventos `texto`, `ferramenta`, `fim`, `erro`

**Restrições da API da Anthropic (não negociáveis):**
- Model id exatamente `claude-opus-5`, sem sufixo de data.
- `max_tokens: 64000` (streaming).
- **Nunca** enviar `budget_tokens` nem `temperature`/`top_p` — devolvem 400 no Opus 5.
- **Nunca** usar prefill de assistant — devolve 400.
- Thinking adaptativo já é o default do Opus 5; não passe `thinking: {type:'disabled'}`.
- Usar o **SDK oficial** `@anthropic-ai/sdk`, nunca `fetch` cru.
- **Loop manual** (`client.messages.stream()` + `finalMessage()`) em vez do tool runner: precisamos de transporte próprio — cada delta e cada chamada de tool viram evento no nosso SSE. Transporte customizado é exatamente a exceção que a documentação do SDK admite para o loop manual.

- [ ] **Step 1: Instale o SDK**

Run: `cd jur && npm install @anthropic-ai/sdk`
Expected: `package.json` ganha a dependência; `package-lock.json` atualiza.

- [ ] **Step 2: Escreva o teste que falha**

O teste **não** chama a API — injeta um cliente falso. Testar resposta de LLM de verdade é caro e instável, e está fora de escopo (spec §6).

```js
// jur/tests/llm.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const llm = require('../servidor/llm');

let fila;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-llm-'));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [], arquivo: null, erro: null }),
  });
});

/** Cliente falso com a mesma forma do SDK: .messages.stream(...) -> {on, finalMessage}. */
function clienteFalso(respostas) {
  let i = 0;
  return {
    messages: {
      stream(params) {
        const resposta = respostas[i++];
        const ouvintes = {};
        const p = {
          on(evento, fn) { ouvintes[evento] = fn; return p; },
          async finalMessage() {
            for (const bloco of resposta.content) {
              if (bloco.type === 'text' && ouvintes.text) ouvintes.text(bloco.text);
            }
            return resposta;
          },
          _params: params,
        };
        return p;
      },
    },
  };
}

describe('llm', () => {
  it('usa o model id exigido e nao manda parametro proibido', async () => {
    let capturado = null;
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oi' }] }]);
    const original = cliente.messages.stream.bind(cliente.messages);
    cliente.messages.stream = (p) => { capturado = p; return original(p); };

    await llm.conversar({ mensagens: [{ role: 'user', content: 'oi' }], cliente, deps: { fila } });
    assert.strictEqual(capturado.model, 'claude-opus-5');
    assert.strictEqual(capturado.max_tokens, 64000);
    assert.ok(!('temperature' in capturado), 'temperature devolve 400 no Opus 5');
    assert.ok(!JSON.stringify(capturado).includes('budget_tokens'), 'budget_tokens foi removido da API');
    assert.ok(!JSON.stringify(capturado).includes('"type":"disabled"'), 'nao desligue o thinking do Opus 5');
    assert.strictEqual(capturado.tools.length, 3);
  });

  it('executa a tool pedida e devolve o resultado ao modelo', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'listar_tribunais', input: { segmento: 'superior' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'o STF esta ok' }] },
    ]);
    const usadas = [];
    const r = await llm.conversar({
      mensagens: [{ role: 'user', content: 'quais superiores?' }],
      cliente, deps: { fila }, aoFerramenta: (n) => usadas.push(n),
    });
    assert.deepStrictEqual(usadas, ['listar_tribunais']);
    assert.match(r.texto, /STF esta ok/);
    const resultado = r.mensagens.find((m) => Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
    assert.ok(resultado, 'o tool_result precisa voltar para o modelo');
    assert.strictEqual(resultado.content[0].tool_use_id, 'tu1');
  });

  it('encaminha os deltas de texto', async () => {
    const cliente = clienteFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'pedaco' }] }]);
    const pedacos = [];
    await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente, deps: { fila }, aoTexto: (t) => pedacos.push(t) });
    assert.deepStrictEqual(pedacos, ['pedaco']);
  });

  it('para no teto de iteracoes em vez de rodar para sempre', async () => {
    const semFim = Array.from({ length: 30 }, () => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'x', name: 'listar_tribunais', input: {} }],
    }));
    const r = await llm.conversar({ mensagens: [{ role: 'user', content: 'x' }], cliente: clienteFalso(semFim), deps: { fila }, maxIteracoes: 4 });
    assert.match(r.texto, /limite/i);
  });
});
```

- [ ] **Step 3: Rode e confirme que falha**

Run: `cd jur && node --test tests/llm.test.js`
Expected: FAIL — `Cannot find module '../servidor/llm'`

- [ ] **Step 4: Implemente `llm.js`**

```js
// jur/servidor/llm.js
const ferramentas = require('./ferramentas');

// O SDK e dual ESM/CJS: em CommonJS o construtor pode vir em .default.
const moduloSdk = require('@anthropic-ai/sdk');
const Anthropic = moduloSdk.default || moduloSdk;

const MODELO = 'claude-opus-5';
const MAX_TOKENS = 64000;
const MAX_ITERACOES = 12;

const SISTEMA = `Voce e um assistente de pesquisa de jurisprudencia dos tribunais brasileiros.
Voce tem acesso a um crawler que consulta as bases OFICIAIS dos tribunais.

Regras que nao se quebram:
1. NUNCA cite um julgado que nao veio de ler_resultados. Nao ha jurisprudencia "de memoria".
2. Escolha o tribunal com listar_tribunais antes de buscar. Tribunal com estado
   "sem-acesso" ou "exige-sessao" nao pode ser buscado — explique ao usuario e ofereca outro.
3. Zero resultados NAO e o mesmo que "nao existe jurisprudencia". Quando o total for 0,
   repasse a ressalva do tribunal ao usuario. Varios acervos tem recorte de periodo.
4. Busca que FALHOU e diferente de busca vazia. Diga qual das duas aconteceu.
5. Pagine com ler_resultados. Nao peca centenas de julgados de uma vez.
6. Responda em portugues do Brasil.`;

async function conversar({ mensagens, apiKey, cliente, deps, aoTexto, aoFerramenta, maxIteracoes = MAX_ITERACOES }) {
  const anthropic = cliente || new Anthropic(apiKey ? { apiKey } : {});
  const historico = [...mensagens];
  let textoFinal = '';

  for (let i = 0; i < maxIteracoes; i++) {
    const stream = anthropic.messages.stream({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: SISTEMA,
      tools: ferramentas.definicoes(),
      messages: historico,
    });

    if (typeof aoTexto === 'function') stream.on('text', (delta) => aoTexto(delta));

    const mensagem = await stream.finalMessage();

    textoFinal = mensagem.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (mensagem.stop_reason === 'end_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      return { mensagens: historico, texto: textoFinal };
    }

    if (mensagem.stop_reason === 'pause_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      continue;
    }

    const chamadas = mensagem.content.filter((b) => b.type === 'tool_use');
    if (!chamadas.length) {
      historico.push({ role: 'assistant', content: mensagem.content });
      return { mensagens: historico, texto: textoFinal };
    }

    historico.push({ role: 'assistant', content: mensagem.content });

    // Chamadas paralelas voltam TODAS num unico turno de user; dividir em
    // varias mensagens ensina o modelo a parar de paralelizar.
    const resultados = [];
    for (const chamada of chamadas) {
      if (typeof aoFerramenta === 'function') aoFerramenta(chamada.name, chamada.input);
      const texto = await ferramentas.executar(chamada.name, chamada.input, deps);
      resultados.push({ type: 'tool_result', tool_use_id: chamada.id, content: texto });
    }
    historico.push({ role: 'user', content: resultados });
  }

  const aviso = 'Atingi o limite de passos desta conversa sem concluir. Refaca o pedido de forma mais especifica.';
  return { mensagens: historico, texto: textoFinal || aviso };
}

module.exports = { conversar, MODELO, SISTEMA, MAX_ITERACOES };
```

- [ ] **Step 5: Implemente `rotas/chat.js`**

```js
// jur/servidor/rotas/chat.js
const { sse, lerCorpo, json } = require('../http');
const llm = require('../llm');

function registrar(roteador, deps) {
  roteador.rota('POST', '/api/v1/chat', async (req, res) => {
    let corpo;
    try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }

    const mensagens = Array.isArray(corpo.mensagens) ? corpo.mensagens : null;
    if (!mensagens || !mensagens.length) return json(res, 400, { erro: 'campo obrigatorio: mensagens' });

    // A chave nunca e persistida: vem do header (localStorage do browser) ou do ambiente.
    const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(res, 401, { erro: 'sem chave da Anthropic: defina ANTHROPIC_API_KEY ou informe na interface' });

    const canal = sse(res);
    try {
      const r = await llm.conversar({
        mensagens,
        apiKey,
        deps,
        aoTexto: (t) => canal.enviar('texto', { texto: t }),
        aoFerramenta: (nome, entrada) => canal.enviar('ferramenta', { nome, entrada }),
      });
      canal.enviar('fim', { texto: r.texto });
    } catch (e) {
      canal.enviar('erro', { erro: e.message, tipo: e.constructor ? e.constructor.name : 'Error' });
    } finally {
      canal.fechar();
    }
  });
}

module.exports = { registrar };
```

- [ ] **Step 6: Rode e confirme que passa**

Run: `cd jur && node --test tests/llm.test.js`
Expected: PASS (4 testes)

- [ ] **Step 7: Rode a suíte inteira**

Run: `cd jur && npm test`
Expected: PASS em todos os arquivos de teste

- [ ] **Step 8: Commit**

```bash
git add jur/servidor/llm.js jur/servidor/rotas/chat.js jur/tests/llm.test.js jur/package.json jur/package-lock.json
git commit -m "poe o chat sobre o loop de tool-use do Opus 5 com transporte proprio por SSE — e ensina no system prompt que zero resultado nao autoriza dizer que nao ha jurisprudencia"
```

---

### Task 11: `mcp.js` — as mesmas tools por MCP

Transporte **HTTP** (JSON-RPC 2.0 em `POST /mcp`), não stdio: o container já fica de pé, então um cliente MCP conecta por URL sem `docker run -i` por sessão e sem processo órfão.

Implementado à mão em vez de com SDK: são **quatro** métodos (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) sobre um módulo de ferramentas que já existe, e o repo é CommonJS — evita uma dependência ESM-only. O Step 6 valida contra um cliente MCP de verdade; **se ele falhar**, troque por `@modelcontextprotocol/sdk` em vez de adivinhar o protocolo.

**Files:**
- Create (substituindo o stub): `jur/servidor/mcp.js`
- Create: `jur/tests/mcp.test.js`

**Interfaces:**
- Consumes: `ferramentas` (Task 9), `json`/`lerCorpo` (Task 7)
- Produces: `POST /mcp` falando JSON-RPC 2.0

- [ ] **Step 1: Escreva o teste que falha**

```js
// jur/tests/mcp.test.js
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor; let base;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-mcp-'));
  const fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const rpc = (metodo, params, id = 1) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id, method: metodo, params }),
}).then((r) => r.json());

describe('mcp', () => {
  it('initialize devolve protocolo, capacidades e nome', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    assert.strictEqual(r.jsonrpc, '2.0');
    assert.ok(r.result.protocolVersion);
    assert.ok(r.result.capabilities.tools);
    assert.strictEqual(r.result.serverInfo.name, 'jur');
  });

  it('tools/list publica as tres tools com inputSchema', async () => {
    const r = await rpc('tools/list', {});
    const nomes = r.result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(nomes, ['buscar_jurisprudencia', 'listar_tribunais', 'ler_resultados']);
    assert.strictEqual(r.result.tools[0].inputSchema.type, 'object');
  });

  it('tools/call executa e devolve content de texto', async () => {
    const r = await rpc('tools/call', { name: 'listar_tribunais', arguments: { segmento: 'superior' } });
    assert.strictEqual(r.result.content[0].type, 'text');
    assert.match(r.result.content[0].text, /stf/);
  });

  it('tools/call de tool inexistente marca isError sem derrubar', async () => {
    const r = await rpc('tools/call', { name: 'nao_existe', arguments: {} });
    assert.strictEqual(r.result.isError, true);
  });

  it('metodo desconhecido devolve erro JSON-RPC -32601', async () => {
    const r = await rpc('coisa/estranha', {});
    assert.strictEqual(r.error.code, -32601);
  });

  it('notificacao (sem id) nao devolve corpo', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.strictEqual(r.status, 202);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd jur && node --test tests/mcp.test.js`
Expected: FAIL — 404 em `/mcp` (o stub não registra nada)

- [ ] **Step 3: Implemente**

```js
// jur/servidor/mcp.js
const ferramentas = require('./ferramentas');
const { json, lerCorpo } = require('./http');

const PROTOCOLO = '2025-06-18';

function registrar(roteador, deps) {
  roteador.rota('POST', '/mcp', async (req, res) => {
    let pedido;
    try {
      pedido = await lerCorpo(req);
    } catch (e) {
      return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } });
    }

    const { id, method, params } = pedido;
    const ehNotificacao = id === undefined || id === null;

    const responder = (resultado) => {
      if (ehNotificacao) { res.writeHead(202); return res.end(); }
      return json(res, 200, { jsonrpc: '2.0', id, result: resultado });
    };
    const falhar = (code, message) => {
      if (ehNotificacao) { res.writeHead(202); return res.end(); }
      return json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
    };

    if (method === 'initialize') {
      return responder({
        protocolVersion: PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: 'jur', version: require('../package.json').version },
      });
    }

    if (method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }

    if (method === 'tools/list') {
      return responder({
        tools: ferramentas.definicoes().map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: d.input_schema,
        })),
      });
    }

    if (method === 'tools/call') {
      const nome = params && params.name;
      const conhecidas = new Set(ferramentas.definicoes().map((d) => d.name));
      const texto = await ferramentas.executar(nome, (params && params.arguments) || {}, deps);
      return responder({
        content: [{ type: 'text', text: texto }],
        isError: !conhecidas.has(nome),
      });
    }

    return falhar(-32601, `metodo nao suportado: ${method}`);
  });
}

module.exports = { registrar };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd jur && node --test tests/mcp.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Suba o servidor e valide contra um cliente MCP real**

Os testes provam o formato; só um cliente de verdade prova o protocolo.

```bash
cd jur && JUR_DADOS=/tmp/jur-dev node servidor/index.js &
claude mcp add --transport http jur-local http://localhost:3000/mcp
claude mcp list
```

Expected: `jur-local` aparece como conectado e as três tools são listadas.

**Se falhar:** não tente adivinhar o protocolo. Troque esta implementação por `@modelcontextprotocol/sdk` (`npm i @modelcontextprotocol/sdk`), mantendo `ferramentas.js` intacto — só o adaptador muda. Registre no commit que o caminho manual não passou e por quê.

- [ ] **Step 6: Commit**

```bash
git add jur/servidor/mcp.js jur/tests/mcp.test.js
git commit -m "publica as mesmas tres tools por MCP sobre HTTP para o container ficar de pe e o cliente so apontar a URL"
```

---

### Task 12: frontend skeleton

**Files:**
- Create: `jur/publico/index.html`
- Create: `jur/publico/estilo.css`
- Create: `jur/publico/app.js`

**Interfaces:**
- Consumes: `GET /api/v1/tribunais`, `POST /api/v1/chat` (SSE), `GET /api/v1/saude`
- Produces: nada consumido por outra task

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
  <header>
    <h1>jur</h1>
    <span id="saude" class="pastilha">verificando…</span>
    <input id="chave" type="password" placeholder="Chave da Anthropic (opcional)" autocomplete="off">
  </header>

  <main>
    <aside>
      <input id="filtro" type="search" placeholder="filtrar tribunal…">
      <p id="placar" class="placar"></p>
      <div id="tribunais"></div>
    </aside>

    <section class="conversa">
      <div id="mensagens"></div>
      <form id="formulario">
        <textarea id="entrada" rows="2" placeholder="Ex.: acórdãos do TRF4 sobre auxílio-acidente em 2024"></textarea>
        <button type="submit">Enviar</button>
      </form>
    </section>
  </main>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Escreva `estilo.css`**

```css
:root {
  --fundo: #101418; --painel: #171c22; --borda: #262d36;
  --texto: #e6e9ee; --fraco: #8a94a3;
  --ok: #3fb950; --instavel: #d29922; --bloqueado: #4d5560; --sessao: #58a6ff;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fundo); color: var(--texto);
       font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }

header { display: flex; align-items: center; gap: 12px; padding: 10px 16px;
         border-bottom: 1px solid var(--borda); background: var(--painel); }
header h1 { margin: 0; font-size: 18px; letter-spacing: .5px; }
header input { margin-left: auto; width: 280px; padding: 6px 10px; border-radius: 6px;
               border: 1px solid var(--borda); background: var(--fundo); color: var(--texto); }

main { display: grid; grid-template-columns: 320px 1fr; height: calc(100vh - 53px); }
aside { border-right: 1px solid var(--borda); padding: 12px; overflow-y: auto; }
aside > input { width: 100%; padding: 6px 10px; margin-bottom: 8px; border-radius: 6px;
                border: 1px solid var(--borda); background: var(--painel); color: var(--texto); }
.placar { margin: 0 0 10px; font-size: 12px; color: var(--fraco); }

.grupo { margin-bottom: 14px; }
.grupo h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .8px;
            color: var(--fraco); margin: 0 0 6px; }
.tribunal { display: flex; align-items: center; gap: 8px; padding: 5px 8px;
            border-radius: 6px; cursor: pointer; }
.tribunal:hover { background: var(--painel); }
.tribunal[data-disponivel="false"] { opacity: .45; cursor: not-allowed; }
.tribunal .sigla { font-weight: 600; min-width: 78px; }
.tribunal .nome { font-size: 12px; color: var(--fraco);
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bolinha { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; }
.bolinha[data-e="ok"] { background: var(--ok); }
.bolinha[data-e="instavel"] { background: var(--instavel); }
.bolinha[data-e="sem-acesso"] { background: var(--bloqueado); }
.bolinha[data-e="exige-sessao"] { background: var(--sessao); }

.conversa { display: flex; flex-direction: column; min-width: 0; }
#mensagens { flex: 1; overflow-y: auto; padding: 16px; }
.msg { max-width: 760px; margin: 0 0 14px; padding: 10px 14px; border-radius: 10px;
       white-space: pre-wrap; word-wrap: break-word; }
.msg.user { background: #1f6feb22; border: 1px solid #1f6feb55; margin-left: auto; }
.msg.assistant { background: var(--painel); border: 1px solid var(--borda); }
.msg.ferramenta { background: transparent; border: 1px dashed var(--borda);
                  color: var(--fraco); font-size: 12px; font-family: ui-monospace, monospace; }
.msg.erro { background: #f8514922; border: 1px solid #f8514966; }

form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--borda); }
form textarea { flex: 1; resize: none; padding: 8px 10px; border-radius: 8px;
                border: 1px solid var(--borda); background: var(--painel);
                color: var(--texto); font: inherit; }
form button { padding: 8px 18px; border-radius: 8px; border: 0;
              background: #1f6feb; color: #fff; font-weight: 600; cursor: pointer; }
form button:disabled { opacity: .5; cursor: default; }

.pastilha { font-size: 12px; padding: 2px 8px; border-radius: 999px;
            border: 1px solid var(--borda); color: var(--fraco); }
```

- [ ] **Step 3: Escreva `app.js`**

```js
// jur/publico/app.js
const $ = (s) => document.querySelector(s);
const CHAVE_LOCAL = 'jur.chave';

let tribunais = [];
const historico = [];

// ---------- chave: fica no browser, nunca no servidor ----------
const campoChave = $('#chave');
try { campoChave.value = localStorage.getItem(CHAVE_LOCAL) || ''; } catch { /* modo privado */ }
campoChave.addEventListener('change', () => {
  try { localStorage.setItem(CHAVE_LOCAL, campoChave.value.trim()); } catch { /* ignora */ }
});

// ---------- catalogo ----------
const SEGMENTOS = [
  ['superior', 'Superiores'], ['federal', 'Federais'], ['estadual', 'Estaduais'],
  ['trabalhista', 'Trabalhista'], ['contas', 'Contas'],
];

function pintarTribunais() {
  const termo = $('#filtro').value.trim().toLowerCase();
  const visiveis = tribunais.filter((t) =>
    !termo || t.comando.includes(termo) || t.nome.toLowerCase().includes(termo)
    || t.uf.some((u) => u.toLowerCase() === termo));

  const alvo = $('#tribunais');
  alvo.innerHTML = '';

  const ordem = [...SEGMENTOS.map(([k]) => k), null];
  for (const chave of ordem) {
    const doGrupo = visiveis.filter((t) => (chave === null ? !SEGMENTOS.some(([k]) => k === t.segmento) : t.segmento === chave));
    if (!doGrupo.length) continue;

    const grupo = document.createElement('div');
    grupo.className = 'grupo';
    const rotulo = (SEGMENTOS.find(([k]) => k === chave) || [null, 'Outros'])[1];
    grupo.innerHTML = `<h2>${rotulo} (${doGrupo.length})</h2>`;

    for (const t of doGrupo) {
      const linha = document.createElement('div');
      linha.className = 'tribunal';
      linha.dataset.disponivel = String(t.disponivel);
      // A nota vai no title: e o que impede ler "cinza" como "nao existe".
      linha.title = t.nota ? `${t.estado} — ${t.nota}` : t.estado;
      linha.innerHTML = `<span class="bolinha" data-e="${t.estado}"></span>`
        + `<span class="sigla">${t.comando}</span><span class="nome">${t.nome}</span>`;
      if (t.disponivel) {
        linha.addEventListener('click', () => {
          $('#entrada').value = `Busque no ${t.comando} sobre `;
          $('#entrada').focus();
        });
      }
      grupo.appendChild(linha);
    }
    alvo.appendChild(grupo);
  }
}

async function carregarTribunais() {
  const r = await fetch('/api/v1/tribunais');
  tribunais = (await r.json()).tribunais;
  const conta = (e) => tribunais.filter((t) => t.estado === e).length;
  $('#placar').textContent =
    `${tribunais.length} tribunais · ${conta('ok')} ok · ${conta('instavel')} instáveis · `
    + `${conta('sem-acesso')} bloqueados · ${conta('exige-sessao')} exigem sessão`;
  pintarTribunais();
}

$('#filtro').addEventListener('input', pintarTribunais);

// ---------- saude ----------
async function verificarSaude() {
  try {
    const r = await fetch('/api/v1/saude');
    $('#saude').textContent = r.ok ? 'online' : 'com problema';
  } catch {
    $('#saude').textContent = 'offline';
  }
}

// ---------- chat ----------
function bolha(classe, texto) {
  const div = document.createElement('div');
  div.className = `msg ${classe}`;
  div.textContent = texto;
  $('#mensagens').appendChild(div);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  return div;
}

/** Le um corpo SSE do fetch e chama aoEvento(nome, dados) por evento completo. */
async function lerSSE(resposta, aoEvento) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    const partes = buffer.split('\n\n');
    buffer = partes.pop();
    for (const parte of partes) {
      const nome = (parte.match(/^event: (.+)$/m) || [])[1];
      const dado = (parte.match(/^data: (.+)$/m) || [])[1];
      if (!nome || !dado) continue;          // linha de ping
      try { aoEvento(nome, JSON.parse(dado)); } catch { /* ignora fragmento */ }
    }
  }
}

$('#formulario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#entrada').value.trim();
  if (!texto) return;

  const botao = $('#formulario button');
  botao.disabled = true;
  $('#entrada').value = '';
  bolha('user', texto);
  historico.push({ role: 'user', content: texto });

  let destino = null;
  try {
    const cabecalhos = { 'content-type': 'application/json' };
    if (campoChave.value.trim()) cabecalhos['x-api-key'] = campoChave.value.trim();

    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cabecalhos, body: JSON.stringify({ mensagens: historico }),
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
        historico.push({ role: 'assistant', content: dados.texto });
      } else if (nome === 'erro') {
        bolha('erro', dados.erro);
      }
    });
  } catch (erro) {
    bolha('erro', erro.message);
  } finally {
    botao.disabled = false;
  }
});

carregarTribunais();
verificarSaude();
setInterval(verificarSaude, 30000);
```

- [ ] **Step 4: Suba e confira na mão**

```bash
cd jur && JUR_DADOS=/tmp/jur-dev node servidor/index.js
```

Abra `http://localhost:3000` e confirme, um a um:
1. a lista de tribunais aparece agrupada por segmento;
2. o placar mostra as contagens dos quatro estados;
3. `stj` e `tjsp` aparecem **cinza e não clicáveis**;
4. passar o mouse sobre `trf1` mostra a nota (base congelada em 07/2025);
5. o filtro por `pr` acha `tjpr` e `tcepr`;
6. clicar num tribunal verde preenche a caixa de mensagem;
7. a pastilha de saúde diz `online`.

- [ ] **Step 5: Commit**

```bash
git add jur/publico/
git commit -m "poe a interface local no ar sem build nenhum — tribunal bloqueado nasce cinza e a ressalva do instavel fica a um hover de distancia"
```

---

### Task 13: `compose.yml`, volumes e documentação

**Files:**
- Create: `infra/compose.yml`
- Create: `.dockerignore`
- Modify: `infra/README.md` (seção de execução)
- Modify: `README.md` (seção nova)

- [ ] **Step 1: Escreva o `.dockerignore`**

```
node_modules
jur/node_modules
jur/resultados
.git
docs
agente-diario
**/.DS_Store
```

- [ ] **Step 2: Escreva o `compose.yml`**

Se a Task 3 concluiu que o **nível 1** bastou, deixe `security_opt` comentado. Se foi o nível 2, descomente. Se foi o nível 3, descomente `JUR_BROWSER_ARGS`.

```yaml
# infra/compose.yml
services:
  jur:
    build:
      context: ..
      dockerfile: infra/Dockerfile
    image: jur:dev
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      JUR_DADOS: /dados
      TMPDIR: /cache
      JUR_CONCORRENCIA: "3"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}"
      # JUR_BROWSER_ARGS: "--no-sandbox --disable-dev-shm-usage"   # so no nivel 3
    volumes:
      - jur-dados:/dados
      - jur-cache:/cache
    # security_opt:                                                # so no nivel 2
    #   - seccomp=./chrome-seccomp.json
    # 3 Chromium simultaneos ~ 900 MB, mais o Node. Abaixo de 2g o OOM killer aparece.
    mem_limit: 2g
    # Chromium usa /dev/shm; o default de 64 MB do Docker faz a aba morrer sozinha.
    shm_size: 1gb
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/v1/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  jur-dados:
  jur-cache:
```

- [ ] **Step 3: Suba pelo compose**

```bash
cd infra && docker compose up -d --build && docker compose ps
```
Expected: serviço `jur` em `running` e, após ~15s, `healthy`.

- [ ] **Step 4: Valide o caminho completo dentro do container**

```bash
curl -s localhost:3000/api/v1/saude
curl -s "localhost:3000/api/v1/tribunais?segmento=superior" | head -c 300
ID=$(curl -s -X POST localhost:3000/api/v1/buscas -H 'content-type: application/json' \
      -d '{"tribunal":"tcepe","query":"licitacao","maxPaginas":1}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
sleep 25 && curl -s localhost:3000/api/v1/buscas/$ID
curl -s "localhost:3000/api/v1/buscas/$ID/resultados?limite=2"
```
Expected: saúde `{"ok":true}`; a busca chega a `concluido`; os resultados voltam paginados.

- [ ] **Step 5: Confirme que a persistência sobrevive ao restart**

```bash
docker compose restart jur && sleep 15 && curl -s localhost:3000/api/v1/buscas | head -c 300
```
Expected: a busca do Step 4 ainda aparece — o volume funciona.

- [ ] **Step 6: Documente no `README.md` da raiz**

Acrescente, logo depois da seção "Usar a CLI":

```markdown
## Rodar em container (com browser, API, MCP e interface)

Ambiente fechado: Node 22, Chromium travado pelo `package-lock` e todas as dependências
dentro da imagem. Funciona igual em macOS, Linux e Windows/WSL.

    cd infra && docker compose up -d --build

Abra `http://localhost:3000`. A interface tem o chat, a lista de tribunais com o estado de
cada um (verde ok · amarelo instável · cinza bloqueado · azul exige sessão) e o campo da
chave da Anthropic — que fica no seu browser, nunca no servidor.

A mesma API serve três clientes:

| Superfície | Endereço |
|---|---|
| REST | `http://localhost:3000/api/v1` |
| MCP | `http://localhost:3000/mcp` (`claude mcp add --transport http jur http://localhost:3000/mcp`) |
| Interface | `http://localhost:3000` |

Exemplo de busca por REST:

    curl -X POST localhost:3000/api/v1/buscas -H 'content-type: application/json' \
      -d '{"tribunal":"trf4","query":"auxilio-acidente","dataInicio":"01/01/2024"}'

Ressalvas do container estão em [`infra/README.md`](infra/README.md) — em especial `trf3`
(exige Chrome proprietário) e `crps` (exige login Gov.br, que valida dispositivo).
```

- [ ] **Step 7: Rode a suíte inteira uma última vez**

Run: `cd jur && npm test`
Expected: PASS

Run: `cd jur && npm run smoke`
Expected: `OK  reconciliacao catalogo x CLI` presente

- [ ] **Step 8: Commit**

```bash
git add infra/compose.yml infra/README.md .dockerignore README.md
git commit -m "fecha o ambiente num compose com volume para o token do WAF e shm que o Chromium precisa — e documenta trf3 e crps como as duas excecoes que o container nao resolve"
```
