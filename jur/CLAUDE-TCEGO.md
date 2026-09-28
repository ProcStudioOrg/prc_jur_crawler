# TCE-GO — Tribunal de Contas do Estado de Goiás

**Comando:** `./bin/jur tcego` · **Porta:** `api` (REST interna do SPA "Iago", sobre Elasticsearch)
**Status:** 🟢 crawler completo — mapeado em 19/08/2026 (slot 1600, `parcial`), fechado em 22/08/2026 (slot 2000)
**Mapeamento:** [`human-codegen/TCEGO/01-decisoes/`](human-codegen/TCEGO/01-decisoes/)

## Escopo

Na interface e nas ferramentas de chat/MCP, `relator` corresponde ao relator do
**processo**, com nome exato em caixa alta. Use `listar_relatores` para consultar os
valores de `--listar-filtros`. O relator da decisão é outro campo, acessível pela
flag `--relator-decisao` da CLI.

| | |
|---|---|
| Módulo | Consulta Ampla de Decisões (`https://decisoes.tce.go.gov.br/`) |
| API | `https://iago-search-api.tce.go.gov.br` — sem auth, sem cookie, sem captcha, sem WAF |
| Acervo | **383.166 documentos** (medido em 22/08/2026; eram 383.075 em 19/08 — a base cresce) |
| Anos | 1976–2026 (51 valores no agregado `ano`) |
| Tipos | Acórdão · Resolução · Resolução Administrativa · Resolução Normativa |
| Numeração | Processo `AAAANNNNNNNNNNN` (15 dígitos) · Decisão `NNNNN/AAAA`. **Não é CNJ** |

## Passo 0 — o que existe e o que NÃO existe

- ⚠️ `dadosabertos.tce.go.gov.br` **existe** (CKAN 2.9.10) mas tem **zero** dataset de jurisprudência.
- 🔴 `/swagger`, `/api-docs`, `/openapi.json` → 401; `/v3/api-docs` → 500. Sem contrato publicado.
- 🔴 `antigo-decisoes.tce.go.gov.br` — **sem DNS**. O próprio SPA linka esse host morto.
- 🔴 **DataJud/CNJ não se aplica** — contas não é Judiciário. Como no resto do Bloco 5,
  **não há plano B** se o portal cair.

## Flags

```
-q, --query <texto>        Termo. Sem operador booleano, sem curinga
-n, --numero <n>           Processo (15 díg.) ou decisão ("04119/2024") — dispensa -q
    --ano <ano>            year
    --tipo <rótulo>        "Acórdão" | "Resolução" | "Resolução Administrativa" | "Resolução Normativa"
    --colegiado <nome>     "Primeira Camara" | "Segunda Camara" | "Tribunal Pleno"
    --sessao <tipo>        "Ordinaria" | "Extraordinária" | "Extraordinária Administrativa"
-r, --relator <nome>       Relator(a) do PROCESSO, em CAIXA ALTA
    --relator-decisao <n>  Relator(a) da DECISÃO — pode divergir do relator do processo
    --interessado <texto>  Texto livre
    --processo <15 díg.>   Casamento exato
    --decisao <n>          Nº da decisão — combine com --ano
-di/-df <DD/MM/YYYY>       Data de julgamento — 🔴 só funciona com as DUAS pontas
    --ordem <o>            RELEVANCE | RECENT | OLD (🔴 inválido → HTTP 500)
    --size <n>             Máx. 2000 (acima trunca em silêncio)
    --listar-filtros       Valores aceitos, via /decisions/aggregations
    --fetch-inteiro-teor   Baixa o inteiro teor em TEXTO (não há PDF)
    --verificar [n]        Audita N por reconsulta + inteiro teor
```

```bash
./bin/jur tcego -q "aposentadoria" --ano 2024 -m 2 --json
./bin/jur tcego -n 201700010015938
./bin/jur tcego --interessado "PREFEITURA" --ano 2005 --fetch-inteiro-teor
```

---

# 🔴 Ressalvas — leia antes de citar qualquer coisa daqui

## 1. `summary` é EMENTA GERADA POR IA. Não é ato do tribunal.

O rótulo do próprio portal é `ia_ementa: "Ementa Artificial"`, e o texto de boas-vindas diz
*"O Iago agora resume cada decisão em uma ementa artificial"*. É o campo que a tela mostra em
destaque, em CAIXA ALTA, com cara de ementa oficial. **Publicá-lo como ementa do TCE-GO é citar
resumo de máquina como ato do tribunal** — quebra a invariante nº 1 do repo.

