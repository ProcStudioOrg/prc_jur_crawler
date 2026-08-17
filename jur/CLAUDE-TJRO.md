# TJRO — Tribunal de Justiça de Rondônia

`jur tjro` — portal **JURIS** (`https://juris.tjro.jus.br`), SPA React sobre um
**Elasticsearch exposto quase cru, sem autenticação**. O crawler é **HTTP direto, sem
browser**: o backend `juris-back.tjro.jus.br` responde sem token, sem cookie e **sem
captcha em etapa nenhuma** — enquanto a *tela* está atrás do desafio JS do F5.

- Mapeamento: 09/08/2026 (`parcial`) · crawler fechado em **17/08/2026** pelo slot da
  dívida de crawler.
- Medição bruta: [`human-codegen/TJRO/01-juris/`](human-codegen/TJRO/01-juris/).
- Acervo: **4.027.701 documentos** (17/08/2026), sendo **48% de 1º grau**. Base
  **corrente**: há documento do próprio dia.

## O que este tribunal tem de diferente

✅ **É o maior acervo do repo** — 4,0 milhões de documentos, à frente de TJPB (2,5 mi) e
TJES (2,2 mi).

✅ **É o quarto tribunal do repo com 1º grau**: 1.928.898 sentenças, o maior 1º grau
catalogado. Sentença de 1º grau rondoniense é um pedido que só TJRO, TJPB, TJES e TJTO
atendem.

✅ **O texto do documento já vem na busca**, em HTML, sem captcha e sem request extra —
`--fetch-inteiro-teor` só grava em disco.

🔴 **E três armadilhas que não dão sintoma nenhum.** As duas primeiras fazem o portal
oficial mentir para o próprio usuário.

## 🔴 1. O botão "Turma recursal" devolve Justiça Comum

A tela tem três botões de instância — **Primeiro grau**, **Segundo grau**, **Turma
recursal** — e os dois últimos mandam **o mesmo payload** (`grau_jurisdicao: "2"`). Três
botões, dois valores.

Pior: `grau_jurisdicao: "2"` **exclui** as Turmas Recursais, mesmo com os documentos delas
trazendo `grau_jurisdicao: 2` no próprio `_source`. Provado num documento só:

```
nr_processo 70031613220228220003 (2ª Turma Recursal), sem filtro de grau -> 1 hit
o mesmo número com grau = "2"                                            -> 0 hits
```

**O filtro não filtra pelo campo que diz filtrar.** Não zera e não infla: **troca o
acervo**, com HTTP 200 e resultados plausíveis. É a armadilha mais silenciosa medida neste
repo.

**Por isso o recorte de Juizado é por ÓRGÃO COLEGIADO**, e são **cinco** nomes, não dois
(o mapeamento de 09/08 conhecia só os dois primeiros):

```
1ª Turma Recursal · 2ª Turma Recursal · Turma Recursal ·
Turma Recursal Presidência · Turma de Uniformização … das Turmas Recursais
```

✅ Com eles a partição **fecha exata**, medida em dois temas (17/08/2026, tipo EMENTA):

| Termo | ambas | `--origem comum` | `--origem turmas` | Juizado |
|---|---|---|---|---|
| `dano moral` | 84.840 | 29.166 | 55.674 | **65,6%** |
| `usucapião` | 676 | 673 | 3 | **0,4%** |

🔴 **O peso do Juizado varia 164× conforme o tema.** Em consumo ofereça as duas origens;
em direito real a Turma Recursal é ruído. Não generalize em nenhum sentido.

## 🔴 2. O espaço entre termos é OR, e `NÃO` acentuado infla 24×

Medido em EMENTA, com aritmética fechando exata:

