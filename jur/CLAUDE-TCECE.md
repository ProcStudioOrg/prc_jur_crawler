# TCE-CE — Tribunal de Contas do Estado do Ceará

> **Comando:** `./bin/jur tcece`
> **Porta:** API REST pública sobre Elasticsearch — o **Contexto**, módulo *Documentos*
> (`contexto-api.tce.ce.gov.br/documentos/buscar`). HTTP direto, sem browser, sem cookie,
> sem sessão, **sem captcha**.
> **Mapeado em** 18/08/2026 (busca e filtros) · **crawler fechado em** 22/08/2026.
> Mapeamento cru: [`human-codegen/TCECE/01-contexto-documentos/`](human-codegen/TCECE/01-contexto-documentos/).

## Escopo

Na interface e nas ferramentas de chat/MCP, o catálogo registra este tribunal sem
filtro por relator. `buscar_jurisprudencia` recusa pedidos com `relator` e orienta a
consulta ao PDF: a flag `-r` da CLI apenas avisa que o filtro será ignorado.

| | |
|---|---|
| Abrangência | **Estado do Ceará + os 184 municípios, inclusive Fortaleza** |
| Acervo do Contexto | **5.318.348 documentos** (publicado em `/documentos/total-documentos`) |
| Última carga do índice | publicada em `/documentos/data-carga` (22/08/2026 06:03) |
| Instância | controle externo (**não é Judiciário**) |
| Numeração | própria: `<sequencial>/<ano>-<dígito>` (`09815/2018-9`). **Não é CNJ** |

✅ **A armadilha do TCM é FALSA no Ceará — e por medição dupla.** O TCM-CE foi extinto
em 2017 e o acervo **migrou**: (a) `tabelas-auxiliares/localidade` traz **186 entradas
incluindo `{"id":"60","descricao":"FORTALEZA"}`**; (b) `tabelas-auxiliares/tipo-sessao`
traz `TCM - 1ª CÂMARA ORDINÁRIA`, `TCM - 2ª CÂMARA ORDINÁRIA` e `TCM - PLENO ORDINÁRIA`;
(c) processos trazem no assunto `"PROCESSO MIGRADO DO TCM (SGP)"`. A armadilha é
verdadeira em SP, RJ, BA, GO e PA — **não no CE**.

## Passo 0 — o que existe e o que NÃO existe

| Fonte | Resultado |
|---|---|
| `api-dados-abertos.tce.ce.gov.br/sim/` | ✅ Swagger real, **105 endpoints** — mas é o **SIM** (orçamento, contratos, obras municipais). **Zero endpoint de jurisprudência.** Não serve ao crawler |
| `dadosabertos.tce.ce.gov.br` | ❌ NXDOMAIN |
| `tcece.tc.br` / `www.tcece.tc.br` | ❌ NXDOMAIN — ao contrário de TCE-PE, TCE-PA e TCE-ES, **o TCE-CE não migrou para o `.tc.br`** |
| `tcewsapi.tce.ce.gov.br/{api,rest,ws,swagger-ui.html,v2/api-docs,…}` | ❌ 404/500. O nome "wsapi" **não** entrega REST: ali mora JSF |
| DataJud / CNJ | ❌ **não se aplica** — contas não é Judiciário. **Não há plano B se o portal cair** |
| `tcece.sydle.one` (tesauro TCN) | ⚠️ SaaS de **terceiro**, fora da cerca. Não usar |
| **`contexto-api.tce.ce.gov.br`** | ✅ **É A PORTA** — descoberta lendo `contexto/build/main.03360a1865.js` e confirmada pela aba Network no Playwright |
| **`api-add.tce.ce.gov.br/arquivos/documento`** | ✅ o **PDF** (inteiro teor), público |
| **`api-processos.tce.ce.gov.br/processos/porNumero`** | ✅ porta independente do `Checker` |

---

## 🔴 A ressalva que decide tudo: a busca crua NÃO é base de jurisprudência

`/documentos/buscar` indexa **o acervo documental inteiro**. A agregação
`group_by_idtipodocumento` de `nepotismo` (2.130 documentos, 82 tipos) mostra o que a
busca livre devolve:

| n | tipo |
|---|---|
| 284 | ANEXO |
| 240 | CERTIFICADO |
| 194 | ESCLARECIMENTO |
| 131 | PETIÇÃO |
| 115 | PARECER |
| … | … |
| **64** | **ACÓRDÃO** |

**3% é acórdão.** O primeiro resultado por data é um *"ANEXOS AOS ESCLARECIMENTOS"* —
papelada de processo, não julgado. Apontar o crawler para a busca crua quebraria a
invariante nº 1 do repo.

