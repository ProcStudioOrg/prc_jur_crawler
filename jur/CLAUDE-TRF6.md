# TRF6 — Tribunal Regional Federal da 6ª Região

**Escopo:** MG · **Status:** 🟢 **OK** (HTTP direto, sem browser) · mapeado em 25/07/2026

Comando: `./bin/jur trf6` · Stack: `src/TRF6Crawler.js` + `src/TRF6Navigator.js` +
`src/TRF6Checker.js` · Testes: `node src/TRF6Testes.js` (`npm run test:trf6`) ·
Mapeamento: `human-codegen/TRF6/`

## O portal

| URL | Situação |
|---|---|
| `jurisprudencia.trf6.jus.br` · `juris.trf6.jus.br` | **NXDOMAIN** — não existem |
| `www.trf6.jus.br/jurisprudencia` | 200, mas é uma **imagem** (`Jurisprudencia.png`), não uma página |
| **`https://eproc-jur.trf6.jus.br/`** | ✅ **é esta** — redireciona para o módulo `jurisprudencia@jurisprudencia/pesquisar` do e-Proc |

É o **mesmo módulo `eproc-jur` do TRF2, do TRF4 e do TJSC** (mesmos ids, mesma
marcação de card, mesma paginação). Sem Cloudflare, sem captcha, sem verificação
F5/Shape: o POST de busca responde 200 **sem cookie nenhum** — logo este crawler é
**HTTP puro** (~0,4 s por busca), como o do TRF2.

⚠️ A **tramitação** do TRF6 é PJe (`pje1g`/`pje2g`, `sistemas.trf6.jus.br`); a
**jurisprudência** é e-Proc. São sistemas diferentes — é o caso-escola do
`CLAUDE-CODEGEN.md` §1.

---

## ⚠️ RESSALVA Nº 1 — a base começa em **2023**, e o acervo antigo está no TRF1

**Este é o dado mais importante do TRF6.** O tribunal foi criado pela EC 122/2022 e
instalado em **agosto de 2022**, desmembrando-se do TRF1. Antes disso, Minas Gerais
era jurisdição do TRF1 — e o acervo **não foi migrado**.

Curinga `*`, origem TRF6, por ano de julgamento (25/07/2026):

```
até 2022        0        2024   17.719
2023          283        2025  126.105
                         2026   95.017 (até 25/07)
```

Uma busca com recorte anterior a 2023 devolve **0** em qualquer termo e qualquer
origem. O crawler **avisa** em vez de deixar o usuário ler a lista vazia como
"não há jurisprudência":

```bash
./bin/jur trf6 -q "dano moral" -di "01/01/2015" -df "31/12/2021" --json
# -> "totalResults":0, avisos: ["... A jurisprudência federal de Minas Gerais
#     até 2022 está no TRF1 — use `./bin/jur trf1`."]
```

**Onde mora o acervo mineiro até 2022 — medido, não presumido.**

| Fonte | Cobre MG anterior a 2023? |
|---|---|
| TRF6 (esta base) | ❌ 0 documentos antes de 2023 |
| **Jurisprudência Unificada do CJF** | ❌ **nem lista o TRF6.** O seletor tem STF, STJ, TNU, TRF1–TRF5, TR, TRU, "Todos" — e nada mais. `jurisprudencia.cjf.jus.br/trf6/index.xhtml` = 404 (o `/trf1/` = 200) |
| **TRF1** (`./bin/jur trf1`, base do CJF) | ✅ **sim** — é aqui |

Prova do TRF1 (25/07/2026, `./bin/jur trf1 -q "aposentadoria" -di 01/01/2019 -df 31/12/2019 -m 5`):
a base declarou 242.537 documentos e, na amostra de 150, **41 (27,3%)** têm subseção
de Minas Gerais no número CNJ (`.4.01.38xx` — 3800 Belo Horizonte, 3802, 3807,
3810, 3814, 3819, 3823, 3825…). Detalhes em
`human-codegen/TRF6/02-acervo-anterior/`.

**Roteamento prático:**

| Pedido | Comando |
|---|---|
| jurisprudência federal de MG, **2023 em diante** | `trf6` |
| Juizado Especial Federal / Turma Recursal de MG | `trf6 --origem turmas` |
| jurisprudência federal de MG **até 2022** | `trf1` (⚠️ status oscila — ver `CLAUDE-TRF1.md`) |
| histórico longo ("o que já se decidiu sobre X em MG") | os **dois**, dizendo ao usuário que são duas bases distintas |

---

