# TCE-RJ — Tribunal de Contas do Estado do Rio de Janeiro

**Comando:** `./bin/jur tcerj` · **Status:** 🟢 OK (API REST pública, HTTP direto, sem
browser, **sem captcha**) · Mapeado em 16/08/2026.

**Escopo: CONTROLE EXTERNO, não Judiciário.** Contas públicas, licitação, contrato
administrativo e atos de pessoal do **Estado do RJ e dos municípios fluminenses**. Para a
mesma matéria já judicializada o caminho é `tjrj`/`tjrj-ejuris` (estadual) ou `trf2`
(federal). **Não ofereça o `tcerj` para matéria cível, penal, trabalhista ou
previdenciária** — ele não tem esse acervo, e o zero seria o tribunal errado.

---

## 🔴 As três ressalvas que mudam a resposta ao usuário

### 1. A CAPITAL NÃO ESTÁ NESTA BASE — e isso foi medido, não presumido

O **Município do Rio de Janeiro é do TCM-RJ**, órgão separado que este repo **não cobre**.
A prova saiu do próprio portal, sem pesquisa externa: o combo de município da Pesquisa
Textual traz **93 opções** = "Selecione" + "ESTADO DO RIO DE JANEIRO" + **91 municípios**,
e o Rio de Janeiro tem **92**. A única ausente é a capital.

➡️ **Pedido sobre contas da Prefeitura do Rio não tem resposta aqui.** Diga isso em vez de
entregar o número baixo como se fosse o acervo. (A armadilha do TCM é **falsa** em PR, SC
e RS; é **verdadeira** em SP e aqui.)

### 2. A base é CURADA e pequena — 1.089 documentos, não o acervo do tribunal

A "Jurisprudência Selecionada" é a seleção de ementas feita pelo **Serviço de
Jurisprudência (SJU)** a partir das decisões plenárias. **Não é o acervo de decisões do
TCE-RJ.** Nunca relate 1.089 como "a jurisprudência do TCE-RJ".

✅ Em compensação a qualidade é alta: **100% dos documentos têm ementa** (1.089/1.089),
todos "Publicado", a ementa vem **íntegra na busca** e há **permalink em PDF**.
✅ **Base corrente**, mas curta e com defasagem na ponta: começa em **jul/2021** e o voto
mais recente é de **22/06/2026** (2021=74, 2022=148, 2023=251, 2024=270, 2025=235,
2026=111). Pedido anterior a 2021 não tem resposta aqui.

O acervo grande está na **Pesquisa Textual** (`liana-pesquisa-externo`), que é busca
**processual sem ementa** e **não está implementada** — ver
`human-codegen/TCERJ/02-pesquisa-textual/`.

### 3. ACENTO É OBRIGATÓRIO — o índice NÃO normaliza

`licitacao` = **0** contra `licitação` = **267**. Padrão TJMS/TJBA/TJPB.
**Zero aqui é quase sempre acento faltando, não ausência de julgado.** O crawler avisa.

---

## Operadores — os portugueses funcionam, os ingleses derrubam, e o `NÃO` **deflaciona**

| Query | Total | Leitura |
|---|---|---|
| `licitação` | 267 | |
| `pessoal` | 180 | |
| `licitação pessoal` (espaço) | 7 | **espaço = E (AND)** |
| `licitação E pessoal` | 7 | ✅ `E` funciona |
| `licitação OU pessoal` | 440 | ✅ `OU` funciona — **aritmética exata**: 267+180−7 |
| `licitação NÃO pessoal` | **5** | 🔴 **não exclui** (exclusão daria 260) |
| `licitação NÃO zzzinexistente` | **0** | 🔴 a prova: exclusão daria 267 |
| `licitação NAO pessoal` (sem acento) | **0** | 🔴 zera |
| `licitação AND pessoal` | **HTTP 500** | 🔴 derruba a busca |
| `licitação OR pessoal` | **HTTP 500** | 🔴 derruba a busca |
| `licita*` / `licita` | 0 / 0 | 🔴 sem curinga, sem stemming |

