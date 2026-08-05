<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TRF4 — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TRF4. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TRF4 sem confirmar que ele existe na base oficial.
Toda verificação usa o `TRF4Checker`, que dirige o módulo de jurisprudência do eproc
(`eproc-jur.trf4.jus.br/eproc2trf4/...jurisprudencia@jurisprudencia/pesquisar`) por
**browser** (Playwright headless) — este portal tem um pool de backends instável e o
crawler carrega o retry certo.

## Antes de tudo: custo e transporte

| | |
|---|---|
| Transporte | **Browser** (única exceção entre os Checkers federais — TRF2/TRF6 são HTTP) |
| Custo | **15–25s por sessão.** O `-n` avulso abre e fecha uma sessão; o `--verificar N` reusa UMA sessão para a amostra inteira |
| Backends | 503 e certificado expirado intermitentes = backend ruim do pool, **não** ausência do julgado. O erro manda repetir — repita |

## Quando aplicar

1. Antes de entregar ao usuário uma lista de julgados vinda de `jur trf4`.
2. Sempre que um número de processo vier de fonte externa (petição, texto, outro modelo).
3. Quando houver suspeita de resultado alucinado ou desatualizado.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- O TRF4 usa o segmento **`.4.04.`** (Justiça Federal = 4, tribunal = 04) —
  `cnj.pertenceA(n, 4, 4)`. Segmento diferente = não é TRF4, pare aqui.
- DV inválido é **AVISO, não veto**. A prova é o passo 2.
- O sufixo `/TRF4` que o portal exibe depois do número é tolerado pelo Checker
  (e ignorado na comparação — ele contém o dígito 4 e corromperia a igualdade).

### 2. Confirmar na base oficial

```bash
./bin/jur trf4 -n "5001471-45.2023.4.04.7005" --json
```

A consulta marca as **duas origens** de propósito (acervo principal + Turmas Recursais):
a verificação não deve depender de acertar onde o julgado está.

- `encontrado: true` (exit 0) → o array `decisoes` traz `tipoDocumento`,
  `orgaoJulgador`, `relator`, `uf`, datas, `processoUrl` e a ementa.
- `encontrado: false` (exit 1) → **não está** na base de jurisprudência. Não cite.
- Erro "a listagem não pôde ser lida … repita a consulta" → é o pool de backends,
  **não** ausência do julgado. Repita; nunca conclua inexistência de um erro.

⚠️ **O número vira busca de texto livre no inteiro teor**: o portal pode devolver
cards de OUTROS processos que apenas citam o número (medido em 05/08/2026: 5 cards,
4 do processo). O Checker filtra por igualdade de dígitos do `numeroProcesso` — se
você consultar o site na mão, faça a mesma conferência antes de concluir qualquer coisa.

**Um processo pode ter várias decisões** (acórdão + monocrática + despacho da
Vice-Presidência — o processo-fixture tem os três tipos). Verificar o número prova que
o processo existe; para provar que **aquela decisão** existe, confira `tipoDocumento` +
`dataJulgamento` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur trf4 -q "tema" --verificar 5 --json
```

Reamostra N resultados, reconsulta cada processo por número (numa única sessão de
browser) e confirma que um documento com a mesma tupla `numeroProcesso + tipoDocumento +
dataJulgamento` retorna. ⚠️ **Não é por `id`**: o `id` dos cards repetiu entre duas
consultas medidas (05/08/2026), mas o formato (`resultado<35 dígitos>`) não é documentado
— a tupla é o critério estável. `confirmados < verificados` → investigue antes de usar.

### 4. Fonte secundária: DataJud (CNJ)

```bash
./bin/jur trf4 -n "5001471-45.2023.4.04.7005" --datajud --json
```

Acrescenta o bloco `datajud` (índice `api_publica_trf4`) com metadados do processo.
Serve para separar dois casos quando o passo 2 devolve `encontrado: false`:

- DataJud `encontrado: true` → **o processo existe** no TRF4, mas não há documento
  indexado na jurisprudência. Diga isso; não cite decisão.
- DataJud `encontrado: false` → nem o processo aparece. Sinal forte de número inventado.

⚠️ O DataJud **não tem ementa nem inteiro teor** — nunca use para confirmar o **teor**
de uma decisão. `disponivel: false` significa "a API falhou", **não** "não existe".

### 5. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa` retornado ou baixe o inteiro
teor (`--fetch-inteiro-teor` na busca) e cite a partir do arquivo salvo.

## Critério de aprovação

Um julgado só entra em resposta final se: número no segmento `.4.04.` **e**
`encontrado: true` **e** a decisão citada casa por `tipoDocumento` + `dataJulgamento`
na lista devolvida **e** a ementa citada veio do texto da base (não de memória).
