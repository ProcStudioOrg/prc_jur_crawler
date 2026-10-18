# Kaizen: falhas do JurCrawler e relatos de usuário no FFD

Data: 2026-10-18 · Repositórios: `prc_jur_crawler`, `ai-dashboard` (FFD), `ProcStudio-Docker`

## Intenção

O JurCrawler quebra quando um tribunal muda o site, bloqueia o IP do servidor (H2) ou
põe captcha. Hoje a falha some: fica `job.erro` no SQLite e um `console.error`. Pior
que a falha que dá erro é a que **não dá**: o tribunal ignora em silêncio o filtro de
data, de magistrado, de juizado ou de número, e o usuário recebe resultado errado
achando que está certo. Bruno considera essas de extrema importância.

Objetivo: toda falha — explícita, silenciosa ou relatada pelo usuário — chega ao Bruno
no FFD com material suficiente para consertar **sem reproduzir** (print, HTML, rota,
passo, filtros). Ele conserta à mão com o `jur-fixer`, marca como coberto, e se a
mesma falha voltar o FFD acusa regressão. Ciclo Kaizen: cada quebra vira um conserto,
e o sistema fica à prova de falhas por acúmulo.

Modelos que já existem e servem de molde (copiar o desenho, não reinventar):
- **Extensão → FFD** (`prc_extensao/diagnostico/`, FFD `lib/extensao-diagnostico/`):
  HTML gzip+base64, sha256 dedupe, fila local com retry em 5xx/rede, alerta com
  janela de 10 min em `alert_events`, tela com filtros e HTML em iframe sandbox.
- **Conhecimento de intimações** (branch `brpl/superadmin-intimacoes` do ProcStudio):
  agrupamento por assinatura normalizada (dígitos → `#`, sem acento), status
  `novo | em_analise | coberto | ignorado` + nota, e `coberto` que reaparece volta a
  `novo` como regressão.
- **issue-reporter** (FFD `issue-reporter/`, copiado para WAO e ProcStudio): widget
  Shadow DOM (Alt+I) que captura console e rede com erro, servidor monta o card no
  Linear e acrescenta o contexto que só o servidor sabe.

## Metas

1. **Captura automática de falha** em toda busca do JurCrawler que termina em erro.
2. **Conferência de filtros** em toda busca concluída: data, magistrado, juizado,
   número. Filtro ignorado vira falha.
3. **Resgates** registrados: busca que só passou porque caiu no Steel (reserva) ou
   porque o usuário resolveu captcha à mão. Mostra onde o sistema está frágil.
4. **Sentinela diária**: para cada tribunal × capacidade declarada, uma busca com
   resposta conhecida, conferida pelas mesmas regras da meta 2.
5. **Botão de relatar** no JurCrawler (o mesmo widget), card no Linear time **BRU**.
6. **FFD**: fila de falhas do JurCrawler agrupadas por assinatura, e bloco
   **User Issues** no dashboard principal com relatos de todos os serviços:
   `JurCrawler | Usuário relatou…`, `ProcStudio | Usuário relatou…`.
7. **ProcStudio** passa a mandar cada relato também para o FFD, além do Linear.

## Não-metas (agora)

- Card automático no Linear para falha automática. Conserto automático. Só o relato
  do usuário vira card (como já é no ProcStudio).
- Fallback com navegador de IA (Skyvern/Stagehand). Vem depois, alimentado por estes
  dados.
- WhatsOrganizer mandar relatos ao FFD (o contrato fica pronto; não mexer no WAO).
- Mudar automaticamente `cobertura/capacidades.json` ou o estado do tribunal a partir
  da sentinela. A sentinela reporta; o Bruno decide.
- Telegram. Os alertas entram em `alert_events` com `sent_telegram=0`, igual à extensão.

## Anti-metas (seria fracasso mesmo funcionando)

- **Falso positivo de filtro ignorado.** Um alarme que grita em busca saudável ensina
  a ignorar o alarme — mesma lição do override de termo do `tests/smoke.js`. Na dúvida,
  `nao_verificavel`, nunca falha.
