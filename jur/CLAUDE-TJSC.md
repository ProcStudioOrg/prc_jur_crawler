# TJSC — Tribunal de Justiça de Santa Catarina

Comando: `./bin/jur tjsc` · Stack: `src/TJSCCrawler.js` + `src/TJSCNavigator.js` +
`src/TJSCChecker.js` · Testes: `node src/TJSCTestes.js` (`npm run test:tjsc`) ·
Verificação: `skills/verificador/tribunais/tjsc.md` ·
Mapeamento: `human-codegen/TJSC/`

## Sistema alvo — atenção, o TJSC tem DOIS portais no ar

| Portal | URL | Situação |
|---|---|---|
| **Novo (e-Proc)** ← o que o crawler usa | `eprocwebcon.tjsc.jus.br/consulta1g/...jurisprudencia/pesquisar` | base viva, 442 mil docs só de "dano moral", cobre de 2010 ao dia corrente |
| Antigo ("Jurisprudência Catarinense") | `busca.tjsc.jus.br/jurisprudencia/` | **base histórica congelada** desde 08/10/2025 (aviso na própria tela) |

Prova do congelamento: `"dano moral"` entre 01/01/2026 e 31/03/2026 devolve
**15** resultados no portal antigo contra **8.315** no novo. Se alguém apontar o
TJSC para `busca.tjsc.jus.br`, a busca "funciona" e devolve quase nada — é o
erro mais caro possível aqui. O legado está mapeado em
`human-codegen/TJSC/02-busca-legado/` só como plano B.

O portal novo é o **mesmo módulo `eproc-jur` do TRF4** (mesmos ids, mesma
paginação). Quem já leu `CLAUDE-TRF4.md` reconhece a tela.

## Justiça Comum × Juizados Especiais — a desambiguação

É o filtro `--origem` (combo "Origem" / `#selOrigem`). **Sempre explicite.**

| `--origem` | Combo do site | `#selOrigem` | O que é |
|---|---|---|---|
| `comum` (**default**) | TJSC | `1` | **Justiça Comum**, 2º grau (Câmaras, Grupos, Seções, Órgão Especial) |
| `turmas` | Turmas Recursais | `3` | **Juizados Especiais**, 2º grau |
| `uniformizacao` | Turmas de Uniformização | `4` | Juizados Especiais, uniformização |
| `conselho` | Conselho da Magistratura | `5` | administrativo |
| `todas` | (as quatro marcadas) | `1,3,4,5` | tudo junto |

Aliases aceitos: `juizados`/`juizado`/`turmas-recursais`/`recursal` → `turmas`;
`tjsc`/`tj`/`justica-comum` → `comum`.

Contagens medidas (`"dano moral"`, julgamento 01/01/2026–31/03/2026, escopo
inteiro teor — o default):

```
comum 8.315 · turmas 893 · uniformizacao 5 · conselho 0
todas 9.213  (= 8.315 + 893 + 5 + 0, fecha exato)
```

Três sinais na própria saída confirmam o recorte — confira antes de rotular:

| campo | Justiça Comum | Turmas Recursais |
|---|---|---|
| `tipoDocumento` | `Acórdãos do Tribunal de Justiça` | `Acórdãos das Turmas Recursais` |
| `orgaoJulgador` | `3ª Câmara de Direito Civil` | `2ª Turma Recursal` |
| `sufixoOrigem` | `TJSC` | `SC` |

O `--json` devolve `origemAplicada` com o rótulo do que de fato foi marcado.

Prints lado a lado: `human-codegen/TJSC/01-eproc-jurisprudencia/06.01-resultados-justica-comum.png`
e `06.02-resultados-turmas-recursais.png`.

## Exemplos

```bash
# Justiça Comum (default), com período de julgamento
./bin/jur tjsc -q "dano moral" -di "01/01/2026" -df "31/03/2026" -m 2

# Juizados Especiais / Turmas Recursais — mesma busca, outro universo
./bin/jur tjsc -q "dano moral" -di "01/01/2026" -df "31/03/2026" --origem turmas

# Operadores nativos, dentro do -q (em português e minúsculas)
./bin/jur tjsc -q '"usucapiao extraordinaria"'
./bin/jur tjsc -q 'usucapiao nao extraordinaria'
./bin/jur tjsc -q 'financiamento ou credito'
./bin/jur tjsc -q 'usucapi*'

# Buscar só na ementa (o default do site — e do crawler — é INTEIRO TEOR)
./bin/jur tjsc -q "dano moral" --escopo ementa

# Só acórdãos / só monocráticas (o código muda por origem: ver ressalva 3)
./bin/jur tjsc -q "dano moral" -t acordao
./bin/jur tjsc -q "dano moral" --origem turmas -t monocratica

# Órgão julgador, relator, classe
./bin/jur tjsc -q "furto" -oj "3ª Câmara Criminal"
./bin/jur tjsc -q "consumidor" --origem turmas -oj "2ª Turma Recursal"
./bin/jur tjsc -q "alimentos" -r "ANDRÉ CARVALHO" -cl "Apelação"

# Coleta grande: 100 por página derruba o nº de round-trips por 10
./bin/jur tjsc -q "tempo de servico" --por-pagina 100 -m 3

# VERIFICAR um julgado (consulta direta por número)
./bin/jur tjsc -n "5014543-38.2025.8.24.0054" --json

# Auditar uma busca + baixar inteiro teor
./bin/jur tjsc -q "usucapiao" --verificar 5 --json
./bin/jur tjsc -q "usucapiao" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjsc

# Listar os combos da origem escolhida (dependem dela!)
./bin/jur tjsc --listar-combos --origem turmas
```

