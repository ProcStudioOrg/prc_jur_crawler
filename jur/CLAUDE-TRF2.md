# TRF2 — Tribunal Regional Federal da 2ª Região

**Escopo:** RJ, ES · **Status:** 🟠 **QUEBRADO — o site mudou**
**Crawler:** `src/TRF2Crawler.js` (aponta para host que não existe mais)

> ## ⚠️ O sistema mudou (verificado em 24/07/2026)
>
> `juris.trf2.jus.br` responde **NXDOMAIN** — o host foi desativado. O TRF2 migrou a
> jurisprudência para o **módulo do e-Proc**:
>
> ```
> https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
> ```
>
> (`https://jurisprudencia.trf2.jus.br/` redireciona para lá.)
>
> Isso é a **mesma família do TRF4** (`eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php`),
> então o conserto é portar `src/TRF4Crawler.js`, não escrever do zero.
> Antes de codificar, remapeie em `human-codegen/TRF2/` seguindo `CLAUDE-CODEGEN.md`.
>
> As flags abaixo são as do sistema **antigo** e provavelmente não valem mais.

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
