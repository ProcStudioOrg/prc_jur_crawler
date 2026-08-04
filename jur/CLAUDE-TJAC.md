# TJAC — Tribunal de Justiça do Acre

**Escopo:** AC · **Status:** 🟡 busca 🟢 OK · **inteiro teor 🔴 reCAPTCHA**
**Crawler:** `src/TJACCrawler.js` · **Mapeamento:** `human-codegen/TJAC/01-cjsg/`
**Portal:** e-SAJ `cjsg` — https://esaj.tjac.jus.br/cjsg/consultaCompleta.do

> **Segundo `cjsg` com crawler neste repo** (o primeiro é o TJMS). O formulário é
> o mesmo molde do e-SAJ, mas **oito comportamentos medidos são diferentes** —
> ver a tabela abaixo. **Não generalize entre instalações do e-SAJ sem medir.**

## O que muda contra o TJMS — a tabela que evita o bug copiado

| | TJMS | **TJAC** |
|---|---|---|
| Resultados por página | 100 | **20** |
| Acento na query | **muda tudo** (3 × 3.885) | **não muda nada** (334 × 334) |
| Abas de tipo | A, H, D | **só A e D** (sem "Homologação") |
| Paginação | instável (~1 em 100 pulado) | **estável** (3/3 idênticas) |
| `trocaDePagina.do` sem sessão | HTTP 200 vazio (bug mudo) | **HTTP 404** |
| Inteiro teor (PDF) | livre, com rate limit | 🔴 **reCAPTCHA v2** |
| Permalink | existe (`getArquivo.do`) | 🔴 **não existe** |
| Estouro de 1 ano na data | zero **mudo** | zero **com aviso na tela** |
| Operador `$` | efeito mínimo (4) | **zera** (0) |
| Juizado × Justiça Comum | comum é 3× maior | **Juizado é 2,8× maior** |

## O que esta base cobre — e o que NÃO cobre

| Cobre | Não cobre |
|---|---|
| 2º grau: Câmaras Cíveis, Câmara Criminal, Órgão Especial | **1º grau (sentenças)** — é o `cjpg`, outro módulo, sem crawler |
| Turmas Recursais / Juizados Especiais | **Acervo do e-Proc** (o TJAC roda os dois sistemas) |
| Acórdãos (o grosso), monocráticas (residual: 29 × 7.649) | Súmulas e enunciados |
| Ementa **íntegra** de todos os três tipos | 🔴 **Inteiro teor (relatório + voto)** — reCAPTCHA |

### ⚠️ A lacuna do e-Proc

O TJAC roda **ESAJ e e-Proc em paralelo** (o `portal` cadastrado no
`tribunais.json` é `portal-eproc.tjac.jus.br`). O `cjsg` é o índice do **SAJ**.

Medido em 04/08/2026, o módulo de jurisprudência do e-Proc **não está habilitado**:

```
GET https://eproc2g.tjac.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
-> HTTP 200 (29.601 bytes) — mas o corpo é "Falha no processamento da solicitação."
   e o menu público NÃO tem item "Jurisprudência" (tem, inclusive, "Consulta Pública SAJ")
   (o eproc1g devolve o mesmo erro)
```

Igual ao TJMS, diferente do TJRJ (onde esse caminho funciona e virou crawler).
**Reteste periodicamente.**

## Passo 0 — API oficial: PROCURADA, NÃO EXISTE

Medido em 04/08/2026 (não é "não procurei"):

| Onde | Resultado |
|---|---|
| `dadosabertos.tjac.jus.br`, `api.tjac.jus.br`, `jurisprudencia.tjac.jus.br` | ⚠️ **resolvem DNS e dão 200 — mas NÃO são API** |
| `www.tjac.jus.br/dados-abertos`, `/transparencia/dados-abertos`, `/dados_abertos` | 404 |
| `www.tjac.jus.br/api-docs`, `/swagger-ui.html`, `cjsg/swagger-ui.html` | 404 |