## ⚠️ RESSALVA Nº 2 — **NÃO** copie a correção de query do TRF2

No TRF2 o espaço entre termos quebra a busca e o crawler hifeniza a query. **No
TRF6 isso seria veneno.** O TRF6 roda uma versão mais nova do e-Proc
(**9.21.6** contra 9.21.0 do TRF2) e o bug não existe:

```
dano = 21.079 · moral = 2.488
dano moral    (espaço) =  2.201   termos montados pelo servidor: dano|moral   ✅
dano-moral    (hífen)  =  2.201   idem                                        ✅
dano e moral           =  2.201                                              ✅
dano ou moral          = 21.366 = 21.079 + 2.488 − 2.201                     ✅ exato
dano nao moral         = 18.878 = 21.079 − 2.201                             ✅ exato
```

Mas com **hífen** os operadores somem em silêncio:

```
dano-ou-moral   = 216.419   (a base quase inteira — o `ou` virou nada)
dano-nao-moral  =   2.201   (idêntico ao E — o `nao` virou nada)
```

Por isso `TRF6Navigator.normalizarQuery()` é deliberadamente uma **identidade**.
Ela só existe para documentar a decisão e para avisar quando o usuário escreve um
operador **em inglês** — esses, sim, viram termo literal:
`dano and moral` = 6 documentos (a palavra "and" aparece em 309).

Dois tribunais no mesmo módulo, um patch de diferença, comportamentos opostos: é
o motivo de a validação ser **por contagem**, nunca pela documentação do site.

---

## Justiça Federal comum × Juizados Especiais — a desambiguação

É o filtro `--origem` (combo "Origem" / `#selOrigem`). **Sempre explicite.**
São **quatro** valores — um a mais que no TRF2.

| `--origem` | Combo do site | `#selOrigem` | O que é | Base (`*`) |
|---|---|---|---|---|
| `trf6` (**default**) | TRF6 | `1` | **Justiça Federal comum, 2º grau** — Turmas, Seções, Plenário, Presidência, Vice-Presidência | 216.706 |
| `turmas` | Turmas Recursais | `3` | **Juizados Especiais Federais, 2º grau** — as 6 Turmas Recursais de MG | 59.484 |
| `tru` | TRU6 | `2` | Turma Regional de Uniformização (Juizados) | 139 |
| `varas` | Varas Federais | `4` | 1º grau (sentenças) — **DECLARADA E VAZIA** | **0** |
| `todas` | (as quatro marcadas) | `1,2,3,4` | tudo junto | 276.329 |

Aliases: `juizados`/`juizado`/`jef`/`recursal`/`tr` → `turmas`; `comum`/`trf`/`tribunal` → `trf6`;
`uniformizacao` → `tru`; `primeiro-grau`/`sentencas` → `varas`.

Contagens medidas (`dano moral`, escopo inteiro teor, sem data, 25/07/2026):

```
trf6 2.201 · tru 1 · turmas 1.744 · varas 0
todas 3.946   (= 2.201 + 1 + 1.744 + 0, fecha exato)
```

Com recorte 01/01/2026–31/03/2026, `aposentadoria especial`:
`5.104 + 4 + 2.160 = 7.268`. Se algum dia essas contagens ficarem iguais, o filtro
parou de ser aplicado — é o que o `TRF6Testes.js` vigia.

Dois sinais na própria saída confirmam o recorte:

| campo | Justiça Federal comum | Turmas Recursais |
|---|---|---|
| `sufixoOrigem` | `TRF6` | `MG` |
| `orgaoJulgador` | `1ª Turma - PREV/SERV` | `3ª Turma Recursal dos Juizados Especiais Federais de Minas Gerais` |

⚠️ Como no TRF2, o `tipoDocumento` **não** distingue origem — é "Acórdão" nas duas.
A **TRU6** usa o sufixo `TRF6`, igual ao 2º grau comum; nela quem distingue é o
órgão ("TURMA REGIONAL DE UNIFORMIZAÇÃO"). O `--json` devolve `origemAplicada`
com o rótulo do que de fato foi enviado.

Prints lado a lado: `human-codegen/TRF6/01-eproc-jurisprudencia/06.01-resultados-trf6.png`,
`06.02-resultados-turmas-recursais.png` e `06.05-resultados-varas-federais-vazio.png`.

---

## Exemplos

