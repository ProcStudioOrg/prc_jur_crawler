# TJMA — Tribunal de Justiça do Maranhão

**Escopo:** MA · **Status:** 🔴 **Sem acesso — busca de jurisprudência bloqueada por captcha**
**Crawler:** `src/TJMACrawler.js` · `src/TJMANavigator.js` · `src/TJMAChecker.js` · `src/TJMATestes.js`
**Mapeamento:** `human-codegen/TJMA/` (módulos `08-jurisprudencias/` e `09-jurisconsult/`)

> **Não tente rodar `./bin/jur tjma -q "termo"`.** Ela falha, de propósito e com a razão certa.
> O que funciona é `./bin/jur tjma -n <nº do processo>` (via DataJud) e
> `./bin/jur tjma --diagnostico` (checa ao vivo se o bloqueio caiu).

---

## O resumo em cinco linhas

O TJMA tem **um único** portal de jurisprudência: o **JurisConsult**
(`https://jurisconsult.tjma.jus.br/#/sg-jurisprudence-form`). Ele é uma SPA Ionic/Angular
com uma API REST limpa por trás (`https://apijuris.tjma.jus.br/v1`) — o melhor caso do
`CLAUDE-CODEGEN.md` §4. Só que **toda rota de busca é barrada, no servidor, por dois
captchas empilhados**. Este repositório não automatiza resolução de captcha; logo, o
bloqueio é **insuperável por ora**, por escolha, e o TJMA fica `sem-acesso`.

O mapeamento, esse, está completo: o contrato inteiro da API está registrado. No dia em
que o TJMA desligar o reCAPTCHA, o crawler volta a funcionar sem reescrita.

---

## As três respostas do §6 (bloqueios)

| Pergunta | Resposta |
|---|---|
| **Existe restrição?** | **Sim, duas.** (1) Captcha de **imagem próprio** do TJMA (JPEG 150×44, 5 caracteres), de `GET /util/gera_captcha`, devolvido em `Authorization: Bearer <token> <resposta>`. (2) **Google reCAPTCHA v2 _invisible_** (site key `6LdM1m8c…`), token na querystring como `tokenG`. |
| **A BUSCA funciona sem resolver?** | **Não.** Verificado por `curl` nas 4 rotas de busca: sem nada → `400 {"error":"captcha_not_provided"}`; com captcha de imagem correto mas `tokenG` inválido → `403 {"captcha_error":"invalid_captcha_g"}`; com captcha de imagem errado → `400 {"error":"incorrect_captcha"}`. O servidor valida os dois, em cascata. |
| **O DOWNLOAD do inteiro teor funciona sem resolver?** | **Não — e o bloqueio NÃO é assimétrico.** Não existe endpoint separado de inteiro teor: o texto vem no próprio payload da busca (modal `ModalJurisprudenceInteiroTeorPage`). Busca e inteiro teor caem no mesmo portão. Há ainda um **terceiro** captcha depois: clicar num resultado abre `CaptchaFormPage` antes da capa do processo. |
| **Headless passa?** | Não. |
| **`--headed` passa?** | Não. |
| **Chrome real + UA comum passa?** (o truque que destravou o TJSC) | **Não.** Testado com `channel: 'chrome'`, perfil persistente, `locale: pt-BR`, `timezone America/Fortaleza`, `--disable-blink-features=AutomationControlled` e `navigator.webdriver` forçado a `undefined`: o reCAPTCHA abriu desafio de imagens do mesmo jeito. O TJSC tinha *verificação de navegador*; o TJMA tem *reCAPTCHA de verdade*, e reCAPTCHA reconhece o CDP. |

**Decisão registrada:** bloqueio **insuperável por ora**. Isto é uma escolha consciente do
dono do repositório (não automatizar captcha), não um mapeamento incompleto. Prints do
bloqueio: `human-codegen/TJMA/09-jurisconsult/04.01-captcha-imagem-preenchido.png` e
`04.02-recaptcha-desafio.png`.

---

## API oficial: o que foi procurado e o que foi achado

