# TCE-SC — Tribunal de Contas do Estado de Santa Catarina

**Comando:** `./bin/jur tcesc` · **Status:** 🟢 OK · **Acesso:** `api` (GraphQL público, sem browser)
**Portal:** `https://virtual.tce.sc.gov.br/jurisprudencia/jurisprudencia`
**Endpoint:** `https://api.virtual.tce.sc.gov.br/api-gateway/ms-jurisprudencia/graphql`
**Mapeamento:** [`human-codegen/TCESC/01-jurisprudencia/`](human-codegen/TCESC/01-jurisprudencia/)

## Escopo — leia antes de oferecer

É **controle externo, não Judiciário**. A matéria é contas públicas, licitação,
contrato administrativo, ato de pessoal, tomada de contas e representação.
**Pedido cível, penal, trabalhista ou previdenciário não tem resposta aqui** — e o
zero seria o tribunal errado, não ausência de julgado. Para a mesma matéria
judicializada, o caminho é `tjsc` (estadual) ou `trf4` (federal).

✅ **Santa Catarina NÃO tem TCM.** O TCE-SC fiscaliza o Estado **e os 295
municípios**. A armadilha do Bloco 5 ("procure o TCM") vale para SP, RJ, BA, GO e
PA — **não para SC**.

🔴 **Não existe número CNJ nem DataJud.** O processo é `<SIGLA> <AA>/<sequencial>`
(ex. `REP 26/00137305`); `src/cnj.js` não se aplica, e o DataJud cobre o
Judiciário. Não há plano B se o portal cair.

**Base:** 27.783 documentos, **corrente** (documento de 03/08/2026), distribuição
estável por ano (2015=1.494 … 2025=1.523).

## Exemplos

```bash
./bin/jur tcesc -q "\"merenda escolar\"" -m 2
./bin/jur tcesc -q "nepotismo" --ordenacao recentes --fetch-inteiro-teor
./bin/jur tcesc -q "licitação" --eixo-data autuacao -di 01/01/2025 -df 31/12/2025
./bin/jur tcesc -n "REP 26/00137305"
./bin/jur tcesc --base enunciados -q "dispensa de licitação"
./bin/jur tcesc --base informativos -q "servidor"
./bin/jur tcesc --base sumulas
./bin/jur tcesc --listar-filtros
```

## Flags específicas

| Flag | O que faz |
|---|---|
| `--base` | `deliberacoes` (default) \| `enunciados` \| `informativos` \| `sumulas` |
| `--abrangencia` | `inteiro-teor` (default) \| `ementa` |
| `--ordenacao` | `relevancia` (default) \| `recentes` \| `antigos` |
| `--singular` | `so` \| `sem` — recorta as "Decisões Singulares Ratificadas por Colegiado" |
| `--eixo-data` | `autuacao` (default, **única completa**) \| `sessao` \| `publicacao` |
| `-r`, `-t`, `-u` | relator / tipo de processo / unidade gestora, por **id** (`--listar-filtros`) |
| `--refinamento` | texto de refinamento dentro do resultado |
| `--fetch-inteiro-teor` | baixa o PDF público (1 GET por documento) |

## Ressalvas — todas medidas, todas com HTTP 200

🔴 **O ESPAÇO ENTRE TERMOS É `OR`, E NÃO EXISTE `AND`.** Provado por aritmética:
merenda=497, escolar=4.774, `merenda escolar`=4.783 → interseção 488, e
`"merenda escolar"`=446. **Query de duas palavras devolve a UNIÃO**, e o número
grande é o termo mais comum, não abundância de jurisprudência.

🔴 **NENHUM operador booleano funciona.** `E`, `OU` e `OR` são **ignorados**;
`AND` (9.631), `NOT` (9.493) e `NAO` (26.057) viram **palavra e INFLAM** — e
inflar não dá sintoma. O **único** recurso real é a **frase exata entre aspas**
(1.821 contra 10.725). Décimo conjunto de operadores do repo e o mais pobre: para
exigir dois termos, só a frase exata. O crawler avisa; repasse.

🔴 **CURINGA NÃO EXISTE**: `licita*`, `licita$` e `licita?` devolvem 608 — o mesmo
que `licita` sozinho e muito menos que `licitação` (9.368). O caractere é
descartado em silêncio, sem expansão de prefixo.

🔴 **TERMO COM MENOS DE 3 CARACTERES É DESCARTADO E DEVOLVE O ACERVO INTEIRO.**
`ab` e `de` devolvem os 27.783 do acervo, com HTTP 200. A tela anuncia "mínimo 3
caracteres" e o servidor **não recusa: ele ignora o termo**. É o zero-invertido
mais perigoso do repo — um typo curto devolve "27.783 resultados" em vez de erro.
**Nunca relate esse total como resultado da busca.**

✅ **NÃO avise sobre acento** — o índice normaliza (`licitacao` = `licitação` = 9.368).

🔴 **A EMENTA QUASE NUNCA EXISTE, e o que vem no lugar é um SNIPPET.** O campo
`ementa` volta null na maioria dos documentos; o texto exibido é `votoTexto`, que
é o **trecho onde o termo casou** (começa no meio da frase). O crawler o guarda em
`trechoMatch` e marca `semEmenta`. **Não apresente esse texto como ementa nem como
acórdão inteiro** — para o texto integral, `--fetch-inteiro-teor`.

