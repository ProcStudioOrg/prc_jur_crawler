# TJPB — Tribunal de Justiça da Paraíba

**Status atual:** 🟡 instável — a API pública respondeu HTTP 503 em duas medições em 30/08/2026. Reteste antes de concluir que não há resultados.

`jur tjpb` — portal **Juris-PB** (`https://app.tjpb.jus.br/juris-pb`), SPA Angular 19 +
PrimeNG sobre backend **Spring Boot + Elasticsearch**. O crawler é **HTTP direto, sem
browser**: a API `/juris-pb-backend/public/*` é pública, sem auth, sem token, sem cookie,
sem sessão e **sem captcha em etapa nenhuma**.

- Mapeamento: 08/08/2026 (`parcial`) · crawler fechado em **13/08/2026** pelo slot da
  dívida de crawler.
- Medição bruta: [`human-codegen/TJPB/01-juris-pb/`](human-codegen/TJPB/01-juris-pb/).
- Acervo: **2.515.754 documentos** (13/08/2026), sendo **78% de 1º grau**.

## O que este tribunal tem de diferente

✅ **É o SEGUNDO tribunal do repo com 1º grau — e o maior deles**: 1.970.661 sentenças,
contra 1.509.942 do TJES. Sentença de 1º grau paraibana é um pedido que só TJPB, TJES,
TJTO e TJRO atendem.

✅ **Ementa e inteiro teor vêm de graça na busca**, em texto plano com `\n` — sem entidade
HTML, sem export de Word (TJPE), sem acento perdido na origem (TJRO).

✅ **Operadores coerentes, com aritmética exata** — o caso limpo do repo. Português **e**
inglês funcionam.

🔴 **E uma armadilha que não existia em nenhum outro tribunal: o `advanced=true` é um
PORTÃO, não um filtro.** Leia a próxima seção antes de qualquer coisa.

## 🔴 O PORTÃO — o defeito central do TJPB

A API tem **dois conjuntos de filtros mutuamente exclusivos**. O que está fora do modo
ativo é **ignorado com HTTP 200 e contagem plausível**. Medido com `usucapião`
(12.208 sem filtro nenhum), em 08/08 e completado em 13/08/2026:

| parâmetro | modo simples | `advanced=true` |
|---|---|---|
| `grau=1` / `grau=2` | ✅ 8.998 / 3.210 — partição **exata** | 🔴 **IGNORADO** (12.208) |
| `instancia=` | 🔴 **IGNORADO** (12.208) | ✅ 8.998 / 3.169 / 41 — partição **exata** |
| janela de data | 🔴 **IGNORADA** (12.208) | ✅ 349 em 2026 |
| `codigoComarca` etc., `idRelator` | 🔴 **IGNORADOS** (12.208) | ✅ filtram |
| `numeroProcesso` | 🔴 **IGNORADO — devolve a base inteira** (2.515.754) | ✅ 1 documento |
| `consultarApenasEmenta` | — | ✅ 12.208 → 10.961 |

**O crawler resolve isto sozinho**: qualquer filtro avançado liga o modo avançado, e aí o
`--grau` vira recorte de **cliente**, com aviso. Só nunca chame a API na mão sem o portão.

⚠️ **O mapeamento de 08/08 declarou `instancia` como "IGNORADO"** — estava medido só no
modo simples. Ele funciona, e é ele que dá a partição Juizado × Justiça Comum que o doc
dizia não existir neste tribunal. **Fechar o `parcial` corrigiu o mapeamento**, como no
TJMT.

## Flags

```bash
./bin/jur tjpb -q "usucapião" -m 2
./bin/jur tjpb -q "dano moral" --instancia turmas          # Juizado / Turma Recursal
./bin/jur tjpb -q "usucapião" --instancia primeiro         # 1º grau (sentenças)
./bin/jur tjpb -q "usucapião" -di 01/01/2026 -df 13/08/2026
./bin/jur tjpb -q "usucapião" -t acordao --fetch-inteiro-teor
./bin/jur tjpb -n "0800610-47.2022.8.15.0461"              # consulta por número
./bin/jur tjpb -q "usucapião" -m 1 --verificar 3           # auditoria
./bin/jur tjpb --listar-filtros comarcas joao              # autocomplete de combo
```

