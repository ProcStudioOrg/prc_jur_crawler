# TRF2 — Tribunal Regional Federal da 2ª Região

**Escopo:** RJ, ES · **Status:** OK
**Crawler:** `src/TRF2Crawler.js`

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>  Judgment start date (DD/MM/YYYY)
-df, --data-fim <date>     Judgment end date (DD/MM/YYYY)
-r,  --relator
-oj, --orgao               Orgao Colegiado (ex: "1a. TURMA ESPECIALIZADA")
-c,  --classe              Ex: "Apelacao Civel"
-cp, --competencia
-n,  --numero
-ord,--ordenacao           RELEV (default) | DESC | ASC
--trf                      Only TRF da 2a Regiao
--tru                      Only TRU e Turmas Recursais
--ementa                   Search only in ementa
```

## Exemplos

```bash
./bin/jur trf2 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf2.json
```