| Query | Total | Veredito |
|---|---|---|
| `usucapião` | 676 | termo isolado |
| `posse` | 9.660 | termo isolado |
| `usucapião posse` (espaço) | 9.881 | 🔴 **espaço = OR** (676 + 9.660 − 455 ✓) |
| `usucapião AND posse` | 455 | ✅ AND funciona |
| `usucapião NOT posse` | 221 | ✅ NOT funciona (676 − 455 ✓) |
| `usucapião E posse` | 9.881 | ⚠️ `E` **ignorado** |
| `usucapião OU posse` | 9.881 | ⚠️ `OU` **ignorado** |
| `usucapião NAO posse` | 9.881 | ⚠️ `NAO` **ignorado** |
| **`usucapião NÃO posse`** | **237.098** | 🔴 **INFLA 24×** |
| `usucapião ADJ/PROX5 posse` | 9.881 | ⚠️ ignorados |
| `"usucapião extraordinária"` | 197 | ✅ frase exata |
| `usucapi*` | 679 | ✅ curinga `*` |
| `usucapi$` | 22 | ⚠️ **`$` DEGENERA**, não zera |
| token inventado | 0 | ✅ sintoma visível |

🔴 **`NÃO` acentuado é a armadilha cara.** Pediu exclusão (esperado 221) e recebeu 237.098
— 68% da base de EMENTA — porque o espaço é OR e "não" é palavra comuníssima em ementa.
**Inflar não dá sintoma**: 237 mil se lê como "tema vastíssimo".

⚠️ Aqui os **ingleses funcionam e os portugueses são ignorados** — igual a TJBA/TJES,
**oposto** de TJPE/TJPI/TJPB. Nono tribunal do bloco, nono conjunto de operadores.

### ✅ O caminho certo: os quatro campos estruturados

A "Pesquisa avançada" tem quatro caixas que dispensam operador, e o crawler as expõe.
Nomes capturados do POST real em 17/08/2026 e **provados por contagem**:

| Flag | Campo da API | Semântica | Medido |
|---|---|---|---|
| `--todas` | `todas_palavras` | AND | 455 |
| `--qualquer` | `quaisquer_palavras` | OR | 9.881 |
| `--excluir` | `sem_palavras` | NOT | 221 |
| `--frase` | `trecho_exato` | frase exata | 197 |

⚠️ **Chave desconhecida em `fields` ZERA a busca em silêncio** (HTTP 200):
`{query:"usucapião", xx_inventado_9z:"posse"}` devolve **0** contra 676. Um zero aqui pode
ser nome de campo errado, não ausência de julgado — nunca chame a API na mão com campo
adivinhado.

## 🔴 3. O mesmo documento é indexado várias vezes

Medido em 17/08/2026 numa página de 100 (`usucapião`, EMENTA): **100 `_id` distintos para
96 documentos reais**. Um caso do processo 7003788-22.2021.8.22.0019 tem **4 cópias** —
mesmo md5, mesma data, mesmo texto, sob `id_processo_documento` diferentes.

**O total do servidor conta as cópias.** O crawler deduplica e publica
`totalDeduplicadoEstimado` — **relate esse número, não o do servidor**.

⚠️ `ds_md5_documento` seria a chave perfeita, mas **falta em 40% dos ACÓRDÃOs** (acervo
legado `SAPSG_ACORDAO`/`SDSG_ACORDAO`); aí o dedup cai para processo + tipo + data +
tamanho do texto. E a estimativa só é publicada com **≥ 20 documentos lidos**: extrapolar
de 3 devolvia 451 onde a amostra de 20 media 642.

## Flags

```bash
./bin/jur tjro -q "usucapião" -t ementa -m 2
./bin/jur tjro --todas "dano moral" --origem turmas        # Juizado / Turma Recursal
./bin/jur tjro --todas "dano moral" --origem comum         # Justiça Comum 2º grau
./bin/jur tjro -q "usucapião" --origem primeiro -t sentenca # 1º grau (sentenças)
./bin/jur tjro -q "usucapião" --excluir "penal" -t ementa   # exclusão de verdade
./bin/jur tjro --frase "usucapião extraordinária"
./bin/jur tjro -q "usucapião" -di 01/01/2024 -df 31/12/2024
./bin/jur tjro -q "usucapião" -t ementa --fetch-inteiro-teor
./bin/jur tjro -n "7009829-15.2024.8.22.0014"              # consulta por número
./bin/jur tjro -q "usucapião" -m 1 --verificar 3           # auditoria
./bin/jur tjro --listar-filtros orgaos_julgadores_colegiados
```

