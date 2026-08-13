# FILA-TRIBUNAIS — a ordem de mapeamento, 2 alvos por dia

> **Este arquivo é a fonte da verdade da fila.** O agente roda **2× por dia (16:00 e
> 20:00 BRT)**; cada execução lê a tabela, pega **o primeiro alvo com status `pendente`**
> e trabalha **só nele**. Duas execuções por dia = dois tribunais por dia.
> Status vivo dos crawlers prontos: [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md).

## Regras de escopo — leia antes de sair navegando

<CERCA>
1. **Um alvo por execução.** O da vez é o primeiro `pendente` da tabela — **exceto**
   no slot das 20:00 quando houver ≥ 3 `parcial`: aí o alvo é o `parcial` mais
   antigo (regra da dívida de crawler, abaixo). Não adiante os outros, não
   "aproveite que estou aqui". Terminou ou travou → pare.
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

### Regra da dívida de crawler

`parcial` significa **mapeado, sem crawler**. Como ele volta para o fim da fila,
atrás de dezenas de `pendente`, na prática nunca mais era chamado — o repo passou a
acumular mapeamento que não vira crawler (3 tribunais seguidos em 08/2026: TJMT,
TJPB, TJRO).

Por isso o **slot das 20:00 é o slot da dívida**: havendo **≥ 3 `parcial`**, ele
ignora os `pendente` e pega o **`parcial` mais antigo**, retomando do human-codegen
já gravado até o crawler ficar 🟢. O slot das 16:00 segue abrindo tribunal novo.
Abaixo de 3 `parcial`, os dois slots voltam a pegar `pendente`.

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
| 9 | **TJPI** | PI | PJe, Projudi | ok 09/08 |
| 10 | **TJSE** | SE | ⚠️ a pista estava errada: é **eproc**, não "Próprio" — e a jurisprudência é uma app JSF à parte | bloqueado 10/08 |
| 11 | **TJTO** | TO | ⚠️ a pista de "irmão do e-Proc" **não serviu**: a jurisprudência é portal próprio PHP+Solr | ok 11/08 |
| 12 | **TJRR** | RR | ⚠️ a pista estava errada: o DataJud mostra o acervo **99,96% Eproc**, não PJe/Projudi — e a jurisprudência é uma app JSF à parte | ok 12/08 |
| 13 | **TJMT** | MT | PJe, Projudi | ok 10/08 |
| 14 | **TJPB** | PB | PJe, Projudi — **API já mapeada**, falta o crawler | parcial 08/08 |
| 15 | **TJRO** | RO | PJe, Projudi — **API mapeada + Navigator escrito**, falta o crawler | parcial 09/08 |
| 16 | **TJAP** | AP | ⚠️ a jurisprudência mora **dentro** do Tucujuris e está atrás de **Turnstile**; a porta aberta é o **Banco de Sentenças** (host à parte, 1º grau, sem captcha) — falta o crawler | parcial 11/08 |

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

📌 **O que o TJPI (feito em 09/08/2026) ensinou — leia
[`CLAUDE-TJPI.md`](CLAUDE-TJPI.md).** Terceiro alvo do Bloco 3 e o primeiro portal
**Rails renderizado no servidor** do repo — não SPA, não API, e mesmo assim o mais
generoso do bloco: **permalink público**, **citação oficial pronta** e **ementa
íntegra já no HTML da busca**, sem captcha em etapa nenhuma. As lições valem para
os 5 restantes:

- 🔴 **UM ZERO PODE SER UM HTTP 500 DISFARÇADO — e eu caí nisso por seis horas.**
  O helper de contagem que usei o dia inteiro lia só o **corpo** da resposta, e
  página de erro sem card se lê **exatamente** como "nenhum resultado". Registrei
  três variantes de busca por número como "devolve 0"; eram **HTTP 500**, e só
  apareceram quando a suíte passou a usar o `Navigator`, que confere o status.
  **CONFIRA O STATUS ANTES DE CHAMAR UM ZERO DE ZERO** — some isto à invariante
  do repo ("zero quase nunca é ausência de jurisprudência"): às vezes o zero nem
  é zero. O erro custou uma ressalva errada gravada em quatro arquivos.
- 🔴 **O CAMPO DE BUSCA PODE PROMETER O QUE NÃO ENTREGA.** O placeholder diz
  "Pesquisa por (…) **Processos**, etc" e o número **não funciona sozinho**: o
  CNJ mascarado **derruba a busca com 500** (a pontuação sozinha quebra o parser)
  e o sem máscara devolve **0 calado**. ✅ Mas o número **está indexado**:
  `<CNJ> e de` acha o documento certo. **O contorno é pendurar um termo de
  altíssima frequência e deixar o AND implícito trabalhar** — vale testar isso
  no próximo tribunal cuja consulta por número "não existir".
- 🔴 **UM TIPO DE DOCUMENTO INTEIRO PODE NÃO TER PERMALINK.** Acórdão e decisão
  terminativa abrem em `/jurisprudences/<id>/public`; **as súmulas dão HTTP 500,
  5 de 5**. Não é o documento envenenado avulso do TJPE — é a categoria toda.
  Quem dissecasse só o acórdão gravaria "o TJPI tem permalink" e erraria num
  terço dos tipos. **Disseque os TRÊS tipos, não dois.**
- 🔴 **`nao` SEM ACENTO NÃO É OPERADOR AQUI — o OPOSTO exato do Bloco 1.** Em
  TJAC/TJAM/TJAL o `NAO` é que funciona e o acentuado não; no TJPI é ao
  contrário, e o erro **infla** (282 contra 279 da exclusão correta), sem
  sintoma. ✅ Como *termo*, `nao` e `não` são o mesmo token — **o acento importa
  para o parser de operador, não para o índice**. Distinção nova no repo.
  Sétimo tribunal do bloco, sétimo conjunto de operadores: continua sem herdar.
- 🔴 **UMA PONTA SÓ DO FILTRO DE DATA É IGNORADA EM SILÊNCIO** — `-dpi` sozinho
  devolve o acervo inteiro (585 = sem filtro) com HTTP 200. **Teste cada filtro
  meio aplicado, não só aplicado e ausente.**
- ✅ **A DOCUMENTAÇÃO DO PRÓPRIO PORTAL PODE ESTAR ERRADA.** O JusPI publica uma
  página de conectivos (`/jurisprudences/conectives`) — útil e, num ponto,
  falsa: afirma que o `OU` exige parênteses, e sem eles dá o mesmo número.
  **Leia a documentação do portal e meça mesmo assim.**
- ⚠️ **OS FILTROS PODEM NÃO EXISTIR NA HOME.** A tela inicial tem só o campo de
  texto; os quatro combos e as duas datas **só aparecem na página de resultado**.
  Quem raspar a home conclui que o portal não filtra nada.
