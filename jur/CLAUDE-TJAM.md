# TJAM — Tribunal de Justiça do Amazonas

> # 🔴 LEIA ANTES DE USAR: A BASE ESTÁ PARADA DESDE O COMEÇO DE 2025
>
> O `jur tjam` **funciona** — busca livre, sem browser, sem captcha. Mas o
> acervo que ele consulta **parou de ser alimentado**. Medido em 05/08/2026, por
> data de julgamento, com `dano moral` na ementa (2º grau, acórdãos):
>
> | 2022 | 2023 | 2024 | **2025** | **2026** |
> |---|---|---|---|---|
> | 4.398 | 7.543 | 9.023 | **62** | **0** |
>
> No corte mensal o penhasco é nítido: 12/2024 = **1.027** → 01/2025 = 36 →
> 02/2025 = 18 → 03/2025 = 5 → 06/2025 = **0**. O documento mais recente da base
> é de publicação **06/10/2025**.
>
> **Não é artefato da query** — confirmado em três cortes independentes:
> `execução` (1.746 → 22 → 0), Colégios Recursais (36.264 → 1 → 0) e a contagem
> por data de publicação (9.170 → 82 → 0).
>
> **O que fazer quando o usuário pedir jurisprudência recente do TJAM:**
> 1. **Diga que a base do TJAM está desatualizada** e desde quando. Um zero em
>    período recente **não** é ausência de jurisprudência no Amazonas.
> 2. Ofereça o que existe: a base cobre bem **2013–2024**, e nesse recorte é
>    grande (285 mil julgados só para "dano moral").
> 3. Para matéria **federal** com origem no AM → `trf1`.
> 4. **Não há substituto estadual.** Não existe outro acervo do TJAM acessível:
>    o Projudi está atrás de WAF, o PJe não responde e não há e-Proc.
>
> **Este mapeamento não estabeleceu a CAUSA da parada** — nenhum acervo
> alternativo era acessível para comparar. Está registrado como medição sem
> explicação. **Reteste periódico obrigatório**: `node src/TJAMTestes.js` tem um
> teste que falha barulhentamente se 2026 voltar a devolver julgados.

## Status

| Item | Estado |
|---|---|
| Busca | 🟢 **OK** — HTTP direto, sem browser, **sem captcha** |
| Base | 🔴 **parada desde jan/2025** (ver alerta acima) |
| Inteiro teor (PDF) | 🔴 **reCAPTCHA v2** — só o download; a busca é livre |
| Ementa íntegra | 🟢 **vem na própria busca**, sem request extra |
| Permalink | 🔴 **NÃO EXISTE** — verificação só por reconsulta (`-n`) |
| Consulta por nº | 🟢 OK (`-n`, com ou sem máscara) |

**Acesso:** `http` — POST direto em `https://consultasaj.tjam.jus.br/cjsg/`.
**Mapeamento:** `human-codegen/TJAM/01-cjsg/` (25 arquivos, 05/08/2026).
**Código:** `src/TJAM{Navigator,Crawler,Checker,Testes}.js`.

⚠️ **O host é `consultasaj`, não `esaj`.** `esaj.tjam.jus.br` resolve para o
mesmo IP mas devolve **404 com corpo vazio**. Quem chutar o padrão `esaj.` dos
irmãos conclui que o tribunal caiu.

## Escopo — o que a base tem e o que não tem

**Tem:** 2º grau (Câmaras/Órgão Especial) + Colégios Recursais, do sistema
**SAJ**. Começa por volta de 2013 (2013 = 158; antes disso é residual).

**Não tem:**
- **1º grau.** O módulo `cjpg` **não existe** neste tribunal — medido:
  `/cjpg/` responde 200 mas redireciona para a home do e-SAJ, sem formulário.
- **O acervo do Projudi**, que o TJAM roda em paralelo com o ESAJ. A consulta
  pública (`projudi-consulta.tjam.jus.br/publica/`) devolve
  `Request Rejected` (WAF, 245 bytes). Não há módulo de jurisprudência mapeável.
- **Não há e-Proc** (`eproc*.tjam.jus.br` = NXDOMAIN) e o `pje.tjam.jus.br`
  resolve mas a conexão morre.

**Não existe API pública de jurisprudência** — procurada e não encontrada:
`dadosabertos`/`api`/`jurisprudencia`.tjam.jus.br são **NXDOMAIN**, e
`/dados-abertos`, `/swagger`, `/api-docs`, `/openapi.json`, `/v1/`, `/rest/` no
portal dão 404. (Diferente do TJAC, aqui **não** há vhost curinga para enganar.)

