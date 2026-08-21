# TCE-MG — Tribunal de Contas do Estado de Minas Gerais

> **Comando:** `./bin/jur tcemg` · **Acesso:** HTTP direto (ASP.NET MVC), sem browser
> **Status:** 🟢 OK · **Porta:** MapJuris, `POST /TextualDadosProcesso/…`
> **Mapeamento:** [`human-codegen/TCEMG/`](human-codegen/TCEMG/) — 16/08/2026 (busca)
> e 20/08/2026 (resultados, documento e crawler)

É instância de **controle externo**, não Judiciário. Para a mesma matéria
judicializada, o caminho é `tjmg` (estadual), `trf6` (federal em MG, 2023+) ou
`trf1` (federal em MG, até 2022).

---

## 🔴 As três coisas que você precisa saber antes de usar

### 1. O portal que se chama "Jurisprudência" é o bloqueado; este é o outro

A home do TCE-MG rotula **"Jurisprudência do TCE"** o **TCJuris**
(`tcjuris.tce.mg.gov.br`), e ele está atrás de **reCAPTCHA v2 conferido no
servidor**: com sessão ASP.NET viva e o POST disparado de dentro da própria página,
`/Home/Busca` devolve HTTP 200 com a página "Ocorreu um erro…" em vez do grid.

O **MapJuris** (`mapjuris.tce.mg.gov.br`), linkado na **mesma home** como "Consultas
ao TCE", responde busca textual **sem captcha nenhum**. É a porta deste comando.
**Enumere todos os módulos antes de declarar um tribunal bloqueado.**

### 2. Esta base é só de excertos de CONSULTA — não é o acervo do TCE-MG

Medido de duas formas independentes:

- as 21 ementas de `licitação`/2025 começam **todas** com `CONSULTA.`;
- `natureza=17` (CONSULTA) devolve **exatamente** o total do sem-filtro, em 2025
  (21 = 21) **e** em 2013 (84 = 84), enquanto DENÚNCIA, REPRESENTAÇÃO e
  ACOMPANHAMENTO devolvem **0** nas duas janelas.

**Contas julgadas, denúncias, representações e acompanhamentos não estão aqui.**
Pedido sobre eles devolve zero, e esse zero é a base, não o tribunal. É o equivalente
da "Jurisprudência Selecionada" do TCDF — só que aqui **não existe a base larga por
trás** (ela está no TCJuris, atrás do captcha).

O acervo é pequeno: **9 a 98 documentos por ano**, 2008–2026.

```
2026  13 · 2025  49 · 2024  72 · 2023  43 · 2022  46 · 2021  46 · 2020  45
2019  30 · 2018   9 · 2017  14 · 2016  25 · 2015  21 · 2014  43 · 2013  84
2012  98 · 2011  77 · 2010  71 · 2009  74 · 2008  84
```

✅ Base **corrente** (documento de 10/06/2026 na amostra).
⚠️ Mas **2018 com 9 contra 2012 com 98 é ritmo de CURADORIA, não atividade do
tribunal** — não leia a série como produção do TCE-MG.

### 3. ✅ Minas Gerais NÃO tem TCM, e desta vez está PROVADO PELO ACERVO

As ementas trazem `MUNICÍPIO`, `CÂMARA MUNICIPAL`, `PREFEITURA`,
`INSTITUTO DE PREVIDÊNCIA [municipal]`, `SECRETARIA MUNICIPAL`. As consultas
municipais estão mesmo no TCE-MG.

⚠️ Em `tceba`, `tcesp`, `tcerj` e `tcego` a ressalva do TCM se apoia na **ausência de
um combo de município**, que é evidência indireta. **Aqui ela está medida no acervo.**

---

## Uso

```bash
# busca com janela de data (o jeito rápido)
./bin/jur tcemg -q "licitação" -di 01/01/2025 -df 31/12/2025

# sem janela: o crawler fatia por ANO, do mais novo para o mais antigo
./bin/jur tcemg -q "nepotismo" -m 5          # 5 anos (2026, 2025, 2024, 2023, 2022)

# consulta por número de processo (dispensa data, é o caminho rápido)
./bin/jur tcemg -n 1188139

# combos com os CÓDIGOS (é o código que filtra, não o nome)
./bin/jur tcemg --listar-filtros

# relator, por código
./bin/jur tcemg -q "licitação" -di 01/01/2025 -df 31/12/2025 -r 44

# texto e PDF em disco
./bin/jur tcemg -q "licitação" -di 01/01/2025 -df 31/12/2025 --fetch-inteiro-teor --fetch-pdf

# teses/súmulas (busca separada — ver ressalva)
./bin/jur tcemg --teses "nepotismo"

# auditoria da amostra
./bin/jur tcemg -q "licitação" -di 01/01/2025 -df 31/12/2025 --verificar 3
```

### Flags específicas

