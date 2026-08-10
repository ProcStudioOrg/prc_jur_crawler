# TJMT — Tribunal de Justiça de Mato Grosso (portal de jurisprudência)

**Status: 🟢 OK** — HTTP direto, sem browser, **sem captcha em etapa nenhuma**.
Portal: `https://jurisprudencia.tjmt.jus.br` (SPA Angular). API:
`https://hellsgate-preview.tjmt.jus.br/jurisprudencia`.
Mapeado em **08/08/2026**, crawler fechado em **10/08/2026**.
Mapeamento completo em [`human-codegen/TJMT/01-jurisprudencia/`](human-codegen/TJMT/01-jurisprudencia/).

```bash
./bin/jur tjmt -q "usucapião" -m 2
./bin/jur tjmt -q "dano moral" -dpi 01/07/2026 -dpf 31/07/2026 -t acordao
./bin/jur tjmt -n "0001375-66.2014.8.11.0033"
./bin/jur tjmt -q "usucapião extraordinária" -m 1 --fetch-inteiro-teor
./bin/jur tjmt --listar-filtros          # câmaras, classes, relatores
./bin/jur tjmt --ultima-atualizacao      # prova que a base está corrente
```

## Escopo — o que a base cobre e o que não cobre

Acervo: **1.543.508 documentos de 2º grau** (1.089.313 acórdãos + 454.195
decisões monocráticas), medido em 10/08/2026.

- ❌ **Não tem 1º grau** (sentenças). A pergunta que o TJES mandou fazer foi feita:
  aqui a resposta é não.
- 🔴 **Não tem Turma Recursal / Juizado Especial** — ver ressalva 3. Foi o
  **primeiro tribunal do repo sem essa partição**, depois seguido pelo TJPI.
- ✅ **Base CORRENTE**: indexada em **10/08/2026 04:59**, confirmado pelo endpoint
  `ultima-atualizacao-pje-acordao` (que o `--ultima-atualizacao` expõe). A lição
  do TJAM — medir a vigência antes de fechar — foi cumprida e aqui absolve.
- Matéria federal com origem no MT → `trf1`. Trabalhista → `trt23`/`tst`.

## Flags

| Flag | O que faz |
|---|---|
| `-q` | Query. **Quinto conjunto de operadores da série** — ver ressalva 1 |
| `-n` | Consulta por número de processo (aceita **com ou sem** máscara) |
| `-dpi` / `-dpf` | Janela de **publicação** (DD/MM/YYYY). `-di`/`-df` são **alias** — ver ressalva 2 |
| `-t` | `todos` (default) · `acordao` · `monocratica` — recorte de **cliente** |
| `--escopo` | `ementa` (default) · `inteiro` · `todos` — onde procurar o termo. **Só afeta acórdão** |
| `--materia` | `todas` (default) · `civel` · `criminal` — partição exata (3.851 + 1 = 3.852) |
| `--thesaurus` | Busca por sinônimos. **INFLA ~10×** — ver ressalva 6 |
| `--page-size` | Registros por página (máx. 100). **Default 20 de propósito** — ver ressalva 5 |
| `--fetch-inteiro-teor` | Grava em disco. **Sem request extra**: o texto já veio na busca |
| `--verificar N` | Audita N resultados reconsultando por número |
| `--listar-filtros` | 251 câmaras, 1.192 classes, 1.344 relatores |
| `--ultima-atualizacao` | Data da última indexação do acervo |

## Ressalvas

### 1. 🔴 Os operadores: `OU` e `NÃO` são ignorados e a busca vira **AND**

**Duas das quatro teclas que a própria tela oferece estão quebradas — e quebram
para AND, contraindo para um número plausível.** Medido (acórdãos):

