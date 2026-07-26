# CLAUDE-TJDFT — Tribunal de Justiça do Distrito Federal e dos Territórios

**Status: 🟢 OK** — **API pública OFICIAL e documentada**, sem browser, sem captcha.
**Comando:** `./bin/jur tjdft`
**Portal:** https://jurisdf.tjdft.jus.br
**API:** `POST https://jurisdf.tjdft.jus.br/api/v1/pesquisa`
**Documentação oficial:** [portal de dados abertos do TJDFT](https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/webservice-ou-api)
**Escopo:** DF. **2º grau + Turma Recursal.** Sem 1º grau. **Com súmulas e informativos.**
**Mapeamento:** [`human-codegen/TJDFT/`](human-codegen/TJDFT/)

Matéria **federal** no DF é `trf1`. Matéria **trabalhista** no DF é `trt10`.

É o **primeiro tribunal do repo com API oficial documentada** (`api-oficial`, o topo
da ordem de preferência do `CLAUDE-CODEGEN.md` §4). O TJDFT publica endpoint,
parâmetros e formato de resposta, declarando servir "outros tribunais, pesquisadores,
advogados e desenvolvedores".

---

## 0. Leia isto antes de qualquer coisa

**(1) A documentação oficial é incompleta — e num ponto, errada.**
Ela cobre só `query`/`pagina`/`tamanho`/`termosAcessorios`. Ficaram de fora cinco
parâmetros de topo que a própria tela envia (`sinonimos`, `espelho`, `inteiroTeor`,
`retornaInteiroTeor`, `retornaTotalizacao`) e **a sintaxe de intervalo de data**. E o PDF
mostra `"hits": 1234` quando a API devolve `{"value": 1234}`.

**(2) Decisões não têm data de julgamento — e o filtro as apaga em silêncio.**
Monocráticas e da Presidência só têm `dataPublicacao`. Filtrar por `-di/-df` zera os
dois acervos (2.743 → 0) sem erro nenhum. Use `-dpi/-dpf`. **O crawler avisa.**

**(3) Sem o cookie de sessão a API alterna entre dois índices.**
Requisições idênticas devolvem resultados diferentes conforme o nó que atende. O crawler
fixa o nó reenviando o cookie do balanceador. Sem isso a paginação vem furada.

---

## 1. Uso

```bash
# busca padrão (todos os acervos, na ementa/espelho)
./bin/jur tjdft -q "usucapião extraordinária"

# Juizado Especial / Turma Recursal
./bin/jur tjdft -q "vício do produto" --acervo turmas

# Justiça Comum 2º grau, sem Juizado, num intervalo
./bin/jur tjdft -q "dano moral E banco" --acervo comum -di 01/01/2025 -df 31/12/2025

# decisões monocráticas — data de PUBLICAÇÃO, nunca de julgamento
./bin/jur tjdft -q "tutela de urgência" --acervo monocraticas -dpi 01/01/2025 -dpf 31/12/2025

# súmulas do TJDFT (são 22)
./bin/jur tjdft -q "prescrição" --acervo sumulas

# verificar um julgado antes de citar
./bin/jur tjdft -n 0705891-74.2023.8.07.0004

# domínio dos filtros, com contagens
./bin/jur tjdft --listar
```

## 2. Flags específicas

| Flag | Valores | Default | Observação |
|---|---|---|---|
| `-b, --acervo` | `todos`, `acordaos`, `comum`, `turmas`, `decisoes`, `monocraticas`, `presidencia`, `sumulas`, `informativos`, `foco` | `todos` | **é a desambiguação Juizado × Justiça Comum** — §3 |
| `--escopo` | `espelho`, `inteiroTeor`, `ambos` | `espelho` | são **somáveis**, não excludentes |
| `--sinonimos` | — | desligado | existe na tela, mas **não mudou contagem** em nenhum teste |
| `-di/-df` | DD/MM/AAAA | — | julgamento — **exige os dois juntos** |
| `-dpi/-dpf` | DD/MM/AAAA | — | publicação — idem |
| `-r, --relator` | nome exato | — | `--listar` |
| `-rev, --revisor` | nome exato | — | `--listar` |
| `-oj, --orgao` | nome exato | — | `--listar` (39 valores) |
| `-c, --classe` | nome exato | — | `--listar` (113 valores) |
| `-n, --numero` | CNJ | — | consulta direta (Checker) |
| `--listar` | — | — | agregações: relator, revisor, órgão, base, classe |
| `-m, --max-pages` | inteiro | 10 | **máximo 30 resultados/página** (API recusa mais) |

