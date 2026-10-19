# Kaizen — entrega 2 (JurCrawler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda falha de busca do JurCrawler (explícita, filtro ignorado em silêncio, resgate e relato do usuário) chega ao FFD com print, HTML, passo, rota e filtros, e a sentinela diária confere cada tribunal × capacidade.

**Architecture:** A captura acontece no processo filho (`src/navegadorPreload.js`, carregado sempre pelo executor), que grava `<jobId>.falha/` antes de sair; o executor dá 8 s de prazo via `SIGUSR2` antes de matar no timeout. No servidor, um módulo novo `servidor/kaizen/` classifica, monta assinatura, confere filtros (módulo puro) e põe tudo numa outbox SQLite global (`<JUR_DADOS>/kaizen.db`) drenada para os webhooks do FFD. O widget do issue-reporter é copiado sem alterar; o núcleo `report.ts`/`linear.ts` é portado para CommonJS; uma sentinela com agendador próprio roda às 04:00 SP.

**Tech Stack:** Node 22, CommonJS, `node:sqlite`, `node:zlib`, `node:test`, Playwright 1.57, nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-18-kaizen-falhas-design.md` — seções 1–6 e as decisões 1, 2, 3, 4, 6 e 7 de "Decisões após a revisão do builder", que **substituem** o texto anterior onde houver conflito.

## Global Constraints

- Trabalho na branch `feat/kaizen` (a partir de `main`); comentários em português no estilo do repo (por quê, não o quê).
- Testes: `cd jur && npm test` (`node --test "tests/*.test.js"`). Nada de dependência nova nem build TS.
- **Nunca lança, nunca atrasa:** toda chamada ao Kaizen a partir de `jobs.js`/`executor.js` fica em try/catch; gzip e leitura de captura são assíncronos; nada do Kaizen segura vaga do pool nem transforma sucesso em erro.
- **Segredo nunca sai:** token Kernel/Steel/CDP, cookie, chave de API ou chave pessoal não entram em payload, `meta.json`, URL ou erro enviado. URL sempre sem query. `navegadorPreload.js` mantém a troca de erro de CDP por `Não foi possível conectar ao navegador remoto.`
- **Na dúvida, `nao_verificavel`, nunca falha.** Menos de 3 resultados com o campo parseável (para `numero`, menos de 1) ou relator `forma: codigo` = `nao_verificavel`; `ignorado` só com **mais de 50%** violando.
- Cancelamento pelo usuário não é falha. Zero resultados com página normal não é falha. `vazio_suspeito` só na sentinela.
- Assinatura: `tribunal|classe|passo|erro_normalizado` (sequência de dígitos → `#`, sem acento, minúsculo, URLs e ids removidos), cortada em 200 caracteres.
- Webhook: `POST ${KAIZEN_WEBHOOK_URL}/<source>` com cabeçalho `x-webhook-token: ${KAIZEN_WEBHOOK_TOKEN}` (aceito por `lib/webhook-auth.ts` do FFD; não pôr token na query). Sources: `jur-diagnostico`, `user-issues`.
- Outbox: drenagem a cada 60 s e logo após enfileirar; 2xx apaga; 408/429/5xx/rede → backoff 1, 5, 15, 60 min e depois de hora em hora; descarta após 48 h; outro 4xx descarta e loga; teto 200 MB / 5000 itens (descarta os mais velhos). HTML > 4 MB vai truncado com aviso.
- `usuario_hash` = SHA256(`usuario_id` + `KAIZEN_SALT`); sem `KAIZEN_SALT`, o campo vai `null`. Nunca e-mail no `jur-diagnostico`.
- Linear BRU: `titleTemplate: "[jur] {title} ({author})"`, `moduleGroup: null`, `typeGroup: null`, `alwaysLabels: []`, `initialStateName: "Todo"`. Sem `LINEAR_API_KEY`+`LINEAR_TEAM_ID` → `enabled:false`. Nenhuma chave no browser.
- `widget.js` copiado byte a byte de `/Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/widget.js`. O alvo novo no `sync.sh` do FFD é da entrega 1; aqui só se confere.
- Envs novas: `KAIZEN_WEBHOOK_URL`, `KAIZEN_WEBHOOK_TOKEN`, `KAIZEN_SALT`, `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `JUR_SENTINELA` (`1` liga; desligada por padrão), `JUR_SENTINELA_MAX_REMOTO` (padrão 6). Todas entram em `infra/compose.yml` (`environment:` só repassa o que está listado), `infra/.env.example` e `infra/README.md`.
- Versão: `jur/package.json` 1.0.1 → **1.1.0** + `CHANGELOG.md`.
- Produção depende da **entrega 1 (FFD) já implantada** e da endpoint key `jurcrawler` (sources `jur-diagnostico,user-issues`) criada nela.

## Review Focus

1. **Instrumentação sempre ligada não pode mudar o comportamento de crawler que abre dois navegadores** (STJNavigator tem dois `chromium.launch`): a trava "já possui um navegador em uso" só vale quando há ponte ou CDP, como hoje — teste na Task 4.
2. **`process.exit(1)` interceptado sem página aberta, ou com página que trava `screenshot`/`content`**, tem que sair em ≤ 8 s com `meta.json` mesmo assim — teste na Task 4 (página cujo `screenshot` nunca resolve).
3. **Resultado cujo campo de data vem em formato não reconhecido** (`Sessão de 12 de Setembro de 2024`, string vazia) não pode virar violação: conta como "sem campo" → `nao_verificavel` — teste na Task 3 com o fixture `tcepa`.
4. **Erro do crawler com URL CDP da Steel (`wss://connect.steel.dev?apiKey=...`) ou `Bearer ...`** não pode chegar ao payload nem à assinatura — teste na Task 1 e de novo no payload (Task 7).
5. **FFD fora do ar por horas com muitas falhas** não pode crescer o banco sem limite nem travar o event loop: teto de itens/bytes e um envio por vez — teste na Task 6.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `jur/servidor/kaizen/assinatura.js` (novo) | `sanitizar`, `normalizarErro`, `montarAssinatura` — puro |
| `jur/servidor/kaizen/classificar.js` (novo) | erro + rota → classe; rótulo do navegador → rota — puro |
| `jur/servidor/kaizen/normalizar.js` (novo) | nomes de campo por crawler → forma única; parse de data — puro |
| `jur/servidor/kaizen/conferencia.js` (novo) | `conferir(params, resultados)` e texto do aviso — puro |
| `jur/servidor/kaizen/captura.js` (novo) | caminho `<arquivo>.falha/`, leitura + gzip/base64 assíncronos |
| `jur/servidor/kaizen/outbox.js` (novo) | tabela `kaizen_envio`, drenagem, backoff, teto |
| `jur/servidor/kaizen/payload.js` (novo) | montagem dos corpos `jur-diagnostico` e `user-issues` |
| `jur/servidor/kaizen/index.js` (novo) | `criarKaizen` (fachada que nunca lança) e `kaizenNulo` |
| `jur/servidor/kaizen/sentinela.js` (novo) | seleção, avaliação e rodada da sentinela |
| `jur/servidor/kaizen/agenda.js` (novo) | próximo 04:00 SP, segunda-feira, `setTimeout` encadeado |
| `jur/servidor/issue-reporter/{contract,linear,report}.js` (novos) | porta fiel do núcleo TS |
| `jur/servidor/issue-reporter/config.js` (novo) | a cola: ENV + principal → `ReporterConfig` |
| `jur/servidor/rotas/relatos.js` (novo) | `GET /api/v1/relatos/meta`, `POST /api/v1/relatos` |
| `jur/src/navegadorPreload.js` | registra páginas sempre, captura em `exit≠0` e `SIGUSR2` |
| `jur/servidor/executor.js` | preload sempre, `JUR_FALHA_DIR`, prazo de 8 s no timeout |
| `jur/servidor/db.js` | v5: `job.resolvido_pelo_usuario`, `job.navegador_falhas` |
| `jur/servidor/navegadores/registro.js` | `resolvidoPeloUsuario(id)` |
| `jur/servidor/navegadores/remotos.js` | exporta `FALHA_DO_FORNECEDOR` |
| `jur/servidor/jobs.js` | chama o Kaizen nos ramos `erro` e `concluido`; grava as colunas novas |
| `jur/servidor/escopo.js` | `executarNaRota` em nível de módulo; repassa kaizen; `ocupado()` |
| `jur/servidor/aplicacao.js`, `index.js`, `aviso-deploy.js`, `openapi.js` | fiação, agenda da sentinela, rotas novas |
| `jur/publico/issue-reporter/widget.js` (cópia), `jur/publico/relatar.js` (novo), `index.html`, `decisoes.js` | montar o widget só logado; `window.jurBuscaVisivel` |
| `jur/tests/sentinela.js`, `jur/tests/sentinela-casos.json` (novos) | CLI manual e casos reais |
| `jur/tests/fixtures/kaizen/resultados/*.json` (novos) | recortes reais de `jur/resultados/` (pasta não versionada) |
| `infra/{compose.yml,.env.example,README.md}`, `docs/kaizen.md` (novo), `CHANGELOG.md`, `jur/package.json` | envs, docs, versão |

---

### Task 1: Assinatura e classificação do erro

**Files:**
- Create: `jur/servidor/kaizen/assinatura.js`, `jur/servidor/kaizen/classificar.js`
- Modify: `jur/servidor/navegadores/remotos.js` (só acrescentar `FALHA_DO_FORNECEDOR` ao `module.exports`)
- Test: `jur/tests/kaizen-assinatura.test.js`

**Interfaces:**
- Produces:
  - `sanitizar(texto: string): string` — URL `wss://…` inteira vira `[cdp]`; outras URLs perdem a query; `(api[-_]?key|apikey|token|session_?id|senha|password)=…` e `Bearer …` viram `[redigido]`.
  - `normalizarErro(texto: string): string` — sanitiza, fica com a 1ª linha + a 1ª linha `waiting for …` do call log do Playwright (se houver), tira URLs, uuid e ids hex (≥ 8 hex com dígito), NFD sem acento, minúsculo, sequência de dígitos → `#`, espaços colapsados.
  - `montarAssinatura({ tribunal, classe, passo, erro }): string` — `passo` vazio → `desconhecido`; resultado `.slice(0, 200)`.
  - `classificar({ erro: string, rota: 'local'|'remoto'|null }): string` — ordem (primeira que bater): `fornecedor_remoto` (`/Nenhum navegador remoto disponível|Não foi possível conectar ao navegador remoto|Navegador remoto não configurado/i`, ou `rota==='remoto'` e `FALHA_DO_FORNECEDOR`), `bloqueio_ip` (rota ≠ remoto e `/HTTP 403|\b403\b|ERR_CONNECTION_(REFUSED|RESET|CLOSED)|ERR_HTTP2_PROTOCOL_ERROR/`), `captcha` (`/captcha|turnstile|recaptcha|verificação ainda não foi concluída/i`), `timeout` (`/^timeout apos \d+ms/`), `seletor` (`/waiting for (locator|selector)|waitForSelector/i`), `timeout` (`/Timeout \d+ms exceeded|TimeoutError/`), `desconhecido`.
  - `rotaDoNavegador(rotulo: string|null): 'local'|'remoto'|null` — `Servidor ProcStudio` → `local`; `Kernel`, `Steel`, `Browserbase` (com ou sem `(reserva)`) → `remoto`; vazio → `null`.

- [ ] **Step 1: Criar a branch**

Run: `cd /Users/brpl/code/ProcStudio/prc_jur_crawler && git switch -c feat/kaizen`
Expected: `Switched to a new branch 'feat/kaizen'`

- [ ] **Step 2: Write the failing test** (`tests/kaizen-assinatura.test.js`)

