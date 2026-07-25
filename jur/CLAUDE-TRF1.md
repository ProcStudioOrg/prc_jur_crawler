# TRF1 — Tribunal Regional Federal da 1ª Região

**Escopo:** DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO · **Status:** 🟡 instável
**Crawler:** `src/TRF1Crawler.js`

> ⚠️ **Verificado em 24/07/2026:** `jurisprudencia.cjf.jus.br` resolve o DNS mas não responde
> (timeout também via `curl`, e `www.cjf.jus.br` igualmente fora) — a indisponibilidade é do
> CJF, não do crawler. Provavelmente temporária. Reteste com `node tests/smoke.js trf1`
> antes de investigar código.
>
> A jurisprudência do TRF1 é servida pelo **portal do CJF**, não pelo domínio `trf1.jus.br`.

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
