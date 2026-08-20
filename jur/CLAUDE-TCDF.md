# CLAUDE-TCDF — Tribunal de Contas do Distrito Federal

**Comando:** `jur tcdf` · **Acesso:** `api` (REST pública, sem browser) · **Status:** 🟢 ok
**Mapeado em** 20/08/2026 · **Mapeamento:** [`human-codegen/TCDF/01-jurisprudencia/`](human-codegen/TCDF/01-jurisprudencia/)

Oitavo tribunal de contas do repo, nono alvo do Bloco 5. Único ente do bloco **sem
municípios**: o DF é ente único, não existe TCM-DF, e a ressalva "onde há TCM o TCE não
cobre as contas municipais" simplesmente não tem par aqui — provado por **ausência de
combo de município** no formulário, não por pesquisa fora do portal.

## Escopo

Cobre a base de jurisprudência do TCDF: **18.370 documentos** (Decisões do Plenário),
dos quais **2.430 estão na curadoria "Jurisprudência Selecionada"**. Não cobre as
**Súmulas**, que ficam no SINJ-DF (`www.sinj.df.gov.br`), outro sistema.

## Como se chega lá (nenhuma URL foi inventada)

```
www.tc.df.gov.br → 301 → www2.tc.df.gov.br            (WordPress institucional)
  link "Jurisprudência" → jurisprudencia.tc.df.gov.br  (WordPress de boletins — NÃO é a busca)
    link interno → busca2.tc.df.gov.br/#/jurisprudencia/inteiro-teor  (SPA Vue 2, a busca)
      bundle /js/app.fbb389bc.js → api-busca-publica.tc.df.gov.br     (a porta)
```

⚠️ **Armadilha de nome, a do TCE-MG repetida:** o host chamado
`jurisprudencia.tc.df.gov.br` **não tem busca nenhuma**. Quem parar no nome óbvio conclui
que o TCDF não tem consulta de jurisprudência.

## Porta de acesso

| O quê | Endpoint |
|---|---|
| Busca | `GET https://api-busca-publica.tc.df.gov.br/jurisprudencia/` |
| Agregações (combos) | `GET .../jurisprudencia/tipos` |
| Ato formatado | `GET https://api-etcdf.tc.df.gov.br/publico/documentos/<EDOC>` |
| Permalink | `https://www.tc.df.gov.br/app/mesaVirtual/implementacao/?a=consultaETCDF&f=formPrincipal&edoc=<EDOC>` |

É um proxy PHP na frente de um Elasticsearch (`_index: "forseti"`): a resposta é o corpo
cru do ES dentro de `{"data": {...}}`. **Sem captcha, sem cookie, sem sessão, sem token** —
busca, documento e permalink medidos **em separado**, os três livres.

## Exemplos

```bash
jur tcdf -q "nepotismo" -m 2                       # busca simples
jur tcdf -q "nepotismo AND licitação" --selecionada # só a curadoria (2.430 docs)
jur tcdf -q "licita*" --ano 2023 -m 3              # curinga + recorte por ano
jur tcdf -q "nepotismo" -di 01/01/2023 -df 30/06/2023
jur tcdf -q "servidor" --relator "Inácio Magalhães Filho"
jur tcdf -n B0AB532D                               # por e-doc (identifica UM documento)
jur tcdf -n 4518/2020                              # por processo (devolve VÁRIOS julgados)
jur tcdf --listar-filtros                          # agregações
jur tcdf -q "nepotismo" -m 1 --verificar 3 --fetch-inteiro-teor
```

## Flags específicas

