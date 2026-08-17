# TCE-BA — Tribunal de Contas do Estado da Bahia

**Comando:** `jur tceba` · **Status:** 🟢 OK · **Mapeado em** 17/08/2026
**Porta:** API REST pública (`proinfo.tce.ba.gov.br/rest3`), HTTP direto, sem browser,
**sem captcha em etapa nenhuma**.
Medição completa em [`human-codegen/TCEBA/01-jurisprudencia/`](human-codegen/TCEBA/01-jurisprudencia/).

É instância de **controle externo**, não Judiciário. Para a mesma matéria já
judicializada o caminho é `tjba` (estadual) ou `trf1` (federal).

---

## 🔴 A capital e os municípios NÃO estão nesta base

**Todos os 417 municípios baianos são do TCM-BA** (Tribunal de Contas dos Municípios da
Bahia), órgão **separado** que este repo **não cobre**. O TCE-BA julga o **Estado**.

Pedido sobre contas de prefeitura baiana — inclusive Salvador — **não tem resposta
aqui**. Diga isso ao usuário em vez de entregar um número baixo como se fosse o acervo.

⚠️ O que foi medido: o formulário do TCE-BA **não tem combo de município**, ao contrário
do TCE-PR (400 opções) e do TCE-RJ (91 de 92). Isso é **consistente** com a divisão de
competência, mas é a ausência do filtro que está medida, não a ausência do acervo.

(A armadilha do TCM é **verdadeira** em BA, SP, RJ, GO e PA; é **falsa** em PR, SC e RS.)

## 🔴 Não ofereça o `tceba` para matéria cível, penal, trabalhista ou previdenciária

Ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.

---

## 🔴 O termo é uma FRASE LITERAL — não há operador booleano, e o espaço não é conectivo

Primeiro portal do repo assim. Medido (`nepotismo` = 7, `súmula` = 975):

| Query | Resultado |
|---|---|
| `nepotismo E súmula` | **0** |
| `nepotismo AND súmula` | **0** |
| `nepotismo súmula` (espaço) | **0** |
| `nepotismo OU súmula` / `OR` | **0** |
| `nepotismo NAO súmula` / `NOT` | **0** |
| `"frase entre aspas"` | 🔴 **HTTP 500** |

✅ **Mas duas palavras funcionam quando são frase real do texto**: `de nepotismo` = 4,
`prática de nepotismo` = 2, `nepotismo cruzado` = 0.

**A string inteira é casada como sequência contígua.** Por isso `nepotismo súmula` = 0:
não é que falte jurisprudência sobre os dois temas — é que essa sequência não ocorre.
**Repasse esse aviso**; para cruzar dois conceitos, rode duas buscas e cruze no cliente.

✅ **Casamento por palavra inteira, e `*` é curinga de verdade** — provado pelo par
`nepotism` = **0** × `nepotism*` = **7**. ⚠️ O `$` **zera** (`nepotism$` = 0).

⚠️ **NÃO avise sobre acento** — o índice normaliza (`licitacao` = `licitação` = 125).

## 🔴 Não existe paginação: `qtRegistros` é um limiar que RECUSA

O portal manda `qtRegistros=200`. Acima disso o servidor devolve **HTTP 400** com
`NegocioException: "A sua pesquisa retornou mais de 200 ocorrências"` e **zero
documento** — não uma primeira página. E o número da mensagem **ecoa o valor pedido**,
ou seja o teto é escolha do cliente:

| `qtRegistros` | `licitação` |
|---|---|
| 200 | HTTP 400, **0 documentos** |
| 2000 | HTTP 200, **1.879** (88 s) |
| 5000 | HTTP 200, **1.879** (107 s) |
| 20000 | HTTP 200, **1.879** (83 s) |

✅ O total é **EXATO**, não saturado. O crawler manda 5000 por default (`--qt-registros`)
e, se ainda assim estourar, **fatia por ano da decisão** e avisa. Se um ano sozinho
estourar, ele diz quais ficaram de fora — a contagem então está **incompleta**, e isso
vai nos avisos.