| Flag | O que faz | Ressalva |
|---|---|---|
| `-q` | termo | **acento é obrigatório** (ver abaixo) |
| `--instancia` | `todas` (default) · `comum` (2º grau) · `turmas` (Juizado) · `primeiro` (1º grau) | filtro de servidor, partição exata |
| `--grau` | `todos` (default) · `1` · `2` | só no servidor **sem** filtro avançado |
| `-t` | `todos` · `acordao` · `sentenca` · `monocratica` | recorte de **cliente** — não há parâmetro |
| `-di/-df` | janela de **julgamento** (DD/MM/YYYY) | **mande as duas pontas** |
| `-dpi/-dpf` | alias de `-di/-df` | **não existe data de publicação** aqui |
| `--apenas-ementa` | procura só na ementa | 12.208 → 10.961 |
| `--comarca/--classe/--orgao/--vara/--competencia/--relator` | ids do autocomplete | querem **id**, nunca nome |
| `--listar-filtros <combo> <termo>` | autocomplete | exige termo — não lista o acervo |
| `--page-size` | máx. **50** | 51+ → HTTP 400 honesto |

## Ressalvas — leia antes de relatar resultado ao usuário

### 🔴 Acento é OBRIGATÓRIO e o índice NÃO normaliza

```
usucapiao  ->     64
usucapião  -> 12.208
```

Padrão TJMS/TJBA, oposto de TJAC/TJAM/TJAL/TJPE/TJPI/TJTO. **Número baixo aqui é quase
sempre acento faltando, não escassez de jurisprudência.** O crawler avisa quando a query
vem sem nenhum acento; repasse o aviso.

### 🔴 Só ACÓRDÃO de 2º grau COMUM tem ementa

Medido em 200 documentos (13/08/2026):

| tipo / instância | n | com ementa |
|---|---|---|
| `ACORDAO` / SEGUNDO_GRAU | 76 | **76 (100%)** |
| `ACORDAO` / TURMAS_RECURSAIS | 4 | **0** |
| `SENTENCA` / PRIMEIRO_GRAU | 108 | 0 — e **sem relator**, 108/108 |
| `DECISAO_MONOCRATICA` / SEGUNDO_GRAU | 12 | 0 |

⚠️ **Quem tem ementa não é o tipo de documento, é o par (tipo, instância)** — o acórdão da
Turma Recursal não tem. O mapeamento de 08/08 dizia "ACORDAO tem ementa" e isso vale só
para o 2º grau comum. O crawler marca `semEmenta`: **não apresente esse texto como
ementa** — é a decisão/sentença inteira.

### 🔴 A base só tem data de JULGAMENTO

`meioPublicacao` veio **null em 200/200** documentos. Não existe filtro nem campo de
publicação — espelho do TJRO. **Nunca apresente a data do TJPB como data de publicação.**
`-dpi/-dpf` existem só para não quebrar o contrato do repo e são tratados como julgamento,
com aviso.

⚠️ E `dataJulgamento` é um **timestamp com milissegundos** (`2026-08-13T11:49:51.181`) —
o instante de assinatura/indexação do documento, não uma data de sessão. Para o acórdão
de colegiado ele **não é a data da sessão de julgamento**; a certidão do próprio documento
não traz data. Registre isso ao citar.

### 🔴 Meia janela de data é IGNORADA em silêncio

Só a ponta inicial (ou só a final) devolve **12.208 = o acervo sem filtro**, com HTTP 200.
Padrão TJPI. **Mande sempre as duas pontas** — o crawler avisa.

✅ Em compensação, `DD/MM/YYYY` cru dá **HTTP 400 honesto** nomeando o campo — não é o
parse silencioso `MM/DD` do TJMT. E o **no-op** (1900..2100) devolve o total, que é o
comportamento correto: quem medir só o no-op lê "filtro ignorado" e erra. **O que decide é
o par: no-op = total E janela estreita = número pequeno.**

### ✅ Operadores — o conjunto coerente do repo

