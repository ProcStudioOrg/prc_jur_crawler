# TCE-PA — Tribunal de Contas do Estado do Pará

**Comando:** `jur tcepa` · **Acesso:** `http` (GET puro, sem browser) · **Status:** 🟢
**Portal:** Pesquisa Integrada — `https://www.tcepa.tc.br/pesquisaintegrada`
**Mapeado em:** 21/08/2026 (slot 1600) · `human-codegen/TCEPA/01-pesquisa-integrada/`

> ⚠️ **A entrada oficial mudou de domínio, e isso foi medido, não chutado:**
> `www.tce.pa.gov.br` responde **HTTP 302** para `www.tcepa.tc.br`. O `.tc.br` é o
> domínio novo dos tribunais de contas — o host saiu do `Location` do host oficial
> antigo, não de busca externa.

## Escopo — o que esta base cobre e o que não cobre

- **Controle externo, não Judiciário.** Contas, licitações, contratos, atos de pessoal
  (aposentadoria e pensão dominam o acervo) e consultas. **Pedido cível, penal ou
  trabalhista não tem resposta aqui.**
- ⚠️ **Os municípios paraenses são do TCM-PA**, tribunal e base diferentes. A ressalva
  da fila se confirma **por ausência de combo** (método do TCE-BA, não a prova positiva
  do TCE-PR/TCE-PE): a pesquisa avançada de `acordaos` tem **12 campos e nenhum é
  município**. Buscar conta de prefeitura paraense aqui devolve zero — **e esse zero
  não é ausência de julgado.**
- **Sem número CNJ e sem DataJud.** O processo é `TC<8 dígitos><ano>` (`TC5006241997`),
  o ato é o número do acórdão inteiro (`24768`). `src/cnj.js` reprovaria os dois, e o
  DataJud é do CNJ (Judiciário). **Não há plano B se o portal cair.**

## Acervos medidos (21/08/2026)

| Base (`-b`) | Registros | Card traz ementa? | Chave do permalink |
|---|---:|---|---|
| `acordaos` | **51.621** | ✅ ementa inteira | `numeroacordao/<n>` |
| `acordaos-plenario-virtual` | **7.701** | (não dissecado) | (não dissecado) |
| `prejulgados` | **22** | 🔴 **não tem ementa** | `numero/<n>` |
| `informativos-jurisprudencia` | **21** | `resumo`, não ementa | `codigo/<slug16>` |
| `resolucoes`, `atos`, `portarias-tcepa` | — | (não dissecado) | (não dissecado) |

⚠️ **O iframe do portal só oferece 7 bases; existem 16.** `acordaos-plenario-virtual`
e `portarias-tcepa` **não estão no iframe**. Quem mapear só o iframe perde o Plenário
Virtual inteiro.

## Uso

```bash
jur tcepa -q "aposentadoria" -m 1 --json
jur tcepa -q "licitação && dispensa" -m 3
jur tcepa -q "pensão" -di 01/01/2024 -df 31/12/2024
jur tcepa -q "contrato" -r "DANIEL MELLO"
jur tcepa -b prejulgados -q "consulta" -m 1
jur tcepa -n 24768                    # consulta por número de ACÓRDÃO
jur tcepa -q "aposentadoria" -m 1 --verificar 2
jur tcepa -q "aposentadoria" -m 1 --fetch-inteiro-teor
jur tcepa --listar-filtros
```

## 🔴 Ressalvas — leia antes de confiar num número

### 1. O WAF devolve **captcha de imagem com HTTP 200**, e o gatilho é **ritmo**
O host está atrás de um **F5 Shape** (`/TSPD/`, `<APM_DO_NOT_TOUCH>`, cookies `TS…`).
Ele não barra na primeira visita — barra depois. Medido: a **mesma URL** que devolveu
573.798 bytes de JSON às 16:02 devolveu, às 16:06, HTTP **200** `text/html` de ~46 KB
com `window["failureConfig"]` e "O que está escrito na imagem?".

- 🔴 **Não é o `User-Agent`** (a lição do TCDF **não** se repete): UA de Chrome não
  adianta depois da cota estourada, e **nem o Playwright passa** — resolver o desafio
  JS com os cookies TSPD **não destrava**.
- 🔴 **Uma navegação de browser custa muito mais que um `curl`**: a tela puxa ~40
  sub-recursos. Medido: ~14 requests de `curl` espaçados passaram; **10 navegações de
  Playwright em ~4 min bloquearam.** Aqui o browser é o cliente *mais* suspeito.
- ⏱️ **Cooldown ~6–7 minutos de silêncio** (16:09:08 bloqueado → 16:15:53 liberado).
  Sem `Retry-After`.
- ✅ O crawler **aborta com erro explícito** nesse caso (`exigirRespostaReal`). Nunca
  leia a mensagem de WAF como "não há jurisprudência". Use `--pausa` para afrouxar.

