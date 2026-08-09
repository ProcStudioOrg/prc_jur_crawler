# TJPI — Tribunal de Justiça do Piauí (portal JusPI)

**Status: 🟢 OK** — HTTP direto, sem browser, **sem captcha em etapa nenhuma**.
Portal: `https://jurisprudencia.tjpi.jus.br` (JusPI). Mapeado em **09/08/2026**.
Mapeamento completo em [`human-codegen/TJPI/01-juspi/`](human-codegen/TJPI/01-juspi/).

```bash
./bin/jur tjpi -q "usucapião" -m 2
./bin/jur tjpi -q "dano moral" -dpi 01/01/2026 -dpf 31/07/2026 -t acordao
./bin/jur tjpi -n "0763373-15.2025.8.18.0000"
./bin/jur tjpi -q "usucapião extraordinária" -m 1 --fetch-inteiro-teor
./bin/jur tjpi --listar-filtros           # relatores, classes, órgãos, tipos
```

## Escopo — o que a base cobre e o que não cobre

Acervo: **≈397 mil documentos de 2º grau**, de **2018 a hoje**, em três tipos —
**Acórdão**, **Decisão Terminativa** e **Súmula do próprio TJPI**.

- ❌ **Não tem 1º grau** (sentenças). A pergunta que o TJES mandou fazer foi feita:
  aqui a resposta é não.
- ❌ **Não tem Turma/Colégio Recursal.** Não é omissão do mapeamento: os 27 órgãos
  do combo são Câmaras Especializadas, Grupos de Câmaras, Pleno, Vice-Presidências
  e Conselho da Magistratura. **Não existe partição Juizado × Justiça Comum no
  TJPI** — segundo tribunal do repo assim, depois do TJMT.
- ✅ **Tem súmulas do próprio tribunal** (39), pesquisáveis junto com os acórdãos.
  É o primeiro do repo com isso.
- Matéria federal com origem no PI → `trf1`. Trabalhista → `trt22`/`tst`.

Distribuição por ano (base inteira, medida): 2018 = 1.731 · 2019 = 8.694 ·
2020 = 19.247 · 2021 = 29.314 · 2022 = 53.887 · 2023 = 69.590 · 2024 = 99.400 ·
2025 = 37.713 · 2026 = 77.419.

✅ **A base está CORRENTE** — documento de 31/07/2026, e agosto/2026 já tem 26
publicações medidas em 09/08/2026.

⚠️ **Mas há defasagem de indexação nos meses mais recentes**, e ela é visível:
mai/2026 = 10.980 · jun = 6.580 · jul = 3.782 · ago (1 a 9) = 26. A curva
decrescente é forte demais para ser sazonal. **Para pedido dos últimos 30–60 dias,
avise que o acervo daquele período ainda está enchendo** — não é ausência de
jurisprudência. (⚠️ O 2025 baixo, 37.713 contra 99.400 de 2024, não foi explicado.)

## Flags

| Flag | O que faz |
|---|---|
| `-q` | Query. Operadores em **português** — ver ressalva 1 |
| `-n` | Consulta por número de processo (aplica o contorno da ressalva 4) |
| `-dpi` / `-dpf` | Janela de **publicação** (DD/MM/YYYY). **Use as duas juntas** — ressalva 3. `-di`/`-df` são **alias**, porque não há data de julgamento |
| `-t` | `todos` (default) · `acordao` · `terminativa` · `sumula` |
| `-r` | Relator — **nome exato** do combo (87 opções) |
| `-c` | Classe judicial — **nome exato** (94 opções) |
| `-oj` | Órgão julgador colegiado — **nome exato** (27 opções) |
| `--listar-filtros` | Despeja os quatro combos e sai |
| `--fetch-inteiro-teor` | Baixa o inteiro teor — **1 GET por documento** |
| `--verificar N` | Reabre N permalinks e confere o número do processo |
| `-m` | Páginas. **25 resultados por página, fixo** — ressalva 6 |

⚠️ Não existe `-di/-df`: **a base não tem data de julgamento** (ressalva 2).

## Ressalvas

### 1. 🔴 Os operadores são em PORTUGUÊS, e `nao` sem acento é uma armadilha

Medido contra `usucapião` = 585 e `posse` = 27.221:

| Operador | Resultado |
|---|---|
| espaço (implícito) | **E (AND)** — `usucapião posse` = 306 |
| `E` | 306 (idêntico ao espaço) |
| `OU` | 27.500 — **exato**: 585 + 27.221 − 306 |
| `NÃO` **acentuado** | 279 — **exato**: 585 − 306 |
| `"frase exata"`, `( )` | funcionam |
| `AND` `OR` `NOT` `ADJ` `PROX` | 🔴 **ZERAM a busca** (viram termo literal) |

