# TJPR — Tribunal de Justiça do Paraná

**Escopo:** PR · **Status:** OK
**Crawler:** `src/TJPRCrawler.js`

Query suporta operadores: `E`, `OU`, `!NAO`, `PROX`, `$`.

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>  Judgment start date (DD/MM/YYYY)
-df, --data-fim <date>     Judgment end date (DD/MM/YYYY)
-l,  --local <scope>       1=EMENTA | 2=INTEIRO TEOR (default) | 99=AMBAS
```

## Exemplos

```bash
./bin/jur tjpr -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/tjpr.json
```