```js
test('timeout do Playwright em locator: classe seletor, numeros viram #', () => {
  const erro = "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#resultado')";
  assert.equal(classificar({ erro, rota: 'local' }), 'seletor');
  assert.equal(normalizarErro(erro), "locator.click: timeout #ms exceeded. waiting for locator('#resultado')");
});
test('timeout do executor vence o seletor', () => {
  assert.equal(classificar({ erro: 'timeout apos 600000ms', rota: 'local' }), 'timeout');
});
test('403 na rota local e bloqueio_ip; na remota e fornecedor_remoto', () => {
  assert.equal(classificar({ erro: 'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://web.trf3.jus.br/x', rota: 'local' }), 'bloqueio_ip');
  assert.equal(classificar({ erro: 'HTTP 403', rota: 'remoto' }), 'fornecedor_remoto');
  assert.equal(classificar({ erro: 'Nenhum navegador remoto disponível (Kernel: HTTP 500).', rota: null }), 'fornecedor_remoto');
});
test('captcha da pausa assistida', () => {
  assert.equal(classificar({ erro: 'O prazo para resolver o CAPTCHA expirou. Inicie uma nova busca.', rota: 'remoto' }), 'captcha');
});
test('erro qualquer e desconhecido', () => {
  assert.equal(classificar({ erro: 'Cannot read properties of undefined', rota: 'local' }), 'desconhecido');
});
test('sem acento, sem URL, mesma assinatura para numeros diferentes', () => {
  assert.equal(normalizarErro('Não foi possível conectar ao navegador remoto.'), 'nao foi possivel conectar ao navegador remoto.');
  const a = montarAssinatura({ tribunal: 'trf4', classe: 'seletor', passo: '', erro: 'Timeout 30000ms exceeded' });
  const b = montarAssinatura({ tribunal: 'trf4', classe: 'seletor', passo: '', erro: 'Timeout 45000ms exceeded' });
  assert.equal(a, b);
  assert.equal(a, 'trf4|seletor|desconhecido|timeout #ms exceeded');
  assert.ok(montarAssinatura({ tribunal: 't', classe: 'c', passo: 'p', erro: 'x'.repeat(500) }).length <= 200);
});
test('segredo nunca sobrevive (Review Focus 4)', () => {
  const erro = 'connect wss://connect.steel.dev?apiKey=SEGREDO1&sessionId=abc falhou; Authorization: Bearer SEGREDO2; https://x.br/a?token=SEGREDO3';
  for (const s of [sanitizar(erro), normalizarErro(erro)]) assert.doesNotMatch(s, /SEGREDO/);
  assert.match(sanitizar('https://x.br/a/b?q=1'), /https:\/\/x\.br\/a\/b(?!\?)/);
});
test('rota pelo rotulo do navegador', () => {
  assert.equal(rotaDoNavegador('Servidor ProcStudio'), 'local');
  assert.equal(rotaDoNavegador('Steel (reserva)'), 'remoto');
  assert.equal(rotaDoNavegador(null), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd jur && node --test tests/kaizen-assinatura.test.js`
Expected: FAIL com `Cannot find module '../servidor/kaizen/assinatura'`

- [ ] **Step 4: Implement** `assinatura.js` e `classificar.js` com as assinaturas acima; `classificar.js` importa `FALHA_DO_FORNECEDOR` de `../navegadores/remotos`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd jur && node --test tests/kaizen-assinatura.test.js tests/navegadores-remotos.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add jur/servidor/kaizen/assinatura.js jur/servidor/kaizen/classificar.js jur/servidor/navegadores/remotos.js jur/tests/kaizen-assinatura.test.js
git commit -m "feat(kaizen): assinatura e classificacao de falha"
```

---

### Task 2: Normalização de resultados + fixtures reais

**Files:**
- Create: `jur/servidor/kaizen/normalizar.js`, `jur/tests/fixtures/kaizen/resultados/<tribunal>.json` (um por `jur/resultados/results-<tribunal>.json` com ≥ 3 itens)
- Test: `jur/tests/kaizen-normalizar.test.js`

**Interfaces:**
- Produces:
  - `ALIASES: { numeroProcesso: string[], dataJulgamento: string[], dataPublicacao: string[], relator: string[], orgaoJulgador: string[], juizado: string[] }` — ponto de partida: `numeroProcesso: ['numeroProcesso','processo','processoNumero','numero']`, `dataJulgamento: ['dataJulgamento','dataDecisao','dataSessao']`, `dataPublicacao: ['dataPublicacao','dataPublicacaoDoe']`, `relator: ['relator','relatorAcordao','relatores']`, `orgaoJulgador: ['orgaoJulgador','orgaoJulgadorColegiado','colegiado']`, `juizado: ['juizado']`. O teste de cobertura decide o resto.
  - `CAMPOS_IGNORADOS: Set<string>` — chaves que casam `/data|relator|processo|orgao|juizado/i` e de propósito não são conferidas (ex.: `dataAutuacao`, `dataJuntada`, `processoUrl`, `cargoRelator`, `orgaoJulgadorOrigem`, `relatorDesignado`), cada uma com o motivo em comentário.
  - `parseData(v: unknown): number|null` — aceita `DD/MM/AAAA` e prefixo ISO `AAAA-MM-DD` (lê a data literal, sem converter fuso); devolve `Date.UTC` do dia; qualquer outra coisa (inclusive `Sessão de 12 de Setembro de 2024`, `''`) → `null`.
  - `normalizarResultado(r: object): { numeroProcesso: string|null, dataJulgamento: number|null, dataPublicacao: number|null, relator: string|null, orgaoJulgador: string|null, juizado: boolean|null }` — primeiro alias preenchido vence; array de relatores vira texto unido por `; `; `juizado` só se for booleano.

- [ ] **Step 1: Gerar os fixtures a partir dos resultados reais** (a pasta `jur/resultados/` não é versionada; o recorte é)

Run (de `jur/`):
```bash
node -e '
const fs=require("fs"),p=require("path");const o="tests/fixtures/kaizen/resultados";fs.mkdirSync(o,{recursive:true});
for(const f of fs.readdirSync("resultados").filter(f=>/^results-.+\.json$/.test(f))){
 let b;try{b=JSON.parse(fs.readFileSync(p.join("resultados",f),"utf8"))}catch{continue}
 const l=Array.isArray(b)?b:(b.results||b.resultados||[]);if(!Array.isArray(l)||l.length<3)continue;
 const itens=l.slice(0,12).map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>/data|relator|processo|orgao|juizado|colegiado|numero/i.test(k))));
 fs.writeFileSync(p.join(o,f.replace(/^results-/,"")),JSON.stringify({origem:"resultados/"+f,itens},null,1)+"\n")}'