| Flag | O que faz |
|---|---|
| `-r, --relator <código>` | **Código** numérico do combo (`--listar-filtros`). O nome sozinho **não filtra** |
| `--natureza <código>` | Código numérico. Na prática a base toda é `17` (CONSULTA) |
| `--tipo-pesquisa <t>` | `IndexExcerto` (default) · `EXCERTO` (idêntico) · `INDEXACAO` (**subconjunto**) |
| `-m, --max-pages <n>` | **Fatias de ANO** percorridas quando não há `-di/-df` — não é página de grid |
| `--teses <termo>` | Busca separada de Teses/Súmulas; só diz se há, não serve para citar |
| `--listar-filtros` | Relatores (55) e naturezas (225) com os códigos |
| `--fetch-pdf` | Baixa o PDF do excerto (exige sessão) |

`-di/-df` são **data da SESSÃO**. Há data de publicação nos dados, mas **não é
filtrável** — nunca apresente o recorte do TCE-MG como sendo por publicação.

---

## Ressalvas

### 🔴 Operadores: `E`, `OU`, `NÃO` **acentuado**, `"frase"`, curinga `%`

Conferidos **por conjunto de ids**, não só por contagem (janela 2025;
`licitação` = 21, `pregão` = 7):

| Query | Total | Veredito |
|---|---|---|
| `licitação E pregão` | 7 | ✅ interseção — o conjunto **bate** com A∩B |
| `licitação AND pregão` | 7 | ✅ o inglês também funciona |
| `licitação OU pregão` | 21 | ✅ união — **bate** com A∪B |
| `"pregão eletrônico"` | 1 | ✅ frase exata |
| `licita%` | **25** | ✅ truncamento (> 21 do termo inteiro) |
| `licitação pregão` (espaço) | **0** | 🔴 espaço **não é conectivo** |
| `licitação NAO pregão` | **0** | 🔴 sem til **não é operador** |
| `licita*` / `licitação$` / `licita` | 0 | ⚠️ o curinga é `%`, e não há prefixo implícito |

### 🔴 O `NÃO` responde, restringe — e mesmo assim perde resultado

`licitação NÃO pregão` = **6**, quando a diferença real (A \ B, calculada id a id) é
**14**. Os 6 são **todos legítimos**, mas **8 documentos válidos ficam de fora em
silêncio**.

Isso é pior que um operador quebrado: quebrado **zera** e dá sintoma. Este devolve
número plausível e menor — quem usar `A NÃO B` recebe **43% do recorte que pediu**.
Para exaustividade, **busque A e B em separado e subtraia**. O crawler avisa e
**não reescreve a query**.

⚠️ Espelho do TJAC, onde é o `NÃO` acentuado que não vale e o `NAO` que funciona.
**Não herde operador de tribunal nenhum.**

### 🔴 `nomeRelator` é decorativo — quem filtra é o `codRelator`

Mandar só o nome devolve o total sem filtro (21 = 21), com HTTP 200 e resultados
plausíveis. Use `--listar-filtros` e passe o **código**.

### 🔴 `natureza` filtra, mas o valor inventado **não discrimina** — ele é ignorado

`natureza=XXINVENTADOXX` devolve **os 21 do sem-filtro**: o servidor não converte
para inteiro e **ignora o parâmetro em silêncio**. Lido sozinho, isso se lê como
sucesso. O que prova que o filtro é honrado é o par (`17` = 21, `20` = 0).

⚠️ **O controle do valor inventado é bom, mas não é universal.** No TCE-BA ele falhou
na direção oposta (inventado = 0, igual a um tipo válido porém ausente). Confira se
ele discrimina antes de confiar nele.

### ⚠️ Há um filtro na tela do TCE-MG que a própria tela não usa

O combo **Natureza** (`ddNatureza`) existe no formulário, é populado por AJAX com 225
opções — e seu valor é **descartado antes do POST** (`PesquisarExcertoIntegra` em
`TextualDadosProcesso.js` não o inclui). O parâmetro só aparece em
`DetalhesExcerto.js`. O `jur tcemg` **o envia**, e ele funciona.

### 🔴 A busca sem janela de data **não responde** — o crawler fatia por ano

| Janela | tempo |
|---|---|
| um mês | **1,7 s** |
| um ano | 12 a 25 s |
| **sem janela** | **abortado em 240 s** |

Não é bloqueio, é custo — e explica a busca que "trava" no navegador. Sem `-di/-df` o
crawler percorre ano a ano (default 3 anos) e **avisa que o total é a soma das fatias
percorridas, não o acervo**.

### 🔴 Rate limit por CRIAÇÃO DE SESSÃO — e o 429 ainda manda cookie

Depois de ~20 sessões abertas em poucos minutos, `GET /` responde **HTTP 429** com 54
bytes (`"The custom error module does not recognize this error."`), **sem
`Retry-After`** — e **continuando a mandar `set-cookie`** (os dois cookies do F5).
O que some é só o `ASP.NET_SessionId`.

Quem checar "recebi cookie?" em vez de "recebi *o* cookie?" segue adiante e colhe
302 → `/Login/LogOff` em toda requisição. ✅ O crawler reusa uma sessão só e tenta 4
vezes com espera crescente.

