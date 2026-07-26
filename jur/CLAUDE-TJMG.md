# CLAUDE-TJMG — Tribunal de Justiça de Minas Gerais

**Status: 🟢 OK** — API direta, sem browser, sem captcha.
**Comando:** `./bin/jur tjmg`
**Portal:** https://consulta-jurisprudencia.tjmg.jus.br/pesquisa
**API:** https://jurisprudencia-api.tjmg.jus.br — **OpenAPI público** em `/v3/api-docs`,
Swagger UI em `/swagger-ui/index.html`
**Escopo:** MG, Justiça Estadual. **2º grau + Turmas Recursais.** Sem 1º grau, sem súmulas.
**Mapeamento:** [`human-codegen/TJMG/`](human-codegen/TJMG/)

Matéria **federal** em Minas Gerais não é aqui: é `trf6` (desde 2023) e `trf1` (até 2022).
Matéria **trabalhista** em MG é `trt3`.

---

## 0. Leia isto antes de qualquer coisa

Três fatos mudam o que você deve fazer, e nenhum é óbvio pela tela.

**(1) Existem DOIS portais, e o que o site oficial linka é o quebrado.**
Até 26/07/2026 a página "Consulta de Jurisprudência" do portal do TJMG apontava só para
`www5.tjmg.jus.br/jurisprudencia`, que devolve **HTTP 401 + captcha numérico** já na
primeira busca, em sessão limpa de Chromium real. O portal que funciona entrou no ar em
22/06/2026 e só aparece numa notícia. Segundo o tribunal, vira a via principal em meados
de agosto de 2026. **Nunca chame o `www5`.**

**(2) A busca por ementa devolve, na prática, só acórdãos.**
Só o tipo `Acórdão` tem ementa indexada. Decisão Monocrática, Decisão de Turma Recursal e
Decisão de Vice-Presidência devolvem **0 em escopo ementa, sempre** — não por não existirem,
mas porque o índice está vazio. Como ementa é o escopo padrão do portal, quem pesquisar
Juizado Especial mineiro do jeito óbvio recebe "0 resultados" e conclui que nenhuma Turma
Recursal decidiu o tema. **O crawler avisa; leia o aviso.** Para alcançá-los:
`--escopo inteiroTeor`.

**(3) Os operadores em português são ignorados em silêncio.**
`e`, `ou`, `não` e `$` — que funcionam no portal antigo — aqui **não dão erro e não fazem
nada**. Quem escreve `usucapião OU extraordinária` recebe o resultado do E. A sintaxe real
é a do Elasticsearch: `+ | - "frase" ( ) * ~`.

---

## 1. Uso

```bash
# busca padrão (acórdãos, por ementa)
./bin/jur tjmg -q "usucapião extraordinária"

# Juizado Especial / Turma Recursal — EXIGE inteiroTeor
./bin/jur tjmg -q "vício do produto" --tipo turmas --escopo inteiroTeor

# Justiça Comum 2º grau, recorte de data, ordenado por publicação
./bin/jur tjmg -q "dano moral +bancário" --tipo acordao \
  -di 01/01/2025 -df 31/12/2025 -ord recentes

# verificar um julgado antes de citar
./bin/jur tjmg -n 5003998-10.2020.8.13.0079

# enumerar um combo (com contagens)
./bin/jur tjmg --listar tiposDocumento
./bin/jur tjmg --listar comarcas

# baixar o inteiro teor
./bin/jur tjmg -q "usucapião" --escopo inteiroTeor -m 1 --fetch-inteiro-teor
```

## 2. Flags específicas

