# FILA-TRIBUNAIS — a ordem de mapeamento, 2 alvos por dia

> **Este arquivo é a fonte da verdade da fila.** O agente roda **2× por dia (16:00 e
> 20:00 BRT)**; cada execução lê a tabela, pega **o primeiro alvo com status `pendente`**
> e trabalha **só nele**. Duas execuções por dia = dois tribunais por dia.
> Status vivo dos crawlers prontos: [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md).

## Regras de escopo — leia antes de sair navegando

<CERCA>
1. **Um alvo por execução.** O da vez é o primeiro `pendente` da tabela. Não adiante
   os outros, não "aproveite que estou aqui". Terminou ou travou → pare.
2. **Domínio permitido:** apenas o domínio oficial do alvo (`*.<tribunal>.jus.br`,
   `*.<tce>.<uf>.gov.br` etc.), mais estas fontes de apoio:
   - `dadosabertos.cnj.jus.br` / API pública do DataJud (só para o `Checker`)
   - `www.gov.br` e diários oficiais, quando o alvo publicar ato lá
3. **Domínio PROIBIDO:** JusBrasil, Jusbrasil-like, escavador, LexML, Google Cache,
   agregadores e qualquer espelho privado. Eles não são a base oficial e citar deles
   quebra a invariante nº 1 do repo. Se o portal oficial estiver fora do ar, o alvo
   vira `bloqueado` com a medição — não se substitui a fonte.
4. **Não invente URL.** A coluna "Entrada" abaixo é ponto de partida medido ou a
   instrução de descoberta. Se ela falhar, siga
   [`cobertura/base/tribunais-brasileiros/method_court_discovery.md`](cobertura/base/tribunais-brasileiros/method_court_discovery.md)
   partindo do portal oficial. Registre o que tentou.
5. **Passo 0 sempre primeiro:** procurar API pública (`dadosabertos.`, `/dados-abertos`,
   swagger/openapi, `/api/`, `/rest/`) **antes** de abrir a tela. E escreva no doc o que
   NÃO existe — "não procurei" ≠ "não existe".
6. **Timebox:** 90 min de relógio. Estourou sem crawler verde? Grave o human-codegen do
   que mapeou, marque `parcial` e pare. Meio mapeamento gravado vale mais que zero.
</CERCA>

## Como o agente atualiza esta tabela

Ao terminar, troque o `pendente` do alvo por um destes, **com data**:

| Status | Quando | Efeito na fila |
|---|---|---|
| `ok DD/MM` | crawler 🟢, checklist de aceite inteiro | sai da fila |
| `parcial DD/MM` | human-codegen gravado, crawler não fechou | **volta para o fim da fila** |
| `bloqueado DD/MM` | captcha/login/Cloudflare — com a medição no doc | sai da fila, vira linha no TODO |

Fila vazia = todos os alvos com `ok` ou `bloqueado`. Aí o agente só reporta e não faz nada.

---

## Bloco 1 — Família ESAJ (4 alvos)

O primeiro dia constrói o crawler **parametrizado por host**; os três seguintes só
plugam host + conferem as diferenças. Entradas **medidas em 31/07/2026 15:59**.

| # | Alvo | UF | Entrada (medida) | Status |
|---|---|---|---|---|
| 1 | **TJMS** | MS | `https://esaj.tjms.jus.br/cjsg/consultaCompleta.do` → **200** | ok 04/08 |
| 2 | **TJAC** | AC | `https://esaj.tjac.jus.br/cjsg/consultaCompleta.do` → **200** | ok 04/08 |
| 3 | **TJAM** | AM | `https://consultasaj.tjam.jus.br/cjsg/consultaCompleta.do` → **200** | ok 05/08 |
| 4 | **TJAL** | AL | `https://www2.tjal.jus.br/cjsg/consultaCompleta.do` → **200** | ok 05/08 |

⚠️ **Ressalvas medidas hoje, não repita o erro do TODO antigo:**
- `esaj.tjal.jus.br` **não tem DNS** — host morto. A entrada do TJAL é `www2`.
- `esaj.tjam.jus.br` é CNAME de `consultasaj.tjam.jus.br` e dá 404 na raiz; use o nome canônico.
- **Antes de aceitar o cjsg, cumpra o Passo 0**: a lição TJCE/TJMG/TJDFT é que o portal
  oficial linka o sistema velho. O cjsg cobre só o SAJ — se o tribunal tiver PJe ou
  Projudi (TJAL e TJAM têm Projudi; TJAC tem e-Proc), o cjsg **não cobre esse acervo**.
  Procure o portal unificado antes. Se não houver, registre a lacuna no `CLAUDE-<T>.md`.
- O cjsg **pode** ter reCAPTCHA v3, e quando falha devolve formulário vazio com HTTP 200,
  sem erro. Nunca leia 0 resultados como "não há jurisprudência" sem checar isso.

📌 **O que o TJMS (feito em 04/08/2026) ensinou para os três seguintes** — leia
[`CLAUDE-TJMS.md`](CLAUDE-TJMS.md) e `human-codegen/TJMS/01-cjsg/` antes de começar;
metade do trabalho já está lá. O `src/TJMS{Navigator,Crawler,Checker}.js` é o molde:

- **reCAPTCHA no cjsg não é regra, é por instalação.** O do TJMS **não tem** — sem
  `grecaptcha`, sem sitekey. Meça antes de presumir que precisa de browser.
- **O charset pode ser UTF-8**, não o ISO-8859-1 do e-SAJ clássico. Confirme no
  `Content-Type` em vez de herdar a suposição.
- **Quatro zeros silenciosos** que provavelmente se repetem: intervalo de data acima de
  365 dias corridos; `ADJ`/`PROX` (não existem); acento não normalizado na query;
  `trocaDePagina.do` sem o JSESSIONID.
- **A desambiguação Juizado × Justiça Comum** é o par de checkboxes
  `dados.origensSelecionadas` T/R, não um combo.
- **O total autoritativo** é o hidden `totalResultadoAba-<tipo>`, não o texto "de N".
- **A ementa íntegra e a citação oficial já vêm no HTML da busca**
  (`div#textAreaDados_<cdAcordao>`); o inteiro teor é PDF por
  `getArquivo.do?cdAcordao=&cdForo=`, com rate limit.

