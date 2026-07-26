<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJMG — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJMG. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJMG sem confirmar que ele existe na base oficial.
A verificação usa o `TJMGChecker`, que consulta a Consulta de Jurisprudência Unificada
(campo `numerosProcessos` da API) — consulta direta, sem termo de busca.

## A ressalva que muda tudo neste tribunal

A base de jurisprudência é **2º grau + Turmas Recursais**. Ela **não tem 1º grau
(sentenças) nem súmulas**. Portanto `encontrado: false` significa "não há julgado
publicado nessa base", **não** "o processo não existe".

Para você não precisar adivinhar qual dos dois é o caso, o Checker faz um segundo passo
sozinho, no **DataJud** (`api_publica_tjmg`, que cobre todos os graus), e devolve `motivo`:

| `motivo` | Leitura correta |
|---|---|
| `processo existe no TJMG (DataJud) mas não há julgado publicado na base de jurisprudência` | O processo é real. Provavelmente 1º grau ou sem acórdão. **Não é alucinação** — diga isso ao usuário em vez de rejeitar. |
| `não encontrado nem na jurisprudência nem no DataJud do TJMG` | Aí sim, desconfie do número. |
| `não encontrado na jurisprudência; DataJud indisponível para desempate` | Inconclusivo. **Não afirme nada**; repita depois. |

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- O TJMG usa o segmento `.8.13.` (Justiça Estadual, tribunal 13) —
  `cnj.pertenceA(n, 8, 13)`. Outro segmento = não é TJMG, pare aqui.
- DV inválido é **AVISO, não veto**. A prova é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjmg -n "5003998-10.2020.8.13.0079" --json
```

- `encontrado: true` → o array `julgados` traz `id`, `documentoId`, `tipoDocumento`,
  classe, comarca, órgão julgador, datas e a `url` do inteiro teor.
- `encontrado: false` (exit code 1) → **leia o `motivo`** e aplique a tabela acima antes
  de concluir qualquer coisa.

**Um processo pode ter mais de um julgado.** Verificar o número prova que o processo tem
jurisprudência publicada; para provar que **aquele julgado** existe, confira o `id`.

### 3. Auditar buscas em lote

```bash
./bin/jur tjmg -q "tema" --escopo inteiroTeor --verificar 5 --json
```

Reamostra N resultados, reconsulta cada processo por número e confirma que o mesmo `id`
retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir o conteúdo (anti-alucinação de ementa)

⚠️ **Específico do TJMG: olhe `ementaEhTrecho` antes de citar o campo `ementa`.**

| `ementaEhTrecho` | O que você tem | Pode citar como ementa? |
|---|---|---|
| `false` (só em **Acórdão**) | a ementa integral, como a base devolve | **sim** |
| `true` (Monocrática, Turma Recursal, Vice) | recortes com o termo destacado | **não** — é fragmento |

Quando for `true`, baixe o inteiro teor e cite do arquivo:

```bash
./bin/jur tjmg -q "tema" --escopo inteiroTeor -m 1 --fetch-inteiro-teor
```

O campo `trechos` guarda os destaques nos dois casos — use-o para localizar a passagem, não
para citá-la.

⚠️ **`relator` vem vazio em Turma Recursal** (a API não devolve `magistrado` nesse tipo).
Não invente o nome nem o deduza do órgão julgador: cite sem relator ou tire do inteiro teor.

### 5. Duas armadilhas que produzem "verificação" falsamente tranquila

**(a) O zero calado do escopo ementa.** Só o tipo `Acórdão` tem ementa indexada. Se você
buscou sem `--escopo inteiroTeor` e não achou nada de Turma Recursal, isso **não** é prova
de ausência — é o índice vazio. Refaça com `--escopo inteiroTeor` antes de dizer ao usuário
que não há jurisprudência de Juizado sobre o tema.

**(b) O contador saturado.** `totalResults: 1000` com `totalResultsExato: false` significa
"1000 **ou mais**", não "1000". Nunca relate esse número como contagem.

## Critério de aprovação

Um julgado só entra em resposta final se: número do segmento `.8.13.` **e**
`encontrado: true` **e** o `id` citado está na lista devolvida **e** o texto citado veio da
ementa real (`ementaEhTrecho: false`) ou do inteiro teor baixado — nunca de trecho nem de
memória.

Processo que o DataJud confirma mas a jurisprudência não tem entra **apenas** com a
ressalva declarada: "o processo existe, mas não há julgado de 2º grau publicado — a base do
TJMG não cobre 1º grau".