- **Captura que quebra a busca.** Nada do Kaizen pode transformar sucesso em erro,
  atrasar o resultado ao usuário ou segurar vaga do pool. Tudo em try/catch, envio
  assíncrono.
- **Vazar segredo.** Token de Kernel/Steel/CDP, cookie, chave de API ou chave pessoal
  nunca entram em payload, print de URL ou HTML enviado. `navegadorPreload.js` já
  reescreve erros de CDP — manter essa garantia.
- **Inundação.** 17 ocorrências da mesma quebra = 1 linha com contador, não 17 alertas.
- **Sentinela que derruba o usuário.** Não pode competir com busca real por vaga nem
  queimar sessão remota paga sem limite.

## Restrições

- Produção do JurCrawler: container no H2, release imutável (ver CLAUDE.md do
  workspace). Variável nova vai no `infra/.env` da release e no `infra/README.md`.
  Bump de versão em `jur/package.json` (minor: 1.0.1 → 1.1.0) e `CHANGELOG.md`.
- FFD: merge na `main` = deploy no NAS. Testes com vitest. Banco SQLite via drizzle,
  DDL em `lib/db/migrations.ts` no padrão de `extensao-diagnostico/schema.ts`.
  Arquivos grandes em `data/<sub>/AAAA-MM-DD/<sha>.gz`, nunca no banco.
- FFD auth: endpoint key com escopo de sources (`lib/endpoint-keys.ts`). Uma key por
  serviço com a lista dos sources que ele usa.
- ProcStudio: parâmetro novo no SSM de prod **não entra sozinho** na taskdef — o
  pipeline clona a revisão ativa. O deploy tem que registrar a env na taskdef.
- `issue-reporter`: `widget.js` e o núcleo são copiados sem alterar; cada repo escreve
  só a sua "cola". `sync.sh` do FFD ganha o alvo do JurCrawler.
- Linear do JurCrawler: time **BRU** (BrunoDev), não PRC; labels são os do BRU.
- Nada de chave de LLM nem de Linear no browser.

## Desenho

### 1. JurCrawler — captura da falha (meta 1)

Na CLI (processo filho), quando a busca falha com uma página aberta, grava antes de
fechar o browser, ao lado do arquivo de saída do job:

```
resultados/<jobId>.falha/
  tela.png      viewport, não fullPage (tamanho)
  pagina.html   page.content() da página mais recente
  meta.json     { url (sem query), titulo, passo, tribunal, rota, erro, em }
```

`passo` é o último marco que o crawler declarou (ex.: `abrir`, `preencher_filtros`,
`submeter`, `esperar_resultados`, `extrair`, `paginar`, `inteiro_teor`). O builder
adiciona um `this.passo = '...'` nos pontos de troca do `BaseCrawler` e dos crawlers
que não passam por ele; onde não houver marco, `desconhecido`. O ponto único de
captura deve ser o tratamento de erro de topo do `bin/jur`/`BaseCrawler`, não cada
crawler.

No servidor, `jobs.js`, no ramo `status='erro'`, chama `kaizen.registrar(job, r)`
(módulo novo `servidor/kaizen/`) que:
- classifica o erro (tabela abaixo);
- monta a **assinatura**: `tribunal|classe|passo|erro_normalizado` (dígitos → `#`,
  sem acento, minúsculo, URLs e ids removidos, cortado em 200 chars);
- põe na fila de envio (seção 6). Nunca lança.

| classe | como reconhece (primeira que bater) |
|---|---|
| `fornecedor_remoto` | `Nenhum navegador remoto disponível` / `FALHA_DO_FORNECEDOR` de `remotos.js` |
| `bloqueio_ip` | HTTP 403, `ERR_CONNECTION_*`, `ERR_HTTP2_PROTOCOL_ERROR` na rota local |
| `captcha` | erro/aviso de captcha não resolvido (STJ/TJSP, timeout da pausa assistida) |
| `timeout` | `timeout apos` do executor ou timeout do Playwright |
| `seletor` | `waiting for locator`/`selector` do Playwright |
| `vazio_suspeito` | 0 resultados **e** a página não parece de resultados (heurística por crawler opcional; sem ela, não usar) |
| `desconhecido` | resto |

