# TRT9 — Tribunal Regional do Trabalho da 9ª Região (Paraná)

**Escopo:** PR · Justiça do Trabalho (J=5, TR=09 no número CNJ)
**Status:** OK — API JSON direta, sem browser
**Comando:** `./bin/jur trt9`
**Base:** FALCÃO — https://jurisprudencia.jt.jus.br/jurisprudencia-nacional
**Mapeamento:** [`human-codegen/TRT9/`](human-codegen/TRT9/INDEX.md)

> **O TRT9 não tem base própria.** O portal do tribunal
> (`www.trt9.jus.br/bancojurisprudencia`) só hospeda Precedentes Qualificados e ele mesmo
> manda o usuário para o Falcão. O Falcão é o acervo **nacional** da Justiça do Trabalho
> (TST + 24 TRTs + CSJT) — e é desenvolvido pelo próprio TRT9. Este crawler é o crawler
> do Falcão com `tribunais=TRT9`. Ver "Reaproveitamento" no fim.

---

## A desambiguação: 1º grau × 2º grau (não existe "Juizado" na JT)

Este é o ponto mais importante do tribunal. Na Justiça do Trabalho **não há Juizados
Especiais**: o rito sumaríssimo (Lei 9.957/2000) é julgado pela **mesma Vara do Trabalho**,
com recurso para as **mesmas Turmas**. Filtrar por classe `ATSum` separa *rito*, não *órgão*
— não serve como desambiguação.

O que separa o acervo sem ambiguidade é **grau + órgão prolator**, e o Falcão materializa
isso como **coleções** (índices separados, schemas diferentes). Uma busca vive em UMA
coleção; não dá para misturar por acidente.

| `--grau` | `colecao` | Grau | Quem decide |
|---|---|---|---|
| `1` | `sentencas` | **1º** | Varas do Trabalho, Núcleos de Justiça 4.0, CEJUSC (116 órgãos no TRT9) |
| `2` *(default)* | `acordaos` | **2º** | 1ª–7ª Turma, Seção Especializada, Órgão Especial, Tribunal Pleno (14) |
| `monocraticas` | `decisoesmonocraticas` | **2º** | gabinetes de desembargador, Presidência, Vice, Corregedoria (37) |
| `admissibilidade` | `recursorevista` | **2º** | Vice-Presidência / OJC de Análise de Recurso (13) |
| `ambos` | acórdãos + sentenças | 1º+2º | as duas consultas, concatenadas |
| `todos` | as quatro | — | |

`--colecao <a,b>` é a forma crua e sobrepõe `--grau` (é o único jeito de alcançar
`precedentes`, a base nacional de precedentes qualificados).

**Cada resultado carrega `colecao`, `grau` ("1"/"2") e `instancia` por extenso** — o
consumidor nunca precisa inferir de onde veio.

**Prova de que o filtro se aplica** (mesma query `adicional de insalubridade`, mesmo
período 01/01/2025–31/03/2025, mesmo tribunal):

```
acordaos 5693  ·  sentencas 8794  ·  decisoesmonocraticas 34  ·  recursorevista 1437
```

⚠️ Em `recursorevista` o documento traz **também** a Vara de origem, no campo
`orgaoJulgadorOrigem1Grau`. É 1º grau dentro de um documento de 2º grau — não confundir
com `orgaoJulgador`.

---

## Flags específicas

| Flag | Descrição |
|---|---|
| `-g, --grau` | **A desambiguação.** `1`, `2` (default), `monocraticas`, `admissibilidade`, `ambos`, `todos` |
| `-c, --colecao` | Coleções cruas, CSV. Sobrepõe `--grau`. Dá acesso a `precedentes` |
| `-n, --numero` | Consulta direta por nº CNJ (o verificador). Exit 0 se existe, 1 se não |
| `-oj, --orgao` | Órgão julgador — `"1ª Turma"`, `"Seção Especializada"`, `"06ª VARA DO TRABALHO DE CURITIBA"` |
| `-r, --relator` | Magistrado(a), nome completo em CAIXA ALTA |
| `-cp, --classe` | Classe pela sigla: `ROT`, `ROPS`, `AP`, `AIRO`, `ATOrd`, `ATSum`, `AR`, `MSCiv`, `DC` |
| `--prioridade` | `Idoso`, `Acidente de Trabalho`, `Assédio Moral ou Sexual`, ... |
| `--com-ementa` / `--sem-ementa` | Nem todo documento da JT tem ementa (sentenças quase nunca) |
| `--escopo` | `inteiroTeor` (default) ou `ementa` |
| `-ord, --ordenacao` | `relevancia` (default), `recentes`, `antigos` |
| `--listar-colecoes` / `--listar-orgaos` / `--listar-relatores` / `--listar-classes` / `--listar-tribunais` | Enumeram os combos (respeitam `-g`) e saem |
| `--verificar [N]` | Auditoria: reconsulta N resultados por número contra a base |
| `--full-text` / `--fetch-inteiro-teor` | Inteiro teor no JSON / gravado em `.txt` |