⚠️ **A API é lenta**: 38–110 s numa busca larga. Não é bloqueio.

## 🔴 A ementa depende do TIPO, e o tipo dominante é o que não tem

Medido nos 1.879 documentos de `licitação`:

| Tipo | n | com ementa | % | média de chars do texto |
|---|---|---|---|---|
| **Voto** | 1.248 | 4 | **0%** | 18.321 |
| Resolução | 371 | 289 | 77% | 8.262 |
| **Acórdão** | 215 | 198 | **92%** | 4.755 |
| Resolução da 2ª Câmara | 29 | 29 | 100% | 2.314 |
| Decisão Monocrática | 12 | 6 | 50% | 8.725 |
| Resolução da 1ª Câmara | 4 | 4 | 100% | 3.167 |
| **total** | 1.879 | 530 | **28%** | 14.442 |

**Voto é 66% do acervo e tem ementa em 0%.** O crawler marca `semEmenta` e põe `ementa:
null` — **não apresente o texto desses documentos como ementa**. ✅ Para ementa, peça
`-t ACRDO` (92%) ou as resoluções de Câmara (100%).

✅ **O TEXTO INTEGRAL JÁ VEM NA BUSCA** (campo `resumoExibicao`), conferido contra o PDF:
a API traz do cabeçalho ao "É como voto"; o PDF só acrescenta mobília de página.
`--fetch-inteiro-teor` **só grava o PDF em disco** — o texto não custa requisição.

## 🔴 Não existe permalink por documento

O acesso ao documento é **POST** (`downloadComposicao`), logo não há URL colável.
**Nunca invente link de decisão do TCE-BA.**

✅ O PDF é **público de verdade** — 200 sem cookie e sem sessão, corpo começa em `%PDF` —
mas exige **chave composta** `idProtocolo` + `idDocumento`.

✅ Existe link do **processo** (`/servicos/processo/TCE-000405-2025`), que leva à consulta
processual, não ao julgado.

⚠️ **O permalink de BUSCA existe pela metade**: a página aceita `?termo=<x>` e dispara a
busca sozinha — mas **só o termo sobrevive**, nenhum outro filtro entra pela URL. Mandar
essa URL como prova omite o recorte em silêncio (armadilha do TJTO).

🔴 **Quem identifica o julgado é o `id` (`idDocumentoDecisao`), não o processo**: 1.879
documentos em **1.348 processos** — um processo rende Voto + Acórdão + Resolução.
A verificação é por reconsulta: `./bin/jur tceba -n "TCE/000405/2025"`.

## 🔴 A consulta por número casa por SUBSTRING

Não há CNJ nem DataJud (contas não é Judiciário) — **não existe plano B** se o portal cair.
O processo é `TCE/<sequencial 6 dígitos>/<ano>`.

| Consulta | Resultado |
|---|---|
| `numeroProtocolo=000405` + `anoProtocolo=2025` | 2, todos de TCE/000405/2025 ✅ |
| `TCE/000405/2025` (máscara) | 2, idem ✅ |
| `numeroProtocolo=405` + ano | 🔴 **6**, incluindo TCE/00**3405**/2025 e TCE/00**4050**/2025 |
| `numeroProtocolo=000405` **sem ano** | 🔴 **13**, de 2001, 2002, 2004… |
| `numeroProtocolo=999999` | 0 (o campo é honrado, não ignorado) |

O sintoma é um número **plausível**, não um erro. O `-n` do repo normaliza para 6 dígitos
e **confere no cliente** que o processo devolvido é o pedido, descartando o resto e
avisando quanto caiu. **Sempre informe o ano.**

⚠️ Resposta negativa significa "não há peça indexada para este processo", **não** "este
processo não existe".

## Datas

🔴 **Não existe filtro de data, nem de publicação.** Os únicos eixos são combos de **ano**:
`--ano-decisao`, `--ano-processo`, `--ano-exercicio` (2001–2026). Não há intervalo nem
DD/MM/YYYY.
🔴 **Não existe data de publicação** nem como campo. O que há é `dataSessaoJulgamento`
(real, e devolvida como `dataJulgamento`), que **não é filtrável**.
**Nunca apresente a data do TCE-BA como publicação.**