- ⚠️ **UM CAMPO CHAMADO "Órgão Julgador" PODE CONTER UMA PESSOA** (o
  desembargador); quem é órgão é o "Órgão Julgador Colegiado". Some à lição do
  TJES sobre rótulo que mente.
- ✅ **BASE CORRENTE, MAS COM DEFASAGEM VISÍVEL NA PONTA**: mai/2026 = 10.980,
  jun = 6.580, jul = 3.782, ago = 26. O passo do TJAM continua obrigatório, e
  aqui ele produziu um terceiro resultado — nem "congelada" (TJAM) nem "corrente"
  (TJAL/TJES): **corrente com atraso de indexação**, que pede aviso próprio.
- ✅ **É o PRIMEIRO tribunal do repo com SÚMULAS do próprio TJ pesquisáveis**
  (39) e o **segundo sem partição Juizado × Justiça Comum**, depois do TJMT —
  ausência medida no combo de 27 órgãos, não presumida.
- ✅ Total **exato** com a aritmética da última página fechando nos dois testes,
  **sem teto de offset** (página 15.881 responde), paginação **estável** 3/3, e
  **sem vhost curinga**. ⚠️ Página de **25 fixos**: `per_page`/`per`/`limit` são
  ignorados em silêncio.
- ⚠️ **DOIS FALSOS CAMINHOS DE API NUM PORTAL RAILS**: `search.json` → **406**
  (não existe respondedor JSON) e `/jurisprudences.json` → **401** (índice real,
  atrás de login). Nenhum é bloqueio a vencer; o certo era o HTML mesmo.

⚠️ **Pendências declaradas do TJPI:** o **DataJud não foi sondado** (não foi
preciso, mas fica como não medido); `assunto` aparece no card e nos Detalhes mas
**não é filtrável**; a **queda de 2025** (37.713 contra 99.400 de 2024) não foi
explicada; a defasagem dos meses recentes **não foi quantificada** contra o
volume real de publicação; e `-r` (relator) foi provado por contagem **num nome só**.

📌 **O que o TJSE (10/08/2026) ensinou — `bloqueado`, leia
[`CLAUDE-TJSE.md`](CLAUDE-TJSE.md).** Quarto alvo do Bloco 3 e o primeiro
**JSF/PrimeFaces** do repo. O formulário inteiro, os 4 combos e o contrato de POST
estão mapeados; o que não roda é a busca, por **captcha**. As lições valem para os
4 restantes:

- 🔴 **`grep turnstile` NÃO É TESTE DE CAPTCHA — e por um minuto pareceu porta
  aberta.** O módulo administrativo do TJSE **não contém a palavra `turnstile`**,
  o que se lê como "sem captcha"; ele usa o widget `Captcha` do PrimeFaces, isto
  é, **reCAPTCHA**, com sitekey própria, e responde **"Preencha o Captcha."**.
  Dois módulos do mesmo tribunal, **dois fornecedores de captcha diferentes**.
  **O que prova é mandar o POST e ler a mensagem**, não procurar a string no HTML.
- 🔴 **UM WIDGET QUE RODA E DECIDE NÃO EMITIR TOKEN é um terceiro tipo de
  bloqueio.** O Turnstile (sitekey `0x4AAAAAABm4wVSbc9uzC01E`) carrega, troca
  requisições com o `challenge-platform` e cria o `cf-turnstile-response` — e
  fica vazio em 60 s, em Chromium headless, em Chromium antidetecção **e em
  Google Chrome real**. Não é script bloqueado (TJPB), não é negação na borda
  sem challenge (TJRN), não é desafio interativo visível (STJ). **Registre qual
  dos quatro é**, porque o contorno de cada um é diferente.
- 🟡 **A hipótese do IP de datacenter voltou, e aqui ela custa o alvo inteiro.**
  O Turnstile pune faixa de datacenter, e o ambiente roteia por uma. **Pode ser
  que o portal funcione para o usuário e não para o agente** — 30 s no navegador
  pessoal fecham a dúvida, e **se fechar a favor, o TJSE volta para a fila** com
  o mapeamento todo pronto. Mesma pendência aberta do TJRN.
- 🔴 **A PISTA DA FILA ESTAVA ERRADA EM DOIS PONTOS.** A coluna dizia "Próprio
  (1ª e 2ª) — sistema caseiro": o TJSE roda **eproc** (o próprio
  `tribunais.json` já registrava), e o portal de jurisprudência **não é o sistema
  de tramitação** — é uma app JSF separada em `/Dgorg/`. **Confira a pista contra
  a base antes de gastar tempo com ela.**
- ✅ **O eproc NÃO tem jurisprudência pública, e isso se prova barato.** As ações
  `jurisprudencia_pesquisar`, `consulta_jurisprudencia` e `principal_externo`
  devolvem **todas a mesma tela de login** — e `acao=XXinventadaXX9z` devolve a
  mesma coisa. **O teste do valor inventado (TJMT/TJAL) serve para rota, não só
  para parâmetro.**
- ✅ **O PORTAL PODE ESTAR DENTRO DE UM IFRAME.** A página do menu
  (`/portal/consultas/jurisprudencia/judicial`) é invólucro Joomla; o sistema real
  está no `src` de um `<iframe>`. Quem raspar a página do menu acha só o campo de
  busca do site (`com_search`) e conclui que o tribunal não tem jurisprudência.
- ✅ **JSF entrega os combos de graça, sem popup.** 112 relatores, 9 órgãos e
  **1.084 classes processuais** enumerados num `combos.json` — a pendência que se
  repetiu em quatro tribunais do Bloco 1 (combos-árvore do SAJ) **não existe em
  JSF**. E o charset do módulo é **UTF-8**, enquanto o portal `www` é ISO-8859-1:
  **não herde o charset do institucional.**
- ✅ **Sem vhost curinga** (`/path-inventado-9z` → 404) e **DataJud corrente**
  (3.311.224 processos, atualizado em 04/08/2026) — ⚠️ mas `sistema.nome` vem
  como literal **"Inválido"** em 99,5% e não lista `eproc`, apesar de o tribunal
  rodar eproc. **Campo inútil neste tribunal.**

⚠️ **Pendências declaradas do TJSE:** a **Fase 3b não foi executada** (a busca
nunca devolveu resultado) — não há anatomia de card, escada até o inteiro teor,
paginação nem permalink; **nenhum operador foi testado**; os combos foram
capturados só na competência `SG` (mudar para `TR` os repopula por AJAX); o
contrato multi-seleção do `dlRelatores` não foi capturado; não se sabe o que faz
o `btPesquisarVoto`; e o **`jur tjse -n` por DataJud não foi implementado**,
apesar de o caminho estar medido.

