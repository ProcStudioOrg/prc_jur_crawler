# CLAUDE-COBERTURA — cobertura de jurisprudência por tribunal

> **Gerado por `node cobertura/build.js`. Não editar à mão.**
> Fonte da verdade legível por máquina: [`cobertura/tribunais.json`](tribunais.json).
> Para editar: mexa em `cobertura/build.js` (constantes `JURISPRUDENCIA` e `REPO`) e rode o build.

## Placar

| | Tribunais |
|---|---|
| Catalogados | **61** |
| 🟢 Busca funcionando (`jur <cmd>`) | **13** |
| 🟡🟠🔴🔵 Instáveis / quebrados / bloqueados / mapeados | **5** |
| ⚪ Não mapeados | **43** |

Legenda de status: 🟢 `ok` funcionando · 🟡 `instavel` funciona com ressalva ·
🟠 `quebrado` crawler existe mas o site mudou/saiu do ar · 🔴 `sem-acesso` bloqueado ·
🔵 `mapeado` human-codegen pronto, falta crawler · ⚪ `nao-mapeado` nada feito ainda.

Colunas da matriz:

| Coluna | Significado |
|---|---|
| **CodeGen** | Descrição humana da navegação em `human-codegen/<TRIBUNAL>/`. `completo` = txt + prints; `texto` = só txt; `não` = ausente |
| **Shots** | Nº de prints de jurisprudência em `human-codegen/<TRIBUNAL>/` (os prints do repo `tribunais_brasileiros` são de consulta processual, não contam aqui) |
| **Tests** | Suíte de integração dedicada |
| **Skills** | Skill específica além das genéricas `browser`/`verificador`/`fixer` |
| **Working** | A busca de jurisprudência roda hoje |

## Tribunais Superiores

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **STF** | — | proprio | 🟢 ok | `jur stf` | completo | 27 | ✅ | — | ✅ |
| **STJ** | — | proprio | 🟢 ok | `jur stj` | completo | 23 | ✅ | verificador/stj | ✅ |
| **TST** | — | pje | ⚪ nao-mapeado | — | nao | — | — | — | — |

## Justiça Federal (TRFs)

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TRF1** | AC, AM, AP, BA, DF, GO, MA, MT, PA, PI, RO, RR, TO | PJe | 🟡 instavel | `jur trf1` | texto | — | — | — | — |
| **TRF2** | RJ, ES | e-Proc | 🟢 ok | `jur trf2` | completo | 21 | ✅ | verificador/trf2 | ✅ |
| **TRF3** | SP, MS | PJe | 🟡 instavel | `jur trf3` | texto | — | — | — | — |
| **TRF4** | PR, SC, RS | e-Proc | 🟢 ok | `jur trf4` | texto | — | — | improve-user-prompt | ✅ |
| **TRF5** | AL, CE, PB, PE, RN, SE | PJe, PJe JEF | 🟢 ok | `jur trf5` | texto | — | — | — | ✅ |
| **TRF6** | MG | PJe | 🟢 ok | `jur trf6` | completo | 27 | ✅ | verificador/trf6 | ✅ |