| Flag | Valores | Default | Observação |
|---|---|---|---|
| `-t, --tipo` | `todos`, `acordao`, `monocratica`, `turmas`, `vice`, `comum` | `todos` | **é a desambiguação Juizado × Justiça Comum** — ver §3 |
| `--escopo` | `ementa`, `inteiroTeor` | `ementa` | ementa só encontra acórdãos — ver §0(2) |
| `-com, --comarca` | nomes exatos, **`;`** | — | `--listar comarcas` (298) |
| `-oj, --orgao` | nomes exatos, **`;`** | — | `--listar orgaosJulgadores` (575) |
| `-mag, --magistrado` | nomes exatos, **`;`** | — | `--listar magistrados` (368) |
| `-c, --classe` | nomes exatos, **`;`** | — | `--listar classes` (114) |
| `-a, --assunto` | nomes exatos, **`;`** | — | `--listar assuntos` (2.257) |
| `-di/-df` | DD/MM/AAAA | — | data de **julgamento** |
| `-dpi/-dpf` | DD/MM/AAAA | — | data de **publicação** (filtro distinto) |
| `-ord, --ordenacao` | `relevancia`, `recentes`, `julgamento` | `relevancia` | validado localmente |
| `--listar <dominio>` | os 6 campos acima | — | não faz busca, só enumera |
| `-n, --numero` | CNJ com ou sem máscara | — | consulta direta (Checker) |
| `--sem-validar-filtros` | — | desligado | pula a conferência dos nomes contra a API |
| `--max-results <n>` | inteiro | — | teto total de resultados coletados |
| `--output-dir <dir>` | caminho | `./resultados/tjmg` | destino do `--fetch-inteiro-teor` |

`-v/--visible` e `--headed` são aceitos e **ignorados**: não há browser.

⚠️ **O separador dos campos multivalorados é `;`, não vírgula** — ao contrário dos outros
tribunais do repo. Motivo: **18 dos 575 órgãos julgadores têm vírgula no nome**, e os 18 são
de Turma Recursal (`2º Titular Tr - Belo Horizonte, Betim E Contagem [cível]`). Com vírgula
de separador, o nome se partiria ao meio e a API devolveria **0 sem erro** — justamente no
caminho do Juizado.

⚠️ **Nome inexistente falha alto.** A API aceita qualquer string nesses filtros e devolve 0.
Por isso o crawler confere os valores contra `/dominio` antes de buscar e erra com sugestões:

```
Valor não existe em orgaosJulgadores: "2º Titular Tr - Belo Horizonte".
  Você quis dizer:
    2º Titular Tr - Belo Horizonte, Betim E Contagem [cível]
    2º Titular Tr - Belo Horizonte, Betim E Contagem [criminal]
```

Custa uma chamada a mais por filtro usado; `--sem-validar-filtros` desliga.

## 3. Juizado × Justiça Comum — a desambiguação

É o `--tipo`, que vira `tiposDocumento` na API. São exatamente 4 valores, e nada mais:

| `--tipo` | Valor na API | Documentos | O que é |
|---|---|---|---|
| `acordao` | Acórdão | 3.370.461 | **Justiça Comum 2º grau** (Câmaras) |
| `monocratica` | Decisão Monocrática | 454.481 | relator sozinho, 2º grau |
| `turmas` | Decisão Turma Recursal | 532.132 | **Juizado Especial** |
| `vice` | Decisão Vice-Presidência | 227.171 | admissibilidade de RE/REsp |
| `comum` | Acórdão + Monocrática | — | 2º grau sem Juizado |
| `todos` | (sem filtro) | 4.584.245 | **mistura Juizado e Justiça Comum** |

Prova de que o filtro morde (query `usucapião`, `--escopo inteiroTeor`, sem data):
`turmas` → **259**, `vice` → **776**, `todos` → 1000+ (contador saturado). Contagens
distintas e abaixo do teto: o filtro é aplicado, não só aceito.

⚠️ Com `--tipo todos` o primeiro resultado medido veio de **Turma Recursal**. Sem filtrar,
Juizado e Justiça Comum voltam misturados — e atribuir a uma Câmara Cível o que uma Turma
Recursal decidiu é erro de citação, não detalhe.

## 4. Operadores — medidos um a um