🔴 **`nao` sem acento NÃO é o operador — e o erro não dá sintoma.**
`usucapião não posse` = **279** (exclusão correta); `usucapião nao posse` = **282**,
porque "nao" entra como **palavra** no AND. Provado: `usucapião e posse e nao`
devolve os mesmos 282. O erro **infla**, e 282 se lê como resposta normal.

⚠️ **Isto é o OPOSTO do TJAC/TJAM/TJAL**, onde `NAO` funciona e `NÃO` acentuado não.
Herdar a ressalva do Bloco 1 aqui produz o bug. O crawler avisa; repasse o aviso.

✅ **Não avise sobre acento na query**: o índice normaliza
(`usucapiao` = `usucapião` = 585). O acento importa **só para o parser de operador**.

⚠️ A documentação do próprio portal erra num ponto: diz que os termos do `OU`
"devem sempre estar agrupados entre parênteses". Sem parênteses dá o mesmo 27.500.

### 2. 🔴 A base NÃO TEM data de julgamento — só publicação

Não existe filtro, campo no card, campo no documento nem nada na citação oficial
que traga data de julgamento. O `Data 13/07/2026` da citação é a **publicação**.
O crawler devolve `dataJulgamento: ''` de propósito, para não inventar.

**Nunca apresente a data do TJPI como data de julgamento.**

### 3. 🔴 Uma ponta só da data é IGNORADA em silêncio

`usucapião` = 585 · `usucapião + data_min=2026-01-01` = **585** (ignorou) ·
`usucapião + data_min=2026-01-01 & data_max=2026-12-31` = **110** (aplicou).

Quem mandar só `-dpi` recebe o acervo inteiro com HTTP 200 e número plausível,
achando que filtrou. **Informe sempre as duas pontas.** O crawler avisa.

✅ Fora isso o filtro é honesto: a data devolvida pelo documento cai dentro da
janela (verificado em três janelas — a lição do TJMT, que lia `MM/DD`), e a
janela no-op 1900–2100 devolve o total, como deve.

### 4. 🔴 Número de processo SOZINHO não funciona — e derruba a busca com HTTP 500

O placeholder do campo promete "… Processos, etc" e **não funciona**. Falha de
**duas formas**, e só uma delas dá sintoma. Medido contra um processo que existe:

```
q=0763373-15.2025.8.18.0000        → 🔴 HTTP 500   (a pontuação sozinha
q="0763373-15.2025.8.18.0000"      → 🔴 HTTP 500     derruba o parser)
q=07633731520258180000             → 200, 0 resultados  (sem máscara)
q=0763373 / 0763373-15             → 200, 0 resultados  (pedaços)
q=0763373-15.2025.8.18.0000 e de   → 200, 1  ✅ o documento certo
```

⚠️ **O 500 quase virou ressalva errada.** O helper de contagem usado no
mapeamento só olhava o corpo da resposta, e página de erro sem card se lê igual
a "nenhum resultado" — o 500 só apareceu quando a suíte de testes passou a usar
o `Navigator`, que confere o status. **Confira o status antes de chamar um zero
de zero.**

✅ **`./bin/jur tjpi -n <nº>` aplica o contorno**: pendura um termo de altíssima
frequência (`de`, depois `a`, depois `que`) e deixa o AND implícito trabalhar.
O formato indexado é a **máscara**, não os 20 dígitos.

⚠️ Falso negativo residual declarado: julgado sem nenhuma das três âncoras não
seria achado. ⚠️ E o número casa no **texto inteiro**, então a busca pode arrastar
acórdão que apenas **cita** aquele número (a armadilha do TJES) — o Checker
descarta o que não bate e conta quantos descartou.

### 5. 🔴 O permalink de SÚMULA está quebrado (HTTP 500)

✅ **Existe permalink público e estável** — `/jurisprudences/<id>/public`,
confirmado em aba limpa sem cookie. É citável, e isso é raro no repo (TJAC, TJAM,
TJAL, TJBA, TJPE, TJES e TJCE não têm).

🔴 **Menos para súmula**: 5 súmulas testadas (ids 83, 85, 86, 87, 88), **5/5 dão
HTTP 500**, enquanto acórdão e terminativa abrem. Não é documento envenenado
avulso como no TJPE — é o **tipo inteiro**. O crawler devolve `processoUrl: null`
em súmula: publicar URL que dá 500 é pior que declarar que não há.

**Quem identifica o documento é o `id`**, não o número do processo (que nem existe
em súmula).

### 6. ⚠️ 25 resultados por página, e não há como mudar

`per_page`, `per` e `limit` são **ignorados em silêncio** — devolvem os mesmos 25
cards e o mesmo total. Quem passar `per_page=100` acha que pediu 100.