## Filtros que funcionam (provados por contagem)

| Flag | Parâmetro | Prova |
|---|---|---|
| `--colegiado` | `idColegiado` | ✅ **partição fecha exata**: 1ª Câmara 2 + 2ª Câmara 0 + Plenário 5 = 7 = total. Inventado (99) → 0 |
| `-r` | `idRelator` | ✅ 11923 → 1; inventado (999999) → 0. ⚠️ quer **id**, não nome. São só **7 conselheiros** |
| `--ano-decisao` | `anoDecisao` | ✅ 2025 → 2; inventado (1500) → 0 |
| `-t` | `listaIdTipoDecisao` | ✅ VOTO → 6 de 7. Multivalor por vírgula funciona (`ACRDO,VOTO`) |

⚠️ **`-t` com valor inventado também devolve 0** — igual a um tipo válido porém ausente.
Aqui o teste do valor inventado **não distingue** "ignorado" de "certo mas vazio".
⚠️ O value de Resolução no HTML do portal é `RSLÃO` (mojibake do próprio site); tanto
`RSLÃO` quanto `RSLAO` funcionam.
⚠️ `--natureza` (34 opções) está exposto e **não foi provado por contagem**.

## Base

✅ **CORRENTE** — documento mais recente medido em **06/08/2026**, 11 dias antes do
mapeamento. A série de `licitação` cobre 2002–2026 sem buraco relevante (pico em 2015).
⚠️ Isso é a série de **um termo**, não o denominador da base inteira (ressalva do TJBA):
o que se pode afirmar é que a base **não está congelada**.

## Exemplos

```bash
# busca simples (lembre: é frase literal)
./bin/jur tceba -q "nepotismo"

# ementa de verdade: peça acórdão
./bin/jur tceba -q "licitação" -t ACRDO --ano-decisao 2025

# recorte por colegiado (partição fecha exata)
./bin/jur tceba -q "licitação" --colegiado 3 --ano-decisao 2024

# combos
./bin/jur tceba --listar-filtros

# consulta por número (SEMPRE com ano)
./bin/jur tceba -n "TCE/000405/2025"

# PDF público em disco (o texto já veio na busca)
./bin/jur tceba -q "nepotismo" --fetch-inteiro-teor --output-dir ./resultados/tceba
```

## Ressalva técnica — cadeia TLS incompleta

`proinfo.tce.ba.gov.br` apresenta só o certificado folha (`*.tce.ba.gov.br`, Sectigo OV
R36) e **omite o intermediário**: `curl` e o Node falham com `unable to get local issuer
certificate`, o que se lê como **HTTP 000 / site fora do ar**. ⚠️ E o `www.tce.ba.gov.br`,
com o **mesmo certificado curinga**, responde 200 normalmente — quem medisse só o
institucional concluiria que o TLS está bom. É o **TCE-MG repetido, com a mesma CA**.

O `TCEBANavigator` embute o intermediário (baixado do AIA do próprio certificado) e
**mantém `rejectUnauthorized` ligado** — a correção é fornecer a cadeia, não desligar a
verificação. Se o crawler passar a falhar no TLS, o intermediário provavelmente rotacionou:
rebaixe de `http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt`.

## Pendências declaradas

- `--natureza`, `--ano-processo` e `--ano-exercicio` **não foram provados por contagem**.
- `nomeOrgaoUnidade`, `numeroDecisao` e `resumoDocumento` (como filtro de entrada) existem
  no cliente JS e **não foram testados**.
- O curinga `*` foi provado em **um par**; não se testou curinga no meio da palavra.
- A ressalva TCM-BA apoia-se na **ausência do combo de município**, não numa medição do
  acervo municipal.
- **Rate limit não medido**; não se sabe se os dois IPs do balanceador dessincronizam.
- Os **47 documentos sem data** na amostra de `licitação` não foram investigados.
