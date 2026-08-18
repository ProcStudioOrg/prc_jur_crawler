# TCE-PE — Tribunal de Contas do Estado de Pernambuco

**Comando:** `jur tcepe` · **Status:** 🟢 OK · **Mapeado em** 18/08/2026
**Porta:** API REST pública de gateway JHipster
(`portal.tcepe.tc.br/jurisprudencia/services/jurisprudencia/api/publico`),
HTTP direto, sem browser, **sem captcha em etapa nenhuma**.
Medição completa em [`human-codegen/TCEPE/01-jurisprudencia/`](human-codegen/TCEPE/01-jurisprudencia/).

É instância de **controle externo**, não Judiciário. Para a mesma matéria já
judicializada o caminho é `tjpe` (estadual) ou `trf5` (federal).

---

## ✅ PERNAMBUCO NÃO TEM TCM — as contas municipais ESTÃO nesta base

Ao contrário de BA, SP, RJ, GO e PA, não há Tribunal de Contas dos Municípios em
Pernambuco. O TCE-PE julga o Estado **e** os 184 municípios, **inclusive o Recife**.

Medido no próprio formulário, sem pesquisar fora do portal: o combo
`/publico/unidades-gestoras` traz **1.262 unidades**, das quais **184 "Prefeitura ..."**
e **183 "Câmara Municipal ..."**, e `unidadeGestora.equals=Prefeitura da Cidade do Recife`
devolve **2.072 deliberações**.

(A armadilha do TCM é verdadeira em BA, SP, RJ, GO e PA; falsa em PR, SC, RS e PE.)

## 🔴 Não ofereça o `tcepe` para matéria cível, penal, trabalhista ou previdenciária

Ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.

---

## 🔴 Não há operador booleano — e o "OU" da tela RESTRINGE em vez de unir

A tela oferece três botões, `E` / `OU` / `NAO`. **Nenhum dos três é operador.**
Medido (`nepotismo` = 263, `licitação` = 13.636):

| Query | Resultado |
|---|---|
| `nepotismo licitação` (espaço) | **139** — o espaço já é `E` implícito |
| `nepotismo ZZQQINVENTADO` | **0** — o controle que prova o AND |
| `nepotismo E licitação` | 139 (idêntico ao espaço) |
| `nepotismo NAO licitação` / `NÃO` | 139 |
| `nepotismo OU licitação` | 🔴 **137** — MENOS que o AND |
| `nepotismo E` / `nepotismo OU` | 263 (= termo sozinho) |
| `nepotismo AND / OR / NOT licitação` | 1 / 3 / 2 (palavras literais raras) |

`E`, `OU` e `NAO` são palavras comuns do português presentes em quase todo
documento: o `E` some no ruído e o `OU` chega a excluir os 2 documentos que não
o contêm. **`A OU B` devolve a interseção, nunca a união.** Para cruzar dois
conceitos, rode duas buscas e una no cliente.

✅ **A frase exata funciona**, por aspas ou pelo `--exata`: `"nepotismo cruzado"` = 14,
igual a `nepotismo cruzado` com `expressaoExata=true`. (No TCE-BA as aspas davam HTTP 500.)

⚠️ **Não há curinga:** `nepotism` = 0, `nepotism*` = 0, `nepotism$` = 0. O casamento
é por palavra inteira.

## 🔴 O acento NÃO é normalizado, e o erro não aparece como zero

**`licitação` = 13.636 contra `licitacao` = 40.**

Não há o zero que denunciaria o problema: sem acento a busca devolve 40 resultados
de verdade — com data, relator e texto integral — e o usuário conclui que o acervo é
pequeno. É a falha mais cara desta base, e é o **oposto** de TCE-BA e TJAC, onde o
índice normalizava. O crawler avisa sozinho quando detecta termo acentuável sem acento.

## 🔴 O default da tela omite os PARECERES PRÉVIOS

Os três tipos particionam exato (`nepotismo`): **acórdão 241 + decisão 22 + parecer
prévio 9 = 272**. Mas a tela vem com `parecerPrevio.equals=false` e devolve **263** —
3,3% a menos, e o que fica de fora é justamente a peça das **contas anuais de prefeito**.

`jur tcepe` manda os três por default. Use `--sem-parecer-previo` para reproduzir a tela.

⚠️ O quarto checkbox, `inteiroTeor`, **não é tipo de documento**: ligado sozinho devolve
272 (= sem restrição) e ligado junto com o default não muda os 263. Contagem igual =
filtro ignorado — ele fica fora da partição e o crawler o manda sempre `false`.

## 🔴 Não há ementa nesta base — o que há é o texto integral, e ele já vem na busca

