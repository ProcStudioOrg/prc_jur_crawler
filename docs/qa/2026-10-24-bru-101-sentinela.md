# BRU-101 — 24/10/2026 — sentinela: STF (WAF), TJMS/TJPI/TJRJ-ejuris (filtros) e TJES (403 do H2)

Correção dos casos que a validação de 21/10 (`2026-10-21-producao-sentinela.md`) mandou para
`_pendentes`. Trabalho feito na debian2 (IP residencial, IPv4 `201.21.160.29` + IPv6), worktree
`brpl/bru-101-sentinela-stf-filtros-tjes-20261024` a partir de `origin/main` 36fb576 (1.3.0).
**O H2 não rodou nesta sessão** (NOT_RUN): a máquina daqui não é o servidor, e o único caso que
depende do IP é o TJES. Método: `jur/skills/fixer/SKILL.md` — reproduzir, comparar com
`human-codegen/`, classificar layout × bloqueio × infraestrutura, consertar só o que mudou.

## Antes e depois (debian2)

`cd jur && node tests/sentinela.js stf tjms tjpi tjrj-ejuris tjes --timeout 120`, sem `--enviar`.

- Antes (casos de `_pendentes` devolvidos sem mexer no código): **14 rodados · 7 ok · 6 falhas · 1 n/v**.
- Depois: **12 rodados · 10 ok · 0 falhas · 2 n/v** (os 2 casos do TJES saem de `casos`; ver abaixo).

| Tribunal × capacidade | Classe (diagnóstico) | Antes | Depois | Ação |
|---|---|---|---|---|
| STF periodoJulgamento | infraestrutura do portal: saiu do AWS WAF | FALHA `desconhecido: o STF não emitiu o cookie aws-waf-token` (44 s) | ok, 0 de 25 fora | token *lazy* em `STFNavigator` |
| STF periodoPublicacao | idem | FALHA idem | ok, 0 de 34 fora | idem |
| STF numero | idem | FALHA idem | n/v (`Rcl 88673` não tem forma CNJ, como TCs/CARF) | idem; caso volta a `casos` |
| TJMS magistrado | crawler: `nmAgente` texto não filtra; portal exige entidade | FALHA `filtro_ignorado:magistrado` 83 de 96 | ok, 0 de 100 fora | `-r` resolve entidades na grid do popup |
| TJPI periodoPublicacao | crawler (CLI): `-dpi/-dpf` descartados | FALHA `filtro_ignorado:periodoPublicacao` 25 de 25 | ok, 0 de 25 fora | `bin/jur` tjpi lê `-dpi/-dpf` |
| TJRJ-ejuris periodoJulgamento | limitação do portal: filtra só por ano | FALHA `filtro_ignorado:periodoJulgamento` 10 de 10 | ok, 0 de 10 fora (caso com janela do ano) | recorte de dia no cliente + aviso; caso usa 01/01–31/12/2026 |
| TJES juizados | bloqueio_ip só do H2 | ok daqui (0 de 100 fora) | fora de `casos` | catálogo `instavel`; `_pendentes` anotado |
| TJES numero | idem | ok daqui (0 de 1 fora) | fora de `casos` | idem |

PASS/FAIL por tribunal (Local = debian2; H2 = NOT_RUN): STF PASS · TJMS PASS · TJPI PASS ·
TJRJ-ejuris PASS · TJES PASS local / bloqueado no H2 em 21/10 (não reavaliado).

## Diagnósticos

### STF — o portal saiu do AWS WAF (classe: infraestrutura, não bloqueio)

- `GET https://jurisprudencia.stf.jus.br/pages/search` em Chromium headless (Playwright 1.62):
  HTTP 200 direto, `server: volt-adc`, `x-volterra-location: sp4-sao`, `x-envoy-upstream-service-time`
  (F5 Distributed Cloud). Em 45 s os únicos cookies são `_ga`/`_ga_*`; `aws-waf-token` não aparece.