### ⚠️ HTTP 000 não é portal fora do ar — é cadeia TLS incompleta

`mapjuris`, `tcjuris` e `dadosabertos` mandam só a folha (`*.tce.mg.gov.br`, Sectigo
OV R36) e **omitem o intermediário**; `www.tce.mg.gov.br`, com o **mesmo certificado
curinga**, manda. Quem medisse o institucional concluiria que o TLS do tribunal está
bom. O Navigator embute o intermediário (do AIA) com `rejectUnauthorized` **ligado**
— nunca `-k`. (Mesma CA e mesmo defeito do TCE-BA.)

### ✅ Ementa em 21/21, e o texto integral já vem na busca

A seção "Parecer" do card traz **EMENTA + PARECER + NOTA DE TRANSCRIÇÃO da sessão**:
5.098 a 212.976 chars (mediana ~33 KB). `--fetch-inteiro-teor` só grava em disco.
Aqui **não há o problema do TCE-BA** (Voto = 66% do acervo, ementa em 0%) porque só
existe um tipo de documento.

⚠️ **As entidades HTML não são uniformes**: o mesmo campo vem em UTF-8 cru num
documento (`EXIGÊNCIA`) e em entidade nomeada no outro (`EXIG&Ecirc;NCIA`). O crawler
decodifica tudo.

### ✅ Permalink existe e é bom — 🔴 mas `curl` reprova por engano

```
https://mapjuris.tce.mg.gov.br/TextualDadosProcesso/DetalhesExcerto/<id>
```

No Playwright, **contexto novo e sem cookie**, renderiza **54.707 chars com a EMENTA
visível**. Mande-o ao usuário.

⚠️ O `GET` cru devolve HTTP 200 com **28.859 B de casca** — sem ementa, sem tabela do
processo, sem link de PDF — porque o conteúdo entra por AJAX. **Conferi-lo por
`curl`+`grep` dá falso negativo**, e um falso negativo convincente (a casca tem 28 KB
e parece completa). É a lição do TJRJ-eJURIS e do TCDF.

🔴 **Não existe permalink de BUSCA** — a busca é POST e a URL nunca muda.

### ⚠️ O href do PDF no card é relativo e **quebrado**

O card traz `href="Excerto/ExportPdf/<id>"`, que resolvido a partir de
`/TextualDadosProcesso` vira `/TextualDadosProcesso/Excerto/ExportPdf/<id>` →
**HTTP 404**. As rotas que servem são `/TextualDadosProcesso/ExportPdf/<id>` e
`/Excerto/ExportPdf/<id>`, **com sessão**. (O portal disfarça: `DetalhesExcerto.js`
reescreve o href depois que o grid carrega.)

### ✅ Consulta por número: exata, sem substring, e sem precisar de data

`1188139` = 1 · **`1188138` = 0** (o vizinho imediato) · `999999999` = 0.
É o oposto do TCE-BA, onde `405` arrastava `003405` e `004050`.

✅ E **o número do processo É o id do documento** (7 dígitos), conferido em 21 de 21
cards. Não há o desencontro do TCDF (dois números para o mesmo processo).

🔴 **Não há numeração CNJ e não há DataJud** (contas não é Judiciário): `src/cnj.js`
não se aplica, e **não existe segunda base**. Negativa aqui prova apenas que não há
*excerto* com esse número — não que o processo não exista no TCE-MG. O `-n` recusa
número CNJ com explicação, em vez de devolver zero silencioso.

### ⚠️ A grid segue a ÚLTIMA busca da sessão

O `gridHelper` carrega o **template de colunas**, não a consulta — quem guarda a
consulta é a sessão do servidor. Intercalar buscas e paginar devolve a página da
busca errada, com **HTTP 200 e cards válidos**, sem sintoma. É o `trocaDePagina.do`
do TJAC em ASP.NET. O crawler serializa busca→grid dentro de `buscar()`.

### ⚠️ `--teses` está incompleto

`_ListarTituloResenha` responde e o comando diz **se há** tese sobre o tema, mas o
grid dela (`ConsultarInformacaoResenha`) **não foi mapeado** e não há parser.
**Não cite tese/súmula do TCE-MG a partir deste comando.**

---

## Pendências declaradas

- `_ListarTituloResenha` sem parser; `_DetalhesResenhaExcerto` e
  `ConsultarInformacaoExcertoVinculoResenha` não tocados
- `GerarExcel=true` (exportação em lote) existe no contrato e **não foi testado**
- Ordenação (`strNomeCampoOrdenar`/`tipoOrdenacao`) **não provada**; a ordem default
  parece ser por publicação decrescente, não medida
- `tempDataLista` e `strFiltro` (busca por coluna do GridHelper) não testados
- Acervo anterior a **2008** não medido (o crawler assume 2008 como piso)
- O **TCJuris** continua bloqueado e não foi retestado em 20/08
