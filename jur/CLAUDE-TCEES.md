# TCE-ES — Tribunal de Contas do Estado do Espírito Santo

**Comando:** `./bin/jur tcees` · **Status:** 🟢 OK (HTTP direto, sem browser, **sem captcha**)
**Mapeado em:** 21/08/2026 · **Módulo:** Pesquisa de Jurisprudência (base de **excertos**)
**Mapeamento:** [`human-codegen/TCEES/`](human-codegen/TCEES/INDEX.md)

```
www.tce.es.gov.br  → HTTP 301 →  www.tcees.tc.br      (o host novo saiu do Location)
www.tcees.tc.br/jurisprudencia/  → iframe →
  https://acessoidentificado.tcees.tc.br/Publica/PesquisarExcerto/Index
POST /Publica/PesquisarExcerto/Buscar   → JSON com HTML dentro (ASP.NET MVC + Solr)
```

---

## O que este comando é — e o que ele NÃO é

🔴 **É uma base CURADA de 9.730 EXCERTOS, não o acervo de deliberações do TCE-ES.**
A própria tela avisa, no topo: *"O enunciado do excerto, elaborado pelo **Núcleo de
Jurisprudência e Súmula — NJS** ou extraído da ementa, procura retratar o entendimento
contido na deliberação da qual foi extraído, **não constituindo, todavia, um resumo
oficial da decisão** proferida pelo Tribunal."*

É o equivalente da "Jurisprudência Selecionada" do TCDF e da base curada do TCE-RJ.
**Nunca relate 9.730 como "as decisões do Tribunal de Contas do ES"**, e **nunca cite o
enunciado como se fosse a ementa oficial**. O crawler marca `semEmenta: true` em todos os
resultados e deixa `ementa: null`.

⚠️ O acervo largo de deliberações mora no módulo vizinho do mesmo host,
`/Publica/DocumentoDisponibilizado` ("Pesquisa de documentos textual"), que **não foi
mapeado** — ver "Pendências declaradas".

✅ **É controle externo, não Judiciário.** Não há matéria cível, penal, trabalhista nem
previdenciária aqui: são contas, licitações, contratos, atos de pessoal e consultas. Para
a mesma matéria judicializada, o caminho é `tjes` (estadual) ou `trf2` (federal).

---

## Escopo — o Espírito Santo NÃO tem TCM

✅ **As contas municipais estão nesta base**, e a prova saiu do **acervo** (como no
TCE-MG), não de ausência de combo:

- excerto 17365 — "Edital de Concorrência nº 1/2025, promovido pela **Prefeitura
  Municipal de Serra** e da Secretaria Municipal de Comunicação"
- excerto 11835 — consulta do Presidente da Comissão de Justiça e Redação da **Câmara
  Municipal de Vitória**, sobre portaria da Prefeitura Municipal de Vitória/ES
- PDF do excerto 8216 — "INTERESSADA — **CÂMARA MUNICIPAL DE IÚNA**"

A armadilha do Bloco 5 ("onde existe TCM, buscar contas municipais no TCE devolve zero")
é **verdadeira** em SP, RJ, BA, GO e PA; é **falsa** aqui, como em PR, SC, RS, PE e MG.

---

## Flags

