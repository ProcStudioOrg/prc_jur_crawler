# TRF4 — Tribunal Regional Federal da 4ª Região

**Escopo:** RS, SC, PR · **Status:** OK
**Crawler:** `src/TRF4Crawler.js`

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>       Decision start date (DD/MM/YYYY)
-df, --data-fim <date>          Decision end date (DD/MM/YYYY)
-dpi, --data-pub-inicio <date>  Publication start date (DD/MM/YYYY)
-dpf, --data-pub-fim <date>     Publication end date (DD/MM/YYYY)
--origem <tipo>                 trf4 (default) | turmas-recursais
--fetch-inteiro-teor            Download full text of each result
--output-dir <dir>              Directory for downloaded files (default: ./resultados)
--max-results <number>          Max total results to collect
```

## Exemplos

```bash
./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"

# Download do inteiro teor
./bin/jur trf4 -q "aposentadoria especial enfermeiro" --fetch-inteiro-teor --output-dir ./resultados
```

## Notas

- **Turmas Recursais:** sempre baixar o inteiro teor (`--fetch-inteiro-teor`) — as ementas
  costumam ser curtas e o conteúdo relevante está no documento completo.