⚠️ **A armadilha do DNS curinga do TJAC.** Os três subdomínios promissores
respondem HTTP 200 servindo o **mesmo HTML da home institucional** — md5
idêntico ao de `www.tjac.jus.br` (`3ef4ac90ee77235fa13dacdc3a84c1d1`). É vhost
curinga, não serviço. **DNS que resolve ≠ endpoint que existe.**

Por isso o acesso é `http` (POST direto no cjsg), não `api-oficial`.

## Bloqueio — as três respostas

| Pergunta | Resposta |
|---|---|
| Existe captcha na tela de **busca**? | **NÃO.** Sem `grecaptcha`, sem sitekey |
| A **busca** funciona sem resolver nada? | **SIM** — POST direto, sem browser, sem cookie prévio |
| O **download** do inteiro teor funciona? | 🔴 **NÃO. reCAPTCHA v2**, ver ressalva 1 |

## Uso

```bash
# básico — 2º grau, acórdãos, termo na ementa
./bin/jur tjac -q "usucapião" -m 1

# ⚠️ Juizado Especial / Turma Recursal — NO ACRE É O ACERVO MAIOR (ressalva 3)
./bin/jur tjac -q "dano moral" --origem turmas

# recorte por data de julgamento e por publicação (são filtros diferentes)
./bin/jur tjac -q "dano moral" -di 01/01/2025 -df 31/03/2025
./bin/jur tjac -q "dano moral" -dpi 01/01/2025 -dpf 31/03/2025

# intervalo maior que 1 ano: o crawler fatia sozinho (ressalva 2)
./bin/jur tjac -q "dano moral" -di 01/01/2024 -df 04/08/2026

# termo no inteiro teor, não só na ementa (aumenta recall; NÃO dá acesso ao PDF)
./bin/jur tjac -q "responsabilidade civil do Estado" --escopo inteiroTeor

# gravar a ementa íntegra em disco (o PDF NÃO vem — ressalva 1)
./bin/jur tjac -q "usucapião" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjac

# confirmar que um processo existe (Checker) — é a ÚNICA verificação possível
./bin/jur tjac -n "0714244-12.2025.8.01.0001"

# auditar a amostra contra a base
./bin/jur tjac -q "usucapião" -m 1 --verificar 5
```

## Flags específicas

| Flag | Valores | Default | O que faz |
|---|---|---|---|
| `--origem` | `comum` · `turmas` · `ambas` | `comum` | **A desambiguação Justiça Comum × Juizado.** `dados.origensSelecionadas` T/R |
| `-t, --tipo` | `acordao` · `monocratica` · `todos` | `acordao` | aba de tipo. **Não existe `homologacao`** |
| `--escopo` | `ementa` · `inteiroTeor` | `ementa` | qual campo recebe o termo |
| `-ord, --ordem` | `publicacao` · `relevancia` | `publicacao` | ordenação |
| `-r, --relator` | nome/trecho | — | campo `nmAgente` |
| `--fetch-inteiro-teor` | — | — | grava a **ementa íntegra** (o PDF é bloqueado) |
| `--tentar-pdf` | — | — | força a tentativa do PDF — só para reconferir se o bloqueio caiu |
| `--sem-sinonimos` | — | ligado | efeito **não medido** neste tribunal |
| `-di/-df` | DD/MM/AAAA | — | data de **julgamento** |
| `-dpi/-dpf` | DD/MM/AAAA | — | data de **publicação** |

Flags comuns (`-q -m -o -v --json --output-dir`) seguem o padrão do repo.
`-v/--headed` são **ignoradas** — não há browser.

---

# Ressalvas — leia antes de rodar

## 1. 🔴 O INTEIRO TEOR ESTÁ ATRÁS DE reCAPTCHA. A busca não

É a ressalva mais importante deste tribunal, e o bloqueio é **assimétrico**:

```
BUSCA     -> livre. POST direto, sem browser, sem cookie, sem captcha.
DOWNLOAD  -> reCAPTCHA v2. sitekey 6LevDTsUAAAAAN6dsn77RReaDKhYAQrOVkTUOgOD
```