`-di/-df` são DD/MM/YYYY, como no resto do repo (convertidos internamente para ISO).

---

## Exemplos

```bash
# 2º grau (acórdãos das Turmas) — o caso comum
./bin/jur trt9 -q "adicional de insalubridade" -di "01/01/2025" -df "31/03/2025"

# 1º grau (sentenças de Vara do Trabalho)
./bin/jur trt9 -q "acúmulo de função" -g 1 -di "01/01/2025" -df "31/03/2025"

# Comparar as duas instâncias na mesma rodada
./bin/jur trt9 -q "rescisão indireta" -g ambos -di "01/01/2025" -df "31/03/2025"

# Uma Turma específica
./bin/jur trt9 -q "horas extras" -oj "1ª Turma" -di "01/01/2025" -df "31/03/2025"

# Uma Vara específica (1º grau)
./bin/jur trt9 -q "insalubridade" -g 1 -oj "06ª VARA DO TRABALHO DE CURITIBA"

# Descobrir os valores exatos antes de filtrar
./bin/jur trt9 --listar-orgaos            # 2º grau
./bin/jur trt9 --listar-orgaos -g 1       # 1º grau (as 116 Varas)

# VERIFICAR um julgado citado
./bin/jur trt9 -n 0000065-19.2024.5.09.0053

# Auditar uma busca inteira
./bin/jur trt9 -q "dano moral" -di "01/01/2025" -df "31/03/2025" --verificar 5

# Baixar o inteiro teor
./bin/jur trt9 -q "estabilidade gestante" -g 2 --fetch-inteiro-teor --output-dir ./resultados/trt9
```

---

## RESSALVAS (é aqui que mora o que quebra)

### 0. Rate limit: HTTP 429 sob rajada (descoberto martelando o host)

O Falcão devolve **HTTP 429 `Too Many Requests`** quando se dispara várias consultas em
sequência curta — e **não se recupera em ~45 s**. Não é bug do crawler nem bloqueio
permanente: é limite do host.

Aconteceu de verdade ao rodar, em poucos minutos, os testes de reuso contra 4 acervos
(TRT12/TRT4/TST/TRT9) + duas passadas do `tests/aceite.js` + o `tests/smoke.js`.

Consequências práticas:

- **Não rode `aceite`/`smoke`/`Testes` do TRT9 em sequência** com os testes de outros acervos
  do Falcão — todos batem no mesmo host `jurisprudencia.jt.jus.br`. Espace ou serialize.
- Ao varrer vários TRTs, **coloque intervalo entre acervos**. Paralelizar 24 TRTs vai render 429,
  não 24× a velocidade. É o oposto da regra geral do repo (tribunais diferentes em paralelo):
  aqui *tribunal diferente é o mesmo host*.
- `429` é classificado como **`bloqueio`** pelo `tests/smoke.js`, não como `erro` — a ação certa
  é **esperar**, não depurar seletor. Ver `skills/fixer/SKILL.md` §4.


### 1. CloudFront bloqueia User-Agent de robô — inclusive headless
`curl` sem `-A`, e Playwright headless com UA padrão, recebem **403 "Request blocked"**
tanto em `jurisprudencia.jt.jus.br` quanto em `www.trt9.jus.br`. Com um UA de Chrome real,
tudo passa. `FalcaoNavigator.USER_AGENT` não é decorativo — não troque por `node-fetch/1.0`.

### 2. `sessionId` é obrigatório e validado por FORMATO
Todo request precisa de `sessionId=_XXXXXXX` — underscore + **exatamente 7** alfanuméricos.
`_x1`, `_abc`, `abcdefg`, `_aaaaaaaa` → HTTP 200 com
`{"userMessage":"Tentativa inválida de acesso ao sistema"}`. Não precisa ser sessão real.

### 3. Erro de negócio vem com HTTP 200
O Falcão nunca devolve 4xx para erro de uso: devolve 200 com `{"userMessage": "..."}`.
Quem só checar `statusCode` vai processar erro como sucesso. O navigator converte em exceção.