📌 **O que o TJMT ensinou — mapeado em 08/08/2026, crawler fechado em 10/08/2026,
leia [`CLAUDE-TJMT.md`](CLAUDE-TJMT.md).** Foi o **primeiro alvo da regra da dívida
de crawler**: o slot das 20:00 retomou o `parcial` mais antigo e o levou a 🟢 sem
remapear nada. As lições novas do dia de fechamento vêm primeiro:

- 🔴 **UM CAMPO DE DATA SÓ SE IDENTIFICA LENDO O PAR — e o mapeamento de 08/08 errou
  o campo.** Ficou gravado que a janela filtrava **julgamento**, porque a conferência
  olhou só a data de julgamento dos documentos devolvidos. Lendo o **par** (julgamento,
  publicação), a janela de um dia `03/08/2026` devolve **8/8 com `pub=03/08/2026`** e
  julgamentos espalhados por 28–30/07. **A janela é de PUBLICAÇÃO**, e não existe filtro
  por julgamento nesta API — embora o campo exista e seja real no documento. É a lição
  do TJES ("a tela pode mentir no rótulo") pelo avesso: aqui quem erra é a leitura de
  uma data só. **Confira as DUAS datas do documento antes de nomear a flag.**
- 🔴 **FECHAR UM `parcial` É BARATO E CORRIGE O QUE FICOU ERRADO.** As três pendências
  que o crawler obrigou a resolver (consulta por número, `ordenarDataPor`, `thesaurus`)
  caíram em minutos, e uma delas **desmentiu o mapeamento**. Mapeamento que não vira
  crawler não é só trabalho parado: é trabalho **não verificado**.
- 🔴 **O PARÂMETRO COM NOME DE NÚMERO DE PROCESSO PODE NÃO SER O NÚMERO DO PROCESSO.**
  `filtro.numeroProtocolo` com o CNJ **mascarado** devolve **a base inteira** (ignorado),
  com **valor inventado** devolve a base inteira também, e com **20 dígitos** devolve
  **0**. Três respostas, nenhuma delas erro. O caminho certo era a **busca livre**, que
  ⚠️ **aceita as duas formas** — oposto do TJPE (só dígitos) e do TJES (só máscara).
  **O teste do valor inventado sozinho não decide: aqui ele e o valor válido dão a mesma
  coisa.** Só comparar os três com o sem-filtro separa "ignorado" de "campo errado".
- 🔴 **O CHECKBOX DE SINÔNIMOS DILUI, NÃO REFINA:** `thesaurus=true` infla **9,7×**
  (6.151 → 59.606). É controle que a tela oferece como refinamento e que multiplica.

As lições do mapeamento de 08/08 valem para os 4 restantes do bloco:

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

📌 **O que o TJTO (feito em 11/08/2026) ensinou — leia
[`CLAUDE-TJTO.md`](CLAUDE-TJTO.md).** Quinto alvo do Bloco 3 e o primeiro portal
**PHP + Solr caseiro** do repo: sem captcha em etapa nenhuma, com ementa íntegra,
**citação oficial pronta** e **permalink público que abre o inteiro teor**. As
lições valem para os 3 restantes:

- 🔴 **O MÉTODO DECIDE SE O FILTRO EXISTE — defeito novo no repo.** O formulário é
  `method="POST"`, e por **GET** o `q` funciona enquanto **todo o resto é ignorado
  em silêncio**, com HTTP 200 e o acervo inteiro:
  `GET ?q=usucapiao&type_minuta_selected=2` = **1.807** (acórdãos) e o mesmo par
  por POST = **4.583** (monocráticas). Como o `q` responde nos dois métodos, a
  busca "funciona" e não filtra — sem erro, sem zero, sem número redondo.
  **Teste o MÉTODO, não só o parâmetro.** É a variação nova sobre a lição do TJAL
  ("teste o parâmetro, não o controle"). ⚠️ **Corolário:** o permalink de busca
  existe e **mente sobre o recorte** — em aba limpa ele *executa* a busca (não é o
  zero falso do TJPE nem o formulário-sem-executar do TJRO), só que com o filtro
  errado. **É pior que os dois, porque parece certo.**
- 🔴 **403 EM TODO PATH É USER-AGENT, NÃO BLOQUEIO.** Sem UA de navegador o nginx
  nega tudo com 403 de 118 bytes — inclusive `/` e os próprios assets que a página
  carrega. O primeiro sweep de Passo 0 saiu com "403 em swagger, api, v1, rest,
  robots.txt, dados-abertos" e **nenhum daqueles 403 significava nada**.
  **Um 403 uniforme em paths sem relação entre si é cheiro de UA**, não de ACL —
  diferente do TJRN, onde o 403 do Akamai era o domínio inteiro de verdade.
- 🔴 **UM FILTRO DE DATA DESTRANCADO POR UM PARÂMETRO-COMPANHEIRO.**
  `dat_jul_ini`/`_fim` só valem com `tempo_julgados=pers` junto; sem ele as duas
  datas são **ignoradas em silêncio** (1.807 = acervo inteiro × 478 com o
  companheiro). Nenhum dos 15 tribunais anteriores tinha isso. ISO também é
  ignorado; DD/MM/YYYY acerta (não há o parse `MM/DD` do TJMT). ✅ Meia ponta
  funciona e o no-op 1900..2100 devolve o total.
- 🔴 **O TETO DE PÁGINA PODE NÃO SER UM NÚMERO — AQUI É PESO DE PAYLOAD, E OSCILA.**
  Na bisecção `rows=300` respondeu e 400 deu HTTP 500; **minutos depois o mesmo
  300 deu 500**, quebrando um teste que já tinha passado. Medido 2× cada: 100 →
  200/200 (único estável), 150 → 200/504, 200 → 500/200, 250+ → sempre 500.
  **Bisectar uma vez só produz um número que não se sustenta** — meça duas.
  ✅ O erro é honesto, nunca truncagem calada.
- 🔴 **SÓ ACÓRDÃO TEM EMENTA, e dissecar um tipo só teria errado em dois terços.**
  No acórdão o campo é a **ementa íntegra** (padrão CNJ); em **sentença e
  monocrática o mesmo campo traz a decisão inteira** ("SENTENÇA / Vistos etc.",
  "DESPACHO/DECISÃO / INTIME-SE"), e os dois vêm **sem relator**. É o defeito do
  TJBA em um só dos três tipos. ⚠️ E a maior aba (monocráticas, 597.990)
  **mistura despacho de mero expediente com decisão de mérito** — esse total não
  é jurisprudência toda.
- 🔴 **Nono tribunal, nono conjunto de operadores, e o espaço é OR**
  (1.807 + 29.310 − 1.257 = 29.860, exato). `NÃO` acentuado e `NOT` = 550 =
  1.807 − 1.257, exato; **`NAO` sem acento não é operador e INFLA** (30.282, sem
  sintoma) — **oposto do TJAC/TJAM/TJAL**, igual ao TJPI. `ADJ`/`PROX` ignorados.
  ✅ **O `$` funciona como curinga** (= `*`), novidade: zera em TJAC/TJAM,
  degenera em TJAL/TJMT, é ignorado no TJPE.
