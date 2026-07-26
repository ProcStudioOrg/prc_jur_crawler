<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TRF6 — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TRF6. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TRF6 sem confirmar que ele existe na base oficial.
Toda verificação usa o `TRF6Checker`, que reproduz o campo "Processo" (`#txtProcesso`) do
módulo de jurisprudência do e-Proc
(`eproc-jur.trf6.jus.br/eproc/...jurisprudencia@jurisprudencia/pesquisar`).

## Antes de tudo: a base só tem 2º grau e só a partir de **2023**

| | |
|---|---|
| Cobertura | 2º grau (TRF6, Turmas Recursais, TRU6). A origem "Varas Federais" (1º grau) existe no site e está **VAZIA**: 0 documentos. |
| Início do acervo | **2023**. O TRF6 foi instalado em ago/2022, desmembrado do TRF1. |
| Onde está o resto | Julgado mineiro **até 2022** está na base do **TRF1** (`./bin/jur trf1`). A Jurisprudência Unificada do CJF **não lista o TRF6**. |

Se um julgado de MG anterior a 2023 aparecer numa petição, o `-n` no TRF6 vai devolver
`encontrado: false` — e isso **não prova** que o julgado não existe. Antes de dizer
"não existe", **repita a verificação no `trf1`**. Dizer "não encontrei no TRF6" quando o
acórdão está no TRF1 é tão errado quanto citar um julgado inventado.

## ⚠️ A armadilha nº 1 do TRF6: o segmento CNJ é **misto**

O passo 1 genérico da skill manda comparar o segmento do número com o tribunal alegado, e
tratar divergência como sinal de alucinação. **No TRF6 essa regra produz falso positivo.**

O tribunal herdou do TRF1 os processos mineiros com a numeração antiga, então a base tem
`.4.06.` **e** `.4.01.` misturados. Medido em amostras de 100 documentos (25/07/2026):

| origem | `.4.06.` | `.4.01.` (herdados do TRF1) |
|---|---|---|
| TRF6 (2º grau comum) | 91 | 9 |
| Turmas Recursais | 76 | **24** |
| TRU6 | 56 | **44** |

Ou seja: rejeitar `.4.01.` como "não é do TRF6" descartaria quase metade do acervo da TRU6
como se fosse alucinação. Por isso `TRF6Checker.ehProcessoTRF6()` aceita as duas, e a saída
traz `herancaTRF1: true` quando o número é `.4.01.`.

**Regra prática:** para o TRF6, o segmento válido é `.4.06.` **ou** `.4.01.`. Qualquer outro
(`.4.02.`, `.8.13.`, …) é que é sinal de alucinação.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- Aceite `cnj.pertenceA(n, 4, 6)` **ou** `cnj.pertenceA(n, 4, 1)` — ver a armadilha acima.
- DV inválido é **AVISO, não veto**. A prova é o passo 2.
- Há números com sequencial antigo mas máscara CNJ (`0019935-92.2009.4.01.3800` — a
  subseção 3800 é Belo Horizonte). São legítimos.

### 2. Confirmar na base oficial

```bash
./bin/jur trf6 -n "1017514-90.2019.4.01.9999" --json
```

A consulta é feita com as **quatro origens marcadas** de propósito: o julgado pode ser do
TRF6, das Turmas Recursais ou da TRU6, e a verificação não deve depender de acertar isso
antes.

- `encontrado: true` → o array `decisoes` traz `id` (o identificador do **documento**),
  `tipoDocumento`, `orgaoJulgador`, `classe`, `relator`, `uf`, datas, `processoUrl`
  (consulta processual pública no e-Proc de 2º grau) e a ementa.
- `encontrado: false` (exit code 1) → **não está** na base de jurisprudência do TRF6.
  Antes de afirmar ausência: (a) o julgado é anterior a 2023? tente o `trf1`;
  (b) o processo pode existir no e-Proc sem estar indexado na jurisprudência.
