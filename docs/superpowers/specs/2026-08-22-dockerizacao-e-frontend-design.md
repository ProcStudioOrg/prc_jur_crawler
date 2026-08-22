# Dockerização do `jur` + frontend local, API HTTP e MCP

**Data:** 2026-08-22
**Status:** aprovado, aguardando plano de implementação
**Cards relacionados:** [BRU-68](https://linear.app/brunopellizzetti/issue/BRU-68) (uniformização do contrato da CLI) · [BRU-69](https://linear.app/brunopellizzetti/issue/BRU-69) (CSJT + check de reconciliação)

## 1. Objetivo

Empacotar o `jur` num ambiente fechado que roda em qualquer sistema — **com os browsers
dentro** — e dar a ele três superfícies sobre um único núcleo:

1. **API HTTP** aberta, consumível por qualquer cliente;
2. **servidor MCP**, para o Claude Code e outros agentes;
3. **frontend local** (skeleton) com chat, lista de tribunais disponíveis/indisponíveis
   e um lugar para a chave da IA.

Alvo de execução: **local agora, servidor depois** — jobs assíncronos e estado fora do
processo desde o início, sem reescrita quando virar servidor compartilhado.

## 2. Levantamento que fundamenta o desenho

Tudo abaixo foi **medido** no repo em 2026-08-22, não estimado.

### 2.1 Onde mora a uniformidade

As classes `*Crawler` **não** têm interface comum. `TRF4Crawler` expõe
`navigateToSearch`/`configureFilters`/`executeSearch`/`extractResults`/`hasNextPage`;
`STFCrawler` e `TJPRCrawler` expõem só `search(query, filters, options)`. São famílias
distintas. Quem as uniformiza são as **7.366 linhas** de `bin/jur`.

**A CLI tem 75 subcomandos**, não 49: 49 estáticos mais 26 registrados em laço a partir de
`src/FalcaoTribunais.js` (`bin/jur:3797`) — TST + TRT1..24 + CSJT, que vivem num índice
nacional único (FALCÃO).

Cobertura das flags do denominador comum:

| Flag | Cobertura (75 subcomandos) |
|---|---|
| `--json` | **75/75** |
| `-q, --query` | **75/75** (5 via `.requiredOption()`: `trf1` `trf3` `trf5` `tcu` `tjsp`) |
| `-o, --output` | 74/75 |
| `-m, --max-pages` | 73/75 |
| `-di/-df` | 72/75 |

Os 26 comandos do FALCÃO carregam o mesmo núcleo (`-q`, `-di`, `-df`, `-m`, `-o`, `--json`),
verificado em `bin/jur:3800-3835`.

Exceções: **`crps`** (não é comando de busca — é `--login`/`--status`/`--capturar`) e **`tjrn`**
(sem `--max-pages`; só consulta por número).

### 2.2 O contrato `--json`

Envelope **universal**: todo subcomando devolve `{success: true|false}`.
Payload **não uniforme**: 45 devolvem resultados inline (`{...res}`), 5 devolvem
`{count, output}` e esperam leitura do arquivo, e há ~20 variantes menores.

### 2.3 Browser

Só **5 arquivos** fazem `require('playwright')`: `BaseCrawler`, `STFNavigator`,
`STJNavigator`, `TJSCNavigator`, `CRPSNavigator`. **Firefox nunca é usado** — `BaseCrawler`
importa `{chromium, firefox}` e aceita `browserType`, mas nenhum crawler passa `'firefox'`.

Por `acesso`, dos 73 comandos catalogados: `api` 45 · `http` 19 · `browser` 8 · `api-oficial` 1.

Três ressalvas que o design precisa absorver:

- **O STF é `acesso: api` mas precisa de browser mesmo assim.** `STFNavigator.js:288`:
  o cookie `aws-waf-token` é *"a ÚNICA etapa que precisa de browser; vale ~4 dias"*. E ele é
  cacheado em `os.tmpdir()` (`STFNavigator.js:43`) — que em container morre a cada recreate.
- **`TRF3Crawler.js:10` pede o Chrome do sistema** (`useSystemChrome: true` → `channel: 'chrome'`),
  que a imagem não terá. TRF3 já está `instavel`; fica documentado como não-suportado em container.
- **CRPS não vai para container.** `launchPersistentContext` + Gov.br, que **valida dispositivo**
  e recusa navegador desconhecido (`CLAUDE-CRPS.md`, tentativa real de 31/07/2026).

### 2.4 Colisão semântica que proíbe uma API "uniforme" ingênua

`--orgao` significa **órgão julgador** nos tribunais judiciais e **órgão fiscalizado** nos TCEs
(ex.: `"EXECUTIVO MUNICIPAL DE NOVO BARREIRO"`). Mapear `orgao` de forma única buscaria no campo
errado e devolveria zero — que se lê como "não há julgado". Por isso **o v1 não expõe filtros
exóticos**, só o denominador comum verificado. Detalhe completo em BRU-68.

### 2.5 Integridade do catálogo

O catálogo (`cobertura/tribunais.json`, 73 comandos) é **subconjunto estrito** da CLI (75).
Fora dele: `csjt` (bug — acervo funcional invisível para qualquer lista gerada) e `crps`
(esperado). **Não existe check de reconciliação** — foi por isso que passou. Ver BRU-69.

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Executar a CLI como subprocesso**, não chamar as classes | a uniformidade só existe na CLI; ganha isolamento de processo de graça |
| D2 | **Um container só** | SQLite dispensa banco; frontend sem build dispensa serviço de front |
| D3 | **`node:20-slim` + `playwright install --with-deps chromium`** (**2,25 GB em disco, medido na Task 3** — a estimativa original de ~1,1 GB estava errada; o layer do `--with-deps` sozinho pesa 1,37 GB de libs de sistema do Debian (X11, Mesa, NSS, fontconfig etc.), que é o que domina o tamanho, não o Chromium em si. Reduzir mais exigiria trocar de estratégia — libs mínimas hand-picked, ou base `mcr.microsoft.com/playwright` — decisão de arquitetura fora do escopo da Task 3) | firefox/webkit são código morto no repo, então não entram |
| D4 | **SQLite em volume** | estado fora do processo sem serviço extra; migra para Postgres trocando uma camada |
| D5 | **Frontend HTML+JS puro** servido pelo mesmo Node | zero build step; é um chat, uma lista e um campo |
| D6 | **Três superfícies, uma implementação** | REST, MCP e chat chamam as mesmas funções de `jobs`+`catalogo` |
| D7 | **Só o denominador comum de filtros no v1** | a colisão do `--orgao` (§2.4) torna o resto perigoso |
| D8 | **Resultados continuam arquivos JSON** | meia-normalização criaria um segundo contrato errado (BRU-68) |

### Alternativas descartadas

- **Biblioteca in-process** (extrair um registry de `bin/jur` e chamar as classes): mais rápida e
  testável sem `spawn`, mas exige reescrever o grosso das 7.366 linhas **antes do primeiro pixel**,
  arrisca a parte do repo que hoje funciona e tem smoke, e faz um Chromium vazado derrubar o
  servidor. Reavaliar depois de BRU-68.
- **Registry declarativo de flags por tribunal** (para formulário por tribunal e schema de tool
  específico no MCP): exige mapear flags heterogêneas de 75 subcomandos (`tjsc` sozinho tem 55
  opções). Não paga no v1; entra incrementalmente quando um tribunal pedir.
- **Imagem "slim" sem browser**: quebraria o STF (§2.3), que é dos tribunais mais buscados.
  A fronteira "precisa de browser" **não** coincide com a coluna `acesso`.
- **Postgres + Redis no compose**: monta o alvo de servidor, mas custa dois containers para rodar
  em localhost. SQLite atende e a migração é localizada.

## 4. Arquitetura

### 4.1 Container

```
jur-app  (node:20-slim + chromium do Playwright, 2,25 GB em disco — medido na Task 3, ver D3)
 ├── :3000  frontend estático + API HTTP + MCP
 └── volumes:
     ├── jur-dados  → /dados   (SQLite + resultados/*.json)
     └── jur-cache  → /cache   (TMPDIR: token do WAF do STF, perfis)
```

`ENV TMPDIR=/cache` resolve o cache do token do STF **sem tocar no código do crawler**.
Sem isso, todo `docker compose up` paga um Chromium de partida.

**Sandbox do Chromium:** o compose declara
`security_opt: [seccomp:./infra/chrome-seccomp.json]` — perfil publicado pela Playwright, que
**mantém o sandbox ligado** e não exige mudança de código. `--no-sandbox` fica documentado como
fallback, nunca como default: é o processo que abre HTML de sites hostis.

**Concorrência: 3 jobs simultâneos** (configurável). Cada job de tribunal `browser` é um Chromium
(~300 MB), então 3 ≈ 900 MB + Node. O compose declara `mem_limit` e o README avisa que uma máquina
de 8 GB aguenta com folga curta.

### 4.2 Camadas

| Camada | Responsabilidade | Conhece |
|---|---|---|
| `executor` | `spawn('node bin/jur <cmd> --json')`, timeout, `kill`, normaliza os 2 formatos de payload | a CLI |
| `catalogo` | lê `cobertura/tribunais.json`; expõe tribunal, estado, `acesso`, `nota` | o JSON gerado |
| `jobs` | fila, concorrência, persistência, progresso | `executor` + SQLite |
| `superficies` | REST · MCP · chat | só `jobs` e `catalogo` |

**Invariante:** nada acima do `executor` monta linha de comando. Se a abordagem in-process
acontecer depois (BRU-68), só o `executor` é reescrito.

Cancelamento e timeout são `kill(pid)` — a vantagem concreta de D1, e a UI ganha "cancelar" de graça.

### 4.3 Estados de tribunal

A UI **não tem lista própria**: lê o mesmo `cobertura/tribunais.json` que `npm run docs` gera.

| Estado | UI | Significa |
|---|---|---|
| `ok` | verde, clicável | busca funcionando |
| `instavel` | amarelo, clicável **com aviso** | responde, mas tem ressalva |
| `sem-acesso` | cinza, desabilitado | captcha / bloqueio |
| `exige-sessao` | azul, clicável → pede sessão | funcionaria com a credencial **do usuário** |

`exige-sessao` é **novo** e nasce na tabela `JURIS` de `cobertura/build.js` (a fonte escrita à mão),
não no front — `tribunais.json` continua gerado. O **CRPS entra no catálogo por ali**, nesse estado,
pela primeira vez.

**Regra do zero:** quando `total === 0`, a UI mostra a `nota` do tribunal, **sempre**. O TRF1 é
`instavel` com a base congelada em 31/07/2025 — sem a nota, esse zero se lê como "não há
jurisprudência", que é a armadilha que o repo inteiro combate.

### 4.4 Modelo de dados (SQLite em `/dados`)

```sql
job(id, comando, params_json, status, criado_em, iniciado_em, terminado_em,
    pid, exit_code, erro, total, arquivo, avisos_json)
conversa(id, titulo, criado_em, atualizado_em)
mensagem(id, conversa_id, papel, conteudo, job_id, criado_em)
sessao(comando, segredo_json, validado_em, expira_em)
```

`status` ∈ `enfileirado | rodando | concluido | erro | cancelado | expirado`.

Resultados ficam em `/dados/resultados/<job_id>.json`; o executor sempre passa `-o` (existe em
48/49 e já tem default de arquivo — estamos redirecionando, não inventando). `sessao` guarda
segredo: só no volume, `chmod 600`, nunca em log nem em resposta de API.

### 4.5 Chat

Loop de tool-use contra a API da Anthropic, com **três tools**:

1. `listar_tribunais(segmento?, uf?, estado?)`
2. `buscar_jurisprudencia(tribunal, query, dataInicio?, dataFim?, maxPaginas?)`
3. `ler_resultados(job_id, offset?, limite?)`

Três e não uma: o LLM precisa **escolher** o tribunal antes de buscar e **ler em fatias** — 500
ementas de uma vez estouram o contexto. Os parâmetros da tool 2 são só o denominador comum
verificado (§2.1), sem `orgao`, pelo motivo de §2.4.

**A chave da IA não é persistida no servidor.** Default de `ANTHROPIC_API_KEY` no env; se o usuário
colar uma na UI, ela fica no `localStorage` do browser e vai por header a cada request. Evita
segredo em repouso no v1 e já é a forma certa para servidor multiusuário.

Progresso e tokens vão pelo **mesmo stream SSE**.

### 4.6 Superfícies

REST em `/api/v1`:

| Rota | |
|---|---|
| `GET /tribunais` | catálogo, filtrável |
| `POST /buscas` | cria job → `202 {job_id}` |
| `GET /buscas/:id` | status |
| `GET /buscas/:id/resultados?offset&limite` | paginado |
| `GET /buscas/:id/eventos` | SSE de progresso |
| `DELETE /buscas/:id` | cancela (`kill`) |
| `POST /chat` | SSE do loop de tool-use |
| `GET /saude` | healthcheck |

**MCP** em `/mcp`, transporte HTTP streamable — o container fica de pé e o cliente conecta por URL,
sem `docker run -i` por sessão. Expõe as **mesmas três tools**, chamando as mesmas funções.
Clientes que só falam stdio precisam de um shim (~20 linhas) — previsto, não construído no v1.

**Frontend:** lista de tribunais à esquerda (agrupada por segmento, filtro por texto/UF, badge de
estado), chat no centro, painel de job com progresso e cancelar, campo da chave no topo.

## 5. Erros

Três coisas que **nunca** podem se confundir: `falhou` (exit ≠ 0) · `zero resultados` ·
`tribunal indisponível`. Toda resposta carrega `{status, total, avisos[]}` e a UI trata as três
diferente. Um crawler que morre jamais chega ao chat como "não encontrei nada".

## 6. Testes

1. **Reconciliação catálogo ↔ CLI** — entra no `npm run smoke`. Hoje falha (`crps`, `csjt`); é o
   teste que teria pego o CSJT. (BRU-69)
2. **Contrato do executor** — os 75 subcomandos devolvem envelope `{success}`. Sem tocar a rede.
3. **Ciclo de vida do job** com executor falso: enfileira, roda, cancela, expira, mata o PID.
4. **`npm run smoke` continua sendo a verdade sobre tribunais** — nada aqui o substitui.

Fora de escopo no v1: testar qualidade de resposta do LLM (caro, instável, e não é o que está
sendo construído).

## 7. Fora de escopo (explícito)

- **CRPS funcionando.** Entra no catálogo como `exige-sessao`, sem crawler. Destravá-lo depende de
  um spike separado: *a validação de dispositivo do Gov.br é gate de login ou de cada requisição?*
  Se for só de login, o cookie de `dataprev.gov.br` obtido no Chrome pessoal do usuário faria
  `/api/now/table/...` responder de qualquer cliente HTTP. **Não testado.**
- **TRF3 em container** (exige Chrome proprietário, §2.3).
- **Autenticação / multiusuário / TLS.**
- **Filtros exóticos por tribunal** (§2.4, BRU-68).
- **Shim MCP stdio.**
