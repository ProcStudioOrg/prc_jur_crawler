# skills/

Seis skills genéricas cobrem o ciclo inteiro. **Especificidade de tribunal não mora aqui** —
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
| [`browser-post-search`](browser-post-search/SKILL.md) | Mapeia o **pós-busca**: card, escada até o documento, formato, paginação, permalink | Assim que a busca de um tribunal novo retorna resultados |

Fluxo típico:

```
pedido vago ──> improve-user-prompt ──> browser ──> verificador ──> resposta
                                           │
                          quebrou? ────────┴──> fixer
                    tribunal novo? ─────────────> codegen ──> browser-post-search
                                                   (entrada)      (saída)
```

`codegen` e `browser-post-search` são as duas metades do mesmo trabalho: a primeira mapeia
como se **pergunta** (filtros, operadores, combos), a segunda como se **chega ao documento**
(card, inteiro teor, paginação, permalink). Parar na primeira entrega um crawler que devolve
contagem em vez de jurisprudência — foi o que aconteceu em mapeamentos anteriores.

## Referências por tribunal

Só existem quando o procedimento realmente difere. Hoje são 13:

- [`verificador/tribunais/falcao.md`](verificador/tribunais/falcao.md) — os 26 acervos da Justiça do Trabalho; o `TR` **não** é uniforme (o TST aceita processo de qualquer TRT de origem, o CSJT usa `.5.90.`)
- [`verificador/tribunais/stj.md`](verificador/tribunais/stj.md) — **pule a validação CNJ**: a base não indexa CNJ e o número que aparece é o do processo de **origem**
- [`verificador/tribunais/tjdft.md`](verificador/tribunais/tjdft.md) — segmento `.8.07.`, número exige **máscara** (oposto do TJMG), desempate no DataJud, `possuiInteiroTeor` mente
- [`verificador/tribunais/tjgo.md`](verificador/tribunais/tjgo.md) — segmento `.8.09.`, DV de acervo legado
- [`verificador/tribunais/tjmg.md`](verificador/tribunais/tjmg.md) — segmento `.8.13.`, número só com **dígitos**, `ementa` pode ser trecho (`ementaEhTrecho`), desempate no DataJud
- [`verificador/tribunais/tjpa.md`](verificador/tribunais/tjpa.md) — segmento `.8.14.`, acervo Libra, permalink
- [`verificador/tribunais/tjpr.md`](verificador/tribunais/tjpr.md) — segmento `.8.16.`, verificação por filtro dentro da busca
- [`verificador/tribunais/tjrj.md`](verificador/tribunais/tjrj.md) — segmento `.8.19.`, base verificável é **só o e-Proc** (~2023+); Juizado e acervo antigo vivem no eJURIS, sem crawler
- [`verificador/tribunais/tjrs.md`](verificador/tribunais/tjrs.md) — segmento `.8.21.`, acervo pré-CNJ (Themis), `filtroSolr` como prova de Justiça Comum × Turma Recursal
- [`verificador/tribunais/tjsc.md`](verificador/tribunais/tjsc.md) — segmento `.8.24.`, dois portais no ar (o antigo está congelado), Justiça Comum × Turma Recursal por três campos concordantes
- [`verificador/tribunais/trf2.md`](verificador/tribunais/trf2.md) — segmento `.4.02.`, base começa em 2018, o espaço entre termos quebra a busca
- [`verificador/tribunais/trf6.md`](verificador/tribunais/trf6.md) — segmento **misto** `.4.06.` OU `.4.01.` (herança do TRF1); rejeitar `.4.01.` gera falso alerta de alucinação
- [`verificador/tribunais/trt9.md`](verificador/tribunais/trt9.md) — segmento `.5.09.` (não confundir com `.8.16.` do TJPR), busca por número é textual e devolve vizinhos, sem permalink por documento

Antes de criar uma referência nova, pergunte se aquilo não é uma ressalva de
`CLAUDE-<TRIBUNAL>.md`. Quase sempre é.

## Empacotamento

Estas skills são espelhadas no plugin em `../../plugins/jur-tribunais/skills/`.
Ao editar aqui, rode `node sync-plugin.js` (da pasta `jur/`) para manter os dois lados iguais.
`node sync-plugin.js --check` falha se estiverem dessincronizados — bom para CI.