🔴 **`NÃO` NÃO EXCLUI — ELE DEFLACIONA.** O botão existe na tela e insere o token, mas ele
vira **palavra** e entra no AND. O repo já catalogou operador que **zera** (TJMS), que
**infla** (TJBA/TJES/TJTO) e que é **ignorado** (TJMT); este é o **quarto modo**:
deflaciona para um número pequeno e **plausível** — 5 resultados se leem como "busca
específica", não como operador quebrado. **Não existe operador de exclusão neste portal.**
✅ Já `AND`/`OR` darem HTTP 500 é a boa notícia: sintoma visível, não zero calado.

## 🔴 O campo de relator se chama `conselheiro` — `relator` é ignorado em silêncio

Use **`--conselheiro "<nome>"`**. Medido com o mesmo nome válido, contra o acervo de 1.089:

| Campo | Total |
|---|---|
| `conselheiro` | **342** ✅ filtra |
| `relator`, `relatorNome`, `relatorId`, `nomeRelator`, `relatores`, `relatorVencedor` | 1.089 ❌ ignorados |
| `relator` = "ZZZ INEXISTENTE" | 1.089 ❌ (prova de ignorado) |

O engano é completo porque **`relator` existe no payload de resposta**: o nome óbvio está
lá, e como *filtro* é descartado sem erro. ➡️ **Nome de campo na resposta ≠ nome de campo
no filtro.** O `-r` do CLI é alias e **avisa**.

## Flags

| Flag | O que faz |
|---|---|
| `-q "<termo>"` | Busca textual. **Com acento.** |
| `-n "<número>"` | Consulta por processo (aceita `103.885-0/2026` e `10388502026`) |
| `--macro-tema <id>` | 1=Auditoria, 2=Contas, 3=Licitações e Contratos, 4=Pessoal, 5=Recurso, 6=Representação, 7=Direito Processual |
| `--tema <id>` | Tema (subordinado ao macro-tema) |
| `--conselheiro "<nome>"` | **O filtro de relator que funciona** |
| `-di/-df` | Janela da **data do VOTO** (DD/MM/YYYY) |
| `-dpi/-dpf` | Alias de `-di/-df` — **não existe data de publicação** nesta base; o crawler avisa |
| `--page-size <n>` | Sem teto medido: `--page-size 1089` traz o acervo inteiro numa requisição |
| `--fetch-inteiro-teor` | Baixa o PDF público do acórdão (1 GET por documento) |
| `--verificar N` | Audita N resultados baixando o PDF |
| `--listar-filtros` | Macro-temas e conselheiros, direto do servidor |

## Exemplos

```bash
./bin/jur tcerj -q "licitação" -m 2
./bin/jur tcerj -q "licitação OU pessoal" --macro-tema 3
./bin/jur tcerj --conselheiro "Marianna Montebello Willeman" -di 01/01/2025 -df 31/12/2025
./bin/jur tcerj -n "103.885-0/2026"
./bin/jur tcerj -q "contrato" --fetch-inteiro-teor --verificar 3
```

## ✅ O que está BEM (e medir isso também é o trabalho)

- **Sem captcha em etapa nenhuma** — provado mandando o POST cru, não com `grep`
  (lição do TJSE). Busca livre **e** download livre: não há assimetria de bloqueio.
- **Total EXATO**, não saturado: 26 páginas de 10 + 7 = 267.
- **Paginação estável 3/3**; página além do fim devolve lista vazia com HTTP 200, sem erro.
- **Sem teto de `tamanhoPagina`**: o acervo inteiro (1.089) vem numa requisição. Pedir
  2.000 devolve 1.089 — trunca no acervo, sem erro.
- **As datas são bem-comportadas** (raro): as duas pontas funcionam **sozinhas** e a
  janela no-op (1900→2100) devolve o acervo inteiro. Nada do `-di` que zera do TCE-PR nem
  do no-op que derruba 42% do TJES.
