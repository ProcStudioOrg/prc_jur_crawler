# CLAUDE-COBERTURA — cobertura de jurisprudência por tribunal

> **Gerado por `node cobertura/build.js`. Não editar à mão.**
> Fonte da verdade legível por máquina: [`cobertura/tribunais.json`](tribunais.json).
> Para editar: mexa em `cobertura/build.js` (constantes `JURISPRUDENCIA` e `REPO`) e rode o build.

## Placar

| | Tribunais |
|---|---|
| Catalogados | **61** |
| 🟢 Busca funcionando (`jur <cmd>`) | **9** |
| 🟡🟠🔴🔵 Instáveis / quebrados / bloqueados / mapeados | **6** |
| ⚪ Não mapeados | **46** |

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
| **STF** | — | proprio | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **STJ** | — | proprio | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TST** | — | pje | ⚪ nao-mapeado | — | nao | — | — | — | — |

## Justiça Federal (TRFs)

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TRF1** | AC, AM, AP, BA, DF, GO, MA, MT, PA, PI, RO, RR, TO | PJe | 🟡 instavel | `jur trf1` | texto | — | — | — | — |
| **TRF2** | RJ, ES | e-Proc | 🟠 quebrado | `jur trf2` | texto | — | — | — | — |
| **TRF3** | SP, MS | PJe | 🟡 instavel | `jur trf3` | texto | — | — | — | — |
| **TRF4** | PR, SC, RS | e-Proc | 🟢 ok | `jur trf4` | texto | — | — | improve-user-prompt | ✅ |
| **TRF5** | AL, CE, PB, PE, RN, SE | PJe, PJe JEF | 🟢 ok | `jur trf5` | texto | — | — | — | ✅ |
| **TRF6** | MG | PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |

## Justiça Estadual (TJs)

| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |
|---|---|---|---|---|---|---|---|---|---|
| **TJAC** | AC | ESAJ, e-Proc | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAL** | AL | ESAJ, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAM** | AM | ESAJ, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJAP** | AP | Tucujuris, PJe | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJBA** | BA | ESAJ, PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJCE** | CE | ESAJ, PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJDFT** | DF | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJES** | ES | PJe, Projudi | ⚪ nao-mapeado | — | nao | — | — | — | — |
| **TJGO** | GO | Projudi | 🟢 ok | `jur tjgo` | completo | 41 | ✅ | verificador/tjgo | ✅ |
| **TJMA** | MA | PJe, Projudi | 🔵 mapeado | — | completo | 84 | — | — | — |
| **TJMG** | MG | PJe, Projudi, Próprio, Próprio - JPe Themis | ⚪ nao-mapeado | — | nao | — | — | — | — |
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
| **TRF1** | `https://jurisprudencia.cjf.jus.br/trf1/index.xhtml` | browser | [`CLAUDE-TRF1.md`](../CLAUDE-TRF1.md) | Host do CJF resolve mas não responde (verificado 24/07/2026, também fora via curl) — pode ser queda temporária; reteste com tests/smoke.js |
| **TRF2** | `https://juris.trf2.jus.br/consulta.php` | browser | [`CLAUDE-TRF2.md`](../CLAUDE-TRF2.md) | juris.trf2.jus.br → NXDOMAIN. O TRF2 migrou a jurisprudência para o módulo do e-Proc: https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar (mesma família do TRF4). Crawler precisa ser reescrito a partir do TRF4Crawler. |
| **TRF3** | `https://web.trf3.jus.br/jurisprudencia/` | browser | [`CLAUDE-TRF3.md`](../CLAUDE-TRF3.md) | Verificação de navegador falha em headless; fallback Python (DrissionPage) |
| **TRF4** | `https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php` | browser | [`CLAUDE-TRF4.md`](../CLAUDE-TRF4.md) | — |
| **TRF5** | `https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa` | browser | [`CLAUDE-TRF5.md`](../CLAUDE-TRF5.md) | — |
| **TJGO** | `https://projudi.tjgo.jus.br/ConsultaJurisprudencia` | http | [`CLAUDE-TJGO.md`](../CLAUDE-TJGO.md) | POST direto ISO-8859-1; Turnstile só no download do original |
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