O crawler mapeia `ementa` → `ementa` (a de verdade, 268–593 chars) e `summary` →
`ementaArtificialIA`, acompanhado de `ementaArtificialAviso`. **O nome do campo é o aviso.**

## 2. O SERVIDOR ESCOLHE O MODELO DE BUSCA SOZINHO — e o semântico não garante o termo

Cada resultado traz `model`, e ele muda conforme o termo (medido em 22/08/2026, base `year=2024` = 4.987):

| termo | total | model |
|---|---|---|
| `aposentadoria` | 3.112 | **BM25** (lexical) |
| `aposentadoria integral` | 1.709 | BM25 |
| `contrato administrativo rescisao` | 47 | BM25 |
| `aposentadoria pregao` | 1.623 | **EMBEDDINGS** (semântico) |
| `licitacao deserta fracassada` | 3 | EMBEDDINGS |
| `"pregao eletronico"` | 45 | **OPERATOR_QUERY** (frase) |

🔴 **Quando o modelo é EMBEDDINGS, o resultado não precisa conter o termo buscado.** O top-1 de
`aposentadoria pregao` é um acórdão de Representação sobre pregão eletrônico **sem uma linha
sobre aposentadoria** — e o score do top-1 cai de 179,9 (BM25) para 8,1. Recall semântico não é
recall lexical. O crawler expõe `model` em cada resultado e avisa quando a busca cai no semântico.

## 3. NENHUM OPERADOR BOOLEANO FUNCIONA — e as medições se contradizem entre si

| termo | total |
|---|---|
| `aposentadoria` | 3.112 |
| `aposentadoria AND aposentadoria` | **1.926** ← o AND consigo mesmo perde 1.186 |
| `aposentadoria OR aposentadoria` | 1.926 ← idêntico ao AND |
| `aposentadoria AND pregao` | 0 |
| `aposentadoria OU pregao` | 1.918 |
| `aposentadoria OR pregao` | 44 |
| `aposentadoria NAO pregao` | 0 |
| `aposentadoria NÃO pregao` | **1.749** ← só o acento muda o resultado |
| `AND` sozinho / `OR` sozinho | 0 / 2 ← são **tokens de busca**, não operadores |
| `"aposentadoria"` | **0** ← a mesma palavra entre aspas ZERA |
| `"aposentadoria" OR "aposentadoria"` | 1.926 ← duplicada, volta a 1.926 |
| `"pregao eletronico" AND "tomada de precos"` | 0 |
| `"pregao eletronico" E "tomada de precos"` | 48 (= o OR, não a interseção) |
| `"pregao eletronico" NAO "tomada de precos"` | 48 (não exclui nada) |

A contradição é a prova: **não há álgebra de conjunto por trás**. O crawler não expõe flag de
operador — flag que não filtra mente para o usuário — e avisa quando vê um deles no termo.
É a **sexta vez seguida no Bloco 5** que a promessa de operador não se sustenta na medição.

## 4. Uma palavra a mais pode APAGAR a busca

`aposentadoria zzqqxx` = **1.788** (e o score do top-1 cai de 179,9 para 5,4);
`aposentadoria zzqqxx yywwvv` = **0**. Token inexistente não é ignorado nem zera de imediato:
ele reescreve a busca inteira.

⚠️ **Curinga não existe, e o erro não zera:** `aposent*` = 0, mas `aposentadori?` = **3.085**
contra 3.112. Quem ler "o curinga funcionou" perdeu resultados sem saber.

## 5. O `totalElements` é FABRICADO

| requisição | `totalElements` | itens |
|---|---|---|
| `page=0&size=25` | 10.000 | 25 |
| `page=400&size=25` | 10.025 | 25 |
| `page=50&size=2000` | 102.000 | 2.000 |
| `page=191&size=2000` | **383.075** ← o número verdadeiro | 1.075 |
| `page=200&size=2000` | 10.000 de novo | **0** |

`totalElements ≈ max(10.000, min(acervo, (page+1) × size))` — é o `track_total_hits: 10000`
do Elasticsearch vazando como se fosse total.

- `< 10.000` → **exato** (confere com o agregado: `year=2024` = 4.987 nos dois)
- `= 10.000` → **saturado**: "≥ 10.000, quantidade desconhecida"
- `> 10.000` → **artefato do offset**, não é contagem de nada

✅ **A saída:** `/decisions/aggregations` devolve contagem **exata** acima do teto. O crawler
consulta o agregado sempre que o total satura, e a nota de `totalNota` diz de onde veio o número.