| Flag | O que faz |
|---|---|
| `--selecionada` | Só a Jurisprudência Selecionada (2.430 de 18.370) |
| `--situacao <v>` | `Publicada` \| `Descartada` \| `Em Análise` \| `Pré-Descartada` |
| `--ano <ano>` | Filtro próprio do índice, independente de `-di/-df` |
| `--numero-documento <n>` | Número do **documento** (4760), não do processo |
| `--sessao-tipo <t>` | `ORDINÁRIA` \| `EXTRAORDINÁRIA` \| `ORDINÁRIA VIRTUAL` \| `ADMINISTRATIVA` |
| `--tematica` / `--paradigmatica` / `--emissor` | Filtros da curadoria |
| `--assunto` / `--normativo` | **Quebrados no servidor** — viram aviso, não são enviados |
| `--fetch-documento` | Busca o ato no e-TCDF (devolve **menos** texto que a busca) |

---

# Ressalvas — leia antes de citar qualquer coisa

## 🔴 O WAF F5 bloqueia pelo User-Agent `curl` e devolve 403 com página de 35 KB

```
curl SEM -A          → HTTP 403, text/html, 35.074 B, <title>Web Application Firewall</title>
curl -A "<Chrome>"   → HTTP 200, application/json, 129.795 B
```

E o gate é **só o User-Agent, não "headless"**: o Playwright headless *sem* override
(UA `.../HeadlessChrome/151.0.7922.34`) também recebe 200 — o F5 do TCDF **não** faz o
que o WAF do TCE-CE faz. As duas medições tinham de ser separadas.

**Sem UA de navegador todo request vira 403 com HTML**, que se lê como "o tribunal exige
captcha" quando a API está escancarada. O `TCDFNavigator` manda o UA sempre.

## 🔴 Quinta casca de HTTP 200 do repo: PHP fatal error como resposta de sucesso

O proxy é PHP com `memory_limit` de 128 MB e o registro do índice é gordo (~44 KB, porque
carrega `jurisprudencia_relacionados` — 52.595 chars numa amostra). Medido **sem termo**:

| `maxPerPage` | Resposta |
|---|---|
| 100 | 200, 4.416.842 B, 100 hits |
| 400 | 200, 19.009.915 B, 400 hits |
| 800 | 200, 35.529.427 B, 800 hits |
| 1600 | **200**, 344 B, `<b>Fatal error</b>: Allowed memory size of 134217728 bytes exhausted` |

🔴 **O teto é em BYTES, não em documentos**: `q=nepotismo&maxPerPage=10000` responde 200
JSON com os 112 documentos. Quem bisectar o teto com uma busca estreita conclui 10.000 e
quebra na busca larga.

🔴 **E o mesmo defeito dá duas respostas diferentes**, conforme onde a memória acaba
(`q=licitação`, `from=0`): `maxPerPage=500` → 200 com 500 hits; `1000` → **HTTP 500 limpo**
(6/6 tentativas); `2000` e `4000` → 200 com o fatal error. Ou seja **HTTP 500 aqui é
ambíguo** — pode ser profundidade ou memória — e só se separa olhando se
`from+maxPerPage` cabe na janela de 10.000.

⚠️ **E o limiar não é fixo**: 1000 sozinho falha sempre, mas 1000 logo *depois* de um 2000
que estourou passa, porque o worker PHP reciclou. Por isso o Navigator reduz e repete nos
dois casos, e o teste afirma que a página foi entregue — não que houve redução.

## 🔴 `q=` vazio ZERA a busca; `q` ausente devolve o acervo

```
?from=0&maxPerPage=1        → 10.000/gte
?q=&from=0&maxPerPage=1     →      0/eq
?q=%20&from=0&maxPerPage=1  →      0/eq
```

O próprio SPA omite a chave (`var s = this.termoPesquisado ? "q=".concat(...) : ""`). Um
crawler que sempre monte `q=${query||''}` devolve zero em toda busca sem termo.

## 🔴 O total é saturado em 10.000 — o total verdadeiro está na agregação

`hits.total.relation` diz qual é qual: `eq` = exato, `gte` = teto. O acervo sem termo
devolve **10.000/gte, e não são 10.000 documentos**: somando os buckets de `Situacao` em
`/jurisprudencia/tipos` dá **18.370** (Descartada 15.920 + Publicada 2.430 + Em Análise 16
+ Pré-Descartada 4). **Reportar 10.000 é afirmação falsa.**

