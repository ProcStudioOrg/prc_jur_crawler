# TCU — Tribunal de Contas da União

**Escopo:** Federal (acórdãos)
**Status:** OK
**Crawler:** `src/TCUCrawler.js`

Query suporta operadores: `E`, `OU`, `ADJ`, `NAO`, `PROX`, `MESMO`, `$`.

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>  Session start date (DD/MM/YYYY)
-df, --data-fim <date>     Session end date (DD/MM/YYYY)
```

## Exemplos

```bash
./bin/jur tcu -q "aposentadoria E RPPS" -di "01/01/2025" -df "31/12/2025"
```