- **Permalink público em PDF**, confirmado em requisição limpa:
  `https://www.tcerj.tc.br/documento-webapi-externo/api/documento/acordao/<n>/<ano>`
  — **PDF de verdade** (`%PDF`, versão 1.7). Aqui o magic number **vale**, ao contrário do
  TCE-PR (envelope PKCS#7 com o PDF no offset 57). Número inventado → **404**, sem casca.
- **A ementa já vem na busca, íntegra**: `dispositivoCompleto` (verbetação em caixa alta +
  tese) é idêntico ao texto do card, 469 = 469 chars. `--fetch-inteiro-teor` só busca o PDF.

## ⚠️ O que NÃO existe

- 🔴 **Não há permalink de BUSCA** — a SPA não muda de rota. Nunca mande "o link da busca"
  do TCE-RJ como prova.
- 🔴 **Não há citação oficial pronta** (diferente de TCE-PR e TCE-SC): o crawler monta a
  citação dos campos do card.
- 🔴 **Não existe filtro por número de processo na API.** `numeroProcesso`, `processo`,
  `numeroDoProcessoFormatado` e `numeroAcordao` são **todos ignorados** (1.089 em todos,
  nas duas formas do número e com valor inventado). O `-n` recorta no **cliente** — e só é
  barato porque não há teto de página.
  ⚠️ **`-n` negativo NÃO prova que o processo não existe**: a base é curada, então a
  ausência prova apenas que **não há julgado selecionado pelo SJU** para aquele número.
  O Checker devolve essa ressalva junto; repasse-a.
- 🔴 **Não há número CNJ nem DataJud** (contas não é Judiciário): `src/cnj.js` não se
  aplica e **não existe plano B** se o portal cair — como em todo o Bloco 5.
- ⚠️ **Não há data de publicação** — o único eixo é a **data do voto**. Nunca apresente a
  data do TCE-RJ como publicação.

## ⚠️ Identidade do documento

- Quem identifica o julgado é o **`jurisprudenciaId`**, não o número do processo:
  **1.089 registros em 998 processos distintos**.
- 🔴 **E dois registros podem ser TESES DISTINTAS DO MESMO ACÓRDÃO** — medido: os ids 1162
  e 1163 apontam ambos para o acórdão `20582/2026`, logo para o **mesmo PDF**. O
  permalink é por **acórdão**, o registro é por **tese**: são dois identificadores
  diferentes para granularidades diferentes. Não conte PDFs como julgados.
- ⚠️ **2 dos 1.089 registros vêm sem `numeroAcordao`** — e sem ele não há URL de PDF nem
  permalink. O crawler marca `semInteiroTeor`.

## Domínio — o oficial é `.tc.br`

`www.tcerj.tc.br`. ⚠️ `www.tce.rj.gov.br` responde 200 e **redireciona** para lá (é alias);
`tce.rj.gov.br` **sem `www`** resolve para outro IP e dá **HTTP 000 (timeout)**. Some à
coleção "000 não é portal fora do ar" (TJPE): aqui o 000 é de um host irmão enquanto o
oficial responde normalmente.

⚠️ **Casca de HTTP 200, variante nova no repo: página de erro 404 servida com status 200.**
`/swagger/index.html` responde **HTTP 200 com 571 bytes** cujo corpo é literalmente
`<h1>Erro HTTP 404</h1>`. Quem conferisse só `resp.ok` registraria "o TCE-RJ tem Swagger".
**Leia o corpo antes de acreditar no 200.** (E `/cadastro-publicacoes/<path inventado>`
devolve o `index.html` da SPA com md5 idêntico — a armadilha conhecida de TJES/TJRR.)

## Pendências declaradas

- A **Pesquisa Textual** (acervo grande, 13+ bases, `votos` satura em 10.000) está com o
  **contrato capturado e não implementada**: o segundo salto `idDocumento` → texto do
  documento **não foi mapeado**. Ver `human-codegen/TCERJ/02-pesquisa-textual/`.
- O combo **Temas** (`temaId`) filtra (`temaId=1` devolve 1) mas **não foi enumerado**.
- `RelatoresVencedores` existe como endpoint e **não foi medido como filtro**.
- O texto do PDF **não foi conferido** contra a ementa por `pdftotext` (lição do TCE-PR).
- **Rate limit não medido.**
