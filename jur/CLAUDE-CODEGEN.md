# CLAUDE-CODEGEN — como mapear um tribunal novo

Este é o documento-mestre do processo. Ele responde: **dado um tribunal brasileiro qualquer,
como saímos do zero até uma busca de jurisprudência funcionando por CLI, testada e verificável?**

Quem executa é a skill `codegen` (`/jur-codegen <TRIBUNAL>`). Este doc é a especificação
que ela segue — leia-o antes de mapear qualquer tribunal novo.

- Estado atual de cada tribunal: [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md)
- Template de mapeamento: [`human-codegen/MODELO-TRIBUNAL.md`](human-codegen/MODELO-TRIBUNAL.md)
- Roteamento por tribunal: [`CLAUDE.md`](CLAUDE.md)

---

## 1. A ideia central

A maioria dos tribunais faz **as mesmas coisas de formas ligeiramente diferentes**. Existe um
conjunto pequeno de sistemas-base (PJe, e-Proc, ESAJ, Projudi) e, quando dois tribunais
compartilham a base, compartilham quase todo o frontend de busca. Mapear um bem barateia
todos os irmãos.

O trabalho, então, é sempre o mesmo em três camadas:

| Camada | Pergunta | Onde mora |
|---|---|---|
| **Comum** | O que todo tribunal tem? (termo, data, instância, órgão, relator, nº do processo) | `human-codegen/MODELO-TRIBUNAL.md` |
| **Família** | O que todo PJe / e-Proc / ESAJ / Projudi tem? | §4 deste doc |
| **Específico** | O que só este tribunal faz? | `human-codegen/<TRIBUNAL>/` + `CLAUDE-<TRIBUNAL>.md` |

> ⚠️ A família do sistema de **tramitação** (o que está na planilha Digesto) é uma *pista*,
> não uma garantia sobre a **jurisprudência**. O TJGO tramita em Projudi e a jurisprudência
> vive no Projudi; o TJPA tramita em PJe mas a jurisprudência é uma SPA Angular própria.
> Confirme sempre no navegador.

---

## 2. Estrutura do repositório

```
prc_jur_crawler/                     ← raiz do git / do plugin
├── .claude-plugin/marketplace.json  ← catálogo do marketplace
├── plugins/jur-tribunais/           ← o plugin empacotado
│   ├── .claude-plugin/plugin.json
│   └── skills/{browser,verificador,fixer,codegen,improve-user-prompt}/SKILL.md
└── jur/                             ← o crawler
    ├── CLAUDE.md                    ← roteamento: qual tribunal / qual doc
    ├── CLAUDE-CODEGEN.md            ← este arquivo: o processo
    ├── CLAUDE-<TRIBUNAL>.md         ← referência curta de cada tribunal (flags, ressalvas)
    ├── bin/jur                      ← a CLI (um subcomando por tribunal)
    ├── src/
    │   ├── BaseCrawler.js           ← browser, paginação, saída
    │   ├── cnj.js                   ← validação/decomposição de nº CNJ (genérico)
    │   ├── inteiroTeorFetcher.js    ← download + strip de HTML
    │   └── <TRIBUNAL>{Crawler,Navigator,Checker,Testes}.js
    ├── cobertura/                   ← o que temos e o que falta
    │   ├── CLAUDE-COBERTURA.md      ← gerado
    │   ├── tribunais.json           ← gerado, fonte da verdade legível por máquina
    │   ├── build.js                 ← o gerador (edite AQUI)
    │   └── base/                    ← insumos crus (planilha Digesto, tribunais_brasileiros)
    ├── human-codegen/               ← mapeamento humano da navegação
    │   ├── MODELO-TRIBUNAL.md       ← o template a preencher
    │   ├── _base/                   ← prompts históricos e notas de revisão
    │   └── <TRIBUNAL>/              ← um diretório por tribunal
    ├── resultados/                  ← outputs de busca (não versionar resultados grandes)
    ├── skills/                      ← skills do repo (espelhadas no plugin)
    └── tests/                       ← smoke tests recorrentes de todos os tribunais
```