| Query | Resultado | Leitura |
|---|---|---|
| `usucapião posse` (espaço) | 2.318 | ✅ **espaço = E (AND)** |
| `usucapião E posse` | 2.318 | ✅ `E` funciona |
| `usucapião OU posse` | **2.318** | 🔴 **ignorado, vira AND** — pediu união, recebeu interseção |
| `usucapião NÃO posse` | **2.318** | 🔴 **ignorado, vira AND** — pediu exclusão, recebeu interseção |
| `usucapião AND posse` | **62.387** | 🔴 **infla 27×** — o token inglês desliga o AND implícito e tudo vira OR |
| `usucapião OR/NOT posse` | ~62 mil | 🔴 idem |
| `usucapião PROXIMO posse` | 6 | ✅ funciona |
| `usucapião PROX posse` / `ADJ` | **0** | 🔴 zero silencioso |
| `"usucapião extraordinária"` | 1.106 | ✅ frase exata funciona |
| `usucapi*` | 3.890 | ✅ curinga funciona |
| `usucapi$` | **2** | ⚠️ **degenera** (padrão TJAL) — 2 se lê como busca específica |

**Para união, rode duas buscas e some.** O crawler avisa em cada um desses casos;
repasse o aviso.

⚠️ **NÃO avise sobre acento na query** — o índice normaliza
(`usucapiao` = `usucapião` = 3.852). O acento importa para o **valor do filtro**
`--materia`, não para o termo (ressalva 4).

### 2. 🔴 A janela de data filtra **PUBLICAÇÃO**, e a API lê **MM/DD/YYYY**

São dois defeitos empilhados, e o crawler contorna os dois.

**(a) O campo filtrado é publicação, não julgamento.** Provado em 10/08/2026 lendo
o par (julgamento, publicação) de cada documento: a janela de um dia
`03/08/2026` devolve **8/8 com `pub=03/08/2026`** e julgamentos espalhados por
28–30/07. A data de julgamento **existe no documento e é distinta** da de
publicação — mas **não é filtrável**. Por isso as flags são `-dpi`/`-dpf`, e
`-di`/`-df` são alias. **Nunca apresente o recorte do TJMT como sendo por data de
julgamento.**

**(b) A API lê a data no formato americano enquanto o próprio portal envia no
brasileiro.** Medido: `03/08/2026` (intenção: 3 de agosto) devolve documentos de
**março**; e quando o dia brasileiro cai no slot do mês e **passa de 12**, o parse
falha e o servidor **descarta aquele limite em silêncio, com HTTP 200** — a janela
`13/08/2026..13/08/2026` devolve **a base inteira**.

🔴 **Isso significa que o filtro de data do portal está errado para o próprio
usuário do TJMT**: no site, toda data com dia ≤ 12 devolve o mês trocado e toda
data com dia > 12 devolve o acervo todo.

✅ O `TJMTNavigator.paraDataApi()` converte antes de enviar, e depois da conversão
o dia > 12 funciona: `01/07/2026..31/07/2026` devolve 127 contra 6.151 sem janela.
O teste 5 da suíte falha de propósito se a API for corrigida — aí o contorno sai.

⚠️ **Corolário:** a "distribuição por ano" do TJMT medida em 08/08 é **falsa**
(todo `31/12` era descartado, então cada linha era "de tal ano em diante"). Refaça
com datas convertidas antes de publicar qualquer série anual.

### 3. 🔴 **NÃO existe Juizado × Justiça Comum no TJMT** — e a tela promete que existe

A desambiguação obrigatória em todo TJ do repo **não tem resposta aqui**. A tela
oferece `Colegiado: Turma Recursal` e o facet de órgão lista `Primeira Turma
Recursal`, mas:

- `filtro.colegiado` e `filtro.localConsultaAcordao` são **ignorados** (5 e 6
  valores testados, contagem idêntica em todos);
- `CountRecursalEletronico` é **0 em toda busca**, inclusive nas de consumo, onde
  a Turma Recursal deveria dominar: `dano moral` = 241.840 acórdãos, **0 recursal**.

**Pedido de jurisprudência de Juizado Especial de MT não tem resposta neste
portal** — o acervo de Turma Recursal (Projudi) não está indexado aqui. **Diga
isso ao usuário**: esse zero não é ausência de julgado. O crawler emite o aviso em
toda busca.