| Flag | O que faz |
|---|---|
| `-q, --query` | Termo livre. **Espaço = E (AND)**. Sem operador booleano — ver ressalvas |
| `--frase` | Frase exata (campo próprio). **Aspas em `-q` NÃO fazem isso** |
| `--excluir` | Exclusão (campo próprio). A aritmética **fecha exata** |
| `--enunciado` | Restringe a busca ao enunciado do excerto |
| `-n, --numero` | Excertos de um processo `NNNNN/AAAA` (ex. `01522/2026`). **Não é CNJ** |
| `--area --tema --subtema` | Eixo temático (10 / 79 / 100 itens) |
| `--tipo-deliberacao` | 11 tipos; `21` = Acórdão (6.940 de 9.730) |
| `--colegiado` | `1` Plenário · `2` 1ª Câmara · `3` 2ª Câmara — **particiona exato** |
| `--norma --palavra-chave` | Norma citada (74) · palavra-chave (100, truncada) |
| `--atividade --natureza --especie --subespecie --classificacao` | Eixo processual |
| `-r, --relator` | **NOME exato** da faceta (o campo é `NomeRelator`, não id) |
| `-di / -df` | Janela de data **DD/MM/YYYY** — é a data da **deliberação** |
| `--ordem` | `relevancia` (default) · `data` |
| `--agrupar` | Colapsa excertos da mesma deliberação (muda os cards, **não** o total) |
| `--listar-filtros` | Dumpa as 14 facetas com contador |
| `--verificar [n]` | Audita N excertos na página de detalhe, conferindo o processo |
| `--fetch-inteiro-teor` | Baixa o **PDF** da deliberação (1 GET por excerto) |

```bash
./bin/jur tcees -q "licitação" -m 2
./bin/jur tcees --frase "segregação de funções" --colegiado 1
./bin/jur tcees -q "aposentadoria" --excluir "pensão" -di 01/01/2025 -df 31/12/2025
./bin/jur tcees -n "01522/2026"
./bin/jur tcees --listar-filtros
```

---

## Ressalvas

### 🔴 NÃO EXISTE OPERADOR BOOLEANO — e o erro RESTRINGE, não infla

O espaço já é `E` (AND) implícito. `E`/`OU`/`NÃO`/`AND`/`OR`/`NOT` viram **mais um
termo** no AND. Medido em 21/08/2026 (acervo 9.730):

| Query | Total | O que aconteceu |
|---|---|---|
| `licitação` | 3.344 | — |
| `nepotismo` | 22 | — |
| `licitação nepotismo` | **6** | AND implícito ✅ |
| `licitação E nepotismo` | 6 | "E" é termo e casa 9.670/9.730 → quase no-op |
| `licitação OU nepotismo` | **5** | 🔴 pede união, recebe **menos que o AND** |
| `licitação AND nepotismo` | **0** | 🔴 "AND" casa 9 documentos → **zera** |
| `licitação NÃO publicidade` | 2.415 | 🔴 não exclui nada: é AND com "não" |
| `licitação` + `--excluir publicidade` | **760** | ✅ 3.344 − 2.584 = 760, exato |

⚠️ **A assinatura deste tribunal é errar para MENOS, sem sintoma.** Em TJBA, TJES e TJTO o
operador errado infla e o número absurdo denuncia; aqui ele restringe, e o número pequeno
se lê como "pouca jurisprudência sobre o tema". Para **unir**, rode duas buscas e some.
O crawler avisa em cada caso — repasse o aviso.

### 🔴 Aspas em `-q` não são frase exata

`-q '"segregação de funções"'` = **70** (as aspas são descartadas → AND dos termos).
`--frase "segregação de funções"` = **60**. Números parecidos, resultados diferentes, e o
sintoma é invisível. A frase é **ordenada** (`"de funções segregação"` = 0) e
**normaliza acento** (`"segregacao de funcoes"` = 60).

### ⚠️ NÃO avise sobre acento — mas saiba que não há curinga

O índice normaliza acento e caixa e faz **stemming** português:
`licitação` = `licitacao` = `LICITAÇÃO` = `licita` = `licitar` = `licit` = **3.344**
(e `licitatório` = 1.672, `licitante` = 1.040 — stems diferentes).
🔴 O curinga **não existe**: `*` é descartado (`licita*` = 3.344, que é só o stem) e
`$` entra no token e **zera** (`licitac$` = 0).

### 🔴 O campo de data mente no nome — e data inválida é ignorada em silêncio

