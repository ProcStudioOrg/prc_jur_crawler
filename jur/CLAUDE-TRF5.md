# TRF5 — Tribunal Regional Federal da 5ª Região

**Escopo:** AL, CE, PB, PE, RN, SE · **Status:** OK
**Crawler:** `src/TRF5Crawler.js`

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