### 4. ⚠️ `--materia` exige o rótulo **acentuado**; sem acento zera em silêncio

`Cível` filtra (3.851), `Civel` devolve **0 sem erro**, e o id (`1`/`2`) também
devolve 0. O crawler manda o rótulo certo — só não contorne isso na mão.
✅ A partição é **exata**: 3.851 cível + 1 criminal = 3.852.

### 5. 🔴 O payload é absurdo: **33,7 MB por página de 100**

Cada acórdão carrega o inteiro teor **com o brasão embutido em base64** (~100 KB
por documento). Medido: 5 → 713 KB · 20 → 3,5 MB · 50 → 21 MB · **100 → 33,7 MB /
25,7 s**. Acima de 100 a API devolve **HTTP 500**.

Por isso `--page-size` é **20 por default**, e não 100 como nos outros tribunais.
Uma varredura de 10 páginas com 100 moveria 337 MB.

⚠️ O `TJMTCrawler.limparHtml()` remove a URI `data:image` **antes** de qualquer
outra substituição — um strip ingênuo faria a imagem inteira virar "texto" e ir
para o JSON de saída.

### 6. 🔴 `--thesaurus` infla ~10×

O checkbox "Pesquisar sinônimos (Thesauro)" da tela multiplica a contagem por
**9,7** (medido: `usucapião` vai de 6.151 para 59.606). O número grande **não é
abundância de jurisprudência sobre o termo pedido**. Default é `false`; o crawler
avisa quando você liga.

### 7. 🔴 A paginação é **INSTÁVEL** — o crawler deduplica, mas isso não recupera tudo

Não há campo de desempate na ordenação. A mesma página 2, em três execuções
seguidas, devolveu três conjuntos diferentes, com documento da página 1 de uma
execução reaparecendo na página 2 de outra (padrão TJRJ/TJMG). Reconfirmado em
10/08/2026: duas varreduras de 3 páginas descartaram 3 e 1 repetidos, e a
interseção entre execuções foi 26 de 27.

O crawler **deduplica por `Id`** e informa `repetidosDescartados` — mas **isso não
recupera o documento que o servidor deixou de mandar**. Em varredura profunda,
espere lacunas. (A correção do TJDFT — fixar o nó do balanceador por cookie —
**não foi testada**; ver pendências.)

### 8. ⚠️ Ementa e inteiro teor: **os dois tipos têm schemas diferentes**

| campo | Acórdão | Monocrática |
|---|---|---|
| `Conteudo` | **a ementa** (987–3.604 chars) | **a decisão inteira** (10,9–19,4 mil) |
| `Documento` | **o inteiro teor** (9–21 mil chars) | 🔴 **não existe** (ausente, 5/5) |

🔴 **Decisão monocrática vem SEM ementa** (padrão TJPE/TJCE). O crawler marca
`semEmenta: true` e deixa `ementa: ''` em vez de mentir sobre a natureza do texto;
a decisão inteira vai para `inteiroTeor`. **Não apresente o `Conteudo` de
monocrática como ementa.**

✅ Os dois textos **já vêm na busca**, sem captcha e sem request extra —
`--fetch-inteiro-teor` só grava em disco.

✅ **A citação oficial vem pronta** no campo `Observacao`, sem regex (ao contrário
dos quatro tribunais da família ESAJ):
`(N.U 0001375-66.2014.8.11.0033, CÂMARAS ISOLADAS CÍVEIS DE DIREITO PRIVADO, MARILSEN ANDRADE ADDARIO, Segunda Câmara de Direito Privado, Julgado em 05/08/2026, Publicado no DJE 07/08/2026)`

### 9. ⚠️ `--escopo` só afeta acórdão

`ementa` (default) = 3.852 · `inteiro` = 8.699 · `todos` = 8.702 — mas a contagem
de monocrática fica **travada em 2.299** nos três, coerente com monocrática não ter
ementa separada.

### 10. 🔴 NÃO existe permalink por documento — e `numeroProtocolo` não é o processo

