# `jur` — hub para agentes

CLI de jurisprudência dos tribunais brasileiros. Este arquivo só roteia; flags,
operadores, escopo e ressalvas ficam no guia específico de cada tribunal.

## Fluxo obrigatório

1. Pedido ambíguo: use [`jur-improve-user-prompt`](skills/improve-user-prompt/SKILL.md).
2. Confira [`cobertura/CLAUDE-FALHAS.md`](cobertura/CLAUDE-FALHAS.md). Ausente da lista = operacional.
3. Escolha o comando abaixo e leia o respectivo `CLAUDE-<TRIBUNAL>.md`.
4. Execute com [`jur-browser`](skills/browser/SKILL.md).
5. Antes de citar, confirme com [`jur-verificador`](skills/verificador/SKILL.md).

Nunca presuma operadores ou flags entre tribunais. Nunca cite julgado de memória.

## Documentos de navegação

| Necessidade | Documento |
|---|---|
| Falhas conhecidas | [`cobertura/CLAUDE-FALHAS.md`](cobertura/CLAUDE-FALHAS.md) |
| Mapear tribunal novo | [`CLAUDE-CODEGEN.md`](CLAUDE-CODEGEN.md) |
| Justiça do Trabalho | [`CLAUDE-FALCAO.md`](CLAUDE-FALCAO.md) |
| Portais do CJF | [`CLAUDE-CJF.md`](CLAUDE-CJF.md) |
| Trabalho ainda não implementado | [`../TODO.md`](../TODO.md) |
| Skills disponíveis | [`skills/README.md`](skills/README.md) |

## Tribunais nacionais e Justiça Federal

| Comando | Escopo | Guia |
|---|---|---|
| `stf` | constitucional, nacional | [`CLAUDE-STF.md`](CLAUDE-STF.md) |
| `stj` | lei federal, nacional | [`CLAUDE-STJ.md`](CLAUDE-STJ.md) |
| `trf1` | AC, AM, AP, BA, DF, GO, MA, MT, PA, PI, RO, RR, TO | [`CLAUDE-TRF1.md`](CLAUDE-TRF1.md) |
| `trf2` | ES, RJ | [`CLAUDE-TRF2.md`](CLAUDE-TRF2.md) |
| `trf3` | MS, SP | [`CLAUDE-TRF3.md`](CLAUDE-TRF3.md) |
| `trf4` | PR, RS, SC | [`CLAUDE-TRF4.md`](CLAUDE-TRF4.md) |
| `trf5` | AL, CE, PB, PE, RN, SE | [`CLAUDE-TRF5.md`](CLAUDE-TRF5.md) |
| `trf6` | MG | [`CLAUDE-TRF6.md`](CLAUDE-TRF6.md) |

## Justiça Estadual

| UF | Comando | Guia | UF | Comando | Guia |
|---|---|---|---|---|---|
| AC | `tjac` | [`TJAC`](CLAUDE-TJAC.md) | AL | `tjal` | [`TJAL`](CLAUDE-TJAL.md) |
| AM | `tjam` | [`TJAM`](CLAUDE-TJAM.md) | AP | `tjap` | [`TJAP`](CLAUDE-TJAP.md) |
| BA | `tjba` | [`TJBA`](CLAUDE-TJBA.md) | CE | `tjce` | [`TJCE`](CLAUDE-TJCE.md) |
| DF | `tjdft` | [`TJDFT`](CLAUDE-TJDFT.md) | ES | `tjes` | [`TJES`](CLAUDE-TJES.md) |
| GO | `tjgo` | [`TJGO`](CLAUDE-TJGO.md) | MA | `tjma` | [`TJMA`](CLAUDE-TJMA.md) |
| MG | `tjmg` | [`TJMG`](CLAUDE-TJMG.md) | MS | `tjms` | [`TJMS`](CLAUDE-TJMS.md) |
| MT | `tjmt` | [`TJMT`](CLAUDE-TJMT.md) | PA | `tjpa` | [`TJPA`](CLAUDE-TJPA.md) |
| PB | `tjpb` | [`TJPB`](CLAUDE-TJPB.md) | PE | `tjpe` | [`TJPE`](CLAUDE-TJPE.md) |
| PI | `tjpi` | [`TJPI`](CLAUDE-TJPI.md) | PR | `tjpr` | [`TJPR`](CLAUDE-TJPR.md) |
| RJ | `tjrj` / `tjrj-ejuris` | [`TJRJ`](CLAUDE-TJRJ.md) / [`eJURIS`](CLAUDE-TJRJ-EJURIS.md) | RN | `tjrn` | [`TJRN`](CLAUDE-TJRN.md) |
| RO | `tjro` | [`TJRO`](CLAUDE-TJRO.md) | RR | `tjrr` | [`TJRR`](CLAUDE-TJRR.md) |
| RS | `tjrs` | [`TJRS`](CLAUDE-TJRS.md) | SC | `tjsc` | [`TJSC`](CLAUDE-TJSC.md) |
| SE | — | [`TJSE`](CLAUDE-TJSE.md) | SP | `tjsp` | [`TJSP`](CLAUDE-TJSP.md) |
| TO | `tjto` | [`TJTO`](CLAUDE-TJTO.md) | | | |

## Justiça do Trabalho

Use `tst`, `trt1`…`trt24` ou `csjt`. Escolha o TRT pela UF do vínculo na tabela de
[`CLAUDE-FALCAO.md`](CLAUDE-FALCAO.md); detalhes técnicos comuns ficam em
[`CLAUDE-TRT9.md`](CLAUDE-TRT9.md).

## Controle externo e instâncias administrativas

| Comando | Órgão | Guia |
|---|---|---|
| `tcu` | TCU | [`CLAUDE-TCU.md`](CLAUDE-TCU.md) |
| `tcdf` | TCDF | [`CLAUDE-TCDF.md`](CLAUDE-TCDF.md) |
| `tceba` · `tcees` · `tcemg` · `tcepa` · `tcepe` | TCEs BA, ES, MG, PA, PE | [`TCEBA`](CLAUDE-TCEBA.md) · [`TCEES`](CLAUDE-TCEES.md) · [`TCEMG`](CLAUDE-TCEMG.md) · [`TCEPA`](CLAUDE-TCEPA.md) · [`TCEPE`](CLAUDE-TCEPE.md) |
| `tcepr` · `tcerj` · `tcers` · `tcesc` · `tcesp` | TCEs PR, RJ, RS, SC, SP | [`TCEPR`](CLAUDE-TCEPR.md) · [`TCERJ`](CLAUDE-TCERJ.md) · [`TCERS`](CLAUDE-TCERS.md) · [`TCESC`](CLAUDE-TCESC.md) · [`TCESP`](CLAUDE-TCESP.md) |
| `carf` | contencioso tributário federal | [`CLAUDE-CARF.md`](CLAUDE-CARF.md) |
| `crps` | contencioso previdenciário administrativo | [`CLAUDE-CRPS.md`](CLAUDE-CRPS.md) |

## CLI e manutenção

```bash
./bin/jur <comando> --help
./bin/jur <comando> -q "<termos>" -m 1 --json
npm run docs && npm test && node sync-plugin.js --check
```

Resultados vão para `resultados/`. Para crawler quebrado use [`jur-fixer`](skills/fixer/SKILL.md).