🔴 **AS TRÊS DATAS TÊM COBERTURAS MUITO DIFERENTES, e escolher a errada apaga a
maior parte do acervo em silêncio.** Medido em `licitação` (9.368):
**autuação = 100%** (a aritmética fecha exata), **publicação ≈ 79%**,
**sessão ≈ 37%** — filtrar por sessão descarta **63%** sem sintoma nenhum.
O default é `--eixo-data autuacao`. O crawler avisa nos outros dois.
✅ As **duas pontas funcionam sozinhas** (diferente do TCE-PR, onde a inicial
zerava e a final era ignorada), aceita `DD/MM/YYYY` e `YYYY-MM-DD`, e data
inválida dá **erro visível**, não zero calado.

🔴 **A CITAÇÃO PRONTA CHAMA `dataDecisao` DE "Sessão"** — num documento cujo
`dataSessao` é **null**. O rótulo mente (lição do TJES). **Nunca apresente a data
da citação do TCE-SC como data de sessão** sem conferir o campo. E quando
`numeroDecisao` é null a citação sai quebrada (`Decisão n. ,`): o crawler marca
`citacaoSuspeita`.

🔴 **`--singular` NÃO PARTICIONA A BASE, e o nome engana.** true=1.787 +
false=25.497 = 27.284 contra **27.783** (499 fora); com `licitação`,
5.864 + 1.588 = 7.452 contra **9.368** (1.916 fora). Os de fora têm
`decisaoSingular: null` e **são** decisões singulares. O que `so` seleciona é a aba
"Ratificadas por Colegiado". **Omitir a flag devolve um superset que a própria
tela nunca mostra** — as abas do portal somam menos que a API.

⚠️ **O PORTAL TEM 5 BASES, EM TRÊS BACKENDS — e o comando cobre as cinco.**
`--base deliberacoes` (default) traz Deliberações e Votos + Decisões Singulares
Ratificadas, do GraphQL; `--base enunciados` (2.564) e `--base informativos`
(2.045) vêm do REST `servicos.tcesc.tc.br/cojur/…`; e `--base sumulas` é servida
do bundle. **Escolher a base errada devolve zero que não é ausência de julgado** —
`licitação` dá 9.368 em deliberações, 352 em enunciados e **0** em informativos e
súmulas.
🔴 **A base de SÚMULAS não é uma consulta: são 4 registros embutidos no JavaScript
do portal** (`Imt_sumulas`), filtrados em memória — e **2 deles são o mesmo
documento** (ids 1 e 2, ambos "Súmula N. TC-003/2021"), ou seja **3 súmulas
distintas em todo o TCE-SC**. Não existe endpoint (`/cojur/sumula` → 404). O
arquivo fica em `human-codegen/TCESC/01-jurisprudencia/sumulas-bundle.json` e
**envelhece com o deploy do portal, não com a base** — é o único dado do repo que
não é consultado ao vivo.
🔴 **Enunciado de consulta tem VIGÊNCIA**: o campo `st_valido` diz se ainda está em
vigor, e um revogado continua na base. O crawler expõe `vigente` e avisa quantos
não são — **não cite enunciado revogado como orientação atual**.
⚠️ **A regra dos 3 caracteres é do CLIENTE e vale diferente em cada backend**: no
GraphQL um termo curto é descartado e devolve o acervo inteiro; no `prejulgado`
ele **é aplicado** (`ab` = 289 de 2.564). Mesma tela, comportamentos opostos.

⚠️ **`numeroProcesso` com valor não-numérico é IGNORADO** e a busca devolve o
acervo inteiro (`abc` → 27.783). O Checker só deixa passar dígito.

⚠️ **O número que a tela exibe não é o que a API aceita**: o card imprime
`REP 26/00137305` e o campo quer `2600137305`. O `-n` aceita as duas formas e
normaliza. Some à coleção: TJPE só dígitos, TJES só máscara, TJPI derruba com 500,
TJMT aceita as duas, TCE-PR quer partido em dois campos.

✅ **Inteiro teor é PDF público com permalink** (`documentos[].linkPublico`, em
`storage.tce.sc.gov.br`), confirmado em **requisição limpa**, e começa com `%PDF`
— aqui o magic number **vale**, ao contrário do TCE-PR (envelope PKCS#7).
🔴 **Mas não há permalink de BUSCA** — a rota do SPA não muda. Nunca mande "o link
da busca" do TCE-SC como prova.
🔴 **Quem identifica o julgado é o `identificadorDocumento`**, não o número do
processo (um processo rende vários documentos).

⚠️ **Duas armadilhas de infraestrutura, para quem for reabrir o mapeamento:**
o TCE-SC tem **dois domínios oficiais** (`tcesc.tc.br` institucional,
`tce.sc.gov.br` sistemas) e o portal está no segundo; e `virtual.tce.sc.gov.br`
devolve **200 com 5.994 bytes para qualquer path** (SPA), com **md5 diferente a
cada requisição** porque o Akamai injeta um nonce — **a técnica de comparar md5
não desfaz este falso positivo**; compare o tamanho.

## Pendências declaradas

`-r`, `-t` e `-u` estão expostos mas **não provados por contagem**.
`numerosProcessoHibrido`, `identificadorDocumento`, `numeroDecisao` e
`textoRefinamento` não foram testados. Rate limit e `tamanhoPagina` máximo não
medidos. Não se isolou **qual parte do acervo tem ementa indexada** (a abrangência
EMENTA acha 874 em `licitação`, então existe). A ordenação não foi comparada entre
os três valores. Nas bases do `cojur`, os **operadores não foram testados** e o
`tp_prejulgado` (valores 0/1/2/4, subtipos do enunciado) **não foi decodificado**;
o inteiro teor do enunciado e do informativo **não tem PDF** (só o texto do
payload), e a **súmula tem PDF** no site institucional.