Seguindo a ordem `api-oficial > api > http > browser` do `CLAUDE-CODEGEN.md` §4.
**"Não procurei" e "não existe" são coisas diferentes** — segue o que foi de fato procurado:

| Onde | Resultado |
|---|---|
| `dadosabertos.tjma.jus.br` | ✗ não resolve (DNS) |
| `www.tjma.jus.br/dados-abertos`, `/transparencia/dados-abertos` | ✗ páginas institucionais, sem dataset |
| `www.tjma.jus.br/api/v1/portal/dados-abertos/…` | ⚠️ **existe**, mas só publica `projetos` e `indicadores` (planejamento estratégico). `…/jurisprudencia`, `…/acordaos`, `…/processos` → 404 |
| `apijuris.tjma.jus.br/{swagger,api-docs,v1/swagger.json}` | ✗ 404 |
| MNI (Modelo Nacional de Interoperabilidade) do TJMA | ⚠️ existe, mas **exige credenciamento** por ofício à Diretoria de Informática + autorização da Presidência. Não é acesso público |
| `termojuris.tjma.jus.br` | ✗ é o portal de **estatística** (metas CNJ), não jurisprudência |
| **DataJud (CNJ)** | ✓ **funciona** — ver abaixo. Mas **não tem ementa nem inteiro teor** |

**Conclusão: não existe API oficial de jurisprudência do TJMA.**

### DataJud — o que de fato funciona

```
POST https://api-publica.datajud.cnj.jus.br/api_publica_tjma/_search
Authorization: APIKey <chave pública do CNJ>
{"size":10,"query":{"match":{"numeroProcesso":"08000737620248100087"}}}
```

Confirmado ao vivo em 25/07/2026: o índice `api_publica_tjma` responde, cobre **G1 e G2**,
e traz número, tribunal, grau, órgão julgador, classe, sistema (PJe) e movimentos.

Documentação: <https://datajud-wiki.cnj.jus.br/api-publica/>.
A chave pública do CNJ pode rodar — sobrescreva com `DATAJUD_API_KEY` quando isso acontecer.

⚠️ **Limite que muda o que você pode afirmar:** o DataJud carrega **metadados apenas**.
Ele responde *"este processo existe no TJMA?"* — que é a invariante anti-alucinação deste
repositório — mas **não** prova que um *julgado* com aquela ementa e aquela tese existe.
Uma citação do TJMA pode ser confirmada **como processo**, nunca **como decisão**,
enquanto o JurisConsult estiver bloqueado. Diga isso ao citar.

---

## Comandos

```bash
# ✓ FUNCIONA — confirma que um processo existe (DataJud/CNJ)
./bin/jur tjma -n "0800073-76.2024.8.10.0087" --json

# ✓ FUNCIONA — o bloqueio ainda existe? (não usa captcha, só rotas abertas)
./bin/jur tjma --diagnostico --json

# ✗ BLOQUEADA — falha com {"success":false,"bloqueio":"captcha",...}
./bin/jur tjma -q "dano moral" -m 1 --json
```

`--diagnostico` é o comando a rodar antes de qualquer coisa. Hoje ele devolve:

```json
{"apiNoAr":true,"relatorios":7,"recaptcha":{"habilitado":true,...},"bloqueado":true,
 "resumo":"API no ar, mas o reCAPTCHA continua LIGADO: a busca segue bloqueada (esperado)."}
```

Se um dia `bloqueado` virar `false`, o TJMA abriu: revalide `mapProcesso()` contra um
payload real e atualize este documento e `cobertura/build.js`.

### Flags da busca (mapeadas, prontas, mas inalcançáveis hoje)

| Flag | Para que |
|---|---|
| `--foro comum\|turmas\|juizados` | **A desambiguação** — ver abaixo |
| `-t, --tipo acordao\|monocratica\|sentenca` | Tipo de ato |
| `--relatorio <chave>` | Escolhe o relatório direto: `acordaos`, `acordaos-tr`, `monocraticas`, `monocraticas-tr`, `sentencas`, `sentencas-je` |
| `-dpi/-dpf` | Datas de **publicação** (DD/MM/YYYY) |
| `--condicao e\|ou\|unico` | Combo "Condição" (só no relatório Acórdãos) |
| `--frase-exata` | Checkbox "Frase Exata" (**não existe** no relatório Acórdãos) |
| `--sistema todos\|themis\|pje` | Sistema de origem (só Acórdãos) |
| `-r`, `-oj`, `-c`, `--comarca`, `--vara` | Ids dos combos — listas completas nos `.json` de `human-codegen/TJMA/09-jurisconsult/` |