```bash
# Justiça Federal comum (default), com período de julgamento
./bin/jur trf6 -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" -m 2

# Juizados Especiais Federais / Turmas Recursais — mesma busca, outro universo
./bin/jur trf6 -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" --origem turmas

# Operadores (em PORTUGUÊS, separados por espaço — nada de hífen)
./bin/jur trf6 -q "dano moral"                     # espaço = E implícito
./bin/jur trf6 -q "dano ou moral"
./bin/jur trf6 -q "dano nao moral"
./bin/jur trf6 -q "dano prox moral"
./bin/jur trf6 -q '"aposentadoria especial"'       # frase exata
./bin/jur trf6 -q '"dano moral" e aposentadoria'   # frase + termo funciona aqui
./bin/jur trf6 -q "embarg*"                        # curinga de sufixo

# Só na ementa (o default do site — e do crawler — é INTEIRO TEOR)
./bin/jur trf6 -q "dano moral" --escopo ementa
./bin/jur trf6 -q "dano moral" --escopo ementa --caput

# Tipo de documento, órgão, relator, classe
./bin/jur trf6 -q "dano moral" -t acordao
./bin/jur trf6 -q "aposentadoria" -oj "1ª Turma - PREV/SERV"
./bin/jur trf6 -q "trafico" -oj "1ª Turma - CRIMINAL"           # aproxima "Criminal"
./bin/jur trf6 -q "tempo especial" -cl "Apelação Cível" -r "MÔNICA SIFUENTES"

# Coleta grande: 100 por página derruba o nº de round-trips por 10
./bin/jur trf6 -q "tempo de servico" --por-pagina 100 -m 3

# VERIFICAR um julgado (consulta direta por número)
./bin/jur trf6 -n "1017514-90.2019.4.01.9999" --json
./bin/jur trf6 -n "1017514-90.2019.4.01.9999" --datajud --json   # + metadados do CNJ

# Auditar uma busca + baixar inteiro teor
./bin/jur trf6 -q "usucapiao" --verificar 5 --json
./bin/jur trf6 -q "usucapiao" -m 1 --fetch-inteiro-teor --output-dir ./resultados/trf6

# Listar os combos
./bin/jur trf6 --listar-combos --origem turmas
```

## Flags específicas

Além das flags comuns (ver `CLAUDE.md`):

| Flag | Valores | Observação |
|---|---|---|
| `--origem` | `trf6` (default) `turmas` `tru` `varas` `todas` | **a desambiguação** — ver tabela acima |
| `-n, --numero` | nº CNJ | consulta direta; dispensa `-q`; exit 1 se não encontrar |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto) |
| `--escopo` | `inteiroTeor` (**default**) `ementa` | ver ressalva 4 |
| `--caput` | | com `--escopo ementa`: só o caput |
| `-t, --tipo` | `acordao` `monocratica` `sumula` `despacho-vice` `sentenca` (vírgula) | ver ressalva 5 |
| `-oj, --orgao` | nome, vírgula | 17 opções no TRF6, 6 nas Turmas, 1 na TRU6 |
| `-r, --relator` | nome, vírgula | 52 / 23 / 9 nomes por origem |
| `-cl, --classe` | nome, vírgula, ex.: `"Apelação Cível"` | 81 / 11 / 6 opções |
| `-p, --processo` | nº | filtro **dentro** da busca (use `-n` para consulta direta) |
| `--precedente-relevante` | | só precedentes marcados pelo tribunal (5 em `aposentadoria`) |
| `--sem-agrupar` | | desliga "Agrupar Resultados" (o site vem com ele ligado) |
| `--literal` | | envia a query como digitada, **sem** o aviso de operador em inglês |
| `-ord` | `recentes` (default) `antigos` | |
| `--por-pagina` | `10` (default) `25` `50` `100` | |
| `--listar-combos` | | origens, tipos, órgãos, relatores, classes |
| `--fetch-inteiro-teor` | | baixa o `.txt` de cada resultado |
| `--verificar [N]` | default 5 | reconsulta N processos e confere o `id` do documento |
| `--datajud` | com `-n` | consulta também o DataJud (CNJ) como fonte secundária |
| `-v / --headed` | | **sem efeito** — este crawler não abre browser |

## Operadores — testados um por um

O site declara **seis** no painel "Operadores": `"..."`, `e`, `ou`, `não`, `prox`, `*`.
Os seis funcionam. Referência (origem TRF6, escopo inteiro teor, 25/07/2026):
`dano` = 21.079 · `moral` = 2.488 · base inteira (`*`) = 216.706.