- `POST /api/search/search` **sem cookie nenhum** (curl): HTTP 200 com os hits.
- Logo, não era desafio novo: o crawler exigia um cookie que o portal deixou de emitir. Nada de
  CAPTCHA a automatizar. `STFNavigator.cookieAtual()` devolve o cookie em cache ou `''`; `_post`
  manda assim e só chama `token({ forcar: true })` (Playwright) se a resposta for 202/`challenge`/405.
  Se o WAF voltar, o caminho antigo vale; se o desafio virar interativo, trata-se como STJ/TJSP.
- Evidência: `jur/human-codegen/STF/01-jurisprudencia/06-headers-2026-10-24.txt`; print/HTML em
  `/mnt/dados/pesquisas/jurcrawler-bru101/stf/`. `node src/STFTestes.js --rapido`: 21/21.

### TJMS — `nmAgente` nunca filtrou; o cjsg filtra pela entidade do popup (classe: crawler)

- Mapeamento `human-codegen/TJMS/01-cjsg/01-formulario-busca.txt` §11 dizia que `-r` preenche
  `nmAgente`. Medido: com o nome em `nmAgente` o POST devolve o acervo inteiro (sentinela: 83 de 96
  de outro relator). Capturado no Playwright: a tela resolve o nome no popup "Relatores"
  (`jsp/search/searchAgente.jsp`, casa por trecho; para "Baisch" lista 3 entidades: cód. 94 "Desª
  Elisabeth Rosa Baisch", 21585 "Elisabeth Rosa Baisch", 155-10110-20237 "Juíza …") e envia
  `agenteSelectedEntitiesList` + `contadoragente`/`contadorMaioragente` + `dados.agentes[i].*`.
  Com a entidade 94: 93 de 93 do relator (424 acórdãos sem data); 21585 sozinha: 0.
- A grid só lista linhas depois que o autocomplete (`AjaxServlet.ajax … InputSelectAutoComplete`)
  rodou na mesma JSESSIONID — sem isso responde 200 com "Quantidade de registros: 0".
- `TJMSNavigator.resolverRelatores` faz autocomplete + grid; `corpo()` monta os campos da entidade
  (índice `i` por entidade); `TJMSCrawler.resolverRelatores` aceita vários nomes por vírgula, une
  as entidades e **falha** quando o trecho não casa com nenhuma (o portal ignoraria o texto).
  CLI: `./bin/jur tjms -q "dano moral" -di 30/08/2025 -df 30/08/2026 -r "Elisabeth Rosa Baisch" -m 1`
  → 100 de 100 "Desª Elisabeth Rosa Baisch", total 190. `node src/TJMSTestes.js`: 23/23.
- Prints novos: `01.03-relator-popup-entidades.png`, `01.04-resultado-relator-entidade.png`; §11 do
  `.txt` corrigido com data; `CLAUDE-TJMS.md` ressalva 12.

### TJPI — a CLI descartava `-dpi/-dpf` (classe: crawler); o portal não mudou

- Direto no JusPI: `/jurisprudences/search?q=dano+moral&data_min=2026-08-01&data_max=2026-08-31`
  devolve só publicações de 08/2026 — o formulário segue com `data_min`/`data_max`.
- `bin/jur` (bloco `tjpi`) passava `dataInicio: opts.dataInicio` e ignorava `opts.dataPubInicio`,
  embora `CLAUDE-TJPI.md` declare `-dpi/-dpf` como a janela real e `-di/-df` como alias. O executor
  manda `-dpi/-dpf` para `periodoPublicacao`, então o filtro nunca chegava ao portal.
- Corrigido: `dataInicio: opts.dataPubInicio || opts.dataInicio`. CLI com `-dpi 01/08/2026 -dpf
  31/08/2026 -m 1`: 25 de 25 em 08/2026.

### TJRJ eJURIS — o servidor filtra só por ano (classe: limitação do portal, documentada)

- Já estava documentado (`CLAUDE-TJRJ-EJURIS.md` ressalva 4) que a janela é por ano. O crawler
  reduzia DD/MM/AAAA ao ano e avisava, mas devolvia o que o servidor mandou — resultados de
  19–21/10/2026 para um pedido de agosto. O portal lista do mais novo ao mais antigo, 10 por página.
- Agora o ano vai ao servidor e o dia é recortado **no cliente** sobre as páginas lidas, com aviso
  que diz quantos saíram, que o total do servidor é do ano e que um mês antigo exige `-m` alto:
  `-di 01/08/2026 -df 31/08/2026 -m 1` → 0 documentos (10 → 0) + avisos; `-di 01/10/2026 -df
  31/10/2026 -m 1` → 10; `-di 2026 -df 2026` → 10 sem aviso.
- O caso da sentinela passa a usar a janela do ano (`01/01/2026`–`31/12/2026`): é a capacidade que
  o portal tem de fato; a conferência de filtro continua valendo (0 de 10 fora).

### TJES — bloqueio por IP do H2 (classe: bloqueio_ip; só evidência daqui)

- Da debian2: `GET /consulta-jurisprudencia/api/search?core=pje2g&q=dano+moral` → HTTP 200,
  `total` 115.488, com e sem User-Agent/Referer, IPv4 e IPv6. `./bin/jur tjes -n
  0009613-14.2020.8.08.0012` → encontrado. Sentinela daqui: juizados 0 de 100 fora, numero ok.
- Em 21/10 o mesmo endpoint deu 403 só do H2 (168.231.91.47). Não há desafio nem cookie: lista de
  IP. Não dá para consertar daqui; registrado como evidência.
- Catálogo: `TJES` → `instavel` com nota datada em `cobertura/build.js`; resumo em
  `cobertura/capacidades.json` (exigido pelo teste para tribunal fora de `ok`); `CLAUDE-TJES.md`
  com status e reteste (`docker exec jur-jur-1 node tests/sentinela.js tjes` com os casos de volta).
  Opções em aberto: pedir liberação do IP ao TJES ou rotear o GET da API por navegador remoto
  (Kernel/Steel), como TRF3/Falcão.

## Gate

- `npm test`: 676/676. `npm run docs` e `node sync-plugin.js --check` (21 skills, sincronizado).
- Integração: `node src/STFTestes.js --rapido` 21/21 · `node src/TJMSTestes.js` 23/23 ·
  `node src/TJRJEjurisTestes.js` 17/17.
- `tests/sentinela-casos.json`: 83 casos ativos (77 + STF 3 + TJMS magistrado + TJPI
  periodoPublicacao + TJRJ-ejuris periodoJulgamento); `_pendentes` sem STF; TJES anotado com a
  evidência da debian2.

## Critério de QA do card

- [x] `cd jur && node tests/sentinela.js stf tjms tjpi tjrj-ejuris tjes --timeout 120` com os casos
  de volta em `casos`: 10 ok · 0 falhas · 2 n/v (debian2).
- [ ] `docker exec jur-jur-1 node tests/sentinela.js tjes` no H2 — NOT_RUN (depende do IP do H2).
- [x] Cada caso `ok` ou tribunal rebaixado no catálogo com nota datada e fora de `casos` (TJES).
- [x] Evidência: saída antes/depois acima; prints novos em `human-codegen/TJMS/01-cjsg/` e
  cabeçalhos em `human-codegen/STF/01-jurisprudencia/`; este QA.

## Pendente

- TJES no H2: liberação do IP ou rota por navegador remoto; depois, devolver `juizados` e `numero`
  de `_pendentes` para `casos` e voltar o catálogo para `ok`.
- Bump para 1.3.1 (`npm version patch`) e deploy no H2 — com o Bruno. Após o deploy, rodar a
  sentinela completa no H2 para confirmar STF/TJMS/TJPI/TJRJ-ejuris a partir do IP de produção.