✅ **O permalink de BUSCA existe e funciona em aba limpa** (raro no repo; o do TJPE
devolve zero falso).

🔴 **Mas não há URL por julgado** — o card abre ementa e inteiro teor no próprio
DOM. **Nunca invente link de acórdão do TJMT.** Quem identifica o documento é o
campo `Id` (ex. `389287396`), **não** o número do processo, que pode ter vários
julgados. A verificação é por reconsulta: `./bin/jur tjmt -n "<nº>"`.

⚠️ **A consulta por número não tem endpoint próprio** — o caminho é a busca livre
(`filtro.termoDeBusca`), que aceita **as duas formas** (com e sem máscara). O
parâmetro que parece ser o certo, `filtro.numeroProtocolo`, **não é**: com máscara
devolve **a base inteira** (ignorado), com valor inventado idem, e com 20 dígitos
devolve **0**. É um campo de protocolo interno. Por isso o `Checker` compara o
`NumeroUnico` de cada documento com o pedido e **descarta o que apenas cita** o
número no corpo (a lição do TJES).

### 11. ⚠️ `tipoConsulta` é ignorado — a aba é recorte de cliente

A resposta traz **as quatro coleções sempre**, independentemente do que se peça
(8 valores testados, inclusive um inventado, resposta equivalente). Consequência:
`-t monocratica` **não economiza banda** — cada busca já paga o custo das duas
coleções.

### 12. ✅ Sem captcha, sem cookie, sem sessão — mas **há um header obrigatório**

O gateway Kong responde **HTTP 401** (`No API key found in request`) sem o header
`token`. O valor está em claro no bundle webpack da SPA (`api_hellsgate_token`), e
o `TJMTNavigator` o carrega. Se o 401 voltar, o token foi rodado: releia o
`main.*.bundle.js`. Não há captcha em etapa nenhuma — o `site_key` do reCAPTCHA
gravado no bundle é texto de placeholder.

⚠️ **Vhost/rota curinga:** `jurisprudencia.tjmt.jus.br/path-inventado-9z` devolve
**HTTP 200** com o mesmo md5 da raiz (fallback do roteador Angular). Qualquer 200
nesse host só prova que o Angular respondeu — confira o md5, como no TJAC/TJAL.

## Pendências declaradas

- **Os facets `fqRelator` / `fqOrgaoJulgador` / `fqTipoProcesso` / `fqJulgamento` /
  `fqAssunto` não foram provados por contagem** e **não estão expostos como
  flags** — só se sabe que os ids existem no payload. `--listar-filtros` enumera
  os combos, mas não há como filtrar por eles no CLI.
- **As rotas de download de PDF/RTF/TXT não foram exercitadas** (chave composta
  `id`+`colegiado`+`origem`, hipótese lida do bundle). Não bloqueiam nada: o texto
  já vem na busca.
- **A correção do TJDFT para a paginação instável** (fixar o nó do balanceador
  reenviando o cookie de sessão) **não foi tentada**.
- **Não se procurou portal alternativo para o acervo de Turma Recursal / Projudi**
  — `jurisprudencia-antigo.tjmt.jus.br` está citado no bundle e **não foi aberto**.
  É o que fecharia o buraco da ressalva 3.
- **O módulo administrativo não foi mapeado**: `jurisprudencia-admin-api.tjmt.jus.br`
  (endpoints `/api/consulta/{tipo}`, `/adminextrajudicial/...`) foi identificado e
  é um segundo módulo inteiro.
- **A meia janela de data não foi medida** (mandar só `-dpi` ou só `-dpf`). No TJPI
  a meia janela é ignorada em silêncio; aqui o crawler avisa em vez de presumir.
- **O DataJud não foi sondado** para o TJMT — não foi preciso, mas fica como não
  medido.
- **A distribuição por ano precisa ser refeita** com as datas convertidas
  (ressalva 2) — a série medida em 08/08 é falsa e não foi substituída.
- `servicos.tjmt.jus.br` devolve 503 na raiz; **não se testou subpath** (a lição do
  TJES é que 503 na raiz não diz nada sobre o módulo).