`GET /cjsg/getArquivo.do?cdAcordao=<id>&cdForo=<foro>` **nunca devolve PDF**.
Devolve HTTP 200 `text/html` (~10,7 KB) com:

> "Para acessar o conteúdo do Acórdão, por favor digite o código da figura no
> campo abaixo. Esta validação lhe dará acesso para visualizar 20 resultados."

⚠️ **A sessão da busca NÃO destrava** — testado com o JSESSIONID ativo, em 3
documentos: mesma tela de captcha. Não é sessão, é captcha, e este repo não
resolve captcha.

### O que se perde e o que NÃO se perde

**Não se perde a ementa.** Ela vem **íntegra** no HTML da própria busca, e no
TJAC ela é substancial — segue o padrão estruturado do CNJ:

| Tipo | Tamanho medido da ementa |
|---|---|
| Acórdão | **~4.200 chars** |
| Turma Recursal | **~5.600 chars** |
| Decisão Monocrática | ~1.000 chars |

Com `I. CASO EM EXAME`, `II. QUESTÃO EM DISCUSSÃO`, `III. RAZÕES DE DECIDIR`,
`IV. DISPOSITIVO E TESE`, `Tese de julgamento`, `Dispositivos relevantes
citados` e `Jurisprudência relevante citada`. É conteúdo analítico real.

**Perde-se o relatório e o voto completos.** Ao responder ao usuário, diga que a
análise vem da ementa e que o inteiro teor do TJAC não é acessível — **não
apresente a ementa como se fosse o acórdão inteiro.**

`--fetch-inteiro-teor` grava um `.txt` com metadados + citação + ementa íntegra
e um bloco `=== INTEIRO TEOR ===` dizendo **NÃO DISPONÍVEL** e por quê. Ele
**não** grava o HTML do captcha com nome de acórdão.

**Reteste:** `--tentar-pdf`, ou o teste 17 de `node src/TJACTestes.js`. Se um PDF
vier, o bloqueio caiu — atualize este documento, o Navigator e a cobertura.

## 2. 🔴 NÃO EXISTE PERMALINK. A verificação é por reconsulta

Os dois candidatos, ambos descartados por medição em aba limpa:

| Candidato | Resultado |
|---|---|
| `getArquivo.do?cdAcordao=&cdForo=` | tela de reCAPTCHA, não o documento |
| popup "ementa sem formatação" | **modal — a URL não muda** ao abri-lo |
| `resultadoCompleta.do` | é POST, e a URL carrega `;jsessionid=` |

**Nunca invente link de acórdão do TJAC.** O campo `inteiroTeorLink` sai `null`
de propósito (a URL bloqueada fica em `inteiroTeorUrlBloqueada`, só para
diagnóstico). É a mesma situação do TJCE.

Para o `verificador`: a confirmação é `./bin/jur tjac -n "<nº do processo>"`.
Quem identifica o **documento** é o `cdAcordao`, não o nº do processo.

## 3. ⚠️ No Acre o Juizado é MAIOR que a Justiça Comum — 2,8×

Medido com `dano moral` na ementa, acórdãos:

```
--origem comum   (2º grau)          ->  7.649
--origem turmas  (Turmas Recursais) -> 21.353     <- 2,8× maior
--origem ambas                      -> 29.002     (soma exata: filtro aditivo)
```

Isto **inverte** o padrão de todo TJ mapeado neste repo. Consequências:

- **O default `--origem comum` esconde 74% do acervo** em matéria de
  consumo/dano moral.
- Um número baixo em `--origem comum` **não é escassez de jurisprudência**.
  Antes de dizer "o TJAC julgou pouco sobre X", rode `--origem turmas`.

Em matéria de consumo, dano moral, telefonia, bancos e transporte aéreo,
**ofereça as duas origens** ao usuário.