## Flags específicas

| Flag | Valores | Observação |
|---|---|---|
| `--origem` | `comum` (default) `turmas` `uniformizacao` `conselho` `todas` | **a desambiguação** — ver tabela acima |
| `-n, --numero` | nº CNJ | consulta direta; dispensa `-q`; exit 1 se não encontrar |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto) |
| `--escopo` | `inteiroTeor` (**default**) `ementa` | ver ressalva 2 |
| `-t, --tipo` | `acordao` `monocratica` `despacho` (vírgula) | exige `--origem` específica — ver ressalva 3 |
| `-oj, --orgao` | nome, vírgula | o combo depende da `--origem` |
| `-r, --relator` | nome, vírgula | |
| `-cl, --classe` | nome, vírgula, ex.: `"Apelação"` | 415 opções |
| `-p, --processo` | nº | filtro **dentro** da busca (use `-n` para consulta direta) |
| `--precedente-relevante` | | só precedentes marcados pelo NUGEPNAC |
| `-ord` | `recentes` (default) `antigos` | |
| `--por-pagina` | `10` (default) `25` `50` `100` | ver ressalva 6 |
| `--listar-combos` | | lista origens/tipos/órgãos/relatores/classes da `--origem` |
| `--fetch-inteiro-teor` | | baixa o `.txt` de cada resultado (reusa a sessão) |
| `--verificar [N]` | default 5 | reconsulta N processos e confere o `id` do documento |
| `-v / --headed` | | mostra o browser (útil quando a verificação de segurança embirra) |
| `-m, --max-pages` | default 10 | |

## Operadores de pesquisa — testados um por um

Referência: `usucapiao` = 41.346 · `usucapiao extraordinaria` = 11.818
(origem TJSC, sem data, escopo inteiro teor).

| Sintaxe | Funciona? | Evidência |
|---|---|---|
| `"frase exata"` | ✅ | `"usucapiao extraordinaria"` = 10.621 |
| espaço (E implícito) | ✅ | 11.818 |
| `e` (minúsculo) | ✅ | idêntico ao implícito: 11.818 |
| `ou` (minúsculo) | ✅ | 131.006 |
| `nao` (minúsculo) | ✅ | 29.528 = 41.346 − 11.818, exato |
| `*` (curinga) | ✅ | `usucapi*` = 42.068 |
| `prox` (sem número) | ✅ | 10.807 |
| `prox5` / `prox(5)` | ❌ | 0 e 2 resultados — vira termo literal |

⚠️ Diferente do TJRS: aqui os operadores são **em português e em minúsculas**, e
o curinga `*` **funciona**. Detalhes em
`human-codegen/TJSC/01-eproc-jurisprudencia/07-operadores.txt`.

## Ressalvas importantes

1. **Verificação de segurança (F5/Shape) na frente do portal.** O host devolve
   uma página de desafio JavaScript antes do formulário. Consequências:
   - **não dá para usar HTTP puro** — por isso este crawler é `browser`, apesar
     de `api > http > browser` ser a ordem preferida do repo;
   - **o User-Agent importa**: com o UA padrão do Playwright headless
     (`HeadlessChrome/...`) o desafio **nunca** libera (8 tentativas seguidas
     bloqueadas); com um UA de Chrome comum libera na 1ª. O `TJSCNavigator` fixa
     o UA por isso — **não troque sem medir**;
   - o desafio às vezes precisa de um 2º GET; o navigator repete até `#txtPesquisa`
     existir e só então desiste, com mensagem explícita. Se der erro, tente de
     novo ou use `--headed`.
   - Não é captcha: não há nada para resolver à mão.
2. **O escopo default é INTEIRO TEOR, não ementa.** É o default do próprio site
   (`#optInteiroTeor` vem `checked`), e o crawler o mantém para que as contagens
   batam com a tela. `--escopo ementa` reduz muito: 8.315 → 2.169 na mesma busca.
   (No TJRS é o contrário — lá o default é ementa.)
3. **Os códigos de tipo de documento MUDAM com a origem.** "Acórdão" é `1` no
   TJSC e `7` nas Turmas Recursais, e mandar o código de outra origem **não dá
   erro — o servidor ignora**. Por isso `-t` é traduzido sempre em função de
   `--origem`, e é **recusado** junto de `--origem todas` (melhor falhar alto do
   que filtrar de mentira).