Não é que o card não traga: **o payload da API não tem campo de ementa.** O crawler
devolve `ementa: null` e `semEmenta: true` em 100% dos documentos.

✅ Em compensação, `descricaoParecerProcesso` traz o **texto integral** (39.284 chars
no acórdão 1450/2026; 94.336 no parecer 0155613/2013). Por isso `--fetch-inteiro-teor`
**não faz segundo salto** — só grava o que já veio. O PDF original é opcional
(`--fetch-pdf`).

⚠️ O texto do **card da tela** tem ~1.130 chars contra 39.284 do documento (2,9%) e
vem com `<b>` em volta do termo: é **highlight/trecho**, não ementa. Nunca cite o card.

⚠️ Parte do acervo pode devolver a string literal `"Não foi possível obter o texto."`
nesse campo. É ausência de texto, não texto: o crawler marca `semTexto: true`.

## 🔴 Metade dos permalinks aponta para um host de INTRANET que é NXDOMAIN

Medido nos 272 documentos de `nepotismo`:

| Host do `linkDocumentoDeliberacao` | n | |
|---|---|---|
| `etce.tce.pe.gov.br/epp/validaDoc.seam?cod=<GUID>` | **138** (51%) | ✅ público, HTTP 200 em aba limpa (~13,4 KB) |
| `portalintranet.tce.pe/siga/downloadAPAction.do?codigo=…` | **134** (49%) | 🔴 **NXDOMAIN** |

O portal entrega o link interno no payload público sem marcar diferença. São os
documentos da era **SIGA** (o acervo antigo — todos os `PARECER` e `DECISAO` da
amostra). E para eles o PDF também não vem pela API: `/conteudo-documento/10500637/…`
responde HTTP 400 `"Não foi possivel localizar inteiro teor da deliberação"`.

✅ O que existe para esses é o **texto integral**, que veio na busca. A verificação
deles é por **reconsulta** (`jur tcepe -n 10500637`), não por link. O crawler marca
`urlPublica: true|false`, avisa quantos caíram na intranet, e o `--verificar` audita
os públicos por HTTP e os de intranet por reconsulta.

## 🔴 O combo de órgão julgador tem 13 opções e só 3 têm acervo

| Valor | `nepotismo` |
|---|---|
| `Pleno` | 99 |
| `1a. Câmara` | 86 |
| `2a. Câmara` | 78 |
| **soma** | **263 = baseline** ✅ partição exata |
| `1ª Câmara` (com `ª`) | 🔴 **0** |
| `2ª Câmara` (com `ª`) | 🔴 **0** |
| `Tribunal Pleno` | 🔴 **0** |

As variantes com `ª` e `Tribunal Pleno` **estão no combo oficial** e devolvem zero sem
erro. Quem escolhe "1ª Câmara" na tela recebe zero e lê como ausência de jurisprudência.
Use sempre as formas com `a.`. Lista completa em `orgaos-julgadores.json`.

## ⚠️ `modalidade` ignora valor inválido em silêncio — e devolve TUDO

`modalidade.in=ZZINVENTADA` devolve **54.970 = a base inteira**, não zero. Um erro de
digitação ali devolve tudo em vez de nada, que é a direção perigosa porque parece que
deu certo. O irmão `tipoProcesso.in`, com a mesma sintaxe, **zera**. Dois parâmetros
`.in` com comportamento oposto para valor inválido.

## Ressalvas de contrato

- 🔴 **`--exata` / `todasBaseExprExata` é obrigatório junto com o termo.** Omitir devolve
  **HTTP 400 com corpo `{"message":null}`** — erro mudo. O crawler sempre manda os dois.
- 🔴 **Data só em ISO `YYYY-MM-DD`.** `01/01/2026` devolve HTTP 400. O crawler aceita
  `DD/MM/YYYY` (convenção do repo) e converte.
- 🔴 **Não existe data de publicação**, nem como filtro nem como campo. O único eixo
  temporal é a **data da sessão de julgamento**. `-dpi/-dpf` são tratados como `-di/-df`
  com aviso. Nunca apresente a data do TCE-PE como publicação.
- 🔴 **Consulta por número é EXATA**, não substring (oposto do TCE-BA). A raiz
  `26100740-3` **não** encontra a peça do incidente `26100740-3AR001`.
- 🔴 **Duas eras de numeração:** `AAMMNNNN-D[sufixo]` nos recentes e **8 dígitos sem
  hífen** (`10500637`) no acervo antigo. O `Checker` aceita as duas.
- 🔴 **Quem identifica o julgado é `codigoDeliberacaoProcesso`, não o processo:**
  `10500637` devolve um `PARECER` e um `ACORDAO`, ambos com a deliberação `0155613/2013`.