### 2. O operador `||` **não faz união — devolve o acervo inteiro**
| Consulta | Resultado |
|---|---:|
| (sem termo) | 51.621 ← acervo |
| `aposentadoria` | 19.718 |
| `pensao` | 19.447 |
| `aposentadoria && pensao` | 19.366 ✅ interseção |
| `aposentadoria -pensao` | **352** ✅ = 19.718 − 19.366, exato |
| `aposentadoria \|\| pensao` | **51.621** 🔴 |

A união correta seria 19.799. **O crawler recusa `||`** em vez de repassá-lo.

### 3. As contagens das **facetas ignoram o termo buscado**
Buscando `aposentadoria`, a faceta "Ano da sessão plenária" anuncia **1.619** para 2024.
Mas `aposentadoria ano-sessao-plenaria:"2024"` devolve **504**, e a faixa
`data-sessao-plenaria:[2024-01-01 TO 2024-12-31]` **sem termo nenhum** devolve
exatamente **1.619**. A soma das 37 facetas de ano dá **51.549** — o acervo, não a busca.
**Ler "1.619 acórdãos de 2024 sobre aposentadoria" é 3× o número real.**

### 4. `rpp` é **silenciosamente limitado a 25**
`rpp=100` responde 200, traz **25** cards, e o paginador se recalcula para 789 páginas.
O menu oferece só 10/15/20/25.

### 5. O exportador JSON existe, mas tem **teto rígido de 100** e ignora `p`/`rpp`
`…/pesquisa/resultados/exportacao?…&f=json` devolve 18 campos com a ementa inteira.
Provado por md5: `&p=1&rpp=25`, `&p=2&rpp=25` e `&p=1&rpp=100` devolvem os **mesmos
144.628 bytes**. É o **top-100 da ordenação**, não uma página — por isso o crawler
pagina a tela, não o export.

### 6. O card **muda de anatomia e de chave** conforme a base
`prejulgados` **não tem ementa nenhuma** (só extensão/tamanho/páginas do arquivo);
`informativos` tem `resumo`. Um crawler que presuma `numeroacordao` + `ementa` devolve
vazio nas outras bases **sem erro nenhum**.

### 7. As listas do card são **truncadas em 10** e os valores **têm vírgula dentro**
`ATOS DE APOSENTADORIA, REFORMA E PENSÃO - APOSENTADORIA-CONCESSÃO INICIAL` é **um**
item. Quem quebrar na vírgula inventa classes que não existem. O sufixo
" e mais outros(as) N" marca o card com `listaTruncada`; a lista completa só existe no
export JSON (separada por `;`) ou no PDF.

### 8. O número do processo **não identifica o julgado**
O acórdão 24.768 julga **41 processos**. Quem identifica é o **número do acórdão**, que
é a chave do permalink. E o PDF grafa o processo em **outro formato** (`96/55214-0` no
papel contra `TC5521401996` no índice).

## ✅ O que é confiável

- **Total exato, não saturado.** `aposentadoria` = 19.718 e a última página
  (`p=1972`, `rpp=10`) traz 8 cards: 1.971×10 + 8 = 19.718 ✔
- **Paginação profunda responde** e é **estável** (página 1 às 16:02 e às 16:28: mesmos
  documentos, mesma ordem).
- **A ementa inteira vem no card** — 1.144 chars contra 10.236 do PDF (~9×), sem
  reticências e sem `<mark>`. O destaque é aplicado no cliente.
- **Permalink público por documento**, confirmado em requisição limpa: 200
  `application/pdf` sem cookie e sem sessão, **byte a byte igual** ao botão Download
  (md5 `13b62cd949…`, 31.200 bytes, `%PDF-1.5`). **Não há captcha exclusivo do
  download**, ao contrário do TJAC.
- **Sintaxe Lucene de campo funciona**: `numeroacordao:24768` = 1 resultado (exata),
  e a **faixa** `campo:[YYYY-MM-DD TO YYYY-MM-DD]` funciona — o que importa porque a
  tela só tem `input type="date"` **de data exata**, sem as duas pontas.

## Pendências declaradas

- A **pesquisa avançada (`qa=True`) não foi submetida** — o WAF bloqueou nas duas
  tentativas. A querystring que ela gera **não foi medida**; o crawler monta o `q`
  por conta própria (a sintaxe de campo está provada, o modo `qa` não).
- Os operadores `~N`, `?`, `*`, `^N` e `"frase"` **não foram medidos por contagem**.
- Não se testou se o **slug** do permalink é decorativo.
- **Não se mediu a distribuição por ano do acervo sem termo** (só a faceta, que é
  global) — logo a "base está viva?" do TJAM ficou provada só indiretamente
  (2026 aparece nas facetas com 544).
- As bases `atos`, `resolucoes`, `portarias-tcepa`, `atas…` e `pautas…` **não tiveram
  card dissecado**.
- O **rate limit exato** do WAF (quantos requests, em que janela) foi estimado por
  observação, **não bisectado**.