## 🔴 "Jurisprudência Selecionada" e "Inteiro Teor" são o MESMO endpoint

A única diferença é `filter[jurisprudencia_situacao]='Publicada'`. A Selecionada é um
**subconjunto de 2.430 dos 18.370 (13,2%)** — a lição do TCE-CE repetida. O default do
`jur tcdf` é a base inteira; `--selecionada` reproduz a curadoria.

⚠️ **"Descartada" é descarte da CURADORIA, não do acervo**: os 15.920 existem, abrem pelo
permalink e têm texto.

## 🔴 Três filtros da própria tela estão quebrados e devolvem SEMPRE zero

O controle que prova é a agregação — que diz quantos documentos aquele valor tem:

| Filtro | Devolve | A agregação diz |
|---|---|---|
| `filter[assunto]='Pregão eletrônico'` | **0** | 83 |
| `filter[normativo]='Lei nº 8666/1993'` | **0** | 239 |
| `filter[ementa_voto]=<termo>` | **0** | — |

Não é "filtro ignorado" (que daria a contagem cheia) — é **zero**, que se lê como ausência
de jurisprudência. O crawler **não os envia** e transforma o pedido em aviso.

## 🔴 Campo desconhecido ZERA em vez de ser ignorado

O inverso da armadilha clássica do repo, e igualmente caro:
`filter[campo_que_nao_existe]='x'` → **0** com HTTP 200; `zzz:nepotismo` no `q` → **0**.
Um erro de digitação no nome do campo vira "não há jurisprudência".

## ✅ Os demais filtros foram provados por contagem (base `q=nepotismo` = 112)

| Filtro | Resultado |
|---|---|
| `filter[ano]=2023` | 13 · `=1899` → 0 |
| `filter[jurisprudencia_situacao]='Publicada'` | 12 · sozinho → 2.430, **bate com a agregação** |
| `filter[sessao_tipo]='EXTRAORDINÁRIA'` | 6 |
| `filter[relator]='Inácio Magalhães Filho'` | 22 · **aspas são opcionais** (22 sem elas) |
| `filter[numero]=4760` | 1 · `=99999` → 0 |
| `filter[emissor]='Federal'` | 7 |
| `filter[paradigmatica]='Em sede de consulta'` | sozinho → 82, **exatamente** o bucket |

⚠️ `filter[classificacao_tematica]='Pessoal'` → **536** contra 454 do bucket: restringe de
verdade, mas **não é igualdade** — casa também os valores compostos.

## 🔴 O intervalo de datas não passa por `filter[]` — passa por `q`

```
filter[sessao_data]=[2023-01-01 TO 2023-12-31]        → HTTP 500
q=nepotismo AND sessao_data:[2023-01-01 TO 2023-12-31] → funciona
```

E funciona de verdade, com conferência cruzada contra um caminho independente:

| Recorte | Total | Controle independente |
|---|---|---|
| `[2023-01-01 TO 2023-12-31]` | 13 | `filter[ano]=2023` → **13** ✅ |
| `[2023-01-01 TO 2023-06-30]` | 6 | (metade do ano) |
| `[2020-01-01 TO 2020-12-31]` | 25 | `filter[ano]=2020` → **25** ✅ |
| `[1900-01-01 TO 1900-12-31]` | 0 | (controle) |

⚠️ O recorte é por **`sessao_data`** (data da SESSÃO). Existe
`jurisprudencia_data_publicacao` no documento, mas **filtrar por ela não foi medido** —
`-dpi/-dpf` viram `-di/-df` com aviso.

## ✅ O `q` é um `query_string` Lucene de verdade — o mais rico do Bloco 5