✅ Em compensação: **total EXATO** (585 = 23×25+10; 397.031 = 15.881×25+6, com a
última página conferida), **sem teto de offset** (page 15.881 responde) e
**paginação estável** — a mesma página 2, três vezes, devolveu os mesmos 25 ids
na mesma ordem. Nada da instabilidade de TJDFT/TJRJ/TJMG/TJMT.

### 7. ⚠️ O texto do card é TRECHO; a ementa íntegra está escondida no mesmo HTML

Medido no mesmo documento: card fechado = **796** chars (com `<mark>`, é highlight),
card expandido = **4.056** (ementa íntegra), documento = **18.452** (inteiro teor).

✅ **A ementa íntegra e a citação oficial já vêm no HTML da busca** — o botão "+"
não dispara XHR nenhum, só tira uma classe CSS. Só o inteiro teor exige o GET.

✅ **A citação oficial vem PRONTA**, no formato
`(TJPI - <CLASSE> <CNJ> - Relator: <NOME> - <ÓRGÃO> - Data DD/MM/YYYY)` — nada de
regex sobre campos soltos, ao contrário dos quatro e-SAJ do Bloco 1. É dela que
saem classe, relator e órgão, que **não existem em nenhum outro ponto do card**.

✅ **A decisão terminativa TEM ementa de verdade** (3.393 chars, padrão CNJ) —
não repita aqui a ressalva de TJPE/TJCE/TJMT, onde monocrática vem sem ementa.

⚠️ **Súmula não tem processo, relator, órgão, classe, publicação nem citação.**
Só o texto (≈500 chars). Quem dissecar só o acórdão erra num terço dos tipos.

### 8. ⚠️ O campo "Órgão Julgador" da página do documento contém uma PESSOA

Na tabela "Detalhes", `Órgão Julgador` = "Desembargador HILO DE ALMEIDA SOUSA" e
quem é órgão de verdade é `Órgão Julgador Colegiado` = "1ª Câmara Especializada
Cível". O `orgaoJulgador` do resultado vem da **citação**, que é confiável.

### 9. ⚠️ Os filtros só existem na página de RESULTADO

A tela inicial tem só o campo de texto. Os quatro combos e as duas datas aparecem
depois da primeira busca. Quem raspar a home conclui que o portal não tem filtro.

✅ Os combos querem o **NOME exato**, não id (o oposto da armadilha do TJBA), e
**valor inventado devolve 0** — o filtro é levado a sério, não é decorativo.
✅ A partição por tipo é **exata**: 356 + 229 + 0 = 585, e 235.040 + 127.366 + 39
= 362.445 no acervo largo.

## Acesso — não há API, e isso foi medido

O JusPI é **Rails renderizado no servidor** (Turbo + Sprockets), não SPA: não há
endpoint JSON para interceptar. O crawler é `http` puro.

**NXDOMAIN:** `dadosabertos` · `api` · `juris` · `sistemas` · `app` · `portal` ·
`pje2g` `.tjpi.jus.br`. **404:** `/dados-abertos`, `/transparencia/dados-abertos`
(no `www`) e `/swagger`, `/v3/api-docs`, `/actuator` (no jurisprudência).

⚠️ **Dois falsos caminhos:** `/jurisprudences/search.json` → **HTTP 406** (o Rails
não tem respondedor JSON) e `/jurisprudences.json` → **HTTP 401** (índice atrás do
login "ACESSO"). Nenhum serve.

✅ **Sem vhost curinga** — `/qualquer-coisa-inventada-9z` devolve 404 real com md5
distinto da home. A armadilha do TJAC/TJAL não se repete aqui.

✅ **Sem captcha, sem cookie, sem sessão, sem token**, medido **em separado** para
busca e para documento. O FortiWeb Cloud que protege `www.tjpi.jus.br` não está no
host de jurisprudência.

## Pendências declaradas

- **O DataJud não foi sondado** para o TJPI — não foi preciso (a busca por termo
  funciona e o `-n` tem contorno próprio), mas fica como **não medido**, não como
  inexistente.
- **`assunto` não é filtrável**: aparece no card e na tabela Detalhes, mas não há
  combo nem parâmetro. Não se investigou se existe parâmetro não exposto.
- **A queda de 2025 (37.713 contra 99.400 de 2024) não foi explicada** — pode ser
  lacuna de indexação, e nesse caso um pedido sobre 2025 devolve menos do que
  deveria.
- **A defasagem dos meses recentes não foi quantificada** contra o volume real de
  publicação do tribunal — só se mediu a curva.
- `-c` (classe) e `-oj` (órgão) foram provados por contagem; **`-r` (relator) foi
  provado só num nome**.
- Não se mediu se existe rate limit acima de ~60 requisições.