Zero resultados com página de resultados normal **não** é falha.

Cancelamento pelo usuário não é falha.

### 2. JurCrawler — conferência de filtros (meta 2)

Módulo puro `servidor/kaizen/conferencia.js`: `conferir(params, resultados) →
{ filtro, veredito: ok | ignorado | nao_verificavel, detalhe }[]`.

| filtro | campo do resultado | regra |
|---|---|---|
| `dataInicio/dataFim` | `dataJulgamento` | data dentro do período (inclusivo, tolerância de 1 dia) |
| `dataPubInicio/dataPubFim` | `dataPublicacao` | idem |
| `relator` | `relator` | nome normalizado (sem acento, sem `des.`, `min.`, `juiz(a)`, `desembargador(a)`, `convocado`) contém o pedido normalizado, ou vice-versa |
| `juizados=true` | `orgaoJulgador` | casa `/turma recursal|juizado|\bjef\b|\btr\b|turma regional de uniformiza/i` |
| `numero` | `numeroProcesso` | só dígitos do CNJ iguais (ignorar sufixo `/TRF4` etc.) |

Veredito por filtro:
- `nao_verificavel` se menos de 3 resultados têm o campo preenchido e parseável (para
  `numero`, basta 1), ou se a capacidade usa `forma: codigo` em `relator.js`.
- `ignorado` se **mais de 50%** dos resultados com campo violam a regra.
- `ok` caso contrário.

Cada `ignorado` vira falha classe `filtro_ignorado:<filtro>` (assinatura com
`passo=conferencia`), com os 5 primeiros exemplos violadores no payload (só os campos
conferidos + `numeroProcesso`).

