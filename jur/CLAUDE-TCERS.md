# TCE-RS — Tribunal de Contas do Estado do Rio Grande do Sul

**Comando:** `./bin/jur tcers` · **Status:** 🟢 OK (API REST pública, HTTP direto, sem
browser, **sem captcha**) · **Mapeado em** 15/08/2026.

**Escopo: controle externo, não Judiciário.** Contas, licitação, contrato
administrativo, ato de pessoal e recursos do **Estado do RS e dos municípios gaúchos**.
Para a mesma matéria já judicializada o caminho é `tjrs` (estadual) ou `trf4` (federal).

🔴 **Não ofereça o `tcers` para matéria cível, penal, trabalhista ou previdenciária** —
ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.

✅ **O Rio Grande do Sul não tem TCM**: conta de prefeitura, câmara e autarquia municipal
está aqui. Provado por contagem no próprio acervo (`"EXECUTIVO MUNICIPAL"` e
`"LEGISLATIVO MUNICIPAL"` saturam o teto de 10.000; `prefeitura` = 7.376).
A armadilha "procure o TCM" vale para SP, RJ, BA, GO e PA — não para o RS.
⚠️ Diferente do TCE-PR, aqui **não há combo de município** para contar: o campo "Órgão
fiscalizado" é texto livre. A prova é por contagem, não por enumeração.

## Uso

```bash
./bin/jur tcers -q "nepotismo"
./bin/jur tcers -q "licitação AND dispensa" -di "01/01/2019" -df "31/12/2019"
./bin/jur tcers -q "merenda escolar" --ano 2019 --fetch-inteiro-teor
./bin/jur tcers -n "013714-0200/25-3"        # consulta por número
./bin/jur tcers --listar-filtros              # 42 tipos, 31 relatores, 7 órgãos
```

| Flag | O que faz |
|---|---|
| `-q` | Termo livre. ⚠️ **o espaço é OR** |
| `-n` | Consulta por número (aceita com ou sem máscara — normaliza) |
| `--base` | `decisoes` (default) · `sumulas` · `pareceres` · `informacoes` |
| `-di/-df` | Janela da **data da sessão** (DD/MM/YYYY ou YYYY-MM-DD) |
| `-dpi/-dpf` | Alias de `-di/-df` — **não existe data de publicação aqui** |
| `--ano` | Filtra pelo ano da sessão |
| `-oj` | Órgão julgador exato |
| `-r` | Relator (Conselheiro) |
| `-t` | Tipo de processo |
| `--orgao` | Órgão **fiscalizado** |
| `--fetch-inteiro-teor` | Baixa o PDF da peça (o **texto** já vem na busca) |
| `--verificar N` | Audita N resultados por reconsulta |

## Ressalvas medidas — leia antes de citar

### 🔴 O espaço entre termos é OR, e os operadores que a tela anuncia estão quebrados

A config do próprio portal declara `operadoresTermos: E OU NÃO ~ PROX MESMO $` e a tela
imprime `Ex.: processo E gestão NÃO "Primeira Câmara"`. **Todos os itens estão errados.**

| Query | Total | Leitura |
|---|---|---|
| `merenda` | 730 | |
| `escolar` | 5.007 | |
| `merenda escolar` | 5.036 | **espaço = OR (união)** |
| `merenda AND escolar` | 701 | interseção — 730 + 5.007 − 5.036 = **701** ✓ |
| `merenda OR escolar` | 5.036 | = espaço |
| `merenda NOT escolar` | 29 | 730 − 701 = **29** ✓ |
| `"merenda escolar"` | 673 | ≤ 701 ✓ coerente |
| `merenda E escolar` | **10.000+** | 🔴 **INFLA até o teto** |
| `merenda OU escolar` | **10.000+** | 🔴 INFLA |
| `merenda NÃO escolar` | **10.000+** | 🔴 INFLA |
| `merenda NAO escolar` | **10.000+** | 🔴 INFLA |
| `merenda MESMO escolar` | **10.000+** | 🔴 INFLA |
| `merenda PROX escolar` | 5.037 | 🔴 ignorado (= união) |
| `meren$` | 0 | 🔴 curinga **zera** |

**Use os ingleses: `AND`, `OR`, `NOT`, `"frase exata"`.** O crawler avisa quando a query
traz um operador quebrado — repasse o aviso.

⚠️ **O erro não zera, infla até o teto** — `10.000+` se lê como "tema vastíssimo" e não
como operador quebrado. É o pior sintoma possível.
✅ **Não avise sobre acento** (o índice normaliza) e **termo curto não é descartado**
(`ab` = 138 exato) — a armadilha do TCE-SC não se repete aqui.