📌 **O que o TJAC (feito em 04/08/2026) acrescentou — leia
[`CLAUDE-TJAC.md`](CLAUDE-TJAC.md) junto com o do TJMS.** A lição do dia é que
**duas instalações do mesmo cjsg divergem em oito comportamentos medidos**, e
copiar as suposições do irmão produz bug silencioso. Meça cada item nos dois
tribunais que faltam:

- **Página de 20 no TJAC, 100 no TJMS.** Meça `POR_PAGINA` em vez de herdar.
- **Acento: TJMS exige, TJAC normaliza** (`usucapiao`/`usucapião` = 334 os dois).
  A ressalva mais cara do TJMS é **falsa** no TJAC. Teste um par antes de avisar.
- **O `$` zera no TJAC** (e dava 4 no TJMS). `ADJ`/`PROX` zeram nos dois.
  E o **`NÃO` acentuado não é operador no TJAC** — só `NAO`.
- **A aba `H` (Homologação) não existe no TJAC** — e enviá-la responde
  `totalResultadoAba-H = 0`, aba inexistente se passando por aba vazia.
- **A citação tem formato por instalação.** No TJAC é
  `(Relator (a): …; Comarca: …; Data de registro: …)`, sem sigla do tribunal e
  com sufixo depois do parêntese. O regex do TJMS não casa nada.
- 🔴 **O reCAPTCHA pode estar SÓ no download.** No TJAC a busca é livre e o
  `getArquivo.do` está atrás de reCAPTCHA v2 — e a sessão da busca não destrava.
  **Meça busca e download em separado**; um não prova o outro.
- 🔴 **Sem `getArquivo.do` não há permalink**, porque o popup de ementa é modal
  sem URL. Aí a verificação é só por reconsulta (`-n`).
- ⚠️ **`trocaDePagina.do` pagina a ÚLTIMA busca da sessão** — a URL não
  identifica a busca. Intercalar buscas e paginar devolve a página errada com
  HTTP 200 e cards válidos, sem sintoma nenhum.
- ⚠️ **DNS que resolve ≠ API que existe.** `dadosabertos`/`api`/`jurisprudencia`
  `.tjac.jus.br` resolvem e dão 200 servindo a home institucional (md5 idêntico
  ao do `www`). É vhost curinga. Confira o md5 antes de comemorar.
- **No Acre o Juizado é 2,8× maior que a Justiça Comum** (21.353 × 7.649),
  invertendo o padrão dos outros TJs. Não presuma qual origem domina.

⚠️ **Pendência declarada do TJAC:** os combos-árvore (classe, assunto, seção)
**não** foram enumerados — o tempo foi para a descoberta do reCAPTCHA. Existem
no formulário e o crawler não expõe flags para eles.

📌 **O que o TJAM (feito em 05/08/2026) acrescentou — leia
[`CLAUDE-TJAM.md`](CLAUDE-TJAM.md).** Só falta o **TJAL** neste bloco, e a lição
do dia é que **o crawler pode ficar verde e a base estar morta** — medir o
acervo é parte do mapeamento, não extra:

- 🔴 **MEÇA A DISTRIBUIÇÃO POR ANO ANTES DE FECHAR.** A base do TJAM **congelou
  em jan/2025** (2024 = 9.023, 2025 = 62, 2026 = **0**; último documento
  publicado em 06/10/2025). O crawler passa em todo teste feliz e mesmo assim
  não responde pedido recente. Rode a contagem ano a ano no TJAL.
- 🔴 **Cuidado com data-sentinela.** No TJAM, 481 julgados têm
  `Data do julgamento: 01/06/2004` — o **ano de 2004 inteiro é esse único dia** —
  e **37% das publicações mais recentes** estão nesse balde. Filtrar por
  julgamento apaga os recentes em silêncio; o campo confiável é publicação.
  Confira `-di/-df` contra `-dpi/-dpf` antes de escolher o default.
- **O teto de data é de CALENDÁRIO, não de 364 dias corridos.** Provado por dois
  intervalos de 366 dias com respostas opostas (`01/03/2023→29/02/2024` aceita,
  `15/06/2023→15/06/2024` recusada). A regra é `fim ≤ início + 1 ano − 1 dia`.
  O fatiador de 364 dias do TJAC funciona, mas parte ano bissexto à toa.
- **Página de 10** (TJAC 20, TJMS 100). Três instalações, três números.
- **A aba `H` existe no TJAM e é vazia; no TJAC ela nem existe.** O mesmo
  `totalResultadoAba-H = 0` significa coisas diferentes — confira o checkbox.
- **O Juizado é 7,7× a Justiça Comum** (252.381 × 32.755). O rótulo do filtro é
  "Colégios Recursais", mas o órgão que volta nos dados é `2ª Turma Recursal`.
- **O host é `consultasaj`, não `esaj`** — `esaj.tjam.jus.br` resolve para o
  mesmo IP e dá **404 com corpo vazio**. Confirma a ressalva já medida em 31/07.
- **A citação tem um TERCEIRO formato**: abre pela **classe** (`Apelação Cível
  Nº …; Relator (a): …; Comarca: Manaus/AM; …`). O regex do TJAC, ancorado em
  `\(\s*Relator`, não casa nada — e `Relator (a)` tem parêntese aninhado, então
  "pegar o último parêntese" também quebra.
- ✅ **Aqui NÃO há vhost curinga**: `dadosabertos`/`api`/`jurisprudencia` são
  **NXDOMAIN**. A armadilha do TJAC existe na família, não em toda instalação —
  meça em vez de herdar a conclusão nos dois sentidos.
- **reCAPTCHA só no download**, com **sitekey própria** (a do TJAC não serve), e
  a sessão da busca não destrava. Sem permalink, como no TJAC.

⚠️ **Pendência declarada do TJAM:** os mesmos combos-árvore do TJAC **não** foram
enumerados (o formulário não tem nenhum `<select>`; são popups do SAJ). E não foi
medido se `--sem-sinonimos` muda algo, nem se os ≥3 nós do balanceador
dessincronizam.