- Custo: ~0,4 s. Este tribunal é HTTP puro, sem browser e sem bloqueio anti-bot.

Diferente do TRF2, aqui `#txtProcesso` funciona sozinho; o Checker manda um `*` junto
apenas por segurança (não restringe nada).

**Um processo pode ter várias decisões** (acórdão + monocrática + despacho da
Vice-Presidência). Verificar o número prova que o processo existe; para provar que
**aquela decisão** existe, confira o `id` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur trf6 -q "tema" --verificar 5 --json
```

Reamostra N resultados, reconsulta cada processo por número e confirma que o mesmo `id`
retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir que o recorte foi o pedido

Chamar de "acórdão do TRF6" um julgado de Turma Recursal (Juizado Especial Federal) é erro
material — muda a instância, o rito e a força do precedente. Dois campos resolvem:

| campo | Justiça Federal comum (2º grau) | Juizados / Turmas Recursais | TRU6 |
|---|---|---|---|
| `orgaoJulgador` | `1ª Turma - PREV/SERV`, `2ª Seção`, `Plenário`, `VICE-PRESIDÊNCIA` | `3ª Turma Recursal dos Juizados Especiais Federais de Minas Gerais` | `TURMA REGIONAL DE UNIFORMIZAÇÃO` |
| `origemProcesso` / `sufixoOrigem` | `TRF6` | `MG` | `TRF6` |

⚠️ O `tipoDocumento` **não** distingue origem (é "Acórdão" em todas). E o sufixo **não**
separa TRF6 de TRU6 — nesse par, quem decide é o `orgaoJulgador`.

O `--json` de uma busca também traz `origemAplicada`, com o rótulo do que foi de fato
enviado ao combo.

### 5. Fonte secundária: DataJud (CNJ)

```bash
./bin/jur trf6 -n "1017514-90.2019.4.01.9999" --datajud --json
```

Acrescenta o bloco `datajud` (índice `api_publica_trf6`) com metadados do processo. Serve
para separar dois casos quando o passo 2 devolve `encontrado: false`:

- DataJud `encontrado: true` → **o processo existe** no TRF6, mas não há documento indexado
  na jurisprudência. Diga isso; não cite decisão.
- DataJud `encontrado: false` → nem o processo aparece. Sinal forte de número inventado.

⚠️ O DataJud **não tem ementa nem inteiro teor** — nunca use para confirmar o **teor** de
uma decisão. E é instável (429 é comum). `disponivel: false` significa "a API falhou",
**não** "o processo não existe".

### 6. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa`/`citacao` retornado (no TRF6 a
ementa vem **inteira** no resultado, inclusive nas Turmas Recursais) ou baixe o inteiro
teor (`--fetch-inteiro-teor`) e cite a partir do arquivo salvo. Decisões monocráticas
costumam vir sem EMENTA, só com o campo DECISÃO.

## Armadilha de busca que produz falso "não existe"

Se você foi procurar o julgado por **termo** antes de procurar por número:

1. **Não hifenize a query.** É o oposto do TRF2: aqui o espaço funciona como E, e o hífen
   mata `ou`/`não` (`dano-ou-moral` = 216.419 em vez de 21.366).
2. **Operadores em português.** `and`/`or`/`not` viram termo literal — `dano and moral`
   devolve 6 documentos.
3. **Não busque período anterior a 2023.** Devolve 0 sempre.

Não conclua ausência a partir de uma busca por termo; conclua pelo `-n`.

## Critério de aprovação

Um julgado só entra em resposta final se: número no segmento `.4.06.` **ou** `.4.01.`
**e** `encontrado: true` **e** o `id` da decisão citada está na lista devolvida **e** a
atribuição Justiça Federal comum × Turma Recursal × TRU6 confere no `orgaoJulgador` e no
sufixo de origem **e** a ementa citada veio do texto da base (não de memória).