- 🔴 **Não há permalink de BUSCA.** A rota de resultado é Angular sem parâmetro; colada
  em aba limpa carrega a tela vazia. Nem o meio-permalink `?termo=` do TCE-BA existe aqui.
- ✅ **Total EXATO** (header `X-Total-Count`), não saturado — e as partições por órgão e
  por tipo fecham exatas, o que contador saturado não faz.
- ✅ **Paginação estável:** 3 páginas × 5, duas rodadas, 15 ids idênticos e na mesma ordem.
- ⚠️ **A API é lenta:** 8–14 s numa busca larga (a base inteira, 54.970 documentos, levou
  12 s). Não é bloqueio.
- ⚠️ **Um HTTP 400 transitório que se lê como bloqueio.** A primeira chamada ao PDF do
  acórdão 1450/2026 devolveu `"O documento é muito recente e ainda não está disponível
  publicamente"`; a mesma chave, minutos depois, devolveu 200 em três tentativas seguidas.
  Não é embargo — é cache frio. O Navigator retenta.

## 🔴 Sem CNJ, sem DataJud — não há plano B

O processo não usa numeração CNJ e contas não é Judiciário (não há alias
`api_publica_*` no DataJud). `src/cnj.js` não se aplica. Como em todo o Bloco 5
menos o TCE-RS, se o portal cair não há segunda base.

## ⚠️ A entrada `.gov.br` da fila responde HTTP 000 — e não é site fora do ar

`https://www.tce.pe.gov.br/` → **HTTP 000**. Medido em camadas: **DNS resolve**
(dois IPs), **TCP 443 abre**, e o **TLS** é que quebra (`TLS alert, unknown CA (560)`)
porque o host apresenta só o certificado folha (`CN=*.tce.pe.gov.br`, emitido por
`Thawte TLS RSA CA G1`) e **omite o intermediário**. Fornecendo o intermediário do AIA
(`http://cacerts.thawte.com/ThawteTLSRSACAG1.crt`), 000 vira 302 → 200.

✅ **Já `portal.tcepe.tc.br`, que serve esta API, manda a cadeia completa** — por isso o
Navigator **não** embute PEM nenhum. É o inverso do TCE-BA, onde o institucional estava
bom e o host da API é que quebrava. **Meça o host que você vai usar, não o vizinho.**

⚠️ E o domínio oficial muda no caminho: `www.tce.pe.gov.br` redireciona para
`www.tcepe.tc.br/internet/`, e o link "Jurisprudência" do próprio portal aponta para
`portal.tcepe.tc.br`. `tc.br` é o domínio oficial dos Tribunais de Contas; o salto foi
**medido** a partir do institucional, não inventado.

---

## Flags

```
jur tcepe -q "<termo>"                    busca (E implícito; sem operador booleano)
          --exata                         casa como frase exata
          -n <numero>                     consulta por número (26100740-3AR001 ou 10500637)
          --orgao "Pleno|1a. Câmara|2a. Câmara"
          -r, --relator <nome>            substring; 28 nomes
          --unidade "<nome exato>"        1.262 unidades jurisdicionadas
          --modalidade <nome>             15 opções (valor inválido devolve TUDO)
          --tipo-processo <nome>          68 opções
          --deliberacao <n> --ano-deliberacao <anos>
          --sem-parecer-previo            reproduz o default da TELA (subconta 3,3%)
          --sem-acordao / --sem-decisao
          -di/-df DD/MM/YYYY              data da SESSÃO (convertida para ISO)
          --size <n>                      documentos por página (default 100)
          -m, --max-pages <n>
          --fetch-inteiro-teor            grava o texto (já veio na busca)
          --fetch-pdf                     baixa o PDF original (base64 na API)
          --verificar [n]                 audita permalinks públicos + reconsulta
          --listar-filtros                despeja os combos
          --json
```

## Exemplos

```bash
# nepotismo no Pleno, 2026
jur tcepe -q "nepotismo" --orgao "Pleno" -di 01/01/2026 -df 31/12/2026

# contas do Recife (PE não tem TCM — está aqui)
jur tcepe --unidade "Prefeitura da Cidade do Recife" -q "licitação" --size 50

# um julgado específico, com o PDF original
jur tcepe -n "26100740-3AR001"
jur tcepe -q "nepotismo" --size 5 --fetch-inteiro-teor --fetch-pdf

# auditar a amostra
jur tcepe -q "nepotismo" --size 20 --verificar 5 --json
```

## Testes

```bash
node src/TCEPETestes.js     # 13 testes de integração, incluindo as partições exatas
```