Contagens de 08/08/2026; a aritmética foi **reconfirmada em 13/08** com a base já
maior (`OU` = 125.763 = 12.208 + 120.881 − 7.326), continuando exata.

| Query | Total | Prova |
|---|---|---|
| `usucapião` | 12.206 | |
| `posse` | 120.847 | |
| `usucapião posse` (espaço) | 7.324 | espaço = **AND** |
| `usucapião E posse` / `AND` | 7.324 | ✅ português **e** inglês |
| `usucapião OU posse` / `OR` | 125.729 | ✅ 12.206 + 120.847 − 7.324, exato |
| `usucapião NÃO posse` / `NOT` | 4.882 | ✅ 12.206 − 7.324, exato |
| `(usucapião OU posse) E dano` | 28.125 | ✅ parênteses |
| `"usucapião extraordinário"` | 2.175 | ✅ frase exata |
| `usucapião XPTO posse` | **0** | ✅ token desconhecido **zera** — sintoma visível |

`PROX`/`ADJ`/`PROXIMO` **não são operadores** — viram termo literal e zeram. O crawler
avisa.

### 🔴 NÃO EXISTE PERMALINK

- `/public/documentos/{id}` exige `?grau=` (chave composta) e, com o grau certo, responde
  **HTTP 404 `DocumentNotFoundException: Documento vazio`** para o id que a busca devolveu.
- A **tela** está atrás do Cloudflare (ver abaixo) e nunca renderizou, então não há URL de
  documento confirmada em aba limpa.

**Nunca invente link de julgado do TJPB.** A verificação é por reconsulta:
`./bin/jur tjpb -n "<nº>"`. Quem identifica o julgado é o **`id` do documento** — um
processo tem vários (sentença, acórdão, monocrática).

### 🔴 A TELA está atrás do Cloudflare; a API não

Medido em 13/08/2026: `https://app.tjpb.jus.br/juris-pb/...` devolve **403 ao `curl`** —
o index **e todos** os assets (`browser-*.js`, `search.page-*.js`, PNG, woff) —, inclusive
como **primeira requisição de um contexto novo**. No Playwright o documento HTML carrega
(46 KB) e os sub-recursos continuam 403, então a SPA nunca renderiza.

⚠️ **Isto corrige a hipótese gravada em 08/08**, que atribuía o 403 a cota de rate limit
("403 em asset é cota até prova em contrário"). A prova veio e desmentiu: contexto novo,
primeira requisição, 403 igual. A cota pode existir; **o bloqueio de borda existe e basta
para explicar o sintoma**.

✅ Nada disso afeta o crawler: o mesmo host serve `/juris-pb-backend/public/*` **fora do
challenge**, respondendo ao `curl` cru. **Meça a API separado da tela** — a lição do TJBA.

### ⚠️ Os combos são AUTOCOMPLETE, não listas

Os 7 endpoints `/public/options/*` **exigem `term`** (sem ele, HTTP 400
`Required parameter 'term' is not present`) e não existe endpoint com a lista canônica —
mesma pendência do TJES/TJTO. O que volta é `[{id, nome}]`.

⚠️ **O mesmo NOME tem vários ids, e cada um filtra outra coisa**: `comarcas?term=joao`
devolve três "João Pessoa" (ids 200, 0 e 9010) que dão **1.689 / 3.169 / 41** em
`usucapião`. Pegar o primeiro é escolher errado. ✅ Parâmetro repetido é OR e soma exata
(200 + 0 = 4.858 = 1.689 + 3.169); ⚠️ mas **`instancia` repetida não é multi-valor** —
vale a primeira.

✅ Id inventado devolve **0** (honesto); ⚠️ `grau=9` **não** erra — faz fallback silencioso
para `grau=2`. E `instancia=XXINVALIDOXX` devolve HTTP 400 nomeando o enum Java: **o valor
inventado errar não prova que o parâmetro filtra** — foi assim que 08/08 concluiu errado.

### ✅ Base CORRENTE