### 🔴 O total satura em 10.000 — mas o servidor declara isso

`total.relacao` vem `EQUAL_TO` (exato) ou `GREATER_THAN_OR_EQUAL_TO` (saturado). É o
primeiro tribunal do repo em que a saturação é **declarada** em vez de inferida. O
crawler propaga em `totalSaturado`. **Nunca relate 10.000 como contagem** — refine com
`-di/-df` ou `--ano`.

### 🔴 A ementa desaparece a partir de 2020

Medido com `licitação`, por ano da sessão:

| 2018 | 2019 | 2020 | 2022 | 2024 | 2026 |
|---|---|---|---|---|---|
| 99/100 | 20/20 | **0/20** | **0/20** | 0/2 | 0/1 |

O acervo antigo tem ementa (média 615 chars); **o recente não tem nenhuma**. Um pedido
de jurisprudência recente do TCE-RS volta sem ementa, e isso **não é defeito do crawler**.
O crawler marca `semEmenta`. ✅ O que existe no lugar é o texto integral — veja abaixo.

### ✅ O inteiro teor já vem na busca

O campo `relatorio` traz o **Relatório e Voto integral** (presente em 40/40, média 12.733
chars). **Conferido contra o PDF** por `pdftotext`: 12.937 no payload contra 12.204 no
PDF, razão 0,94 — é o texto mesmo, não um trecho. Diferente do TCE-SC (snippet de match)
e do TCE-PR (texto remontado fora de ordem). `--fetch-inteiro-teor` só grava o PDF.

### 🔴 O campo `texto` degenera para um rótulo de uma palavra em 11%

`texto` é o **dispositivo** da decisão (média 1.139 chars), mas em 11 de 100 documentos
vem como `"Multa"`, `"Provimento"`, `"Conhece"`. **Nunca o apresente como ementa.** O
crawler marca `dispositivoDegenerado`.

### 🔴 Não existe data de publicação

`publicacao_dt_publicacao`, `sessao_dt_publicacao` e `publicacao_nr_boletim` vieram
**null em 100% da amostra**. O único eixo real é `dt_sessao` (data da **sessão**).
`-dpi/-dpf` são alias que avisam. **Nunca apresente a data do TCE-RS como publicação.**

✅ **As duas pontas da janela funcionam sozinhas** (só início = 3, só fim = 105, janela
= 2) — diferente do TCE-PR, onde a inicial *zerava* e a final era *ignorada*.
✅ **E a janela no-op não muda a contagem**: 1900→2100 devolve exatamente o total sem
filtro — passa no teste que o TJES reprovou.
⚠️ A API só aceita ISO; o crawler converte DD/MM/YYYY sozinho. **Nunca chame a API na mão
com data brasileira** — devolve HTTP 500.

### 🔴 Número de processo: só dígitos, e a máscara derruba com HTTP 500

`137140200253` devolve exatamente 1 documento. As duas formas com máscara
(`013714-0200/25-3` e `13714-0200/25-3`) **estouram HTTP 500** — a barra quebra o parser
do Elasticsearch. **Não é zero, é erro.** O `-n` normaliza sozinho e aceita as duas.

Some à coleção do repo: TJPE só dígitos · TJES só máscara · TJPI derruba com 500 ·
TJMT aceita as duas · TCE-PR partido em dois campos · **TCE-RS só dígitos**.

🔴 **Não há CNJ nem DataJud** (contas não é Judiciário). O processo é
`NNNNNN-NNNN/AA-N`. A verificação é por reconsulta: `./bin/jur tcers -n "<nº>"`.
🔴 **Quem identifica o julgado é o `id`**, não o número do processo.

### 🟢 Os autos inteiros são públicos — nenhum outro tribunal do repo tem isso

`GET /api/visdoc/anonimo/indice/PRE/<idProcesso>` devolve o índice das peças (47 no
exemplo medido: Capa, Distribuição, Relatório de Auditoria, Parecer do MPC, Relatório e
Voto, Decisão…). ⚠️ **19 das 47 vêm com `publico: false`** (documentação comprobatória,
procurações) — o crawler respeita a flag.