✅ **Por isso o default do `jur tcece` é "Documentos de Decisão"** — o checkbox do painel
`FILTROS` do próprio portal, sob o rótulo "Busca para Jurispridência" (sic). A lista
**não foi adivinhada**: foi capturada do XHR no Playwright em 22/08/2026.

```
{"terms":{"idtipodocumento":["4","12","25","6","13","3","172","98"]}}
```

| id | tipo |
|---|---|
| 4 | ACÓRDÃO |
| 12 | DECLARACAO DE VOTO |
| 25 | PARECER PRÉVIO |
| 6 | RELATÓRIO |
| 13 | RELATÓRIO VOTO |
| 3 | RESOLUÇÃO |
| 172 | VOTO |
| 98 | VOTO VISTA |

`nepotismo` = **2.130 cru → 239** com o filtro (11%).

🔴 **A lista palpitada estaria errada.** O mapeamento de 18/08 propunha como fallback
`633 DECISÃO`, `687 ACÓRDÃO RETIFICADOR`, `653 DESPACHO DECISÓRIO`, `5 DESPACHO
SINGULAR`, `160 SÚMULA` e `124 DECISÃO JUDICIAL` — **nenhum** está na lista oficial, e
três da oficial não estavam no palpite. **6 falsos positivos e 3 falsos negativos em 8.**
Ler o nome do tipo e deduzir "isto é decisão" não funciona.

⚠️ `--todos-documentos` desliga o filtro. Use com consciência: o crawler avisa, e
`tipo` no resultado **precisa ser conferido** antes de qualquer citação.

---

## Ressalvas medidas

### 🔴 Nenhum operador lógico funciona — e a tela anuncia os quatro

A tela exibe `E` `OU` `NÃO` `" "` sob "OPERADORES LÓGICOS". Medido termo a termo
(`nepotismo` = 2.127, `nepotismo licitacao` = 1.217):

| termo enviado | resultado |
|---|---|
| `nepotismo E licitacao` | **1.217** — idêntico ao espaço (o AND já é implícito) |
| `nepotismo OU licitacao` | **1.217** — 🔴 devolve a **interseção**, não a união. `A OU B` **restringe** |
| `nepotismo NÃO licitacao` / `NAO` | **1.217** — não exclui nada |
| `"prestacao de contas"` (aspas) | 🔴 envelope de erro, `data` nulo |

É a **quinta vez seguida no Bloco 5** que a legenda do portal descreve um operador que o
servidor não implementa (TCE-PR, TCDF, TCE-MG, TCE-PA, agora TCE-CE). **Para união, rode
uma busca por termo e some.**

⚠️ **`$` e `*` não são curinga, e é o caso perigoso**: `nepotism$` = **14** e
`nepotism*` = **31** contra 2.130 de `nepotismo`. **Não zeram** — devolvem julgados de
verdade, e quem ler "o curinga funcionou, o acervo é pequeno" perde 98% da base.

### ✅ `--palavra-exata` funciona — e é o único controle de texto que funciona

Desliga o stemming, e a própria tela diz isso no `title` do toggle
(*"não utiliza o radical da palavra"*). Provado onde a saturação não esconde:

| termo | padrão | `--palavra-exata` |
|---|---|---|
| `nepotismo` | 239 | 238 |
| **`nepotismos`** | **239** | **5** |

🔴 `buscaPesquisaExata` é **inerte** em 6 pares testados — **não há busca por frase
exata nesta base**, e por isso o crawler não expõe flag para ele.

### ✅ Acento é REMOVIDO, não só normalizado

`nepotísmo` (acento **errado**) = 2.127 = `nepotismo`; `inelegibilidádé` = 8.949 =
`inelegibilidade`; `servidão` = `servidao` = 1.476. **Não avise sobre acento aqui** — é o
inverso exato do TCE-PE, onde `licitacao` = 40 contra `licitação` = 13.636.
⚠️ Mas palavra curta e comum devolve **0** (`a`, `de`): ali o zero é **stopword**.

### 🔴 Cinco filtros do contrato estão MORTOS no índice

O bundle monta cláusulas para 16 filtros; o painel expõe 7. Os que sobram respondem
HTTP 200 e **zero**:

| campo | teste | resultado |
|---|---|---|
| `dtsessao` (data de **julgamento**) | `{"exists":{"field":"dtsessao"}}` | **0** |
| `esferajulgamento` | `{"exists":{"field":"esferajulgamento"}}` | **0** |
| `idmembrorelator` (**relator**) | 3 relatores reais + 1 inventado | **0** |
| `tpespeciecategoria` | os 4 valores do combo | **0** |
| `tpsessao` | id 11 (PLENO-ORDINARIA) | **0** |

