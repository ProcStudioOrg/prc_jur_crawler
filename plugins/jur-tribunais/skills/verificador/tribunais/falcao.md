<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# FALCÃO (Justiça do Trabalho) — referência de verificação dos 26 acervos

> Vale para `tst`, `trt1`…`trt24` e `csjt`. Especificidades do TRT9 (fixtures,
> exemplos conferidos) em [`trt9.md`](trt9.md). Rode os comandos da raiz do repo (`jur/`).

Todos os 26 acervos são a MESMA base nacional (FALCÃO). A verificação usa o Checker
do tribunal: `./bin/jur <cmd> -n "<nº CNJ>" --json`.

## Passo 1 — Validar o número (offline)

Número da JT: `NNNNNNN-DD.AAAA.5.TR.OOOO` — **J=5** é Justiça do Trabalho.
Se `J != 5`, não é processo trabalhista: **pare** e roteie para o ramo certo.

### ⚠️ O `TR` NÃO se valida do mesmo jeito nos 26

| Acervo | Regra do `TR` | Por quê |
|---|---|---|
| `trt1`…`trt24` | exige `.5.<NN>.` da própria região (TRT9 → `.5.09.`) | numeração da região |
| **`tst`** | **aceita qualquer `.5.NN.`** | o número é atribuído **na origem e preservado**: o acervo do TST guarda casos com o TR do TRT de onde vieram (TR 04, 09, 15, 07 na mesma página de resultados) |
| **`csjt`** | exige `.5.90.` | acervo administrativo, numeração própria — **não** é `.5.00.` |

Erro clássico: exigir `.5.00.` no TST. Isso rejeitaria **todo julgado legítimo** do TST —
o oposto do que o verificador serve para fazer. No código isso é `codigoCNJ: null`
para o TST (`src/FalcaoTribunais.js`); não "conserte" para `0`.

## Passo 2 — Confirmar na base oficial

```bash
./bin/jur trt2 -n "1000657-95.2020.5.02.0048" --json
./bin/jur tst  -n "0000543-08.2015.5.04.0271" --json   # nº do TRT4, legítimo no TST
```

Campos que decidem: `encontrado`, `doTribunal`, `graus`, `documentos[]`.
`encontrado: false` → **não cite**. O Checker filtra por igualdade EXATA do número,
porque a busca do Falcão é textual e devolve vizinhos — "veio resultado" não é prova.

## Passo 3 — Auditar buscas em lote

```bash
./bin/jur trt15 -q "tema" -di "01/01/2025" -df "31/03/2025" --verificar 5 --json
```

## Ressalvas que mudam a conclusão

1. **Coleção inexistente ≠ julgado inexistente.** `tst` e `csjt` não têm `sentencas`
   nem `recursorevista` — a CLI avisa. "0 resultados" ali significa "essa pergunta é
   para o TRT de origem", não "não há jurisprudência".
2. **Um processo aparece em várias coleções** (sentença + acórdão + RR). `graus`
   mostra a trajetória — é informação, não divergência.
3. **Não há permalink por documento** no Falcão. A prova de existência é a consulta
   por número; não prometa link direto ao usuário.
4. **HTTP 429 é bloqueio, não erro.** Os 26 comandos batem no mesmo host. Se a
   verificação falhar com 429, **espere e repita** — não conclua "não existe".
5. **SP tem dois TRTs**: conferir um número paulista no `trt2` quando ele é `.5.15.`
   dará `doTribunal: false` corretamente — use `trt15`.

## Critério de aprovação

Um julgado da JT só entra em resposta final se: `J=5` **e** o `TR` bate pela regra da
tabela acima **e** `encontrado: true` **e** o número do documento confere exatamente.