| Sintaxe | Funciona? | Evidência |
|---|---|---|
| termo único | ✅ | `aposentadoria` = 36.578 |
| **espaço** entre termos (E implícito) | ✅ | `dano moral` = 2.201 (≠ TRF2!) |
| `e` | ✅ | `dano e moral` = 2.201 |
| `ou` | ✅ | `dano ou moral` = 21.366 (fecha exato) |
| `nao` / `não` | ✅ | `dano nao moral` = 18.878 (fecha exato) |
| `"frase exata"` | ✅ | `"dano moral"` = 1.979 |
| frase exata **+ outro termo** | ✅ | `"dano moral" ou aposentadoria` = 38.162 (fecha exato) |
| `prox` (com espaço) | ✅ | `dano prox moral` = 2.012 |
| `*` (curinga de sufixo) | ✅ | `embarg*` = 47.922 |
| MAIÚSCULAS / acentos | indiferentes | `tributário` = `tributario` = 17.983 |
| **hífen com operador** | ❌ | `dano-ou-moral` = 216.419 · `dano-nao-moral` = 2.201 |
| `and` / `or` / `not` (inglês) | ❌ | viram termo literal: `dano and moral` = 6 |
| `prox` com hífen · `prox5` · `adj` | ❌ | 0 resultados |
| `?` e `$` como curinga | ❌ | `embarg?` = `embarg$` = `embarg` = 0 |

⚠️ **O exemplo da própria ajuda do site devolve 0.** O painel sugere
`crime e "faixa de fronteira"`; medido: 0 documentos. Aqui a sintaxe está certa —
`"faixa de fronteira"` só existe em 10 documentos da base e nenhum tem "crime".
O outro exemplo fecha a álgebra: `drogas` 859 + `entorpecentes` 281 −
`drogas e entorpecentes` 218 = `drogas ou entorpecentes` **922** ✓.

Detalhes e o `termosPesquisados` de cada teste:
`human-codegen/TRF6/01-eproc-jurisprudencia/07-operadores.txt` e `07-operadores-testados.json`.

## API oficial — procurada, e o que existe

| Onde | Resultado |
|---|---|
| `dadosabertos.trf6.jus.br`, `api.trf6.jus.br`, `jurisprudencia.trf6.jus.br`, `juris.trf6.jus.br` | NXDOMAIN |
| `trf6.jus.br/dados-abertos`, `/transparencia/dados-abertos` | 404 |
| `swagger` / `openapi` / `/api-docs` no host do e-Proc | não existem |
| **CJF — Jurisprudência Unificada** `jurisprudencia.cjf.jus.br/unificada/` | **não lista o TRF6** (STF, STJ, TNU, TRF1–TRF5, TR, TRU, Todos). `/trf6/index.xhtml` = 404 |
| **DataJud (CNJ)** `api-publica.datajud.cnj.jus.br/api_publica_trf6/_search` | o índice **existe** (responde 429/timeout, nunca 404) — só metadados |

**Não existe API oficial de jurisprudência do TRF6.** Isso é resultado de busca,
não omissão. E a Unificada do CJF, que seria a "base nacional do ramo", foi
construída antes de 2022 e **nunca foi estendida ao TRF6** — diferente do TRF2,
onde ela ao menos aparece (vazia).

Sobre o **DataJud**: metadados processuais (classe, órgão, grau, movimentos), sem
ementa e sem inteiro teor — **não substitui o crawler**, mas responde "este
processo existe no TRF6?". A API é instável (429 é comum), por isso só é
consultada com `--datajud` e a falha nunca derruba a verificação principal.
A chave pode ser sobrescrita por `DATAJUD_API_KEY`.

## Ressalvas importantes

1. **A base começa em 2023** — a mais cara. Ver a ressalva 1. Pedido histórico de
   MG anterior a 2022 **não tem resposta aqui**; está no TRF1. Diga isso em vez
   de devolver lista vazia.
2. **Não hifenize a query** — ver ressalva 2. O remédio do TRF2 quebra `ou` e `não`
   aqui. Se algum dia o TRF6 regredir para o comportamento do TRF2, o teste
   "espaço e hífen dão a MESMA contagem" de `TRF6Testes.js` acusa.
3. **A numeração é MISTA: `.4.06.` e `.4.01.`.** O TRF6 herdou os processos
   mineiros do TRF1 com a numeração antiga. Em amostras de 100 documentos:
   origem TRF6 91/9, Turmas Recursais 76/24, TRU6 56/44. Um verificador que
   exigisse `.4.06.` rejeitaria quase um quarto do acervo dos Juizados —
   `TRF6Checker.ehProcessoTRF6()` aceita as duas e marca `herancaTRF1: true`.