⚠️ **Não há filtro por relator nem por data de julgamento nesta base.** Os combos existem
e estão populados (32 relatores, 19 tipos de sessão) — o **campo** é que vem `null` em
todo documento. `-r`/`--data-julgamento` existem só para **avisar**: são ignorados em vez
de zerar sua busca. Flag que não filtra mente para o usuário (lição do TCE-PR).

### ✅ Os que funcionam, provados por contagem (`nepotismo` = 2.130)

| flag | cláusula | medido |
|---|---|---|
| `--tipo 4` | `terms.idtipodocumento` | 64 ; `999999` → **0** (id inválido **não** é ignorado) |
| `--localidade 60` | `terms.idlocalidade` | 62 (FORTALEZA) ; `999999` → 0 |
| `--especie 74` | `terms.idespecie` | 731 (TOMADA DE CONTAS ESPECIAL) |
| `--setor 32` | `terms.idsetor` | 10 |
| `--processo` | `term.nrprocesso` | ~100 documentos do processo |
| `-di/-df` | `range.dtfinalizado` | 2024 → 169 ; só `-di` → 399 ; só `-df` → 1.900 |

✅ **As duas pontas da data funcionam sozinhas** — ao contrário do TCE-PR, onde uma
zerava e a outra era ignorada.
⚠️ `--entidade` existe (11.519 opções) mas **não foi provado por contagem**.

### 🔴 Sexta casca de HTTP 200 do repo: erro do servidor dentro do envelope

**Toda** resposta é `{"erros":[...],"data":{...}}` com HTTP **200**, inclusive quando o
Elasticsearch recusa:

```
{"range":{"dtfinalizado":{"gte":"2024-01-01","lte":"2024-12-31"}}}       -> 169 ✅
{"range":{"dtfinalizado":{"format":"dd/MM/yyyy","gte":"01/01/2024",…}}}  -> 169 ✅
{"range":{"dtfinalizado":{"gte":"01/01/2024","lte":"31/12/2024"}}}
                         -> HTTP 200 com {"erros":["400 Bad Request"],"data":null}
```

Quem checar `statusCode === 200` e ler `data.lista` recebe `undefined` e conclui "zero
resultados". O `Navigator` levanta erro explícito quando `erros` vem cheio.

### 🔴 O WAF bloqueia por User-Agent de headless — mas só o `www`

Medido em 22/08/2026 em `www.tce.ce.gov.br/contexto/`:

| cliente | resultado |
|---|---|
| Playwright headless **sem** override (`HeadlessChrome/…`) | página **"Web Page Blocked!"** com Attack ID |
| Playwright com UA de Chrome real | 200, o SPA carrega |
| `curl -A "<Chrome>"` | 200 |

É a lição do TJRN/TJAP pela terceira vez. ⚠️ **Os hosts de API (`contexto-api`,
`api-add`) NÃO estão atrás do WAF** — testar só a API e concluir "não há WAF" é erro.

### 🔴 O `conteudo` da busca NÃO é o inteiro teor

O ACÓRDÃO 1754/2026 (id 9343180) declara **"1/12"** na primeira linha e traz **976
chars**. Comparado com o PDF, no ACÓRDÃO 1374/2023 (id 6886405):

| fonte | chars |
|---|---|
| `conteudo` da busca | 1.007 |
| `pdftotext` do PDF público | **2.218** |

E o que falta é justamente o que importa — **a EMENTA, o RELATOR e a SESSÃO DE
JULGAMENTO só aparecem no PDF**:

```
ACÓRDÃO N° 1374 / 2023 / PROCESSO: 04747/2018-4 / ESPÉCIE: TOMADA DE CONTAS ESPECIAL
RELATOR: CONSELHEIRO SUBSTITUTO MANASSÉS PEDROSA CAVALCANTE
SESSÃO DE JULGAMENTO: 15 A 19-05-2023 - 1ª CÂMARA - VIRTUAL ORDINÁRIA
EMENTA: TOMADA DE CONTAS ESPECIAL, oriunda de denúncia acerca de …
```

⚠️ Ou seja: **`dtsessao` e `idmembrorelator` estarem mortos no índice não significa que o
dado não exista** — ele existe, no PDF, e não foi indexado. Medido em **10 de 10**
acórdãos da primeira página: `conteudo` < 5.000 chars, `semEmenta: true`.
🔴 **`--fetch-inteiro-teor` não é opcional para uso jurisprudencial** — ele grava o texto
da busca **e baixa o PDF**.

### ⚠️ Não há ementa como campo, e `dssumula` está vazio

`{"exists":{"field":"dssumula"}}` = **0** no índice inteiro. Quando há ementa, ela é um
**trecho dentro de `conteudo`** começando em `EMENTA:` — o crawler extrai quando dá e
marca `semEmenta` quando não dá. **Nunca invente.**

### 🔴 Página fixa em 10, sem parâmetro que mude