📌 **O que o TJAL (feito em 05/08/2026) fechou — leia
[`CLAUDE-TJAL.md`](CLAUDE-TJAL.md).** Com ele o **Bloco 1 acabou**: quatro
instalações do mesmo cjsg mapeadas, e a lição final é que **a família não
converge — quatro instalações, quatro conjuntos de comportamento**. Nada do que
está abaixo era dedutível dos três anteriores:

- 🔴 **CHECKBOX AUSENTE ≠ ABA INEXISTENTE.** A descoberta metodológica do dia. O
  formulário do TJAL tem **um único checkbox** de tipo (`A`), mas enviar
  `tipoDecisaoSelecionados=D` no POST **funciona** e devolve 43 monocráticas
  reais. Nos três tribunais anteriores bastava perguntar "o checkbox existe?";
  aqui o servidor aceita o parâmetro independentemente do que a tela oferece.
  **Teste o parâmetro, não o controle.** (E o zero da aba `H` fica **ambíguo**,
  registrado como não decidido, porque o checkbox dela também não existe.)
- 🔴 **A inversão Juizado × Comum SE DESFAZ em Alagoas.** TJAC 2,8× e TJAM 7,7×
  a favor do Juizado; **TJAL 3,3× a favor da Justiça Comum** (103.280 × 31.474).
  Quem tivesse generalizado de AC e AM erraria aqui. Meça nos dois sentidos.
- ✅ **A medição de distribuição por ano agora absolve em vez de condenar:** a
  base do TJAL está **corrente** (jul/2026 = 981 publicações; julgado mais
  recente 23/07/2026). O passo que o TJAM impôs continua obrigatório — o
  resultado é que muda.
- **O `$` não zera, DEGENERA**: `dan$` = 2, não 0. No TJAC e no TJAM zerava, o
  que dava sintoma óbvio; 2 resultados se leem como "busca específica".
- **Quarto formato de citação**: abre por `Número do Processo:` (TJAC abre por
  `Relator (a)`, TJAM pela classe). A âncora que sobrevive aos quatro é
  `Data de registro:` + caminhada por profundidade de parênteses.
- ⚠️ **O `id` vem ANTES do `type` no hidden do total** — o regex do TJAM não
  casava nada e o crawler lia zero em toda busca. Foi o primeiro bug do dia.
- ⚠️ **No Colégio Recursal o relator vem GENÉRICO** (`Juiz 1 Turma Recursal
  Unificada`): `-r` por nome de pessoa não acha nada lá. Armadilha nova.
- 🔴 **A armadilha do vhost do TJAC, em forma pior: TODO PATH INVENTADO responde
  200.** `/qualquer-coisa-inventada-9z` devolve o mesmo md5 de `/swagger` e da
  home. `api.tjal.jus.br` resolve para um **IP privado** (172.17.35.106).
  **Confira o md5 antes de comemorar um 200** — o path inventado é a prova.
- **Página de 20**, acento normalizado, sem data-sentinela (`-di/-df` confiável
  aqui), teto de data de 1 ano de calendário, reCAPTCHA só no download com
  sitekey própria, sem permalink. Ementa íntegra na busca e **a mais rica da
  família** (média 4.746 chars em acórdão).
- ✅ **Pendência do TJAM fechada:** `--sem-sinonimos` **não muda a contagem**.

⚠️ **Pendência declarada do TJAL:** os mesmos combos-árvore continuam **não
enumerados** (a página tem zero `<select>`; são popups do SAJ). E não foi medido
o comportamento da paginação em buscas muito profundas nem se os nós do
balanceador dessincronizam. **Três tribunais seguidos com a mesma pendência de
combo — vale virar tarefa própria em vez de reincidir no quarto.**

## Bloco 2 — ESAJ bloqueados, exigem descoberta (2 alvos)

| # | Alvo | UF | Entrada | Status |
|---|---|---|---|---|
| 5 | **TJBA** | BA | `esaj.tjba.jus.br` resolve (168.228.240.160) mas **conexão morre (000)**. Descobrir pelo portal `www.tjba.jus.br` (301) | ok 06/08 |
| 6 | **TJRN** | RN | `esaj.tjrn.jus.br/cjsg/` → **403**. Testar se é UA/geo; descobrir portal próprio | bloqueado 06/08 |

📌 **O que o TJBA (feito em 06/08/2026) ensinou — leia
[`CLAUDE-TJBA.md`](CLAUDE-TJBA.md).** O bloco 2 existia porque o e-SAJ estava
bloqueado, e a lição é que **o e-SAJ bloqueado não era o problema: era a pista
errada**. O TJBA tem porta melhor que a dos quatro do Bloco 1, e ela estava a um
Passo 0 de distância:

- 🔴 **O ESAJ NÃO ERA A PORTA — e persegui-lo teria queimado o dia.** O
  `esaj.tjba.jus.br` está mesmo morto (portas 80/443 aceitam TCP, mas o servidor
  **derruba o handshake TLS**: `errno=104`, "SSL handshake has read 0 bytes";
  não é UA nem geo, não chega a haver requisição HTTP). **Não importa:** o portal
  real é `jurisprudencia.tjba.jus.br`, uma SPA cujo backend é um **GraphQL
  público com introspecção aberta**, sem auth e **sem captcha em lugar nenhum**.
  O endpoint estava no bundle webpack (`t.serverUrl`), não foi chutado.
  **Para os alvos restantes do Bloco 2 e 3: o Passo 0 vale mais que a entrada
  medida da tabela.**
- 🔴 **OS OPERADORES QUE A PRÓPRIA TELA OFERECE PODEM ESTAR QUEBRADOS — e falhar
  para MAIS.** Os botões `E`, `OU` e `NÃO` do TJBA são palavra literal:
  `usucapião E posse` = **3.596.546** de 4.008.679 documentos, contra 2.171 do
  termo sozinho. Até aqui a família ESAJ ensinava operadores que **zeravam**
  (`ADJ`, `PROX`, `$`), e zero é sintoma visível. **Inflar não é** — 3,5 milhões
  se leem como "tema vastíssimo". Os que funcionam são os ingleses (`AND`=810,
  `NOT`=1.043). **Teste os operadores nos DOIS sentidos: o que zera e o que
  infla.**