- 🔴 **Charset dividido no MESMO host:** `consulta.php`/`ementa.php` são UTF-8 e
  `documento.php` é **ISO-8859-1**. Não se herda charset nem dentro do domínio.
- ✅ **QUARTO tribunal do repo com 1º grau** — 254.501 sentenças, atrás de TJPB,
  TJRO e TJES —, com a partição por instância fechando **exata** nos três tipos.
  A pergunta do TJES rendeu pela **quarta vez seguida**. ⚠️ Mas **monocrática e
  sentença só existem de 2024 em diante** (acórdão vai a 2019).
- ⚠️ **O rótulo quase troca o acervo:** `TURMAS RECURSAIS` (Juizado, 20.785) ×
  `TURMAS DAS CAMARAS CIVEIS` (2º grau comum, 186.534) começam igual e são
  opostos. Em TO o Juizado é **8,3%** — padrão TJAL, oposto de TJAC/TJAM/TJRO.
  **Décimo tribunal, e a proporção continua sem se herdar.**
- ⚠️ **Valor inventado não erra: faz fallback silencioso.**
  `type_minuta_selected=9` volta para a aba 1. O teste do TJMT, sozinho, não
  flagra nada aqui. ✅ Já na faceta, valor inventado **zera**.
- ⚠️ **A base do próprio repo estava errada:** `cobertura/tribunais.json` registra
  `eproc1g`/`eproc2g.tjto.jus.br` e os **dois são NXDOMAIN** — o e-Proc vivo é
  `eproc2.tjto.jus.br`. **Confira a pista contra a realidade, não só contra a base.**
- ✅ Total **exato**, paginação **estável** (3/3), **sem teto de offset**
  (start=20.000 responde), **sem vhost curinga**, base **corrente**.

⚠️ **Pendências declaradas do TJTO:** o **DataJud não foi sondado** (não medido, não
inexistente); `fq_classe`, `fq_magistrado`, `fq_orgao_colegiado` e `fq_assuntos` estão
expostas como flags mas **não foram provadas por contagem** (só `fq_competencia` foi);
as três facetas de **metadado processual** (antecipação de tutela, justiça gratuita,
prioridade de atendimento) — inéditas no repo — **não foram testadas**; as facetas são
da **busca corrente**, não do acervo, e não há endpoint com a lista canônica (mesma
pendência do TJES); `fq_data_autuacao`/`fq_data_julgamento` não foram exercitados; a
ordenação (`tip_criterio_data`) não foi conferida por resultado; e **rate limit não foi
medido**. ⏱️ O timebox de 90 min **estourou** (~2h): busca, Passo 0 e Fase 3b couberam;
o excedente foi código, documentação e Fase 6.

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

📌 **O que o TJRO (09/08/2026) deixou pronto — `parcial`, leia
[`human-codegen/TJRO/01-juris/01-busca-e-filtros.txt`](human-codegen/TJRO/01-juris/01-busca-e-filtros.txt).**
**A API está inteira mapeada e o `src/TJRONavigator.js` já existe e funciona** (todas as
medições passaram por ele); falta o Crawler/Checker/Testes e o subcomando. O portal é o
**JURIS** (`juris.tjro.jus.br`), SPA React sobre um **Elasticsearch exposto quase cru, sem
auth**, com **4.079.398 documentos** — o maior acervo do repo. As lições valem para os 5 restantes:

- 🔴 **UM BOTÃO DA TELA PODE ENTREGAR O ACERVO OPOSTO AO QUE PROMETE.** A pior armadilha já
  medida no repo, porque não zera nem infla — **troca o acervo**. A tela tem três botões de
  instância, e "Turma recursal" e "Segundo grau" mandam **o mesmo payload**
  (`grau_jurisdicao:"2"`); e esse filtro **exclui as Turmas Recursais**. Provado num
  documento só: `nr_processo=70031613220228220003` tem `grau_jurisdicao: 2` no próprio
  `_source` e some quando se pede `grau="2"` (1 hit → 0 hits). Quem clicar em "Turma
  recursal" no portal oficial recebe Justiça Comum, com HTTP 200 e resultados plausíveis.
  **Não basta ver o filtro mudar a contagem: confira QUE documentos ele devolve.**
- 🔴 **O GAP DE UM FILTRO PODE SER O ACERVO QUE VOCÊ PROCURA.** `sem grau` = 347.938 e
  `grau="2"` = 163.307 — os 184.631 que faltam são exatamente as Turmas Recursais
  (1ª TR 151.219 + 2ª TR 33.376 = 184.595). **Quando a partição não fecha, o resto tem
  nome.** A partição correta é por `ds_orgao_julgador_colegiado.raw`, não por grau.
  E em RO **o Juizado é maior que a Justiça Comum** (53% × 47%) — padrão TJAC/TJAM,
  oposto do TJAL.
- 🔴 **HTTP 200 PODE SER PÁGINA DE BLOQUEIO.** O WAF "STIC" responde a `curl` com **200** e
  corpo "Página Bloqueada — suspeita de robotização". Quem olhar só o status conclui que o
  portal está no ar e a busca voltou vazia. ✅ Cura: UA de Chrome real (2.568 b → 61.645 b).
  Some à lição do TJPI (o zero nem sempre é zero): **aqui o 200 nem sempre é 200.**
- 🔴 **RATE LIMIT QUE MENTE NO PROTOCOLO HTTP — defeito novo.** Passando de ~35 requisições
  sem pausa, o backend responde com HTTP **malformado** (um `\x00` antes dos headers) e o
  Node nem parseia: chega `HPE_INVALID_HEADER_TOKEN`, um **erro de rede genérico**, não 429.
  Um crawler ingênuo lê isso como instabilidade e retenta em loop. Dura **~12 min**, é **por
  IP** (cookie não destrava) e **por host** (a tela continuava abrindo). **Throttle não é
  otimização neste tribunal.** O `TJRONavigator` já traduz o erro e pausa 1,2 s.
- 🔴 **CHAVE DESCONHECIDA EM `fields` ZERA A BUSCA EM SILÊNCIO.** Cinco nomes plausíveis para
  o filtro de data devolveram **0 com HTTP 200** antes de eu capturar o certo
  (`dtjulgamento_inicio`/`_fim`, `YYYY-MM-DD`). **Um zero pode ser nome de campo errado.**
  Capture o payload da tela; não adivinhe o nome do parâmetro.
- ✅ **TRÊS ARMADILHAS DE DATA DO REPO NÃO SE REPETIRAM — e isso também se mede.** O no-op
  1900..2100 devolve o total (não derruba, como no TJES); a meia ponta **funciona** (não é
  ignorada, como no TJPI); e `DD/MM/YYYY` dá **HTTP 500 honesto** (não o parse `MM/DD`
  silencioso do TJMT). Aritmética exata: `316 + 439 − 81 = 674`.