### Um tribunal dentro de `human-codegen/`

```
human-codegen/TJGO/
├── INDEX.md                       ← mapa seção ↔ print (o contrato com os agentes)
├── 01-projudi/                    ← um diretório por MÓDULO de jurisprudência
│   ├── DESCRICAO.txt              ← o texto humano + HTML dos elementos
│   ├── 01-tela-inicial.png
│   ├── 02.1-combo-instancia.png
│   └── 02.2-combo-area.png
├── 02-jurisprudencia-antiga/
└── 03-jurisprudencia-administrativa/
```

---

## 3. Padrão de nomenclatura (obrigatório)

Regras, nascidas das revisões em [`human-codegen/_base/notas-revisao.md`](human-codegen/_base/notas-revisao.md):

1. **Nunca repita o nome do tribunal no arquivo.** A pasta já diz `TJGO/`. Nada de
   `TJGO-JURISPRUDENCIA_print_tela-inicial.png` — vira `01-tela-inicial.png`.
2. **Nunca repita o nome do módulo.** A subpasta já diz `01-projudi/`.
3. **Número na frente, sempre com 2 dígitos.** `01-`, `02-`, `10-`. Ordena certo em qualquer lugar.
4. **Um print de uma seção herda o número da seção.** Seção `2. Instância` → `02-instancia.png`.
   Vários prints da mesma seção usam `NN.M`: `02.1-combo-aberto.png`, `02.2-selecionado.png`.
5. **Slug em kebab-case, sem acento, sem espaço, minúsculo.** `combo-orgao-materia`, não
   `combo-órgão/matéria`.
6. **Sem marcador de tipo no nome.** Nada de `_print_`; a extensão já diz se é `.png` ou `.txt`.
7. **Uma extensão só.** `.txt.txt` e `.png.png` são bug, não estilo.
8. **Cada número existe uma vez só.** "Filtro 4" três vezes no mesmo texto é o erro mais comum.

O contrato entre a descrição e os prints é o `INDEX.md` do tribunal:

```markdown
| # | Seção | Descrição | Prints |
|---|---|---|---|
| 01 | Termo de pesquisa | `01-projudi/DESCRICAO.txt` §1 | `01-tela-inicial.png` |
| 02 | Instância | `01-projudi/DESCRICAO.txt` §2 | `02.1-combo-instancia.png` |
```

Se um filtro aparece no print mas não no texto (ou vice-versa), isso é um **defeito de
mapeamento** — anote na coluna de observação em vez de deixar implícito.

---

## 4. Famílias de sistema — o que esperar

| Sistema | Perfil da busca de jurisprudência | O que costuma valer |
|---|---|---|
| **PJe** | Portais de jurisprudência separados do PJe de tramitação; muitas vezes JSF/`.seam` ou um portal próprio (CJF para os TRFs) | Filtros ricos (relator, órgão, classe, tipo de documento); paginação por POST; sessão importa |
| **e-Proc** | Módulo `eproc-jur` / `externo_controlador.php`; GET com querystring longa | Estável, headless funciona; ementa curta em Turmas Recursais → baixar inteiro teor |
| **ESAJ** | `cjsg/consultaCompleta.do` (2º grau) e `cjpg` (1º grau) | Formulário clássico; frequentemente atrás de proteção anti-bot |
| **Projudi** | Módulo de jurisprudência dentro do próprio Projudi | POST de formulário; atenção ao **charset ISO-8859-1**; Cloudflare Turnstile pode barrar só o download |
| **Próprio / SPA** | Angular/React com API JSON por trás (`/bff/api/...`) | **Melhor caso**: fale com a API direto, sem browser |