| Flag | O que faz |
|---|---|
| `-q` | Busca livre — ⚠️ **espaço = OR** |
| `--todas` / `--qualquer` / `--excluir` / `--frase` | Os 4 campos estruturados (AND/OR/NOT/frase) |
| `-t` | `todos` (default), `ementa`, `acordao`, `sentenca`, `decisao`, `voto`, `relatorio`, `voto-vencedor` |
| `--origem` | `ambas` (default), `comum`, `turmas`, `primeiro` |
| `--instancia` | `todas` (default), `1`, `2` — ⚠️ grau 2 exclui as TRs |
| `-di` / `-df` | Data de **julgamento** (DD/MM/YYYY) |
| `-dpi` / `-dpf` | Alias que **avisa**: não existe data de publicação |
| `-r` / `-oj` / `--orgao` / `-c` | Relator / colegiado / gabinete / classe — **NOME exato, nunca id** |
| `--listar-filtros [combo]` | Os facets do portal |

## Ressalvas

🔴 **NÃO EXISTE PERMALINK**, nem por documento nem de busca útil. A SPA vive toda em `/` e
não há rota `/documento/<id>`. O link que aparece depois de buscar
(`/?tipo=EMENTA&query=…`) **restaura o formulário mas NÃO executa a busca** — conferido em
aba limpa. É o defeito do TJPE em versão mais branda (lá exibia "Nenhum resultado"; aqui
não mostra nada). **Nunca mande esse link como prova.** A verificação é por reconsulta:
`./bin/jur tjro -n "<nº>"`.

🔴 **A consulta por número quer 20 DÍGITOS, e a TELA pede o formato que a API rejeita.**
O placeholder do campo é `0000000-00.0000.8.22.0000`, com máscara — e a máscara devolve
**0 calado**. O `-n` normaliza sozinho e aceita as duas formas.
⚠️ Um número devolve **vários documentos** do mesmo processo (ementa, acórdão, voto,
relatório, sentença) — quem identifica o julgado é o `_id`, não o número.

🔴 **Só existe data de JULGAMENTO.** `dtpublicacao` veio **null em 20/20** documentos.
`-dpi/-dpf` são alias que avisam. **Nunca apresente a data do TJRO como publicação.**
✅ Em compensação a janela é bem-comportada: restringe de fato (676 → 81 em 2024), as
**duas meias janelas funcionam sozinhas** (318 e 439, com 318 + 439 − 81 = 676 exato), a
janela no-op não altera nada, e formato errado dá **HTTP 500 honesto** — não o parse MM/DD
silencioso do TJMT.

🔴 **O tipo `DECISÃO DA PRESIDÊNCIA` sumiu.** Tinha 56.676 documentos em 09/08/2026 e
devolve **0** em 17/08/2026 — saiu do facet e da base. No mesmo intervalo o acervo total
**encolheu** 51.697 (4.079.398 → 4.027.701), em vez de crescer. Esse zero é
reclassificação do tribunal, **não ausência de jurisprudência**.

⚠️ **O tipo do documento É a natureza do texto.** `EMENTA` é ementa (1,5–2,5 mil chars);
`ACÓRDÃO`, `SENTENÇA`, `VOTO`, `RELATÓRIO` e `DECISÃO` trazem a peça inteira (4,5–12,7 mil
chars). O crawler marca `semEmenta` em tudo que não é EMENTA — **não apresente esse texto
como ementa**. Para ementa, `-t ementa`.

⚠️ **O default da tela é `EMENTA`, que é só 8,7% da base** — quem copiar o payload da SPA
mede 348.459 achando que mediu 4 milhões. O default do crawler é `-t todos`.

✅ **Acento na query não importa** — o índice normaliza (`usucapiao` = `usucapião` = 676).
O acento só importa no operador `NÃO`, que é justamente o quebrado.

