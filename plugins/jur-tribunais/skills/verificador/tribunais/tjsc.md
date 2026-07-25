<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJSC — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJSC. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJSC sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJSCChecker`, que reproduz o campo "N. do processo"
(`#txtProcesso`) do portal de jurisprudência do e-Proc.

## Antes de tudo: existem DOIS portais de jurisprudência do TJSC

| Portal | Situação |
|---|---|
| `eprocwebcon.tjsc.jus.br/consulta1g/...` (novo) | base viva — **é o que o checker consulta** |
| `busca.tjsc.jus.br/jurisprudencia/` (antigo) | base histórica congelada desde 08/10/2025 |

Se alguém trouxer um julgado "que não está na base", confira se não veio do portal
antigo. Nunca conclua "não existe" a partir do portal antigo.

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur tjsc`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- O TJSC usa o segmento **`.8.24.`** (Justiça Estadual = 8, tribunal = 24) —
  `cnj.pertenceA(n, 8, 24)`. Segmento diferente = não é TJSC, pare aqui.
- DV inválido é **AVISO, não veto**. A prova é o passo 2.
- Diferente do TJRS, a base nova do TJSC traz os números todos em formato CNJ —
  numeração legada de 8-11 dígitos aqui é sinal de alerta, não de acervo antigo.

### 2. Confirmar na base oficial

```bash
./bin/jur tjsc -n "5014543-38.2025.8.24.0054" --json
```

A consulta é feita com as **quatro origens marcadas** de propósito: o julgado pode ser
da Justiça Comum, das Turmas Recursais, das Turmas de Uniformização ou do Conselho da
Magistratura, e a verificação não deve depender de acertar isso antes.

- `encontrado: true` → o array `decisoes` traz `id` (o identificador do **documento**),
  `tipoDocumento`, `orgaoJulgador`, `classe`, `relator`, datas, `processoUrl` (consulta
  processual pública no e-Proc) e a ementa.
- `encontrado: false` (exit code 1) → **não está** na base de jurisprudência. Não cite.
  (Pode existir no e-Proc sem estar indexado na jurisprudência — diga isso explicitamente.)
- Custo: ~10 s, porque o portal exige um browser (verificação de segurança F5).
  Se voltar erro de "verificação de segurança não liberou", **tente de novo** antes de
  concluir qualquer coisa: é bloqueio, não ausência do julgado.

**Um processo pode ter várias decisões** (acórdão + monocrática). Verificar o número
prova que o processo existe; para provar que **aquela decisão** existe, confira o `id`
na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur tjsc -q "tema" --verificar 5 --json
```

Reamostra N resultados, reconsulta cada processo por número e confirma que o mesmo `id`
retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir que o recorte foi o pedido (específico do TJSC)

Chamar de "acórdão do TJSC" um julgado de Turma Recursal (ou vice-versa) é erro
material. Três campos da própria saída resolvem, e **os três têm que concordar**:

| campo | Justiça Comum | Juizados / Turmas Recursais |
|---|---|---|
| `tipoDocumento` | `Acórdãos do Tribunal de Justiça` | `Acórdãos das Turmas Recursais` |
| `orgaoJulgador` | `3ª Câmara de Direito Civil` | `2ª Turma Recursal` |
| `sufixoOrigem` (sufixo do nº na tela) | `TJSC` | `SC` |

O `--json` de uma busca também traz `origemAplicada`, com o rótulo do que foi de fato
marcado no combo. Se ele disser "TJSC (Justiça Comum) + Turmas Recursais …", **não**
afirme que os julgados são de um ou de outro sem olhar caso a caso.

### 5. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa`/`citacao` retornado ou baixe o
inteiro teor (`--fetch-inteiro-teor`) e cite a partir do arquivo salvo.

## Critério de aprovação

Um julgado só entra em resposta final se: número no segmento `.8.24.` **e**
`encontrado: true` **e** o `id` da decisão citada está na lista devolvida **e** a
atribuição Justiça Comum × Turma Recursal confere nos três campos acima **e** a ementa
citada veio do texto da base (não de memória).
