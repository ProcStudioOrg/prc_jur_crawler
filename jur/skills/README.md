# skills/

Quatro skills genéricas cobrem o ciclo inteiro. **Especificidade de tribunal não mora aqui** —
mora em `CLAUDE-<TRIBUNAL>.md` (flags, ressalvas) e em `human-codegen/<TRIBUNAL>/` (telas, prints).
Foi a decisão de projeto: uma skill por *função*, não por estado, para não repetir 27 vezes o
mesmo procedimento.

| Skill | Faz | Quando |
|---|---|---|
| [`improve-user-prompt`](improve-user-prompt/SKILL.md) | Pedido vago → plano de busca (tribunal, query, objetivo, período) | Antes de qualquer busca cujo recorte não esteja explícito |
| [`browser`](browser/SKILL.md) | Roteia o tribunal, refina, executa, baixa inteiro teor, analisa | Uso do dia a dia |
| [`verificador`](verificador/SKILL.md) | Confirma que cada julgado citado existe na base oficial | Antes de entregar qualquer lista de julgados |
| [`fixer`](fixer/SKILL.md) | Diagnostica crawler quebrado comparando a tela atual com os prints | Quando o tribunal muda o site |
| [`codegen`](codegen/SKILL.md) | Mapeia um tribunal novo e monta o crawler | Tribunal novo ou mapeamento incompleto |

Fluxo típico:

```
pedido vago ──> improve-user-prompt ──> browser ──> verificador ──> resposta
                                           │
                          quebrou? ────────┴──> fixer
                    tribunal novo? ─────────────> codegen
```

## Referências por tribunal

Só existem quando o procedimento realmente difere. Hoje:

- [`verificador/tribunais/tjgo.md`](verificador/tribunais/tjgo.md) — segmento `.8.09.`, DV de acervo legado
- [`verificador/tribunais/tjpa.md`](verificador/tribunais/tjpa.md) — segmento `.8.14.`, acervo Libra, permalink
- [`verificador/tribunais/tjrs.md`](verificador/tribunais/tjrs.md) — segmento `.8.21.`, acervo pré-CNJ (Themis), `filtroSolr` como prova de Justiça Comum × Turma Recursal
- [`verificador/tribunais/tjsc.md`](verificador/tribunais/tjsc.md) — segmento `.8.24.`, dois portais no ar (o antigo está congelado), Justiça Comum × Turma Recursal por três campos concordantes
- [`verificador/tribunais/trt9.md`](verificador/tribunais/trt9.md) — segmento `.5.09.` (não confundir com `.8.16.` do TJPR), busca por número é textual e devolve vizinhos, sem permalink por documento

Antes de criar uma referência nova, pergunte se aquilo não é uma ressalva de
`CLAUDE-<TRIBUNAL>.md`. Quase sempre é.

## Empacotamento

Estas skills são espelhadas no plugin em `../../plugins/jur-tribunais/skills/`.
Ao editar aqui, rode `node sync-plugin.js` (da pasta `jur/`) para manter os dois lados iguais.
`node sync-plugin.js --check` falha se estiverem dessincronizados — bom para CI.