4. **O eproc guarda o estado da última busca em COOKIES**
   (`pesquisarEm`, `origem`, `tipoDocumento`) e repõe o formulário ao reabrir a
   página. Descoberto na prática: uma consulta por nº de processo deixava o
   `#txtProcesso` preenchido e a busca seguinte voltava 0 resultados **sem
   qualquer aviso**. O navigator agora reescreve TODOS os campos a cada busca,
   inclusive os vazios. Se você mexer no `pesquisar()`, mantenha isso.
5. **Buscas em sequência na MESMA sessão têm três armadilhas** — as três só
   aparecem quando se reaproveita o browser (o que a suíte e o `--verificar`
   fazem, para não pagar o desafio a cada consulta). Todas produziam **zero
   silencioso e intermitente**:
   - **`#selOrigem` perde a seleção** se dois `change` chegarem juntos: cada
     `change` recarrega os quatro combos dependentes por AJAX, e o reload pode
     limpar a marcação. Buscar sem origem marcada devolve 0. `definirOrigem()` é
     idempotente, confere se a seleção fixou e **aborta** se não fixar.
   - **`#txtPesquisa` também existe na página de resultados**, então sua presença
     não prova que voltamos ao formulário. `abrir()` checa a URL
     (`listar_resultados` = ainda na listagem) antes de dar a página por pronta.
   - **O contador da busca anterior sobrevive ao clique**: o submit é um POST de
     documento, e ler a tela antes da navegação lê o "0 documentos encontrados"
     da consulta passada. `pesquisar()` espera a navegação junto com o clique.
6. **Paginação e tamanho de página.** 10 resultados/página por default; o combo
   aceita 25/50/100 e vale usar (`--por-pagina 100`) em coletas grandes. Acima de
   1.000 resultados o site exibe "Foram encontrados mais de 1000 documentos […]
   Utilize mais parâmetros" — é **aviso de UX, não corte**: o contador segue real
   e a paginação continua andando.
   ⚠️ **Os cards da página anterior permanecem no DOM durante a troca.** Esperar por
   `networkidle` ou por "existe `.resultadoItem`" lê a lista velha, conclui que nada
   mudou e faz a paginação parar na página 1 **em silêncio** — `-m 3` devolvendo 10
   resultados. Foi assim que o teste de aceite pegou o bug. O único sinal confiável é
   o **id do primeiro card mudar**. O mesmo vale para a troca de `--por-pagina`, que
   passa por **zero cards** no meio da recarga: quem espera "o número de cards mudou"
   lê o vale e extrai 0.
7. **"Não carregou" nunca é traduzido como "não existe".** Zero cards é ambíguo: pode
   ser busca vazia ou página no meio do POST. O navigator distingue três estados
   (`itens` · `vazio`, quando o contador diz "0 documentos encontrados" ·
   `indefinido`) e o **Checker levanta erro** em vez de responder `encontrado:false`
   quando o estado é `indefinido`. Não é teórico: numa rodada em que o site ficou
   lento (minutos por consulta) a auditoria reprovou o processo
   `5048438-55.2025.8.24.0000`, que **existe** e volta com o mesmo `id` quando
   reconsultado. Para um verificador, falhar alto é melhor do que mentir. Se aparecer
   "a página de resultados não carregou a tempo", **repita** — não conclua ausência.
8. **Encoding do inteiro teor é ISO-8859-1**, mesmo o documento declarando
   `<?xml encoding="ISO-8859-1"?>`. O navigator tenta UTF-8 estrito e cai para
   windows-1252. Não decodifique por fora.
   O download reaproveita os cookies do desafio (`context.request`), então a
   sessão precisa continuar aberta — a CLI cuida disso com `--fetch-inteiro-teor`.
   O host derruba conexões de vez em quando (ECONNRESET observado 1× em ~15
   downloads); há 3 retentativas e um fallback por aba.
9. **Filtros que este portal NÃO tem** (e o antigo tinha): **Comarca**, **Juiz
   Prolator** separado do relator, e os campos separados de busca avançada (com
   todas / com a expressão / com qualquer uma / sem as palavras) com proximidade
   parametrizada. Também **não há filtro de área Cível × Criminal** (o TJRS tem):
   aproxime-se pelo `-oj` (Câmara de Direito Civil × Câmara Criminal) ou por `-cl`.
10. **Um processo pode ter vários documentos** (acórdão + monocrática). O
   identificador do *documento* é o `id` (o `value` do `input.chkDocumento`).
   Confirmar o número do processo **não** confirma a decisão citada — a auditoria
   confere o `id`.
11. **Custo.** Cada busca sobe um Chromium e paga o desafio: ~10 s por busca,
   ~4 s só de warm-up. Rodar `--origem comum` e `--origem turmas` são dois
   processos separados. Compare com TJRS (HTTP puro, sub-segundo).
12. **Numeração CNJ do TJSC é `.8.24.`** (`cnj.pertenceA(n, 8, 24)`). Diferente do
    TJRS, aqui não há acervo pré-CNJ relevante na base nova: os números vêm todos
    em formato CNJ.
