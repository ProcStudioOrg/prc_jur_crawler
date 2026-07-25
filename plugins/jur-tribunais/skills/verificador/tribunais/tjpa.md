<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJPA — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJPA. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJPA sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJPAChecker` (consulta direta por número — a mesma aba
"Consultar por Processo / Acórdão / Decisão Monocrática" do sistema oficial).

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur tjpa`.
2. Sempre que um número de processo/acórdão vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline, instantâneo)

Validação CNJ é genérica para todos os tribunais: `src/cnj.js`.

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- TJPA exige segmento `.8.14.` (Justiça Estadual, tribunal 14) — `cnj.pertenceA(n, 8, 14)`.
  Outro segmento = não é TJPA. Pare aqui.
- Dígito verificador inválido é **AVISO, não veto**: o acervo legado migrado do
  sistema Libra (ex.: processos de 2007-2011) tem numeração convertida cujo DV
  não fecha, mas que existe na base. A prova definitiva é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjpa -n "<numero-cnj-ou-numero-acordao>" --json
```

- `encontrado: true` → o array `decisoes` traz id, tipo, relator, data e o permalink
  `https://jurisprudencia.tjpa.jus.br/documento/<id>` (citável).
- `encontrado: false` (exit code 1) → o julgado **não está** na base de jurisprudência.
  Não cite. (Pode existir no PJe sem estar indexado na jurisprudência — diga isso explicitamente.)

### 3. Auditar buscas em lote

Ao rodar uma pesquisa que alimentará um relatório, adicione `--verificar [N]`:

```bash
./bin/jur tjpa -q "tema" --verificar 5 --json
```

O checker reamostra N resultados, reconsulta cada processo por número e confirma que o
mesmo `id` retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o texto retornado (`ementa` no JSON) ou baixe o
inteiro teor (`--fetch-inteiro-teor`) e cite a partir do arquivo salvo.

## Critério de aprovação

Um julgado só entra em resposta final se: dígito CNJ válido **e** `encontrado: true`
**e** a ementa citada veio do texto retornado pela base (não de memória).