---

## A desambiguação: Justiça Comum × Turma Recursal × Juizado

**No TJMA a desambiguação não é um filtro dentro da busca — é a escolha do relatório**,
e cada relatório bate numa **rota diferente sobre uma base diferente**. Isso é mais forte
que um filtro: não há como "esquecer de aplicar".

| id | Relatório | Rota da API | Foro / Grau | Flag |
|---|---|---|---|---|
| 1 | Acórdãos | `/sg/jurisprudencias/processos` | Justiça Comum, 2º grau | `--foro comum -t acordao` (default) |
| 6 | Acórdãos - Turma Recursal | `/jurisprudencia/processos/pesquisa_acordaos_tr` | Turmas Recursais | `--foro turmas -t acordao` |
| 2 | Decisões Monocráticas | `/jurisprudencia/processos/pesquisa_monocraticas` | Justiça Comum, 2º grau | `--foro comum -t monocratica` |
| 5 | Decisões Monocráticas - TR | `/jurisprudencia/processos/pesquisa_monocraticas_tr` | Turmas Recursais | `--foro turmas -t monocratica` |
| 3 | Súmulas e Precedentes | `/jurisprudencia/links_pesquisa_sumulas` | — (só 3 links do portal) | — |
| 4 | Sentenças de 1º Grau | `/jurisprudencia/processos/sentencas_pg` | Justiça Comum, 1º grau | `--foro comum -t sentenca` |
| 7 | Sentenças - Juizado Especial | `/jurisprudencia/processos/sentencas_je` | Juizados Especiais, 1º grau | `--foro juizados` |

⚠️ **O `id` não é a ordem do combo.** A ordem visual é 1, 6, 2, 5, 3, 4, 7. Usar o índice
do `<select>` como id é o erro fácil aqui.

### Como isso foi provado sem poder buscar

O §7 pede provar o filtro **comparando contagens de busca**. Isso é impossível aqui — e
está registrado como **não cumprido**. O que foi possível provar, e foi provado, é que as
**bases são distintas**, porque as rotas que populam os combos são abertas:

- **Órgão julgador**: Acórdãos = **34** órgãos (câmaras/seções do TJ); Acórdãos-TR = **13**
  (só Turmas Recursais + Turma de Uniformização). **Interseção = 1** (`ÓRGÃO ESPECIAL`).
  Nenhuma Turma Recursal aparece na lista da Justiça Comum, e vice-versa.
- **Comarca**: Sentenças 1º Grau = **111** ("Fórum da Comarca de …"); Juizado Especial =
  **13** (nomes secos: `BACABAL`, `TIMON`, …). **Interseção = 0.**
- Classes: 135 / 26 / 293 / 90 · Magistrados: 312 / 261 / 371 / 241.

Esses números são reasseridos a cada execução de `node src/TJMATestes.js` — se o TJMA
mudar a estrutura, o teste quebra.

---

## Ressalvas (a parte que custa caro descobrir de novo)

1. **`08-jurisprudencias/` e `09-jurisconsult/` são o MESMO sistema.** O primeiro é só a
   navegação de entrada (item "Jurisprudências" do menu do JurisConsult) para a segunda.
   **Não existe um módulo de jurisprudência do TJMA livre de captcha.** Conferido no
   navegador: mesma URL de destino, mesmo menu, mesmo combo.
2. **Não há filtro por data de julgamento.** O JurisConsult só filtra por **data de
   publicação**, nos 6 relatórios pesquisáveis. "Período" no TJMA = período de publicação.
3. **Os filtros de data só são enviados com busca avançada ligada** (`checkForm=1`). Com
   `checkForm=0` o front manda `dtaInicio`/`dtaFim` como `null` e eles somem da querystring.
