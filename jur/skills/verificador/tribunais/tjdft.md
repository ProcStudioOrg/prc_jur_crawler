# TJDFT — referência de verificação

> Referência da skill [`jur-verificador`](../SKILL.md). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJDFT. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJDFT sem confirmar que ele existe no JurisDF.
A verificação usa o `TJDFTChecker`, que consulta a API pública oficial do tribunal
(`{campo:'processo'}`) — consulta direta, sem termo de busca.

## As duas ressalvas que mudam tudo neste tribunal

**(1) O número precisa ir COM MÁSCARA.** Medido:

```
0705891-74.2023.8.07.0004  ->  2 julgados
07058917420238070004       ->  0, sem erro nenhum
```

**É o oposto do TJMG**, que só aceita dígitos. O `TJDFTChecker` mascara sozinho — mas se
você consultar a API na mão e receber 0, confira isto **antes** de acusar alucinação.

**(2) `encontrado: false` não é veredito.** O JurisDF cobre 2º grau e Turma Recursal; não
há 1º grau. O Checker consulta o DataJud (`api_publica_tjdft`) por conta própria e devolve
`motivo`:

| `motivo` | Leitura correta |
|---|---|
| `processo existe no TJDFT (DataJud) mas não há julgado publicado no JurisDF` | O processo é real — 1º grau ou sem acórdão. **Não é alucinação.** |
| `não encontrado nem no JurisDF nem no DataJud do TJDFT` | Aí sim, desconfie do número. |
| `não encontrado no JurisDF; DataJud indisponível para desempate` | Inconclusivo. **Não afirme nada.** |

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

O TJDFT usa o segmento `.8.07.` (Justiça Estadual, tribunal 07) — `cnj.pertenceA(n, 8, 7)`.
Outro segmento = não é TJDFT. DV inválido é **aviso, não veto**.

### 2. Confirmar na base oficial

```bash
./bin/jur tjdft -n "0705891-74.2023.8.07.0004" --json
```

- `encontrado: true` → `julgados` traz `uuid`, `identificador`, `base`/`subbase`, `juizado`,
  classe, órgão, relator, datas e `url`.
- `encontrado: false` (exit 1) → **leia o `motivo`** e aplique a tabela acima.

**Um processo costuma ter mais de um julgado** (o de referência tem 2). Verificar o número
prova que o processo tem jurisprudência; para provar que **aquele julgado** existe, confira
o `uuid`.

### 3. Auditar buscas em lote

```bash
./bin/jur tjdft -q "tema" --verificar 5 --json
```

### 4. Conferir o conteúdo

Aqui é fácil, e é o melhor caso do repo: **o inteiro teor já vem no resultado da busca**
(campo `inteiroTeor`). Não há request extra nem risco de citar de memória — cite do texto
que veio, ou grave com `--fetch-inteiro-teor`.

⚠️ **Não confie em `possuiInteiroTeor`.** Ele apareceu `false` em registro que tinha
`inteiroTeor` preenchido. Olhe o campo, não o booleano.

### 5. Três armadilhas que produzem "verificação" falsamente tranquila

**(a) Juizado misturado com Justiça Comum.** O default `--acervo todos` traz os dois. Cada
resultado tem `juizado: true|false` (`subbase === 'acordaos-tr'`). **Confira antes de
atribuir a uma Câmara o que uma Turma Recursal decidiu.**

**(b) O zero calado das decisões.** Monocráticas e da Presidência **não têm data de
julgamento**. Se você buscou com `-di/-df` e não achou nada nesses acervos, isso **não** é
prova de ausência — é o filtro apagando tudo. Refaça com `-dpi/-dpf` (publicação).

**(c) `PROX(5)` devolve 0.** Os parênteses matam o operador silenciosamente, apesar de a
tela do tribunal escrever `PROX(N)`. Se sua busca com PROX/ADJ voltou vazia, tire os
parênteses (`PROX5`) antes de concluir que não há jurisprudência.

## Critério de aprovação

Um julgado só entra em resposta final se: número do segmento `.8.07.` **e**
`encontrado: true` **e** o `uuid` citado está na lista devolvida **e** o texto citado veio
do `inteiroTeor`/`ementa` retornados (não de memória) **e** o `juizado` foi conferido antes
de nomear o órgão.

Processo que o DataJud confirma mas o JurisDF não tem entra **apenas** com a ressalva
declarada: "o processo existe, mas não há julgado de 2º grau publicado — a base do TJDFT
não cobre 1º grau".
