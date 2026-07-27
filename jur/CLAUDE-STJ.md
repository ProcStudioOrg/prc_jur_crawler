# STJ — Superior Tribunal de Justiça

> # 🔴 BLOQUEADO DESDE 27/07/2026 — NÃO RODAR `jur stj`
>
> ## O que foi medido (27/07/2026)
>
> | Teste | Resultado |
> |---|---|
> | `curl https://scon.stj.jus.br/SCON/` | **HTTP 403**, header **`cf-mitigated: challenge`**, `server: cloudflare` |
> | `curl https://processo.stj.jus.br/processo/pesquisa/` | **HTTP 403**, mesmo desafio |
> | Playwright headless, 30s na página | trava em `Just a moment...`; texto: "Verificação automática em andamento… **caso não seja redirecionado, responda ao desafio abaixo**"; campo de busca nunca aparece |
> | `./bin/jur stj -q "dano moral" -m 1` | `Verificação automática do STJ ainda ativa (tentativa 1/10)` → `Target page, context or browser has been closed` |
>
> ## O que mudou
>
> O SCON sempre esteve atrás do Cloudflare, mas até então era a verificação
> **automática**, que limpava sozinha num navegador headful — daí o
> `--headed` ser o modo padrão documentado deste tribunal. Agora a página
> oferece **desafio interativo** ("responda ao desafio abaixo"), que é outra
> coisa: exige um humano. **Este repo não automatiza captcha** (mesma decisão
> consciente tomada no TJMA).
>
> Ressalva honesta: o modo headful **não pôde ser reconfirmado** no ambiente do
> diagnóstico, onde o Chromium com janela morre por motivo próprio. O que está
> provado é o 403 com `cf-mitigated: challenge` e o headless travado — e o
> relato de campo de vários agentes bloqueados. Se alguém conseguir passar com
> Chrome real e perfil logado, registre aqui.
>
> ## Consequências que o agente precisa aceitar
>
> 1. **Não rode o comando** "para tentar" — ele queima 10 tentativas e falha.
> 2. **Não existe substituto para o STJ** em lei federal infraconstitucional.
>    Ofereça `trf*`/`tj*` **dizendo que é instância inferior** e que a
>    orientação do STJ não pôde ser conferida. Constitucional → `stf` (🟢).
> 3. **Não cite acórdão do STJ de memória.** O `verificador` não confirma nada
>    no STJ agora, então todo REsp lembrado é não verificável — e julgado não
>    verificado não entra na resposta.
> 4. `jur stj -n <número CNJ>` ainda cai no **DataJud** e confirma que o
>    **processo** existe — nunca que a **decisão** existe.
>
> ## Como retestar (leva 5 segundos)
>
> ```bash
> curl -sI https://scon.stj.jus.br/SCON/ | grep -i "cf-mitigated\|HTTP/"
> ```
>
> Sumiu o `cf-mitigated: challenge` e voltou 200 → o bloqueio caiu. Aí:
> `node src/STJTestes.js`, e reverta o status em `CLAUDE.md` (alerta do topo +
> tabela), `skills/browser/SKILL.md` (HARD-GATE + tabela),
> `skills/verificador/tribunais/stj.md` e `cobertura/build.js` (+ rodar o build).

Comando: `./bin/jur stj` · Stack: `src/STJCrawler.js` + `src/STJNavigator.js` +
`src/STJChecker.js` · Testes: `node src/STJTestes.js` ·
Mapeamento: `human-codegen/STJ/`

**Corte de superposição, competência nacional.** A jurisprudência do STJ orienta
ou vincula todos os TJs e TRFs em matéria de lei federal — é o que se cita
primeiro. Não há 1º grau, não há Juizado Especial, não há Turma Recursal: o
acervo é só do próprio Tribunal.

---

## API oficial — o que existe e o que NÃO existe

Procurado em 25/07/2026, e o resultado é misto:

**EXISTE portal de dados abertos, com CKAN API:** <https://dadosabertos.web.stj.jus.br>
(21 datasets; a API é a padrão do CKAN, `/api/3/action/package_list`,
`/api/3/action/package_show?id=<slug>` — documentação em <https://docs.ckan.org/en/2.9/api/>).
Os datasets de jurisprudência são:

| dataset | conteúdo |
|---|---|
| `espelhos-de-acordaos-corte-especial` e mais 9 (`…-primeira-secao`, `…-primeira-turma`, `…-segunda-secao`, `…-segunda-turma`, `…-terceira-secao`, `…-terceira-turma`, `…-quarta-turma`, `…-quinta-turma`, `…-sexta-turma`) | **os espelhos dos acórdãos em JSON**, um conjunto por órgão julgador, com carga mensal incremental (o 1º arquivo é um ZIP com todo o histórico) + dicionário de dados em CSV |
| `precedentes-qualificados` | temas repetitivos e IACs em CSV (`temas.csv` + `processos.csv`, ligados por `sequencialPrecedente`) |
| `integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica` | inteiros teores publicados no DJe |
| `api-publica-datajud` | ponteiro para a API do CNJ (metadados processuais) |

**Mas é dado em LOTE, não busca.** São arquivos para download e indexação
própria, sem endpoint de consulta por termo. Um crawler de jurisprudência
precisa perguntar "quem decidiu X?" — o CKAN só responde "aqui está tudo".
Por isso **o crawler usa a tela (SCON) e não a API**; os dados abertos ficam
registrados aqui como o caminho certo para quem for construir um índice local.

**NÃO existe** API REST de *busca* de jurisprudência do STJ: procurado por
Swagger/OpenAPI/`/api-docs` no domínio e no buscador, sem resultado. O
`scon.stj.jus.br` não expõe endpoint JSON — a tela é HTML servido por JSP.

**DataJud (CNJ) cobre o STJ**: índice `api_publica_stj`, confirmado ao vivo com
a chave pública. Só metadados (sem ementa) — serve ao `Checker` quando o número
vem no formato CNJ. É o que o `STJChecker` usa nesse caso.

---

## Sistema alvo: SCON

**Módulo principal (o que o crawler usa):**
`https://scon.stj.jus.br/SCON/` → `GET /SCON/pesquisar.jsp?<querystring>`

Motor BRS/Oracle Text. **Toda a busca cabe na querystring** — sem POST, sem
viewState, sem sessão de formulário. Seria um crawler `http` puro perfeito, se
não fosse o bloqueio (abaixo).

**Todos os módulos de jurisprudência do STJ**, confirmados no ar em 25/07/2026:

| # | Módulo | URL | No crawler |
|---|---|---|---|
| 01 | **Jurisprudência (acórdãos)** — SCON, base `ACOR` | `scon.stj.jus.br/SCON/` | ✅ **principal** |
| 01b | Decisões monocráticas — base `DTXT` | mesmo formulário | ✅ `--base monocratica` |
| 02 | Súmulas / Súmulas Anotadas | `scon.stj.jus.br/SCON/sumstj/` | ❌ tela própria |
| 03 | **Precedentes Qualificados** (repetitivos, controvérsias, IACs, SIRDRs, PUILs) | `processo.stj.jus.br/repetitivos/temas_repetitivos/` | ✅ **`--temas`** |
| 04 | Jurisprudência em Teses | `scon.stj.jus.br/SCON/jt/` | ❌ tela própria |
| 05 | Informativo de Jurisprudência | `processo.stj.jus.br/jurisprudencia/externo/informativo/` | ❌ |
| 06 | Repetitivos e IACs Anotados | `scon.stj.jus.br/SCON/recrep/` | ❌ |
| 07 | Pesquisa Pronta | `scon.stj.jus.br/SCON/pesquisa_pronta/` | ❌ (o combo Notas cobre parte, ver `--nota`) |
| — | Jurisprudência do extinto TFR | `scon.stj.jus.br/SCON/juritfr/` | ❌ acervo histórico |

⚠️ `scon.stj.jus.br/SCON/informativo/` é **404** — a URL boa do Informativo é a
do outro host.

---

## ⚠️ Ressalva nº 1: o crawler roda HEADFUL

`scon.stj.jus.br` está atrás de um **Cloudflare** operado pela CSID/STJ. Medido
em 25/07/2026:

| via | resultado |
|---|---|
| `curl` / `fetch` | 403 sempre |
| Playwright headless (headless shell) | 403 em 4/4 tentativas |
| Playwright headless `channel: 'chromium'` | 403 em 4/4 |
| Playwright headless `channel: 'chrome'` | 403 em 4/4 |
| **Playwright headful** | passa na 1ª ou 2ª |

Trocar o User-Agent **não** resolve (diferente do TJSC, onde bastava). Por isso:

- o comando abre uma **janela de Chromium** — é o comportamento normal, não bug;
- `-v/--visible/--headed` são ignorados (já é o padrão);
- existe `--headless` para **testar se o bloqueio caiu**; hoje ele falha.

Vencido o desafio, o mesmo contexto faz HTTP puro: uma janela aberta, N
requisições rápidas. Uma busca de 3 páginas leva ~15 s no total.

O módulo `--temas` (precedentes qualificados) vive em **outro host, sem
Cloudflare**, e roda headless.

## ⚠️ Ressalva nº 2: querystring em ISO-8859-1

O SCON declara `charset=ISO-8859-1` e interpreta a querystring nesse charset.
`usucapião` percent-encodado em **UTF-8 devolve 0 resultados, em silêncio**; em
latin-1 devolve 2.356. O `STJNavigator.encLatin1()` cuida disso — não troque por
`URLSearchParams`. Mesma família de armadilha do TJPR e do TJGO.

## ⚠️ Ressalva nº 3: sem `Referer`, o site devolve o formulário

Um `GET` em `pesquisar.jsp?...` sem cabeçalho `Referer` renderiza a **tela de
busca vazia** em vez dos resultados, sem erro. O navigator manda sempre
`Referer: https://scon.stj.jus.br/SCON/`.

## ⚠️ Ressalva nº 4: as datas visíveis não filtram

`dtde1/dtde2` (julgamento) e `dtpb1/dtpb2` (publicação) são decorativos. Quem
filtra é o parâmetro **`data`**, que o JS da página monta:

```
data=@DTDE >= "20250101" AND @DTDE <= "20251231"
```

Mandar só `dtde1/dtde2` devolve a busca inteira — 28.348 com e sem data. O
crawler monta o `data` (`STJNavigator.montarData`).

## ⚠️ Ressalva nº 5: paginação profunda quebra (ORA-01013)

A partir de ~800 documentos o Oracle aborta:
*"A pesquisa foi interrompida por demora excessiva na execução"*.
Medido na mesma busca de 1.697 resultados: `i=701` ok, `i=901` ORA-01013.
O crawler reconhece o estado e **para com aviso** em vez de devolver zero. Para
ir além, refine por data ou órgão. A base de monocráticas (`--base monocratica`)
estoura antes: termos muito genéricos já falham na página 1.

---

## A desambiguação do STJ: ÓRGÃO e TIPO DE DOCUMENTO

Não existe Juizado × Justiça Comum aqui. Existem duas outras separações, e as
duas mudam o resultado de verdade.

### 1. Órgão julgador — e ele define a MATÉRIA

| Órgão | Código | Competência |
|---|---|---|
| Primeira Seção + 1ª e 2ª Turmas | `S1` `T1` `T2` | **direito público**: tributário, administrativo, previdenciário |
| Segunda Seção + 3ª e 4ª Turmas | `S2` `T3` `T4` | **direito privado**: civil, empresarial, consumidor |
| Terceira Seção + 5ª e 6ª Turmas | `S3` `T5` `T6` | **direito penal** e processual penal |
| Corte Especial | `CE` | competência plenária, uniformização entre Seções |
| Presidência / Vice-Presidência | `PS` `VP` | só decisões monocráticas (0 acórdãos) |

Contagens de `"dano moral"` na base de acórdãos (25/07/2026):

```
T1  2.097   T2  3.247   T3 10.476   T4 11.408   T5   442   T6  161
S1    110   S2    298   S3     24   CE     85   PS     0   VP    0
                                      SOMA = 28.348 = total sem filtro
```

**A soma dos 12 órgãos fecha exatamente com o total.** É a prova mais forte de
que o filtro pega: partição completa, sem sobreposição. `T3,T4` = 21.884 =
10.476 + 11.408.

`--secao 2` (ou `privado`) manda `S2,T3,T4` — as Seções têm acervo próprio
(embargos de divergência, repetitivos), não são o agregado das Turmas.

### 2. Base documental (`--base`)

`"dano moral"`, julgamento em 2025: **acórdãos 1.697 × monocráticas 25.532**.

Quem busca só acórdãos não vê 94% do que o Tribunal decidiu naquele recorte —
mas monocrática não forma jurisprudência colegiada. Escolha consciente.

### Como conferir que o filtro pegou

Todo `--json` traz **`expressaoServidor`**: a consulta que o SCON de fato montou.

```
"expressaoServidor": "t3 e @dtde >= \"20250101\" ... (t3 inpath (org) or t3 inpath (corg))
                      and (dano and moral) and (@dtde>=\"20250101\" and @dtde<=\"20251231\")"
```

Sem `inpath (org)` o órgão não foi aplicado; sem `@dtde` a data não foi. É o
equivalente ao `filtroSolr` do TJRS.

---

## Precedentes qualificados — o módulo de maior valor

Aqui está a jurisprudência com força vinculante (art. 1.036 do CPC): temas
repetitivos, controvérsias, IACs, SIRDRs, PUILs, cada um com **questão submetida**,
**tese firmada**, situação, órgão, ramo do direito e processos paradigma.

Dois caminhos, e eles são complementares:

```bash
# (a) OS TEMAS em si — módulo próprio, fora do Cloudflare, roda headless
./bin/jur stj --temas -q "bem de família"
./bin/jur stj --temas controversia -q "usucapião"
./bin/jur stj --temas --tema-inicial 1000 --tema-final 1050 --ramo "DIREITO CIVIL"

# (b) OS ACÓRDÃOS julgados sob o rito — filtro dentro da base de jurisprudência
./bin/jur stj -q "consumidor" -di 01/01/2024 -df 31/12/2025 --repetitivos
```

Prova de que (b) filtra: `"consumidor"` em 2024-2025 → **3.453** acórdãos;
com `--repetitivos` → **42**.

`--repetitivos` é atalho de `--nota repetitivos`. As **25 "Notas"** são recortes
temáticos prontos, escritos pela Secretaria de Jurisprudência do STJ na própria
sintaxe do SCON — `overruling`, `distinguishing`, `afetacao`, `tese-revisada`,
`reafirmacao-jurisprudencia`, `insignificancia`, `rol-ans`… Liste com
`./bin/jur stj --listar-notas`.

---

## Duas numerações — leia antes de citar

| formato | exemplo | o SCON indexa? |
|---|---|---|
| recurso por classe | `REsp 1809043`, `AREsp 520189`, `HC 870249` | ✅ |
| registro do STJ | `2019/0116080-0` (ou `201901160800`) | ✅ |
| **CNJ, 20 dígitos** | `0000538-97.2015.4.05.8500` | ❌ **0 resultados** |

O número CNJ é o do processo de origem e **não está na base de jurisprudência**.
Com ele, o `STJChecker` cai no **DataJud** (`api_publica_stj`) e devolve a
ressalva explícita: prova que o *processo* existe, não que o *julgado* existe.

```bash
./bin/jur stj -n "REsp 1809043"          # confirmação forte (SCON, com ementa)
./bin/jur stj -n "2019/0116080-0"        # idem, pelo registro
./bin/jur stj -n "0000538-97.2015.4.05.8500"   # DataJud, confirmação fraca
```

⚠️ Um mesmo número devolve **vários documentos** (o recurso e os incidentes que
herdam o número: EDcl, AgInt, PAFRESP…). O identificador do *documento* é o
**registro**, e é ele que a auditoria (`--verificar`) confere.

⚠️ Mandar a sigla dentro do campo (`processo=REsp 1809043`) casa mal e devolve
outro processo. Passe só os dígitos — o `STJChecker` já faz isso e filtra a
classe depois.

---

## Exemplos

```bash
# Busca básica, com período de julgamento
./bin/jur stj -q "dano moral" -di 01/01/2025 -df 31/12/2025 -m 3

# Matéria penal (Terceira Seção + 5ª e 6ª Turmas)
./bin/jur stj -q "princípio da insignificância" -s penal -di 01/01/2025 -df 31/12/2025

# Matéria tributária (Primeira Seção), só a Corte Especial, órgão avulso
./bin/jur stj -q "ICMS base de cálculo" -s publico
./bin/jur stj -q "prescrição intercorrente" -oj CE
./bin/jur stj -q "consumidor" -oj "terceira-turma,quarta-turma"

# Operadores nativos (todos funcionam — ver tabela abaixo)
./bin/jur stj -q '"dano moral coletivo"'
./bin/jur stj -q 'usucapião não extraordinária'
./bin/jur stj -q 'aposentadoria prox10 especial'
./bin/jur stj -q 'usucapi$'

# Decisões monocráticas em vez de acórdãos
./bin/jur stj -q '"dano moral coletivo"' --base monocratica -di 01/01/2025 -df 31/12/2025

# Recortes prontos do STJ
./bin/jur stj -q "plano de saúde" --nota rol-ans
./bin/jur stj -q "tráfico" --nota quantidade-droga
./bin/jur stj --listar-notas
./bin/jur stj --listar-orgaos

# Temas repetitivos
./bin/jur stj --temas -q "bem de família"

# Baixar inteiro teor + auditar
./bin/jur stj -q "usucapião extraordinária" --fetch-inteiro-teor --output-dir ./resultados/stj
./bin/jur stj -q "usucapião extraordinária" --verificar 5 --json
```

## Flags específicas

| Flag | Valores | Observação |
|---|---|---|
| `-n, --numero` | `REsp 1809043` · `2019/0116080-0` · nº CNJ | consulta direta; exit 1 se não encontrar |
| `--base` | `acordao` (default) `monocratica` `sumula` `informativo` `tese` | **desambiguação 1**; só as duas primeiras são extraídas |
| `-oj, --orgao` | `T1`…`T6` `S1`…`S3` `CE` `PS` `VP`, ou `terceira-turma`, vírgula | **desambiguação 2** |
| `-s, --secao` | `1\|publico` `2\|privado` `3\|penal` `corte` | atalho: a Seção **e** suas Turmas |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto: 1.697 × 1.705) |
| `--ementa` | texto | termos restritos ao campo Ementa (+ Info. Complementares + Termos Auxiliares) |
| `-r, --relator` | código do ministro | 181 ministros; código aparece no campo Relator: `(1141)` |
| `-cl, --classe` | `RESP` `ARESP` `HC` … | sigla da classe |
| `--uf` | `SP`, `RS`… | UF de **origem** do processo |
| `--nota` | chave (`--listar-notas`) ou expressão crua | 25 recortes prontos do STJ |
| `--repetitivos` | | atalho de `--nota repetitivos` |
| `--temas [tipo]` | `repetitivo` (default) `controversia` `iac` `sirdr` `puil` | **outro módulo**, headless |
| `--tema-inicial/--tema-final/--ramo` | | só com `--temas` |
| `-ord` | `recentes` (default) `antigos` `relevancia` | por data de publicação |
| `--por-pagina` | 10 (default) 25 50 | menos requisições com 50 |
| `--verificar [N]` | default 5 | reconsulta N julgados e confere o **registro** |
| `--fetch-inteiro-teor` | | ~1 MB por acórdão — use com `--max-results` |
| `--headless` | | força headless; hoje o Cloudflare **bloqueia** |