### 4. Teto duro de 200 resultados por consulta (usuário anônimo)
`size` só aceita **5 ou 10**; `page` só vai até **19**. É a constante
`LIMITE_MAXIMO_DE_REGISTROS_PARA_USUARIO_NAO_AUTENTICADO=200` do próprio site — política,
não rate limit. **Para varrer mais, fatie por mês / órgão / classe e concatene.**
`-m` acima de 20 é silenciosamente limitado.

### 5. `quantidadeTotal` satura em 10000 — e por isso NÃO serve para comparar recortes
"10000" quer dizer "dez mil ou mais". Nunca reporte 10000 como número exato.

⚠️ **Consequência que engana:** dois recortes legitimamente diferentes podem devolver
**10000 os dois** e parecer "o filtro foi ignorado" quando ele está funcionando
perfeitamente. Aconteceu de verdade: um teste de aceite genérico comparou `-g 1` com
`-g 2` por contagem, viu 10000 = 10000 e acusou filtro ignorado — falso positivo.

**A prova correta, quando a contagem satura, é disjunção de ids**: rode os dois recortes,
colete `id`/`processo` e confirme interseção vazia. Confirmado: `-g 1` × `-g 2` têm
interseção **0**. Para provar por contagem, use query estreita o suficiente para o total
ficar abaixo de 10000 (é o que `TRT9Testes.js` faz).

### 6. Default da busca é OU, não E
`horas extras` busca "horas" **OU** "extras" — é o que a ajuda oficial diz. Query pensada
em E devolve ruído. Use `"frase exata"`.

### 7. Metade dos operadores documentados não funciona
Testado por contagem (base `insalubridade` = 2459, acórdãos TRT9 2025-Q1):

| Funciona | Não funciona |
|---|---|
| `"frase exata"` → 1872 | `+termo` → 3033 (**a ajuda oficial afirma que funciona**) |
| `-termo` → 1433 | `E` / `OU` / `NÃO` → 3033 (viram palavra literal) |
| espaço = OU implícito → 3033 | `AND` 3073 / `OR` 3051 / `NOT` 5623 (tokens, não operadores) |
| | `*` curinga → 1 resultado |

### 8. Data só em ISO — e o formato errado falha SILENCIOSAMENTE
`dataInicio`/`dataFim` em `YYYY-MM-DD`. `DD/MM/YYYY` é **ignorado** (devolve a contagem
sem filtro); `YYYYMMDD` devolve **0**; `DD-MM-YYYY` dá erro. Os nomes `dataInicial`,
`dtInicio`, `dataDe`, `periodoInicial`, `diasPesquisa` **não existem** e são ignorados sem
aviso. A CLI recebe DD/MM/YYYY e converte — não chame a API direto sem converter.

### 9. Não há filtro separado de data de publicação
Só um filtro de data (julgamento/juntada). Diferente de TJRS/TJPA, que têm os dois.
`-dpi/-dpf` não existem neste tribunal.

### 10. `orgaoJulgador` e `nomeRelator` NÃO são únicos entre tribunais
O valor enviado é `"1ª Turma"`, que existe nos 24 TRTs. Só desambigua junto com
`tribunais`. Grafia das Varas é CAIXA ALTA com zero à esquerda
(`06ª VARA DO TRABALHO DE CURITIBA`). Use `--listar-orgaos` para copiar o valor exato.

### 11. Busca por número de processo é TEXTUAL — devolve vizinhos
`0000065-19.2024.5.09.0053` devolve 2 documentos, sendo um deles de outro processo
(`0000416-67.2024.5.09.4199`). O `TRT9Checker` filtra por igualdade exata. Sem isso, o
verificador confirmaria julgado inexistente — **é o erro mais fácil de cometer aqui.**
E: número **sem máscara** (20 dígitos corridos) devolve 0, embora a ajuda diga que funciona.

### 12. Não existe permalink por documento
Varridos os 18 chunks do bundle Angular: os únicos endpoints `no-auth` são `/pesquisa`,
`/pesquisa/filtros` e `/autocompletar`. Por isso `inteiroTeorLink` é `null` — inventar uma
URL de documento seria alucinação. **A prova de existência é `-n <numero>`.**

### 13. Inteiro teor vem junto, mas pesado
Cada documento já traz o texto completo (nenhuma segunda requisição). O HTML embute o
brasão da República em base64: ~100 KB por acórdão. `--fetch-inteiro-teor` grava .txt
limpo (~35 KB). Use `--full-text` com parcimônia.