ls tests/fixtures/kaizen/resultados | wc -l
```
Expected: ≥ 35 arquivos (trf4, tjdft, tcepa, tjpb, tjpr, stf…). Conferir no diff que nenhum fixture tem e-mail, CPF ou link com token.

- [ ] **Step 2: Write the failing test** (`tests/kaizen-normalizar.test.js`)

```js
test('parseData aceita DD/MM/AAAA e ISO, recusa o resto', () => {
  assert.equal(parseData('05/03/2025'), Date.UTC(2025, 2, 5));
  assert.equal(parseData('2025-03-05T23:30:00-03:00'), Date.UTC(2025, 2, 5));
  assert.equal(parseData('Sessão de 12 de Setembro de 2024'), null);
  assert.equal(parseData(''), null);
  assert.equal(parseData('31/02/2025'), null);
});
test('processo e numeroProcesso dao o mesmo campo', () => {
  assert.equal(normalizarResultado({ processo: '5000167-52.2021.4.04.7014' }).numeroProcesso, '5000167-52.2021.4.04.7014');
  assert.equal(normalizarResultado({ numeroProcesso: '1', processo: '2' }).numeroProcesso, '1');
});
test('juizado booleano vale; texto nao', () => {
  assert.equal(normalizarResultado({ juizado: false }).juizado, false);
  assert.equal(normalizarResultado({ juizado: 'sim' }).juizado, null);
});
test('todo campo de data/relator/processo/orgao/juizado dos fixtures e reconhecido ou ignorado de proposito', () => {
  const conhecidos = new Set(Object.values(ALIASES).flat());
  const faltando = [];
  for (const f of fs.readdirSync(DIR)) for (const r of lerFixture(f).itens) for (const k of Object.keys(r))
    if (/data|relator|processo|orgao|juizado/i.test(k) && !conhecidos.has(k) && !CAMPOS_IGNORADOS.has(k)) faltando.push(`${f}:${k}`);
  assert.deepEqual([...new Set(faltando)], []);
});
test('cada fixture com numero tem numeroProcesso normalizado em todos os itens', () => {
  for (const f of fs.readdirSync(DIR)) {
    const itens = lerFixture(f).itens;
    if (!itens.some((r) => Object.keys(r).some((k) => ALIASES.numeroProcesso.includes(k)))) continue;
    assert.ok(itens.every((r) => normalizarResultado(r).numeroProcesso), f);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd jur && node --test tests/kaizen-normalizar.test.js`
Expected: FAIL com `Cannot find module '../servidor/kaizen/normalizar'`

- [ ] **Step 4: Implement** `normalizar.js`; rodar o teste de cobertura, e para cada chave apontada decidir: alias (é o mesmo dado) ou `CAMPOS_IGNORADOS` (é outro dado), com uma linha de motivo.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd jur && node --test tests/kaizen-normalizar.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add jur/servidor/kaizen/normalizar.js jur/tests/kaizen-normalizar.test.js jur/tests/fixtures/kaizen
git commit -m "feat(kaizen): normalizarResultado com nomes de campo de cada crawler"
```

---

### Task 3: Conferência de filtros

**Files:**
- Create: `jur/servidor/kaizen/conferencia.js`
- Test: `jur/tests/kaizen-conferencia.test.js`

**Interfaces:**
- Consumes: `normalizarResultado`, `parseData` (Task 2); `relator.obter(comando)` de `servidor/relator.js`.
- Produces:
  - `FILTROS = ['periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'numero']` (mesmos nomes das chaves de `capacidades.js`).
  - `conferir(params: object, resultados: object[], { comando: string }): Array<{ filtro, veredito: 'ok'|'ignorado'|'nao_verificavel', detalhe: string, comCampo: number, violam: number, exemplos: object[] }>` — só filtros presentes em `params` (`dataInicio`/`dataFim`; `dataPubInicio`/`dataPubFim`; `relator`; `juizados === true`; `numero`). `exemplos`: até 5 violadores com só o(s) campo(s) conferido(s) + `numeroProcesso`, valores crus.
  - `normalizarNome(s: string): string` — sem acento, minúsculo, sem pontuação, sem os tokens `des`, `desa`, `min`, `ministro(a)`, `juiz(a)`, `desembargador(a)`, `convocado(a)`; espaços colapsados.
  - `avisoDoFiltro(item): string` — texto exato: `o tribunal parece ter ignorado o filtro de data: ${violam} de ${comCampo} resultados fora do período` (`periodoJulgamento`); `… filtro de data de publicação: … fora do período`; `… filtro de magistrado: ${violam} de ${comCampo} resultados de outro relator`; `… filtro de juizados: … resultados fora de turmas recursais e juizados`; `… filtro de número: … resultados com outro número`.
- Regras: período inclusivo com tolerância de 1 dia nas duas pontas; relator ok se um normalizado contém o outro; juizados: booleano `juizado` vence, senão `/turma recursal|juizado|\bjef\b|\btr\b|turma regional de uniformiza/i` em `orgaoJulgador`; número: corta em `/`, compara só dígitos.

- [ ] **Step 1: Write the failing test** (`tests/kaizen-conferencia.test.js`; `fx(nome)` lê `tests/fixtures/kaizen/resultados/<nome>.json`, `faixa(itens)` devolve min/máx de `dataJulgamento` em `DD/MM/AAAA`)

```js
test('data: resultado saudavel do trf4 nao e marcado (falso positivo)', () => {
  const { itens } = fx('trf4'); const [di, df] = faixa(itens);
  const [c] = conferir({ query: 'x', dataInicio: di, dataFim: df }, itens, { comando: 'trf4' });
  assert.deepEqual([c.filtro, c.veredito], ['periodoJulgamento', 'ok']);
});
test('data: periodo pedido dois anos antes de todos os julgados = ignorado com exemplos', () => {
  const { itens } = fx('trf4');
  const [c] = conferir({ dataInicio: '01/01/2001', dataFim: '31/12/2001' }, itens, { comando: 'trf4' });
  assert.equal(c.veredito, 'ignorado');
  assert.ok(c.exemplos.length > 0 && c.exemplos.length <= 5);
  assert.deepEqual(Object.keys(c.exemplos[0]).sort(), ['dataJulgamento', 'numeroProcesso']);
  assert.match(avisoDoFiltro(c), /^o tribunal parece ter ignorado o filtro de data: \d+ de \d+ resultados fora do período$/);
});
test('tolerancia de 1 dia', () => {
  const r = [1, 2, 3].map(() => ({ dataJulgamento: '01/03/2025', numeroProcesso: 'n' }));
  assert.equal(conferir({ dataInicio: '02/03/2025' }, r, { comando: 'trf4' })[0].veredito, 'ok');
});
test('menos de 3 com data parseavel = nao_verificavel (tcepa, Review Focus 3)', () => {
  assert.equal(conferir({ dataInicio: '01/01/2001', dataFim: '31/12/2001' }, fx('tcepa').itens, { comando: 'tcepa' })[0].veredito, 'nao_verificavel');
  assert.equal(conferir({ dataInicio: '01/01/2001' }, fx('trf4').itens.slice(0, 2), { comando: 'trf4' })[0].veredito, 'nao_verificavel');
});
test('exatamente 50% violando ainda e ok', () => {
  const r = [{ dataJulgamento: '01/01/2001' }, { dataJulgamento: '01/01/2001' }, { dataJulgamento: '05/03/2025' }, { dataJulgamento: '05/03/2025' }];
  assert.equal(conferir({ dataInicio: '01/03/2025', dataFim: '31/03/2025' }, r, { comando: 'trf4' })[0].veredito, 'ok');
});
test('magistrado: nome com Des. e sem acento casa; outro nome = ignorado; codigo = nao_verificavel', () => {
  const { itens } = fx('trf4'); const nome = itens.find((r) => r.relator).relator;
  const mesmos = itens.filter((r) => r.relator === nome);
  assert.equal(conferir({ relator: `Des. ${nome.normalize('NFD').replace(/\p{M}/gu, '')}` }, mesmos, { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ relator: 'Fulano Inexistente da Silva' }, itens, { comando: 'trf4' })[0].veredito, 'ignorado');
  assert.equal(conferir({ relator: '12345' }, fx('tjpb').itens, { comando: 'tjpb' })[0].veredito, 'nao_verificavel');
});
test('juizados: booleano juizado:false do tjdft vence o texto do orgao', () => {
  assert.equal(conferir({ juizados: true }, fx('tjdft').itens, { comando: 'tjdft' })[0].veredito, 'ignorado');
  const tr = [1, 2, 3].map(() => ({ orgaoJulgador: '3ª TURMA RECURSAL DO PR' }));
  assert.equal(conferir({ juizados: true }, tr, { comando: 'trf4' })[0].veredito, 'ok');
});
test('numero: sufixo /TRF4 e mascara ignorados; basta 1 resultado', () => {
  assert.equal(conferir({ numero: '50571353820214047100' }, [{ numeroProcesso: '5057135-38.2021.4.04.7100/TRF4' }], { comando: 'trf4' })[0].veredito, 'ok');
  assert.equal(conferir({ numero: '5057135-38.2021.4.04.7100' }, [{ processo: '5000167-52.2021.4.04.7014' }], { comando: 'trf4' })[0].veredito, 'ignorado');
});
test('sem filtro pedido, sem item; juizados:false nao confere', () => {
  assert.deepEqual(conferir({ query: 'x', juizados: false }, fx('trf4').itens, { comando: 'trf4' }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jur && node --test tests/kaizen-conferencia.test.js`
Expected: FAIL com `Cannot find module '../servidor/kaizen/conferencia'`

- [ ] **Step 3: Implement** `conferencia.js` com as regras acima. Se algum fixture saudável for marcado `ignorado`, a regra está errada — não o fixture.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd jur && node --test tests/kaizen-conferencia.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/kaizen/conferencia.js jur/tests/kaizen-conferencia.test.js
git commit -m "feat(kaizen): conferencia de filtros de data, magistrado, juizados e numero"
```

---

### Task 4: Captura no processo filho (`navegadorPreload.js`)

**Files:**
- Modify: `jur/src/navegadorPreload.js`
- Test: `jur/tests/navegador-preload.test.js` (novo)

**Interfaces:**
- Produces:
  - `instrumentarChromium(chromium, ponte, { cdp, exclusivo, aoPagina })` — embrulha `launch` **e** `connectOverCDP` (o `FalcaoNavigator` chama este direto); toda página de todo contexto vai para `ponte.anexarPagina` e `aoPagina`; `WeakSet` evita registro duplo. A trava "Esta execução já possui um navegador em uso." só quando `exclusivo` (= ponte ativa ou CDP), como hoje. Erro de CDP continua trocado por `Não foi possível conectar ao navegador remoto.`
  - `criarCaptura({ dir, tribunal, rota, prazoMs = 8000 }) → { anexarPagina(page), capturar(): Promise<void> }` — página mais recente não fechada; `page.screenshot({ type: 'png', fullPage: false })`, `page.content()`, `page.url()`, `page.title()`, cada um com corrida contra o prazo restante; grava `tela.png`, `pagina.html` (se obtidos) e **sempre** `meta.json` `{ url, titulo, passo, tribunal, rota, erro: null, em }` (`erro` é preenchido pelo servidor). Idempotente (segunda chamada devolve a mesma promise). Nunca lança.
  - `derivarPasso(url, titulo): string` — `globalThis.__jurPasso` se definido; senão `pagina:<host><path>` com dígitos → `#`, cortado em 80; sem URL → `desconhecido`.
  - `urlSemQuery(url): string` — origem + caminho; inválida → `''`.
  - `instalarSaida(captura, processo = process)` — troca `processo.exit` por versão que, com código ≠ 0, aguarda `captura.capturar()` e então chama o `exit` original com o mesmo código; `SIGUSR2` → captura e sai com código 1.
- No carregamento do módulo: só instala quando `process.env.JUR_FALHA_DIR` existe (o executor define); `tribunal = process.argv[2]`, `rota = JUR_BROWSER_CDP ? 'remoto' : 'local'`. Instrumentação de páginas sempre; ponte e CDP como hoje.

- [ ] **Step 1: Write the failing test** (`tests/navegador-preload.test.js`, com página falsa `{ isClosed, screenshot, content, url, title, once }` e diretório em `os.tmpdir()`)

```js
test('captura a pagina mais recente: png, html e meta sem query', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'trf4', rota: 'local' });
  c.anexarPagina(pagina({ url: 'https://a.br/velha' }));
  c.anexarPagina(pagina({ url: 'https://jurisprudencia.trf4.jus.br/pesquisa/resultado.php?token=X1', html: '<p>oi</p>' }));
  await c.capturar();
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.url, 'https://jurisprudencia.trf4.jus.br/pesquisa/resultado.php');
  assert.equal(meta.passo, 'pagina:jurisprudencia.trf#.jus.br/pesquisa/resultado.php');
  assert.deepEqual([meta.tribunal, meta.rota, meta.erro], ['trf4', 'local', null]);
  assert.equal(fs.readFileSync(path.join(dir, 'pagina.html'), 'utf8'), '<p>oi</p>');
  assert.ok(fs.statSync(path.join(dir, 'tela.png')).size > 0);
});
test('marco __jurPasso vence a derivacao', () => {
  globalThis.__jurPasso = 'submeter';
  try { assert.equal(derivarPasso('https://x.br/a', 't'), 'submeter'); } finally { delete globalThis.__jurPasso; }
});
test('pagina que trava screenshot: sai dentro do prazo so com meta.json (Review Focus 2)', async () => {
  const dir = tmp(); const c = criarCaptura({ dir, tribunal: 'stj', rota: 'remoto', prazoMs: 200 });
  c.anexarPagina(pagina({ screenshot: () => new Promise(() => {}), content: () => new Promise(() => {}) }));
  const t0 = Date.now(); await c.capturar();
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'tela.png')));
});
test('sem pagina: meta.json com passo desconhecido', async () => {
  const dir = tmp(); await criarCaptura({ dir, tribunal: 'tjpr', rota: 'local' }).capturar();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).passo, 'desconhecido');
});
test('exit(1) espera a captura e sai com o mesmo codigo; exit(0) nao captura', async () => {
  const chamadas = []; const proc = processoFalso((c) => chamadas.push(c));
  let capturou = 0; instalarSaida({ capturar: async () => { capturou++; } }, proc);
  proc.exit(0); proc.exit(1); await new Promise((r) => setImmediate(r));
  assert.deepEqual(chamadas, [0, 1]); assert.equal(capturou, 1);
});
test('sem ponte nem CDP: dois launch seguidos continuam permitidos (Review Focus 1)', async () => {
  const chromium = chromiumFalso();
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { exclusivo: false });
  await chromium.launch(); await chromium.launch();
});
test('com CDP: erro de conexao nao vaza a URL', async () => {
  const chromium = chromiumFalso({ falharCdp: 'wss://connect.steel.dev?apiKey=SEGREDO' });
  instrumentarChromium(chromium, { anexarPagina() {}, encerrar() {} }, { cdp: 'wss://x', exclusivo: true });
  await assert.rejects(chromium.launch(), (e) => !/SEGREDO/.test(e.message) && /navegador remoto/.test(e.message));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jur && node --test tests/navegador-preload.test.js`
Expected: FAIL (`criarCaptura is not a function`)

- [ ] **Step 3: Implement** as funções acima em `src/navegadorPreload.js`, preservando `module.exports.instrumentarChromium` e o comportamento atual de ponte/CDP.

- [ ] **Step 4: Run test to verify it passes** (mais os testes que já usam o preload)

Run: `cd jur && node --test tests/navegador-preload.test.js tests/navegador-assistido.test.js tests/navegadores-remotos.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/src/navegadorPreload.js jur/tests/navegador-preload.test.js
git commit -m "feat(kaizen): captura de print, HTML e passo no preload do crawler"
```

---

### Task 5: Executor — preload sempre, `JUR_FALHA_DIR` e prazo de captura no timeout

**Files:**
- Create: `jur/servidor/kaizen/captura.js`
- Modify: `jur/servidor/executor.js:118-170` (montagem do spawn e relógio), `jur/tests/fixtures/cli-falsa.js` (modos novos)
- Test: `jur/tests/executor.test.js` (acrescentar; ajustar o teste de timers mockados da linha ~105, que passa a ver `SIGUSR2` no tick do timeout e `SIGTERM` só `prazoCapturaMs` depois)

**Interfaces:**
- Produces:
  - `dirFalha(arquivoSaida: string): string` — `arquivoSaida` sem `.json` + `.falha` (ex.: `/dados/usuarios/<h>/resultados/<id>.falha`).
  - `lerCaptura(dir: string): Promise<null | { meta: object, tela_png_gzip_b64?: string, html_gzip_b64?: string, html_sha256?: string }>` — `zlib.gzip` assíncrono; HTML > `LIMITE_HTML` (4 MB) é cortado e ganha `\n<!-- kaizen: HTML truncado em 4 MB de <n> bytes -->` antes do gzip; `html_sha256` do HTML como foi enviado; dir inexistente → `null`; nunca lança.
  - `marcarAssinatura(dir, assinatura): void` e `assinaturaDaCaptura(dir): string|null` — gravam/leem `assinatura` dentro de `meta.json` (usado pelo relato).
  - `limparCaptura(dir): void` — apaga `tela.png` e `pagina.html` (o `meta.json` fica para o relato saber que houve falha).
  - executor: `PRAZO_CAPTURA_MS = 8000`; `opcoes.prazoCapturaMs` (testes); `args` sempre com `--require src/navegadorPreload.js`; `env.JUR_FALHA_DIR = dirFalha(arquivoSaida)` quando há `arquivoSaida` (cria o env a partir de `opcoes.env || process.env`). No timeout: `process.kill(filho.pid, 'SIGUSR2')` (só o filho — `SIGUSR2` no grupo mataria o Chromium antes do print) e `matarGrupo(pid)` agendado para `prazoCapturaMs` depois; se `close` chegar antes, cancela o agendamento e chama `matarGrupo` na hora (o Chromium neto ainda pode estar de pé). O erro continua `timeout apos ${timeoutMs}ms`. Cancelamento e `listar()` não mudam.

- [ ] **Step 1: Write the failing tests** (modos novos na CLI falsa: `falha-com-captura` → `process.stdout.write({success:false,...})` e `process.exit(1)`; `trava-sincrono` → `for(;;){}` depois de gravar `<saida>.pronto`)

```js
it('sempre carrega o preload e passa JUR_FALHA_DIR ao lado do -o', async () => {
  const dir = tmp(); const arquivo = path.join(dir, 'job1.json');
  const r = await executor.executar('falha-com-captura', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA });
  assert.equal(r.ok, false);
  assert.ok(fs.existsSync(path.join(dir, 'job1.falha', 'meta.json')), 'preload gravou meta.json no exit(1)');
});
it('timeout: SIGUSR2 deixa o filho capturar e o erro continua timeout', async () => {
  const dir = tmp(); const arquivo = path.join(dir, 'job2.json');
  const r = await executor.executar('travado', { query: 'x' }, { arquivoSaida: arquivo, cliPath: CLI_FALSA, timeoutMs: 300 });
  assert.match(r.erro, /^timeout apos 300ms$/);
  assert.ok(fs.existsSync(path.join(dir, 'job2.falha', 'meta.json')));
});
it('timeout: filho que nao atende SIGUSR2 morre pelo SIGTERM depois do prazo', async () => {
  const t0 = Date.now();
  const r = await executor.executar('trava-sincrono', { query: 'x' }, { arquivoSaida: path.join(tmp(), 'j.json'), cliPath: CLI_FALSA, timeoutMs: 200, prazoCapturaMs: 300 });
  assert.match(r.erro, /timeout/); assert.ok(Date.now() - t0 < 5000);
});
```
E em `tests/kaizen-captura.test.js` (novo):
```js
test('lerCaptura: gzip+base64 e sha do html; html grande truncado com aviso', async () => {
  const dir = montarFalha({ html: 'a'.repeat(5 * 1024 * 1024), png: Buffer.from([137, 80]) });
  const c = await lerCaptura(dir);
  const html = zlib.gunzipSync(Buffer.from(c.html_gzip_b64, 'base64')).toString();
  assert.ok(html.length < 4 * 1024 * 1024 + 200);
  assert.match(html, /<!-- kaizen: HTML truncado em 4 MB de \d+ bytes -->$/);
  assert.equal(c.html_sha256, createHash('sha256').update(html).digest('hex'));
  assert.deepEqual(zlib.gunzipSync(Buffer.from(c.tela_png_gzip_b64, 'base64')), Buffer.from([137, 80]));
});
test('lerCaptura: so meta.json e diretorio ausente', async () => {
  assert.deepEqual(Object.keys(await lerCaptura(montarFalha({}))), ['meta']);
  assert.equal(await lerCaptura('/nao/existe'), null);
  assert.equal(dirFalha('/d/r/abc.json'), '/d/r/abc.falha');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd jur && node --test tests/executor.test.js tests/kaizen-captura.test.js`
Expected: FAIL (sem `job1.falha/meta.json`; módulo `captura` ausente)

- [ ] **Step 3: Implement** `servidor/kaizen/captura.js` e as mudanças do executor; atualizar o teste de timers mockados para a nova sequência (`SIGUSR2` → `SIGTERM` em `+prazoCapturaMs` → `SIGKILL` em `+5000`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd jur && node --test tests/executor.test.js tests/kaizen-captura.test.js tests/jobs.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/executor.js jur/servidor/kaizen/captura.js jur/tests/fixtures/cli-falsa.js jur/tests/executor.test.js jur/tests/kaizen-captura.test.js
git commit -m "feat(kaizen): executor carrega o preload sempre e da 8 s para capturar no timeout"
```

---

### Task 6: Outbox de envio ao FFD

**Files:**
- Create: `jur/servidor/kaizen/outbox.js`
- Test: `jur/tests/kaizen-outbox.test.js`

**Interfaces:**
- Produces:
  - `criarOutbox({ con, url, token, fetchFn = fetch, agora = Date.now, intervaloMs = 60000, maxItens = 5000, maxBytes = 200 * 1024 * 1024, timeoutMs = 20000 }) → { ligado: boolean, enfileirar(source: string, corpo: object): void, drenar(): Promise<{ enviados, adiados, descartados }>, iniciar(): void, parar(): void, pendentes(): number }`
  - DDL (em `criarOutbox`): `CREATE TABLE IF NOT EXISTS kaizen_envio (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, corpo_json TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_em INTEGER NOT NULL, criado_em INTEGER NOT NULL)` + índice em `proxima_em`.
  - `BACKOFF_MS = [60e3, 300e3, 900e3, 3600e3]` (depois 3600e3 para sempre); `VALIDADE_MS = 48 * 3600e3`.
  - `ligado = Boolean(url && token)`. Desligado: `enfileirar` grava (respeitando o teto), `drenar` não chama `fetch`.
  - `enfileirar` aplica o teto (apaga os mais velhos até caber) e agenda `drenar()` em `setImmediate`. `drenar` é serializado (uma drenagem por vez, um POST por vez) e nunca rejeita. `iniciar()` usa `setInterval(...).unref()`.
  - POST: `fetchFn(`${url.replace(/\/$/, '')}/${source}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-token': token }, body: corpo_json, signal: AbortSignal.timeout(timeoutMs) })`. Log de descarte: `[kaizen] descartado <source> HTTP <status>` (nunca o corpo).

- [ ] **Step 1: Write the failing test** (`con = new DatabaseSync(':memory:')`, relógio falso `let t = 0; agora = () => t`)

```js
test('2xx apaga; URL e cabecalho do FFD', async () => {
  const chamadas = []; const o = outbox({ fetchFn: async (u, i) => { chamadas.push([u, i.headers['x-webhook-token']]); return new Response('{}'); } });
  o.enfileirar('jur-diagnostico', { a: 1 }); await o.drenar();
  assert.deepEqual(chamadas, [['https://ffd.example/api/webhooks/jur-diagnostico', 'tok']]);
  assert.equal(o.pendentes(), 0);
});
test('500 e rede adiam com backoff 1, 5, 15, 60, 60 min', async () => {
  const o = outbox({ fetchFn: async () => new Response('', { status: 500 }) });
  o.enfileirar('jur-diagnostico', {});
  for (const espera of [1, 5, 15, 60, 60]) {
    await o.drenar(); assert.equal(o.pendentes(), 1);
    t += espera * 60e3 - 1; assert.equal((await o.drenar()).enviados + (await o.drenar()).adiados, 0, 'antes da hora nao tenta');
    t += 1;
  }
});
test('429 e 408 adiam; 400 e 401 descartam', async () => {
  for (const [status, fica] of [[429, 1], [408, 1], [400, 0], [401, 0]]) {
    const o = outbox({ fetchFn: async () => new Response('', { status }) });
    o.enfileirar('user-issues', {}); await o.drenar(); assert.equal(o.pendentes(), fica, String(status));
  }
});
test('descarta apos 48 h', async () => {
  const o = outbox({ fetchFn: async () => { throw new Error('rede'); } });
  o.enfileirar('jur-diagnostico', {}); t += 48 * 3600e3 + 1; await o.drenar();
  assert.equal(o.pendentes(), 0);
});
test('teto de itens descarta os mais velhos (Review Focus 5)', async () => {
  const o = outbox({ maxItens: 3, fetchFn: async () => new Response('', { status: 500 }) });
  for (let i = 0; i < 5; i++) o.enfileirar('jur-diagnostico', { i });
  assert.equal(o.pendentes(), 3);
  assert.deepEqual(con.prepare('SELECT corpo_json FROM kaizen_envio ORDER BY id').all().map((r) => JSON.parse(r.corpo_json).i), [2, 3, 4]);
});
test('teto de bytes', () => {
  const o = outbox({ maxBytes: 100 }); o.enfileirar('x', { s: 'a'.repeat(60) }); o.enfileirar('x', { s: 'b'.repeat(60) });
  assert.equal(o.pendentes(), 1);
});
test('sem URL ou token: grava, nao envia', async () => {
  let n = 0; const o = outbox({ url: '', fetchFn: async () => { n++; return new Response('{}'); } });
  assert.equal(o.ligado, false); o.enfileirar('jur-diagnostico', {}); await o.drenar();
  assert.equal(n, 0); assert.equal(o.pendentes(), 1);
});
test('um POST por vez mesmo com drenar() concorrente', async () => {
  let simultaneos = 0, pico = 0;
  const o = outbox({ fetchFn: async () => { pico = Math.max(pico, ++simultaneos); await new Promise((r) => setTimeout(r, 10)); simultaneos--; return new Response('{}'); } });
  for (let i = 0; i < 4; i++) o.enfileirar('x', { i });
  await Promise.all([o.drenar(), o.drenar()]); assert.equal(pico, 1); assert.equal(o.pendentes(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jur && node --test tests/kaizen-outbox.test.js`
Expected: FAIL com `Cannot find module '../servidor/kaizen/outbox'`

- [ ] **Step 3: Implement** `outbox.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd jur && node --test tests/kaizen-outbox.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/kaizen/outbox.js jur/tests/kaizen-outbox.test.js
git commit -m "feat(kaizen): outbox SQLite com backoff, validade e teto"
```

---

### Task 7: Payloads e fachada `criarKaizen`

**Files:**
- Create: `jur/servidor/kaizen/payload.js`, `jur/servidor/kaizen/index.js`
- Test: `jur/tests/kaizen-payload.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6.
- Produces (`payload.js`, puro):
  - `hashUsuario(id: string|null, salt: string|undefined): string|null` — `sha256(id + salt)` hex; sem id ou sem salt → `null`.
  - `filtrosDe(params): { query, dataInicio, dataFim, dataPubInicio, dataPubFim, relator, juizados, numero }` — ausentes viram `null`.
  - `payloadFalha({ versao, revisao, origem, tribunal, classe, passo, assinatura, erro, rota, params, jobId, usuarioHash, em, captura, conferencia, exemplos }): object` — chaves **exatamente** as do contrato do spec §6: `servico:"jurcrawler", versao, revisao, origem, tipo:"falha", tribunal, classe, passo, assinatura, erro, rota, filtros, conferencia, exemplos, job_id, usuario_hash, em` + (se houver captura) `tela_png_gzip_b64, html_gzip_b64, html_sha256, url, titulo`. `conferencia`/`exemplos` só em `filtro_ignorado:*` (senão a chave não vai). `erro` passa por `sanitizar` e é cortado em 2000. `em` ISO 8601.
  - `payloadResgate({ ... , tipo })` — `tipo:"resgate"`, `classe:"resgate:reserva"` ou `"resgate:captcha_manual"`, `erro` = falhas do provedor anterior unidas por `; ` (ou `null`), sem captura.
  - `payloadResumo({ versao, revisao, em, resumo: { rodados, ok, falhas, nao_verificaveis } })` — `origem:"sentinela", tipo:"resumo", classe:"resumo", tribunal:null, passo:null, assinatura:"sentinela|resumo", erro:null, rota:null, filtros:{}, job_id:null, usuario_hash:null, resumo`.
  - `payloadRelato({ titulo, descricao, autorEmail, autorNome, equipe, rota, versao, linear, contexto, em })` — `{ servico:"jurcrawler", titulo, descricao (cortada em 2000), autor_email, autor_nome, equipe, rota, versao, linear: {identifier,url}|null, contexto, em }`.
- Produces (`index.js`):
  - `criarKaizen({ dir, env = process.env, fetchFn, agora = Date.now, versao, revisao }) → Kaizen` — abre `<dir>/kaizen.db` (WAL, `chmod 600`), cria a outbox com `KAIZEN_WEBHOOK_URL`/`KAIZEN_WEBHOOK_TOKEN` e chama `outbox.iniciar()` quando ligada.
  - `Kaizen.registrarErro(job, r, { usuarioId, arquivo, origem = 'busca' }): Promise<void>` — classe por `classificar({ erro: r.erro, rota: rotaDoNavegador(job.navegador) })`; lê `lerCaptura(dirFalha(arquivo))`; `passo = captura?.meta.passo || 'desconhecido'`; monta assinatura; `marcarAssinatura`; enfileira `jur-diagnostico`; `limparCaptura`. Nunca rejeita (try/catch + `console.error('[kaizen]', e.message)`).
  - `Kaizen.registrarConcluido(job, r, { usuarioId, origem = 'busca' }): { avisos: string[] }` — síncrono e barato: `conferir(job.params, r.resultados || [], { comando: job.comando })`; cada `ignorado` → falha `filtro_ignorado:<filtro>`, `passo:'conferencia'`, e um aviso `avisoDoFiltro`; `job.navegador` com `(reserva)` → resgate `reserva` com `erro = job.navegadorFalhas`; `job.resolvidoPeloUsuario` → resgate `captcha_manual`. Nunca lança (em erro devolve `{ avisos: [] }`).
  - `Kaizen.registrarSentinela({ caso, avaliacao, r, arquivo }): Promise<void>` — falha com `origem:'sentinela'`, `job_id: null`, `usuario_hash: null`; classe = `avaliacao.classe`.
  - `Kaizen.enviarResumo(resumo): void`, `Kaizen.enviarRelato(relato): boolean` (true = enfileirado), `Kaizen.linkFalha(assinatura): string|null` (`<origem de KAIZEN_WEBHOOK_URL>/jur-falhas?assinatura=<encode>`; sem URL → `null`), `Kaizen.outbox`, `Kaizen.fechar()`.
  - `kaizenNulo(): Kaizen` — mesma forma, tudo no-op (`registrarConcluido` → `{ avisos: [] }`), para testes e chamadas sem kaizen.

- [ ] **Step 1: Write the failing test** (`tests/kaizen-payload.test.js`; `fetchFn` falso grava o corpo; `kaizen = criarKaizen({ dir: tmp(), env: { KAIZEN_WEBHOOK_URL: 'https://ffd.example/api/webhooks', KAIZEN_WEBHOOK_TOKEN: 'tok', KAIZEN_SALT: 'sal' }, fetchFn, versao: '1.1.0', revisao: 'abc1234' })`)

```js
test('falha de busca: contrato jur-diagnostico exato, com captura e sem e-mail', async () => {
  const arquivo = falhaPronta({ meta: { url: 'https://a.br/p', titulo: 'T', passo: 'pagina:a.br/p' }, html: '<p/>', png: Buffer.from([1]) });
  await kaizen.registrarErro(jobFalso({ comando: 'trf4', navegador: 'Servidor ProcStudio', params: { query: 'x', dataInicio: '01/01/2024' } }),
    { ok: false, erro: "locator.click: Timeout 30000ms exceeded.\n  - waiting for locator('#r')" }, { usuarioId: 'u1', arquivo });
  await kaizen.outbox.drenar();
  const [c] = corpos('jur-diagnostico');
  assert.deepEqual(Object.keys(c).sort(), ['assinatura', 'classe', 'em', 'erro', 'filtros', 'html_gzip_b64', 'html_sha256', 'job_id', 'origem', 'passo', 'revisao', 'rota', 'servico', 'tela_png_gzip_b64', 'tipo', 'titulo', 'tribunal', 'url', 'usuario_hash', 'versao'].sort());
  assert.deepEqual([c.servico, c.versao, c.revisao, c.origem, c.tipo, c.tribunal, c.classe, c.passo, c.rota], ['jurcrawler', '1.1.0', 'abc1234', 'busca', 'falha', 'trf4', 'seletor', 'pagina:a.br/p', 'local']);
  assert.equal(c.usuario_hash, createHash('sha256').update('u1sal').digest('hex'));
  assert.deepEqual(c.filtros, { query: 'x', dataInicio: '01/01/2024', dataFim: null, dataPubInicio: null, dataPubFim: null, relator: null, juizados: null, numero: null });
  assert.ok(!fs.existsSync(path.join(dirFalha(arquivo), 'tela.png')), 'limpa o print depois de enfileirar');
  assert.equal(assinaturaDaCaptura(dirFalha(arquivo)), c.assinatura);
});
test('sem KAIZEN_SALT: usuario_hash null', async () => { /* mesmo fluxo com env sem KAIZEN_SALT */ assert.equal(c.usuario_hash, null); });
test('filtro ignorado: falha com conferencia e exemplos e aviso para o usuario', async () => {
  const { avisos } = kaizen.registrarConcluido(jobFalso({ comando: 'trf4', params: { dataInicio: '01/01/2001', dataFim: '31/12/2001' } }), { ok: true, resultados: fx('trf4').itens }, { usuarioId: 'u1' });
  assert.match(avisos[0], /^o tribunal parece ter ignorado o filtro de data/);
  await kaizen.outbox.drenar(); const [c] = corpos('jur-diagnostico');
  assert.deepEqual([c.classe, c.passo], ['filtro_ignorado:periodoJulgamento', 'conferencia']);
  assert.ok(Array.isArray(c.conferencia) && c.exemplos.length <= 5);
});
test('busca saudavel nao gera nada', async () => {
  assert.deepEqual(kaizen.registrarConcluido(jobFalso({ params: { query: 'x' } }), { ok: true, resultados: fx('trf4').itens }, {}).avisos, []);
  assert.equal(kaizen.outbox.pendentes(), 0);
});
test('resgates: reserva e captcha manual, sem captura', async () => {
  kaizen.registrarConcluido(jobFalso({ navegador: 'Steel (reserva)', navegadorFalhas: ['Kernel: HTTP 500'] }), { ok: true, resultados: [] }, {});
  kaizen.registrarConcluido(jobFalso({ comando: 'stj', navegador: 'Steel', resolvidoPeloUsuario: true }), { ok: true, resultados: [] }, {});
  await kaizen.outbox.drenar();
  assert.deepEqual(corpos('jur-diagnostico').map((c) => [c.tipo, c.classe, c.erro]), [['resgate', 'resgate:reserva', 'Kernel: HTTP 500'], ['resgate', 'resgate:captcha_manual', null]]);
});
test('segredo no erro nao chega ao corpo (Review Focus 4)', async () => {
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'wss://connect.steel.dev?apiKey=SEGREDO' }, { usuarioId: 'u', arquivo: semCaptura() });
  await kaizen.outbox.drenar(); assert.doesNotMatch(JSON.stringify(corpos('jur-diagnostico')), /SEGREDO/);
});
test('resumo e relato no contrato', async () => {
  kaizen.enviarResumo({ rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 });
  assert.equal(kaizen.enviarRelato(payloadRelato({ titulo: 't', descricao: 'd'.repeat(3000), autorEmail: null, autorNome: 'usuário 7', equipe: '9', rota: '/', versao: '1.1.0', linear: null, contexto: {}, em: 'x' })), true);
  await kaizen.outbox.drenar();
  assert.deepEqual(corpos('jur-diagnostico')[0].resumo, { rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 });
  assert.equal(corpos('user-issues')[0].descricao.length, 2000);
  assert.equal(corpos('user-issues')[0].linear, null);
});
test('registrarConcluido nunca lanca nem com resultados lixo', () => {
  assert.deepEqual(kaizen.registrarConcluido({ params: null }, { ok: true, resultados: 'lixo' }, {}), { avisos: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jur && node --test tests/kaizen-payload.test.js`
Expected: FAIL com `Cannot find module '../servidor/kaizen/index'`

- [ ] **Step 3: Implement** `payload.js` e `index.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd jur && node --test tests/kaizen-*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/kaizen/payload.js jur/servidor/kaizen/index.js jur/tests/kaizen-payload.test.js
git commit -m "feat(kaizen): payloads jur-diagnostico e user-issues e fachada criarKaizen"
```

---

### Task 8: Fiação na fila — banco v5, resgate pelo usuário, avisos de filtro

**Files:**
- Modify: `jur/servidor/db.js` (v5), `jur/servidor/navegadores/registro.js`, `jur/servidor/jobs.js:150-215`, `jur/servidor/escopo.js`, `jur/servidor/aplicacao.js`
- Test: `jur/tests/jobs.test.js`, `jur/tests/navegadores-registro.test.js`, `jur/tests/db.test.js` (acrescentar)

**Interfaces:**
- Consumes: `criarKaizen`, `kaizenNulo` (Task 7).
- Produces:
  - `db.js`: `PRAGMA user_version = 5`; colunas `job.resolvido_pelo_usuario INTEGER NOT NULL DEFAULT 0` e `job.navegador_falhas TEXT` (no `CREATE TABLE` e por `ALTER` quando faltam, como `navegador`).
  - `registro.js`: na resposta ok de `requisitar(id, 'acao', { tipo: 'continuar' })`, `s.resolvidoPeloUsuario = true`; novo `resolvidoPeloUsuario(id): boolean`.
  - `jobs.criarFila({ ..., kaizen = kaizenNulo(), contextoKaizen = {} })`. `aoNavegador` grava também `navegador_falhas = JSON.stringify(info.falhas || [])`. Depois do `executarFn`: se `navegadores?.resolvidoPeloUsuario?.(job.id)` grava `resolvido_pelo_usuario=1`. Ramo `ok`: `avisos_json = [...r.avisos, ...kaizen.registrarConcluido(jobAtual, r, ctx).avisos]` (dentro de try/catch). Ramo erro (não cancelado): `kaizen.registrarErro(jobAtual, r, { ...contextoKaizen, arquivo }).catch(() => {})` **sem await**. `jobAtual = obter(job.id)` (traz `navegador`, `navegadorFalhas`, `resolvidoPeloUsuario`).
  - `linhaParaJob` acrescenta `navegadorFalhas: string[]` e `resolvidoPeloUsuario: boolean`.
  - `fila.capturaDoJob(id): { assinatura: string|null } | null` — lê `meta.json` de `dirFalha(<dirResultados>/<id>.json)`.
  - `escopo.js`: `executarNoEscopo` vira `executarNaRota(fn, comando, params, extra, home)` em nível de módulo (exportado; `remoto = remotos.configurados().length > 0` calculado dentro); `criarEscopos({ ..., kaizen })` repassa `kaizen` e `contextoKaizen: { usuarioId: principal.userId }` à fila; devolve também `ocupado(): boolean` (`pool.estado().ocupados + naFila > 0`, idem `poolRemoto`).
  - `aplicacao.js`: `criarAplicacao({ ..., kaizen })` — sem `kaizen`, cria `criarKaizen({ dir, env: process.env, versao: package.json, revisao: revisaoDaImagem(process.env.JUR_IMAGE) })`; passa a `criarEscopos` e às deps de `criarApp` (`kaizen`); retorna `{ handler, fechar, kaizen, ocupado: scopes.ocupado }`; `fechar()` chama `kaizen.fechar()`.

- [ ] **Step 1: Write the failing tests**

`tests/jobs.test.js` (a `filaDeTeste` ganha parâmetro `kaizen`; espião grava chamadas):
```js
it('erro chama kaizen.registrarErro com o arquivo do job e nao espera o envio', async () => {
  const k = espiaoKaizen({ registrarErro: () => new Promise(() => {}) });
  const fila = filaDeTeste(async () => ({ ok: false, erro: 'fora do ar' }), 3, k);
  const job = await fila.aguardar(fila.enfileirar('stf', { query: 'x' }).id);
  assert.equal(job.status, 'erro');
  assert.match(k.chamadas.registrarErro[0][2].arquivo, /\.json$/);
});
it('concluido junta os avisos do kaizen aos da CLI', async () => {
  const k = espiaoKaizen({ registrarConcluido: () => ({ avisos: ['o tribunal parece ter ignorado o filtro de data: 7 de 10 resultados fora do período'] }) });
  const fila = filaDeTeste(async () => ({ ok: true, total: 1, resultados: [{}], avisos: ['base parcial'] }), 3, k);
  const job = await fila.aguardar(fila.enfileirar('stf', { query: 'x' }).id);
  assert.deepEqual(job.avisosCli, ['base parcial', 'o tribunal parece ter ignorado o filtro de data: 7 de 10 resultados fora do período']);
});
it('kaizen que lanca nao transforma sucesso em erro', async () => {
  const k = espiaoKaizen({ registrarConcluido: () => { throw new Error('bug'); } });
  const job = await (async (f) => f.aguardar(f.enfileirar('stf', { query: 'x' }).id))(filaDeTeste(async () => ({ ok: true, total: 1, resultados: [{}] }), 3, k));
  assert.equal(job.status, 'concluido');
});
it('cancelado nao chama o kaizen', async () => { /* executarFn espera o sinal; cancelar(); assert chamadas vazias */ });
it('grava navegador_falhas do aoNavegador', async () => {
  const fila = filaDeTeste(async (c, p, extra) => { extra.aoNavegador({ nome: 'Steel', reserva: true, falhas: ['Kernel: HTTP 500'] }); return { ok: true, total: 0, resultados: [] }; });
  const job = await fila.aguardar(fila.enfileirar('stf', { query: 'x' }).id);
  assert.deepEqual([job.navegador, job.navegadorFalhas], ['Steel (reserva)', ['Kernel: HTTP 500']]);
});
```
`tests/navegadores-registro.test.js`:
```js
test('continuar com sucesso marca resolvido pelo usuario; falha nao marca', async () => {
  // mesmo arranjo do teste existente; antes do continuar: false; depois do { ok: true }: true
  assert.equal(r.resolvidoPeloUsuario('job'), true);
});
```
`tests/db.test.js`:
```js
it('v5: banco antigo ganha resolvido_pelo_usuario e navegador_falhas', () => {
  // cria job sem as colunas, reabre com db.abrir, confere PRAGMA table_info e user_version = 5
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd jur && node --test tests/jobs.test.js tests/navegadores-registro.test.js tests/db.test.js`
Expected: FAIL nos casos novos

- [ ] **Step 3: Implement** db v5, registro, jobs, escopo, aplicacao conforme as interfaces.

- [ ] **Step 4: Run the server suites**

Run: `cd jur && node --test tests/jobs.test.js tests/navegadores-*.test.js tests/db.test.js tests/aplicacao.test.js tests/isolamento.test.js tests/local.test.js tests/buscas.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/db.js jur/servidor/navegadores/registro.js jur/servidor/jobs.js jur/servidor/escopo.js jur/servidor/aplicacao.js jur/tests/jobs.test.js jur/tests/navegadores-registro.test.js jur/tests/db.test.js
git commit -m "feat(kaizen): fila registra falhas, resgates e avisos de filtro ignorado"
```

---

### Task 9: Integração real — falha forçada ponta a ponta

**Files:**
- Test: `jur/tests/kaizen-integracao.test.js` (novo)

**Interfaces:**
- Consumes: `criarAplicacao` com `executarFn` real (`executor.executar` com `cliPath: CLI_FALSA`), `kaizen` criado com `fetchFn` falso.

- [ ] **Step 1: Write the test** (mesmo arranjo de SSO falso de `tests/aplicacao.test.js`)

```js
test('busca que falha no crawler chega ao FFD falso com meta e assinatura; 2a busca da mesma falha tem a mesma assinatura', async () => {
  // POST /api/v1/buscas duas vezes no modo falha-com-captura; aguarda os jobs; await kaizen.outbox.drenar()
  const corpos = recebidos('jur-diagnostico');
  assert.equal(corpos.length, 2);
  assert.equal(corpos[0].assinatura, corpos[1].assinatura);
  assert.equal(corpos[0].origem, 'busca');
  assert.ok(!('tela_png_gzip_b64' in corpos[0]) || typeof corpos[0].tela_png_gzip_b64 === 'string');
});
test('sem KAIZEN_WEBHOOK_URL a busca funciona igual e a outbox guarda local', async () => { /* status 'erro' normal; pendentes() === 1; zero fetch */ });
```

- [ ] **Step 2: Run it**

Run: `cd jur && node --test tests/kaizen-integracao.test.js`
Expected: PASS (se falhar, o defeito está nas Tasks 5–8; corrigir lá, não aqui)

- [ ] **Step 3: Commit**

```bash
git add jur/tests/kaizen-integracao.test.js
git commit -m "test(kaizen): falha forcada da busca ate a outbox"
```

---

### Task 10: Porta do núcleo do issue-reporter

**Files:**
- Create: `jur/servidor/issue-reporter/contract.js`, `jur/servidor/issue-reporter/linear.js`, `jur/servidor/issue-reporter/report.js`
- Test: `jur/tests/issue-reporter.test.js`

**Interfaces:**
- Produces (porta 1:1 de `/Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/{contract,linear,report}.ts`, sem tipos; cabeçalho em cada arquivo: `// Porta de issue-reporter/<arquivo>.ts do FFD — manter em sincronia; sem build TS no JurCrawler.`):
  - `contract.js`: `PRIORITIES` (mesmos 4 itens e textos).
  - `linear.js`: `GRAPHQL_URL`, `LinearError(message, status)`, `getViewer`, `listTeams`, `getTeamMeta(apiKey, teamId)`, `createIssue(apiKey, input)`.
  - `report.js`: `DEFAULT_TITLE_TEMPLATE`, `SubmissionError(message, status = 400)`, `clearReporterCache()`, `buildMeta(config)`, `composeTitle(config, title, module)`, `composeDescription(config, sub)`, `submitIssue(config, raw)`, reexporta `LinearError`. Chama `linear.getTeamMeta(...)`/`linear.createIssue(...)` pelo **objeto do módulo** (`const linear = require('./linear')`), para o teste trocar as funções sem mock de loader.

- [ ] **Step 1: Write the failing test** — os mesmos casos de `/Users/brpl/code/fullFuckerDashboard/ai-dashboard/tests/issue-reporter.test.ts`, com os mesmos nomes e o mesmo `TEAM_META`, traduzidos para `node:test` (`describe/it` + `assert`), trocando `vi.fn()` por `linear.createIssue = async (...a) => { chamadas.push(a); return { identifier: 'PRC-601', url: 'https://linear.app/x' }; }` e `beforeEach(() => clearReporterCache())`:
  - `composeTitle`: "aplica o template completo", "some com o prefixo quando não há módulo", "some com o sufixo quando não há autor", "aceita template de outro repositório"; mais um caso do JurCrawler: `composeTitle({ ...config(), titleTemplate: '[jur] {title} ({author})' }, 'Busca travou', null) === '[jur] Busca travou (Bruno)'`.
  - `composeDescription`: "carrega a proveniência: versão, commit, tela e URL", "inclui console e requisições que falharam", "inclui o bloco de QA quando ligado, e só quando ligado", "separa o que o servidor afirma do que o browser diz", "escapa pipe para não quebrar a tabela markdown".
  - `submitIssue`: "cria a issue com labels resolvidas e estado inicial", "ignora label que não pertence ao grupo configurado", "ignora prioridade fora da escala do Linear", "recusa título curto e corpo vazio", "recusa envio quando não há key configurada", "em app público exige e-mail válido", "trunca o que vem do browser", "cacheia o vocabulário do time entre envios".
  - `buildMeta`: "desligado não vaza vocabulário nenhum", "expõe só as filhas dos grupos configurados", "Linear fora do ar vira enabled:false com motivo, não exceção".
  
  Copiar as asserções de cada caso do arquivo TS (valores idênticos).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jur && node --test tests/issue-reporter.test.js`
Expected: FAIL com `Cannot find module '../servidor/issue-reporter/report'`

- [ ] **Step 3: Implement** a porta, linha a linha a partir do TS.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd jur && node --test tests/issue-reporter.test.js`
Expected: PASS (21 casos do FFD + 1 do JurCrawler)

- [ ] **Step 5: Commit**

```bash
git add jur/servidor/issue-reporter jur/tests/issue-reporter.test.js
git commit -m "feat(relatos): porta CommonJS do nucleo do issue-reporter"
```

---

### Task 11: Rotas de relato, cola BRU, widget na tela

**Files:**
- Create: `jur/servidor/issue-reporter/config.js`, `jur/servidor/rotas/relatos.js`, `jur/publico/issue-reporter/widget.js` (cópia), `jur/publico/relatar.js`
- Modify: `jur/servidor/index.js` (registrar a rota), `jur/servidor/openapi.js` (documentar as duas rotas), `jur/publico/index.html` (script), `jur/publico/decisoes.js` (`window.jurBuscaVisivel`)
- Test: `jur/tests/relatos.test.js` (novo), `jur/tests/openapi.test.js` (deve continuar verde)

**Interfaces:**
- Consumes: `buildMeta`, `submitIssue`, `SubmissionError`, `LinearError` (Task 10); `kaizen.enviarRelato`, `kaizen.linkFalha`, `payloadRelato` (Task 7); `fila.obter`, `fila.capturaDoJob` (Task 8).
- Produces:
  - `configDoRelator({ env, principal, versao, revisao, serverContext }): ReporterConfig` — `enabled: Boolean(env.LINEAR_API_KEY && env.LINEAR_TEAM_ID)`, `apiKey`, `teamId`, `author: \`usuário ${principal.userId}\``, `titleTemplate: '[jur] {title} ({author})'`, `moduleGroup: null`, `typeGroup: null`, `alwaysLabels: []`, `initialStateName: 'Todo'`, `app: { name: 'JurCrawler', version: versao, commit: revisao || null, env: JUR_PUBLIC_URL https ? 'production' : 'development' }`, `requireContact: false`, `qaChecklist: true`, `moduleByPath: {}`, `serverContext`.
  - `contextoDoServidor({ principal, versao, revisao, job, assinatura, linkFalha }): Record<string,string>` — `ID do usuário`, `Equipe`, `Versão` (`1.1.0 · abc1234`); se `job`: `Busca` (id), `Tribunal`, `Filtros` (JSON de `filtrosDe`), `Rota` (`job.navegador`), `Status`, `Erro` (sanitizado, 300), `Captura de falha` (`sim — <linkFalha>` ou `não`).
  - `GET /api/v1/relatos/meta` → `200 buildMeta(config)`.
  - `POST /api/v1/relatos` → com `Authorization` no pedido: `403 { erro: 'Relato só pela interface.' }`. Corpo via `lerCorpo`. `jobId = body.context?.extra?.jobId`; `job = jobId ? deps.fila.obter(jobId) : null` (a fila é da conta: job de outro usuário é `null`). `SubmissionError` com status ≠ 503 → `status { error }` sem enviar ao FFD. `LinearError` ou 503 → `linear = null`. Sempre que passou da validação: `deps.kaizen.enviarRelato(payloadRelato({ titulo, descricao: body.body, autorEmail: principal.email || null, autorNome: \`usuário ${principal.userId}\`, equipe: principal.teamId, rota: body.context?.path, versao, linear, contexto: serverContext, em }))`. Resposta: Linear ok → `200 { ok: true, identifier, url }`; Linear falhou e FFD enfileirado → `200 { ok: true, identifier: 'Recebido', url: '/' }`; os dois falharam → `502 { error: 'Não conseguimos registrar agora. Tente de novo em alguns minutos.' }`. Nenhuma mensagem do Linear vai ao usuário.
  - `publico/relatar.js` (`<script type="module" src="/relatar.js">` depois de `/sessao.js`): importa `/issue-reporter/widget.js`; monta **só** depois de `jur:sessao` (ou se `window.jurSessao.principal` já existe): `mountIssueReporter({ base: '/api/v1/relatos', hotkey: 'alt+i', theme: 'auto', label: 'Relatar', extra: () => (window.jurBuscaVisivel ? { jobId: window.jurBuscaVisivel.jobId, tribunal: window.jurBuscaVisivel.tribunal } : {}) })`.
  - `decisoes.js`: `desenharJulgados(b)` define `window.jurBuscaVisivel = { jobId: b.id, tribunal: b.comando }`; `fechar()` e a volta para a lista o zeram.

- [ ] **Step 1: Copiar o widget sem alterar**

Run: `cp /Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/widget.js /Users/brpl/code/ProcStudio/prc_jur_crawler/jur/publico/issue-reporter/widget.js && cmp /Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/widget.js /Users/brpl/code/ProcStudio/prc_jur_crawler/jur/publico/issue-reporter/widget.js && echo igual`
Expected: `igual`

- [ ] **Step 2: Write the failing test** (`tests/relatos.test.js`; app montado com `criarApp({ conta: principal, fila, kaizen: espiao })`, `linear.getTeamMeta/createIssue` trocados como na Task 10)

```js
test('sem LINEAR_*: meta enabled:false e o widget nao monta', async () => {
  assert.equal((await get('/api/v1/relatos/meta', { env: {} })).enabled, false);
});
test('com BRU: card [jur] com contexto do servidor e o mesmo relato vai ao FFD', async () => {
  const r = await post('/api/v1/relatos', relato({ extra: { jobId: jobDaConta.id, tribunal: 'mentira' } }));
  assert.deepEqual([r.status, r.body.identifier], [200, 'BRU-1']);
  const [input] = linearChamadas[0].slice(1);
  assert.match(input.title, /^\[jur\] .+ \(usuário u1\)$/);
  assert.match(input.description, /\| Tribunal \| trf4 \|/);
  assert.equal(input.stateId, 's-todo');
  assert.deepEqual(espiao.relatos[0].linear, { identifier: 'BRU-1', url: 'https://linear.app/x' });
  assert.equal(espiao.relatos[0].servico, 'jurcrawler');
});
test('job de outra conta nao entra no contexto', async () => { /* jobId inexistente na fila da conta → descricao sem "| Busca |" */ });
test('Linear fora: 200 Recebido e FFD com linear null; Linear e FFD fora: 502', async () => {
  linear.createIssue = async () => { throw new LinearError('Linear respondeu 500.', 500); };
  assert.deepEqual((await post('/api/v1/relatos', relato())).body, { ok: true, identifier: 'Recebido', url: '/' });
  assert.equal(espiao.relatos.at(-1).linear, null);
  espiao.enviarRelato = () => false;
  const r = await post('/api/v1/relatos', relato());
  assert.equal(r.status, 502); assert.doesNotMatch(JSON.stringify(r.body), /Linear respondeu/);
});
test('titulo curto: 400 e nada vai ao FFD', async () => { /* status 400; espiao.relatos vazio */ });
test('chave pessoal (Bearer) nao relata', async () => { assert.equal((await post('/api/v1/relatos', relato(), { authorization: 'Bearer x' })).status, 403); });
test('index.html monta o widget como modulo e o widget e copia exata do FFD', () => {
  assert.match(fs.readFileSync(INDEX, 'utf8'), /<script type="module" src="\/relatar\.js"><\/script>/);
  const ffd = '/Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/widget.js';
  if (fs.existsSync(ffd)) assert.ok(fs.readFileSync(ffd).equals(fs.readFileSync(WIDGET)));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd jur && node --test tests/relatos.test.js tests/openapi.test.js`
Expected: FAIL (`rota nao encontrada`; openapi passa até a rota ser registrada, aí reprova sem documentação — documentar na mesma tarefa)

- [ ] **Step 4: Implement** config, rota, openapi (as duas rotas com `security` de sessão/chave como as demais e descrição "Relato pela interface; chave pessoal é recusada"), `relatar.js`, `index.html`, `decisoes.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd jur && node --test tests/relatos.test.js tests/openapi.test.js tests/aplicacao.test.js && npm run test:browser -- --test-name-pattern="interface"`
Expected: PASS

- [ ] **Step 6: Conferir o alvo no `sync.sh` do FFD (entrega 1)**

Run: `grep -n "prc_jur_crawler/jur/publico/issue-reporter/widget.js" /Users/brpl/code/fullFuckerDashboard/ai-dashboard/issue-reporter/sync.sh`
Expected: uma linha. Se não houver, **não editar o FFD aqui**: anotar no PR que a entrega 1 ficou devendo o alvo.

- [ ] **Step 7: Commit**

```bash
git add jur/servidor/issue-reporter/config.js jur/servidor/rotas/relatos.js jur/servidor/index.js jur/servidor/openapi.js jur/publico/issue-reporter jur/publico/relatar.js jur/publico/index.html jur/publico/decisoes.js jur/tests/relatos.test.js
git commit -m "feat(relatos): botao Relatar com card no Linear BRU e copia no FFD"
```

---

### Task 12: Sentinela — casos, rodada e agenda

**Files:**
- Create: `jur/servidor/kaizen/sentinela.js`, `jur/servidor/kaizen/agenda.js`, `jur/tests/sentinela.js`, `jur/tests/sentinela-casos.json`
- Modify: `jur/servidor/aviso-deploy.js` (exportar `chaveDeploy`, `marcadorAtual`), `jur/servidor/index.js` (`iniciar()` liga a agenda), `jur/package.json` (`"sentinela": "node tests/sentinela.js"`)
- Test: `jur/tests/kaizen-sentinela.test.js`, `jur/tests/kaizen-agenda.test.js`

**Interfaces:**
- Consumes: `executarNaRota` (Task 8), `conferir` (Task 3), `classificar` (Task 1), `kaizen.registrarSentinela/enviarResumo` (Task 7), `remotos.exigeRemoto`, `capacidades.obter`, `cobertura/tribunais.json`.
- Produces:
  - `sentinela-casos.json`: `[{ tribunal, capacidade, params, espera: { minimo: n } | { encontrado: true } }]`, `capacidade ∈ capacidades.CHAVES`.
  - `carregarCasos(arquivo = tests/sentinela-casos.json): Caso[]`.
  - `selecionarCasos(casos, { pedidos = [], remotoPermitido }): Caso[]` — filtra por `pedidos`; casos com `exigeRemoto(tribunal)` só com `remotoPermitido`.
  - `avaliarCaso(caso, r): { status: 'ok'|'falha'|'nao_verificavel', classe: string|null, conferencia }` — `r.ok === false` → falha `classificar(...)`; `minimo` não atingido ou `encontrado` com zero → falha `vazio_suspeito`; item da conferência para a capacidade do caso `ignorado` → falha `filtro_ignorado:<capacidade>`, `nao_verificavel` → `nao_verificavel`; senão `ok`.
  - `rodarSentinela({ casos, executarFn, kaizen, ocupado = () => false, maxRemoto = 6, esperaEntreMs = 5000, esperaOcupadoMs = 5000, tetoOcupadoMs = 30 * 60e3, timeoutMs = 180e3, home, enviar = true }): Promise<{ rodados, ok, falhas, nao_verificaveis, pulados, itens }>` — serial; antes de cada caso espera `!ocupado()` (pula o caso ao estourar o teto, conta em `pulados`); ≥ `esperaEntreMs` entre casos; remotos limitados a `maxRemoto` por rodada (excedentes contam em `pulados`); `arquivoSaida = <home>/resultados/sentinela-<ts>-<tribunal>-<capacidade>.json`; falha → `kaizen.registrarSentinela`; ao fim `kaizen.enviarResumo({ rodados, ok, falhas, nao_verificaveis })` quando `enviar`.
  - `agenda.js`: `proximaExecucao(agoraMs: number, hora = 4): number` (próximo 04:00 em `America/Sao_Paulo`, via `Intl.DateTimeFormat`), `diaDaSemanaSP(ms): 0..6`, `iniciarAgenda({ rodar: ({ remotoPermitido }) => Promise, agora = Date.now, versaoNova = false, atrasoBootMs = 5 * 60e3 }) → { parar() }` — `setTimeout(...).unref()` encadeado; `remotoPermitido = diaDaSemanaSP === 1 (segunda)`; com `versaoNova`, uma rodada extra `atrasoBootMs` depois do boot com `remotoPermitido: true`. Erro da rodada é logado e a próxima é agendada.
  - `aviso-deploy.js`: `chaveDeploy(versao, revisao) → '<versao>+<revisao>'`, `marcadorAtual(dir) → string|null`. Em `iniciar()`: `versaoNova = marcadorAtual(dir) !== chaveDeploy(...)` lido **antes** de `avisarDeploy` (mesmo marcador do aviso); se `JUR_SENTINELA === '1'`, `iniciarAgenda({ rodar, versaoNova })` com `executarFn = (c, p, e) => executarNaRota(executor.executar, c, p, e, '<JUR_DADOS>/sentinela')`, `ocupado = app.ocupado`, `kaizen = app.kaizen`, `maxRemoto = Number(JUR_SENTINELA_MAX_REMOTO || 6)`.
  - `tests/sentinela.js` (CLI): `node tests/sentinela.js [tribunal...] [--json] [--enviar] [--timeout <s>] [--remoto]` — sem `--enviar` usa `kaizenNulo()`; com `--enviar`, `criarKaizen({ dir: JUR_DADOS || '.local/jur' })` e `await kaizen.outbox.drenar()` antes de sair; tabela por caso ou JSON; exit 1 se houver falha.

- [ ] **Step 1: Montar os casos a partir de buscas reais**

Para cada tribunal com `jurisprudencia.status === 'ok'` em `cobertura/tribunais.json`, **canário apenas** quando há `familia`, e para cada capacidade que `capacidades.obter(tribunal).funcionalidades[c].estado === 'funciona'` dentre `periodoJulgamento`, `periodoPublicacao`, `magistrado`, `juizados`, `numero`:
- `numero`: um `numeroProcesso`/`processo` de `jur/resultados/results-<tribunal>.json` (ou dos `audit-*`), `espera: { encontrado: true }`; o do TRF4 é o do spec, `5057135-38.2021.4.04.7100`.
- `periodoJulgamento`/`periodoPublicacao`: termo e mês que já devolveram julgados nesses arquivos, `espera: { minimo: 1 }`.
- `magistrado`: um relator presente no arquivo, na forma que `relator.obter(tribunal).forma` exige (`codigo` fica fora — conferência daria `nao_verificavel` sempre).
- `juizados`: termo que já trouxe turma recursal.
Rodar cada caso uma vez (`node tests/sentinela.js <tribunal>`) antes de entrar na lista; caso que falha hoje não entra. Os tribunais 🟢 sem caso ficam num comentário `"_pendentes"` no topo do JSON (chave ignorada por `carregarCasos`) com o motivo.

- [ ] **Step 2: Write the failing tests**

`tests/kaizen-agenda.test.js`:
```js
test('proximas 04:00 em Sao Paulo', () => {
  assert.equal(proximaExecucao(Date.parse('2026-10-18T06:59:00Z')), Date.parse('2026-10-18T07:00:00Z'));
  assert.equal(proximaExecucao(Date.parse('2026-10-18T07:00:00Z')), Date.parse('2026-10-19T07:00:00Z'));
  assert.equal(diaDaSemanaSP(Date.parse('2026-10-19T07:00:00Z')), 1);
});
test('versao nova roda com remoto logo apos o boot; domingo nao libera remoto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: Date.parse('2026-10-18T10:00:00Z') });
  const rodadas = []; iniciarAgenda({ rodar: async (o) => rodadas.push(o), versaoNova: true, atrasoBootMs: 1000 });
  t.mock.timers.tick(1000); await Promise.resolve();
  assert.deepEqual(rodadas, [{ remotoPermitido: true }]);
  t.mock.timers.tick(Date.parse('2026-10-19T07:00:00Z') - Date.parse('2026-10-18T10:00:01Z')); await Promise.resolve();
  assert.deepEqual(rodadas.at(-1), { remotoPermitido: true }, 'segunda-feira');
});
```
`tests/kaizen-sentinela.test.js` (executor falso, `kaizen` espião, `esperaEntreMs: 0`):
```js
test('casos.json: tribunal ok, canario de familia, capacidade que funciona, sem codigo', () => {
  for (const c of carregarCasos()) {
    const t = tribunais.find((x) => x.jurisprudencia.comando === c.tribunal);
    assert.equal(t.jurisprudencia.status, 'ok', c.tribunal);
    assert.ok(!t.jurisprudencia.familia || t.jurisprudencia.canario, `${c.tribunal} nao e canario`);
    assert.equal(capacidades.obter(c.tribunal).funcionalidades[c.capacidade].estado, 'funciona', `${c.tribunal}/${c.capacidade}`);
  }
  assert.ok(carregarCasos().some((c) => c.tribunal === 'trf4' && c.params.numero === '5057135-38.2021.4.04.7100'));
});
test('zero onde se espera >=1 e vazio_suspeito', () => {
  assert.deepEqual(avaliarCaso({ capacidade: 'periodoJulgamento', espera: { minimo: 1 }, params: {} }, { ok: true, resultados: [] }).classe, 'vazio_suspeito');
});
test('rodada: falha vai ao kaizen, resumo no fim, remotos com teto', async () => {
  const casos = [caso('trf4'), caso('trf3'), caso('trf3', 'numero'), caso('tjpr')];
  const r = await rodarSentinela({ casos: selecionarCasos(casos, { remotoPermitido: true }), executarFn: falsoQueFalhaEm('tjpr'), kaizen: espiao, maxRemoto: 1, esperaEntreMs: 0, home: tmp() });
  assert.deepEqual([r.rodados, r.ok, r.falhas, r.pulados], [3, 2, 1, 1]);
  assert.equal(espiao.sentinela[0].caso.tribunal, 'tjpr');
  assert.deepEqual(espiao.resumos, [{ rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 }]);
});
test('sem remoto permitido, trf3 fica fora', () => {
  assert.deepEqual(selecionarCasos([caso('trf3'), caso('trf4')], { remotoPermitido: false }).map((c) => c.tribunal), ['trf4']);
});
test('espera a busca do usuario terminar antes do proximo caso', async () => {
  let livres = 0; const ocupado = () => livres++ < 3;
  const inicio = []; await rodarSentinela({ casos: [caso('trf4')], executarFn: async () => { inicio.push(livres); return okCom(1); }, kaizen: espiao, ocupado, esperaOcupadoMs: 1, esperaEntreMs: 0, home: tmp() });
  assert.ok(inicio[0] >= 3);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd jur && node --test tests/kaizen-sentinela.test.js tests/kaizen-agenda.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 4: Implement** `sentinela.js`, `agenda.js`, `tests/sentinela.js`, as exportações de `aviso-deploy.js` e o trecho de `iniciar()`.

- [ ] **Step 5: Run tests to verify they pass, e uma rodada real local**

Run: `cd jur && node --test tests/kaizen-sentinela.test.js tests/kaizen-agenda.test.js tests/aviso-deploy.test.js && node tests/sentinela.js trf4 tjpr`
Expected: testes PASS; a rodada real imprime os casos de trf4 e tjpr com `ok` (ou falha classificada com motivo — investigar antes de seguir)

- [ ] **Step 6: Commit**

```bash
git add jur/servidor/kaizen/sentinela.js jur/servidor/kaizen/agenda.js jur/servidor/aviso-deploy.js jur/servidor/index.js jur/package.json jur/tests/sentinela.js jur/tests/sentinela-casos.json jur/tests/kaizen-sentinela.test.js jur/tests/kaizen-agenda.test.js
git commit -m "feat(kaizen): sentinela diaria as 04:00 com casos reais por capacidade"
```

---

### Task 13: Envs, documentação, versão 1.1.0 e suíte completa

**Files:**
- Modify: `infra/compose.yml`, `infra/.env.example`, `infra/README.md`, `CHANGELOG.md`, `jur/package.json`, `docs/navegadores.md` (uma linha com link)
- Create: `docs/kaizen.md`

- [ ] **Step 1: `infra/compose.yml`** — em `environment:`, com comentário de uma linha cada: `KAIZEN_WEBHOOK_URL: "${KAIZEN_WEBHOOK_URL:-}"`, `KAIZEN_WEBHOOK_TOKEN: "${KAIZEN_WEBHOOK_TOKEN:-}"`, `KAIZEN_SALT: "${KAIZEN_SALT:-}"`, `LINEAR_API_KEY: "${LINEAR_API_KEY:-}"`, `LINEAR_TEAM_ID: "${LINEAR_TEAM_ID:-}"`, `JUR_SENTINELA: "${JUR_SENTINELA:-0}"`, `JUR_SENTINELA_MAX_REMOTO: "${JUR_SENTINELA_MAX_REMOTO:-6}"`.

- [ ] **Step 2: `infra/.env.example`** — as mesmas chaves, vazias, com comentário (`KAIZEN_WEBHOOK_URL=https://ffd.belzinhos.com.br/api/webhooks`; token = endpoint key `jurcrawler` do FFD com sources `jur-diagnostico,user-issues`; `KAIZEN_SALT` = `openssl rand -base64 32`; `LINEAR_TEAM_ID` = id do time BRU; `JUR_SENTINELA=1` só em produção).

- [ ] **Step 3: `infra/README.md`** — seção "Kaizen: falhas, sentinela e relatos" com a tabela das envs (o que faz, padrão, efeito quando falta) e o lembrete de que o container de validação pré-troca roda com `-e KAIZEN_WEBHOOK_URL= -e JUR_SENTINELA=0 -e LINEAR_API_KEY=`.

- [ ] **Step 4: `docs/kaizen.md`** — fluxo (preload → `<job>.falha/` → `kaizen.registrarErro` → outbox → FFD), tabela de classes, regras da conferência e o porquê de `nao_verificavel`, resgates, sentinela (horário, segunda-feira, teto remoto, `npm run sentinela`), relato (rotas, contexto do servidor, Linear BRU, Linear fora), como marcar `passo` (`globalThis.__jurPasso = 'submeter'`), e "conserto pelo FFD: botão copiar para o jur-fixer". Link para ele em `docs/navegadores.md` e no `CLAUDE.md` do repo, seção Manutenção (uma linha).

- [ ] **Step 5: Versão**

Run: `cd jur && npm version minor --no-git-tag-version && node -p "require('./package.json').version"`
Expected: `1.1.0`

`CHANGELOG.md`, entrada `## 1.1.0 — <data do deploy>`: captura de falha com print/HTML/passo; conferência de filtros com aviso ao usuário; resgates; outbox para o FFD; botão Relatar (Linear BRU + FFD); sentinela diária; envs novas.

- [ ] **Step 6: Suítes completas**

Run: `cd jur && npm test && npm run test:browser`
Expected: tudo PASS (anotar a contagem para o registro de QA; flake de carga se repete na 2ª rodada antes de ser aceito)

- [ ] **Step 7: Commit**

```bash
git add infra/compose.yml infra/.env.example infra/README.md docs/kaizen.md docs/navegadores.md CLAUDE.md CHANGELOG.md jur/package.json jur/package-lock.json
git commit -m "docs(kaizen): envs, operacao e versao 1.1.0"
```

---

### Task 14: Release 1.1.0 no H2

**Pré-requisitos (parar se algum faltar):** entrega 1 no ar (`curl -s -o /dev/null -w '%{http_code}' -X POST https://ffd.belzinhos.com.br/api/webhooks/jur-diagnostico` responde 401, não 400 "Unknown source"); endpoint key `jurcrawler` (sources `jur-diagnostico,user-issues`) criada no FFD e com o valor à mão (a tela só o mostra na criação — se perdeu, revogar e criar outra); `npm test` verde na `main`.

Nenhum segredo é impresso: valores vão do arquivo local para o `.env` remoto por pipe; conferir só tamanho (`awk -F= '/^KAIZEN_WEBHOOK_TOKEN=/{print length($2)}'`).

- [ ] **Step 1: Merge e push**

Run: `git switch main && git merge --no-ff feat/kaizen && git push origin main && git rev-parse --short=7 origin/main`
Expected: `<sha7>` impresso (usado abaixo como `$SHA`)

- [ ] **Step 2: Pacote e envio** (procedimento do `/Users/brpl/code/ProcStudio/CLAUDE.md`, bullet `prc_jur_crawler`)

```bash
SHA=<sha7>; TS=$(date -u +%Y%m%d-%H%M%S); REL=$TS-$SHA; A=/home/brpl/apps/prc_jur_crawler; H2=brpl@168.231.91.47
git archive --format=tar.gz -o /tmp/jur-$SHA.tar.gz origin/main && shasum -a 256 /tmp/jur-$SHA.tar.gz
ssh $H2 "mkdir -p $A/incoming" && scp /tmp/jur-$SHA.tar.gz $H2:$A/incoming/
ssh $H2 "sha256sum $A/incoming/jur-$SHA.tar.gz && mkdir -p $A/releases/$REL && tar xzf $A/incoming/jur-$SHA.tar.gz -C $A/releases/$REL"
```
Expected: os dois SHA-256 iguais.

- [ ] **Step 3: `.env` da release** — copiar de `current` trocando `JUR_IMAGE` e acrescentando as envs novas

```bash
ssh $H2 "sed 's|^JUR_IMAGE=.*|JUR_IMAGE=jur:$SHA|' $A/current/infra/.env > $A/releases/$REL/infra/.env && chmod 600 $A/releases/$REL/infra/.env"
ssh $H2 "printf 'KAIZEN_WEBHOOK_URL=https://ffd.belzinhos.com.br/api/webhooks\nJUR_SENTINELA=1\nJUR_SENTINELA_MAX_REMOTO=6\nKAIZEN_SALT=%s\n' \"\$(openssl rand -base64 32)\" >> $A/releases/$REL/infra/.env"
# Token do FFD (entrega 1): colar no prompt do read, nunca na linha de comando
read -rs FFD_KEY; printf 'KAIZEN_WEBHOOK_TOKEN=%s\n' "$FFD_KEY" | ssh $H2 "cat >> $A/releases/$REL/infra/.env"; unset FFD_KEY
# Linear: a mesma chave do CLI do workspace (LINEAR_AUTO_BUG em /Users/brpl/code/env — ver CLAUDE.md, seção Linear)
sed -n 's/^LINEAR_AUTO_BUG=/LINEAR_API_KEY=/p' /Users/brpl/code/env | ssh $H2 "cat >> $A/releases/$REL/infra/.env"
# Time BRU: id via CLI (JSON cru), pegando o item de key "BRU"
BRU=$(/Users/brpl/code/ProcStudio/bin/linear --json teams | node -e 'const d=JSON.parse(require("fs").readFileSync(0));const l=Array.isArray(d)?d:(d.teams?.nodes||d.nodes||d.teams||[]);console.log(l.find(t=>t.key==="BRU").id)')
printf 'LINEAR_TEAM_ID=%s\n' "$BRU" | ssh $H2 "cat >> $A/releases/$REL/infra/.env"
ssh $H2 "grep -c '^JUR_IMAGE=jur:$SHA\$' $A/releases/$REL/infra/.env; awk -F= '/^(KAIZEN_|LINEAR_|JUR_SENTINELA)/{print \$1, length(\$2)}' $A/releases/$REL/infra/.env"
```
Expected: `1`; sete linhas `NOME tamanho` com tamanhos > 0 (`JUR_SENTINELA 1`, `JUR_SENTINELA_MAX_REMOTO 1`). Se `KAIZEN_SALT` não tiver 44, refazer.

- [ ] **Step 4: Build da imagem**

Run: `ssh $H2 "cd $A/releases/$REL && docker build -f infra/Dockerfile -t jur:$SHA --label org.opencontainers.image.revision=$SHA --label org.opencontainers.image.version=1.1.0 . && docker run --rm jur:$SHA node -p \"require('./package.json').version\""`
Expected: `1.1.0`

- [ ] **Step 5: Validação em container temporário** (volumes próprios, sem aviso, sem Kaizen, sem sentinela, sem Linear) — mesmo bloco `jurpre` de `infra/deploy-h2.sh`, com `-e USAGE_WEBHOOK_URL= -e KAIZEN_WEBHOOK_URL= -e JUR_SENTINELA=0 -e LINEAR_API_KEY=` acrescentados ao `docker run`

Expected: `pre saude {"ok":true,"versao":"1.1.0"}`, `me=401`, `painel=404`, `docs=200`, `relatar.js` 200 e `issue-reporter/widget.js` 200 com `text/javascript`; depois `docker rm -f jurpre` e remover os volumes `jurpre-*`.

- [ ] **Step 6: Backup dos volumes**

```bash
ssh $H2 "B=$A/backups/$REL; mkdir -p \$B && docker pause jur-jur-1 && \
  docker run --rm -v jur_jur-dados:/d:ro -v \$B:/b alpine tar czf /b/jur_jur-dados.tgz -C /d . && \
  docker run --rm -v jur_jur-cache:/d:ro -v \$B:/b alpine tar czf /b/jur_jur-cache.tgz -C /d . ; \
  docker unpause jur-jur-1; cd \$B && sha256sum *.tgz > SHA256SUMS && sha256sum -c SHA256SUMS && cp $A/current/infra/.env \$B/previous.env && chmod 600 \$B/previous.env"
```
Expected: `jur_jur-dados.tgz: OK`, `jur_jur-cache.tgz: OK`. O `unpause` roda mesmo se o tar falhar.

- [ ] **Step 7: Troca**

```bash
ssh $H2 "readlink -f $A/current > $A/.previous-release && ln -sfn $A/releases/$REL $A/current && docker compose -p jur -f $A/current/infra/compose.yml up -d --no-build"
```
Nunca `down -v`.

- [ ] **Step 8: Checagens pós-troca**

```bash
ssh $H2 "for i in \$(seq 1 40); do [ \"\$(docker inspect -f '{{.State.Health.Status}}' jur-jur-1)\" = healthy ] && break; sleep 3; done; docker inspect -f '{{.Config.Image}} {{.State.Health.Status}}' jur-jur-1"
curl -fsS https://jurcrawler.com.br/api/v1/saude
for p in /api/v1/me /__local/painel.js /docs /relatar.js; do printf '%s %s\n' $p $(curl -s -o /dev/null -w '%{http_code}' https://jurcrawler.com.br$p); done
ssh $H2 "sleep 5; docker logs jur-jur-1 2>&1 | grep -i 'aviso de deploy' | tail -1; docker exec jur-jur-1 printenv JUR_SENTINELA"
```
Expected: `jur:<sha> healthy`; `{"ok":true,"versao":"1.1.0"}`; `/api/v1/me 401`, `/__local/painel.js 404`, `/docs 200`, `/relatar.js 200`; `aviso de deploy: enviado`; `1`. Se algo falhar: `ln -sfn $(cat $A/.previous-release) $A/current && docker compose -p jur -f $A/current/infra/compose.yml up -d --no-build` e parar.

- [ ] **Step 9: Limpar o pacote**

Run: `ssh $H2 "rm -f $A/incoming/jur-$SHA.tar.gz" && rm -f /tmp/jur-$SHA.tar.gz`

---

### Task 15: Smoke de falha forçada em produção e registro de QA

**Files:**
- Create: `docs/qa/<AAAA-MM-DD>-producao-kaizen.md`

- [ ] **Step 1: Falha real com captura chegando ao FFD** — sentinela manual com timeout curto força a classe `timeout` pelo caminho `SIGUSR2` → print → outbox

Run: `ssh brpl@168.231.91.47 "docker exec jur-jur-1 node tests/sentinela.js trf4 --enviar --timeout 5"`
Expected: casos do trf4 com `falha timeout`; exit 1. No FFD, `/jur-falhas`: assinatura `trf4|timeout|…` com origem `sentinela`, print e HTML visíveis no detalhe, e um resumo recebido. Marcar a assinatura `ignorado` com nota `smoke de deploy 1.1.0`.

- [ ] **Step 2: Rodada boa** — `ssh brpl@168.231.91.47 "docker exec jur-jur-1 node tests/sentinela.js trf4 tjpr --enviar"`
Expected: casos `ok`, resumo com `falhas: 0` no FFD.

- [ ] **Step 3: Relato pelo widget** — logado em https://jurcrawler.com.br, abrir uma busca, Alt+I, título `Smoke do relato 1.1.0`, enviar.
Expected: confirmação `Criada: BRU-<n>`; card `[jur] Smoke do relato 1.1.0 (usuário <id>)` em Todo no BRU com a tabela de contexto (ID do usuário, Equipe, Versão `1.1.0 · <sha>`, Busca, Tribunal); bloco User Issues do FFD com `JurCrawler | Smoke do relato 1.1.0`. Depois: `/Users/brpl/code/ProcStudio/bin/linear move BRU-<n> Canceled` e "resolver" no FFD.

- [ ] **Step 4: Outbox vazia e sem erro no log**

Run: `ssh brpl@168.231.91.47 "docker exec jur-jur-1 node -e \"const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/dados/kaizen.db').prepare('SELECT count(*) n FROM kaizen_envio').get().n)\"; docker logs jur-jur-1 2>&1 | grep -c '\[kaizen\]'"`
Expected: `0` e `0`.

- [ ] **Step 5: Card do relatório de uso (decisão 3)**

Run: `/Users/brpl/code/ProcStudio/bin/linear create "[jur] Relatorio diario de uso e USAGE_IP_SALT" --team BRU --state Backlog --labels backend --body-file <arquivo com: o JurCrawler só tem aviso de deploy; o CLAUDE.md do workspace diz que tem usage_events e heartbeat; falta implementar ou corrigir o CLAUDE.md>`
Expected: `BRU-<n>` criado.

- [ ] **Step 6: Registro de QA** — `docs/qa/<data>-producao-kaizen.md` no formato de `docs/qa/2026-10-14-producao-versao-aviso-deploy.md`: release, imagem, SHA do pacote, anterior, backup; "O que mudou"; envs acrescentadas (nomes e tamanhos, nunca valores); tabela de validação (suítes, `saude`, `me`/`painel`/`docs`/`relatar.js`, `healthy`, `aviso de deploy: enviado`, falha forçada no FFD, rodada boa, relato BRU + FFD, outbox zerada); card do Step 5.

- [ ] **Step 7: Commit e push**

```bash
git add docs/qa/
git commit -m "docs(qa): implantacao 1.1.0 com Kaizen, sentinela e relatos"
git push origin main
```

---

## Self-Review

1. **Cobertura do spec.** §1 captura → Tasks 4, 5, 7 (preload por decisão 1; SIGUSR2 por decisão 2); classes → Task 1; cancelamento/zero não-falha → Tasks 7, 8. §2 conferência → Tasks 2, 3 (`normalizarResultado` e teste de campo não reconhecido por decisão 4), aviso ao usuário → Tasks 7, 8. §3 resgates → Tasks 7, 8 (`resolvido_pelo_usuario`, `navegador_falhas` por decisão 6). §4 sentinela → Task 12 (agendador próprio por decisão 3; marcador do aviso de deploy; segunda-feira; teto remoto; espera do usuário; resumo; `npm run sentinela`). §5 relato → Tasks 10, 11 (porta fiel, mesmos casos do FFD, BRU por decisão 7, Linear fora). §6 outbox e payloads → Tasks 6, 7 (`KAIZEN_SALT` por decisão 3). Restrições (envs no `.env` e README, versão, release imutável) → Tasks 13–15. §7 (FFD) e §8 (ProcStudio) estão fora; o alvo do `sync.sh` só é conferido.
2. **Passos.** Cada passo de código traz assinatura e valores; corpos ficam com o implementador, exceto o comando de fixtures e os de produção, que são o próprio passo.
3. **Nomes.** `dirFalha`/`lerCaptura`/`marcarAssinatura`/`assinaturaDaCaptura`/`limparCaptura` (Task 5) são usados nas Tasks 7, 8, 11; `executarNaRota` (Task 8) na Task 12; `kaizenNulo` (Task 7) nas Tasks 8, 12; `FILTROS` = chaves de `capacidades.js`, usadas em `filtro_ignorado:<filtro>` e na sentinela.
4. **Review Focus.** Os cinco itens têm teste: 1 e 2 na Task 4, 3 na Task 3, 4 nas Tasks 1 e 7, 5 na Task 6.
5. **Proporção.** O plano fica perto do tamanho do spec com os passos de produção; código só em asserções e comandos.