## Operadores — testados um por um

Barra "Ocultar operadores" da tela, com ajuda oficial. Termo de controle
`usucapião` × `extraordinária`, base de acórdãos, 25/07/2026:

| Sintaxe | Funciona? | Evidência |
|---|---|---|
| `a b` (E implícito) | ✅ | 427 |
| `a e b` / `AND` | ✅ | 427 |
| `a ou b` / `OR` | ✅ | 8.264 |
| `a não b` / `NOT` | ✅ | 1.929 (de 2.356 só `usucapião`) |
| `a adj b`, `a adj5 b` | ✅ | 412 |
| `a prox b`, `a prox10 b` | ✅ | 418 |
| `a mesmo b` (INSAME, mesmo **campo**) | ✅ | 427 aqui; 28.320 × 28.348 no par `dano/moral` |
| `a com b` (INPATH, mesmo **parágrafo**) | ✅ | 420 aqui; 28.241 no par `dano/moral` |
| `radical$` | ✅ | `usucapi$` 2.385 > `usucapião` 2.356 |
| `"frase exata"` | ✅ | `"dano moral"` 27.711 < 28.348 do E implícito |
| `*` (asterisco) | ❌ | derruba a consulta (ORA-01013) |

**Os oito operadores da barra funcionam de verdade** — exceção no repositório
(no TJGO e no TJRS a maioria vira palavra literal).

