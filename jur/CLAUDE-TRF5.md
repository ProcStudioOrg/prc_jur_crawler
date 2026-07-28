# TRF5 — Tribunal Regional Federal da 5ª Região

**Escopo:** AL, CE, PB, PE, RN, SE · **Status:** 🟢 OK
**Crawler:** `src/TRF5Crawler.js`

## 🚨 RESSALVA Nº 1 — **preposição na query zera a busca, em silêncio**

O espaço funciona como **E**, e as palavras vazias (`de`, `da`, `do`, `por`, `em`) **não estão
indexadas** — basta uma delas para o E nunca fechar. O resultado é `0` com HTTP 200 e sem
aviso nenhum.

Medido em 27/07/2026, recorte 27/06–27/07/2026:

| Query | Documentos | | Query | Documentos |
|---|---|---|---|---|
| `pensão` | 70 | | `pensão morte` | **50** |
| `morte` | 110 | | `pensão por morte` | **0** |
| `regra transição` | **95** | | `regra de transição` | **0** |
| `devolução valores` | **59** | | `devolução de valores` | **0** |
| `certidão tempo contribuição` | **18** | | `certidão de tempo de contribuição` | **0** |

**Regra: monte a query do TRF5 só com as palavras cheias.** Termo hifenizado não sofre disso
(`auxílio-doença` = 55, `auxílio-acidente` = 21) — o hífen não é palavra vazia.

Um zero aqui se lê como "não há jurisprudência sobre o tema" e **não é** — é a query que não
fecha. Antes de relatar ausência de julgados no TRF5, refaça a busca sem as preposições.

## Volume

Acervo bem menor que o dos vizinhos: **405** documentos em 30 dias com `-q "previdenciário"`,
contra 9.198 do TRF4 e 3.295 do TRF6 no mesmo recorte. Recorte curto rende pouco — para
panorama, abra o período.

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>  Start date (DD/MM/YYYY)
-df, --data-fim <date>     End date (DD/MM/YYYY)
-r,  --relator
-oj, --orgao               Ex: "1ª TURMA", "PLENO"
-n,  --numero
-t,  --tipo                segundoGrau (default) | turmaRecursal | tru
-e,  --estados             For turmaRecursal: AL,CE,PB,PE,RN,SE
```

## Exemplos

```bash
./bin/jur trf5 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf5.json
```