`size`, `qtd`, `tamanho`, `limit`, `from` e `pagina` = 50: **todos** aceitos com HTTP 200,
**todos** devolveram 10 itens. *Parâmetro aceito não é parâmetro obedecido* (lição do
TCE-PA). Varredura profunda custa 1 request por 10 documentos.

### ✅ Paginação por `search_after`, estável, sem teto de profundidade

Cursor = o campo `sort` do **último** documento da página (`[epoch_ms, iddocumento]`).
🔴 Array de 1 elemento (só o id) **zera silenciosamente**. Estabilidade medida: mesma
busca duas vezes → ids idênticos na mesma ordem, páginas 1 e 2 sem sobreposição.

### 🔴 O total satura em 10.000

`track_total_hits` trava em 10.000 (`texto:""` satura). Abaixo disso é **exato** — e a
prova é que os 82 buckets de `group_by_idtipodocumento` de `nepotismo` **somam exatamente
o `tamanho`**. O `--json` traz `totalExato`; se for `false`, o número **não é o total**.
✅ O tamanho real do acervo é publicado à parte: **5.318.348**.

### ⚠️ Permalink: só o PDF

O card **não tem `<a href>`** ("Visualizar completo" é um `<button>` que dispara download
por JS) e a rota do SPA nunca muda (`#/home` do início ao fim). **Não existe permalink de
interface.** O único endereço público e estável é o PDF:

```
https://api-add.tce.ce.gov.br/arquivos/documento?documento_id=<iddocumento>
```

Confirmado em sessão limpa (curl sem cookie, sem referer): 200 `application/pdf`.
🔴 **A armadilha do host:** o mesmo path em `contexto-api` responde **HTTP 406** para todo
`Accept` e toda variante de parâmetro. O 406 **não é falta de header — é host errado**.

🔴 **Quem identifica o documento é `iddocumento`**, não `nrdocumento` (que se repete entre
tipos — há VOTO 5855/2026 e ACÓRDÃO com o mesmo par) nem `nrprocesso` (que agrupa ~100
documentos).

### ⚠️ Verificação: sem CNJ, sem DataJud

A numeração é própria e não há base nacional. `./bin/jur tcece -n "40717/2019-6"`
consulta **duas portas**: o índice do Contexto **e** `api-processos/porNumero`, que é um
sistema diferente (tramitação). ✅ Ter uma segunda porta é raro no Bloco 5.
🔴 **O filtro de processo é `term` (casamento exato): sem o dígito verificador devolve
zero com HTTP 200.** O crawler avisa.
`--verificar N` audita a amostra por reconsulta **mais** download do PDF.

---

## Uso

```bash
# busca padrão — só "Documentos de Decisão"
./bin/jur tcece -q "nepotismo" -m 3

# só acórdãos, em Fortaleza, no ano de 2024
./bin/jur tcece -q "nepotismo" --tipo 4 --localidade 60 -di 01/01/2024 -df 31/12/2024

# sem stemming
./bin/jur tcece -q "nepotismos" --palavra-exata

# o acervo documental inteiro (97% NÃO é julgado — leia o aviso)
./bin/jur tcece -q "nepotismo" --todos-documentos

# combos: tipo-documento, localidade, especie, setor, entidade, situacao, ...
./bin/jur tcece --listar-filtros localidade

# consulta por processo (exige o dígito) e auditoria
./bin/jur tcece -n "40717/2019-6"
./bin/jur tcece -q "nepotismo" --verificar 3

# inteiro teor: grava o texto da busca E baixa o PDF
./bin/jur tcece -q "nepotismo" --tipo 4 --fetch-inteiro-teor --output-dir ./resultados/tcece
```

## Pendências declaradas

1. `identidade` (11.519 opções), `idinteressado` e `idsituacao` **não provados por
   contagem** — `--entidade` existe com veredito `null`.
2. `dssumula` sem teste positivo: `exists` = 0 no índice inteiro, e **SÚMULA (160) não
   está na lista oficial de "Documentos de Decisão"**.
3. **Rate limit não medido** (~120 requisições nesta sessão sem 429, mas não bisectado).
4. O JSF `tcewsapi.tce.ce.gov.br/paginas/jurisdicionadoJurisprudenciaPortal.xhtml` — o que
   o menu oficial chama de "Jurisprudência → Consulta" — **continua não mapeado**. Falta
   comparar o acervo dele com o do Contexto.
5. `/documentos/buscar-jurisprudencia` (busca sistematizada por tesauro TCN) **não tem
   campo `texto`** e é subconjunto declarado pelo próprio app; não virou flag.
6. Módulos irmãos não mapeados: `/sumulas`, `/normativos`, `/boletim` (Informativos de
   Jurisprudência), `/sessao`, `Acervo DOE-TCM`.
