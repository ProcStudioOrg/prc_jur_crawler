# TRF2 — Tribunal Regional Federal da 2ª Região

**Escopo:** RJ, ES · **Status:** 🟢 **OK** (HTTP direto, sem browser) · remapeado em 25/07/2026

Comando: `./bin/jur trf2` · Stack: `src/TRF2Crawler.js` + `src/TRF2Navigator.js` +
`src/TRF2Checker.js` · Testes: `node src/TRF2Testes.js` (`npm run test:trf2`) ·
Mapeamento: `human-codegen/TRF2/`

## O sistema mudou — e agora está mapeado

| URL | Situação |
|---|---|
| `juris.trf2.jus.br/consulta.php` | **NXDOMAIN** — portal antigo, desativado. Mapeamento histórico em `human-codegen/TRF2/02-juris-legado/` |
| `jurisprudencia.trf2.jus.br` | **301** para a linha de baixo (é a entrada divulgada pelo tribunal) |
| **`eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`** | ✅ **é esta** — módulo de jurisprudência do e-Proc |

É o **mesmo módulo `eproc-jur` do TRF4 e do TJSC** (mesmos ids, mesma marcação de card,
mesma paginação). A diferença operacional decisiva: **o TRF2 não tem a verificação de
segurança F5/Shape do TJSC.** O POST de busca responde 200 sem cookie nenhum, então este
crawler é **HTTP puro** (~0,5 s por busca) enquanto o do TJSC precisa de Chromium (~10 s).

**Abrangência:** só **2º grau**, três origens (ver abaixo), **de 2018 até o dia corrente**
(2017 e antes devolvem 0 — é o começo do acervo, não bug). Tamanho da base, medido com o
curinga `*` em 25/07/2026: TRF2 839.228 · Turmas Recursais 254.308 · TRU2 2.210.

---

## ⚠️ RESSALVA Nº 1 — o ESPAÇO entre termos quebra a busca

**Este é o detalhe mais importante do TRF2.** No portal, dois termos separados por espaço
não viram "termo1 E termo2": o servidor injeta o operador em inglês **como se fosse mais
um termo buscado**. Resultado: a busca "funciona", devolve resultados plausíveis, e perde
99,8% do acervo.

```
"dano moral"   -> termos que o servidor montou: dano|moral|and|dano|moral ->      46 docs
"dano-moral"   -> termos que o servidor montou: dano|moral                -> 20.201 docs
```

Prova de que os 46 são lixo: `dano-moral-and` devolve exatamente os mesmos 46, e a palavra
`and` sozinha aparece em 1.125 documentos. E a forma com **hífen** fecha a álgebra de
conjuntos no centavo:

```
dano = 109.452 · moral = 22.867
dano-moral      =  20.201                                  (interseção)
dano-ou-moral   = 112.118 = 109.452 + 22.867 − 20.201      ✓ exato
dano-nao-moral  =  89.251 = 109.452 − 20.201               ✓ exato
```

O bug é do site — quem digita "dano moral" na tela recebe os mesmos 46, e a **própria
ajuda do portal ensina a sintaxe errada** (`crime e "faixa de fronteira"` devolve página de
erro). Por isso o crawler **conserta a query antes de enviar**: junta os termos com hífen.

```bash
./bin/jur trf2 -q "aposentadoria especial" --json
# -> "queryEnviada":"aposentadoria-especial",  totalResults 68.294
#    (se fosse enviada com espaço: 68)
```

O que a normalização preserva sem tocar: termo único, frase exata isolada
(`"aposentadoria especial"`), e qualquer query com ` prox ` (o único operador que **exige**
espaço). Use `--literal` para desligar e reproduzir o comportamento cru da tela.

**Sem conserto possível:** frase exata **combinada** com outro termo
(`"dano moral" e aposentadoria` = 5 documentos). O portal injeta o "and" de qualquer jeito,
com ou sem hífen. O crawler **avisa** (campo `avisos` no `--json`) em vez de fingir que deu
certo. Use ou só a frase entre aspas, ou só termos soltos.

---

## Justiça Federal comum × Juizados Especiais — a desambiguação

É o filtro `--origem` (combo "Origem" / `#selOrigem`). **Sempre explicite.**

