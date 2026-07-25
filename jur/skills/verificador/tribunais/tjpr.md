# TJPR — referência de verificação

> Referência da skill [`jur-verificador`](../SKILL.md). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJPR. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJPR sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJPRChecker`, que reproduz o campo "NUMERAÇÃO PROCESSUAL"
(`processo`) da tela oficial — uma consulta direta, sem termo de busca e sem data.

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur tjpr`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- CNJ do TJPR é o segmento `.8.16.` (Justiça Estadual = 8, tribunal = 16) —
  `cnj.pertenceA(n, 8, 16)`. Outro segmento = não é TJPR, pare aqui.
- O acervo tem numeração **anterior à Resolução CNJ 65/2008** e números próprios de
  acórdão; para esses o dígito verificador não se aplica (`formatoCNJ: false`,
  `numeroValido: null`). **Não descarte** o julgado por isso.
- DV inválido em número CNJ é **AVISO, não veto**. A prova é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjpr -n "0003249-43.2020.8.16.0193" --json
./bin/jur tjpr --acordao <numero> --json
node src/TJPRChecker.js "0001992-51.2025.8.16.0146"      # mesma consulta, saída completa
```

A consulta é feita com `ambito=-1` (todas as bases) e **sem filtro de foro**, de
propósito: o julgado pode estar na Justiça Comum ou nas Turmas Recursais, e verificar
existência não pode depender de acertar isso antes.

- `encontrado: true` → o array `decisoes` traz `id` (id do **documento**), tipo,
  órgão julgador, **`foro`** (`comum` | `juizados`, classificado pelo órgão), relator,
  data de julgamento, `processoUrl` e a ementa. `foros` resume os foros encontrados.
- `encontrado: false` (exit code 1) → **não está** na base de jurisprudência. Não cite.
  Pode existir no Projudi sem estar indexado na jurisprudência — diga isso explicitamente,
  não afirme que "o processo não existe".
- Exemplos reais medidos em 25/07/2026:

  ```
  0003249-43.2020.8.16.0193  -> encontrado, 1 documento, 1ª Câmara Cível,   foro comum
  0001992-51.2025.8.16.0146  -> encontrado, 2 documentos, 3ª Turma Recursal, foro juizados
  1234567-89.2020.8.16.0001  -> NÃO encontrado (número inventado, DV inválido), exit 1
  9999999-99.2099.8.99.9999  -> NÃO encontrado, exit 1
  ```

**Um processo tem vários documentos** (acórdão, decisão monocrática, dúvida de
competência). Verificar o número prova que o processo tem julgado; para provar que
**aquele documento** existe, confira o `id` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur tjpr -q "tema" --foro juizados --verificar 5 --json
```

Reconsulta N processos amostrados e confere se o mesmo `id` volta da base. A saída traz
`verificados`, `confirmados`, `divergentes` e, por item, `avisoDV` (DV que não fecha /
numeração antiga) e `avisoForo` (quando o órgão devolvido não corresponde ao foro que a
busca alegou — isso denunciaria filtro mal aplicado).

### 4. Confirmar o texto antes de citar

```bash
./bin/jur tjpr -q "tema" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjpr
```

O `.txt` gravado traz a **citação oficial** pronta, extraída da própria ficha do julgado
("Ementa pré-formatada para citação"):

```
(TJPR - 4ª Turma Recursal - 0000270-85.2026.8.16.0068 - Chopinzinho -
 Rel.: JUIZ DE DIREITO DA TURMA RECURSAL DOS JUIZADOS ESPECIAIS FERNANDO SWAIN GANEM -
 J. 24.03.2026)
```

Prefira essa string à sua própria formatação. Documentos antigos ou só com imagem vêm
com `temInteiroTeor: false` — a ementa continua válida, o inteiro teor não existe em texto.

## Armadilhas específicas do TJPR

- **Contador inflado**: o total que a tela mostra em destaque soma as decisões da **Corte
  Interamericana de Direitos Humanos** (acervo internacional hospedado pelo TJPR), que
  aparecem até em consulta por número. Use `totalTJPR`, nunca o contador geral. O
  Checker já descarta essas linhas.
- **Nunca conclua "não existe" a partir de uma busca por termo**: o termo pode não estar
  na ementa. A prova de existência é a consulta por número (`-n`).
- **Justiça Comum × Juizados**: não confie no combo do site (`--base`); ele deixa Turma
  Recursal dentro da base "TRIBUNAL DE JUSTIÇA". O campo `foro` das `decisoes` é
  derivado do órgão julgador e é o que vale. Ver ressalva 2 de `CLAUDE-TJPR.md`.
- **Permalink citável**: `processoUrl` = `https://portal.tjpr.jus.br/jurisprudencia/j/<id>/<slug>`.
  Sem o slug depois do id a URL devolve 404 — se for montar à mão, use `/documento`.