⚠️ E, ao contrário do TJMG e do TJCE, **a ementa da Turma Recursal do TJAC é
íntegra e é a maior das três** (~5.600 chars). Não repasse aqui o aviso genérico
do repo de que "em Turma Recursal a ementa é uma frase genérica" — neste
tribunal é falso.

## 4. ⚠️ Intervalo de data acima de 1 ano devolve ZERO

O cjsg aceita no máximo **365 dias corridos** (364 de diferença entre início e
fim). Um dia a mais e a resposta é **0**:

```
01/01/2025 -> 31/12/2025   (364 de diferença) -> 1.804
01/01/2025 -> 01/01/2026   (365 de diferença) ->     0
04/08/2025 -> 04/08/2026   (365 de diferença) ->     0
01/01/2020 -> 31/12/2025   (6 anos)           ->     0
```

Vale para julgamento **e** para publicação. É o zero mais fácil de tomar aqui,
porque **"jurisprudência do último ano" é exatamente 365 de diferença**.

Diferente do TJMS, aqui a tela **avisa** ("A faixa entre data de inicio e data
de fim deve ser de no máximo 1 ano") — mas o HTTP continua **200** e o corpo é o
formulário de volta, então um crawler ingênuo lê 0 do mesmo jeito. O
`TJACNavigator` distingue os dois casos pelo hidden:

```
estouro de 1 ano -> NENHUM totalResultadoAba-*  (totais = {})    -> "busca RECUSADA"
zero genuíno     -> totalResultadoAba-A = 0     (totais = {A:0}) -> "0 julgados"
```

**O crawler fatia sozinho** em janelas de 364 dias e avisa. Duas consequências:

- `-m N` passa a valer **por janela** — o teto real é `janelas × N` páginas;
- pedir intervalo longo **de julgamento e de publicação ao mesmo tempo** é
  recusado com erro explícito.

## 5. ⚠️ Três operadores ZERAM a busca sem erro: `ADJ`, `PROX` e `$`

Testados um a um (`dano`/`moral`, ementa, 2º grau, acórdãos; `dano` = 10.907):

| Operador | Vale? | Medição |
|---|---|---|
| espaço (E implícito) | sim | 7.649 |
| `E` | **sim** | 7.649 |
| `OU` | **sim** | 11.163 |
| `NAO` (sem acento) | **sim** | 3.258 |
| `NÃO` (com acento) | **NÃO é operador** | 6.429 — vira termo literal |
| `"frase exata"` | **sim** | 7.149 |
| `$` (radical) | **NÃO** | `usucapi$` → **0** |
| `ADJ` | **NÃO** | `dano ADJ2 moral` → **0** |
| `PROX` | **NÃO** | `dano PROX5 moral` → **0** |

**Prova de que `NAO` é o operador e `NÃO` não é:** `dano` (10.907) − `dano moral`
(7.649) = **3.258**, exatamente o que `dano NAO moral` devolve. O `NÃO`
acentuado dá 6.429, que não bate com nada — é `dano E não E moral`.

O crawler avisa nos três casos. **Escreva `NAO`, sem til.**

## 6. ✅ Acento NÃO importa — não repita a ressalva do TJMS aqui

O índice do TJAC **normaliza acentuação**. Quatro pares medidos:

```
usucapiao    ->    334   |  usucapião    ->    334
execucao     -> 11.078   |  execução     -> 11.078
prisao       ->  7.949   |  prisão       ->  7.949
alimenticia  ->    130   |  alimentícia  ->    130
```

Contagem idêntica nos quatro ⇒ o backend normaliza. Isto é o **inverso** do TJMS
(usucapiao=3 × usucapião=3.885). Avisar sobre acento neste tribunal mandaria o
usuário refazer uma busca que já estava certa — e desviaria o diagnóstico do
zero verdadeiro (que aqui é operador, ressalva 5, ou data, ressalva 4).

## 7. ✅ Total exato e paginação estável

**Total exato, não saturado** — provado: 7.649 declarado = 382 páginas × 20 +
9 na página 383. A página 384 devolve 0 cards.

**Paginação estável**: mesma página 3× na mesma sessão → 3/3 idênticas. É o
oposto do TJMS (2 variantes, ~1 documento em 100 pulado). **Não herde a margem
de erro do TJMS para o TJAC.**

(Honestidade da medição: 3 amostras, uma sessão. Não houve teste dedicado de
dessincronização entre os nós `.cjsg1`/`.cjsg2` do balanceador.)

## 8. ⚠️ `trocaDePagina.do` pagina a ÚLTIMA busca da sessão

A URL de paginação só tem `tipoDeDecisao` e `pagina` — **não identifica a
busca**. O servidor pagina o último resultado daquele JSESSIONID. Medido:

```
buscar("dano moral") -> paginar(2) -> processo 0700714-76.2023.8.01.0011
buscar("usucapião")  -> paginar(2) -> processo 0700133-73.2023.8.01.0007
```

Intercalar duas buscas no mesmo Navigator e paginar depois devolve as páginas da
**busca errada**, com HTTP 200 e cards válidos — não há sintoma. O
`TJACNavigator.paginar()` aceita a assinatura da busca esperada e recusa a
paginação órfã; o `TJACCrawler` sempre a passa. Se alguém remover essa guarda,
o bug volta e é invisível.

Sem o JSESSIONID, o `trocaDePagina.do` devolve **HTTP 404** (falha barulhenta —
melhor que o HTTP 200 vazio do TJMS).

## 9. ⚠️ Monocrática é acervo residual; não existe a aba "Homologação"

Com `dano moral`, 2º grau: **7.649 acórdãos × 29 monocráticas** (0,4%). Não é
filtro quebrado — a aba `D` responde certo, com ementa e metadados completos.
**Não prometa cobertura de monocrática do TJAC.**

E a aba `H` ("Homologação de Acordo") do TJMS **não existe aqui**. Enviá-la
responde `totalResultadoAba-H = 0` sem erro — uma aba inexistente se apresentando
como aba vazia. `--tipo homologacao` é recusado com erro explícito.

## 10. ⚠️ Busca sem termo devolve zero — não existe "listar tudo"

Com os dois campos de texto vazios (mesmo com todas as origens e tipos
marcados): **0 cards**. Para filtrar só por data ou órgão é preciso algum termo.

## 11. Cobertura temporal e encoding

Base começa por volta de **2000** (`1990` → 0; `2000` → 4; `2026` até 04/08 →
1.025). Pedido histórico anterior a 2000 não tem resposta aqui.

`Content-Type: text/html;charset=UTF-8` na tela e nas respostas — incomum para
e-SAJ clássico (o próprio e-Proc do TJAC responde ISO-8859-1). Além das
entidades acentuadas, o TJAC usa **`&sect;`** de verdade nas ementas
("CPC, arts. 509, &sect; 2º"); o decodificador cobre.

Matéria **federal** com origem no Acre → `trf1` (o AC está na 1ª Região).

---

## Manutenção

```bash
node src/TJACTestes.js            # suíte de integração (site real, 18 testes)
node src/TJACTestes.js --rapido   # pula a gravação em disco
node tests/smoke.js tjac
```

Quando quebrar, use a skill [`fixer`](skills/fixer/SKILL.md) contra os prints
de `human-codegen/TJAC/01-cjsg/`.

**O que checar primeiro num retorno vazio**, nesta ordem:
1. operador `ADJ`/`PROX`/`$` na query (ressalva 5) — zeram sem erro;
2. `NÃO` acentuado em vez de `NAO` (ressalva 5);
3. intervalo de data acima de 1 ano (ressalva 4) — e confira `formularioDeVolta`
   antes de chamar de zero;
4. `--origem` errada — **no TJAC as Turmas Recursais são o acervo maior**
   (ressalva 3);
5. paginação sem cookie — o `trocaDePagina.do` devolve **404**;
6. paginação órfã — outra busca aconteceu na mesma sessão (ressalva 8).

**NÃO** cheque acento: neste tribunal ele não muda nada (ressalva 6).