Janela de referência: julgamento 01/01/2024–31/03/2024, escopo ementa.
`usucapião` = 380, `extraordinária` = 914, os dois juntos = 114.

| Operador | Funciona | Contagem | Nota |
|---|---|---|---|
| espaço (E implícito) | ✅ | 114 | é o default |
| `+` | ✅ | 114 | igual ao default |
| `\|` (OU) | ✅ | 1000+ | maior que 914 → é união |
| `-` (NÃO) | ✅ | 266 | 380 − 114 = 266, exato |
| `"frase exata"` | ✅ | 113 | |
| `( )` grupos | ✅ | 586 | `( "usucapião extraordinária" \| inss )` |
| `*` curinga | ✅ | 384 | `usucapi*` |
| `~` fuzzy | ✅ | 383 | |
| `"frase"~5` proximidade | ✅ | 114 | |
| `E` / `OU` / `NÃO` | ❌ | 114 | **ignorados, sem erro** — devolvem o E |
| `AND` / `OR` / `NOT` | ❌ | 0 | viram termo literal |
| `$` (curinga do www5) | ❌ | 0 | vira termo literal |
| `ADJ` / `PROX` | ❌ | 0 | viram termo literal |

Acento é indiferente: `usucapião` = `usucapiao` = `USUCAPIÃO` = 380.

## 5. Ressalvas

**5.0 `avisos`, `totalResults` e `totalResultsExato` só saem no resumo `--json`.** Eles são
propriedades do array de resultados, e `JSON.stringify` não as grava — o arquivo do `-o`
contém só a lista. Leia-os do stdout de `--json`.

**5.1 `totalResults` satura em 1000.** É teto do **contador**, não do acervo. Abaixo de 1000
a contagem é exata; igual a 1000 significa "1000 ou mais". O campo `total: true` da API não
levanta o teto (medido). O JSON de saída traz `totalResultsExato: false` quando saturou —
**não relate "1000 resultados" sem essa ressalva.** Para número exato, estreite a janela de
data até cair abaixo do teto.

**5.2 A paginação não para no contador.** Ela continua entregando muito além de 1000
(page=150 com size=10 ainda devolve itens). Por isso o crawler para por **página vazia**, e
não por `totalRecords`.

**5.3 A ordenação não tem desempate — a API repete documentos entre páginas.** Medido: 14
repetidos em 60, em 1 rodada de 3, ordenando por publicação. O crawler **deduplica por id**
e informa `duplicatasDescartadas` + um aviso. O que ele **não** pode consertar é o outro
lado do mesmo defeito: documentos **pulados**. Para varredura exaustiva, **fatie por data**
em vez de paginar fundo. (Mesmo comportamento já registrado no TJRJ.)

**5.4 O campo `ementa` só é ementa de verdade em acórdão — confira `ementaEhTrecho`.**
A busca **devolve** a ementa, mas só do tipo `Acórdão` (medido 20/20, nos dois escopos).
Os outros três tipos vêm sem — é o mesmo fato de não terem ementa indexada (§0.2) — e aí o
campo cai para os trechos destacados.

| Tipo | `ementa` | `ementaEhTrecho` |
|---|---|---|
| Acórdão | ementa integral | `false` |
| Monocrática, Turma Recursal, Vice-Presidência | trechos com o termo | `true` |

O campo `trechos` traz os destaques nos dois casos. **Antes de citar, olhe
`ementaEhTrecho`**: se for `true`, você tem recortes, não a ementa — cite a partir do
`--fetch-inteiro-teor`.

**5.4-b `relator` vem vazio em Turma Recursal.** A API não devolve `magistrado` nesse tipo
(medido 0/20; 20/20 nos outros três). Como Juizado é justamente o caminho de `--tipo turmas`,
conte com relator ausente ali — não é falha do crawler.

**5.5 `dataJulgamento` pode vir vazia.** O próprio portal mostra "<DATA NÃO IDENTIFICADA>"
(visto em 5016167-17.2022.8.13.0707). O crawler devolve string vazia de propósito —
**nunca substitua pela data de publicação.**