`-v/--visible` e `--headed` são aceitos e **ignorados**: não há browser.

## 3. Juizado × Justiça Comum — a desambiguação

É a hierarquia `base`/`subbase`:

| `--acervo` | Filtro na API | Documentos | O que é |
|---|---|---|---|
| `comum` | `subbase=acordaos` | 1.422.494 | **Justiça Comum 2º grau** |
| `turmas` | `subbase=acordaos-tr` | 247.757 | **Juizado Especial (Turma Recursal)** |
| `acordaos` | `base=acordaos` | 1.670.251 | os dois juntos |
| `monocraticas` | `subbase=decisoes-monocraticas` | 1.322.796 | relator sozinho |
| `presidencia` | `subbase=decisoes-presidencia` | 328.582 | Presidência/Vice |
| `decisoes` | `base=decisoes` | 1.651.378 | as duas acima |
| `informativos` | `base=informativo-jurisprudencia` | 7.243 | Informativo |
| `foco` | `base=jurisprudencia-foco` | 1.619 | Jurisprudência em Foco |
| `sumulas` | `base=sumulas` | 22 | Súmulas |
| `todos` | — | **3.330.513** | mistura tudo |

Prova de que morde: `comum` 3497 + `turmas` 31 = `acordaos` 3528 — as partes somam o todo.
Cada resultado traz `juizado: true|false`, e o `--json` traz a contagem de Juizado.

⚠️ **Nunca filtre Turma Recursal por `base`.** `{"campo":"base","valor":"acordaos-tr"}`
devolve **0 sem erro**, embora a agregação mostre `acordaos-tr` aninhado em `base`.
Filho só filtra em `subbase`. O crawler já faz certo.

## 4. Operadores — medidos um a um

Janela: julgamento 2024, acórdãos, sinônimos desligado. `usucapião`=285, `posse`=4698.

| Operador | Funciona | Contagem | Nota |
|---|---|---|---|
| (espaço) / `E` / `e` | ✅ | 177 | E implícito |
| `OU` / `ou` | ✅ | 4806 | 285+4698−177 — fecha exatamente |
| `NÃO` / `NAO` / `-` | ✅ | 108 | 285−177 — fecha exatamente |
| `"frase exata"` | ✅ | 80 | |
| `$` (radical) | ✅ | 285 | `usucapi$` |
| `PROX5` | ✅ | 57 | **sem parênteses** |
| `ADJ3` | ✅ | 20 | **sem parênteses** |
| `PROX(5)` / `ADJ(3)` | ❌ | 0 | ⚠️ mas o botão da tela mostra `PROX(N)` |
| `AND`/`OR`/`\|` | ❌ | 0 | viram termo literal |

⚠️ **A tela mente sobre PROX e ADJ.** Os botões escrevem `PROX(N)` e `ADJ(N)`; com
parênteses o resultado é **0, sem erro**. O crawler detecta e avisa.

Diferente do TJMG (onde `E`/`OU`/`NÃO` são ignorados), **aqui os operadores em
português funcionam** — e são os únicos que funcionam.

## 5. Ressalvas

**5.1 Decisões não têm data de julgamento.** `decisoes-monocraticas` e
`decisoes-presidencia` só têm `dataPublicacao`. Medido: 0/20 registros com
`dataJulgamento`, contra 20/20 nos acórdãos. Filtrar por `-di/-df` apaga os dois acervos:

```
--acervo monocraticas                       -> 2.743
--acervo monocraticas -di/-df 2024          ->     0   ← some tudo, sem erro
--acervo monocraticas -dpi/-dpf 2024        ->   272   ← o filtro certo
```

O crawler avisa nos dois casos (acervo restrito e `--acervo todos`).

**5.2 Só existe intervalo FECHADO de data.** A sintaxe (não documentada) é prosa:
`"entre 2024-01-01 e 2024-03-31"`. Não há "a partir de" nem "até" — ambos dão HTTP 500,
e `dataJulgamentoInicio` como campo dá 400. Passar `-di` sem `-df` erra localmente com
explicação, em vez de mandar uma requisição condenada.

**5.3 Dois nós dessincronizados; o cookie resolve.** Sem cookie, requisições idênticas
alternam entre dois resultados (medido `hits` 2825 × 3528, com ids distintos). O
Navigator guarda o cookie do balanceador na primeira resposta e reenvia sempre; o
Crawler reusa **um** navigator na paginação inteira. **Se você chamar a API na mão, faça
o mesmo** — senão a paginação mistura dois índices, com furo e repetição.

