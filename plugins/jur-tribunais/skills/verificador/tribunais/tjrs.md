<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJRS — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJRS. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJRS sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJRSChecker`, que reproduz o filtro "Número do Processo" da tela
oficial (`filtroNumeroProcesso` → cláusula Solr `numero_processo:<dígitos>`).

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur tjrs`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline) — mas cuidado: metade do acervo é pré-CNJ

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- Número **em formato CNJ** (20 dígitos): o TJRS usa o segmento `.8.21.` (Justiça
  Estadual, tribunal 21) — `cnj.pertenceA(n, 8, 21)`. Outro segmento = não é TJRS, pare aqui.
- Número **legado (Themis)**: boa parte da base é pré-CNJ — `70084452564`, `591059829`,
  e até números de 5 dígitos (`25953`). Para esses o dígito verificador **não se aplica**:
  o checker devolve `formatoCNJ: false` e `numeroValido: null`. **Não descarte** o julgado
  por isso.
- DV inválido em número CNJ é **AVISO, não veto**. A prova é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjrs -n "5263607-16.2024.8.21.0001" --json
./bin/jur tjrs -n 70084452564 --json
```

A consulta é feita **sem filtro de tribunal** de propósito: o julgado pode estar na
Justiça Comum, no acervo do Tribunal de Alçada ou nas Turmas Recursais.

- `encontrado: true` → o array `decisoes` traz `id` (= `cod_ementa`), tipo de decisão,
  **tribunal** (é aqui que se descobre se é Justiça Comum ou Turma Recursal),
  órgão julgador, relator, datas, `processoUrl` e a ementa.
- `encontrado: false` (exit code 1) → **não está** na base de jurisprudência. Não cite.
  (Pode existir no e-Proc sem estar indexado na jurisprudência — diga isso explicitamente.)
- `total` maior que o nº de `decisoes` só acontece acima de 10 julgados no mesmo processo
  (a página é fixa em 10).

**Um processo tem várias decisões** (monocrática, acórdão, admissibilidade). Verificar o
número prova que o processo existe; para provar que **aquela decisão** existe, confira o
`id` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur tjrs -q "tema" --verificar 5 --json
```

O checker reamostra N resultados, reconsulta cada processo por número e confirma que o
mesmo `id` retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir que o recorte foi o pedido (específico do TJRS)

O `--json` de qualquer busca traz `filtroSolr`, a cláusula que o servidor realmente montou.
Use-a como prova do recorte antes de rotular os julgados:

```
" AND cod_tribunal:3 AND data_julgamento:[2026-01-01T00:00:00Z TO 2026-06-30T23:59:59Z]"
```

- `cod_tribunal:3` → **Justiça Comum** (Tribunal de Justiça do RS)
- `cod_tribunal:6` → **Juizados Especiais** (Turmas Recursais)
- sem `cod_tribunal:` → veio tudo junto; **não** afirme que é de um ou de outro.

Chamar de "acórdão do TJRS" um julgado de Turma Recursal (ou vice-versa) é erro material,
e é o erro mais fácil de cometer neste tribunal.

### 5. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa` retornado ou baixe o inteiro teor
(`--fetch-inteiro-teor`, que não faz nova requisição) e cite a partir do arquivo salvo.

## Critério de aprovação

Um julgado só entra em resposta final se: número compatível com o TJRS (`.8.21.` quando for
CNJ; numeração legada aceita) **e** `encontrado: true` **e** o `id` da decisão citada está na
lista devolvida **e** a atribuição Justiça Comum × Turma Recursal confere com o `tribunal`
retornado **e** a ementa citada veio do texto da base (não de memória).