## Justiça Estadual (TJs)

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TJAC** | AC | ESAJ, e-Proc | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAL** | AL | ESAJ, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAM** | AM | ESAJ, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAP** | AP | Tucujuris, PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJBA** | BA | ESAJ, PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJCE** | CE | ESAJ, PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJDFT** | DF | PJe, Projudi | ⚪ nao-mapeado | — | nao | 11 | — | — | — |
| **TJES** | ES | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJGO** | GO | Projudi | 🟢 ok | `jur tjgo` | completo | 41 | ✅ | verificador/tjgo | ✅ |
| **TJMA** | MA | PJe, Projudi | 🔴 sem-acesso | `jur tjma` | completo | 94 | ✅ | — | — |
| **TJMG** | MG | PJe, Projudi, Próprio, Próprio - JPe Themis | ⚪ nao-mapeado | — | nao | 1 | — | — | — |
| **TJMS** | MS | ESAJ | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJMT** | MT | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJPA** | PA | PJe, Projudi, Libra | 🟢 ok | `jur tjpa` | completo | 17 | ✅ | verificador/tjpa | ✅ |
| **TJPB** | PB | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJPE** | PE | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJPI** | PI | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJPR** | PR | Projudi | 🟢 ok | `jur tjpr` | completo | 27 | ✅ | verificador/tjpr | ✅ |
| **TJRJ** | RJ | Próprio, Projudi, PJe | 🔵 mapeado | — | completo | 41 | — | — | — |
| **TJRN** | RN | ESAJ, PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJRO** | RO | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJRR** | RR | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJRS** | RS | PJe, Próprio, e-Proc | 🟢 ok | `jur tjrs` | completo | 21 | ✅ | verificador/tjrs | ✅ |
| **TJSC** | SC | ESAJ, e-Proc | 🟢 ok | `jur tjsc` | completo | 21 | ✅ | verificador/tjsc | ✅ |
| **TJSE** | SE | Próprio | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJSP** | SP | ESAJ | 🔴 sem-acesso | `jur tjsp` | completo | 31 | — | — | — |
| **TJTO** | TO | e-Proc, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |

## Justiça do Trabalho (TRTs)

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TRT1** | RJ | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT2** | SP | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT3** | MG | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT4** | RS | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT5** | BA | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT6** | PE | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT7** | CE | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT8** | PA, AP | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT9** | PR | PJe | 🟢 ok | `jur trt9` | completo | 14 | ✅ | verificador/trt9 | ✅ |
| **TRT10** | DF, TO | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT11** | AM, RR | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT12** | SC | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT13** | PB | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT14** | RO, AC | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT15** | SP | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT16** | MA | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT17** | ES | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT18** | GO | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT19** | AL | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT20** | SE | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT21** | RN | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT22** | PI | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT23** | MT | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TRT24** | MS | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |

## Controle Externo

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TCU** | — | — | 🟢 ok | `jur tcu` | texto | — | — | — | ✅ |

## Tribunais operacionais — detalhe