- 🔴 **TODOS os filtros querem NOME, nunca id** — `ds_nome`, `ds_classe_judicial` e
  `ds_orgao_julgador_colegiado` devolvem **0** se receberem o código (a armadilha do TJBA,
  aqui uniforme). E **`nr_processo` quer 20 dígitos**: a máscara devolve 0 calado —
  ⚠️ **enquanto o placeholder da própria tela é `0000000-00.0000.8.22.0000`, com máscara.**
- 🔴 **Oitavo tribunal, oitavo conjunto de operadores.** Ingleses funcionam (`AND`=454,
  `NOT`=220, frase exata, `*`); portugueses são **ignorados** (`E`/`OU`/`NAO`/`ADJ`) ou
  **inflam**: `NÃO` **acentuado** devolve **237.098** contra 220 da exclusão correta — 24× a
  busca sem operador, sem sintoma nenhum. **O espaço é OR**, provado:
  `674 + 9.631 − 454 = 9.851` exato. ✅ Acento é normalizado no índice.
- ✅ **TERCEIRO tribunal do repo com 1º grau, e o segundo maior**: 1.926.426 sentenças —
  atrás do TJPB (1.970.661) e à frente do TJES (1.509.942). `SENTENÇA` é **100% grau 1**, e
  `grau="1"` em EMENTA é 0. A pergunta que o TJES mandou fazer ("tem 1º grau?") rendeu pela
  terceira vez seguida. **Continue perguntando nos 5 restantes.**
- ✅ **Ementa e inteiro teor de graça na busca** (`ds_modelo_documento`), sem captcha em etapa
  nenhuma. ⚠️ Mas o texto tem **duas camadas** de perda de acento: entidades HTML no
  cabeçalho (`A&Ccedil;&Atilde;O`) **e acento já perdido na origem no corpo** (`Apelao`,
  `sentena`) — este segundo **não tem conserto**. Pior que o export de Word do TJPE.
- ✅ Paginação **estável**, total **exato** sem saturação, base **corrente** (07/08/2026),
  **sem vhost curinga** (NXDOMAIN de verdade), e o **DataJud do TJRO responde**
  (`api_publica_tjro`, atualizado em 04/08/2026). ⚠️ Mas **`from` tem teto de 10.000**
  (`max_result_window` do ES, com 500 honesto) — acervo grande exige recorte por data.
- ⚠️ **Só há data de JULGAMENTO**: `dtpublicacao` é **null em 20/20**. Espelho do TJPI, que
  só tem publicação. **Nunca apresente a data do TJRO como data de publicação.**
- ⚠️ **O permalink de busca restaura o formulário e NÃO executa a busca** (testado em aba
  limpa) — versão branda do defeito do TJPE. E **não há permalink por documento**.

⚠️ **Pendências declaradas do TJRO:** o **crawler não existe** (só o Navigator); a **Fase 3b
não foi executada na tela** — a lista de resultados nunca renderizou, então não há anatomia
de card nem escada de cliques (o contrato do documento está mapeado **pela API**); os **4
campos da pesquisa avançada** (Todas/Quaisquer/Sem/Trecho exato) **não tiveram os nomes de
payload capturados** — e chave errada zera em silêncio; os combos de **órgão julgador** e
**ordenação** não foram enumerados; os **3 documentos** com `tipo` fora dos oito da tela não
foram identificados; e os **módulos irmãos** (súmulas, caderno de ementas, repositório de
jurisprudência, NUGEPNAC), todos linkados no mapa do site oficial, não foram tocados.

📌 **O que o TJAP (11/08/2026) ensinou — `parcial`, leia
[`human-codegen/TJAP/`](human-codegen/TJAP/INDEX.md).** Sexto alvo do Bloco 3 e o
primeiro tribunal do repo em que **a jurisprudência mora dentro do sistema de
tramitação**. O módulo principal está murado por Turnstile; a porta que abriu foi
outra. As lições valem para os 3 restantes:

- 🔴 **UM TRIBUNAL PODE TER UM MÓDULO MURADO E OUTRO ESCANCARADO — e o aberto não
  aparece no DNS.** `tucujuris.tjap.jus.br` (acórdãos) exige Turnstile;
  `bancosentencas.tjap.jus.br` (1º grau) responde **200 a `curl` puro**, sem browser,
  sem UA especial, sem captcha em lugar nenhum. O segundo host **não saiu da varredura
  de DNS** — eu não o chutei; saiu do HTML da página do primeiro. É a lição do TJBA
  ("o endpoint estava no bundle") aplicada a **host**, não a rota. **Leia o HTML do
  módulo bloqueado antes de marcar o tribunal como bloqueado.**
- 🔴 **DESAFIO DE BORDA ≠ CAPTCHA DE APLICAÇÃO — e o TJAP tem os DOIS, em camadas.**
  A borda do `tucujuris` é Cloudflare com desafio **automático**: 403 para `curl`, mas
  **HTTP 200 na 1ª tentativa** no Playwright headless com UA de Chrome real, sem espera
  e sem interação (≠ o desafio interativo do STJ). Passada a borda, a **busca** exige
  Turnstile no corpo do POST. **Vencer a borda não é vencer o portão** — meça os dois
  em separado, como TJAC mandou medir busca × download.
- 🔴 **403 UNIFORME TORNA `curl` CEGO PARA DESCOBERTA DE ROTA.** No `tucujuris` até
  `/path-inventado-9z` dá 403 — não dá para distinguir rota que existe de rota que não
  existe. ✅ **Mas a API por dentro erra com honestidade** (Symfony):
  `"No route found for POST /api/publico/consultar-sumula"` e
  `"Method Not Allowed (Allow: GET)"`. **Enumere rota de dentro da página, não da borda.**
- ⚠️ **`ctx.request` do Playwright NÃO passa desafio de borda** (não executa JS): buscar
  um recurso do próprio host por `ctx.request` devolve a página de desafio. De dentro da
  página, `fetch()` funciona. Foi a diferença entre ler e não ler o componente de captcha.
- ⚠️ **`networkidle` NUNCA dispara aqui** — o beacon RUM do Cloudflare mantém a rede
  viva para sempre. A receita da Fase 3 precisa de espera explícita neste host.
- 🔴 **O TOKEN DO CAPTCHA PODE VIAJAR NO CORPO, NÃO EM HEADER.** `filtro.captcha` é
  campo do JSON do POST, alimentado pelo callback do Turnstile — e `ds.js`, o transporte,
  **não menciona captcha em lugar nenhum**. Procurar header teria dado "não achei".
  Há ainda um conceito de **"passe"** (`requerido: !passe`): se o servidor entregasse
  passe, não haveria captcha — mas `buscar-passe-captcha` devolve `dados: null`.
