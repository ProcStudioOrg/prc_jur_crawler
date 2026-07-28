# TRF1 — Tribunal Regional Federal da 1ª Região

**Escopo:** DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO · **Status:** 🟡 instável
**Crawler:** `src/TRF1Crawler.js`

> A jurisprudência do TRF1 é servida pelo **portal do CJF**, não pelo domínio `trf1.jus.br`.
>
> ✅ **O host voltou.** A nota anterior (24/07/2026) dizia que `jurisprudencia.cjf.jus.br` não
> respondia; em **27/07/2026** ele responde em 0,18s e o crawler roda normalmente.

## 🚨 RESSALVA Nº 1 — a base **congelou em 31/07/2025**

**É o dado mais importante do TRF1.** O portal está no ar, o crawler funciona, a busca
retorna `success: true` — e devolve **0** para qualquer coisa depois de julho de 2025.

Medido em 27/07/2026, `-q "aposentadoria"`, mês a mês:

```
2025 inteiro   13.554        ago/2025     0
abr–jun/2025   10.572        set/2025     0
jul/2025        1.676        out–dez/2025 0
                             2026 inteiro 0
```

Não é escolha de filtro: **os dois tipos de data dão zero** (`-td DTDP` e `-td DTPP`). Não é
o crawler: o portal responde e a mesma busca em 2025 traz 13 mil documentos. A **alimentação
parou**.

Quem pedir jurisprudência recente da 1ª Região precisa ser avisado — senão lê o zero como
"não há jurisprudência sobre o tema", que é exatamente o erro que este repo existe para
evitar.

**Não há substituto.** A Jurisprudência Unificada do CJF lista o TRF1, mas tem o mesmo
congelamento *e* está com o filtro de data quebrado — ver [`CLAUDE-CJF.md`](CLAUDE-CJF.md).
Para **MG a partir de 2023** existe o [`trf6`](CLAUDE-TRF6.md); para as outras 13 UFs da 1ª
Região não há alternativa mapeada.

```bash
# a alimentação voltou? (se devolver > 0, atualize este doc e cobertura/build.js)
./bin/jur trf1 -q "aposentadoria" -di "01/01/2026" -df "31/12/2026" -m 1 --json
```

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