| Tribunal | URL de jurisprudência | Acesso | Doc | Observação |
|---|---|---|---|---|
| **STF** | `https://jurisprudencia.stf.jus.br/pages/search` | api | [`CLAUDE-STF.md`](../CLAUDE-STF.md) | SPA Angular com API de passthrough de Elasticsearch (POST /api/search/search). NÃO existe API oficial: dadosabertos.stf.jus.br é NXDOMAIN, /dadosabertos serve 404, transparencia.stf.jus.br é só painel Qlik de estatística, não há Swagger, e o STF NÃO está no DataJud (api_publica_stf → index_not_found_exception). 4 bases: acordaos 368.511 (desde 1892!), decisoes 741.676 (desde 1968), sumulas 799 = 736 simples + 63 VINCULANTES (desde 1963), informativos 11.571 (desde 1995). Instância única — não há Juizado; a desambiguação é por ÓRGÃO (Pleno 80.674 × 1ª Turma 134.877 × 2ª Turma 121.103) e por CLASSE (73 siglas: ADI/ADPF/ADC × RE/ARE/AI × HC/MS). ⚠️ TRÊS ARMADILHAS: (1) AWS WAF devolve 202+challenge sem o cookie aws-waf-token — resolvido uma vez no Playwright, vale ~4 dias, depois é HTTP puro; (2) cadeia TLS incompleta (só o cert folha) — Node falha, o navigator busca o intermediário pela extensão AIA; (3) corpo do POST ≤ 8 KB é inspecionado pelo WAF e expressão com ") OR (" leva 403 — o bloco highlight (como a SPA manda) mantém o payload acima do limiar. Os operadores em português (e/ou/não/$) são traduzidos NO CLIENTE para AND/OR/NOT/*: sem isso viram termo literal (indeniz$ = 12.423 traduzido contra 1 literal). Inteiro teor JÁ VEM no resultado da busca (campo inteiro_teor_texto). Teto: 250 docs/requisição e 10.000 por consulta. A base de jurisprudência NÃO indexa CNJ — o Checker usa classe+número (ARE 1596565) e, para CNJ, o portal (listarProcessos.asp?numeroUnico=<só dígitos>). |
| **STJ** | `https://scon.stj.jus.br/SCON/pesquisar.jsp` | browser | [`CLAUDE-STJ.md`](../CLAUDE-STJ.md) | SCON — motor BRS/Oracle Text; TODA a busca cabe na querystring de um GET, sem POST/viewState/sessão. BROWSER HEADFUL OBRIGATÓRIO: Cloudflare da CSID/STJ; curl 403, e Playwright headless foi bloqueado em 4/4 tentativas nas três variantes (headless shell, channel=chromium, channel=chrome) — trocar UA não resolve. Headful passa na 1ª/2ª e depois o mesmo contexto faz HTTP puro. API OFICIAL: existe portal de dados abertos (dadosabertos.web.stj.jus.br, CKAN API) com os espelhos dos acórdãos em JSON por órgão julgador e os precedentes qualificados em CSV — mas é dado em LOTE, sem endpoint de busca por termo; NÃO existe API REST de busca (sem Swagger/OpenAPI). O STJ ESTÁ no DataJud (api_publica_stj), usado pelo Checker quando o número vem em formato CNJ. TRÊS ARMADILHAS: (1) querystring em ISO-8859-1 — em UTF-8 termo acentuado devolve 0 em silêncio; (2) sem cabeçalho Referer o pesquisar.jsp devolve o FORMULÁRIO em vez dos resultados; (3) os campos de data visíveis (dtde1/dtpb1) são decorativos — quem filtra é o parâmetro `data` (@DTDE >= "20250101" AND ...), e sem ele a busca volta inteira. Paginação profunda quebra em ~800 documentos (ORA-01013, timeout do Oracle) — o crawler detecta e para com aviso. Sem 1º grau, sem Juizado, sem Turma Recursal: a desambiguação é por ÓRGÃO (T1..T6, S1..S3, CE, PS, VP — a soma dos 12 fecha exatamente com o total sem filtro: 28.348) e por BASE documental (acórdãos 1.697 × monocráticas 25.532 no mesmo recorte). Os 8 operadores do SCON funcionam TODOS (e/ou/não/adj/prox/mesmo/com/$) — exceção no repo. Módulo de PRECEDENTES QUALIFICADOS (temas repetitivos, controvérsias, IACs) fica em processo.stj.jus.br, FORA do Cloudflare, e roda headless (flag --temas). A base não indexa número CNJ: só recurso (REsp 1809043) ou registro (2019/0116080-0). |
| **TRF1** | `https://jurisprudencia.cjf.jus.br/trf1/index.xhtml` | browser | [`CLAUDE-TRF1.md`](../CLAUDE-TRF1.md) | Host do CJF resolve mas não responde (verificado 24/07/2026, também fora via curl) — pode ser queda temporária; reteste com tests/smoke.js |
| **TRF2** | `https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar` | http | [`CLAUDE-TRF2.md`](../CLAUDE-TRF2.md) | Módulo eproc-jur, mesma família do TRF4/TJSC — mas SEM o bloqueio F5 do TJSC: o POST responde 200 sem cookie nenhum, então é HTTP puro (~0,5s/busca). O host antigo juris.trf2.jus.br é NXDOMAIN; jurisprudencia.trf2.jus.br dá 301 para cá. ⚠️ RESSALVA CENTRAL: o ESPAÇO entre termos quebra a busca — o servidor injeta o operador em inglês como termo ("dano moral" = 46 documentos; "dano-moral" = 20.201). O crawler hifeniza a query sozinho; a álgebra fecha exato (OU = A+B−E, NÃO = A−E). Frase exata + outro termo não tem conserto. Justiça Federal comum × Juizados pelo combo Origem (#selOrigem: 1=TRF2, 2=TRU2, 3=Turmas Recursais; somam exato). Só 2º grau, base começa em 2018. #txtProcesso sozinho devolve 0 — o Checker usa o curinga * junto. Não existe API oficial: a Jurisprudência Unificada do CJF lista o TRF2 mas está VAZIA (0 documentos); o DataJud do CNJ funciona mas só tem metadados. |
| **TRF3** | `https://web.trf3.jus.br/jurisprudencia/` | browser | [`CLAUDE-TRF3.md`](../CLAUDE-TRF3.md) | Verificação de navegador falha em headless; fallback Python (DrissionPage) |
| **TRF4** | `https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php` | browser | [`CLAUDE-TRF4.md`](../CLAUDE-TRF4.md) | — |
| **TRF5** | `https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa` | browser | [`CLAUDE-TRF5.md`](../CLAUDE-TRF5.md) | — |
| **TRF6** | `https://eproc-jur.trf6.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar` | http | [`CLAUDE-TRF6.md`](../CLAUDE-TRF6.md) | Módulo eproc-jur (e-Proc 9.21.6), mesma família do TRF2/TRF4/TJSC, sem bloqueio nenhum: o POST responde 200 sem cookie, HTTP puro ~0,4s/busca. A tramitação é PJe, a jurisprudência é e-Proc — sistemas diferentes. Hosts jurisprudencia./juris./dadosabertos.trf6.jus.br são NXDOMAIN; a entrada é eproc-jur.trf6.jus.br (link "Jurisprudência" do portal). ⚠️ RESSALVA CENTRAL: a base começa em 2023 (TRF6 instalado em ago/2022, desmembrado do TRF1) — 0 documentos antes disso, e o acervo mineiro até 2022 continua no TRF1 (medido: 41 de 150 documentos da amostra do TRF1 em 2019 são de subseções .4.01.38xx de MG). A Jurisprudência Unificada do CJF NEM LISTA o TRF6 (só STF/STJ/TNU/TRF1-5/TR/TRU; /trf6/index.xhtml = 404). ⚠️ NÃO copiar a correção de query do TRF2: aqui o espaço FUNCIONA como E ("dano moral" = "dano-moral" = 2.201) e hifenizar quebraria ou/não (dano-ou-moral = 216.419 em vez de 21.366). Operadores em português (e/ou/não/prox/"..."/*) — os seis declarados pelo site funcionam; os ingleses (and/or/not) viram termo literal. Desambiguação pelo combo Origem (#selOrigem: 1=TRF6, 2=TRU6, 3=Turmas Recursais, 4=Varas Federais; somam exato: 2.201+1+1.744+0=3.946). A origem 4 (1º grau) é DECLARADA E VAZIA. Numeração MISTA .4.06. e .4.01. (processos herdados do TRF1: 9% no 2º grau, 24% nas Turmas Recursais, 44% na TRU6) — o Checker aceita as duas. Não existe API oficial; o DataJud do CNJ tem índice api_publica_trf6 (só metadados). |
| **TJGO** | `https://projudi.tjgo.jus.br/ConsultaJurisprudencia` | http | [`CLAUDE-TJGO.md`](../CLAUDE-TJGO.md) | POST direto ISO-8859-1; Turnstile só no download do original |
| **TJMA** | `https://jurisconsult.tjma.jus.br/#/sg-jurisprudence-form` | api | [`CLAUDE-TJMA.md`](../CLAUDE-TJMA.md) | BUSCA BLOQUEADA POR CAPTCHA — insuperável por ora (decisão consciente: este repo não automatiza captcha). O JurisConsult é o ÚNICO módulo de jurisprudência do TJMA (o "08-jurisprudencias" do human-codegen é a mesma tela). A API é limpa e está inteiramente mapeada (apijuris.tjma.jus.br/v1), mas TODA rota de busca exige captcha de imagem próprio + reCAPTCHA v2 invisible, ambos validados no servidor (400 captcha_not_provided / 400 incorrect_captcha / 403 invalid_captcha_g). Headless, --headed e Chrome real com UA comum: todos caem no desafio de imagens. Não há API oficial de jurisprudência (dados abertos do TJMA só publica projetos/indicadores; MNI exige credenciamento). O QUE FUNCIONA: rotas de combos abertas, e o Checker por número de processo via DataJud/CNJ (api_publica_tjma, G1+G2) — metadados, sem ementa. `./bin/jur tjma --diagnostico` diz ao vivo se o bloqueio caiu. |
| **TJPA** | `https://jurisprudencia.tjpa.jus.br/bff/api/decisoes` | api | [`CLAUDE-TJPA.md`](../CLAUDE-TJPA.md) | API JSON aberta; ementa + inteiro teor no mesmo payload |
| **TJPR** | `https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do` | http | [`CLAUDE-TJPR.md`](../CLAUDE-TJPR.md) | Struts próprio (POST em pesquisa.do), sem browser e sem bloqueio. CORPO DO POST EM ISO-8859-1 — em UTF-8 devolve 0 resultados em silêncio. Só 2º grau. Justiça Comum × Juizados pela lista de ids em idOrgaoJulgador (flag --foro): o combo do site (ambito) NÃO separa — ambito=6 "TRIBUNAL DE JUSTIÇA" contém a 6ª Turma Recursal. Toda busca vem somada com decisões da Corte IDH; use o contador "da Jurisprudência do Tribunal de Justiça". Inteiro teor já vem no HTML da ficha (div#texto<id>). PROX não funciona. |
| **TJRS** | `https://www.tjrs.jus.br/buscas/jurisprudencia/ajax.php` | http | [`CLAUDE-TJRS.md`](../CLAUDE-TJRS.md) | Solr atrás de proxy PHP (POST action=consultas_solr_ajax); sem bloqueio nem sessão; inteiro teor embutido em base64 (ISO-8859-1); só 2º grau; Justiça Comum × Turmas Recursais pelo cod_tribunal |
| **TJSC** | `https://eprocwebcon.tjsc.jus.br/consulta1g/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar` | browser | [`CLAUDE-TJSC.md`](../CLAUDE-TJSC.md) | Módulo eproc-jur, mesma família do TRF4. Browser obrigatório: host atrás de verificação de segurança F5/Shape (JS challenge) — e o UA padrão do Playwright headless é barrado, precisa de UA de Chrome comum. Justiça Comum × Turmas Recursais pelo combo Origem (#selOrigem: 1=TJSC, 3=Turmas Recursais, 4=Turmas de Uniformização, 5=Conselho da Magistratura). ATENÇÃO: o portal antigo https://busca.tjsc.jus.br/jurisprudencia/ (HTTP puro) é base histórica CONGELADA desde 08/10/2025 — 15 resultados contra 8.315 do portal novo no mesmo recorte. |
| **TJSP** | `https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do` | browser | [`CLAUDE-TJSP.md`](../CLAUDE-TJSP.md) | Bloqueio de acesso — não rodar |
| **TRT9** | `https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa` | api | [`CLAUDE-TRT9.md`](../CLAUDE-TRT9.md) | FALCÃO — base NACIONAL da JT (TST + 24 TRTs + CSJT), desenvolvida pelo próprio TRT9; API JSON sem auth, filtro tribunais=TRT9. Instância separada por `colecao` (sentencas=1º grau, acordaos=2º grau, decisoesmonocraticas, recursorevista). Ressalvas: UA de navegador obrigatório (CloudFront 403), sessionId `_`+7 alfanuméricos, teto de 200 resultados/consulta para usuário anônimo. O crawler é o mesmo para os outros 23 TRTs: src/Falcao*.js |
| **TCU** | `https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo` | browser | [`CLAUDE-TCU.md`](../CLAUDE-TCU.md) | — |

`acesso`: **browser** = Playwright · **http** = POST/GET direto sem browser · **api** = API JSON documentada.
Sempre prefira `api` > `http` > `browser` ao mapear um tribunal novo — ver `CLAUDE-CODEGEN.md`.

## Sistemas processuais — por que isso importa

Tribunais que compartilham a **mesma base** (PJe, e-Proc, ESAJ, Projudi) tendem a compartilhar o
frontend de busca. Mapear um bem barateia todos os outros. Contagem por sistema:

| Sistema | Nº | Tribunais |
|---|---|---|
| PJe | 45 | TRF1, TRF3, TRF5, TRF6, TJAP, TJBA, TJCE, TJDFT, TJES, TJMA, TJMG, TJMT, TJPA, TJPB, TJPE, TJPI, TJRJ, TJRN, TJRO, TJRR, TJRS, TRT1, TRT2, TRT3, TRT4, TRT5, TRT6, TRT7, TRT8, TRT9, TRT10, TRT11, TRT12, TRT13, TRT14, TRT15, TRT16, TRT17, TRT18, TRT19, TRT20, TRT21, TRT22, TRT23, TRT24 |
| Projudi | 20 | TJAL, TJAM, TJBA, TJCE, TJDFT, TJES, TJGO, TJMA, TJMG, TJMT, TJPA, TJPB, TJPE, TJPI, TJPR, TJRJ, TJRN, TJRO, TJRR, TJTO |
| ESAJ | 9 | TJAC, TJAL, TJAM, TJBA, TJCE, TJMS, TJRN, TJSC, TJSP |
| e-Proc | 6 | TRF2, TRF4, TJAC, TJRS, TJSC, TJTO |
| Próprio | 4 | TJMG, TJRJ, TJRS, TJSE |
| PJe JEF | 1 | TRF5 |
| Tucujuris | 1 | TJAP |
| Próprio - JPe Themis | 1 | TJMG |
| Libra | 1 | TJPA |

> ⚠️ **Ressalva importante.** Essa tabela é do sistema de *tramitação processual*.
> O portal de **jurisprudência** costuma ser um sistema à parte, e nem sempre segue a mesma base:
> o TJGO tramita em Projudi e a jurisprudência também vive no Projudi, mas o TJPA tramita em PJe
> e a jurisprudência é uma SPA Angular própria. Use isto como pista, não como garantia.

## Consulta processual (repo `tribunais_brasileiros`)

URLs de **consulta de processo por número/CPF** — não são busca de jurisprudência, mas servem
ao `verificador` (confirmar que um processo citado existe). Dados e screenshots vendorizados em
[`cobertura/base/tribunais-brasileiros/`](base/tribunais-brasileiros/); método de descoberta de URL em
[`method_court_discovery.md`](base/tribunais-brasileiros/method_court_discovery.md).

Endpoints catalogados: **98** · falhando: **5** · não testados: **6**.

| Endpoint | URL | Erro |
|---|---|---|
| TJRO_2G | `https://pje2g.tjro.jus.br/pje/login.seam` | Redirects to info page - may be integrated with 1G |
| TJRR_1G | `https://pje.tjrr.jus.br/pje/login.seam` | Connection failed - site unreachable |
| TJRR_2G | `https://pje2g.tjrr.jus.br/pje/login.seam` | Connection failed - site unreachable |
| TJTO_1G | `https://eproc1g.tjto.jus.br/` | Connection failed - uses eproc but has connectivity issues |
| TJTO_2G | `https://eproc2g.tjto.jus.br/` | Connection failed - uses eproc but has connectivity issues |

---

Próximo tribunal a mapear: rode `/jur-codegen <TRIBUNAL>` — o processo está em [`../CLAUDE-CODEGEN.md`](../CLAUDE-CODEGEN.md).