| `--origem` | Combo do site | `#selOrigem` | O que é |
|---|---|---|---|
| `trf2` (**default**) | TRF2 | `1` | **Justiça Federal comum, 2º grau** — Turmas e Seções Especializadas, Corte Especial, Vice-Presidência |
| `turmas` | Turmas Recursais | `3` | **Juizados Especiais Federais, 2º grau** — Turmas Recursais do RJ e do ES |
| `tru` | TRU2 | `2` | Turma Regional de Uniformização (Juizados) |
| `todas` | (as três marcadas) | `1,2,3` | tudo junto |

Aliases: `juizados`/`juizado`/`jef`/`recursal`/`tr` → `turmas`; `comum`/`trf`/`tribunal` → `trf2`;
`uniformizacao` → `tru`.

Contagens medidas (`dano moral`, escopo inteiro teor, sem data, 25/07/2026):

```
trf2 20.201 · tru 84 · turmas 33.365
todas 53.650   (= 20.201 + 84 + 33.365, fecha exato)
```

Com recorte 01/01/2026–31/03/2026: `1.121 + 7 + 888 = 2.016`. Se algum dia essas contagens
ficarem iguais, o filtro parou de ser aplicado — é o que o `TRF2Testes.js` vigia.

Dois sinais na própria saída confirmam o recorte:

| campo | Justiça Federal comum | Turmas Recursais |
|---|---|---|
| `sufixoOrigem` | `TRF2` | `RJ` / `ES` |
| `orgaoJulgador` | `1ª TURMA ESPECIALIZADA` | `2ª TURMA RECURSAL DO RIO DE JANEIRO` |

⚠️ Diferente do TJSC, aqui o `tipoDocumento` **não** distingue origem — é "Acórdão" nas duas.
O `--json` devolve `origemAplicada` com o rótulo do que de fato foi enviado.

Prints lado a lado: `human-codegen/TRF2/01-eproc-jurisprudencia/06.01-resultados-trf2.png`
e `06.02-resultados-turmas-recursais.png`.

---

## Exemplos

```bash
# Justiça Federal comum (default), com período de julgamento
./bin/jur trf2 -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" -m 2

# Juizados Especiais Federais / Turmas Recursais — mesma busca, outro universo
./bin/jur trf2 -q "aposentadoria especial" -di "01/01/2026" -df "31/03/2026" --origem turmas

# Operadores (o crawler já hifeniza; estes são os que funcionam)
./bin/jur trf2 -q '"aposentadoria especial"'     # frase exata isolada
./bin/jur trf2 -q 'dano ou moral'                # vira dano-ou-moral
./bin/jur trf2 -q 'dano nao moral'               # vira dano-nao-moral
./bin/jur trf2 -q 'dano prox moral'              # prox: mantido com espaço
./bin/jur trf2 -q 'embarg*'                      # curinga de sufixo

# Só na ementa (o default do site — e do crawler — é INTEIRO TEOR)
./bin/jur trf2 -q "dano moral" --escopo ementa
./bin/jur trf2 -q "dano moral" --escopo ementa --caput

# Tipo de documento, órgão, relator, classe
./bin/jur trf2 -q "dano moral" -t acordao
./bin/jur trf2 -q "dano moral" -oj "1ª TURMA ESPECIALIZADA"
./bin/jur trf2 -q "tempo especial" -cl "Apelação Cível" -r "REIS FRIEDE"

# Coleta grande: 100 por página derruba o nº de round-trips por 10
./bin/jur trf2 -q "tempo de servico" --por-pagina 100 -m 3

# VERIFICAR um julgado (consulta direta por número)
./bin/jur trf2 -n "5081315-58.2021.4.02.5101" --json
./bin/jur trf2 -n "5081315-58.2021.4.02.5101" --datajud --json   # + metadados do CNJ

# Auditar uma busca + baixar inteiro teor
./bin/jur trf2 -q "usucapiao" --verificar 5 --json
./bin/jur trf2 -q "usucapiao" -m 1 --fetch-inteiro-teor --output-dir ./resultados/trf2

# Listar os combos
./bin/jur trf2 --listar-combos --origem turmas
```

## Flags específicas

Além das flags comuns (ver `CLAUDE.md`):