- 🔴 **O espaço entre termos era OR, não AND**, provado por aritmética exata
  (2.171 + 86.140 − 810 = 87.501). Nunca presuma o conectivo implícito.
- 🔴 **A API repete cada documento, e o pior caso é o DEFAULT.** Com
  `--origem comum` o fator é **2,00** (50 devolvidos, 25 hashes distintos) e o
  `itemCount` vem inflado junto; com `turmas`/`ambas` é ~1,03. **Conte hashes
  distintos dentro de UMA página antes de confiar no total** — nenhum dos quatro
  tribunais do Bloco 1 fazia isso e ninguém teria procurado.
- 🔴 **Um filtro pode partir a base perfeitamente e mesmo assim não compor.** Sem
  termo, acórdão + monocrática = 4.008.679 = total, exato. **Com termo**,
  `apelação` dá 712.913 contra 539.050 reais, e a instância passa a ser
  **ignorada**. **Prove a composição com termo, não só a partição sozinha.**
- 🔴 **Zero silencioso por tipo de parâmetro:** `orgaos`/`classes` querem **id**,
  `relatores` quer **nome**. Passar o id do relator devolve **0 sem erro**
  (id 185 = 0 × `EMILIO SALOMAO PINTO RESEDA` = 4.435).
- ⚠️ **O campo chamado `ementa` era o INTEIRO TEOR** (idêntico a `conteudo`,
  do cabeçalho à assinatura). ✅ Ótimo — vem de graça, sem captcha, diferente de
  TJAC/TJAM/TJAL. ⚠️ Mas **não existe ementa separada**, e chamá-lo de ementa
  pelo nome do campo seria errar a natureza do texto.
- ⚠️ **A medição de distribuição por ano quase condenou o tribunal errado:**
  `usucapião` cai a **0 em 2026** enquanto a base tem **81.737** publicações no
  ano e documento de 07/08/2026. **Meça a BASE INTEIRA, não a série de um
  termo** — o passo que o TJAM impôs precisa do denominador certo.
- ✅ **Sem vhost curinga aqui** (`/path-inventado-9z` → 404), e
  ⚠️ **`api.tjba.jus.br` não é a API de jurisprudência**: é a **processual**,
  com OpenAPI legível em `/v3/api-docs` e **401 em tudo**. Não a persiga.
- **Sem teto de intervalo de data** (5 anos respondem) — o fatiador da família
  ESAJ não é necessário aqui. Só há filtro de **publicação**.

📌 **O que o TJRN (feito em 06/08/2026) ensinou — leia
[`CLAUDE-TJRN.md`](CLAUDE-TJRN.md).** Com ele o **Bloco 2 acabou**, e a lição é
que **a entrada medida da tabela pode estar errada em duas camadas de uma vez**:

- 🔴 **O 403 NÃO ERA DO `cjsg` — era do domínio inteiro**, inclusive o site
  institucional `www.tjrn.jus.br` e o `/robots.txt`. A instrução da fila ("testar
  se é UA/geo") teria gasto o dia afinando User-Agent contra uma tela que nunca
  ia carregar. **Meça o domínio antes de investigar o módulo:** um 403 na home
  institucional diz que o problema não é a aplicação.
- 🔴 **E mesmo destravado, o `cjsg` seria a porta errada.** O DataJud mostra o
  acervo do TJRN **98,0% PJe** (2.597.787) contra **2,0% SAJ** (53.288). É a
  lição do TJBA ("o e-SAJ morto não era a porta") repetida — só que desta vez
  medida **sem conseguir abrir o portal**, pelo DataJud. **Dá para saber qual é a
  porta certa antes de ter acesso a qualquer porta.**
- 🔴 **"Não é captcha" é uma conclusão que se prova, não se presume.** Access
  Denied do Akamai chega **instantâneo, sem `Set-Cookie`, sem JS, sem challenge**
  — não há o que resolver, e `--headed` não muda nada. Diferente do TJMA
  (captcha), do STJ (desafio interativo) e do CRPS (login).
- ⚠️ **O primeiro teste de bot foi MEU erro e quase virou diagnóstico.** Rodei
  Playwright headless com o UA padrão (`HeadlessChrome`, `navigator.webdriver`
  ligado) — motivo legítimo de bloqueio. Só refazendo com fingerprint de Chrome
  real é que o 403 virou evidência de ACL. **Antes de culpar o site, confira que
  o seu cliente não está se anunciando como robô.**
- ✅ **A origem do tribunal respondia para nós o tempo todo:**
  `pje.tjrn.jus.br` (IP direto, fora do Akamai) devolve 200/404 normal. Nossos
  pacotes chegam ao datacenter; quem nega é a borda. É o que separa "o tribunal
  está fora do ar" de "a borda não gosta de nós".
- ⚠️ **HIPÓTESE ABERTA, e ela muda o veredito:** se o Akamai bloqueia faixas de
  datacenter, **o portal funciona para o usuário e não para o agente** (o
  ambiente roteia por `fwmark` e tem IP da AWS-SP na `lo`). Custa 30 segundos
  fechar: abrir `www.tjrn.jus.br` no navegador do usuário. **Carregou → o TJRN
  volta para a fila**, com alvo PJe.
- ✅ **`bloqueado` não precisa ser mão vazia:** ficou `jur tjrn -n` funcionando
  por DataJud (base **corrente**, atualizada em 03/08/2026), no molde do TJMA.

⚠️ **Pendência declarada do TJRN:** nenhum filtro foi mapeado — nenhuma tela
carregou. E o smoke **não cobre** tribunal `sem-acesso` (o `tjma` se comporta
igual): `node tests/smoke.js tjrn` responde "nenhum tribunal corresponde".

## Bloco 3 — TJs sem pista (10 alvos)

Nenhum tem URL de jurisprudência na base — o campo `portal` do `tribunais.json` é
**consulta processual, não jurisprudência**. Comece pelo Passo 0, depois
`method_court_discovery.md` a partir do portal oficial `www.<tribunal>.jus.br`.

| # | Alvo | UF | Sistemas de tramitação (pista, não garantia) | Status |
|---|---|---|---|---|
| 7 | **TJPE** | PE | PJe, Projudi | ok 07/08 |
| 8 | **TJES** | ES | PJe, Projudi | ok 07/08 |
| 9 | **TJPI** | PI | PJe, Projudi | pendente |
| 10 | **TJRO** | RO | PJe, Projudi | pendente |
| 11 | **TJSE** | SE | Próprio (1ª e 2ª) — sistema caseiro, pode ter portal próprio | pendente |
| 12 | **TJTO** | TO | e-Proc, Projudi — irmão do TJRS/TJSC/TRF4 (e-Proc) | pendente |
| 13 | **TJAP** | AP | Tucujuris, PJe | pendente |
| 14 | **TJRR** | RR | PJe, Projudi | pendente |
| 15 | **TJMT** | MT | PJe, Projudi — **API já mapeada**, falta o crawler | parcial 08/08 |
| 16 | **TJPB** | PB | PJe, Projudi — **API já mapeada**, falta o crawler | parcial 08/08 |

📌 **O que o TJPE (feito em 07/08/2026) ensinou — leia
[`CLAUDE-TJPE.md`](CLAUDE-TJPE.md).** Primeiro alvo do Bloco 3 e o tribunal mais
limpo do bloco estadual: API REST pública, sem captcha em etapa nenhuma, com
ementa **e** inteiro teor de graça na busca. As lições valem para os 9 restantes:

- 🔴 **HTTP 000 NÃO É SINÔNIMO DE PORTAL FORA DO AR — e quase custou o alvo.**
  `curl` devolvia 000, igual ao e-SAJ morto do TJBA. Medindo em camadas: TCP 80
  e 443 **abrem**, o servidor manda `Server hello` + `Certificate`, e quem aborta
  é o **cliente** — o TJPE apresenta só o certificado folha e **omite o
  intermediário**; o navegador o busca sozinho pelo AIA, `curl` e Node não.
  **Separe TCP de TLS de HTTP antes de marcar `bloqueado`.** A correção é
  fornecer o intermediário, **não** desligar a verificação.
- 🔴 **OS OPERADORES SÃO O INVERSO DO TJBA.** Lá os botões em português estavam
  quebrados e os ingleses funcionavam; **aqui os portugueses funcionam** (`E`,
  `OU`, `NAO`, `NÃO` acentuado, `PROX`) **e os ingleses enganam** (`AND`=0,
  `ADJ`=0, `OR`=1, e **`NOT`=1.281 contra `NAO`=2.007** — não zera, devolve
  número plausível). E o **espaço é `E` (AND)**, não o OR do TJBA.
  **Dois tribunais seguidos, dois conjuntos opostos: não se herda nada.**
- 🔴 **O DOCUMENTO ENVENENADO — defeito novo no repo.** Um único registro faz a
  API devolver **HTTP 500 em qualquer página que o contenha** (offset 186 em
  `usucapiao`, 8/8 determinístico, vizinhas verdes). Com `size=100` isso custa
  **100 documentos**, e é raro o bastante para não aparecer em teste feliz.
  O crawler bisecta e pula só o offset ruim, **contando o que se perdeu**.
- 🔴 **TRÊS ZEROS SILENCIOSOS POR TIPO DE PARÂMETRO, todos HTTP 200:**
  `tipoSentenca.in` quer a **letra** (`A`/`D`) e o rótulo da tela
  (`ACORDAO`/`DECISAO`) devolve 0; `npuSemFormatacao.equals` quer **20 dígitos**
  e o CNJ com máscara devolve 0 — **isso mordeu o próprio mapeamento**, porque
  `cnj.normalizar()` do repo **preserva** a máscara; e o endpoint de processo
  quer chave composta `codigoProcesso`+`origem`, devolvendo `processo: null` com
  200 se receber a `chave` do documento.
- 🔴 **O PERMALINK DE BUSCA ENTREGA UM ZERO FALSO.** A URL que aparece depois de
  buscar **restaura o formulário mas não executa a busca**: em aba limpa ela
  mostra "Nenhum resultado encontrado" onde existem 6.266 julgados. É pior que
  não ter permalink — **nunca mande esse link como prova**.
- ⚠️ **"Contagem igual = filtro ignorado" pega ao vivo:** `orgaoJulgador.in` com
  `codigoUnidade` devolve outros órgãos com **total idêntico ao sem filtro**. E
  o filtro **vaza mesmo com o id certo** (id 7314, de Turma Recursal, traz 3.439
  documentos do "1º Grupo de Câmaras Cíveis"), com as partições somando 8.090
  contra 6.266. Por isso Juizado × Comum virou recorte de **cliente**.
- ⚠️ **A medição de vigência precisou de janela DIÁRIA**: a série por ano satura
  em 10.000 em **todos** os anos de 2019 a 2026. ✅ Base **corrente** (mais
  recente 01/08/2026). O passo que o TJAM impôs continua valendo — só que o
  denominador do TJBA não bastou aqui.
- ✅ **Ementa e inteiro teor são campos DISTINTOS e reais** (2,4 mil × 10,7 mil
  chars úteis) — diferente do TJBA, onde o campo "ementa" era o inteiro teor.
  ⚠️ Mas **monocrática vem sem ementa** (40/40), como no TJCE.
- ⚠️ **O texto é export do MS Word**: ~51 KB de markup para ~2,4 KB úteis, com
  **todo acento em entidade HTML**. Strip ingênuo produz "Justi a de Pernambuco".
- ✅ **Sem vhost curinga** (NXDOMAIN de verdade) — a armadilha do TJAC/TJAL não
  se repetiu, e não foi preciso conferir md5.

⚠️ **Pendências declaradas do TJPE:** 41 documentos com `tipoSentenca` fora de
`A`/`D` ficaram **não identificados** (invisíveis ao default do próprio portal);
a causa do vazamento do filtro de órgão **não foi isolada**; `classeCNJ.in` e
`assuntoCNJ.in` estão expostos como flags mas **não foram provados por
contagem**; e não se mediu se o documento ilegível é sempre o mesmo registro.

📌 **O que o TJES (feito em 07/08/2026) ensinou — leia
[`CLAUDE-TJES.md`](CLAUDE-TJES.md).** Segundo alvo do Bloco 3, e o de maior acervo do
repo inteiro: **2.212.794 documentos**, API REST pública, sem captcha em etapa nenhuma.
As lições valem para os 8 restantes:

- 🔴 **UM FILTRO QUE NÃO EXCLUI NADA PODE MUDAR A CONTAGEM — o espelho da invariante do
  repo.** A regra conhecida é "contagem igual com e sem filtro = filtro ignorado";
  aqui um filtro **no-op** derruba a contagem em 42%. `dano moral` = 106.282, e a mesma
  query com `dataIni=1900-01-01&dataFim=2100-01-01` — intervalo que não exclui um único
  documento, provado — devolve **61.480**. Na presença de filtro de data o conectivo
  implícito vira AND. **Meça o filtro NO-OP também, não só o restritivo:** foi ele que
  desfez um falso positivo (a jurisdição parecia não compor, e compunha — os dois lados
  estavam medidos já no regime AND, e somam exatamente o total desse regime).
- 🔴 **A TELA PODE MENTIR NO RÓTULO DO CAMPO.** O card do TJES exibe "Julg: 15/05/2024",
  e o único campo de data do documento é `dt_juntada = 2024-05-15` — **data de juntada
  aos autos rotulada como julgamento**, confirmado em dois documentos independentes. Nos
  três acervos do PJe **não existe** data de julgamento nem de publicação. **Case o
  rótulo da tela com o campo do payload antes de acreditar nele.** E o mesmo rótulo
  "Julg:" é data de julgamento **de verdade** nos dois acervos legados — o rótulo
  significa coisas diferentes conforme o acervo.
- 🔴 **UM PORTAL PODE TER VÁRIOS ACERVOS COM SCHEMAS DIFERENTES.** Cinco cores Solr,
  **quatro schemas**: `nr_processo` × `numero_processo_legado` × `num_processo`;
  `acordao` × `inteiro_teor` × `conteudo_decisao_html`; e **o 1º grau não tem ementa**
  enquanto as Turmas Recursais do Projudi **não têm inteiro teor**. Mapear um acervo e
  presumir os outros produz campo vazio silencioso.
- 🔴 **O DEFAULT DA API PODE SER O MENOR ACERVO.** Omitir `core` cai em `pje2g_mono`
  (96.869 docs) porque é a aba ativa da tela — quem chamar a API sem esse parâmetro mede
  558 achando que mediu 1.574. **Confira qual aba está ativa antes de aceitar o default.**
- 🔴 **TRÊS TRIBUNAIS SEGUIDOS, TRÊS CONJUNTOS DE OPERADORES.** TJBA: ingleses funcionam,
  portugueses inflam. TJPE: o inverso exato. TJES: **igual ao TJBA e oposto ao TJPE** —
  `AND`/`NOT` exatos, `E`/`OU`/`ADJ` **ignorados**, e `NAO` (52.139) e `PROX`
  (50.577) **inflando**. **Não se herda operador, nem do irmão de ontem.**
- 🔴 **CONSULTAR CNJ POR TERMO DE BUSCA TRAZ LIXO CITACIONAL.** `q=<número>` devolve 31
  documentos e `q="<número>"` devolve 2 — sendo o segundo **outro processo**, que
  apenas cita aquele número no corpo do acórdão. O parâmetro certo (`nr_processo`)
  devolve 1, e quer a **máscara** — o oposto do TJPE, que quer 20 dígitos.
- ⚠️ **SWAGGER PODE SER FALSO POSITIVO DE SPA.** `/swagger-ui.html` e `/v3/api-docs`
  respondem **HTTP 200** — com os mesmos **749 bytes** do `index.html`. É o fallback do
  roteador. **Confira o tamanho, como se confere o md5 do vhost curinga.**
- ⚠️ **503 NA RAIZ NÃO DIZ NADA SOBRE O MÓDULO.** `sistemas.tjes.jus.br/` devolve 503 e
  `/consulta-jurisprudencia/` devolve 200. Some à lição do TJPE (HTTP 000 ≠ fora do ar).
- ⚠️ **A LISTAGEM PODE SER TABELA, E O RESULTADO OCUPAR DUAS LINHAS IRMÃS**
  (`tr.result-row` + `tr.excerpt-row`). Quem mapear só a primeira perde o texto inteiro.
- ✅ **Aqui várias armadilhas da família NÃO se repetiram, e isso também se mede:** o
  filtro de jurisdição **compõe exatamente** com termo (diferente de TJPE e TJBA); a
  paginação é **estável** (3/3 idênticas, sem o problema do TJDFT/TJRJ); o total é
  **exato**, sem teto; `per_page` **não tem teto medido** (5.000 responde); não há vhost
  curinga; e a base está **corrente** (documento de 07/08/2026, o próprio dia).
- ✅ **É o ÚNICO tribunal do repo com 1º grau na base de jurisprudência** — e o 1º grau é
  o maior acervo (1.509.942 de 2.212.794). Sentença de 1º grau é um pedido que só ele
  atende. **Vale perguntar por 1º grau nos alvos restantes em vez de presumir que não há.**

📌 **O que o TJMT (08/08/2026) deixou pronto — `parcial`, leia
[`human-codegen/TJMT/01-jurisprudencia/01-busca-e-filtros.txt`](human-codegen/TJMT/01-jurisprudencia/01-busca-e-filtros.txt).**
**A API inteira está mapeada e destravada; só falta escrever o crawler.** Quem pegar o
TJMT na volta da fila começa do §1 daquele arquivo com o contrato pronto. As lições
valem para os 7 restantes do bloco:

- 🔴 **UM FILTRO DE DATA PODE ESTAR ERRADO SEM ESTAR MORTO — e o do TJMT lê
  `MM/DD/YYYY` enquanto o próprio portal envia `DD/MM/YYYY`.** Defeito novo no repo.
  A contagem **muda**, então passa em todo teste de "o filtro funciona": janela
  `05/08/2026..05/08/2026` (5 de agosto) devolve julgados de **07/05/2026**, três meses
  fora; enviando `08/05/2026` (MM/DD) volta 04/08, no alvo. E quando o dia passa de 12 o
  parse falha e o limite é **descartado em silêncio**: `13/08/2026..13/08/2026` devolve
  **1.543.137 = a base inteira**. Corolário caro: a "distribuição por ano" do TJMT é
  falsa — todo `31/12` é inválido, então cada linha é "de tal ano em diante", não o ano.
  **Meça a data devolvida pelo documento, não só a contagem.**
- 🔴 **`tipoConsulta` é IGNORADO — a aba é recorte de cliente.** Oito valores testados,
  inclusive `XXinvalidoXX`, devolvem contagem idêntica; a resposta traz **as quatro
  coleções sempre**. **Teste um valor inventado**: é o jeito barato de flagrar parâmetro
  decorativo, e serviu também para `colegiado` e `localConsultaAcordao`.
- 🔴 **A desambiguação Juizado × Justiça Comum NÃO EXISTE aqui**, apesar de a tela
  oferecer `Colegiado: Turma Recursal`. Os dois parâmetros que prometem isso são
  ignorados e `CountRecursalEletronico` é **0 em toda busca** — inclusive `dano moral`
  (241.791 acórdãos, 0 turma). Foi o primeiro TJ do repo sem essa partição.
- 🔴 **Quinto conjunto de operadores em cinco tribunais.** `E` e `PRÓXIMO` funcionam;
  **`OU` e `NÃO` são ignorados e viram AND** (pediu união, recebeu interseção — número
  menor e plausível, sem sintoma); os ingleses `AND`/`OR`/`NOT` **transformam a query
  inteira em OR** (62 mil onde se esperava 2 mil). Espaço = AND. `PROX`/`ADJ` zeram.
- 🔴 **PAYLOAD DE 33,7 MB PARA 100 DOCUMENTOS** — cada acórdão carrega o inteiro teor
  com uma imagem base64 embutida. `quantidadePagina` acima de 100 devolve **HTTP 500**.
  ✅ Em compensação, **ementa e inteiro teor já vêm na busca**, sem captcha nenhum.
- 🔴 **Paginação instável** (padrão TJRJ/TJMG): a mesma página 2, três vezes, devolveu
  três resultados diferentes — sem campo de desempate, documento repete e some.
- ⚠️ **Não diagnostique o portal por uma execução só:** um `Loading chunk 8 failed`
  transitório fez a rota `/consulta` renderizar **página em branco**, e eu quase gravei
  "o permalink de busca está morto". No reteste os 9 chunks respondem 200 e o
  ✅ **permalink de busca funciona em aba limpa** — raro (o do TJPE dá zero falso).
- ✅ **A citação oficial vem pronta no campo `Observacao`** — nada de regex, ao contrário
  dos quatro do Bloco 1. E há **data de julgamento E de publicação, reais e distintas**
  (diferente do TJES, que só tem juntada, e do TJPE, onde as duas coincidem).
- ⚠️ **Monocrática vem sem ementa** e com **schema diferente** do acórdão (o campo
  `Documento` simplesmente **não existe** nela) — padrão TJPE/TJCE.
- ✅ **Sem captcha, sem cookie, sem sessão:** só o header `token` achado no bundle.
  O 401 do gateway Kong ("No API key found in request") é a única barreira.

⚠️ **Pendências declaradas do TJES:** os combos foram enumerados **só no `pje2g`** — o
`pje1g` tem `comarca`, que não existe no 2º grau, e não foi enumerado; `-c` e `-a`
estão expostos como flags mas **não foram provados por contagem**; a causa interna do
filtro no-op **não foi isolada**; e os combos listam as **100 opções mais frequentes**,
não todas, sem endpoint que devolva a lista completa.

📌 **O que o TJPB (08/08/2026) deixou pronto — `parcial`, leia
[`human-codegen/TJPB/01-juris-pb/01-busca-e-filtros.txt`](human-codegen/TJPB/01-juris-pb/01-busca-e-filtros.txt).**
**A API está inteira mapeada e destravada; falta o crawler** — mesmo estado do TJMT. O portal
é o **Juris-PB** (`app.tjpb.jus.br/juris-pb`), SPA Angular sobre backend Spring, com
`/juris-pb-backend/public/search` **sem auth, sem token, sem captcha**, ementa **e** inteiro
teor de graça no payload, e **2.515.026 documentos**. As lições valem para os 6 restantes:

- 🔴 **UM PARÂMETRO DE MODO PODE LIGAR UM FILTRO E DESLIGAR OUTRO — defeito novo no repo.**
  `advanced=true` faz o filtro de data funcionar (2026 = 347 contra 12.206 sem janela) **e ao
  mesmo tempo faz o `grau` ser ignorado** (12.206 nos dois graus). No modo simples é o inverso:
  `grau` particiona exato (8.997 + 3.209 = 12.206) e **toda janela de data devolve a base
  inteira**, com HTTP 200 e número plausível. **Não dá para recortar por grau e por data na
  mesma requisição** — e quem mandar data sem `advanced` acha que filtrou. **Teste cada filtro
  dentro E fora do modo**, não só isoladamente.
- 🔴 **O TESTE NO-OP DO TJES MUDOU DE PAPEL: aqui ele ABSOLVE, e sozinho não decide nada.**
  A janela 1900..2100 devolve 12.206 = o total sem filtro. Isolado, isso se lê como "filtro
  ignorado" — e é o **comportamento correto** de um intervalo que não exclui nada. O que separa
  os dois casos é **o par**: no-op = total **e** janela estreita = número pequeno. Uma medição
  só é ambígua nos dois sentidos.
- 🔴 **O VALOR INVENTADO PODE ERRAR ENQUANTO O VÁLIDO É IGNORADO.** `instancia=XXINVALIDOXX`
  devolve HTTP 400 nomeando o enum Java — o que passa a impressão de parâmetro levado a sério —
  mas `instancia=TURMAS_RECURSAIS` devolve **2.515.026, o total inteiro**. O truque do TJMT
  (testar valor inventado) **não basta**: é preciso comparar o valor **válido** com o sem
  filtro. E `grau=9` nem erra — faz **fallback silencioso para grau=2**.
- ✅ **PRIMEIRO CONJUNTO DE OPERADORES COERENTE EM SEIS TRIBUNAIS.** Português e inglês
  funcionam e a aritmética fecha exata: `OU` = 125.729 = 12.206 + 120.847 − 7.324, `NÃO` =
  4.882 = 12.206 − 7.324. Espaço = AND, parênteses e frase exata funcionam, `NÃO` acentuado
  **é** operador, e o token inventado **zera** (sintoma visível). Depois de TJBA/TJPE/TJES/TJMT
  se herdaria caos — e aqui era o caso limpo. **Continua sem herdar: medir foi o que provou.**
- ⚠️ **Acento é OBRIGATÓRIO e não normalizado** (`usucapiao` = 64, `usucapião` = 12.206) —
  padrão TJMS/TJBA, oposto de TJAC/TJAM/TJAL/TJPE.
- ✅ **É o SEGUNDO tribunal do repo com 1º grau — e o maior de todos**: 1.970.661 de 2.515.026
  (78%), contra 1.509.942 do TJES. A pergunta que o TJES mandou fazer ("tem 1º grau?")
  **rendeu na primeira tentativa**. Continue perguntando nos 6 restantes.
- ✅ Paginação **estável** (mesmos 10 ids em duas rodadas), total **exato** sem saturação,
  `size` máx. **50** com HTTP 400 honesto acima disso, base **corrente** (documento do próprio
  dia do mapeamento), e **sem vhost curinga** (NXDOMAIN de verdade).
- ⚠️ **Cloudflare com `cf-mitigated: challenge` no domínio ≠ portal inacessível.** O
  `www.tjpb.jus.br` devolve 403 ao `curl`, como o STJ — mas é **managed challenge**, que
  **auto-resolve** em Chrome real (200, sem interação), diferente do desafio interativo do STJ.
  E **a API `/public/*` está fora do challenge**: responde ao `curl` cru. **Meça o challenge
  antes de marcar bloqueado, e meça a API separado da tela.**
- 🔴 **RATE LIMIT DO CLOUDFLARE SE DISFARÇA DE RECURSO BLOQUEADO.** A partir do ~9º recurso da
  mesma página os chunks lazy do Angular levam 403 e o `import()` quebra — mas o **mesmo**
  chunk responde 200 como primeira requisição de um contexto novo. **403 em asset é cota até
  prova em contrário.** Foi o que impediu a tela de renderizar (ver ressalva abaixo).

⚠️ **Pendências declaradas do TJPB:** o **crawler não existe**; a **tela nunca renderizou**,
então **não há print útil e a Fase 3b (`browser-post-search`) não foi executada** — não há
anatomia de card, escada até o documento pela tela nem permalink confirmado; os **7 endpoints
de `/public/options/*` estão identificados mas nenhum foi chamado** (combos não enumerados);
os filtros de classe/comarca/vara/órgão/relator **não foram provados por contagem** (não se
sabe se querem id ou nome — a armadilha do TJBA); `numeroProcesso` **não foi testado**, logo o
caminho do `Checker` está por validar; e **o DataJud não foi sondado** para o TJPB.

## Bloco 4 — Módulo faltante (1 alvo)

| # | Alvo | Escopo | Status |
|---|---|---|---|
| 17 | **TJRJ / eJURIS** | O `jur tjrj` cobre só e-Proc (Justiça Comum 2º grau, ~2023+). Falta o **eJURIS**: Turmas Recursais cariocas + acervo histórico. Ler `CLAUDE-TJRJ.md` antes | pendente |

## Bloco 5 — Tribunais de Contas Estaduais (13 alvos)

Nenhum sondado ainda. Pedidos pelo usuário: PR, SC, RS, SP, RJ, MG, BA. Os demais fecham
os estados grandes. Domínio costuma ser `.gov.br`, não `.jus.br` — TCE não é Judiciário.

| # | Alvo | UF | Ressalva de escopo | Status |
|---|---|---|---|---|
| 18 | **TCE-PR** | PR | | pendente |
| 19 | **TCE-SC** | SC | | pendente |
| 20 | **TCE-RS** | RS | | pendente |
| 21 | **TCE-SP** | SP | ⚠️ **não** cobre a capital — SP capital é do **TCM-SP** | pendente |
| 22 | **TCE-RJ** | RJ | ⚠️ capital carioca é do **TCM-RJ** | pendente |
| 23 | **TCE-MG** | MG | | pendente |
| 24 | **TCE-BA** | BA | ⚠️ **todos** os municípios baianos são do **TCM-BA** | pendente |
| 25 | **TCE-PE** | PE | | pendente |
| 26 | **TCE-CE** | CE | TCM-CE extinto em 2017 — o TCE absorveu os municípios | pendente |
| 27 | **TCE-GO** | GO | ⚠️ municípios goianos são do **TCM-GO** | pendente |
| 28 | **TCDF** | DF | | pendente |
| 29 | **TCE-PA** | PA | ⚠️ municípios paraenses são do **TCM-PA** | pendente |
| 30 | **TCE-ES** | ES | | pendente |

**Armadilha do bloco 5:** onde existe TCM, buscar "contas municipais" no TCE devolve zero
que se lê como "não há julgado". Ao documentar o TCE, escreva explicitamente o que ele
**não** cobre e aponte o TCM correspondente.

---

## Fora da fila automática

| Alvo | Por que não entra | O que destrava |
|---|---|---|
| **CRPS** | 🔴 Login Gov.br na porta. Medido 31/07/2026: portal **ServiceNow**; `/jurisprudencia` headless mostra só "Entrar com gov.br" (zero inputs); `/api/now/table/*` → **401**. O 200 de 27/07 era a tela de login. **O contorno por perfil de Chrome dedicado foi tentado no mesmo dia e FALHOU**: captcha no Gov.br + recusa por navegador desconhecido | Só resta **CDP contra o Chrome pessoal já logado** (não testado) — operação assistida, nunca cron. Ver `CLAUDE-CRPS.md`. **Não re-tente o perfil dedicado** |
| **STJ** | 🔴 Desafio interativo do Cloudflare desde 27/07/2026 | O desafio cair. Reteste em `CLAUDE-STJ.md` |
| **TJSP / TJMA** | 🔴 captcha | ver docs |
| **TRF1 / TRF3** | 🟡 já têm crawler, instáveis | manutenção, não mapeamento |
| Súmulas/Enunciados CRPS | Público, mas é **PDF único** (nº 1 a 19, atualizado 23/07/2026) no gov.br — não é base pesquisável | Vira crawler só se o usuário pedir |