- ⚠️ **Dois fornecedores de captcha carregados na mesma página**: Turnstile
  (`0x4AAAAAABxUlvVnxyw9z7Xj`, o que a busca usa) e reCAPTCHA
  (`6LdAcykTAAAAACD4MfZAyI8C_VAHA-DOceOBH8T7`, caminho legado). `window.grecaptcha` **e**
  `window.turnstile` são ambos `object`. Achar um não diz qual está em uso.
- 🔴 **ACENTO OBRIGATÓRIO NO BANCO DE SENTENÇAS — e quase gravei a base como minúscula.**
  `usucapiao` = **1** resultado; `usucapião` = **2.001**. Padrão TJMS/TJBA, oposto de
  TJAC/TJAM/TJAL/TJPE/TJPI/TJTO. E o total **satura em 10.000** (`dano moral` e `a` dão
  o mesmo número). O "1 resultado" é a forma mais convincente de zero silencioso que
  apareceu até agora: não é zero, então não levanta suspeita.
- ✅ **Seria o 5º tribunal do repo com 1º GRAU** (depois de TJES, TJPB, TJRO, TJTO). A
  pergunta que o TJES mandou fazer rendeu pela **quinta vez seguida** — continue fazendo.
- ⚠️ **Família nova: Laravel + Livewire + Alpine.** Não é SPA-com-REST, JSF, Rails nem
  PHP+Solr. Livewire é server-driven (snapshot assinado por checksum via
  `POST /livewire/update`), então **não há endpoint REST limpo** — se a busca roda por
  http puro é a **primeira coisa a medir** no próximo slot.
- ⚠️ **A data do card chama-se "Juntada"**, como o `dt_juntada` do TJES. Aqui o rótulo
  da tela é honesto — mas continua não sendo julgamento nem publicação.

⚠️ **A falha de processo do dia foi minha, e ela invalida uma medição:** rodei o teste
decisivo do Turnstile com `channel:'chrome'` mas **esqueci de sobrescrever o userAgent**,
então o navegador se anunciou como `HeadlessChrome/150` e levou 403 **na borda**, sem
nunca chegar ao Turnstile. O "token vazio" que ele produziu **não é evidência sobre o
captcha** — é evidência de que me anunciei como robô. É a armadilha do TJRN se repetindo.
**O teste em Chrome real continua NÃO MEDIDO.**

⚠️ **Pendências declaradas do TJAP:** no módulo de acórdãos a **Fase 3b não foi
executada** (a busca nunca respondeu) e nenhum filtro foi provado por contagem; no Banco
de Sentenças falta **tudo depois da busca** — anatomia do card, se há ementa, escada até
o documento, paginação, permalink, consulta por número, operadores, distribuição por ano
e a prova de que os filtros compõem. O **DataJud não foi sondado**. E os **dois selects
de `classe`** (31 e 113 opções) não foram distinguidos.

🔴 **Com o TJAP a fila passou a ter TRÊS `parcial` (TJPB 08/08, TJRO 09/08, TJAP 11/08)
— o gatilho da regra da dívida de crawler.** O próximo slot das 20:00 deve pegar o
**TJPB**, o mais antigo, em vez de abrir tribunal novo.


📌 **O que o TJRR (feito em 12/08/2026) ensinou — leia
[`CLAUDE-TJRR.md`](CLAUDE-TJRR.md).** Sétimo alvo do Bloco 3 e o **primeiro
JSF/PrimeFaces aberto do repo**: sem captcha em etapa nenhuma, ementa íntegra na
busca e PDF de inteiro teor público. As lições valem para os 2 restantes:

- 🔴 **A FAMÍLIA DO PORTAL NÃO DIZ NADA SOBRE O PORTÃO — e aqui ela absolveu.**
  O único irmão JSF/PrimeFaces mapeado é o **TJSE**, que é captcha nos **dois**
  módulos (Turnstile e reCAPTCHA). O TJRR roda a mesma pilha e **não tem captcha
  nenhum**. Isso foi medido **mandando o POST e lendo a resposta**, que é
  exatamente o que o TJSE mandou fazer depois de `grep turnstile` dar falso
  negativo lá. **A pilha prevê o contrato do POST, nunca o bloqueio.**