Ao começar um tribunal, procure primeiro um irmão já mapeado na mesma família em
[`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md) e leia o `CLAUDE-<IRMAO>.md`.

### Ordem de preferência de acesso

> ⚠️ **Isto decide como o CRAWLER FINAL fala com o site. Não dispensa o browser no mapeamento.**
> O browser é **obrigatório na fase de Mapeamento** (§5, Fase 2), sempre, inclusive quando o
> crawler final vai usar `api` ou `http` puro. Sem abrir a página você não tem os prints (de que
> o `fixer` depende) nem os combos populados por AJAX — que **não aparecem no HTML estático**.

**`api-oficial` > `api` > `http` > `browser`.** Nesta ordem, sempre.

0. **`api-oficial`** — **Antes de estudar a tela, procure uma API pública documentada.** É o
   passo mais barato do processo inteiro e o mais esquecido: quem começa pelo DevTools já
   presumiu que a única porta é a do navegador. Procure, nesta ordem:
   - **Portal de dados abertos do próprio tribunal** — `dadosabertos.<tribunal>.jus.br`,
     `/dados-abertos`, `/transparencia/dados-abertos`. Muitos publicam jurisprudência em
     JSON/CSV, e alguns publicam a base inteira para download.
   - **Documentação de API** — procure `swagger`, `openapi`, `/api-docs`, `/v1/`, `/rest/`
     no portal e no Google (`site:<tribunal>.jus.br api`).
   - **DataJud (CNJ)** — API pública nacional de metadados processuais, que cobre os tribunais
     brasileiros de forma padronizada. **Não é base de jurisprudência** (não traz ementa nem
     inteiro teor), então não substitui o crawler — mas pode servir muito bem ao `Checker`,
     que só precisa confirmar que um processo **existe**. Confirme ao vivo o endpoint, a chave
     pública e a cobertura do tribunal antes de depender dela; não presuma.
   - **Base nacional do ramo**, se houver. Já aconteceu duas vezes aqui: a Justiça do Trabalho
     inteira (TST + 24 TRTs) cabe numa API só, a Falcão (`src/Falcao*.js`). Antes de mapear
     um tribunal, pergunte se o **ramo** dele já tem base unificada.

   Se achar uma API oficial, **registre a URL e a documentação no `CLAUDE-<TRIBUNAL>.md`** mesmo
   que decida não usá-la — a próxima pessoa não vai procurar de novo. Se procurar e não existir,
   **escreva que não existe**: "não procurei" e "não existe" são coisas diferentes.

   > **Vale mesmo.** Dois tribunais foram destravados exatamente aqui, ambos com mapeamento
   > anterior morto: o **TJDFT** publica um PDF de documentação de API no portal de dados
   > abertos (`api-oficial`, 3,3 mi de documentos), e o **TJMG** tinha um portal novo com API
   > aberta que a página oficial do tribunal **não linkava** — a página apontava só para o
   > portal antigo, que responde 401 + captcha. Nos dois casos, dez minutos de busca por API
   > valeram mais que todo o resto do mapeamento.
   >
   > ⚠️ **Documentação oficial não é a verdade — é o começo dela.** A do TJDFT omite cinco
   > parâmetros que a própria SPA envia, omite a sintaxe de intervalo de data (que é prosa em
   > português: `"entre 2024-01-01 e 2024-03-31"`) e mostra `hits` como número quando a API
   > devolve objeto. **Sempre confira a doc contra o que a tela manda de verdade** e escreva a
   > diferença no `CLAUDE-<TRIBUNAL>.md` — é ela que a próxima pessoa não vai adivinhar.

1. **`api`** — API interna, não documentada. Abra o DevTools na aba Network e faça uma busca.
   Se a página é uma SPA, quase sempre existe um endpoint JSON limpo
   (ex.: TJPA → `GET /bff/api/decisoes`). Use-o.
2. **`http`** — Se é formulário clássico, veja se um `POST` direto responde sem browser
   (ex.: TJGO). Cheque **charset** e cookies obrigatórios. Exporte um HAR e reproduza.
3. **`browser`** — Playwright só quando as três opções acima falharem. É o mais lento e o
   que mais quebra.

> **Por que o passo 0 vem antes de tudo.** Uma API oficial atravessa bloqueio: captcha,
> Cloudflare e verificação de navegador protegem a *tela*, não costumam proteger o endpoint
> publicado para consumo. Tribunal que parece `sem-acesso` pela porta da frente às vezes tem a
> porta dos fundos aberta e documentada. Descobrir isso depois de mapear a tela inteira é
> trabalho jogado fora.

---

## 5. O ciclo de vida de um tribunal

### Fase 1 — Descoberta

- Confirme sistema e UF em [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md).
- Ache o portal de **jurisprudência** (≠ consulta processual). Se as URLs óbvias falharem, use o
  método em [`cobertura/base/tribunais-brasileiros/method_court_discovery.md`](cobertura/base/tribunais-brasileiros/method_court_discovery.md).
- Um tribunal pode ter **vários módulos** (TJGO tem 3; TJRJ tem EJURIS + eproc). Liste todos,
  e foque no módulo principal de jurisprudência — os administrativos ficam para depois.

### Fase 2 — Mapeamento (human-codegen) — **exige browser, sem exceção**

Abra a página **no Playwright** (`headless: false` ajuda a depurar) e trabalhe a partir do DOM
vivo. `curl` no HTML estático **não serve para esta fase** — ver o aviso ao fim desta seção.

```js
// scripts/mapear.js — descartável, roda com: node scripts/mapear.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('<URL do portal>', { waitUntil: 'networkidle' }); // networkidle: espera o AJAX

  // 1. PRINT da tela
  await p.screenshot({ path: 'human-codegen/<T>/01-<modulo>/01.01-tela-inicial.png', fullPage: true });

  // 2. HTML dos elementos — o que o fixer vai comparar quando o site mudar
  console.log(await p.locator('form').first().evaluate((el) => el.outerHTML));

  // 3. COMBOS JÁ POPULADOS (o passo que curl não alcança)
  for (const sel of await p.locator('select').all()) {
    const nome = await sel.getAttribute('name');
    const opcoes = await sel.locator('option').evaluateAll((os) =>
      os.map((o) => ({ value: o.value, texto: o.textContent.trim() })));
    console.log(nome, opcoes.length, JSON.stringify(opcoes.slice(0, 5)));
    // combo grande -> salve inteiro: fs.writeFileSync(`.../${nome}.json`, JSON.stringify(opcoes, null, 2))
  }

  // 4. PRINT de cada combo/modal ABERTO — é o que documenta as opções
  await p.locator('#filtro').click();
  await p.screenshot({ path: '.../01.02-combo-filtro.png' });

  await b.close();
})();
```

Preencha [`human-codegen/MODELO-TRIBUNAL.md`](human-codegen/MODELO-TRIBUNAL.md) para cada módulo.
Para cada elemento da tela grave **os três**:

1. A **descrição humana** — para que serve o filtro, com um exemplo de uso real.
2. O **HTML do elemento** — o `<select>` inteiro com todos os `<option>`, o `<input>` com o `name`.
   Extraído do **DOM depois do AJAX**, não do HTML da primeira resposta.
3. O **print** — nomeado conforme §3. Um print por tela **e um por combo/modal aberto**.

Campos com centenas/milhares de opções (magistrado, serventia, tipo de ato) não cabem em print:
**liste via navegador e salve como JSON** ao lado da descrição.

> ⚠️ **Por que `curl` não basta, mesmo quando o crawler final vai ser `http`.**
> Combo populado por AJAX chega **vazio** no HTML estático — tipicamente só
> `<option value="-1">Todos</option>`. Quem mapeia por `curl` conclui que o filtro "não tem
> opções" e entrega o crawler sem ele, funcionando o suficiente para parecer certo.
> Foi o que aconteceria no TJRS: o combo que separa **Justiça Comum de Turmas Recursais**
> é justamente um desses. Se um `<select>` só tem "Todos", presuma AJAX e vá ao browser.

### Fase 2b — Mapeamento do PÓS-BUSCA — **skill [`browser-post-search`](skills/browser-post-search/SKILL.md)**

> A busca respondeu. **Isso é metade do trabalho.** A outra metade é o caminho que vai de
> "achei N resultados" até "tenho o texto do acórdão e um link que outra pessoa abre".

Mapeamentos deste repo já pararam na busca, e o custo apareceu depois: crawler que devolve
lista sem texto citável, ou que chama de "ementa" um trecho com o termo destacado. Rode a
skill [`browser-post-search`](skills/browser-post-search/SKILL.md) — ela cobre, com print
de cada degrau:

1. **Onde o resultado aparece** — mesma página, outra rota ou nova aba; os controles de
   busca somem ou permanecem; a URL de resultado é reutilizável.
2. **Anatomia do card** — que metadados vêm sem clicar, e se o texto exibido é **ementa,
   trecho ou nada** (meça os tamanhos; `<b>`/`<mark>` no meio = highlight, não ementa).
   **Disseque mais de um tipo de documento**: acórdão e Turma Recursal têm cards diferentes.
3. **A escada até o documento** — clicar Ementa → Inteiro teor → arquivo original, um a um,
   capturando o XHR de cada clique. Esse XHR **é o contrato** que o crawler vai reproduzir,
   e ele costuma exigir chave composta (no TJMG, `documentoId` + data de publicação exata;
   só o id devolve 500).
4. **O documento** — HTML? PDF? vem completo? exige sessão ou captcha **só ali**?
   E, antes de tudo: **o texto já veio no payload da busca?** (no TJDFT vem — um request
   por documento ali é rate limit gasto à toa).
5. **Paginação** — máximo aceito, o que acontece ao estourar, e se o total é **exato ou
   saturado** (total sempre num número redondo é teto de contador, não acervo).
6. **Permalink e identidade** — URL estável por documento, confirmada em aba limpa, e qual
   campo **identifica o documento** (o nº do processo não serve: um processo costuma ter
   vários julgados).

⚠️ **Paginação se testa duas vezes.** Ordenação sem campo de desempate faz a mesma página
devolver documentos diferentes entre requisições — repetindo uns e **pulando** outros
(visto em TJRJ, TJMG e TJDFT). No TJDFT a causa era balanceador com nós dessincronizados, e
reenviar o cookie de sessão resolveu; registre a correção, não só o sintoma.

### Fase 3 — Testes exploratórios no navegador

Antes de escrever código, rode estas buscas e registre o resultado:

1. Busca simples, sem filtro nem operador.
2. Juizados Especiais × Justiça Comum (a desambiguação precisa ficar evidente).
3. Divisão por área: Cível × Criminal.
4. Filtro de Órgão/Matéria — liste todas as opções.
5. Unidade específica (serventia/comarca).
6. Magistrado/a.
7. Tipo de ato.
8. **Número do processo** — é o que alimenta o `Checker`.
9. Filtros de data (julgamento **e** publicação — são diferentes) e operadores booleanos.

Cada operador do modelo (`E`, `OU`, `NÃO`, `ADJ`, `PROX`, `$`, `"frase exata"`) precisa ser
**testado**, não presumido: em muitos módulos eles viram palavra literal.

### Fase 4 — Código

Espelhe o padrão TJGO/TJPA — quatro arquivos, responsabilidades separadas:

| Arquivo | Papel |
|---|---|
| `<T>Crawler.js` | Comanda a busca: monta filtros, pagina, mapeia para o formato do repo |
| `<T>Navigator.js` | Fala com o site: requests, sessão, encoding, download de inteiro teor |
| `<T>Checker.js` | Consulta por nº de processo + validação CNJ + auditoria anti-alucinação |
| `<T>Testes.js` | Suíte de integração (`node src/<T>Testes.js`) |

Depois registre o subcomando em `bin/jur` e respeite as flags comuns
(`-q -m -o -v --json`) e as convenções (`-di/-df` DD/MM/YYYY, `--fetch-inteiro-teor`).

### Fase 5 — Documentação e cobertura

1. Escreva `CLAUDE-<TRIBUNAL>.md` — escopo, status, flags específicas, exemplos, **ressalvas**.
   As ressalvas são a parte mais valiosa: é onde mora o que quebra.
2. Adicione a linha na tabela de roteamento do [`CLAUDE.md`](CLAUDE.md).
3. Atualize `JURISPRUDENCIA` e `REPO` em [`cobertura/build.js`](cobertura/build.js) e rode
   `node cobertura/build.js`.
4. Adicione o tribunal ao smoke test (`node tests/smoke.js <cmd>`).

---

## 6. Bloqueios e proteções

Registre sempre, no `CLAUDE-<TRIBUNAL>.md`, as três respostas:

- Existe restrição (Cloudflare, Turnstile, captcha, verificação de navegador)?
- **A busca** funciona sem resolver?
- **O download** funciona sem resolver?

Costuma ser assimétrico — no TJGO a busca passa e só o download do arquivo original exige
Turnstile. Saber disso é a diferença entre "não dá" e "dá, com uma ressalva".

Se um tribunal bloqueia headless mas passa com `--headed`, documente isso como o modo padrão
(TRF3). Se bloqueia de vez, marque `sem-acesso` e sugira o tribunal alternativo (TJSP → TRF3).

---

## 7. Critério de aceite

Um tribunal só vira 🟢 `ok` quando **todos** valem:

**Mapeamento** (nada aqui é opcional — é o que permite consertar depois)

- [ ] Página aberta **no Playwright**, não só via `curl`
- [ ] Print de cada tela **e de cada combo/modal aberto**, nomeado conforme §3
- [ ] HTML de cada elemento gravado no `.txt`, extraído do DOM **depois do AJAX**
- [ ] Todo `<select>` que só tinha "Todos" no HTML estático foi reaberto no browser e enumerado
- [ ] Combos grandes salvos como `.json` ao lado da descrição
- [ ] `node human-codegen/index.js` rodado e o `INDEX.md` **sem pendências**
      ("seções sem print" / "seções sem descrição" zeradas)

**Pós-busca** (skill [`browser-post-search`](skills/browser-post-search/SKILL.md) —
sem isto o crawler entrega contagem, não jurisprudência)

- [ ] Print da listagem no **topo e no rodapé**, e `outerHTML` de um card gravado
- [ ] Card dissecado em **pelo menos dois tipos de documento** (acórdão × Turma Recursal…)
- [ ] Escrito se o texto do card é **ementa, trecho ou nada** — com os tamanhos medidos
- [ ] Cada botão do card clicado, com print (inclusive os que falharam)
- [ ] **Contrato do inteiro teor** registrado (método, URL, corpo, chave composta) e
      reproduzido **fora do browser**
- [ ] Formato do documento identificado (HTML/PDF/…) e respondido se **já vinha no payload
      da busca**
- [ ] Bloqueio registrado **em separado** para a busca e para o download (costuma ser
      assimétrico)
- [ ] **Permalink** por documento confirmado em aba limpa — ou declarado inexistente
- [ ] Registrado qual campo **identifica o documento** (≠ nº do processo)

**Funcionamento**

- [ ] `./bin/jur <cmd> -q "termo" -m 1 --json` retorna `success:true` com resultados
- [ ] Filtro de data restringe de fato (compare as contagens com e sem)
- [ ] Paginação anda além da página 1
- [ ] **Paginação testada DUAS vezes** e a estabilidade registrada — sem desempate na
      ordenação, a mesma página muda entre requisições, repetindo e **pulando** documentos
- [ ] `size` máximo medido e o comportamento ao estourar registrado
- [ ] Total classificado como **exato ou saturado** (número redondo fixo = teto de contador)
- [ ] `--fetch-inteiro-teor` grava arquivo com texto útil (não só cabeçalho)
- [ ] **Cada filtro de desambiguação muda o resultado de fato** — em especial
      Justiça Comum × Juizados/Turmas Recursais. Rode as duas buscas e compare as contagens:
      se der o mesmo número, o filtro **não está sendo aplicado**, ainda que a busca "funcione"
- [ ] Consulta por nº de processo (`Checker`) encontra um processo conhecido
- [ ] Auditoria (`--verificar N`) confirma a amostra contra a base

**Registro**

- [ ] `CLAUDE-<TRIBUNAL>.md` existe com flags e ressalvas
- [ ] Linha na tabela de roteamento do `CLAUDE.md`
- [ ] **Linha na tabela de roteamento de `skills/browser/SKILL.md`** — sem isso a skill de
      busca não sabe que o tribunal existe e nunca vai rotear para ele
- [ ] Entrada em `cobertura/build.js` atualizada e build rodado
- [ ] `node tests/smoke.js <cmd>` verde — **não precisa editar o smoke**: ele deriva a lista
      de `cobertura/tribunais.json` sozinho, basta o build da cobertura ter rodado
- [ ] `node sync-plugin.js` rodado se alguma skill mudou

---

## 8. Como as skills se encaixam

| Skill | Faz | Quando |
|---|---|---|
| `codegen` | Navega, tira prints, escreve `human-codegen/<T>/` e propõe o crawler | Tribunal novo |
| `browser-post-search` | Mapeia o **pós-busca**: card, escada até o documento, formato, paginação, permalink | Logo que a busca do tribunal novo retorna resultados |
| `browser` | Executa a busca: entende a intenção, refina a query, coleta e resume | Uso do dia a dia |
| `verificador` | Confirma que cada julgado citado existe na base oficial (CNJ + consulta por nº) | Antes de entregar qualquer lista |
| `fixer` | Diagnostica crawler quebrado comparando a tela atual com os prints do `human-codegen` | Quando o tribunal muda o site |

O `fixer` é a razão de os prints existirem: quando a busca quebra, ele compara a página de
hoje com o print de quando funcionava e localiza o seletor que mudou. **Print desatualizado ou
mal nomeado tira essa capacidade** — por isso o §3 é obrigatório e não cosmético.

---

## 9. Anti-racionalização

| Pensamento | Realidade |
|---|---|
| "É PJe, então é igual ao TRF1" | A jurisprudência é outro sistema. Confirme no navegador. |
| "Os operadores devem funcionar" | Teste cada um. Em muitos módulos viram texto literal. |
| "O print eu tiro depois" | Sem print o `fixer` não conserta nada. Print é entregável. |
| "Vai ser `http`, então nem abro o browser" | O modo de acesso é do crawler. O **mapeamento** é sempre no browser. |
| "Esse `<select>` só tem 'Todos'" | É AJAX. Abra no browser e enumere — foi assim que o filtro de Juizado quase se perdeu no TJRS. |
| "A busca retorna resultados, o filtro funciona" | Compare as contagens com e sem o filtro. Igual = filtro ignorado. |
| "A busca funciona, então o tribunal está mapeado" | Busca sem caminho até o documento é contagem, não jurisprudência. Rode `browser-post-search`. |
| "O card mostra a ementa" | Meça. `<b>` no meio = highlight. 20× menor que o documento = trecho. |
| "O inteiro teor precisa de outro request" | Confira o payload da busca primeiro — às vezes já vem pronto. |
| "Paginei uma vez e veio certo" | Rode duas. Sem desempate, a mesma página muda entre requisições. |
| "Deu 1.000 resultados" | 1.000 redondo é cheiro de teto de contador. Teste com termo raro. |
| "A ementa basta" | Em Turmas Recursais a ementa é uma frase. Baixe o inteiro teor. |
| "Vou usar browser, é mais fácil" | Cheque a aba Network antes. API direta é 10× mais rápida e não quebra. |
| "Tem captcha, então o tribunal é `sem-acesso`" | Captcha protege a tela, não o endpoint publicado. Procure a API oficial antes de desistir. |
| "Não vi nenhuma API oficial" | Procurou nos dados abertos, no Swagger e no DataJud? "Não procurei" ≠ "não existe" — e a diferença vai para o doc. |
| "Achei a URL, tá mapeado" | Só é 🟢 com o checklist do §7 inteiro. |
| "Esse filtro tem 4 mil opções, deixa" | Liste via navegador e salve o JSON. É rápido e é o que falta depois. |