**5.4 Rate limit de 60 requisições por janela.** Headers `x-ratelimit-limit`,
`-remaining`, `-reset`. Excedido → HTTP 429. O Navigator lê os headers e espaça sozinho.
**429 é bloqueio, não erro** — não conclua "o tribunal caiu" nem "o julgado não existe".

**5.5 `tamanho` máximo é 30.** Acima disso, HTTP 400. O crawler limita sozinho.

**5.6 O número do processo EXIGE máscara.** `0705891-74.2023.8.07.0004` acha;
`07058917420238070004` devolve 0 sem erro. **É o oposto do TJMG.** O Navigator mascara.

**5.7 `espelho` e `inteiroTeor` são somáveis.** Medido: espelho=285, inteiroTeor=618,
ambos=622. O default do portal é só espelho, o mais restrito — para varredura ampla use
`--escopo ambos`.

**5.8 `sinonimos` parece inerte.** Exposto na tela e no payload, mas não mudou contagem
em nenhum dos termos testados (usucapião, veículo, dano moral). Não prometa que amplia.

**5.8-b O permalink é `/acordaos/<uuid>`, e vale para TODAS as bases.** A rota que parece
óbvia, `/documento/<uuid>`, é **link morto** — devolve só o shell da SPA (34 caracteres).
Validado em contexto limpo de Chromium para acórdão, Turma Recursal e monocrática. Quem
citar com `/documento/` entrega ao leitor uma página em branco.

**5.8-c A busca também tem URL compartilhável**:
`/resultado?sinonimos=&espelho=&inteiroTeor=&textoPesquisa=`. Exposta no Navigator como
`buscaUrl()`. É o link para mandar a pesquisa pronta a alguém — não confundir com o
permalink do documento.

**5.9 `possuiInteiroTeor` mente.** Apareceu `false` em registro que tinha `inteiroTeor`
preenchido. Olhe o campo, não o booleano.

**5.10 As agregações são relativas à busca**, não ao acervo — refletem o recorte da
query. Para o domínio completo, agregue sobre uma query ampla.

## 6. Inteiro teor — o melhor caso do repo

O texto integral **vem no próprio payload da busca** (campo `inteiroTeor`). Não há
request por documento: `--fetch-inteiro-teor` só grava em disco o que já chegou. É por
isso que o rate limit de 60 incomoda pouco — uma página de 30 traz 30 inteiros teores.

## 7. Verificação (anti-alucinação)

```bash
./bin/jur tjdft -n 0705891-74.2023.8.07.0004        # existe?
./bin/jur tjdft -q "..." --verificar 5              # audita a amostra
```

Quando não acha, o Checker **não** conclui "não existe": consulta o DataJud
(`api_publica_tjdft`) e devolve `motivo` distinguindo

- `processo existe no TJDFT (DataJud) mas não há julgado publicado no JurisDF` — é 1º
  grau ou não teve acórdão. **Não é alucinação.**
- `não encontrado nem no JurisDF nem no DataJud` — aí sim, desconfie.

TJDFT na numeração CNJ: **J=8 (Justiça Estadual), TR=07**.

## 8. Testes

```bash
node src/TJDFTTestes.js            # 20 testes de integração (~30s)
node src/TJDFTTestes.js --rapido   # pula o download em disco
node tests/smoke.js tjdft
```

Sete são testes de **armadilha**: afirmam que a API ainda quebra ou mente onde sabemos
(`base=acordaos-tr` → 0, número sem máscara → 0, `PROX(5)` → 0, decisões sem data de
julgamento, `tamanho`>30 → 400, `hits` como objeto, permalink na rota `/acordaos`). Se um deles começar a **falhar**, é
boa notícia: o tribunal consertou, e então este documento é que está errado.

## 9. Arquitetura

| Arquivo | Papel |
|---|---|
| `src/TJDFTNavigator.js` | API oficial + fixação de nó por cookie + rate limit + as armadilhas |
| `src/TJDFTCrawler.js` | acervos, intervalo "entre X e Y", paginação, avisos, mapeamento |
| `src/TJDFTChecker.js` | consulta por nº (com máscara) + CNJ + desempate no DataJud |
| `src/TJDFTTestes.js` | suíte de integração |

Não estende `BaseCrawler`/Playwright — como TJPA e TJMG, roda em HTTP puro.