- 🔴 **LINHAS POR PÁGINA PODE SER LISTA BRANCA, E FORA DELA A TABELA VOLTA VAZIA
  COM HTTP 200 — defeito novo no repo.** `_rows` aceita **exatamente** 10, 20 e
  30, os três valores do combo; qualquer outro (3, 5, 15, 25, 31, 40, 50, 100)
  devolve fragmento de **57 bytes** — tabela sem uma linha, sem erro, sem 500.
  Medido duas vezes, idêntico. É o **avesso da lição do TJAL** ("teste o
  parâmetro, não o controle"): lá o servidor aceitava o que a tela não oferecia;
  aqui ele **só** aceita o que a tela oferece, e sair da lista custa um zero
  silencioso — `--page-size 50` colheria zero em toda página, o que se lê como
  fim da lista. **Bisecte o tamanho de página mesmo quando a tela sugere o
  limite.**
- 🔴 **DUAS TABELAS DE RESULTADO NA MESMA RESPOSTA, com os MESMOS ids de card.**
  `dataTablePesquisa` (acórdãos, 77.128) e `dataTablePesquisa2` (monocráticas,
  49.256) vêm renderizadas juntas. Ler só a primeira perde **39% do acervo** sem
  sintoma; e fatiar a página inteira como se fosse uma aba **mistura monocrática
  dentro de acórdão** — os campos batem todos e só a ementa vem vazia, que é
  indistinguível da monocrática legítima. Foi o primeiro bug do crawler. **Conte
  quantas tabelas a resposta tem antes de fatiar.**
- 🔴 **UM ATRIBUTO DE ESTILO PODE APAGAR O CAMPO MAIS IMPORTANTE.** O `docTexto`
  da EMENTA carrega `style="text-align: justify"` e os demais não: o seletor
  `div.docTexto` cru casa processo, relator, órgão e as duas datas e **perde
  exatamente a ementa**, calado. O card volta completo com `ementa: null` — o
  mesmo sintoma da monocrática que legitimamente não tem ementa. Segundo bug do
  dia. **Case o container com `[^>]*`, e desconfie de campo nulo que "faz
  sentido".**
- 🔴 **NEM TODO DOCUMENTO TEM INTEIRO TEOR, e descartá-lo perde julgado em
  silêncio.** 1 das 10 monocráticas da primeira página não traz link de PDF
  nenhum. O parser inicial o descartava por falta de id — o crawler agora o
  mantém com `id: null` e `semInteiroTeor: true`. **O que o portal não entrega
  tem de aparecer no resultado como ausência declarada, não como ausência.**
- ✅ **SEGUNDO CONJUNTO DE OPERADORES COERENTE EM ONZE TRIBUNAIS** (depois do
  TJPB): os portugueses funcionam com aritmética exata (`OU` = 27.442 + 17.373 −
  15.907 = 28.908; `NÃO` = 27.442 − 15.907 = 11.535), o espaço é AND, e os
  ingleses **destroem** a busca (`AND` = 4, `NOT` = 0) em vez de inflar — cair
  para 4 é sintoma visível. ⚠️ E `NAO` e `NÃO` são **o mesmo** operador aqui,
  inédito: a causa está medida, o `onsubmit="normalizar()"` do formulário tira o
  acento da query inteira antes de enviar.
- ⚠️ **DUAS CAMADAS DE NORMALIZAÇÃO, e só medir as duas em separado dá a
  resposta.** O cliente normaliza (pelo `normalizar()`) **e** o índice também:
  mandando o termo cru por fora do cliente, `usucapiao`, `usucapião` e até o
  mojibake `usucapiÃo` devolvem os **mesmos 991**. Fosse medido só por dentro da
  tela, ficaria gravado "o índice normaliza" sem prova nenhuma.
- 🔴 **A PONTA FINAL DA JANELA DE DATA É IGNORADA SOZINHA, E A INICIAL FUNCIONA**
  — a lição do TJPI com a **metade trocada** (lá quem sumia era o início). Não se
  herda nem a assimetria. ⚠️ E o combo diz "TODOS" e filtra **julgamento**: 58,
  igual ao explícito, contra 60 do PUBLICACAO. ✅ Em compensação a base tem as
  **duas datas, reais, distintas e filtráveis** — diferente de TJPI (só
  publicação), TJRO (só julgamento) e TJES (só juntada).
- ⚠️ **O PASSO 0 QUASE ENTREGOU UMA API QUE NÃO EXISTE:** `juris.tjrr.jus.br` é
  outra aplicação (SPA Angular) e responde **200 a qualquer path**, inclusive
  `/path-inventado-9z`, sempre com o mesmo `index.html` de 1,6 KB. Cinco "200"
  em `/swagger`, `/v3/api-docs`, `/openapi.json`, `/api` e `/dados-abertos` eram
  a mesma página em branco — a armadilha do TJES, e o que separa é o **tamanho**
  do corpo. ✅ No host de jurisprudência não há vhost curinga.
- 🔴 **A PISTA DA FILA ESTAVA ERRADA, E QUEM CORRIGIU FOI O DATAJUD, NÃO O
  PORTAL.** O `tribunais.json` registra PJe + Projudi; o acervo real é **99,96%
  Eproc** (372.073 de 372.220, contra PJe 107 e Projudi 40). É a lição do TJSE
  repetida, só que desta vez **a base do próprio repo era a pista errada** — e
  custou 30 segundos de DataJud descobrir.
- ⚠️ **A pergunta do TJES ("tem 1º grau?") deu NÃO pela primeira vez em seis** —
  depois de TJPB, TJRO, TJES, TJTO e TJAP. **Continue perguntando:** o "não"
  medido vale tanto quanto o "sim", e é o que impede prometer sentença de RR.
- ✅ **A partição por órgão fecha EXATA** (as 12 partes somam 991 = o total),
  raro no repo. 🔴 Mas **o peso do Juizado varia 94× conforme o tema**: Turma
  Recursal é 37,5% em `dano moral` e 0,4% em `usucapião`. Décimo primeiro
  tribunal, e a proporção continua sem se herdar.
- ⚠️ **Valor inventado é IGNORADO, não recusado** (devolve o acervo inteiro, com
  200), em órgão e em classe: o teste do TJMT não flagra nada aqui — igual ao
  TJTO. O que decide é comparar o valor **válido** com o sem-filtro.
- ✅ **JSF entrega os combos de graça** (12 órgãos, 257 classes, 43 relatores,
  sem popup), confirmando o que o TJSE mediu. ⚠️ E os filtros **não existem na
  home**: só aparecem na tela de resultado, padrão TJPI.

⚠️ **Pendências declaradas do TJRR:** os **43 relatores** estão enumerados e no
`--listar-filtros`, mas **não há flag `-r`** e o filtro **não foi provado por
contagem**; o caminho **SISCOM (13 dígitos)** que o placeholder promete não foi
medido, por falta de um número real; os **módulos irmãos** linkados no menu
(Jurisprudência Temática, Súmulas, Enunciados, Legislação, Precedentes
Obrigatórios) não foram tocados; **rate limit não foi medido**; não se mediu se
as abas **compõem com o filtro de data**; e `/impressao.xhtml?id=` respondeu 200
mas **não foi dissecada**. ⏱️ O timebox de 90 min **estourou** (~3h30): Passo 0,
busca, Fase 3b e a bateria de medições couberam em ~1h20; o excedente foi
código, dois bugs de parser e a Fase 6 inteira.

## Bloco 4 — Módulo faltante (1 alvo)

| # | Alvo | Escopo | Status |
|---|---|---|---|
| 17 | **TJRJ / eJURIS** | ✅ fechado como comando próprio `jur tjrj-ejuris`: acervo histórico da 2ª Instância (desde ~1995) + Turmas Recursais. ⚠️ a Turma Recursal daqui é pequena e só de 2025-2026 | ok 13/08 |

📌 **O que o TJRJ/eJURIS (feito em 13/08/2026) ensinou — leia
[`CLAUDE-TJRJ-EJURIS.md`](CLAUDE-TJRJ-EJURIS.md).** Único alvo do Bloco 4, e o
primeiro **ASP.NET WebForms** do repo. Fechou o segundo módulo de um tribunal
que já tinha crawler — e a lição maior é que **o módulo que faltava tinha o que
o módulo pronto não tem**:

- 🔴 **A TELA TEM reCAPTCHA E O ENDPOINT NÃO O EXIGE — e `grep recaptcha` teria
  marcado o tribunal como bloqueado sem tentar.** A tela de resultado carrega
  reCAPTCHA Enterprise e chama `Recaptcha.aspx/RecaptchaVerify` (respondeu
  `success:true, score 0.9`); mesmo assim o web-method devolve **200 com os
  documentos em HTTP puro, sem token, sem browser**. É o **avesso exato da
  lição do TJSE**: lá `grep turnstile` deu falso NEGATIVO e o POST provou o
  bloqueio; aqui a string daria falso POSITIVO e o POST provou a porta aberta.
  **A busca de string erra nos dois sentidos — o que decide é mandar a
  requisição e ler a resposta.**
- 🔴 **UM CAMPO HIDDEN DE STOPWORDS, VAZIO, DERRUBA A BUSCA COM HTTP 500 SEM
  MENSAGEM.** O `hfListaPalavrasBloqueadas` (`A;ACIMA;COM;DA;…;SOBRE`) é a
  lista de stopwords que a tela devolve ao servidor. Mandá-la vazia responde
  "Runtime Error" e nada mais — não há sintoma que aponte a causa, e foi o
  primeiro erro do dia. **Em WebForms, reenvie TODOS os hidden do formulário,
  inclusive os que parecem decorativos.**
- 🔴 **UM FILTRO PODE FUNCIONAR NUMA PARTIÇÃO E SER IGNORADO NA OUTRA.** Ano e
  competência filtram na origem `comum` (2020 = 45.245 × 2026 = 34.127; cível
  818.397 × criminal 6.784) e são **ignorados** nas outras quatro origens
  (1990 = 2015 = 2024 = 2026 = **1.002**). Defeito novo no repo: até aqui um
  filtro funcionava ou não funcionava. **Prove cada filtro DENTRO de cada
  partição** — medi-lo só no caminho principal esconde metade da verdade. O que
  fecha a prova é `1990`: a Turma Recursal nem existia assim.
- 🔴 **OS CHECKBOXES DE "TIPO DE DOCUMENTO" ERAM ESCOPO DE BUSCA — e desmarcar
  todos NÃO devolve zero.** "Inteiro Teor (PDF)" procura o termo no texto do
  PDF e acha **78.066** contra 51.972 do default: é mais que o total dos
  "tipos". E com os quatro desmarcados o servidor devolve **161**, idêntico a
  "só Ementário" — um default silencioso onde se esperaria zero ou erro.
  **Some ao TJAL ("teste o parâmetro, não o controle") o caso em que o controle
  mente sobre a própria natureza.**
- 🔴 **UM DOS DOIS "PERMALINKS" É ZERO FALSO.** O `gedcacheweb?GEDID=<ArqGed>`
  entrega o **PDF do inteiro teor** em aba limpa, sem cookie e sem captcha ✅.
  Já o `ImpressaoConsJuris.aspx?CodDoc=` devolve **HTTP 200 com 1.239 caracteres
  de casca e um `grecaptcha.ready(...)`** — e o corpo é **idêntico para
  documentos diferentes**, sem o número de nenhum. Testar um só link e comemorar
  o 200 grava permalink falso. **Compare o corpo de dois documentos diferentes
  antes de chamar uma URL de permalink.**
- 🔴 **OS OPERADORES INGLESES DERRUBAM (HTTP 500) em vez de zerar ou inflar** —
  quarto comportamento distinto no repo, e o mais honesto: erro visível.
  Os portugueses funcionam com o espaço valendo AND, o curinga é **`$`** (não
  `*`), e ⚠️ **`NAO` e `NÃO` são o MESMO operador** (11.656 os dois) — como no
  TJRR e ao contrário de TJPI e TJTO. ⚠️ E **stopword some em silêncio**:
  `contrato de trabalho` = `contrato trabalho` = 944.
- ⚠️ **O TEXTO DO CARD MUDA DE NATUREZA CONFORME O TIPO, no mesmo portal:** em
  acórdão de 2ª Instância é **ementa** estruturada (959–1.983 ch), em
  monocrática é a **decisão** (1.659–3.979 ch) e em **Turma Recursal é o voto
  inteiro** (1.803–10.123 ch, abrindo por "RECURSO Nº … V O T O"). Dissecar um
  tipo só e generalizar era a armadilha do TJMG, e ela estava aqui inteira.
- ⚠️ **O COMBO DE ANOS PROMETE 20 ANOS QUE NÃO EXISTEM**: oferece 1975, e 1975
  e 1985 devolvem **0**. A base começa por volta de **1995** (524) e está
  **corrente** (2026 = 34.127 em agosto). **Meça as pontas do combo em vez de
  anunciar o intervalo que ele exibe.**
- ⚠️ **O ACERVO QUE MOTIVOU O ALVO ERA O MENOR DELE.** A fila pedia "Turmas
  Recursais cariocas + acervo histórico"; a Turma Recursal do eJURIS tem
  **~1,6 mil documentos, todos de 2025-2026** (`usucapião` = 0), enquanto a 2ª
  Instância tem **818.397**. O ganho real do módulo foi o histórico, não o
  Juizado. **Meça o tamanho de cada partição antes de prometer cobertura por
  ela** — e as origens `alcadacivel` (1), `alcadacriminal` (2) e `conselho` (78)
  são resquício, não acervo.
- ✅ **WEBFORMS ENTREGA OS COMBOS DE GRAÇA, e melhor que o JSF**: 804
  magistrados, 77 órgãos e 16 ramos vêm no **HTML estático** do GET, sem AJAX e
  sem POST de repopulação — `curl` basta. A pendência de combo-árvore que se
  repetiu em quatro tribunais do Bloco 1 não existe aqui.
- ✅ **Paginação ESTÁVEL** (3/3 em sessões novas, mesmos ids) — ao contrário do
  **e-Proc do mesmo tribunal**, cuja fronteira desliza. Dois módulos do TJRJ,
  dois comportamentos de paginação. ✅ Total **exato** (`criptomoeda` = 1),
  **sem vhost curinga**, e pedir página além do fim responde **500**, não lista
  vazia — o crawler trata como fim.
- ✅ **A consulta por número é a mais generosa do repo**: aceita CNJ **com
  máscara**, CNJ **só dígitos** e a **numeração antiga** do TJRJ, as três
  devolvendo o mesmo documento. Oposto de TJPE (só dígitos), TJES (só máscara) e
  TJPI (o número sozinho derruba a busca).
- ⚠️ **Não há data de publicação**: `TemDataPublicacao` vem false em 100% da
  amostra e o recorte é por **ano**, não por dia. O `jur tjrj` (e-Proc) filtra
  por dia e tem publicação — **os dois módulos do mesmo tribunal divergem até
  nos campos de data**.

⚠️ **Pendências declaradas do TJRJ/eJURIS:** os filtros `--ramo`,
`--magistrado` e `-oj` estão expostos e resolvem o label, mas **não foram
provados por contagem**; o botão "+" (multi-seleção via `hfCodRamos`/`hfCodMags`/
`hfCodOrgs`) **não foi mapeado** — o crawler manda um valor por combo; o
`chkAtivo`/`chkInativo` (situação do magistrado) é enviado sempre marcado e
**não foi medido**; o tipo **EMENTÁRIO** tem 27 campos próprios em
`Ementarios[0]` que **não são expostos** no resultado; não se mediu **rate
limit**; e o **DataJud não foi sondado** para este módulo. ⏱️ O timebox de 90
min **estourou** (~2h): Passo 0, contrato, Fase 3b e a bateria de medições
couberam em ~60 min; o excedente foi código, a Fase 6 e o registro da entrada
`TJRJ_EJURIS` na cobertura (que é keyed por tribunal, e um **módulo** de
tribunal não cabia no modelo — precisou de upsert sintético, como CARF/TCU).

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