✅ **O acento do TEXTO é integralmente recuperável.** ⚠️ Isto **corrige o mapeamento de
09/08**, que registrou que "o corpo já perdeu os acentos na origem (`Apelao`, `sentena`) e
não há como recuperar". Não é o caso: o HTML cru é
`Apela&ccedil;&atilde;o interposta contra senten&ccedil;a` e **não tem um único byte
não-ASCII** — aquele `Apelao` era artefato de um strip ingênuo. O crawler decodifica, e a
decodificação é **sensível à caixa** (`&Ccedil;` ≠ `&ccedil;`).

⚠️ **Total exato e teto de 10.000 convivem.** A contagem vem `relation: "eq"`, sem a
saturação do TJPE — mas `from` acima de 10.000 devolve HTTP 500 (`max_result_window` do
Elasticsearch). Para varrer acervo grande, recorte por data ou por tipo.

⚠️ **Todos os filtros querem NOME, nunca id.** `ds_nome.raw` com id devolve 0;
`ds_classe_judicial.raw` com código devolve 0. Use `--listar-filtros`.

## 🔴 O WAF — três barreiras diferentes

1. **STIC bloqueia por User-Agent** — e responde **HTTP 200** com a página de bloqueio, não
   403. Quem olhar só o status conclui que o portal está no ar e a busca veio vazia.
   Confira o corpo. Resolve com UA de Chrome real (o Navigator já manda).
2. **F5/BIG-IP (TSPD) na TELA, não na API.** `juris.tjro.jus.br` devolve JS ofuscado; o
   backend não. É o mesmo desafio do TJSC, e não é captcha — resolve sozinho no Playwright
   com `--disable-blink-features=AutomationControlled` e loop de `goto`. **O crawler não
   precisa dele.**
3. 🔴 **RATE LIMIT POR IP QUE MENTE NO PROTOCOLO HTTP.** Passando de ~35 requisições sem
   pausa, o WAF responde com HTTP **malformado** (um byte `\x00` antes dos headers). O
   parser do Node rejeita antes de entregar status, e o que chega ao código é
   `HPE_INVALID_HEADER_TOKEN` — **um erro de rede genérico, não um 429**. Um crawler
   ingênuo lê isso como instabilidade e retenta em loop, prolongando o bloqueio, que dura
   **~12 minutos** e **não é destravado por cookie** (é por IP).
   **Por isso o throttle de 1,2 s não é otimização.** O Navigator traduz o erro na causa
   real e para em vez de insistir.

## Verificação

Não há permalink, então a prova é a reconsulta:

```bash
./bin/jur tjro -n "7009829-15.2024.8.22.0014"
./bin/jur tjro -q "usucapião" -m 1 --verificar 5
```

⚠️ Ausência aqui **não** prova que o processo não existe — prova que não há documento
indexado na base de jurisprudência. Para existência de processo, o caminho é o **DataJud**
(`api_publica_tjro`, medido respondendo em 09/08/2026; sem ementa e sem inteiro teor).

## Testes

```bash
node src/TJROTestes.js        # 14 testes de integração, contra a API real
node tests/smoke.js tjro
```

## Pendências declaradas

- As opções do combo **Ordenação** não foram enumeradas (só o default "Relevância"), e não
  se mediu se `sort` por `dtjulgamento` muda o total.
- **Não se sabe por que o acervo encolheu** 51.697 documentos entre 09/08 e 17/08, nem se a
  saída de `DECISÃO DA PRESIDÊNCIA` explica tudo (56.676 ≠ 51.697).
- O rate limit tem gatilho (~35 req sem pausa) e duração (~12 min) medidos, mas **não se
  sabe se é cota fixa ou janela deslizante**.
- Os **módulos irmãos não foram mapeados**, todos linkados no mapa do site oficial:
  súmulas, caderno de ementas, repositório de jurisprudência, precedentes/NUGEPNAC.
- `-r` (relator) e `-c` (classe) foram provados por contagem **num valor só** cada.