Documento mais recente na busca sem termo: **do próprio dia** (13/08/2026), tanto em 08/08
quanto em 13/08. Distribuição por ano (base inteira, modo avançado): 2019 = 159.167 ·
2021 = 275.299 · 2023 = 349.576 · 2024 = 457.484 · 2025 = 382.696 · 2026 = 53.178 (até
08/08). Nada do congelamento do TJAM.

### ⚠️ Limites técnicos

- `size` **máx. 50** (51+ → HTTP 400 honesto). O Navigator barra antes de gastar request.
- **Offset máximo 10.000** (`max_result_window` do Elasticsearch): `page=500&size=10`
  responde, `page=1000&size=10` devolve **HTTP 404 `Falha ao consultar Elasticsearch`**.
  Acervo grande exige recorte por data — mesmo teto do TJRO, com erro menos honesto.
- ✅ Paginação **estável** (30 ids idênticos em duas execuções) e total **exato**, sem
  saturação.
- ⚠️ `totalPages` da API é `totalElements/size`, não um número absoluto de páginas.

## Consulta por número — e o DataJud

✅ `numeroProcesso` aceita **as duas formas** (com máscara e 20 dígitos), como no TJMT e
ao contrário de TJPE (só dígitos) e TJES (só máscara). Número inventado ou truncado → 0.
🔴 **Mas só com `advanced=true`** — sem o portão devolve a base inteira, inclusive para
número inventado.

✅ Como é filtro de campo e não busca livre, **não arrasta documento que apenas cita o
número** (o problema do TJES/TJPI). O Checker confere assim mesmo.

✅ **O DataJud do CNJ responde para o TJPB** (`api_publica_tjpb`, medido 13/08/2026 — a
pendência nº 8 do mapeamento): serve para confirmar que um **processo existe** quando ele
não tem documento indexado na jurisprudência. Não tem ementa nem inteiro teor.

## Escopo da base

**1º grau (sentenças) + 2º grau (acórdão e monocrática) + Turmas Recursais.** Sistema de
origem: PJe + Projudi. Para matéria federal com origem na PB → `trf5`; trabalhista →
`trt13`; constitucional → `stf`.

⚠️ Em `usucapião` a Turma Recursal é **0,3%** do acervo (41 de 12.208) — mas isso é do
tema, não da base. Em matéria de consumo ofereça `--instancia turmas` também.

## Testes

```bash
node src/TJPBTestes.js          # suíte de integração (roda contra a API real)
node tests/smoke.js tjpb        # smoke do repo
```

## Pendências declaradas

- 🔴 **A Fase 3b (skill `browser-post-search`) continua NÃO EXECUTADA** — a tela não
  renderiza (Cloudflare). Não há anatomia de card, escada de cliques pela tela nem
  permalink confirmado em aba limpa. O que existe é o contrato da API, que é outra coisa.
  ⚠️ **Hipótese aberta, a mesma do TJRN/TJSE:** o bloqueio pode ser da faixa de datacenter
  do agente, e o portal funcionar no navegador do usuário. 30 segundos fecham a dúvida.
- `codigoClasse`, `codigoOrgaoJulgador`, `codigoVara`, `codigoCompetencia` e `idRelator`
  foram provados por **contagem** (restringem, e a comarca fecha a soma em multi-valor),
  mas **não se conferiu quais documentos voltam** — a lição do TJRO (um filtro pode
  entregar o acervo oposto ao que promete) **não foi aplicada aqui**.
- `idRelator=22223` devolveu **0** em `usucapião`: não se distinguiu "relatora sem julgado
  nesse tema" de "o parâmetro quer outra coisa". **Não foi provado com um relator de
  acervo grande.**
- Não se mediu **rate limit** da API (as medições rodaram com pausa de ~1,2 s).
- Não se mediu se existe **teto de intervalo** de data (a família ESAJ tem; aqui janelas
  de 1 e de 200 anos responderam, mas não se procurou o limite).
- Os valores do enum `InstanciaAgrupada` além dos três vistos **não foram enumerados**.
- A **natureza exata de `dataJulgamento`** (sessão × assinatura × indexação) ficou
  indeterminada: o texto do acórdão não traz data e o DataJud, consultado num processo,
  ainda não tinha o movimento de julgamento.
