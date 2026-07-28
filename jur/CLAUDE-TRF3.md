# TRF3 — Tribunal Regional Federal da 3ª Região

**Escopo:** SP, MS · **Status:** ⚠️ Restrição de navegador — instável
**Crawler:** `src/TRF3Crawler.js` · **Fallback:** `src/trf3_drission.py` (Python/DrissionPage)

> ⚠️ **Verificado em 27/07/2026: o host está INACESSÍVEL, e não é mais a verificação de
> navegador.** `web.trf3.jus.br` resolve pela Akamai (`a1855.dscb.akamai.net` → 189.86.122.19),
> mas nada responde: Playwright dá `net::ERR_HTTP2_PROTOCOL_ERROR` já no `goto` (inclusive com
> `--headed`), e `curl` falha em HTTP/2 **e** em `--http1.1`; `www.trf3.jus.br` também. Como a
> falha é anterior a qualquer interação, o fallback Python não ajuda. Reteste o host antes de
> mexer em seletor. Para matéria previdenciária de SP/MS nesse período, ofereça TRF4/TRF5 como
> comparativo **dizendo que é outra região**.
>
> O site aplica verificação de navegador que falha intermitentemente em modo headless.
> Prefira `-v` / `--headed`; em caso de falhas recorrentes, use o fallback Python.
> Para matéria previdenciária federal com origem em SP, considere também **TRF4/TRF5**
> como comparativo até o TRF3 ser resolvido.

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di,  --data-inicio <date>   Start date (DD/MM/YYYY)
-df,  --data-fim <date>      End date (DD/MM/YYYY)
-td,  --tipo-data            Publicação (default) | Julgamento
-r,   --relator
-oj,  --orgao                Ex: "9ª Turma"
-c,   --classe               Ex: "ApCiv - APELAÇÃO CÍVEL"
-n,   --numero
-e,   --ementa <text>        Text to search in ementa
-b,   --base                 0=TRF3 (default) | 1=Turmas Recursais | 2=Monocráticas
-rpp, --results-per-page     10 (default) | 30 | 50
```

## Exemplos

```bash
./bin/jur trf3 -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" --headed --json -o /tmp/trf3.json
```

## Erros comuns

- **Detecção de navegador** — use `-v` e/ou retente; em último caso rode `src/trf3_drission.py`.