4. **O escopo default é INTEIRO TEOR, não ementa** — é o default do próprio site
   (`#optInteiroTeor` vem `checked`), e o crawler o mantém para que as contagens
   batam com a tela. `aposentadoria`: inteiro teor 36.578 → ementa 23.379 →
   com `--caput` 18.568.
5. **Dois "tipos" declarados e vazios.** "Súmula" existe no combo da origem TRF6
   e a base tem **zero**. E a origem inteira **"Varas Federais" (1º grau) está
   vazia** — 0 documentos em qualquer termo — embora ofereça o tipo "Sentença".
   Não há sentença de 1º grau nesta base. Pedir um tipo que não existe na origem
   escolhida não dá erro no servidor: ele **ignora o filtro** e devolve a busca
   inteira. O crawler recusa alto.
6. **Filtro de data desliga o agrupamento.** `*` na origem TRF6 dá 216.706 com
   agrupar (default) e 239.124 sem. A soma ano a ano COM filtro de data dá
   exatamente 239.124 — ou seja, com data o servidor conta sem agrupar. Não
   compare uma contagem com data contra uma sem data esperando que a diferença
   seja só o recorte.
7. **Não há bloqueio anti-bot.** Sem Cloudflare, sem captcha, sem verificação
   F5/Shape. Busca e download passam sem cookie de sessão; headless é irrelevante;
   `--headed` não faz nada.
8. **`#txtProcesso` funciona sozinho** (diferente do TRF2, onde ele exige texto no
   campo de busca). O `TRF6Checker` manda o curinga `*` junto assim mesmo — é
   inócuo e mantém o Checker imune se o servidor mudar.
9. **Um processo pode ter vários documentos** (acórdão + monocrática + despacho da
   Vice). O identificador do *documento* é o `id` (30 dígitos). Confirmar o número
   do processo **não** confirma a decisão citada — a auditoria confere o `id`.
10. **A ementa já vem inteira no resultado**, inclusive nas Turmas Recursais —
    diferente do TJSC/TRF4, onde a ementa da Turma Recursal é uma frase.
    `--fetch-inteiro-teor` é opcional aqui. Decisões monocráticas costumam vir sem
    EMENTA, só com DECISÃO; o crawler cai para o texto de citação quando falta.
11. **O `resValue` do TRF6 tem classes extras** (`class="resValue limitado"
    data-campo="EMENTA"`). Um parser que case `class="resValue"` exato — como o do
    TRF2 — perde RELATOR, DECISÃO e EMENTA em silêncio. Ver `TRF6Navigator.extrair()`.
12. **Encoding ISO-8859-1** em tudo — HTML de resultado e inteiro teor. O navigator
    codifica o corpo do POST como latin-1 e decodifica a resposta idem. Não
    decodifique por fora.
13. **Filtros que este módulo NÃO tem:** área Cível × Criminal, subseção/comarca,
    unidade, juiz de 1º grau, assunto CNJ. A UF existe só como campo do resultado
    (é sempre "MG"), não como parâmetro. Aproxime Cível × Criminal por `-oj`
    (as Turmas são temáticas: "1ª Turma - CRIMINAL" × "1ª Turma - PREV/SERV") ou
    por `-cl` ("Apelação Criminal" × "Apelação Cível").
14. **`--listar-combos` devolve a UNIÃO das quatro origens** para classe/relator/
    órgão: por HTTP o endpoint `ajax_carregar_listas_pesquisa` ignora o filtro de
    origem (no browser ele respeita, porque lê a sessão). As listas **por origem**
    estão em `human-codegen/TRF6/01-eproc-jurisprudencia/03-*.json`.
15. **Relator com grafias múltiplas.** O combo traz o mesmo magistrado em formas
    diferentes ("GLAUCIO FERREIRA MACIEL GONCALVES", "GLAUCIO MACIEL",
    "GLÁUCIO MACIEL"). Filtrar por uma só grafia perde acórdãos.
16. **Custo.** HTTP puro: ~0,4 s por busca, sem Chromium. Rodar `--origem trf6` e
    `--origem turmas` em paralelo é barato.
17. **Classes do "Acordo do Rio Doce".** O TRF6 tem um bloco de classes próprio
    (Ação de Depósito, Consignação em Pagamento, Indenizatória, Cumprimento de
    Sentença de Ações Coletivas — todas "(Acordo do Rio Doce)"), herdado das ações
    de Mariana. Se a busca for sobre desastre ambiental em MG, vale filtrar por
    `-cl`.