**Decisão do builder (minha):** o job concluído também ganha um item em `avisos`
("o tribunal parece ter ignorado o filtro de data: 7 de 10 resultados fora do
período"), porque senão o usuário segue com resultado errado. Usa o canal de `avisos`
que já existe — sem tela nova.

`nao_verificavel` é contado (vai no relatório diário) mas não gera falha.

Cada filtro deve ter teste com fixture real de `resultados/` — inclusive o caso de
falso positivo (resultado saudável que não pode ser marcado).

### 3. JurCrawler — resgates (meta 3)

Busca concluída que (a) usou provedor diferente do primeiro da ordem
(`job.navegador` contém `(reserva)`) ou (b) passou por pausa assistida resolvida pelo
usuário, gera evento `resgate` com tribunal, rota, motivo do provedor anterior.
Sem print/HTML, sem alerta; só contagem e entrada na fila com classe `resgate:<tipo>`.

### 4. JurCrawler — sentinela (meta 4)

`jur/tests/sentinela.js` + `jur/tests/sentinela-casos.json`. Um caso por tribunal ×
capacidade que o tribunal declara funcionar (`capacidades.js`):

```json
{ "tribunal": "trf4", "capacidade": "periodoJulgamento",
  "params": { "query": "auxílio-acidente", "dataInicio": "01/03/2025", "dataFim": "31/03/2025" },
  "espera": { "minimo": 1 } }
{ "tribunal": "trf4", "capacidade": "numero",
  "params": { "numero": "5057135-38.2021.4.04.7100" }, "espera": { "encontrado": true } }
```

- Roda a CLI direto (como `tests/smoke.js`, reaproveitando o spawn/classificador dele),
  passa o resultado por `conferencia.js` e pelo classificador de erro. Falha → mesma
  fila, origem `sentinela`. Zero onde se espera ≥1 = `vazio_suspeito`.
- Casos nascem de buscas reais que funcionaram (números e relatores de `resultados/`),
  nunca inventados. O builder monta os casos dos tribunais 🟢; os demais ficam fora
  da lista e são listados num comentário como pendência.
- Agenda: dentro do container, agendador em processo no padrão do relatório diário
  de uso, às **04:00 America/Sao_Paulo**, serializado (1 por vez), espaçado ≥ 5 s,
  canário único por família de host (mesma regra do smoke para o Falcão).
- Tribunais de rota remota obrigatória (TRF3, Falcão, STJ): só **segunda-feira** e no
  primeiro boot de cada versão nova (mesmo marcador do aviso de deploy). Teto de
  sessões remotas por rodada: env `JUR_SENTINELA_MAX_REMOTO` (padrão 6).
- Não usa o pool de vagas dos usuários; se houver busca de usuário rodando, a
  sentinela espera ela terminar antes do próximo caso (não tira vaga, não preempta).
- Ao fim, envia um **resumo** (rodados, ok, falhas, não verificáveis) — o FFD alerta se
  não chegar resumo em 26 h (ausência = sentinela quebrada).
- Liga/desliga: `JUR_SENTINELA=1`. Desligada por padrão; ligada no `.env` de produção.
- Comando manual: `npm run sentinela [tribunal...] [--json] [--enviar]`.

### 5. JurCrawler — relatar (meta 5)

- `widget.js` copiado sem alterar para `jur/publico/issue-reporter/widget.js`;
  montado no `index.html` só para usuário logado. `sync.sh` do FFD ganha esse alvo.
- Servidor: rotas `GET /api/v1/relatos/meta` e `POST /api/v1/relatos`, atrás da
  sessão (cookie) — mesmo contrato do issue-reporter. O núcleo (`report.ts` +
  `linear.ts`) é TypeScript; o JurCrawler é CommonJS sem build. **Decisão do builder:**
  porta fiel para `jur/servidor/issue-reporter/{report,linear}.js` com cabeçalho
  "porta de issue-reporter/report.ts — manter em sincronia", e o teste de contrato
  usa os mesmos casos do FFD. Não adicionar build TS ao JurCrawler.
- Cola: `LINEAR_API_KEY`, `LINEAR_TEAM_ID` (BRU) no `.env` de produção; sem eles o
  widget fica desligado (`enabled:false`), nunca quebra a tela.
- Contexto do servidor (fato, não afirmação do browser): usuário (e-mail, id),
  equipe, versão + revisão, e — se o widget mandar `jobId` do job aberto na tela e o
  job for do mesmo usuário — tribunal, filtros, rota, status, erro, e se existe
  captura de falha desse job (link para a falha no FFD).
- `extra` do widget: `jobId` e tribunal da busca visível.
- Depois de criar o card (ou se o Linear falhar), põe o relato na fila de envio para o
  FFD (`user-issues`). Linear fora: o relato vai ao FFD mesmo assim com
  `linear: null`, e o usuário vê erro só se **os dois** falharem.

### 6. JurCrawler — envio ao FFD

Tabela SQLite `kaizen_envio` (outbox): `id, source, corpo_json, tentativas,
proxima_em, criado_em`. Drenagem a cada 60 s e logo após enfileirar. 2xx → apaga;
408/429/5xx/rede → backoff (1, 5, 15, 60 min, depois de hora em hora), descarta após
48 h; outro 4xx → descarta e loga. Teto 200 MB / 5000 itens (descarta os mais velhos).
Print e HTML vão gzip+base64 no corpo; HTML > 4 MB vai truncado com aviso.

Env: `KAIZEN_WEBHOOK_URL` (base `https://ffd.belzinhos.com.br/api/webhooks`) e
`KAIZEN_WEBHOOK_TOKEN` (endpoint key com sources `jur-diagnostico,user-issues`).
Sem eles, o Kaizen grava local e não envia (dev/local continua funcionando).

Payload `jur-diagnostico` (um item por POST):

```
{ servico:"jurcrawler", versao, revisao, origem: "busca"|"sentinela",
  tipo: "falha"|"resgate"|"resumo",
  tribunal, classe, passo, assinatura, erro, rota,
  filtros: { query, dataInicio, ..., juizados, numero },
  conferencia: [...],          // só filtro_ignorado
  exemplos: [...],             // só filtro_ignorado, até 5
  job_id, usuario_hash,        // SHA256(usuario_id + USAGE_IP_SALT); nunca e-mail
  em,
  tela_png_gzip_b64?, html_gzip_b64?, html_sha256?, url?, titulo?,
  resumo?: { rodados, ok, falhas, nao_verificaveis } }  // só tipo resumo
```

Payload `user-issues` (genérico, serve ProcStudio, JurCrawler e WAO no futuro):

```
{ servico: "jurcrawler"|"procstudio"|..., titulo, descricao (até 2000),
  autor_email, autor_nome?, equipe?, rota?, versao?,
  linear: { identifier, url } | null, contexto: {chave: valor}, em }
```

### 7. FFD

Dois sources novos em `app/api/webhooks/[source]/route.ts`, cada um com
`lib/<modulo>/{contracts,schema,store}.ts` no padrão de `extensao-diagnostico`, e
limite de corpo pelo Content-Length.

**`jur-diagnostico`** (`lib/jur-diagnostico/`):
- `jur_falha_assinaturas`: `assinatura` (única), tribunal, classe, passo, `status`
  (`novo | em_analise | coberto | ignorado`), nota, ocorrências, primeira/última vez,
  `regressoes`, última versão vista, `ultima_ocorrencia_id`.
- `jur_falhas`: uma linha por ocorrência, FK para assinatura, campos do payload,
  `png_path`/`html_path` em `data/jur-diagnostico/AAAA-MM-DD/<sha>.{png,html}.gz`
  (dedupe por sha256). Retenção 30 dias (linhas + arquivos), assinaturas ficam.
- `coberto` que recebe ocorrência nova → `novo`, `regressoes += 1`.
- Alerta em `alert_events` (tipo `jur_falha`, warning) só quando a assinatura **nasce**
  ou **regride**; janela de 10 min por assinatura. `resgate` nunca alerta.
- `resumo` da sentinela: guarda; regra que alerta se não houver resumo em 26 h.
- Página `/jur-falhas`: lista de assinaturas (filtros: status, classe, tribunal,
  origem), ordenada por última vez; detalhe com ocorrências, print, HTML em iframe
  sandbox (reaproveitar o de extensão), filtros pedidos, exemplos da conferência,
  botões de status + nota. Um botão "copiar para o jur-fixer" que copia um bloco de
  texto com tribunal, passo, erro, URL, filtros e os caminhos/links do print e do
  HTML.
- Bloco no dashboard principal: "JurCrawler — falhas" com contagem `novo` e
  regressões, link para `/jur-falhas`.

**`user-issues`** (`lib/user-issues/`):
- `user_issues`: serviço, título, descrição, autor, equipe, linear identifier/url,
  contexto_json, `status` (`aberto | resolvido`), recebido_em. Sem retenção.
- Alerta `user_issue` (info) a cada relato.
- Bloco **User Issues** no dashboard principal (`app/page.tsx`): os 10 abertos mais
  recentes, uma linha cada `Serviço | título — autor · há 2 h`, link para o card do
  Linear quando houver; botão "resolver". Página `/user-issues` com todos e filtro
  por serviço.

### 8. ProcStudio

Só a cola (`api/app/controllers/api/v1/issue_reports_controller.rb` e/ou
`issue_reporter_settings.rb`); o núcleo `issue_reporter.rb` copiado do FFD não muda.
Depois do `submit` — com sucesso **ou** com `LinearError` — enfileira job Sidekiq
`FfdUserIssueJob` que faz POST `user-issues` com `servico:"procstudio"`, título,
descrição, usuário, time, plano, rota e o card criado (ou `null`). Retry padrão do
Sidekiq. Env `FFD_USER_ISSUES_URL` + `FFD_USER_ISSUES_TOKEN`; sem eles, não envia.
Se o Linear falhar mas o envio ao FFD for enfileirado, o usuário recebe sucesso
("Recebido") em vez do 502 atual. Em produção, as envs precisam entrar na taskdef
(SSM sozinho não basta — ver Restrições).

## Ordem de entrega

1. **FFD**: sources, tabelas, páginas, blocos no dashboard. Merge = deploy. Criar as
   endpoint keys (`jurcrawler`: `jur-diagnostico,user-issues`; `procstudio-issues`:
   `user-issues`).
2. **JurCrawler**: captura, conferência, resgates, outbox, widget/relatos, sentinela.
   Release 1.1.0 no H2 com as envs novas; registro em `docs/qa/`.
3. **ProcStudio**: envio duplo, PR no fluxo normal do repo, envs na taskdef.

Cada entrega se valida sozinha: (1) com `curl` de payloads de exemplo; (2) forçando
uma falha real (tribunal com seletor quebrado em dev) e um filtro ignorado com fixture;
(3) relatando pelo widget em HML/dev.

## Decisões após a revisão do builder (calls do Claude — conferir)

A revisão mostrou que o código é diferente do que as seções acima assumem em vários
pontos. Estas decisões **substituem** o texto acima onde houver conflito.

1. **Ponto de captura = preload, não BaseCrawler.** Só 6 de 52 crawlers estendem
   `BaseCrawler`, e o `bin/jur` (7.688 linhas) tem um try/catch por comando. A
   captura vai em `src/navegadorPreload.js`, que passa a ser carregado **sempre** pelo
   executor. Ele envolve `chromium.launch` e `connectOverCDP` para registrar as
   páginas abertas e intercepta `process.exit(code≠0)`: captura print + HTML da
   página mais recente (teto de 8 s) e depois sai de verdade. Os marcos de `passo`
   ficam opcionais (`globalThis.__jurPasso = '...'`). Sem marco, o `passo` é derivado
   da URL/título; os marcos entram aos poucos, primeiro nos tribunais que mais falham.
2. **Timeout ganha prazo para capturar.** O executor deixa de matar o grupo direto:
   manda `SIGUSR2` ao filho, o preload captura e sai, e o SIGTERM/SIGKILL atual fica
   para 8 s depois. Se a captura não sair nesse prazo, o envio vai só com `meta.json`.
3. **O JurCrawler não tem relatório diário de uso nem `USAGE_IP_SALT`**, ao contrário
   do que o CLAUDE.md do workspace diz (só existe o aviso de deploy). A sentinela
   ganha um agendador próprio (`setTimeout` até as próximas 04:00 SP). O
   `usuario_hash` usa uma env nova, `KAIZEN_SALT`; sem ela, não manda hash. O
   relatório de uso fica **fora** deste projeto; abrir card no BRU.
4. **Campos variam por crawler.** O número vem de `numeroProcesso` **ou** `processo`
   (33 crawlers usam `processo`). Uma normalização (`normalizarResultado`) roda antes
   da conferência e lê os nomes conhecidos de cada campo. Quando o resultado traz um
   booleano `juizado`, ele vale mais que o regex de `orgaoJulgador`. Um teste reprova
   crawler cujo campo não é reconhecido.
5. **ProcStudio:**
   - O trabalho sai de `development`, numa branch nova. Da branch de intimações só se
     copia a ideia.
   - O `sync.sh` do FFD aponta para `ProcStudio/ProcStudio/...`, que não existe.
     Corrigir para `ProcStudio-Docker` na entrega 1 e conferir se o núcleo copiado já
     derivou (se derivou, só reportar, não sincronizar à força).
   - As envs vão nas taskdefs de **api e sidekiq**.
6. **Resgate pelo usuário:** `registro.js` passa a marcar `resolvido_pelo_usuario`
   quando um `continuar` faz a pausa terminar com sucesso, e o job grava isso numa
   coluna nova. O motivo do provedor anterior (hoje só no `aoFornecedor`) é guardado
   numa coluna `navegador_falhas`.
7. **Linear BRU:** sem grupos de label, `alwaysLabels: []`, título
   `[jur] {title} ({author})`, estado inicial `Todo`.
8. **Alerta de "sentinela sem resumo há 26 h":** fica no FFD, dentro do agendador de
   observabilidade (`lib/observability/scheduler.ts`), só para o JurCrawler. Estender
   para os heartbeats dos outros serviços fica fora.

## Deixado ao builder

- Nomes exatos de arquivos/funções dentro dos módulos descritos.
- Onde exatamente pôr os marcos de `passo` em cada crawler.
- Layout visual das páginas e blocos do FFD (seguir o estilo de `extensao-diagnostico`).
- Escolha dos casos da sentinela, desde que vindos de resultados reais.
- Regex finos de classificação, desde que cobertos por teste com mensagens reais.
