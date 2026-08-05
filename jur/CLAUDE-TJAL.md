# TJAL — Tribunal de Justiça de Alagoas

## Status

| Item | Estado |
|---|---|
| Busca | 🟢 **OK** — HTTP direto, sem browser, **sem captcha** |
| Base | 🟢 **CORRENTE** — jul/2026 com 981 publicações; julgado mais recente 23/07/2026 |
| Inteiro teor (PDF) | 🔴 **reCAPTCHA v2** — só o download; a busca é livre |
| Ementa íntegra | 🟢 **vem na própria busca**, sem request extra (a mais rica da família) |
| Permalink | 🔴 **NÃO EXISTE** — verificação só por reconsulta (`-n`) |
| Consulta por nº | 🟢 OK (`-n`, com ou sem máscara) |

**Acesso:** `http` — POST direto em `https://www2.tjal.jus.br/cjsg/`.
**Mapeamento:** `human-codegen/TJAL/01-cjsg/` (29 arquivos, 05/08/2026).
**Código:** `src/TJAL{Navigator,Crawler,Checker,Testes}.js`.

⚠️ **O host é `www2`, não `esaj`.** `esaj.tjal.jus.br` é **NXDOMAIN** — o host
não existe. Quem chutar o padrão `esaj.` dos irmãos conclui que o tribunal caiu.
(No TJAM o erro é o inverso: lá o `esaj.` resolve e devolve 404.)

## Escopo — o que a base tem e o que não tem

**Tem:** 2º grau (Câmaras/Seções) + Colégios Recursais, do sistema **SAJ**.
Começa por volta de **2013** (2012 = 1, 2014 = 300, 2018 = 1.795).

**Não tem:**
- **1º grau.** O módulo `cjpg` **não existe** neste tribunal — medido: `/cjpg/`
  responde 200 com 5.701 bytes e **sem formulário de busca**. (Igual ao TJAM.)
- **O acervo do Projudi**, que o TJAL roda no 1º grau. `projudi.tjal.jus.br` é
  NXDOMAIN e não há consulta pública de jurisprudência do Projudi mapeável.
- Não há e-Proc (`eproc.tjal.jus.br` = NXDOMAIN).

**Não existe API pública de jurisprudência** — procurada e não encontrada.
⚠️ **Aqui a armadilha do TJAC aparece em forma pior: TODO path inventado
responde HTTP 200.** Medido, com md5: `/dados-abertos`, `/swagger`,
`/openapi.json`, `/api/`, `/rest/`, `/v1/` **e** `/qualquer-coisa-inventada-9z`
devolvem exatamente o mesmo corpo (md5 idêntico ao da home: a shell do SPA em
`tjal.jus.br`, 1.730 bytes; uma página fixa em `www2`, 5.705 bytes).
`dadosabertos.tjal.jus.br` resolve mas redireciona para `/enderecos` do portal.
`api.tjal.jus.br` resolve para **172.17.35.106**, um IP privado (RFC1918) que não
responde de fora — vazamento de DNS interno, não API. **Confira o md5 antes de
comemorar um 200.**

## Comando

```bash
./bin/jur tjal -q "dano moral" -m 3
./bin/jur tjal -q "cláusula abusiva" --origem turmas -dpi 01/01/2026 -dpf 31/07/2026
./bin/jur tjal -n "0701284-29.2025.8.02.0055"
./bin/jur tjal -q "plano de saúde" -m 2 --verificar 5
```

## Flags específicas