Cuidados: `MESMO` e `COM` têm a semântica invertida do que o nome sugere (ver
tabela). O índice é insensível a acento (`usucapião` = `usucapiao` = 2.356) —
o que **não** dispensa o encoding latin-1: em UTF-8 a busca acentuada devolve 0.
Há expansão por Tesauro (`thesaurus=JURIDICO`, ligada por padrão) e por plurais.

## Outras ressalvas

1. **A ementa do STJ é o "espelho do acórdão"** — traz ementa, tese jurídica,
   acórdão (dispositivo), notas, referência legislativa e jurisprudência citada.
   Para a maioria das análises ela basta; o `--fetch-inteiro-teor` só é
   necessário quando se quer o voto.
2. **Extração**: os campos separam linhas com `<br>` e `textContent` as cola
   (`"REsp 2031813 / SCRECURSO ESPECIAL2022/0314287-3"`). O navigator troca
   `<br>` por `\n` antes de ler; e os rótulos começam com quebra de linha, então
   é preciso `trim()` antes de partir em linhas — sem isso os campos mais
   valiosos somem em silêncio.
3. **`PS`/`VP` têm 0 acórdãos** (decidem por monocrática). Não é filtro quebrado.
4. **Sem permalink de busca útil**: a URL do `pesquisar.jsp` é colável, mas
   depende do `Referer`. O permalink citável de um julgado é o
   `processoUrl` (`processo.stj.jus.br/processo/pesquisa/?num_registro=…`).
5. **`--base sumula|informativo|tese` chegam à resposta mas não são extraídos** —
   cada base tem tela própria, sem os containers `.documento`. O crawler devolve
   `total: null` em vez de inventar resultado. Use os módulos 02/04/05 à mão.
6. **Ordenação**: só por data de publicação. O combo do site também oferece
   "Precedentes Qualificados" (`ordenacao=TEMA,-DTPB,@NUM,CLAS`), não exposto.
7. **Referência legislativa (`ref`)** não foi exposta: são 6 grupos repetíveis
   com 6 níveis de dispositivo cada. As 522 siglas de diploma estão em
   `human-codegen/STJ/01-scon-acordaos/03-siglas-legislacao.json`.