| Flag | Valores | Observação |
|---|---|---|
| `--origem` | `trf2` (default) `turmas` `tru` `todas` | **a desambiguação** — ver tabela acima |
| `-n, --numero` | nº CNJ | consulta direta; dispensa `-q`; exit 1 se não encontrar |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto) |
| `--escopo` | `inteiroTeor` (**default**) `ementa` | ver ressalva 3 |
| `--caput` | | com `--escopo ementa`: só o caput |
| `-t, --tipo` | `acordao` `monocratica` `sumula` `despacho-vice` (vírgula) | ver ressalva 4 |
| `-oj, --orgao` | nome, vírgula | 52 opções no TRF2, 28 nas Turmas |
| `-r, --relator` | nome, vírgula | 118 / 78 / 55 nomes por origem |
| `-cl, --classe` | nome, vírgula, ex.: `"Apelação Cível"` | 150 / 32 / 21 opções |
| `-p, --processo` | nº | filtro **dentro** da busca (use `-n` para consulta direta) |
| `--precedente-relevante` | | só precedentes marcados pelo tribunal |
| `--sem-agrupar` | | desliga "Agrupar Resultados" (o site vem com ele ligado) |
| `--literal` | | envia a query como digitada, **sem** o conserto do espaço |
| `-ord` | `recentes` (default) `antigos` | |
| `--por-pagina` | `10` (default) `25` `50` `100` | |
| `--listar-combos` | | origens, tipos, órgãos, relatores, classes |
| `--fetch-inteiro-teor` | | baixa o `.txt` de cada resultado |
| `--verificar [N]` | default 5 | reconsulta N processos e confere o `id` do documento |
| `--datajud` | com `-n` | consulta também o DataJud (CNJ) como fonte secundária |
| `-v / --headed` | | **sem efeito** — este crawler não abre browser |

## Operadores — testados um por um

Referência (origem TRF2, escopo inteiro teor, 25/07/2026):
`dano` = 109.452 · `moral` = 22.867.

| Sintaxe | Funciona? | Evidência |
|---|---|---|
| termo único | ✅ | `aposentadoria` = 102.988 |
| `"frase exata"` isolada | ✅ | `"dano moral"` = 18.457 |
| espaço entre termos | ❌ **QUEBRA** | 46 em vez de 20.201 — ver ressalva 1 |
| hífen (E implícito) | ✅ | `dano-moral` = 20.201 |
| `ou` | ✅ | `dano-ou-moral` = 112.118 (fecha exato) |
| `nao` / `não` | ✅ | `dano-nao-moral` = 89.251 (fecha exato) |
| `prox` (**com espaço**) | ✅ | `dano prox moral` = 18.888 |
| `prox` com hífen | ❌ | página de erro do e-Proc |
| `prox5` / `prox(5)` / `adj` | ❌ | 0 resultados — viram termo literal |
| `*` (curinga de sufixo) | ✅ | `embarg*` = 284.535 |
| `?` e `$` | ❌ | `dan?` = `dan$` = `dan` = 98 |
| frase + outro termo | ❌ | `"dano moral" e aposentadoria` = 5 |
| MAIÚSCULAS / acentos | indiferentes | `tributário` = `tributario` = 157.733 |

Detalhes e o `termosPesquisados` de cada teste:
`human-codegen/TRF2/01-eproc-jurisprudencia/07-operadores.txt` e `07-operadores-testados.json`.

## API oficial — procurada, e o que existe

| Onde | Resultado |
|---|---|
| `dadosabertos.trf2.jus.br`, `api.trf2.jus.br` | NXDOMAIN |
| `trf2.jus.br/dados-abertos`, `/transparencia/dados-abertos`, `/api-docs`, `eproc/swagger` | 404 |
| busca web `site:trf2.jus.br api` | nada de jurisprudência |
| **CJF — Jurisprudência Unificada** `jurisprudencia.cjf.jus.br/unificada/` | existe e lista "TRF2", mas a base do TRF2 está **VAZIA** (0 documentos) |
| **DataJud (CNJ)** `api-publica.datajud.cnj.jus.br/api_publica_trf2/_search` | **funciona** — 4.526.292 processos, só metadados |

**Não existe API oficial de jurisprudência do TRF2.** Isso é resultado de busca, não
omissão.

Sobre a **Unificada do CJF** — ela é o candidato natural a "base nacional do ramo"
(o equivalente da Falcão na Justiça do Trabalho) e **não serve**. Medido em 25/07/2026,
`aposentadoria` por tribunal: TNU 11.506 · TRF1 252.794 · **TRF2 0** · TRF3 542.469 ·
TRF4 16.573 · TRF5 40.911. `dano moral` no TRF2 também devolve 0.