**5.6 Não há sentenças (1º grau) nem súmulas.** Apesar de a notícia de lançamento citar 1,6
milhão de sentenças e de o portal antigo ter aba "Sentenças", `/dominio/tiposDocumento`
devolveu 4 tipos em 26/07/2026, nenhum deles sentença ou súmula. Provável migração em curso
— **reconfira antes de afirmar ao usuário que o TJMG não tem 1º grau.**

**5.7 Datas entram em YYYY-MM-DD e saem em DD/MM/AAAA.** Formatos diferentes na mesma API.
A CLI recebe DD/MM/AAAA (padrão do repo) e converte.

**5.8 O padrão da tela é "Últimos 5 anos".** A SPA envia `datasPublicacao` com início em
hoje−5 anos. **O crawler não faz isso**: sem `-di/-df` ele busca o acervo inteiro (a
auditoria confirmou julgados de 1997 e 2000). Quem copiar payload do DevTools herda o
recorte e conclui errado que a base começa em 2020.

## 6. Bloqueios

| | Portal novo (usado) | Portal antigo `www5` |
|---|---|---|
| Restrição | **nenhuma** | HTTP 401 + captcha numérico |
| Busca sem resolver | ✅ curl puro | ❌ |
| Download sem resolver | ✅ mesmo endpoint | ❌ |
| Sessão/cookie | não precisa | JSESSIONID + F5 BIG-IP |
| Headless | irrelevante (sem browser) | não passa |

Há um Keycloak (`auth.tjmg.jus.br`) e um botão LOGIN, mas a SPA o chama com `prompt=none`:
é **login opcional**. Busca e inteiro teor respondem 200 sem token.

## 7. Verificação (anti-alucinação)

```bash
./bin/jur tjmg -n 5003998-10.2020.8.13.0079                    # existe?
./bin/jur tjmg -q "..." --escopo inteiroTeor --verificar 5     # audita a amostra
```

O `TJMGChecker` prova existência contra a **própria base de jurisprudência**
(`numerosProcessos`), que confirma que o **julgado** existe — não só o processo.

⚠️ Quando não acha, ele **não** conclui "não existe". Faz um segundo passo no **DataJud**
(`api_publica_tjmg`, todos os graus) para distinguir os dois casos:

- `processo existe no TJMG (DataJud) mas não há julgado publicado na base de jurisprudência`
  → é processo de 1º grau ou que nunca teve acórdão. **Não é alucinação.**
- `não encontrado nem na jurisprudência nem no DataJud` → aí sim, desconfie do número.

TJMG na numeração CNJ: **J=8 (Justiça Estadual), TR=13**.

## 8. Testes

```bash
node src/TJMGTestes.js            # 23 testes de integração contra a API real (~25s)
node src/TJMGTestes.js --rapido   # pula o download em disco
node tests/smoke.js tjmg
```

Quatro deles são testes de **armadilha**: afirmam que a API ainda quebra onde sabemos que
quebra (os três HTTP 500) e que a ementa dos três tipos ainda está vazia. Se um desses
começar a **falhar**, é boa notícia — quer dizer que o TJMG consertou, e então este
documento e o `SEM_EMENTA_INDEXADA` do Navigator estão errados e precisam ser reescritos.

## 9. Arquitetura

| Arquivo | Papel |
|---|---|
| `src/TJMGNavigator.js` | fala com a API; as 3 armadilhas de 500 e `SEM_EMENTA_INDEXADA` |
| `src/TJMGCrawler.js` | monta filtros, pagina, deduplica, emite avisos, mapeia |
| `src/TJMGChecker.js` | consulta por nº + CNJ + desempate no DataJud + auditoria |
| `src/TJMGTestes.js` | suíte de integração |

Não estende `BaseCrawler`/Playwright — como o TJPA, roda em HTTP puro.