### 14. `faseProcessual` existe no bundle mas devolve 0
Testado com `Conhecimento` e `Execução`: zero nos dois. Não exposto na CLI para não
entregar filtro que zera silenciosamente.

### Bloqueios
- Cloudflare/captcha/login? **Não** — só o filtro de User-Agent do CloudFront (§1).
- A busca funciona sem resolver nada? **Sim.**
- O download do inteiro teor funciona? **Sim** — vem na própria resposta da busca.

---

## Testes

```bash
node src/TRT9Testes.js            # 20 testes de integração contra a API real
node src/TRT9Testes.js --rapido   # pula a gravação em disco
```

Cobrem, entre outros: formato do `sessionId`, as 5 coleções, os 26 acervos, **a
desambiguação de grau (contagens diferentes + órgãos coerentes)**, data restringindo,
órgão restringindo, tribunal isolando com soma exata, operadores que funcionam e os que
não funcionam, limites do usuário anônimo, paginação sem repetição, checker com processo
real / inexistente / de outro tribunal / sem máscara, auditoria e gravação do inteiro teor.

---

## Reaproveitamento — os outros 23 TRTs (+ TST + CSJT)

A base é **a mesma para todo mundo**. O código foi escrito em duas camadas:

| Camada | Arquivo | Serve |
|---|---|---|
| Família | `src/FalcaoNavigator.js`, `src/FalcaoCrawler.js`, `src/FalcaoChecker.js` | TST + 24 TRTs + CSJT |
| Tribunal | `src/TRT9Navigator.js`, `src/TRT9Crawler.js`, `src/TRT9Checker.js` | só amarram `tribunal: 'TRT9'` |

Os três arquivos do TRT9 somam ~60 linhas, quase todas comentário. Para acrescentar
o TRT2 (SP), o TRT4 (RS) ou o TST:

1. copiar os três arquivos trocando `TRT9` → `TRTn` e `CODIGO_CNJ`/`UF`
   (o mapa `UF_POR_TRIBUNAL` já tem os 26);
2. copiar o bloco `trt9` do `bin/jur` trocando o nome do comando;
3. copiar `CLAUDE-TRT9.md`, ajustando só o escopo e os órgãos julgadores;
4. `human-codegen/` **não precisa ser refeito** — a tela é a mesma; basta apontar
   para `human-codegen/TRT9/`.

### Verificado, não presumido

A camada de família foi rodada contra outros acervos, sem alterar uma linha
(`new FalcaoCrawler({ tribunal: '<X>' })`, query `horas extras`, 2025-Q1):

| Acervo | acórdãos | sentenças | 1º resultado |
|---|---|---|---|
| TRT2 (SP capital) | 10000+ | 10000+ | `1001066-20.2021.5.02.0086` — 14ª Turma |
| TRT4 (RS) | 8030 | 10000+ | `0021394-54.2016.5.04.0232` — Seção Especializada em Execução |
| TRT15 (Campinas) | 10000+ | 10000+ | `0011088-24.2024.5.15.0140` — 5ª **Câmara** |
| TST | 10000+ | **0** | `1000247-23.2021.5.02.0203` — 7ª Turma |

E o `FalcaoChecker` genérico confirmou um processo do TRT4
(`0020044-12.2024.5.04.0471` → `graus: ["1","2"]`).

### O que muda por tribunal — atenção a três coisas

1. **Nomenclatura do órgão colegiado não é uniforme.** TRT9 e TRT2 usam "Turma";
   **TRT15 usa "Câmara"**; TRT4 tem "Seção Especializada em Execução". Qualquer
   heurística sobre o nome do órgão (inclusive o regex de asserção em
   `TRT9Testes.js`) precisa ser ajustada por região. Use `--listar-orgaos`.
2. **TST não tem 1º grau** — a coleção `sentencas` devolve 0. `--grau 1` não faz
   sentido lá; `--grau ambos` retorna só os acórdãos.
3. **`TR` do número CNJ e UFs** — `UF_POR_TRIBUNAL` já traz os 26; o `codigoCNJ` do
   checker é o número da região.

O que **não muda**: endpoints, nomes dos parâmetros, operadores (e os que não funcionam),
limites de paginação, formato de data, formato de `sessionId`, schema dos documentos e a
desambiguação por coleção. O `human-codegen/TRT9/` vale como mapeamento de todos —
é literalmente a mesma tela.