| Operador | Medido |
|---|---|
| `nepotismo AND licitação` | 23 (de 112) ✅ |
| `nepotismo licitação` (espaço) | 6.773 = **OR implícito** ✅ |
| `nepotismo OR licitação` | 6.773 (idêntico — confirma) ✅ |
| `nepotismo NOT licitação` | 89 = 112 − 23 ✅ |
| `+nepotismo -licitação` | 89 ✅ |
| `"servidor efetivo"` | 491 (sem aspas: 10.000/gte) ✅ |
| `(nepotismo OR usucapiao) AND licitação` | 37 ✅ |
| `licita*` | 7.372 > 6.684 ✅ **curinga funciona** |
| `jurisprudencia_ementa:nepotismo` | 30 ✅ |
| `NEPOTISMO` | 112 — caixa não importa ✅ |
| `nepotismo AND` (quebrado) | HTTP 500 |

## 🔴 "E" e "OU" em português não são operadores — e o erro AMPLIA

```
nepotismo OR licitação  = 6.773   ← o OR real
nepotismo E  licitação  = 8.034   ← MAIOR
nepotismo OU licitação  = 7.675   ← MAIOR
```

Porque "e"/"ou" viram **mais um termo** no OR implícito e casam com quase tudo. A contagem
**muda**, então parece que o operador pegou — e o resultado é maior, não menor. Décimo
quarto conjunto de operadores do repo e **o primeiro em que o falso operador infla**.

## ⚠️ Acento: quase igual, mas não igual

`licitacao` = 6.680 contra `licitação` = 6.684. **Não dá para dizer que normaliza nem que
exige** — 4 documentos divergem. O aviso do crawler diz isso sem prometer equivalência
(oposto do TCE-PE, onde sem acento a busca desabava de 13.636 para 40).

⚠️ E `nepot*` = 112 = `nepotismo` **não prova que o curinga não funciona**: prova que não há
outra palavra "nepot…" indexada. Foi `licita*` que provou. Um controle de uma amostra só
teria concluído errado.

## ✅ O texto já vem no payload da busca — nenhum segundo salto

Medido no e-doc `B0AB532D`:

| Campo | Chars |
|---|---|
| `jurisprudencia_decisao` | 437 (o dispositivo) |
| `jurisprudencia_ementa` | 513 (**a ementa**) |
| `jurisprudencia_ementa_voto` | 1.303 |
| `jurisprudencia_excerto` | 3.102 |
| `jurisprudencia_ementa_voto_e_excerto` | **4.405** ← o mais completo |

🔴 **E o endpoint do documento devolve MENOS texto que a busca**, não mais: o ato do e-TCDF
tem 4.843 brutos / **1.742 limpos**. Ele não é o inteiro teor — é o ato formatado. O
inteiro teor de verdade é o **PDF**, apontado por `arquivoPDFCas`, e **o caminho do CAS até
o PDF não foi fechado** (`/cas/forseti/base64/<edoc>` → 500;
`/publico/documentos/<edoc>/merged_base64` → 404).

## 🔴 O texto do card da tela não é a ementa, e nem sempre é o mesmo campo

Na mesma busca, a maioria dos cards mostra `jurisprudencia_decisao` truncado com `...`
(~430 chars) e **alguns mostram um fragmento de highlight cortado no meio da frase** — o
e-doc `4A597532` exibe *"se encontrava em caso de nepotismo, mesmo após alertado por meio
do Parecer nº 130/2016, da RA IX sobre"*. Por isso o crawler usa o campo nomeado, nunca o
que a tela exibe.

## ✅ Permalink confirmado em aba limpa

`https://www.tc.df.gov.br/app/mesaVirtual/implementacao/?a=consultaETCDF&f=formPrincipal&edoc=<EDOC>`
→ 301 → `www2` → 301 → `etcdf.tc.df.gov.br`, e renderiza "Documento B0AB532D", Número/Ano
4760/2020, Processo TCDF 4518/2020-e, a data do DOE, a ementa integral e o botão "Download
do arquivo PDF". Aberto no Playwright em **contexto novo, sem cookie**.

