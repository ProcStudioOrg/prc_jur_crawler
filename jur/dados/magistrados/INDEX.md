# Magistrados mapeados por tribunal

Gerado por `node tests/magistrados.js` (ver `docs/magistrados.md`). Um JSON por tribunal nesta pasta;
só nome e cargo públicos, sem texto de julgado. Grau inferido pelo órgão julgador e pelo cargo:
`1` = vara, juizado ou turma recursal; `2` = câmara, turma, seção ou órgão especial; `desconhecido` = sem pista.

| Tribunal | Magistrados | 1º grau | 2º grau | desc. | Teste da busca por magistrado | Coletado em |
|---|---|---|---|---|---|---|
| stf | 0 | 0 | 0 | 0 | erro: todas as buscas falharam: o STF não emitiu o cookie aws-waf-token — o desafio do WAF pode ter mudado | 2026-10-24 |
| tjpr | 94 | 11 | 83 | 0 | sem capacidade | 2026-10-24 |
| tjsc | 26 | 2 | 22 | 2 | ok 2 · filtro_ignorado 3 | 2026-10-24 |
| trf1 | 0 | 0 | 0 | 0 | erro: todas as buscas falharam:  - waiting for locator('[id="formulario:textoLivre"]') to be visible | 2026-10-24 |
| trf4 | 18 | 4 | 13 | 1 | ok 4 · erro 1 | 2026-10-24 |
| trf6 | 8 | 0 | 8 | 0 | ok 5 | 2026-10-24 |
| tst | 20 | 0 | 20 | 0 | ok 5 | 2026-10-24 |

## Fila (66 pendentes, ordem do catálogo)

`trf2`, `trf3`, `trf5`, `tjac`, `tjal`, `tjam`, `tjap`, `tjba`, `tjce`, `tjdft`, `tjes`, `tjgo`, `tjmg`, `tjms`, `tjmt`, `tjpa`, `tjpb`, `tjpe`, `tjpi`, `tjrj`, `tjrj-ejuris`, `tjro`, `tjrr`, `tjrs`, `tjsp`, `tjto`, `trt1`, `trt2`, `trt3`, `trt4`, `trt5`, `trt6`, `trt7`, `trt8`, `trt9`, `trt10`, `trt11`, `trt12`, `trt13`, `trt14`, `trt15`, `trt16`, `trt17`, `trt18`, `trt19`, `trt20`, `trt21`, `trt22`, `trt23`, `trt24`, `tcdf`, `tceba`, `tcece`, `tcees`, `tcego`, `tcemg`, `tcepa`, `tcepe`, `tcepr`, `tcerj`, `tcers`, `tcesc`, `tcesp`, `tcu`, `carf`, `csjt`

## Fora do escopo do cron (4)

- `stj`: estado sem-acesso
- `tjma`: estado sem-acesso
- `tjrn`: estado sem-acesso
- `crps`: estado exige-sessao