⚠️ **Chave composta, e a ordem dos segmentos engana.** O `#id_arquivo=` do link do card é
**fragmento** (client-side); para baixar é preciso o `idObjetoArquivo` do índice. E o id
da peça vem **depois** do id do processo:
`/api/visdoc/anonimo/conteudo/paginavel/PRE/<idProcesso>/<idObjetoArquivo>/inline`.
A ordem invertida devolve 404.
✅ O PDF é público em contexto limpo e **começa com `%PDF`** (o magic number vale aqui,
ao contrário do TCE-PR, que servia envelope PKCS#7 em DER).

### ⚠️ Operacional

- **O Elasticsearch do tribunal estoura o circuit breaker sob carga**: páginas de 100
  documentos em sequência devolvem HTTP 500 `circuit_breaking_exception: Data too large`
  (cada `relatorio` tem ~12 mil chars). É **transitório** — o Navigator retenta 5xx. É o
  argumento para o default `--page-size 20`.
- **Teto de página** entre 500 (aceito) e 1.000 (recusado), não bisectado.
- **Offset máximo de 10.000** — varredura funda exige recorte por data.
- ✅ Paginação **estável** (mesma página 3× = ids idênticos; pg1 ∩ pg2 = 0).
- ✅ Base **corrente**: sessão mais recente **27/07/2026**.

### ⚠️ Quatro bases — escolher a errada devolve zero que não é ausência de julgado

| `--base` | Documentos |
|---|---|
| `decisoes` (default) | 10.000+ (saturado) |
| `sumulas` | 27 |
| `pareceres` (Auditoria/Consultoria) | 1.195 |
| `informacoes` (Consultoria Técnica) | 303 |

### Passo 0 — o que existe e o que não existe

✅ **Dados Abertos oficial em CKAN** com API funcional
(`dados.tce.rs.gov.br/api/3/action/package_search`), datasets `decisoes-2022`…`2026` em
CSV/XML/JSON, atualizado 09/08/2026. São **metadados em lote** (sessão, órgão, processo,
magistrado), sem ementa nem inteiro teor — **não substituem o crawler**, mas servem de
plano B ao `Checker`. 🔴 **Isso contraria a lição do TCE-PR** de que "no Bloco 5 não
existe plano B": aqui existe, e é oficial. (Medido, **não implementado**.)

🔴 `dadosabertos`/`api`/`jurisprudencia`.tce.rs.gov.br são **NXDOMAIN**; `/swagger` e
`/v1/api-docs` dão **404 real**. ✅ **Sem vhost curinga e sem casca de 200**
(`/app/path-inventado-9z` → 404). ⚠️ `ws.tce.rs.gov.br` existe e responde 403 — não
investigado.

### ⚠️ Dois domínios oficiais, e o apex engana

- `tcers.tc.br` — **institucional**, atrás de Cloudflare (`cf-mitigated: challenge`).
  O Playwright resolve sozinho (diferente do STJ). Foi de lá que saiu o link do portal.
- `*.tce.rs.gov.br` — **os sistemas**. Apache, sem Cloudflare, sem captcha.

🔴 **O apex `tce.rs.gov.br` devolve HTTP 000 e não está fora do ar** — terceira variante
catalogada no repo. TCP abre, o **TLS completa**, e o certificado é `CN = *.tce.rs.gov.br`
— curinga que cobre `www.` e `portal.` mas **não o apex** (curinga casa um rótulo só).

| Tribunal | Causa do HTTP 000 |
|---|---|
| TJBA | o servidor derruba o handshake TLS (errno 104) |
| TJPE | o servidor omite o certificado intermediário |
| **TCE-RS** | **certificado válido que não cobre o host pedido** |

**Leia a mensagem de erro do TLS — é ela que separa os três casos.**
⚠️ E `www.tce.rs.gov.br` responde 200 com 80 bytes: um meta-refresh de **2010** para a
intranet. Quem parar aí conclui que o portal é uma intranet morta.

## Pendências declaradas

- `-r`, `-t` e `--orgao` estão expostos mas **não provados por contagem** (só `-oj` foi:
  26 de 106, e valor inventado devolve 0).
- A base `*` ("Todas as bases") declarada na config **não foi testada**.
- `sumulas`/`pareceres`/`informacoes` tiveram só a **contagem** medida — campos e card
  não dissecados; `--base` as aceita sem mapeamento próprio.
- **Não há permalink de busca**, e o de documento (o visualizador) **não foi confirmado
  em aba limpa de navegador** — só a API por trás dele.
- **Falta o print do visualizador aberto** (o Playwright estoura o `networkidle`: o
  viewer de PDF nunca estabiliza a rede).
- Teto de página não bisectado entre 500 e 1.000; **rate limit não medido**; ordenação
  testada só no default (`dt_sessao desc`).
- Card dissecado em **um tipo de documento só**, contra os 2+ que a skill
  `browser-post-search` exige.
- A lista `decisoes-temas-area-de-exame` volta **vazia** no servidor — causa não
  investigada.

Mapeamento completo em [`human-codegen/TCERS/01-jurisprudencia/`](human-codegen/TCERS/01-jurisprudencia/).
