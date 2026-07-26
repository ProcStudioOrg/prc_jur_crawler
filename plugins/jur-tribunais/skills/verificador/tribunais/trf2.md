<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TRF2 — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TRF2. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TRF2 sem confirmar que ele existe na base oficial.
Toda verificação usa o `TRF2Checker`, que reproduz o campo "Processo" (`#txtProcesso`) do
módulo de jurisprudência do e-Proc
(`eproc.trf2.jus.br/eproc/...jurisprudencia@jurisprudencia/pesquisar`).

## Antes de tudo: a base só tem 2º grau e só a partir de 2018

| | |
|---|---|
| Cobertura | 2º grau (TRF2, Turmas Recursais, TRU2). **Não há sentenças de 1º grau.** |
| Início do acervo | **2018**. Julgado de 2015 não está aqui — e não está em lugar nenhum: o portal antigo (`juris.trf2.jus.br`) foi desativado e a Jurisprudência Unificada do CJF está **vazia** para o TRF2 |

Se um julgado do TRF2 anterior a 2018 aparecer numa petição ou num texto, o `-n` vai
devolver `encontrado: false` — e isso **não prova** que o julgado não existe; prova que
não está nesta base. Diga exatamente isso, não "o julgado não existe".

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur trf2`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- O TRF2 usa o segmento **`.4.02.`** (Justiça Federal = 4, tribunal = 02) —
  `cnj.pertenceA(n, 4, 2)`. Segmento diferente = não é TRF2, pare aqui.
- DV inválido é **AVISO, não veto**. A prova é o passo 2.
- Há números com sequencial antigo mas máscara CNJ (`0085909-79.2016.4.02.5101`) —
  são legítimos, vêm de processos migrados.

### 2. Confirmar na base oficial

```bash
./bin/jur trf2 -n "5081315-58.2021.4.02.5101" --json
```

A consulta é feita com as **três origens marcadas** de propósito: o julgado pode ser do
TRF2, das Turmas Recursais ou da TRU2, e a verificação não deve depender de acertar isso
antes.

- `encontrado: true` → o array `decisoes` traz `id` (o identificador do **documento**),
  `tipoDocumento`, `orgaoJulgador`, `classe`, `relator`, `uf`, datas, `processoUrl`
  (consulta processual pública no e-Proc) e a ementa.
- `encontrado: false` (exit code 1) → **não está** na base de jurisprudência. Não cite.
  (Pode existir no e-Proc sem estar indexado na jurisprudência — diga isso explicitamente,
  e lembre do corte de 2018.)
- Custo: ~0,5 s. Este tribunal é HTTP puro, sem browser e sem bloqueio anti-bot.

⚠️ **Por que o Checker manda um `*` junto do número.** O portal exige texto em
`#txtPesquisa`: com o campo vazio, qualquer processo — mesmo existente — devolve
0 documentos, sem erro. O `*` casa com a base inteira e não restringe nada. Se alguém
consultar o site na mão só com o número e não achar, **não é ausência do julgado**.

**Um processo pode ter várias decisões** (acórdão + monocrática + despacho da
Vice-Presidência). Verificar o número prova que o processo existe; para provar que
**aquela decisão** existe, confira o `id` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur trf2 -q "tema" --verificar 5 --json
```

Reamostra N resultados, reconsulta cada processo por número e confirma que o mesmo `id`
retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir que o recorte foi o pedido (específico do TRF2)

Chamar de "acórdão do TRF2" um julgado de Turma Recursal (Juizado Especial Federal) é erro
material — muda a instância, o rito e a força do precedente. Dois campos da saída resolvem:

| campo | Justiça Federal comum (2º grau) | Juizados / Turmas Recursais |
|---|---|---|
| `orgaoJulgador` | `1ª TURMA ESPECIALIZADA`, `2A. SEÇÃO ESPECIALIZADA`, `Vice-Presidência` | `2ª TURMA RECURSAL DO RIO DE JANEIRO`, `1ª TURMA RECURSAL DO ESPÍRITO SANTO` |
| `origemProcesso` / `sufixoOrigem` (depois da `/` no nº) | `TRF2` | `RJ` / `ES` |

⚠️ **O `tipoDocumento` NÃO distingue origem no TRF2** (é "Acórdão" nos dois) — diferente do
TJSC, onde ele resolve sozinho. Use o órgão julgador e o sufixo.

O `--json` de uma busca também traz `origemAplicada`, com o rótulo do que foi de fato
enviado ao combo.

### 5. Fonte secundária: DataJud (CNJ)

```bash
./bin/jur trf2 -n "5081315-58.2021.4.02.5101" --datajud --json
```

Acrescenta o bloco `datajud` com metadados do processo (classe, órgão julgador, grau,
movimentos) vindos da API pública do CNJ. Serve para separar dois casos quando o passo 2
devolve `encontrado: false`:

- DataJud `encontrado: true` → **o processo existe** no TRF2, mas não há documento
  indexado na jurisprudência. Diga isso; não cite decisão.
- DataJud `encontrado: false` → nem o processo aparece. Sinal forte de número inventado.

⚠️ O DataJud **não tem ementa nem inteiro teor** — nunca use para confirmar o **teor** de
uma decisão. E é instável: em 5 chamadas seguidas, 3 devolveram erro. `disponivel: false`
significa "a API falhou", **não** "o processo não existe".

### 6. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa`/`citacao` retornado (no TRF2 a
ementa vem **inteira** no resultado, inclusive nas Turmas Recursais) ou baixe o inteiro
teor (`--fetch-inteiro-teor`) e cite a partir do arquivo salvo.

## Armadilha de busca que produz falso "não existe"

Se você foi procurar o julgado por **termo** antes de procurar por número, lembre da
ressalva nº 1 do `CLAUDE-TRF2.md`: **espaço entre termos quebra a busca neste portal**
(`dano moral` = 46 documentos; `dano-moral` = 20.201). O `./bin/jur trf2` conserta isso
sozinho — mas uma busca feita na mão no site, ou com `--literal`, vai parecer que o
julgado sumiu. Não conclua ausência a partir de uma busca por termo; conclua pelo `-n`.

## Critério de aprovação

Um julgado só entra em resposta final se: número no segmento `.4.02.` **e**
`encontrado: true` **e** o `id` da decisão citada está na lista devolvida **e** a
atribuição Justiça Federal comum × Turma Recursal confere no `orgaoJulgador` e no sufixo
de origem **e** a ementa citada veio do texto da base (não de memória).