## 6. `session`/`type`/`collegiate` são keyword EXATA, com acento

`session=Extraordinária` → 29; `session=Extraordinaria` → **0 com HTTP 200**. Use sempre o
rótulo literal de `--listar-filtros`.

⚠️ **E o ESCOPO importa.** O mapeamento de 19/08 registrou "`session=Extraordinária` → 29" sob a
base `year=2024` — **errado**: os 29 são do **acervo inteiro**, e em 2024 esse valor tem **zero**.
A partição de 2024 é `Ordinaria` 4.935 + `Extraordinária Administrativa` 52 = 4.987. Uma medição
correta pode sustentar uma conclusão errada quando o escopo se perde (lição TCE-MG, de novo).

## 7. 83% do acervo não tem colegiado nem tipo de sessão

Agregados: `ano` = `tipo_documento` = **383.166**, mas `colegiado` = `tipo_sessao` = **64.888**.
Filtrar por colegiado **exclui 318.278 documentos em silêncio** — não é "não há julgado", é campo
vazio. O crawler avisa sempre que essas flags são usadas.

## 8. A janela de data só funciona FECHADA

`start=2024-01-01&end=2024-01-31` → 287. `start=2024-01-01` **sozinho** → acervo saturado.
`end=2024-01-31` **sozinho** → acervo saturado. **As duas pontas são ignoradas isoladas.**
E o filtro exige ISO `YYYY-MM-DD` (`01/01/2024` → HTTP 500), enquanto o campo `date` do resultado
volta em BR (`28/10/2024 08:00`).

## 9. Não há PDF, e não é bloqueio — é link pendurado

`GET /decisions/url/<id>?type=DOCUMENT` devolve uma URL
`…/ConsultaDecisoes/CarregaDocumentoAssinadoPDF?…` que responde HTTP 200 `text/html` com o app
shell do Next (0 caractere de texto em aba limpa). O host que serviria esse caminho
(`antigo-decisoes`) não tem DNS. E `/decisions/download` responde HTTP 500.

✅ **A saída é melhor:** `GET /decisions/<id>` devolve `{id, text}` com o **inteiro teor em texto
puro**, livre, medido nos quatro tipos (2.272 a 39.055 chars). É o que `--fetch-inteiro-teor` usa.

## 10. Não há permalink de DOCUMENTO

O SPA nunca põe o documento na URL. O que existe é o permalink do **processo**:
`https://www.tce.go.gov.br/ConsultaProcesso?proc=<idInterno>` — 200 em aba limpa. ⚠️ O `proc=` é
um **terceiro identificador**, distinto do `id` do documento e do `process` do card, e só se
obtém por `GET /decisions/url/<id>?type=WEBSITE`.

**Quem identifica o julgado é `id`.** `process` agrupa vários documentos e `number` se repete a
cada ano: `number=04119` sozinho devolve 48 decisões de anos diferentes; com `year=2024`, 1.

## 11. Municípios goianos — a ressalva da fila está CONFIRMADA para a era moderna

`interested=PREFEITURA` devolve 4.227 documentos, mas a distribuição por ano desaba:

```
1998=599  2004=150  2007=102  |  2008=21  2013=2  2019=4  2020=6  2024=83  2026=4
```

O TCE-GO guarda um acervo municipal **histórico** (concentrado até ~2007) e praticamente não
julga contas municipais hoje. **Buscar município goiano recente aqui devolve quase-zero que não
significa ausência de julgado** — significa competência de outra Corte. O formulário não tem
combo de município; a prova saiu do agregado, sem sair do domínio oficial.

## 12. O que NÃO é problema

- ✅ **Sem rate limit medido:** 30 requisições sequenciais em 6 s e 20 em paralelo, todas 200.
- ✅ **Paginação estável:** a mesma página rodada 3× devolve a mesma sequência de ids;
  `page=0 ∩ page=1` = 0 documentos.
- ✅ **Sem teto de profundidade:** `page=191&size=2000` chega ao fim do acervo sem erro.
- ✅ **Os quatro tipos têm o mesmo esquema de 22 campos**, todos preenchidos — não há o buraco
  por tipo do TJMG. ⚠️ Mas `session` **não é campo do card**, embora seja filtro: a sessão só
  aparece dentro do `title`.
- ✅ **Todo filtro rejeita valor inventado com 0**, e a partição de colegiado fecha exata
  (2.601 + 1.910 + 476 = 4.987 em 2024).

## Testes

```bash
node src/TCEGOTestes.js      # 37 checagens, todas ao vivo contra a API
node tests/smoke.js tcego
```