## Comando

```bash
./bin/jur tjam -q "dano moral" -m 3
./bin/jur tjam -q "cláusula abusiva" --origem turmas -dpi 01/01/2024 -dpf 31/12/2024
./bin/jur tjam -n "0708349-62.2020.8.04.0001"
./bin/jur tjam -q "plano de saúde" -m 2 --verificar 5
```

## Flags específicas

| Flag | Valores | Nota |
|---|---|---|
| `--origem` | `comum` (default) \| `turmas` \| `ambas` | ⚠️ leia a ressalva 1 |
| `-t/--tipo` | `acordao` (default) \| `homologacao` \| `monocratica` \| `todos` | H e D são quase vazias |
| `--escopo` | `ementa` (default) \| `inteiroTeor` | 32.755 × 54.334 |
| `-di/-df` | data de **julgamento** | ⚠️ **não confiável** — ressalva 3 |
| `-dpi/-dpf` | data de **publicação** | ✅ use este para recorte temporal |
| `-r/--relator` | nome ou trecho | campo `nmAgente` |
| `-ord` | `publicacao` (default) \| `relevancia` | |
| `--verificar N` | audita N resultados por reconsulta | |
| `--fetch-inteiro-teor` | grava a **ementa íntegra** | o PDF é captcha |
| `--tentar-pdf` | força a tentativa do PDF | só para reconferir o bloqueio |

Página de **10** resultados (TJAC usa 20, TJMS 100) — `-m N` rende `N × 10`.

## Ressalvas — leia antes de montar o comando

### 1. 🔴 No Amazonas o Juizado é 7,7× a Justiça Comum

Medido, mesmo termo (`dano moral`, acórdãos):

```
--origem comum   (2º grau)             ->    32.755
--origem turmas  (Colégios Recursais)  ->   252.381
```

O default `--origem comum` **esconde 89% do acervo**. O TJAC já invertia o
padrão do repo (2,8×); o TJAM leva ao extremo. Em dano moral, telefonia, banco,
plano de saúde e transporte aéreo, **ofereça as duas**. Número baixo em `comum`
aqui não é escassez de jurisprudência — é a origem errada.

⚠️ O filtro se chama **"Colégios Recursais"** na tela, mas o `orgaoJulgador` que
volta nos resultados é `2ª Turma Recursal`. Não procure "Colégio" nos dados.

### 2. 🔴 O inteiro teor está atrás de reCAPTCHA — só o download

A **busca é livre**: nada de `grecaptcha` na tela, POST direto responde. Mas
`getArquivo.do` devolve sempre a tela "digite o código da figura"
(reCAPTCHA v2, sitekey `6LcnC3cdAAAAABWUEy-SzR8kMrk3FA9llI6hU934` — própria do
AM, diferente da do TJAC). **A sessão da busca não destrava** (testado).

O que se tem é a **ementa íntegra**, que já vem na busca, no padrão estruturado
do CNJ (CASO EM EXAME / QUESTÃO EM DISCUSSÃO / RAZÕES DE DECIDIR / TESE):
média de **2.589 chars** em acórdão, **1.979** em Colégio Recursal, **808** em
monocrática. Diga ao usuário que a análise vem da ementa e que o relatório/voto
do TJAM não são acessíveis — **não apresente a ementa como se fosse o acórdão
inteiro**.

### 3. ⚠️ A data de JULGAMENTO tem uma data-sentinela: `01/06/2004`

O ano de 2004 inteiro devolve **481** julgados — e o dia **01/06/2004 sozinho
devolve os mesmos 481**. É um balde de registros sem data real.

E não é um problema antigo: numa amostra das **30 publicações mais recentes**,
**11 (37%)** traziam `Data do julgamento: 01/06/2004` com publicação em 2025.

⚠️ **Filtrar por `-di/-df` apaga esses documentos em silêncio.** Para recorte
temporal use **`-dpi/-dpf` (publicação)**. O crawler avisa sempre que o filtro
de julgamento é usado — repasse o aviso.

### 4. ⚠️ Intervalo de data: teto de 1 ano de CALENDÁRIO, não de dias

O fim tem de ser menor que `início + 1 ano`. **Não é contagem de dias corridos**,
e dois casos de 366 dias provam:

```
01/03/2023 -> 29/02/2024  (366 dias)  -> 7.843  ✅ aceita
15/06/2023 -> 15/06/2024  (366 dias)  ->     0  ❌ recusada
```

Acima disso a tela avisa ("A faixa entre data de inicio e data de fim deve ser
de no máximo 1 ano") mas responde **HTTP 200 com o formulário de volta** — um
crawler que só conta cards lê 0. O `TJAMCrawler` distingue recusa de zero
genuíno e **fatia sozinho** em janelas de 1 ano de calendário. Aí `-m N` passa a
valer **por janela**.

### 5. ⚠️ `ADJ`, `PROX` e `$` zeram a busca sem erro

Funcionam: espaço (E implícito), `E`, `OU`, `NAO`, `"frase exata"`.
Não funcionam: `ADJ`, `PROX`, `$` — viram texto literal e devolvem **0**.
E **`NÃO` acentuado não é o operador** (vira termo literal). Escreva `NAO`.

Prova aritmética: `dano` = 39.329, `dano moral` = 32.755,
`dano NAO moral` = 6.574 = a diferença exata. Já `dano NÃO moral` = 27.719,
que não bate com nada.

O crawler avisa nos três casos.

### 6. ✅ NÃO avise sobre acento aqui

O índice **normaliza**: `usucapiao`/`usucapião` = 340; `execucao`/`execução` =
21.431; `prisao`/`prisão` = 11.025; `alimenticia`/`alimentícia` = 456.
A ressalva do TJMS é **falsa** neste tribunal. Avisar seria mandar o usuário
refazer uma busca que já estava certa.

### 7. ⚠️ As abas `homologacao` e `monocratica` são quase vazias

```
              acórdão      monocrática
recurso      472.094              193
agravo        61.228               96
apelação     115.604              134
```

E `homologacao` deu **0 em todas as medições, nas duas origens** — aqui o
checkbox existe de verdade (no TJAC nem existe), então o zero é **acervo vazio**,
não aba inexistente.

Ao responder: não diga "o TJAM não publica decisões monocráticas". Diga que **o
cjsg não as indexa em quantidade relevante**. É outra afirmação.

### 8. 🔴 NÃO EXISTE PERMALINK

Testado em aba limpa: `resultadoCompleta.do` devolve o formulário vazio,
`getArquivo.do` devolve o captcha, e o popup de ementa é modal sem URL.

**Nunca invente link de acórdão do TJAM.** A verificação é por reconsulta:

```bash
./bin/jur tjam -n "0708349-62.2020.8.04.0001"
```

Quem identifica o **documento** é o `cdAcordao`, não o nº do processo — um
processo costuma ter mais de um julgado.

### 9. ⚠️ `trocaDePagina.do` pagina a última busca da SESSÃO

A URL não identifica a busca. Duas buscas intercaladas no mesmo JSESSIONID e a
paginação devolve as páginas da busca errada, com HTTP 200 e cards válidos. O
`TJAMCrawler` refaz `buscar()` antes de `paginar()` e o Navigator recusa
paginação órfã via assinatura. Sem sessão nenhuma, o endpoint dá **HTTP 404** —
falha barulhenta, ao menos.

## O que ficou por mapear (pendência declarada)

Os **combos em árvore** (classe, assunto, seção) existem no formulário como
hidden + campo de texto, e **não foram enumerados** — o tempo foi para a
descoberta da base parada e da data-sentinela. O crawler não expõe flags para
eles, então isso é lacuna de recurso, não bug. **Não escreva que o TJAM não tem
esses filtros**; ele tem, não foram listados. (Mesma pendência do TJAC.)

Também **não medido**: se `--sem-sinonimos` muda alguma coisa, e se o
balanceador (há ≥3 nós: `.cjsg1`/`.cjsg2`/`.cjsg3`) dessincroniza totais entre
nós. Registrados como não medidos, não como inexistentes.

## Testes

```bash
node src/TJAMTestes.js            # 23 testes de integração (site real)
node src/TJAMTestes.js --rapido   # pula a gravação em disco
node tests/smoke.js tjam
```

Três testes são **sentinelas de mudança** e falham em voz alta se o cenário
melhorar: o de 2026 devolver julgados (base voltou), o do `getArquivo.do`
devolver PDF (captcha caiu) e o da data-sentinela sumir. Se algum falhar,
atualize este documento em vez de "consertar" o teste.