4. **Não existem operadores digitáveis.** Nada de `E`/`OU`/`NÃO`/`ADJ`/`PROX`/`$` dentro da
   caixa. Há um combo **"Condição"** (E / OU / Termo único) e, nos outros relatórios, um
   checkbox **"Frase Exata"** — que **não existe** no relatório Acórdãos. `NÃO`, `ADJ`,
   `PROX` e `$` **não existem em lugar nenhum**. Nenhum deles pôde ser testado por
   contagem: a busca é barrada.
5. **Só os relatórios 1 e 6 têm busca por "Ementa".** Em Decisões Monocráticas a busca
   textual é sobre a decisão (`tipoPesquisa=8`); em Sentenças, sobre a sentença (`=11`).
6. **O nome da chave de id MUDA entre rotas.** `pkmatricula` × `matricula_id`,
   `pkcamara` × `camara_id`, `id_classe` × `classe_id`. Quem trata todos os relatórios
   igual manda o parâmetro errado e recebe silenciosamente a base inteira. O mapa correto
   está em `TJMANavigator.RELATORIOS[x].chaves` e é testado.
7. **Não há campo de total.** O total de resultados vem dentro do **primeiro registro**,
   em `response.processos[0].int_count`.
8. **A paginação é por faixa**, não por página: `inicioPagina`/`fimPagina` (1-based,
   inclusivos), 20 por página no desktop.
9. **O mapa de campos do resultado (`mapProcesso`) é inferência de código, não observação.**
   Os nomes (`pkProtocolo`, `txEmenta`, `int_count`, `NUMCOL`) vieram do bundle da SPA;
   nenhum payload real de resultados foi observado. Se a busca abrir, conferir esse mapa
   contra a resposta de verdade é o **primeiro** passo.
10. **Existe login** (`#/login`) com credenciais do sistema **SENTINELA**, e o usuário
    logado pula os dois captchas. É acesso interno do TJMA, indisponível para consulta
    pública — não é uma saída.
11. **`gera_captcha` devolve a imagem como hex de um base64 de JPEG** (não hex do JPEG).
    `TJMANavigator.gerarCaptcha()` já desfaz isso e entrega o base64 pronto — para que uma
    **pessoa** leia, se algum dia se quiser um modo interativo.

---

## Alternativas para quem precisa de jurisprudência do MA

Não há boa alternativa estadual: **nenhum TJ vizinho cobre jurisprudência do Maranhão**.

- **Matéria federal com origem no MA** → **`trf1`** (o MA é da 1ª Região) — `CLAUDE-TRF1.md`.
  ⚠️ o TRF1 depende do CJF, que estava fora do ar em 24/07/2026; confira antes.
- **Matéria trabalhista no MA** → o TRT da 16ª Região está na base nacional **Falcão**
  (`src/Falcao*.js`), a mesma do `trt9`. Não há subcomando `trt16` ainda, mas a camada de
  família já existe e o filtro é `tribunais=TRT16` — leia `CLAUDE-TRT9.md`.
- **Confirmar que um processo do TJMA existe** → `./bin/jur tjma -n <número>` (DataJud).
- **Precedentes qualificados do TJMA** (IRDR, IAC, Súmulas) → são links públicos do portal,
  fora do captcha, listados por `TJMANavigator.linksPesquisaSumulas()`.

---

## Testes

```bash
node src/TJMATestes.js            # suíte completa (17 testes, ~3 min: o DataJud é lento)
node src/TJMATestes.js --rapido   # só as rotas abertas do JurisConsult
```

A suíte **não** prova que a busca funciona — ela não funciona. Prova três outras coisas:

1. que as rotas abertas do JurisConsult continuam de pé e com a mesma forma (é o que o
   `jur-fixer` compara);
2. que **o bloqueio continua existindo** e é reportado com o erro certo — se esse teste
   um dia falhar, é **boa notícia**: o TJMA abriu;
3. que o Checker (DataJud) confirma processos reais do TJMA e rejeita números falsos.

O TJMA **não** entra no `npm run smoke`: o smoke deriva a lista de `cobertura/tribunais.json`
e só roda os 🟢.