| Flag | Valores | Nota |
|---|---|---|
| `--origem` | `comum` (default) \| `turmas` \| `ambas` | ⚠️ leia a ressalva 1 |
| `-t/--tipo` | `acordao` (default) \| `homologacao` \| `monocratica` \| `todos` | ⚠️ ressalva 4 |
| `--escopo` | `ementa` (default) \| `inteiroTeor` | 103.280 × 144.628 |
| `-di/-df` | data de **julgamento** | ✅ confiável aqui (≠ TJAM) |
| `-dpi/-dpf` | data de **publicação** | ✅ também confiável |
| `-r/--relator` | nome ou trecho | campo `nmAgente` — ⚠️ ressalva 1 |
| `-ord` | `publicacao` (default) \| `relevancia` | |
| `--sem-sinonimos` | | ⚠️ medido: **não muda a contagem** |
| `--verificar N` | audita N resultados por reconsulta | |
| `--fetch-inteiro-teor` | grava a **ementa íntegra** | o PDF é captcha |
| `--tentar-pdf` | força a tentativa do PDF | só para reconferir o bloqueio |

Página de **20** resultados (TJAM usa 10, TJMS 100) — `-m N` rende `N × 20`.

## Ressalvas — leia antes de montar o comando

### 1. 🔴 Em Alagoas a Justiça Comum é MAIOR que o Juizado — a inversão se desfaz

Medido, mesmo termo (`dano moral`, acórdãos):

```
--origem comum   (2º grau)             ->   103.280
--origem turmas  (Colégios Recursais)  ->    31.474
                                soma   ->   134.754  (exata)
```

Compare com os irmãos:

```
TJAC   Juizado 2,8× a Justiça Comum
TJAM   Juizado 7,7× a Justiça Comum
TJAL   Justiça Comum 3,3× o Juizado    ← aqui
```

**Não generalize em nenhum dos dois sentidos.** Quem tivesse concluído do TJAC e
do TJAM que "nos TJs pequenos o Juizado domina" erraria em Alagoas. O default
`--origem comum` aqui **não** esconde a maior parte do acervo — mas ainda esconde
23% dele, e em matéria de consumo (dano moral, telefonia, banco, plano de saúde,
transporte aéreo) vale oferecer as duas.

⚠️ O filtro se chama **"Colégios Recursais"** na tela, mas o `orgaoJulgador` que
volta nos dados é **`Turma Recursal Unificada`**. Não procure "Colégio" nos dados.

⚠️ **No Colégio Recursal o relator vem genérico**: `Juiz 1 Turma Recursal
Unificada`, não um nome de pessoa. Filtrar com `-r "<nome>"` não encontra julgado
de Turma Recursal — o campo não traz pessoa lá.

### 2. 🔴 O inteiro teor está atrás de reCAPTCHA — só o download

A **busca é livre**: nada de `grecaptcha` na tela, sem sitekey, POST direto
responde. Mas `getArquivo.do` devolve sempre a tela "digite o código da figura"
(reCAPTCHA v2, sitekey `6LfALTkUAAAAALzYBt8XXduGuX-XRaljNf99yVpX` — **própria de
Alagoas**, diferente da do TJAM). **A sessão da busca não destrava** (testado).

O que se tem é a **ementa íntegra**, que já vem na busca, no padrão estruturado
do CNJ (CASO EM EXAME / QUESTÃO EM DISCUSSÃO / RAZÕES DE DECIDIR / TESE /
Dispositivos citados / Jurisprudência citada). É a **mais rica da família ESAJ
mapeada**: média de **4.746 chars** em acórdão, **3.876** em Turma Recursal,
**3.394** em monocrática (o TJAM tem 2.589 em acórdão).

Diga ao usuário que a análise vem da ementa e que o relatório/voto do TJAL não
são acessíveis — **não apresente a ementa como se fosse o acórdão inteiro**.

📌 Detalhe medido: a tela do captcha diz *"Esta validação lhe dará acesso para
visualizar 20 resultados"* — o destravamento seria por lote, não por documento.
Não muda nada para o crawler; muda o custo de uma eventual operação assistida.

### 3. ⚠️ Intervalo de data: teto de 1 ano de CALENDÁRIO, não de dias

O fim tem de ser menor que `início + 1 ano`. **Não é contagem de dias corridos**,
e dois casos de 366 dias provam:

```
01/03/2023 -> 29/02/2024  (366 dias)  -> 13.594  ✅ aceita
15/06/2023 -> 15/06/2024  (366 dias)  ->      0  ❌ recusada
15/06/2025 -> 14/06/2026  (364 dias)  -> 26.039  ✅ aceita
01/01/2025 -> 01/01/2026              ->      0  ❌ recusada
02/01/2025 -> 01/01/2026              -> 26.504  ✅ aceita
```

Acima disso a tela avisa ("A faixa entre data de inicio e data de fim deve ser
de no máximo 1 ano") mas responde **HTTP 200 com o formulário de volta** — um
crawler que só conta cards lê 0. O `TJALCrawler` distingue recusa de zero
genuíno e **fatia sozinho** em janelas de 1 ano de calendário. Aí `-m N` passa a
valer **por janela**.

### 4. ⚠️ O formulário só oferece "Acórdãos" — mas a aba `D` funciona assim mesmo

Na tela do TJAL o filtro "Tipo de Publicação" tem **um único checkbox** (`A`).
Não há controle de Homologação nem de Monocrática — ao contrário do TJAM (A, H,
D) e do TJAC (A, D).

**Mas enviar `tipoDecisaoSelecionados=D` no POST funciona**: devolve 43
monocráticas, com `cdAcordao`, datas e órgãos próprios. **Checkbox ausente ≠ aba
inexistente** — este é o achado do mapeamento de hoje. Teste o parâmetro, não o
controle da tela.

```
              acórdão      monocrática
dano moral    103.280               43
```

43 documentos é **o cjsg não indexar monocráticas**, não o tribunal não decidir
monocraticamente. São afirmações diferentes e só a primeira está medida.

⚠️ **A aba `H` devolve 0 e o zero é AMBÍGUO.** Como o checkbox também não existe,
não dá para saber se é aba real e vazia (caso do TJAM) ou aba inexistente (caso
do TJAC). **Fica registrado como não decidido** — não relate como "o TJAL não
homologa acordos". O crawler avisa isso quando `-t homologacao` é usado.

### 5. ⚠️ `ADJ` e `PROX` zeram; `$` DEGENERA (não zera)

Funcionam: espaço (E implícito), `E`, `OU`, `NAO`, `"frase exata"`.
Não funcionam: `ADJ`, `PROX` — viram texto literal e devolvem **0**.
E **`NÃO` acentuado não é o operador** (vira termo literal). Escreva `NAO`.

Prova aritmética: `dano` = 114.180, `dano moral` = 103.280,
`dano NAO moral` = 10.900 = a diferença exata. Já `dano NÃO moral` = 83.138,
que não bate com nada.

⚠️ **O `$` é a armadilha nova deste tribunal**: `dan$` devolve **2**, não 0. No
TJAC e no TJAM ele zerava — sintoma óbvio. Aqui devolve um punhado de resultados
que se leem como "busca muito específica". O crawler avisa nos três casos.

### 6. ✅ NÃO avise sobre acento aqui

O índice **normaliza**: `usucapiao`/`usucapião` = 1.819;
`execucao`/`execução` = 95.558. A ressalva do TJMS é **falsa** neste tribunal.
Avisar seria mandar o usuário refazer uma busca que já estava certa.

### 7. ✅ Não há data-sentinela — `-di/-df` é confiável aqui

Procurada, e não existe: 2004 inteiro = 0, `01/06/2004` sozinho = 0, 2010 = 0.
E julgamento × publicação batem em 2024 (28.016 × 27.924).

Isso é o **oposto do TJAM**, onde 481 julgados carregavam a data-sentinela
`01/06/2004` e 37% das publicações recentes caíam nesse balde, tornando
`-di/-df` perigoso. **No TJAL os dois pares de data podem ser usados.**

### 8. 🔴 NÃO EXISTE PERMALINK

Testado em aba limpa (contexto sem cookies): `resultadoCompleta.do;jsessionid=…`
devolve **HTTP 200 com ZERO cards**, `getArquivo.do` devolve o captcha, e o popup
de ementa é modal sem URL (e sem XHR — o texto já estava na página).

**Nunca invente link de acórdão do TJAL.** A verificação é por reconsulta:

```bash
./bin/jur tjal -n "0701284-29.2025.8.02.0055"
```

Quem identifica o **documento** é o `cdAcordao`, não o nº do processo — um
processo costuma ter mais de um julgado. O `getArquivo.do` pede **chave
composta** (`cdAcordao` + `cdForo`).

### 9. ⚠️ `trocaDePagina.do` pagina a última busca da SESSÃO

A URL não identifica a busca. Medido aqui, não herdado: página 2 da busca A
devolveu `853528,853530,853534`; depois de rodar uma busca B no mesmo cookie, a
**mesma URL** devolveu `850400,848809,848665` — HTTP 200, cards válidos, busca
errada, sintoma nenhum.

O `TJALCrawler` refaz `buscar()` antes de `paginar()` e o Navigator recusa
paginação órfã via assinatura. Sem sessão nenhuma, o endpoint dá **HTTP 404** —
falha barulhenta, ao menos.

### 10. ⚠️ A citação tem um QUARTO formato

```
(Número do Processo: 0701284-29.2025.8.02.0055; Relator (a): Des. Carlos
 Cavalcanti de Albuquerque Filho; Comarca: Foro de Santana do Ipanema;
 Órgão julgador: 2ª Câmara Cível; Data do julgamento: 23/07/2026;
 Data de registro: 24/07/2026)
```

TJAC abre por `Relator (a)`, TJAM abre pela classe processual, TJAL abre por
`Número do Processo:`. O regex de cada irmão não casa nos outros. O
`separarCitacao()` do repo ancora em `Data de registro:` — o único campo que os
quatro põem por último — e caminha para trás contando profundidade de parênteses
(porque `Relator (a)` é um parêntese aninhado e "pegar o último parêntese"
quebra).

## Paginação e totais

**Total exato**, não saturado. Provado por aritmética: jul/2026 = 981 = 49
páginas cheias de 20 + 1 na página 50; a página 51 devolve 0 cards. Reconferido
com termo raro (`litispendência superveniente` = 48, não redondo).

**Paginação estável**: 3/3 idênticas na mesma sessão e 3/3 entre sessões novas,
sem interseção entre páginas consecutivas.

## O que ficou por mapear (pendência declarada)

Os **combos em árvore** (classe, assunto, seção) existem no formulário como
hidden + campo de texto, e **não foram enumerados**. A página tem **zero
elementos `<select>`** — são popups do SAJ que gravam nos hiddens, então não dá
para listá-los lendo `<option>`. O crawler não expõe flags para eles: é lacuna
de recurso, não bug. **Não escreva que o TJAL não tem esses filtros**; ele tem,
não foram listados. (Mesma pendência do TJAC e do TJAM.)

Também **não medido**: o comportamento da paginação em buscas muito profundas
(o total sem filtro de data dá 5.164 páginas; só se paginou até a 50 de um corte
mensal), e se os nós do balanceador (`.cjsg1`/`.cjsg2`) dessincronizam totais.
Registrados como não medidos, não como inexistentes.

## Testes

```bash
node src/TJALTestes.js            # 28 testes de integração (site real)
node src/TJALTestes.js --rapido   # pula a gravação em disco
node tests/smoke.js tjal
```

Quatro testes são **sentinelas de mudança** e falham em voz alta se o cenário
virar: o da base deixar de ser corrente (a lição do TJAM), o da relação
Comum × Juizado inverter, o do `getArquivo.do` devolver PDF (captcha caiu) e o do
`resultadoCompleta.do` passar a funcionar sem sessão (viraria permalink). Se
algum falhar, **atualize este documento em vez de "consertar" o teste**.
