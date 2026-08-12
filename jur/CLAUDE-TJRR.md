# TJRR — Tribunal de Justiça de Roraima

**Comando:** `./bin/jur tjrr` · **Status:** 🟢 OK (HTTP direto, sem browser)
**Portal:** [`jurisprudencia.tjrr.jus.br`](https://jurisprudencia.tjrr.jus.br) —
"Juris — Sistema de Jurisprudência", aplicação **JSF/PrimeFaces 10**
(`br.jus.tjrr.bpu.*`), renderizada no servidor.
**Mapeado em:** 12/08/2026 · **Human-codegen:** [`human-codegen/TJRR/`](human-codegen/TJRR/INDEX.md)

## Escopo da base

| | |
|---|---|
| Acervo | **126.384 documentos** — 77.128 acórdãos + 49.256 decisões monocráticas |
| Instâncias | 2º grau (Câmaras, Turmas Cíveis, Pleno, cúpula) + **Turma Recursal** |
| 1º grau | ❌ **não tem** sentenças (diferente de TJES, TJPB, TJRO, TJTO) |
| Período | 2018 em diante (2018 = 7.592 … 2025 = 15.346) |
| Vigência | ✅ **corrente** — julgado de 07/08/2026 na primeira página |
| Captcha | ✅ **nenhum**, em etapa nenhuma (busca, listagem e PDF) |

Matéria federal com origem em RR → `trf1`. Trabalhista → `trt11`/`tst`.
Constitucional → `stf`.

## Flags

```bash
./bin/jur tjrr -q "usucapião" -m 2 --json
./bin/jur tjrr -q "dano moral" --origem turmas          # Juizado Especial
./bin/jur tjrr -q "posse" -di 01/01/2026 -df 31/12/2026 # data de JULGAMENTO
./bin/jur tjrr -q "posse" -dpi 01/07/2026 -dpf 31/07/2026 # data de PUBLICAÇÃO
./bin/jur tjrr -n "0841050-24.2023.8.23.0010"           # consulta por processo
./bin/jur tjrr -n "0841050-24.2023.8.23.0010" --datajud # confirma o PROCESSO no CNJ
./bin/jur tjrr -q "usucapião" --fetch-inteiro-teor      # baixa os PDFs
./bin/jur tjrr --listar-filtros                         # 12 órgãos, 257 classes, 43 relatores
```

| Flag | Efeito |
|---|---|
| `-t acordao\|monocratica\|todos` | as duas abas do portal (default `todos`) |
| `--origem turmas\|comum\|ambas` | Turma Recursal × Justiça Comum (default `ambas`) |
| `-oj <valores>` | órgãos crus de `tipoOrgaoList`, separados por vírgula |
| `-c <value>` | "Espécie de Recurso" — **value** do combo, não nome |
| `--ementa <texto>` | campo "Ementa/Indexação" (só casa acórdão) |
| `-di/-df` | data de **julgamento** · `-dpi/-dpf` data de **publicação** |
| `--page-size` | **só 10, 20 ou 30** (o crawler encaixa sozinho) |
| `--verificar N` | baixa o PDF de N resultados e confere |

## Ressalvas — leia antes de responder ao usuário

### 🔴 Só ACÓRDÃO tem ementa
As **49.256 monocráticas** (39% do acervo) vêm com card sem nenhum bloco de
ementa — só processo, relator, órgão e as duas datas. O texto delas existe
apenas no PDF (`--fetch-inteiro-teor`). O crawler marca `semEmenta: true`.
⚠️ E o card da monocrática exibe mesmo assim o botão "Copia a ementa para a área
de transferência" — controle que promete um campo que o documento não tem.

### 🔴 O peso do Juizado varia 94× conforme o tema
`usucapião`: Turma Recursal = 4 de 991 (**0,4%**).
`dano moral`: Turma Recursal = 5.965 de 15.907 (**37,5%**).
Em consumo (dano moral, telefonia, banco, transporte aéreo) **ofereça as duas
origens**; em direito real a Turma Recursal é ruído. Não generalize de outro TJ:
onze tribunais no repo, onze proporções.
✅ A partição por órgão **fecha exata** (as 12 partes somam 991 = o total).

### 🔴 A data FINAL sozinha é ignorada em silêncio
`-df` sem `-di` devolve **o acervo inteiro** com HTTP 200 e número plausível;
`-di` sozinho funciona. Mande sempre as duas pontas. O crawler avisa.
É a lição do TJPI com a metade trocada — lá quem sumia era o início.

### ⚠️ O combo de data diz "TODOS" e filtra julgamento
Sem `tipoProcedimento` a janela filtra **julgamento** (58, igual ao explícito),
não a união com publicação (60). "TODOS" não é os dois.
✅ Em compensação, a base tem **as duas datas, reais, distintas e filtráveis** —
diferente de TJPI (só publicação), TJRO (só julgamento) e TJES (só juntada).

### 🔴 Os operadores são os PORTUGUESES; os ingleses destroem a busca
`E`, `OU`, `NÃO`/`NAO`, `"frase exata"`, `*` e `$` funcionam, com aritmética
exata (`OU` = 28.908 = 27.442 + 17.373 − 15.907; `NÃO` = 11.535 = 27.442 −
15.907). **O espaço entre termos é E (AND).**
`AND` = 4, `OR` = 22, `NOT` = 0, `ADJ` = 4, `PROX` = 1 — viram palavra literal.
⚠️ Aqui `NAO` e `NÃO` são **o mesmo operador**, o que é inédito no repo: o
`onsubmit="normalizar()"` do formulário tira o acento da query inteira.
⚠️ **Não avise sobre acento na query**: duas camadas normalizam (o cliente e o
índice) — `usucapiao`, `usucapião` e até o mojibake `usucapiÃo` dão os mesmos 991.

### 🔴 Linhas por página só aceita 10, 20 ou 30 — fora disso a tabela volta vazia
`_rows` = 3, 5, 15, 25, 31, 40, 50 ou 100 devolve fragmento de **57 bytes**, com
HTTP 200: tabela sem linha nenhuma, sem erro. `--page-size 50` colheria zero em
toda página, o que se lê como fim da lista. O `snapRows()` do Navigator encaixa
o pedido no valor válido — **nunca desligue isso**.

### ⚠️ Valor inventado de filtro é IGNORADO, não recusado
`tipoOrgaoList=XXINVENTADO9Z` e `tipoClasseList=9999` devolvem **o acervo
inteiro** com HTTP 200. O teste do valor inventado (TJMT) não flagra nada aqui —
o que separa "filtra" de "ignorado" é comparar o valor **válido** com o
sem-filtro.

### ✅ Permalink por documento existe; de busca não
`https://jurisprudencia.tjrr.jus.br/pdf?id=<id>` é o **PDF público** do inteiro
teor (200, `application/pdf`, sem cookie, testado em contexto limpo) e
`/inteiroTeor.xhtml?id=<id>` é o visualizador.
🔴 O que identifica o documento é o **`id` do portal**, não o número do processo
— um processo tem vários documentos (o de referência tem 2 acórdãos).
🔴 **A busca não tem URL**: a rota nunca muda. Nunca mande link de busca do TJRR
como prova.

### 🔴 Nem todo documento tem inteiro teor
1 das 10 monocráticas da primeira página de `usucapiao` não tem PDF nenhum. O
crawler a mantém com `id: null` e `semInteiroTeor: true` em vez de descartar —
descartar perderia o julgado em silêncio. Repasse: esse julgado não é baixável.

### ⚠️ Não há citação oficial pronta
Diferente de TJMT, TJPI e TJTO: a citação tem de ser montada dos campos do card
(classe, número, relator, órgão, data de julgamento).

## Consulta por número

O campo é dedicado e aceita **as duas formas** — 20 dígitos e CNJ mascarado
(medido: as duas devolvem os mesmos 2 acórdãos; inventado devolve 0).
⚠️ O placeholder promete também "13 Dígitos - SISCOM" (numeração do sistema
antigo): **não foi possível confirmar um número SISCOM real** — declarado como
NÃO MEDIDO, não como inexistente.

`--datajud` consulta o índice `api_publica_tjrr` do CNJ (372.220 processos,
atualizado em 28/07/2026). ⚠️ Ele confirma que o **processo** existe, nunca que
há julgado: não tem ementa nem inteiro teor.

## Duas coisas que o mapeamento corrigiu no próprio repo

1. **A pista da fila estava errada.** `cobertura/tribunais.json` registra o TJRR
   como PJe + Projudi; o DataJud mostra **99,96% Eproc** (372.073 de 372.220,
   contra PJe 107 e Projudi 40). Sem consequência para o crawler — a
   jurisprudência é aplicação à parte —, mas a pista não vale nada aqui.
2. **`juris.tjrr.jus.br` é armadilha de Passo 0.** É outra aplicação (SPA
   Angular) e responde **HTTP 200 a qualquer path**, inclusive
   `/path-inventado-9z`, sempre com o mesmo `index.html` de ~1,6 KB. Os "200" em
   `/swagger`, `/v3/api-docs` e `/openapi.json` são o fallback do roteador —
   confira o **tamanho** do corpo, como manda a lição do TJES.
   ✅ Não há vhost curinga no host de jurisprudência (`/path-inventado-9z` → 404).

## Pendências declaradas

- Os **43 relatores** estão enumerados em `filtros.json` e expostos no
  `--listar-filtros`, mas **não há flag `-r`** e o filtro **não foi provado por
  contagem** — só se sabe que o `value` é o `toString()` de um objeto Java.
- O caminho **SISCOM (13 dígitos)** não foi medido, por falta de um número real.
- Os módulos irmãos linkados no menu do portal — **Jurisprudência Temática,
  Súmulas, Enunciados, Legislação e Precedentes Obrigatórios** — não foram
  tocados. Nenhum deles tem comando.
- **Rate limit não foi medido** (o Navigator usa 250 ms entre requisições por
  precaução, não por medição).
- Não se mediu se as duas abas **compõem** com o filtro de data (só com órgão,
  classe e termo).
- O botão "Exibir o documento em formato PDF" (`/impressao.xhtml?id=`) foi visto
  respondendo 200 mas **não foi dissecado** — pode ser uma segunda rota de
  documento.