O campo se chama `CriacaoData` e o tooltip diz "Excertos criados no último mês", mas o que
ele filtra é a **data da deliberação** (o rótulo do eixo na tela é, aliás, "Data de
disponibilização da deliberação"). Provado: a faceta "Último mês" (16) bate exatamente com
o intervalo `21/07/2026–21/08/2026` (16), e o recorte de 2012 devolve 25 deliberações de
2012. **Nunca apresente esta data como data de criação do excerto.**

🔴 **`99/99/9999` devolve os 9.730 do acervo inteiro com HTTP 200.** Um erro de digitação
vira "busca sem filtro" com número plausível. O crawler valida antes de enviar.
✅ Meia janela funciona, e o formato ISO também é aceito.

### 🔴 `PaginaNova` é decorativo — quem pagina é `PaginaAtual`

O rodapé faz `$('#PaginaNova').val(2); $('#PaginaAtual').trigger('change')` e o JS copia um
no outro antes de submeter. Mandar `PaginaNova=2` por HTTP devolve a **página 1** com HTTP
200 e 25 cards válidos, sem sintoma nenhum (testado de 1 a 500). Mesma família da armadilha
do `<select>` decorativo do TJRJ/eJURIS. Só importa para quem chamar a API na mão.

### 🔴 A anatomia do card muda com a vintage do excerto

Os excertos recentes (redação do NJS) trazem `div.excerto-palavra-chave` com as tags e o
enunciado em `<blockquote>`. Os antigos **não têm nem um nem outro** — as tags vêm num
`<strong>[...]</strong>` dentro do próprio teor. Medido na página 1 de `licitação`:
**enunciado em 2/25**, tags no bloco novo em 8/25 (mais 13 no formato antigo). Um crawler
que presuma o card novo devolve `null` calado em 92% deles.

⚠️ E há **dois** `span-anexo-excerto` por card: só o **último** é a citação. O primeiro é o
cabeçalho oculto do botão "Copiar" (só o número da deliberação). Pegar o primeiro devolve
algo plausível e **sem data nenhuma**.

### 🔴 A citação oficial é a ÚNICA fonte de duas datas

`Data da sessão` e `Data da Publicação no DO-TCES` **não têm campo próprio** no card nem no
formulário — só existem dentro da citação pronta:

```
(TCE-ES. Controle Externo > Fiscalização > Representação. Decisão 03140/2026.
 Processo TC 01522/2026. Relator: Davi Diniz de Carvalho. Órgão Julgador:
 Ordinária/Plenário. Data da sessão: 30/07/2026, Data da Publicação no DO-TCES: 04/08/2026).
```

O crawler parseia e publica `dataJulgamento`, `dataPublicacao`, `orgaoJulgador` e
`citacaoOficial` (25/25 dos cards).

### 🔴 Quem identifica o julgado é o `idExcerto`, não o processo nem a deliberação

Uma deliberação rende **vários** excertos: no recorte "último mês" (16 excertos), o
Acórdão 00552/2026 ocupa 7 e a Decisão 03054/2026 ocupa 2. Contar processos ou PDFs
subestima. ⚠️ E o `idDocumento` (deliberação) **não é** o `idExcerto`: no excerto 17365 são
`4947446` e `17365` — trocar um pelo outro no permalink abre outro documento.

### ✅ Permalink público, confirmado em aba limpa — mas valide pelo app

`https://www.tcees.tc.br/jurisprudencia/detalhar-excerto/?id=<idExcerto>` → HTTP 200 sem
cookie. ⚠️ **Mas é a casca WordPress com iframe**: validar por `curl` + `grep` no host do
portal dá **falso negativo** (1,29 MB de casca). Quem responde de verdade é
`acessoidentificado.tcees.tc.br/Publica/DetalharExcerto/Index/?id=<id>` — e é esse que o
`--verificar` audita, conferindo o **número do processo** da página contra o do card.

🔴 **Não existe permalink de busca.** O app inteiro vive em `/Publica/PesquisarExcerto/Index`
e a busca é POST. Nunca mande "o link da busca do TCE-ES" como prova de um recorte.

### 🔴 O inteiro teor é PDF e exige CHAVE COMPOSTA

`/DocumentoDisponibilizado/BaixarDocumentoDisponibilizado?idDocumento=<id>&key=<128 hex>`
→ HTTP 200 `application/pdf` em sessão limpa. **Sem o `key`** → HTTP **302** para
`/DocumentoDisponibilizado` (não 403, não 404 — some sem erro). ✅ A chave é **estável**,
não é token de sessão: a que veio na busca continua valendo e é a mesma que a página de
detalhe publica.

🔴 **O texto NÃO vem completo no payload da busca.** O `teorExcerto` do card é o trecho que
o NJS selecionou (~5,8 mil chars, com `(...)` no lugar do que foi cortado); o PDF é a
deliberação inteira (~70 mil chars numa amostra de 32 páginas). Para o inteiro teor,
`--fetch-inteiro-teor` (25/25 baixados numa amostra, 0 falhas).

### 🔴 Bloqueio ASSIMÉTRICO: a consulta processual exige hCaptcha

| Etapa | Status |
|---|---|
| Busca de jurisprudência | 🟢 livre — HTTP 200 com `curl`, sem cookie, sem token |
| Download do PDF | 🟢 livre — sessão limpa, sem captcha |
| **Consulta processual** (`/Publica/PesquisarProcesso`) | 🔴 **hCaptcha** |

Medido: `POST /Publica/PesquisarProcesso/Pesquisar` com `NumeroProcesso=01522&AnoProcesso=2026`
→ HTTP 200 `{"success":false,"message":"O desafio captcha é obrigatório."}`.

**Consequência:** não há plano B para confirmar que um processo existe.

### 🔴 O número do processo NÃO é indexado na base de jurisprudência

Medido: `01522/2026` no campo livre = **0**; na frase exata = **0**; `01522` sozinho = **1**
— um excerto do processo *09099/2019* que apenas contém esses dígitos no corpo. Ou seja,
buscar pelo número no campo de texto dá **falso negativo e falso positivo ao mesmo tempo**.
`./bin/jur tcees -n` faz recorte no cliente sobre o campo `processo` dos cards, limitado
pela janela do ano do processo (e do seguinte).

⚠️ **Uma negativa do `-n` NÃO prova que o processo não existe** — prova que **não há
excerto** dele. A base é curada; a maior parte das deliberações nunca vira excerto. É a
mesma ressalva do TCE-RJ. Repasse-a ao usuário.

### ⚠️ A lista das facetas é truncada em 100

`Subtema` e `Palavra-chave` vêm com exatamente 100 itens (e os hidden `ContadorSubtemas` /
`ContadorPalavrasChave` confirmam 100). O que passa disso **não aparece e a tela não avisa**.
`Tema` (79), `Classificação` (85) e `Norma` (74) estão abaixo do teto, logo completos.
⚠️ `ReferenciaLegal` existe no formulário mas a faceta vem **vazia** (contador 0) — o campo
funciona, a base é que não tem esse dado indexado.

### ⚠️ `--agrupar` muda os cards, não o total

`AgruparResultados=True` colapsa os vários excertos da mesma deliberação (o documento
4937529 ocupa 6 dos 25 cards sem agrupar e 1 com), **mas o total continua contando
excertos** — a aritmética da paginação deixa de fechar. Default: desligado.

---

## O que está bem-comportado (raro o suficiente para registrar)

- ✅ **Total EXATO, não saturado.** 3.344 fecha em 134 páginas (133 × 25 + 19); os números
  não são redondos; termo inexistente devolve 0, não o acervo. **Sem teto de profundidade**:
  página 135+ devolve 0 card com HTTP 200.
- ✅ **Paginação ESTÁVEL**, testada duas vezes por relevância e por data: mesmos ids, mesma
  ordem, sem repetição nem salto (contraste com TJRJ, TJMG e TJDFT).
- ✅ **As 14 facetas foram provadas por contagem** — cada uma devolveu **exatamente** o
  contador que anunciava. E aqui **a faceta respeita o termo buscado** (`Área /
  Administração Pública` = 1.172 sem termo, 273 sobre `licitação`), ao contrário do TCE-PA,
  onde ela é global.
- ✅ **A partição por Colegiado fecha exata**: 6.223 + 1.817 + 1.690 = 9.730 (e sobre
  `licitação`: 2.068 + 676 + 600 = 3.344). Idem Atividade: 27 + 9.703 = 9.730.
- ✅ **Base CORRENTE**: o excerto mais novo é da Decisão 03140/2026, sessão de 30/07/2026,
  publicada em 04/08/2026. Distribuição por ano (deliberação): 2019 = 1.150, 2024 = 364,
  2025 = 534, 2026 = 295 até agosto; 500 documentos anteriores a 2012.
- ✅ **Sem captcha** na busca e no download; sem `__VIEWSTATE`, sem antiforgery token, sem
  cookie obrigatório.

---

## Passo 0 — o que NÃO existe (medido, não presumido)

- `dadosabertos` / `api` / `jurisprudencia` / `consulta` / `busca` em **`tce.es.gov.br` e em
  `tcees.tc.br`** → todos **NXDOMAIN**.
- `/swagger`, `/openapi.json`, `/api`, `/api-docs`, `/v1/`, `/rest/` → **404 de verdade**
  (o path de controle `/path-inventado-9z` devolve 404 do mesmo tamanho — não há casca de
  200 como no TCE-PR).
- 🔴 `/dados-abertos` **existe e está quebrado**: 301 para `/noticias/dados-abertos/`, que
  301 **para si mesmo** em loop infinito (estoura em 50 redirects, com e sem cookie jar). A
  página de dados abertos do TCE-ES está no ar e é inalcançável.
- **DataJud / CNJ não se aplicam** — tribunal de contas não é Judiciário e não há alias.
- ⚠️ A home linka **"ChatTCEES — Jurisprudência"** (`chattcees.tcees.tc.br/jurisprudencia`),
  que responde **302** para OIDC (`login.tcees.tc.br`). Exige login **e** é um assistente de
  IA: não é base oficial e não serve para citar. Registrado para o `fixer` não persegui-lo.

---

## Pendências declaradas

- 🔴 **O módulo `/Publica/DocumentoDisponibilizado` ("Pesquisa de documentos textual") NÃO
  foi mapeado.** É um formulário **GET** (`/Publica/DocumentoDisponibilizado/Pesquisar`) com
  `TextoTodasPalavras` / `TextoExpressao` / `TextoNenhumaPalavra`, janela de data,
  `IdClassificacaoProcesso`, `IdAssunto`, `IdTipoDocumento` e — o que interessa —
  **`UnidadeGestora`**, o único combo que daria a prova *positiva por contagem* de
  municípios (método do TCE-PR). É provavelmente o acervo largo de deliberações que falta.
  ⚠️ Uma tentativa de GET com `TipoDePesquisa=1&TextoTodasPalavras=licitacao` devolveu
  "Nenhum documento encontrado" — quase certamente parâmetro errado (há três flags hidden
  `PesquisaNumerica`/`PesquisaTextual`/`PesquisaAvancada`). **Não leia esse zero como base
  vazia**: é busca mal montada, não medição.
- ⚠️ **Rate limit não foi medido.** Nenhum 429 apareceu em ~130 requisições em ~30 min, mas
  isso não é o mesmo que ter procurado o teto.
- ⚠️ Os ids das facetas `Subtema` e `Palavra-chave` além do centésimo **não foram
  enumerados** (a lista é truncada no servidor).