⚠️ Mas o HTML servido por `curl` **não contém o edoc** (`grep -c` = 0), porque é SPA que lê
a query no cliente: **validar permalink por `curl`+`grep` dá falso negativo**.

## 🔴 Quem identifica o documento é o e-doc, não o processo

`documento_edoc:B0AB532D` → **1** (controle `ZZZZZZZZ` → 0). Já o processo `4518/2020`
devolve **4 documentos**.

🔴 **E o TCDF usa dois números de processo diferentes, só um indexado**: no índice é
`00600-00004518/2020-04` (SEI-GDF) e na tela do permalink é `4518/2020-e`. Quem copiar o
número da tela e procurar pelo texto exato não acha. O `Checker` aceita os dois.

🔴 **E o número cru derruba a busca com HTTP 500** (a armadilha do TJPI, aqui por outro
motivo): `q=4518/2020` e `q=00600-00004518/2020-04` respondem `{code:500}` porque **a barra
abre delimitador de regex** no `query_string`. Tem de ir entre aspas ou escopado em campo.

⚠️ `processo_numero:4518` **sozinho** devolve 5 documentos de anos diferentes, inclusive um
de 2012: sem o ano o número é ambíguo.

## ✅ Paginação estável; profundidade limitada a 10.000

A mesma página (`nepotismo`, `from=0`, `maxPerPage=10`) rodada **3 vezes** devolveu os 10
ids idênticos e na mesma ordem, sem cookie — não há o problema de desempate do TJRJ/TJMG.
Na tela a paginação é **scroll infinito** (27 cards no DOM após a busca, 114 depois de
rolar até o fim), sem paginador.

🔴 `from + maxPerPage <= 10000` (`max_result_window` do ES): `from=9975` com
`maxPerPage=25` (soma 10000) responde 200 com 0 hits; `from=9999` responde **HTTP 500**.
Com 18.370 documentos, **não se pagina a base inteira por offset** — fatie por `--ano`.

## 🔴 Sem CNJ, sem DataJud — e sem plano B

O documento é `<número>/<ano>` (4760/2020): `src/cnj.js` reprovaria todo documento válido.
E o DataJud é do CNJ, que cobre o **Judiciário** — contas não tem alias `api_publica_*`.
`dadosabertos.tc.df.gov.br` **não tem registro DNS** (curl exit 6). Existe
`api-sorteio-relator.tc.df.gov.br`, mas é distribuição de processos, não jurisprudência.
**Se o portal cair, não há para onde apelar** — como em todo o Bloco 5 menos o TCE-RS.

## ⚠️ As combos da tela são top-10 do Elasticsearch, não o domínio

O próprio JSON denuncia por `sum_other_doc_count`: `Ano` traz 10 buckets com **545
documentos fora**, `Relator` traz 10 com **229 fora**. Filtrar por um relator ausente do
combo **funciona** (o filtro aceita string livre); quem tratar o combo como domínio fechado
conclui que o relator não existe.

## Pendências declaradas

- O caminho do **CAS até o PDF** não foi fechado.
- Os módulos `/publica/` (todas as bases — que **sem `q` devolve corpo vazio**, não JSON:
  ali o termo parece obrigatório) e `/boletim/` (189) só tiveram o total medido.
- `filter[artigo]`, `filter[paragrafo]`, `filter[inciso]`, `filter[alinea]`: **não medidos**.
- Filtrar por **data de publicação**: não medido.
- **Rate limit não medido** — nenhuma recusa em ~80 chamadas.
- `/swagger` e `/openapi` em `api-busca-publica`: **não sondados**.
- A escada **card → documento pela TELA** não foi mapeada: o clique no marcador `e-doc` não
  casou o seletor (timeout de 8 s, zero XHR). O caminho até o documento está provado pela
  API e pelo permalink — **não pelo clique**.
