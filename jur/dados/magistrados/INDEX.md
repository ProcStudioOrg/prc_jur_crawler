# Magistrados mapeados por tribunal

Gerado por `node tests/magistrados.js` (ver `docs/magistrados.md`). Um JSON por tribunal nesta pasta;
só nome e cargo públicos, sem texto de julgado. Grau inferido pelo órgão julgador e pelo cargo:
`1` = vara, juizado ou turma recursal; `2` = câmara, turma, seção ou órgão especial; `desconhecido` = sem pista.

| Tribunal | Magistrados | 1º grau | 2º grau | desc. | Teste da busca por magistrado | Coletado em |
|---|---|---|---|---|---|---|
| stf | 0 | 0 | 0 | 0 | erro: todas as buscas falharam: o STF não emitiu o cookie aws-waf-token — o desafio do WAF pode ter mudado | 2026-10-24 |
| tjac | 13 | 3 | 10 | 0 | ok 1 · filtro_ignorado 4 | 2026-10-25 |
| tjal | 9 | 0 | 9 | 0 | ok 2 · filtro_ignorado 2 · nao_verificavel 1 | 2026-10-25 |
| tjam | 0 | 0 | 0 | 0 | erro: buscas sem relator legível no resultado | 2026-10-25 |
| tjap | 25 | 25 | 0 | 0 | ok 5 | 2026-10-26 |
| tjba | 0 | 0 | 0 | 0 | erro: todas as buscas falharam: GraphQL do TJBA recusou a consulta: Internal Server Error(s) while executing query | 2026-10-26 |
| tjce | 22 | 0 | 22 | 0 | ok 5 | 2026-10-26 |
| tjdft | 45 | 5 | 40 | 0 | ok 5 | 2026-10-27 |
| tjes | 56 | 0 | 56 | 0 | ok 5 | 2026-10-27 |
| tjgo | 0 | 0 | 0 | 0 | sem capacidade | 2026-10-27 |
| tjmg | 59 | 0 | 56 | 3 | sem capacidade | 2026-10-28 |
| tjms | 41 | 13 | 28 | 0 | filtro_ignorado 5 | 2026-10-28 |
| tjmt | 0 | 0 | 0 | 0 | sem capacidade | 2026-10-28 |
| tjpa | 30 | 7 | 23 | 0 | ok 5 | 2026-10-29 |
| tjpb | 0 | 0 | 0 | 0 | sem capacidade (filtro por código) | 2026-10-29 |
| tjpe | 34 | 3 | 31 | 0 | ok 5 | 2026-10-29 |
| tjpi | 22 | 5 | 17 | 0 | ok 5 | 2026-10-30 |
| tjpr | 94 | 11 | 83 | 0 | sem capacidade | 2026-10-24 |
| tjrj | 19 | 0 | 18 | 1 | ok 5 | 2026-10-30 |
| tjrj-ejuris | 35 | 1 | 34 | 0 | sem capacidade | 2026-10-30 |
| tjsc | 26 | 2 | 22 | 2 | ok 2 · filtro_ignorado 3 | 2026-10-24 |
| trf1 | 0 | 0 | 0 | 0 | erro: todas as buscas falharam:  - waiting for locator('[id="formulario:textoLivre"]') to be visible | 2026-10-24 |
| trf2 | 0 | 0 | 0 | 0 | erro: buscas sem relator legível no resultado | 2026-10-24 |
| trf3 | 0 | 0 | 0 | 0 | erro: todas as buscas falharam: - waiting for scheduled navigations to finish | 2026-10-24 |
| trf4 | 18 | 4 | 13 | 1 | ok 4 · erro 1 | 2026-10-24 |
| trf5 | 14 | 0 | 13 | 1 | ok 5 | 2026-10-24 |
| trf6 | 8 | 0 | 8 | 0 | ok 5 | 2026-10-24 |
| tst | 20 | 0 | 20 | 0 | ok 5 | 2026-10-24 |

## Fila (45 pendentes, ordem do catálogo)

`tjro`, `tjrr`, `tjrs`, `tjsp`, `tjto`, `trt1`, `trt2`, `trt3`, `trt4`, `trt5`, `trt6`, `trt7`, `trt8`, `trt9`, `trt10`, `trt11`, `trt12`, `trt13`, `trt14`, `trt15`, `trt16`, `trt17`, `trt18`, `trt19`, `trt20`, `trt21`, `trt22`, `trt23`, `trt24`, `tcdf`, `tceba`, `tcece`, `tcees`, `tcego`, `tcemg`, `tcepa`, `tcepe`, `tcepr`, `tcerj`, `tcers`, `tcesc`, `tcesp`, `tcu`, `carf`, `csjt`

## Fora do escopo do cron (4)

- `stj`: estado sem-acesso
- `tjma`: estado sem-acesso
- `tjrn`: estado sem-acesso
- `crps`: estado exige-sessao
