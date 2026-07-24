# TRF1 — Tribunal Regional Federal da 1ª Região

**Escopo:** DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO · **Status:** OK
**Crawler:** `src/TRF1Crawler.js`

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>  Start date (DD/MM/YYYY)
-df, --data-fim <date>     End date (DD/MM/YYYY)
-td, --tipo-data <type>    DTDP (Julgamento) | DTPP (Publicacao), default DTDP
-r,  --relator <name>      Relator name
-oj, --orgao-julgador      Judging body (ex: "PRIMEIRA TURMA")
-c,  --classe              Case class
-n,  --numero              Case number
-t,  --tipos               ACORDAO,SUMULA,ARGUICAO,DECISAOMONO (default: ACORDAO)
-f,  --fontes              TRF1,JEF1 (default: TRF1)
```

## Exemplos

```bash
./bin/jur trf1 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf1.json
```