Sobre o **DataJud**: metadados processuais (classe, órgão, grau, movimentos), sem ementa e
sem inteiro teor — **não substitui o crawler**, mas responde "este processo existe no
TRF2?". Duas ressalvas: a chave pública que circulava até 2024 já não vale (401), a atual
está em `datajud-wiki.cnj.jus.br/api-publica/acesso`; e a API é instável (em 5 chamadas
seguidas, 3 devolveram `search_phase_execution_exception` ou timeout). Por isso só é
consultada com `--datajud`, e a falha dela nunca derruba a verificação principal.
A chave pode ser sobrescrita por `DATAJUD_API_KEY`.

## Ressalvas importantes

1. **O espaço quebra a busca** — a mais cara. Ver a seção dedicada acima. Se alguém apontar
   o TRF2 para uma query com espaço sem passar pelo crawler, a busca "funciona" e devolve
   quase nada.
2. **Não há bloqueio anti-bot.** Sem Cloudflare, sem captcha, sem verificação F5/Shape. A
   busca e o download passam sem cookie de sessão; headless é irrelevante; `--headed` não
   faz nada. Não copie o cuidado de UA do `TJSCNavigator` achando que é necessário aqui.
3. **O escopo default é INTEIRO TEOR, não ementa** — é o default do próprio site
   (`#optInteiroTeor` vem `checked`), e o crawler o mantém para que as contagens batam com
   a tela. `--escopo ementa` reduz muito: 20.201 → 6.911; com `--caput`, 3.242.
4. **"Súmula" é um tipo declarado e vazio.** O combo oferece Súmula (`3`) na origem TRF2,
   mas a base tem **zero**. E Súmula e Despacho da Vice-Presidência **não existem** nas
   Turmas Recursais nem na TRU2 — pedir lá é recusado pelo crawler, porque o servidor
   simplesmente **ignora o filtro** em vez de dar erro. Os códigos, ao contrário do TJSC,
   **não mudam** com a origem (Acórdão é sempre `1`).
5. **`#txtProcesso` sozinho devolve 0.** O portal exige texto em `#txtPesquisa` para rodar
   a consulta — qualquer número de processo, mesmo existente, volta "0 documentos" se o
   campo de texto estiver vazio. O `TRF2Checker` usa o curinga `*` (casa com a base
   inteira, 839.228 documentos, e portanto não restringe). Não troque por um termo comum:
   `recurso` devolveu 3 documentos onde `*` devolve 5 — restringe de verdade e produziria
   falso negativo numa verificação.
6. **A base começa em 2018.** Nada antes disso (2016 e 2017 = 0 em qualquer termo). O
   acervo anterior vivia no `juris.trf2.jus.br`, que foi desativado sem substituto — e a
   Unificada do CJF, que teria esse papel, está vazia para o TRF2. Uma busca histórica
   ("jurisprudência dos anos 2000 no TRF2") **não tem resposta nesta base**; diga isso em
   vez de devolver lista vazia.
7. **Um processo pode ter vários documentos** (acórdão + monocrática + despacho da
   Vice-Presidência). O identificador do *documento* é o `id`. Confirmar o número do
   processo **não** confirma a decisão citada — a auditoria confere o `id`.
8. **A ementa já vem inteira no resultado**, inclusive nas Turmas Recursais — diferente do
   TJSC, onde a ementa da Turma Recursal é uma frase e exige inteiro teor. Aqui
   `--fetch-inteiro-teor` é opcional; sirva para ter o documento formatado.
   Nem todo card traz EMENTA: monocráticas costumam vir só com DECISÃO, e o crawler cai
   para o texto de citação (`data-citacao`) quando falta.
9. **Encoding ISO-8859-1** em tudo — HTML de resultado e inteiro teor. O navigator
   codifica o corpo do POST como latin-1 e decodifica a resposta idem. Não decodifique
   por fora.
10. **Filtros que este módulo NÃO tem:** área Cível × Criminal, comarca/subseção, juiz de
    1º grau, e a antiga faceta "Competência" do portal desativado. Assunto e Unidade
    Federativa existem **só como faceta da tela de resultados**, não como parâmetro de
    busca — aproxime-se por `-oj` (as Turmas Especializadas são temáticas) ou por `-cl`.
11. **Custo.** HTTP puro: ~0,5 s por busca, sem Chromium. Rodar `--origem trf2` e
    `--origem turmas` em paralelo é barato. Compare com o TJSC (~10 s por busca, browser).
12. **Numeração CNJ do TRF2 é `.4.02.`** (`cnj.pertenceA(n, 4, 2)`). Toda a base nova está
    em formato CNJ; há números antigos com sequencial no formato antigo
    (`0085909-79.2016.4.02.5101`), mas ainda com máscara CNJ.
