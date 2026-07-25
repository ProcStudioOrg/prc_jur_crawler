<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJGO — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJGO. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJGO sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJGOChecker` (consulta direta pelo campo "Número do Processo"
do Novo Módulo de Pesquisa de Jurisprudência do PROJUDI).

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur tjgo`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline, instantâneo)

Validação CNJ é genérica para todos os tribunais: `src/cnj.js`.

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- TJGO exige segmento `.8.09.` (Justiça Estadual, tribunal 09) — `cnj.pertenceA(n, 8, 9)`.
  Outro segmento = não é TJGO. Pare aqui.
- Dígito verificador inválido é **AVISO, não veto** (numerações convertidas de
  sistemas legados podem não fechar o DV). A prova definitiva é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjgo -n "<numero-cnj>" --json
```

- `encontrado: true` → o array `atos` traz idArquivo, tipo, classe, órgão julgador,
  magistrado, datas e um trecho do texto de cada ato publicado do processo.
- `encontrado: false` (exit code 1) → o processo **não tem atos publicados** na base
  de jurisprudência. Não cite. (Pode existir no PROJUDI sem publicação indexada —
  diga isso explicitamente.)

### 3. Auditar buscas em lote

Ao rodar uma pesquisa que alimentará um relatório, adicione `--verificar [N]`:

```bash
./bin/jur tjgo -q "tema" --verificar 5 --json
```

O checker reamostra N resultados, reconsulta cada processo por número e confirma que o
mesmo `idArquivo` retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie decisão de memória. O texto completo do ato já vem na busca:
use o campo `ementa` (10k chars) ou rode com `--full-text` (campo `inteiroTeor`)
e cite a partir do texto retornado. `--fetch-inteiro-teor` grava os .txt em disco.

## Critério de aprovação

Um julgado só entra em resposta final se: segmento `.8.09.` **e** `encontrado: true`
**e** o trecho citado veio do texto retornado pela base (não de memória).
