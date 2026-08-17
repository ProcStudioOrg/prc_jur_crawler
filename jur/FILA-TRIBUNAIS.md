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
| 14 | **TJPB** | PB | PJe, Projudi — API mapeada em 08/08, **crawler fechado em 13/08** | ok 13/08 |
| 15 | **TJRO** | RO | PJe, Projudi — API mapeada em 09/08, **crawler fechado em 17/08** | ok 17/08 |
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
✅ **Foi o que aconteceu em 13/08/2026** — o TJPB fechou 🟢 e sobraram dois `parcial`
(TJRO 09/08, TJAP 11/08). **Abaixo de 3, os dois slots voltam a pegar `pendente`** —
e os `pendente` que restam são todos TCEs do Bloco 5.

📌 **O que o TJPB (crawler fechado em 13/08/2026) ensinou — leia
[`CLAUDE-TJPB.md`](CLAUDE-TJPB.md).** Segundo alvo da regra da dívida, depois do TJMT, e
a confirmação mais forte que ela já teve: **o crawler desmentiu três coisas que o
mapeamento de 08/08 dava por medidas**. As lições valem para os dois `parcial` restantes:

- 🔴 **UM PARÂMETRO DE MODO PODE SER UM PORTÃO PARA O CONJUNTO INTEIRO DE FILTROS.** Em
  08/08 ficou gravado que `advanced=true` ligava a data e desligava o `grau`. É maior que
  isso: **todos** os filtros avançados (comarca, classe, órgão, vara, competência,
  relator, `instancia` e **número de processo**) são ignorados sem ele, com HTTP 200 e
  contagem plausível. O caso mais caro é o `numeroProcesso`, que **sem o portão devolve a
  base inteira** (2.515.754) — inclusive para número inventado. Um Checker ingênuo leria
  2,5 milhões de documentos confirmando um processo que não existe. **Quando achar um
  parâmetro de modo, teste TODOS os filtros dentro e fora dele, não o par que motivou a
  descoberta.**
- 🔴 **A CONCLUSÃO "FILTRO IGNORADO" PODE SER UM ARTEFATO DO MODO EM QUE VOCÊ MEDIU.** O
  mapeamento declarou `instancia` ignorado e concluiu que **o TJPB não tinha partição
  Juizado × Justiça Comum**. Tinha: com o portão ela existe e **fecha exata**
  (8.998 + 3.169 + 41 = 12.208). A ressalva do próprio doc — "o valor inventado errar não
  prova que o parâmetro filtra" — continuava certa; errada era a conclusão.
- 🔴 **QUEM TEM EMENTA PODE SER O PAR (TIPO, INSTÂNCIA), NÃO O TIPO.** O doc de 08/08 mediu
  **um** acórdão e escreveu "ACORDAO tem ementa". Em 200 documentos: acórdão de 2º grau
  comum **76/76 com ementa**, acórdão de **Turma Recursal 0/4**, sentença 0/108 (e **sem
  relator**), monocrática 0/12. **Disseque o tipo dentro de cada instância** — some à
  lição do TJPI ("disseque os três tipos, não dois").
- 🔴 **UMA HIPÓTESE GRAVADA COMO MEDIÇÃO ENVELHECE MAL.** Em 08/08 ficou escrito que o 403
  nos chunks da SPA era **cota** ("403 em asset é cota até prova em contrário"). A prova
  veio: contexto novo, **primeira** requisição, 403 igual — no index e em todos os assets,
  com qualquer UA. É bloqueio de borda no caminho `/juris-pb/*`. **A Fase 3b segue não
  executada**, agora com a causa medida. ✅ E a API `/juris-pb-backend/public/*`, no
  **mesmo host**, continua fora do challenge e responde ao `curl` cru: **meça a API
  separado da tela**, sempre.
- ✅ **É o SEGUNDO tribunal do repo com 1º grau e o MAIOR deles**: 1.970.661 sentenças,
  78% do acervo, à frente de TJRO (1.926.426), TJES (1.509.942) e TJTO (254.501). A
  pergunta que o TJES mandou fazer rendeu pela **sexta vez seguida**.
- ✅ **Operadores coerentes** (português e inglês, aritmética exata, token desconhecido
  zerando) — mas ⚠️ **acento obrigatório e não normalizado** (`usucapiao` = 64 ×
  `usucapião` = 12.208), padrão TJMS/TJBA.
- 🔴 **Só há data de JULGAMENTO** (`meioPublicacao` null em 200/200) e ela é um **timestamp
  com milissegundos** — assinatura/indexação, não data de sessão. ⚠️ E **meia janela de
  data é ignorada em silêncio** (padrão TJPI). ✅ Mas `DD/MM/YYYY` cru dá **HTTP 400
  honesto**, não o parse `MM/DD` silencioso do TJMT.
- ⚠️ **Combos que são autocomplete escondem ids homônimos:** três "João Pessoa"
  (200, 0, 9010) filtram 1.689, 3.169 e 41. **Pegar o primeiro é escolher errado.**
- ⚠️ **Teto de offset de 10.000** (`max_result_window` do Elasticsearch, HTTP 404), como no
  TJRO. ✅ Paginação estável, total exato, `size` máx. 50 com 400 honesto, base corrente
  (documento do próprio dia), sem vhost curinga e **DataJud respondendo**.


📌 **O que o TJRO (crawler fechado em 17/08/2026) ensinou — leia
[`CLAUDE-TJRO.md`](CLAUDE-TJRO.md).** Terceiro alvo da regra da dívida, depois de TJMT e
TJPB, e o terceiro seguido em que **o crawler desmentiu o mapeamento**. Sai daqui com o
**maior acervo do repo** (4.027.701 documentos) e o **maior 1º grau** (1.928.898
sentenças). As lições valem para o `parcial` restante:

- 🔴 **UM BOTÃO DA TELA PODE DEVOLVER O ACERVO OPOSTO AO QUE PROMETE.** O portal do TJRO
  tem três botões de instância e os dois últimos mandam o mesmo payload
  (`grau_jurisdicao: "2"`); pior, esse filtro **exclui** as Turmas Recursais, mesmo com os
  documentos delas trazendo `grau 2` no próprio `_source`. Clicar em "Turma recursal"
  devolve **Justiça Comum**. Não zera (TJAC), não infla (TJBA), não é ignorado (TJPB):
  **troca o acervo**, com HTTP 200 e resultados plausíveis. É a armadilha mais silenciosa
  já medida no repo — e o contorno é recortar por **órgão colegiado**, não por grau.
- 🔴 **A LISTA DE VALORES DE UM FACET NÃO É O QUE COUBE NO TOP-N.** O mapeamento de 09/08
  montou a partição de Juizado com duas Turmas Recursais, que eram as visíveis; o facet
  completo tem **cinco**. Com duas a soma não fechava e o gap virava "TRs menores"; com as
  cinco ela **fecha exata**. **Enumere o facet inteiro antes de declarar uma partição.**
- 🔴 **PARTIÇÃO MEDIDA NUM TERMO SÓ NÃO É PARTIÇÃO.** O peso do Juizado no TJRO varia
  **164×** conforme o tema: `dano moral` = 65,6% e `usucapião` = 0,4%. O doc de 09/08
  concluiu "em Rondônia o Juizado é maior que a Justiça Comum" de um termo só — vale para o
  total da base, e **não para uma busca qualquer**. Meça dois temas opostos.
- 🔴 **A DUPLICAÇÃO DO TJBA EXISTE AQUI E NINGUÉM TINHA PROCURADO** — apesar de o próprio
  doc do TJBA mandar procurar. Numa página de 100: **100 `_id` distintos para 96 documentos
  reais**, com um caso de **4 cópias** (mesmo md5, mesma data, mesmo texto). O total do
  servidor conta as cópias. ⚠️ E o campo md5 **falta em 40% dos ACÓRDÃOs** (acervo legado),
  então dedup por md5 puro não serve: precisa de fallback.
- 🔴 **UMA RESSALVA GRAVADA PODE SER ARTEFATO DO PRÓPRIO LEITOR.** Ficou registrado que "o
  corpo do documento já perdeu os acentos na origem (`Apelao`, `sentena`) e não há como
  recuperar". **Falso:** o HTML cru é `Apela&ccedil;&atilde;o` e **não tem um único byte
  não-ASCII**. O `Apelao` saiu de um strip que apagou as entidades em vez de decodificá-las.
  **Antes de gravar "o tribunal corrompe o dado", confira o byte cru** — a acusação ficou
  em quatro arquivos e teria virado aviso permanente ao usuário.
- ⚠️ **UM TIPO DE DOCUMENTO INTEIRO PODE DESAPARECER ENTRE DUAS MEDIÇÕES.** `DECISÃO DA
  PRESIDÊNCIA` tinha 56.676 documentos em 09/08 e devolve **0** em 17/08 — e no mesmo
  intervalo a base **encolheu** 51.697 (4.079.398 → 4.027.701), em vez de crescer. Base
  corrente que diminui é sinal, não ruído. **Causa não isolada** (56.676 ≠ 51.697).
- 🔴 **RATE LIMIT PODE CHEGAR COMO ERRO DE REDE, NÃO COMO 429.** O WAF do TJRO responde com
  HTTP **malformado** (byte `\x00` antes dos headers) e o que chega ao código é
  `HPE_INVALID_HEADER_TOKEN`. Um crawler ingênuo lê "instabilidade" e retenta em loop,
  prolongando um bloqueio de ~12 min por IP. **Throttle não é otimização aqui**, e o
  Navigator traduz o erro na causa real para parar em vez de insistir.
- ⚠️ **CHAVE DESCONHECIDA NO PAYLOAD ZERA A BUSCA EM SILÊNCIO** (HTTP 200): `xx_inventado_9z`
  junto de uma query boa devolve 0 contra 676. Por isso o crawler tem **uma única porta de
  entrada** para o bloco de campos — nome de campo não medido não passa.
- ✅ **A pendência que o rate limit deixou em aberto caiu em minutos.** Os 4 campos da
  pesquisa avançada (`todas_palavras`/`quaisquer_palavras`/`sem_palavras`/`trecho_exato`)
  foram capturados do POST real e **provados por contagem**, com aritmética exata. São eles
  — e não operador textual — o caminho para AND/OR/NOT neste tribunal, onde o espaço é OR e
  o `NÃO` acentuado **infla 24×**.
- ✅ **Nono tribunal do bloco, nono conjunto de operadores.** Ingleses funcionam, portugueses
  são ignorados, `$` degenera. Continua sem herdar nada.


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

- 🔴 **O `<select>` ERA DECORATIVO — QUEM FILTRA É O HIDDEN, e por meia hora o
  crawler teve três flags ignoradas em silêncio.** `cmbOrgaoJulgador=431`
  devolve **51.972**, exatamente a contagem sem filtro; `hfCodOrgs=431` devolve
  **48**. Idem ramo e magistrado. Quem carrega a seleção é o hidden que o botão
  "+" alimenta — o combo visível não é enviado a lugar nenhum útil. Eu havia
  fechado o crawler mandando só o `<select>` e **declarado os três filtros como
  "não provados por contagem"**; foi provar que o defeito apareceu. **A
  invariante do repo ("contagem igual = filtro ignorado") não é só para relatar
  ao usuário: é teste de aceite do próprio crawler, e pendência declarada é onde
  o bug se esconde.** ✅ Multi-valor por `;`, e a partição **fecha exata**
  (431 = 48, 432 = 23, `431;432` = 71); ⚠️ `;` sobrando responde 500.

⚠️ **Pendências declaradas do TJRJ/eJURIS:** o `chkAtivo`/`chkInativo` (situação
do magistrado) é enviado sempre marcado e **não foi medido**; o tipo
**EMENTÁRIO** tem 27 campos próprios em `Ementarios[0]` que **não são expostos**
no resultado; não se mediu **rate limit**; e o **DataJud não foi sondado** para
este módulo. ⏱️ O timebox **não foi estourado**: 16:00 → 16:35, ~35 min no
total. ⚠️ Um tropeço de processo vale registro: a primeira versão deste
parágrafo afirmava "estourou, ~2h" porque eu estimei o relógio em vez de
consultá-lo — **a duração é medição como qualquer outra, e `date` custa o mesmo
que um palpite**. O único atrito real foi o registro da entrada `TJRJ_EJURIS`
na cobertura, que é keyed por tribunal e não previa **módulo** de tribunal:
precisou de upsert sintético, como CARF/TCU já fazem.

## Bloco 5 — Tribunais de Contas Estaduais (13 alvos)

Nenhum sondado ainda. Pedidos pelo usuário: PR, SC, RS, SP, RJ, MG, BA. Os demais fecham
os estados grandes. Domínio costuma ser `.gov.br`, não `.jus.br` — TCE não é Judiciário.

| # | Alvo | UF | Ressalva de escopo | Status |
|---|---|---|---|---|
| 18 | **TCE-PR** | PR | ✅ o PR **não tem TCM** — os 399 municípios estão na base do próprio TCE | ok 14/08 |
| 19 | **TCE-SC** | SC | ✅ SC **não tem TCM** — os 295 municípios estão na base do próprio TCE | ok 14/08 |
| 20 | **TCE-RS** | RS | ✅ o RS **não tem TCM** — os municípios gaúchos estão na base do próprio TCE | ok 15/08 |
| 21 | **TCE-SP** | SP | ⚠️ **não** cobre a capital — SP capital é do **TCM-SP** (**confirmado por medição**) | ok 15/08 |
| 22 | **TCE-RJ** | RJ | ⚠️ capital carioca é do **TCM-RJ** — **confirmado por medição** (o combo traz 91 dos 92 municípios) | ok 16/08 |
| 23 | **TCE-BA** | BA | ⚠️ **todos** os municípios baianos são do **TCM-BA** — **confirmado por ausência de combo de município** (não há filtro por município na tela) | ok 17/08 |
| 24 | **TCE-PE** | PE | | pendente |
| 25 | **TCE-CE** | CE | TCM-CE extinto em 2017 — o TCE absorveu os municípios | pendente |
| 26 | **TCE-GO** | GO | ⚠️ municípios goianos são do **TCM-GO** | pendente |
| 27 | **TCDF** | DF | | pendente |
| 28 | **TCE-PA** | PA | ⚠️ municípios paraenses são do **TCM-PA** | pendente |
| 29 | **TCE-ES** | ES | | pendente |
| 30 | **TCE-MG** | MG | 🔴 o portal que se chama "Jurisprudência" (**TCJuris**) está atrás de **reCAPTCHA v2 conferido no servidor**; a porta aberta é o **MapJuris** (`/TextualDadosProcesso`, sem captcha) — **busca medida, falta o segundo salto do grid e o crawler** | parcial 16/08 |

📌 **O que o TCE-PR (feito em 14/08/2026) ensinou — leia
[`CLAUDE-TCEPR.md`](CLAUDE-TCEPR.md).** Primeiro alvo do Bloco 5 e **primeiro
tribunal de contas estadual do repo**. Fechou 🟢 em ~1 h, e a lição de abertura
do bloco é que **o TCE não é um TJ com outro nome**: o que muda não é só o
acervo, é o que o crawler pode presumir. As lições valem para os 12 restantes:

- 🔴 **A ARMADILHA DECLARADA DO BLOCO 5 NÃO EXISTIA NESTE ALVO — e isso também
  se mede.** A fila avisa "onde existe TCM, buscar contas municipais no TCE
  devolve zero que se lê como não há julgado". **O Paraná não tem TCM**, e a
  prova saiu do próprio formulário: o combo `MUNICIPIO` traz **400 opções**, os
  399 municípios mais o "Selecione". Não foi preciso pesquisar fora do portal.
  **Nos 12 restantes, conte o combo de município antes de escrever a ressalva** —
  ela é verdadeira em SP, RJ, BA, GO e PA, e falsa aqui.
- 🔴 **SEM CNJ E SEM DATAJUD, e as duas ausências são estruturais.** O processo é
  `<sequencial>/<ano>` na numeração própria (`393433/2026`): `src/cnj.js`
  reprovaria todo processo válido. E o DataJud é do CNJ, que cobre o
  **Judiciário** — contas não tem alias `api_publica_*`. Ou seja, **o plano B de
  TJMA/TJRN não existe no Bloco 5 inteiro**: se o portal de um TCE cair, não há
  para onde apelar, e `bloqueado` ali será mão vazia de verdade.
- 🔴 **TERCEIRA CASCA DE HTTP 200 CATALOGADA, e a mais convincente: a TELA DE
  LOGIN.** `/swagger` e `/v1/api-docs` respondem **200 com 8,3 KB** — porque
  **todo path desconhecido do ViaJuris devolve 302 para o SSO**
  (`cia.tce.pr.gov.br/sso?AppKey=…`). Não é vhost curinga (TJAC/TJAL) nem
  `index.html` de SPA (TJES/TJRR): é uma aplicação de verdade, com formulário e
  layout, o que a torna muito mais fácil de confundir com um Swagger real. O que
  desfez foi o de sempre: **`/path-inventado-9z` devolve a mesma coisa**, com
  diff normalizado vazio. E `/api` responde **401 `Token inválido`** com
  `WWW-Authenticate: Negotiate` — Windows Auth interno, não a API (a armadilha
  do `api.tjba.jus.br`, repetida).
- 🔴 **O SELECT DECORATIVO APARECEU DE NOVO, UM DIA DEPOIS — e num fornecedor
  diferente.** Em 13/08 o eJURIS/TJRJ ensinou "o `<select>` era decorativo, quem
  filtra é o hidden". Aqui, num ASP.NET MVC sem nenhum parentesco com o eJURIS,
  `CLASSIFICACAO_DECISAO` devolve **17.563 = a contagem sem filtro** e o hidden
  `CLASSIFICACAO_DECISAO_SELECIONADOS` devolve **2 súmulas / 14 prejulgados /
  253 consultas**. Dois portais seguidos, mesma armadilha: **num formulário com
  widget de multi-seleção, teste o hidden antes do select** — vale como padrão,
  não como coincidência.
- 🔴 **UM SEGUNDO CONTROLE SIMPLESMENTE NÃO FILTRA:** o combo "no campo… /
  EMENTA / TEMA" (`IdCampoPesquisa`) devolve **17.563 nos quatro valores**
  testados, inclusive um **inventado**. Foi o valor inventado que fechou o
  argumento — sem ele, três números iguais ainda admitiriam "o escopo não muda
  para este termo". **O crawler não expõe flag para ele: flag que não filtra
  mente para o usuário**, e pendência declarada é onde o bug se esconde.
- 🔴 **AS DUAS PONTAS DA JANELA DE DATA FALHAM PARA LADOS OPOSTOS.** `-di`
  sozinho **ZERA** (0 registros) e `-df` sozinho é **IGNORADO** (acervo inteiro),
  as duas com HTTP 200. TJRR e TJPI tinham **uma** ponta ignorada; aqui o par é
  **assimétrico**, o que significa que testar uma metade não diz nada sobre a
  outra. **Teste cada ponta em separado, e nos dois sentidos.**
- 🔴 **A TELA ANUNCIA OS OPERADORES QUE NÃO FUNCIONAM.** A legenda impressa é
  `e ou não ( ) * ? ~`, e o medido é o oposto: `ou` e `não` são **ignorados** (a
  busca vira AND — você pede união e recebe interseção, 179 contra 17.763), e
  quem funciona é `OR`/`NOT`, com aritmética exata nos dois
  (379 + 17.563 − 179 = 17.763; 17.563 − 179 = 17.384). E `?`, que a legenda
  oferece, **zera em silêncio**. Terceira vez que a documentação do próprio
  portal está errada (TJPI, TJBA, agora TCE-PR) — **leia a legenda e meça mesmo
  assim.** Nono conjunto de operadores; continua sem herdar.
- 🔴 **O ARQUIVO SERVIDO COMO `application/pdf` NÃO COMEÇA COM `%PDF` — defeito
  novo no repo.** É um **envelope PKCS#7 assinado em DER** (a assinatura digital
  do Tribunal), com o PDF embutido no **offset 57**. O poppler lê assim mesmo,
  mas `buffer.slice(0,4) === '%PDF'` é falso, e um crawler que validasse o
  download pelo magic number rejeitaria **todo** inteiro teor do tribunal,
  reportando "0 baixados" com HTTP 200 em tudo. **Foi o único teste que falhou
  na primeira suíte** — que é exatamente para isso que a suíte serve. Quarta
  casca catalogada, e a mais sutil: aqui o `Content-Type` está **certo** e quem
  tem invólucro é o **corpo**.
- 🔴 **AO COMPARAR TIPOS DE DOCUMENTO, MUDE UMA VARIÁVEL SÓ — eu não mudei, e
  quase gravei a ressalva errada.** Medi acórdão **com** termo livre e súmula,
  prejulgado e consulta **sem** termo (porque o recorte por tipo é filtro), e
  concluí "os outros três tipos não têm inteiro teor". Refeito com termo, os
  quatro têm. O que manda **não é o tipo, é o termo**: o bloco "Inteiro Teor" é o
  *match* do termo no texto, e a medição correta é **100% com termo (50/50,
  14/14, 20/20, 2/2) contra 0% sem termo (0/50, 0/20, 0/20)**. É o avesso do erro
  do TJMG, que mediu um tipo só e generalizou: aqui foram quatro tipos, em dois
  regimes de busca diferentes.
- 🔴 **O BLOCO DE TEXTO DO CARD MISTURA HIGHLIGHT COM DOCUMENTO.** São três
  `<div>`: dois **snippets** de ~595 chars que começam com `...` e trazem o termo
  em amarelo, e o **texto integral** (~15,4 mil). Pegar o primeiro publica
  recorte como inteiro teor; concatenar os três publica o mesmo parágrafo três
  vezes. ✅ E o maior **é** o inteiro teor, conferido contra o PDF por
  `pdftotext`: **0,98 de razão de tamanho e 95% das janelas presentes**.
  ⚠️ **Mas vem fora de ordem** (começa pelo bloco de assinatura), porque é
  remontado por janelas de match — serve para análise, não para leitura fiel.
  **Quando houver PDF, confira o texto do card contra ele: custa um `pdftotext`.**
- 🔴 **O FORMATO QUE A TELA EXIBE NÃO É O QUE O CAMPO ACEITA.** O card mostra
  `Processo: 393433/2026` e mandar isso devolve **0 com HTTP 200**; o campo quer
  o sequencial (`393433`) com o ano à parte. Some à coleção: TJPE só dígitos,
  TJES só máscara, TJPI derruba com 500, TJMT aceita as duas — e o TCE-PR quer o
  número **partido em dois campos**.
- ✅ **Muita coisa aqui está BEM, e medir isso também é o trabalho:** sem captcha
  em etapa nenhuma (provado mandando o POST, não com `grep`); partição por
  colegiado **fecha exata** (10.918 + 3.555 + 3.090 = 17.563); total **exato**
  com a aritmética da última página fechando; paginação **estável 3/3**; zero é
  **zero de verdade** (631 bytes, `var totalRegistros = 0`); **permalink público**
  confirmado em requisição limpa; **citação oficial pronta** no `data-content`
  (nada de regex, o que custou quatro formatos na família e-SAJ); e a base é
  **corrente e funda** (148.490 acórdãos, 1998–2026, sessão mais recente
  05/08/2026). Há ainda um campo **`Tema`** — resumo analítico que **nenhum TJ do
  repo tem**.
- ⚠️ **Existe DADOS ABERTOS oficial de acórdãos** (`/DadosAbertos/DadosAbertos`,
  com dicionário em XLSX, frequência declarada **semanal**), mas é **pacote para
  download em lote, não endpoint de consulta** — não substitui o crawler. E a
  atualização **declarada não bate com a observada** (recurso marcado 05/06/2026
  contra base cuja sessão mais recente é de agosto): **para buscar, o formulário
  está mais fresco que o dado aberto.** Vale sondar o equivalente nos outros TCEs
  antes de decidir a porta.

⚠️ **Pendências declaradas do TCE-PR:** os combos de **referência normativa**
(tipo/emissor/nome/número/ano da lei + artigo/parágrafo/inciso/alínea/item) e de
**precedentes** estão enumerados mas **não foram provados por contagem** nem
expostos como flag; `--classe` (145 opções) e `--municipio` (399) estão expostos
mas **não provados por contagem**; o combo de **ordenação** não foi medido; a
**árvore do tesauro** (`modalArvoreClassificacao`) e a busca por referência a
partir do card **não foram dissecadas**; a **multi-seleção** do hidden de
classificação foi testada **com um valor por vez**; o **rate limit não foi
medido**; e o **dataset de Dados Abertos não foi baixado** nem comparado com a
busca. ⏱️ Timebox **não estourado**: 16:00 → 17:01, ~61 min.


📌 **O que o TCE-SC (feito em 14/08/2026, slot 2000) ensinou — leia
[`CLAUDE-TCESC.md`](CLAUDE-TCESC.md).** Segundo alvo do Bloco 5, fechado 🟢 em
**~25 min** (20:00 → 20:25, contra os 90 do timebox): o crawler do GraphQL estava
verde aos ~19 min e o tempo restante fechou as outras três bases. A lição de abertura é que **o segundo TCE não se parece em nada com o
primeiro**: o TCE-PR era um formulário ASP.NET renderizado no servidor, o TCE-SC
é um GraphQL público atrás de micro-frontends. As lições valem para os 11
restantes:

- 🔴 **O TRIBUNAL PODE TER DOIS DOMÍNIOS OFICIAIS, E O PORTAL ESTAR NO OUTRO.**
  O institucional é `tcesc.tc.br` (Drupal) e os sistemas moram em
  `tce.sc.gov.br`. Sondar `dadosabertos`/`api`/`swagger` **só no institucional**
  devolve NXDOMAIN e 404 em tudo — e a conclusão "não há API" seria falsa: a API
  está no segundo domínio. **Antes de declarar ausência, ache o domínio dos
  sistemas.** O link estava na home institucional, não foi chutado.
- 🔴 **A PORTA SAIU DO BUNDLE, E A INTROSPECÇÃO ENTREGOU O CONTRATO INTEIRO.**
  `importmap.json` → `/mf-jurisprudencia/main.js` → constante `No_API_GATEWAY`
  (a técnica do TJBA). E como a **introspecção do GraphQL está aberta**, os 22
  campos de `JurisprudenciaFiltroInput` foram **lidos do servidor**, incluindo
  dois que a própria tela nunca envia (`exibirParecerMPC`, `exibirInstrucao`).
  **Num GraphQL, peça o schema antes de inferir da tela** — é mais rápido e mais
  completo. ⚠️ Mas a introspecção resumida **não mostra NON_NULL**: `$f` e `$n`
  precisam de `!` e sem ele o servidor recusa. Derrubou 3 testes na 1ª rodada.
- 🔴 **QUINTA CASCA DE HTTP 200, E ELA DERROTA A TÉCNICA DO MD5.**
  `virtual.tce.sc.gov.br` devolve 200 com 5.994 bytes para qualquer path (SPA
  single-spa, caso conhecido do TJES/TJRR) — só que **o Akamai injeta um beacon
  com nonce por requisição**, então **o md5 muda a cada chamada** e comparar md5
  (TJAC/TJAL/TCE-PR) **não desfaz o falso positivo**. O que desfaz é o tamanho
  idêntico. **A ferramenta de detectar casca também tem contraexemplo.**
- 🔴 **O ESPAÇO É `OR` E NÃO EXISTE `AND` — o conjunto de operadores mais pobre
  do repo.** `E`/`OU`/`OR` são **ignorados**; `AND` (9.631), `NOT` (9.493) e
  `NAO` (26.057) viram **palavra e INFLAM**. Só a **frase exata** funciona.
  Provado por aritmética: merenda 497 + escolar 4.774 − união 4.783 = 488, e a
  frase exata dá 446 ≤ 488. Décimo tribunal, décimo conjunto: **continua sem
  herdar, e desta vez o que falta é o operador mais básico.**
- 🔴 **TERMO COM MENOS DE 3 CARACTERES É DESCARTADO E DEVOLVE O ACERVO INTEIRO.**
  `ab` e `de` devolvem os 27.783 do acervo com HTTP 200. A tela anuncia "mínimo 3
  caracteres" e o servidor **não recusa: ignora o termo**. É o **zero-invertido**
  mais perigoso já catalogado — um typo curto não dá zero (que se investiga), dá
  "27.783 resultados" (que se relata). **Teste um termo curto em todo portal
  novo.**
- 🔴 **UM MESMO CAMPO DE DATA PODE EXISTIR EM TRÊS VERSÕES COM COBERTURAS
  OPOSTAS.** Autuação está em **100%** dos documentos (a aritmética
  `início + fim − interseção` fecha exata no total), publicação em ~79% e
  **sessão em ~37%** — filtrar por sessão descarta **63%** sem sintoma. O TJAM
  ensinou a medir a data-sentinela e o TJES a desconfiar do rótulo; aqui a
  novidade é **medir a COBERTURA de cada eixo antes de escolher o default**, e o
  teste é a aritmética das duas pontas contra o total.
- 🔴 **UMA FLAG BOOLEANA PODE NÃO PARTICIONAR A BASE.** `decisaoSingular`
  true (1.787) + false (25.497) = 27.284 contra **27.783**; com termo, 5.864 +
  1.588 = 7.452 contra **9.368**. Os de fora têm o campo **null** e *são*
  decisões singulares — a flag na verdade recorta a aba "Ratificadas por
  Colegiado". **Omitir a flag devolve um SUPERSET que a própria tela nunca
  mostra**: as abas do portal somam **menos** que a API. A invariante do repo
  ganha um terceiro caso: além de "contagem igual = filtro ignorado" (TJPE) e
  "filtro no-op que muda a contagem" (TJES), agora **"partição que não fecha
  porque o complemento é null"**.
- 🔴 **O QUE A TELA CHAMA DE EMENTA É UM SNIPPET DE MATCH.** O campo `ementa`
  volta null na maioria; o texto exibido é `votoTexto`, que **começa no meio da
  frase**. Não é ementa e não é inteiro teor. ✅ Mas a **citação oficial vem
  pronta** (`textoCopiarEmenta`) — 🔴 e ela **rotula `dataDecisao` como
  "Sessão"** num documento cujo `dataSessao` é **null**, e sai quebrada
  (`Decisão n. ,`) quando não há número de decisão. **Nem a citação do próprio
  tribunal é confiável no rótulo.**
- 🔴 **UMA CONSULTA CHAMADA "PorNumero" PODE NÃO TRAZER JULGADO — E DEVOLVER
  ARRAY COM NOME NO SINGULAR.** `pesquisarProcessoPorNumero` devolve **metadados
  do processo** (sigla, assunto, dataEntrada), não os documentos; quem traz os
  julgados é a busca com filtro `numeroProcesso`. E devolve **array**: tratá-lo
  como objeto faz `[]` virar "encontrado", e **número inventado passa como
  válido** — foi um bug real, pego pela suíte. ⚠️ E `numeroProcesso` com valor
  **não-numérico é IGNORADO**, devolvendo o acervo inteiro.
- ✅ **O QUE ESTÁ BEM, e medir isso também é o trabalho:** sem captcha em etapa
  nenhuma; resposta em ~0,7 s; **combos de graça pelo servidor** (205 tipos de
  processo, 35 relatores) e **facetas com contagem** — a pendência dos
  combos-árvore que se repetiu em quatro instalações do e-SAJ **não existe em
  GraphQL**; paginação **estável** (mesma página 2× = mesmos ids, pg1 ∩ pg2 = ∅);
  total **exato**; **PDF público com permalink** confirmado em requisição limpa e
  que **começa com `%PDF`** (o magic number vale aqui — ao contrário do TCE-PR);
  id inventado no storage dá **404 real**; base **corrente e estável**
  (27.783 documentos, mais recente de 03/08/2026, sem o congelamento do TJAM nem
  a defasagem de ponta do TJPI). E **SC não tem TCM**: os 295 municípios estão
  nesta base.
- 🔴 **UM PORTAL PODE TER 5 BASES EM 3 BACKENDS — e a tela entrega essa conta de
  graça.** O "Resumo de Resultados" do TCE-SC lista as cinco abas com a contagem
  de cada uma, e foi ele que denunciou que o GraphQL cobria só duas. **Some as
  abas antes de declarar cobertura.** As cinco estão implementadas em `--base`:
  deliberações + singulares (GraphQL), enunciados (2.564) e informativos (2.045)
  por REST no `cojur`, e súmulas do bundle. ⚠️ **Os dois REST do mesmo tribunal
  usam nomes diferentes para a mesma coisa** (`query`/`size` num,
  `termo`/`per_page` no outro).
- 🔴 **UMA BASE INTEIRA PODE NÃO SER UMA CONSULTA: as SÚMULAS estão HARDCODED no
  JavaScript.** `/cojur/sumula` e variantes dão **404**; o app carrega o array
  `Imt_sumulas` do próprio bundle e filtra **em memória**. São **4 registros e só
  3 documentos distintos** (os ids 1 e 2 são a mesma Súmula TC-003/2021) — a base
  de súmulas inteira do TCE-SC. **Antes de prometer um acervo, confira se ele
  existe no servidor**: aqui o "acervo" cabia num literal, e um crawler que
  fingisse consultá-lo envelheceria com o deploy do portal, não com a base.
- 🔴 **A MESMA REGRA ANUNCIADA VALE DIFERENTE EM CADA BACKEND DO MESMO PORTAL.**
  O mínimo de 3 caracteres é validação **do cliente**: no GraphQL o termo curto é
  **descartado** (devolve o acervo inteiro) e no `prejulgado` ele **é aplicado**
  (`ab` = 289 de 2.564). **Meça a regra em cada backend, não no portal.**
- 🔴 **ENUNCIADO DE CONSULTA TEM VIGÊNCIA, E O REVOGADO CONTINUA NA BASE.** O
  campo `st_valido` diz se o prejulgado ainda está em vigor — e no TCE-SC
  prejulgado tem **força normativa**, então citar um revogado como orientação
  atual é erro de mérito, não de forma. **Num tribunal de contas, procure o campo
  de vigência**: é uma dimensão que os TJs não têm.

⚠️ **Pendências declaradas do TCE-SC:** as **três bases do backend `cojur`** não
foram implementadas; `-r`, `-t` e `-u` estão expostos mas **não provados por
contagem**; `numerosProcessoHibrido`, `identificadorDocumento`, `numeroDecisao` e
`textoRefinamento` **não testados**; **rate limit** e `tamanhoPagina` máximo **não
medidos**; **não se isolou qual parte do acervo tem ementa indexada** (a
abrangência EMENTA acha 874 em `licitação`, logo existe); e a **ordenação** não
foi comparada entre os três valores.

📌 **O que o TCE-RS (feito em 15/08/2026, slot 1600) ensinou — leia
[`CLAUDE-TCERS.md`](CLAUDE-TCERS.md).** Terceiro alvo do Bloco 5, fechado 🟢 em
**~29 min** (16:00 → 16:29). A lição de abertura é que **o terceiro TCE não se
parece com nenhum dos dois anteriores** — TCE-PR era formulário ASP.NET, TCE-SC
era GraphQL, e o TCE-RS é uma **API REST sobre Elasticsearch** atrás de uma SPA
Angular. As lições valem para os 10 restantes:

- 🔴 **HTTP 000 GANHOU UMA TERCEIRA CAUSA, E ELA É DO CERTIFICADO.** O ápice
  `tce.rs.gov.br` devolve 000 e **não está fora do ar**: TCP abre, o **TLS
  completa** (`Verify return code: 0 ok`) e o certificado é `CN =
  *.tce.rs.gov.br` — curinga que cobre `www.` e `portal.` mas **não o ápice**,
  porque curinga casa um rótulo só. TJBA era o servidor derrubando o handshake
  (errno 104); TJPE era o intermediário omitido; aqui é **certificado válido que
  não cobre o host pedido**. **Leia a mensagem de erro do TLS — é ela que separa
  os três casos**, e as três exigem correções diferentes.
  ⚠️ E `www.tce.rs.gov.br` responde 200 com **80 bytes**: um meta-refresh de
  **2010** para a intranet. Quem parar aí conclui que o portal morreu.
- 🔴 **DOIS DOMÍNIOS OFICIAIS, MAS DESTA VEZ O PROTEGIDO É O INSTITUCIONAL.** No
  TCE-SC o institucional era aberto e os sistemas estavam noutro domínio; aqui
  `tcers.tc.br` está atrás de **Cloudflare** (`cf-mitigated: challenge`) e os
  sistemas em `*.tce.rs.gov.br` estão **abertos, sem captcha**. A regra que
  sobrevive aos dois não é "o portal está no domínio X", é **ache o domínio dos
  sistemas antes de declarar ausência**. ✅ E o desafio do Cloudflare **cai
  sozinho no Playwright** (diferente do STJ, que trava no desafio interativo) —
  foi de lá que saiu o link do portal, não de chute.
- 🔴 **A CONFIG DO PRÓPRIO PORTAL DECLARA OS OPERADORES E ERRA EM 100% DELES.** O
  `app.config.json` lista `E OU NÃO ~ PROX MESMO $`. Medido: os cinco em
  português **INFLAM até saturar** (10.000+), `PROX` é ignorado e `$` **zera**;
  quem funciona são os **ingleses**, com aritmética exata (730 + 5.007 − 5.036 =
  **701** = `AND`; 730 − 701 = **29** = `NOT`). Quarta vez que a documentação do
  portal mente (TJPI, TJBA, TCE-PR, TCE-RS) — e a **primeira em que ela erra em
  todos os itens que declara**. ⚠️ Pior: o erro **não zera, infla até o teto**, e
  "10.000+" se lê como tema vastíssimo, não como operador quebrado.
- 🔴 **O TOTAL SE AUTODECLARA EXATO OU SATURADO — inédito no repo.**
  `total.relacao` vem `EQUAL_TO` ou `GREATER_THAN_OR_EQUAL_TO`. TJPE e TJPB
  saturam no mesmo 10.000 **calados**, e em todo alvo anterior a classificação
  "exato × saturado" teve de ser **inferida por medição**. Aqui ela vem no
  payload. **Procure esse campo antes de bisectar o teto na mão.**
- 🔴 **A EMENTA PODE SUMIR A PARTIR DE UM ANO — e é a ressalva mais cara daqui.**
  Medido por ano: 2018 = 99/100 e 2019 = 20/20 **com** ementa; **2020 em diante =
  0/20**. O acervo antigo tem ementa e o recente **não tem nenhuma**, então
  pedido de jurisprudência recente do TCE-RS volta sem ementa e isso **não é
  defeito do crawler**. O TJAM ensinou a medir a **vigência** da base e o TCE-SC
  a medir a **cobertura de cada eixo de data**; aqui a novidade é medir a
  **cobertura da ementa ao longo do tempo** — uma base corrente pode ter parado
  de indexar ementa. ✅ Em compensação o **inteiro teor já vem na busca**
  (`relatorio`, ~12,7 mil chars), **conferido contra o PDF** por `pdftotext`
  (razão 0,94) — é o texto mesmo, não o snippet do TCE-SC nem o texto remontado
  fora de ordem do TCE-PR.
- 🔴 **UM CAMPO CHAMADO `texto` PODE DEGENERAR PARA UMA PALAVRA.** Ele é o
  dispositivo (média 1.139 chars), mas em **11%** vem como "Multa",
  "Provimento", "Conhece". Um crawler que o mapeasse como ementa publicaria
  **"Multa" como ementa do julgado**. Some à coleção de campos que mentem no
  nome (TJBA: `ementa` era o inteiro teor; TJES: "Julg:" era juntada).
- 🔴 **O PLANO B DO BLOCO 5 EXISTE — o TCE-PR estava errado sobre isso.** A
  lição gravada em 14/08 diz que "contas não tem DataJud, logo se o portal cair
  não há para onde apelar". O TCE-RS publica **Dados Abertos em CKAN com API
  funcional** (`dados.tce.rs.gov.br/api/3/action/package_search`), com os
  datasets `decisoes-2022`…`2026`. São metadados (sem ementa), logo não
  substituem o crawler — **mas bastam para o `Checker`**, que é exatamente o
  papel do DataJud nos TJs. **Sonde o CKAN nos 10 TCEs restantes antes de
  declarar que não há plano B.** (Medido, **não implementado**.)
- 🔴 **A JANELA DE DATA QUERIA CHAVES, NÃO O ARRAY `valores` — e a forma errada é
  IGNORADA EM SILÊNCIO.** `{tipo:'data', valores:[de,ate]}` devolve o total sem
  filtro com HTTP 200; a forma certa (`inicio`/`fim`) saiu do `ngModelGroup
  filtros.dt_sessao` **do bundle**, não de tentativa. ✅ E aqui as **duas pontas
  funcionam sozinhas** (o TCE-PR tinha uma zerando e a outra ignorada) e a
  **janela no-op não muda a contagem** (o TJES reprovou nesse teste). ⚠️ Só ISO:
  data brasileira devolve 500, e o crawler converte sozinho.
- 🔴 **O NÚMERO COM MÁSCARA DERRUBA COM HTTP 500, NÃO DEVOLVE ZERO** — a
  armadilha do TJPI repetida noutro portal, porque a barra quebra o parser do
  Elasticsearch. Some à coleção: TJPE só dígitos, TJES só máscara, TJPI derruba,
  TJMT aceita as duas, TCE-PR partido em dois campos, **TCE-RS só dígitos**.
- 🟢 **OS AUTOS INTEIROS SÃO PÚBLICOS — nenhum outro tribunal do repo tem isso.**
  O índice devolve **47 peças** do processo (Capa, Relatório de Auditoria,
  Parecer do MPC, Relatório e Voto, Decisão…), ⚠️ com **19 marcadas
  `publico: false`**. **Pergunte pelo índice de peças nos TCEs restantes** — é
  uma dimensão que os TJs não oferecem.
  ⚠️ O download usa **chave composta e a ordem dos segmentos engana**: o
  `#id_arquivo=` do link é **fragmento** (o servidor nem o vê) e é preciso o
  `idObjetoArquivo` do índice; a ordem invertida devolve 404 — foi o erro
  cometido na primeira tentativa. ✅ O PDF **começa com `%PDF`** (o magic number
  vale aqui, ao contrário do TCE-PR).
- ⚠️ **O ELASTICSEARCH DO TRIBUNAL ESTOURA O CIRCUIT BREAKER SOB CARGA**, com
  HTTP 500 `circuit_breaking_exception: Data too large` — porque cada
  `relatorio` tem ~12 mil chars e a página de 100 os carrega todos. É
  **transitório**. ⚠️ E isso expôs um defeito no meu próprio Navigator: como
  `requisitar()` **resolve** em vez de lançar para status ≠ 200, a retentativa
  nunca disparava; foi preciso tratar 5xx explicitamente. **Retentativa que só
  pega exceção não cobre erro transitório de API que resolve.**
- ⚠️ **O SMOKE PEGOU O QUE OS MEUS TESTES NÃO PEGARAM:** ele manda data em
  **DD/MM/YYYY** (a convenção do repo) e a API só aceita ISO, então o comando
  quebrava com 500 no uso normal enquanto todos os meus testes ISO passavam.
  **Rode o smoke antes de declarar verde** — ele exercita a convenção do repo,
  não a da API.
- ⚠️ **Tropeço de processo, o mesmo de 13/08:** por ~1h eu estimei o relógio em
  vez de consultá-lo e me dei por quase fora do timebox aos **14 minutos**
  reais, chegando a decidir marcar `parcial`. Um `date` desfez. **A duração é
  medição como qualquer outra** — e desta vez o palpite quase custou o crawler,
  não só um parágrafo errado.
- ✅ O RS **não tem TCM** e os municípios estão nesta base — ⚠️ mas aqui **não há
  combo de município** para contar (o campo é texto livre), então a prova foi
  **por contagem no acervo**, não por enumeração como no TCE-PR. **O método de
  provar a cobertura municipal muda conforme o portal.**

⚠️ **Pendências declaradas do TCE-RS:** `-r`, `-t` e `--orgao` estão expostos mas
**não provados por contagem** (só `-oj` foi); a base `*` ("Todas as bases") não
foi testada; `sumulas`/`pareceres`/`informacoes` tiveram só a **contagem**
medida, sem dissecar campos nem card; **não há permalink de busca**, e o de
documento **não foi confirmado em aba limpa de navegador** (só a API por trás);
**falta o print do visualizador aberto** (o Playwright estoura o `networkidle`,
porque o viewer de PDF nunca estabiliza a rede); o teto de página não foi
bisectado entre 500 e 1.000; **rate limit não medido**; a ordenação só foi
testada no default; o card foi dissecado em **um tipo de documento só**, contra
os 2+ que a `browser-post-search` exige; e a lista
`decisoes-temas-area-de-exame` volta **vazia** no servidor, causa não
investigada. ⏱️ Timebox **não estourado**: 16:00 → 16:29, ~29 min.

📌 **O que o TCE-SP (feito em 15/08/2026, slot 2000) ensinou — leia
[`CLAUDE-TCESP.md`](CLAUDE-TCESP.md).** Quarto alvo do Bloco 5, fechado 🟢 em
**~29 min** (20:00 → 20:29). Quatro TCEs, quatro tecnologias diferentes: o
TCE-PR era ASP.NET no servidor, o TCE-SC um GraphQL atrás de micro-frontends, o
TCE-RS uma API REST sobre Elasticsearch, e o **TCE-SP é um Tomcat 8 com Spring
MVC renderizando HTML** — sem SPA, sem JSON, **zero XHR** medido na carga e na
busca. As lições valem para os 9 restantes:

- 🔴 **A ARMADILHA DECLARADA DO BLOCO 5 FINALMENTE É VERDADEIRA — e é a ressalva
  mais cara do alvo.** Em PR, SC e RS a fila avisava sobre o TCM e a medição
  **absolvia** o tribunal (nenhum dos três tem TCM). Em SP ela se confirma: o
  TCE-SP cobre o Estado e os **644 demais municípios**, e **a capital é do
  TCM-SP**, órgão separado que este repo não cobre. ⚠️ E, diferente do TCE-PR,
  **não há combo de município para contar** — o portal não filtra por município,
  então a prova é por contagem no acervo, não por enumeração. **Nos 9 restantes,
  o teste do combo pode não existir: tenha o plano B da contagem.**
- 🔴 **O ENDPOINT É GET E O POST DEVOLVE 405 — e presumi POST por ser formulário
  clássico.** Foi o primeiro erro do dia, e custou uma requisição só porque o
  Tomcat responde `Method Not Allowed` em vez de devolver o formulário.
  **Mande o método que o servidor aceita, não o que o formulário sugere.**
- 🔴 **O MODELO DE OPERADORES PODE NÃO SER INLINE — primeiro portal do repo
  assim, e isso muda a forma da flag, não só o valor dela.** Dez tribunais
  ensinaram "teste cada operador dentro da query"; aqui **não há operador dentro
  da query**: são **quatro caixas** (`txtTdPalvs` = AND, `txtExp` = frase,
  `txtQqUma` = OR, `txtNenhPalvs` = NOT). ✅ E a aritmética **fecha exata nos
  dois sentidos** (17.806 + 89.312 − 16.707 = 90.411 = OR; 17.806 − 16.707 =
  1.099 = NOT): é o conjunto mais bem-comportado já medido no repo.
  🔴 **Mas o inline continua sendo armadilha, e o `OU` é o pior caso**: dentro de
  `-q` ele é **descartado** e a busca **continua AND** — união pedida, interseção
  recebida (16.707 contra 90.411), com número plausível e sem sintoma.
  **Ao achar um portal de N caixas, teste o inline mesmo assim.**
- 🔴 **UM JULGADO PODE DECIDIR VÁRIOS PROCESSOS — o inverso da armadilha
  conhecida, e ele infla o total em ~2,9×.** O repo registrou várias vezes que
  "um processo tem vários julgados" (TJTO, TJRR, TCE-PR). Aqui vale **também o
  contrário**: o acórdão decide processos apensados e a lista devolve **uma linha
  por processo**. Medido: 100 linhas → 84 processos → **35 PDFs**; na 1ª página,
  7 processos apontam para o mesmo PDF. Logo "1.699 registros" **não é 1.699
  acórdãos**. É a repetição do TJBA vista pelo outro lado — lá a API duplicava o
  mesmo documento, aqui a duplicação é **semântica e legítima**.
  **Conte documentos distintos dentro de uma página antes de confiar no total.**
- 🔴 **UM PORTAL PODE NÃO TER EMENTA — e isso se prova nos três lugares.** Não há
  ementa no card, nem na página de detalhe, nem no PDF (o acórdão do TCE-SP abre
  direto em "Representante/Representado/Assunto"). O que existe é **trecho com
  highlight** (~600–1.200 chars contra 4.855 do PDF). Some à coleção: TJBA tinha
  o inteiro teor com nome de ementa, TCE-SC tinha o trecho de match, TCE-RS
  perdia a ementa a partir de 2020 — **e o TCE-SP simplesmente não tem.**
- 🔴 **METADADO QUE A LISTAGEM NÃO TRAZ PODE ESTAR A UM CLIQUE.** Relator e data
  de publicação **não existem** nas 8 colunas da tabela; estão no
  `exibir?proc=`, junto com o Objeto completo (na tabela vem truncado). Um
  mapeamento que parasse na listagem gravaria "o TCE-SP não expõe relator" — e é
  falso. **Antes de declarar campo ausente, abra o detalhe.**
- 🔴 **PROVE UM FILTRO COM MAIS DE UM VALOR — testar um só teria gravado a
  ressalva errada.** `relator=ANTONIO ROQUE CITADINI` + termo devolve **0**,
  idêntico ao valor inventado: lê-se como filtro quebrado. Sem termo, Citadini
  dá **1** e outro relator dá **162.137** — o zero era **real** (ex-conselheiro
  cujo nome aparece no *texto* de milhares de acórdãos, mas com 1 processo como
  relator indexado). Fecha por medição a pendência do TJPI (`-r` provado num
  nome só).
- 🔴 **UM TIPO DE DOCUMENTO PODE NÃO TER METADADO NENHUM.** Súmula e Boletim são
  uma **família editorial**: as 8 colunas vêm **vazias**, o `exibir?proc=` sai em
  branco e o PDF mora em outro host. Quem dissecasse só o Acórdão escreveria um
  crawler que devolve súmula com tudo vazio e não saberia dizer por quê.
- ✅ **NEM TODA MEDIÇÃO CONDENA: as datas aqui são o filtro mais bem-comportado
  do repo.** Dois eixos reais, **as duas metades funcionam sozinhas**, a janela
  no-op **não altera a contagem** e a aritmética fecha (227 + 1.564 − 92 =
  1.699). Passa nos três testes que TJPI/TJRR/TCE-PR e TJES reprovaram. ⚠️ E ISO
  devolve **HTTP 400** — erro honesto, não zero silencioso.
- ✅ **TRÊS PERMALINKS PÚBLICOS, e um deles é a URL DA BUSCA** — que de fato
  **executa** a busca em contexto limpo, com todos os filtros sobrevivendo.
  Isso a separa do **TJPE** (a URL restaura o formulário e mostra zero falso) e
  do **TJTO** (por GET os filtros somem em silêncio). ⚠️ Há `jsessionid` nos
  links de ordenação, mas é decorativo: `offset` funciona sem ele — **não se
  repete a armadilha do `trocaDePagina.do` do TJAC**.
- ⚠️ **PÁGINA FIXA EM 10, com `size`/`limit`/`qtd` ignorados em silêncio**:
  varrer 1.699 resultados custa **170 requisições**. É o portal mais caro por
  documento do Bloco 5 — meça o custo, não só a viabilidade.
- 🔴 **O PASSO 0 AQUI FECHOU PELA NEGATIVA, e isso também é resultado:**
  `dadosabertos.`/`api.tce.sp.gov.br` são NXDOMAIN e todos os paths de API dão
  404 real. **Não há Dados Abertos e não há DataJud** — ou seja, **não existe
  plano B nenhum** para o Checker. Vale a lição **original** do TCE-PR, que o
  TCE-RS tinha contraexemplificado no dia anterior com o CKAN. **O plano B do
  Bloco 5 é por tribunal, não por bloco.**
- ✅ Sem vhost curinga e sem casca de 200 nos **dois** hosts; acervo de
  **1.317.838** documentos (168.766 acórdãos), base de **2008** em diante e
  **corrente**; total **exato** (a última página fecha em 9 de 1.699); paginação
  **estável** 3/3; combos populados no **HTML estático**, sem AJAX (⚠️ mas são
  `select2`: o clicável é o `<span>` irmão, e clicar no `<select>` dá timeout —
  derrubou a primeira rodada de prints).

⚠️ **Pendências declaradas do TCE-SP:** `--auditor` (9 opções) está exposto mas
**não foi provado por contagem**; `--num-ini/--num-fim` ("Números que variam")
filtra (1.148 de 1.699) mas **o que ele casa não foi isolado**; **rate limit não
medido**; a **ordenação** (`campoPulsaOrdem`, 8 colunas) não foi medida; o acervo
total veio de janela de data ampla e **não foi conferido contra a soma dos 14
tipos**; não se mediu se `materia` compõe **multi-valor**; e a regra do caminho
fragmentado do PDF foi **inferida de um exemplo só** (por isso o crawler segue o
redirect em vez de reconstruí-la). ⏱️ Timebox **não estourado**: 20:00 → 20:29,
~29 min.

📌 **O que o TCE-RJ (feito em 16/08/2026, slot 1600) ensinou — leia
[`CLAUDE-TCERJ.md`](CLAUDE-TCERJ.md).** Quinto alvo do Bloco 5, fechado 🟢 em ~25 min. A
porta é uma **API REST pública** (`liana-processo-webapi`) achada na Network, sem auth e
sem captcha em etapa nenhuma. As lições valem para os 8 TCEs restantes:

- 🔴 **NOME DE CAMPO NA RESPOSTA NÃO É NOME DE CAMPO NO FILTRO — regra nova, e a
  descoberta mais transferível do dia.** O filtro de relator do TCE-RJ chama-se
  **`conselheiro`** (342 de 1.089). Mandar **`relator`** devolve **1.089** — a contagem
  sem filtro — e o mesmo acontece com `relatorNome`, `relatorId`, `nomeRelator`,
  `relatores` e `relatorVencedor`. O engano é completo porque **`relator` EXISTE no
  payload de resposta de cada documento**: o nome óbvio está lá, e como *filtro* é
  descartado sem erro. Quem lesse o JSON de saída para descobrir o nome do parâmetro
  erraria com confiança. **O controle é o valor inventado** (`relator` inventado também
  devolve 1.089), que separa "ignorado" de "campo certo, valor errado".
- 🔴 **QUARTO MODO DE OPERADOR QUEBRADO: O QUE DEFLACIONA.** O botão `NÃO` existe na tela,
  insere o token — e **não exclui**: vira palavra e entra no AND.
  `licitação NÃO <termo inexistente>` = **0** (a exclusão daria 267 — é a prova), e
  `licitação NÃO pessoal` = **5** contra os 260 da exclusão correta. O repo já catalogara
  operador que **zera** (TJMS), que **infla** (TJBA/TJES/TJTO) e que é **ignorado**
  (TJMT); este deflaciona para um número **pequeno e plausível**, e 5 resultados se leem
  como "busca específica", não como defeito. ✅ Em compensação `E` e `OU` funcionam com
  aritmética **exata** (267 + 180 − 7 = 440) e `AND`/`OR` devolvem **HTTP 500** — erro
  visível, que é a melhor forma de um operador falhar.
- 🔴 **QUINTA CASCA DE HTTP 200: PÁGINA DE ERRO 404 SERVIDA COM STATUS 200.**
  `/swagger/index.html` responde **200 com 571 bytes** cujo corpo é literalmente
  `<h1>Erro HTTP 404</h1>`. Não é vhost curinga (TJAC/TJAL), nem `index.html` de SPA
  (TJES/TJRR), nem tela de login (TCE-PR): é uma página de erro que **mente no status**.
  Conferir `resp.ok` registraria "o TCE-RJ tem Swagger". **Leia o corpo antes do 200.**
- 🔴 **A ARMADILHA DO TCM É VERDADEIRA AQUI — e a prova saiu do próprio portal.** O combo
  de município traz **93 opções** = "Selecione" + "ESTADO DO RIO DE JANEIRO" + **91
  municípios**, e o RJ tem **92**: a única ausente é a **capital**, que é do TCM-RJ.
  Diferente do TCE-SP, onde não havia combo e a prova teve de sair da contagem no acervo,
  aqui bastou **contar o combo**, como no TCE-PR. **Conte o combo antes de escrever a
  ressalva** — nos dois sentidos.
- 🔴 **UM PORTAL DE TCE PODE TER UMA BASE CURADA DISFARÇADA DE ACERVO.** A "Jurisprudência
  Selecionada" tem **1.089 documentos** — é a seleção do Serviço de Jurisprudência, não o
  acervo de decisões do tribunal. O acervo grande é a **Pesquisa Textual**, que é busca
  **processual sem ementa** (item = processo, `numeroAcordao` null, texto atrás de um
  segundo salto não mapeado). **Meça o tamanho e a natureza da base antes de anunciá-la**:
  relatar 1.089 como "a jurisprudência do TCE-RJ" seria falso, e mapear só a base grande
  teria entregado contagem sem ementa.
- ⚠️ **E ELA ESTAVA DENTRO DE UM IFRAME**: `/consulta-processo/PesquisaTextual` é
  invólucro sem `<form>` nenhum, e a busca real mora em `/pesquisa-textual/app`. Quem
  raspasse a página de entrada concluiria que o TCE-RJ não tem busca textual — a armadilha
  do TJSE, repetida noutro fornecedor.
- ⚠️ **O DOMÍNIO OFICIAL É `.tc.br`, NÃO `.gov.br`**: `www.tce.rj.gov.br` **redireciona**
  para `www.tcerj.tc.br`, e `tce.rj.gov.br` **sem `www`** resolve para outro IP e dá
  **HTTP 000 por timeout**. Some à coleção "000 não é portal fora do ar" (TJPE) — aqui o
  000 é de um **host irmão** enquanto o oficial responde normalmente.
- 🔴 **NÃO EXISTE FILTRO POR NÚMERO DE PROCESSO**, e todos os campos plausíveis são
  ignorados (1.089 nas duas formas do número e com valor inventado). ✅ O contorno é
  recortar no **cliente**, e só é barato por causa de **outra** medição: **não há teto de
  `tamanhoPagina`** — o acervo inteiro vem numa requisição. **Duas medições que sozinhas
  não valeriam nada se combinam num contorno.**
  ⚠️ E a negativa do `-n` **não prova que o processo não existe**: em base curada ela
  prova só que não há julgado *selecionado*. O Checker devolve essa ressalva junto.
- ⚠️ **O SMOKE PRECISOU DE TERMO PRÓPRIO, e isso é achado, não gambiarra:** `dano moral`
  é **0** em toda a base (`moral` = 0), porque controle externo não tem essa matéria —
  enquanto `licitação` = 267. Sem override, o smoke marcaria **regressão num crawler
  saudável**, que é o pior defeito possível num teste de fumaça: ensinar a ignorá-lo.
  Ficou um `TERMO_POR_COMANDO` em `tests/smoke.js` com a regra de entrada explícita
  (só com o zero **provado**). ⚠️ TCE-PR e TCE-SP passam com o termo padrão e **não**
  entraram na lista.
- ✅ **Muita coisa está bem, e medir isso também é o trabalho:** ementa **íntegra na
  busca** em **100%** dos documentos (1.089/1.089, medido no acervo inteiro); total
  **exato**; paginação **estável 3/3**; as **duas pontas** da data funcionam sozinhas e a
  janela **no-op** não altera a contagem (nem o `-di` que zera do TCE-PR, nem o no-op que
  derruba 42% do TJES); **permalink público em PDF** por acórdão, com **`%PDF` de
  verdade** (não se repetiu o envelope PKCS#7 do TCE-PR) e **404 real** para número
  inventado; base **corrente** (2021 → 22/06/2026).
- ⚠️ **Duas granularidades para o mesmo julgado:** 1.089 registros em **998 processos**, e
  os ids **1162 e 1163 são teses distintas do MESMO acórdão** — logo do mesmo PDF. O
  permalink é por **acórdão**, o registro é por **tese**. Não conte PDFs como julgados.

⚠️ **Pendências declaradas do TCE-RJ:** a **Pesquisa Textual não foi implementada** (o
segundo salto `idDocumento` → texto não foi mapeado, e a saturação em 10.000 não foi
confirmada com termo raro); o combo **Temas** filtra mas não foi enumerado;
`RelatoresVencedores` não foi medido como filtro; o PDF **não foi conferido** contra a
ementa por `pdftotext`; rate limit não medido. ⏱️ Timebox **não estourado**: 16:00 →
16:26, ~26 min. ⚠️ **Dois tropeços de processo valem registro.** (1) Perdi tempo achando
que estava em 17:12 quando eram 16:15, porque **estimei o relógio em vez de consultá-lo** —
exatamente o erro que o TJRJ/eJURIS já havia registrado em 13/08, e que quase me fez
marcar `parcial` com 75 minutos de sobra. `date` custa o mesmo que um palpite; **rode-o**.
(2) Um `cd` que falhou fez um heredoc não executar, e copiei um `/tmp/map1.js` **antigo do
TCE-PR**, que sobrescreveu `human-codegen/TCEPR/01-viajuris/01-xhr-carga.json` — restaurado
com `git checkout` do arquivo. **Scratch em `/tmp` com nome genérico é reincidência
esperando acontecer**: use `/tmp/<tribunal>/`.

⚠️ **Achado fora do alvo, para o próximo slot:** o **TCE-RS está com o smoke VERMELHO** —
`node tests/smoke.js tcers` devolve `HTTP 500 na busca (jurisprudencia-decisoes)`. Não foi
tocado (não era o alvo do dia); é candidato a `fixer`.

**Armadilha do bloco 5:** onde existe TCM, buscar "contas municipais" no TCE devolve zero
que se lê como "não há julgado". Ao documentar o TCE, escreva explicitamente o que ele
**não** cobre e aponte o TCM correspondente.
✅ **Medida até agora:** falsa em **PR, SC e RS** (não têm TCM), **verdadeira em SP**
(a capital é do TCM-SP) e **verdadeira no RJ** (a capital é do TCM-RJ, provado por
contagem no combo: 91 dos 92 municípios). Faltam medir BA, GO e PA, onde a fila também
a declara.

---

## Fora da fila automática

| Alvo | Por que não entra | O que destrava |
|---|---|---|
| **CRPS** | 🔴 Login Gov.br na porta. Medido 31/07/2026: portal **ServiceNow**; `/jurisprudencia` headless mostra só "Entrar com gov.br" (zero inputs); `/api/now/table/*` → **401**. O 200 de 27/07 era a tela de login. **O contorno por perfil de Chrome dedicado foi tentado no mesmo dia e FALHOU**: captcha no Gov.br + recusa por navegador desconhecido | Só resta **CDP contra o Chrome pessoal já logado** (não testado) — operação assistida, nunca cron. Ver `CLAUDE-CRPS.md`. **Não re-tente o perfil dedicado** |
| **STJ** | 🔴 Desafio interativo do Cloudflare desde 27/07/2026 | O desafio cair. Reteste em `CLAUDE-STJ.md` |
| **TJSP / TJMA** | 🔴 captcha | ver docs |
| **TRF1 / TRF3** | 🟡 já têm crawler, instáveis | manutenção, não mapeamento |
| Súmulas/Enunciados CRPS | Público, mas é **PDF único** (nº 1 a 19, atualizado 23/07/2026) no gov.br — não é base pesquisável | Vira crawler só se o usuário pedir |

---

📌 **O que o TCE-MG (16/08/2026, slot 20:00) ensinou — `parcial`, leia
[`human-codegen/TCEMG/`](human-codegen/TCEMG/).** Sexto alvo do Bloco 5, e a lição é que
**o portal que se chama "Jurisprudência" pode ser o bloqueado enquanto o aberto tem outro
nome — e os dois são oficiais, do mesmo órgão, linkados na mesma home**:

- 🔴 **O TCJuris (`tcjuris.tce.mg.gov.br`), rotulado "Jurisprudência do TCE", está atrás de
  reCAPTCHA v2 CONFERIDO NO SERVIDOR.** Não é gate de tela: com **sessão ASP.NET viva** e o
  POST disparado **de dentro da própria página**, `/Home/Busca` devolve **HTTP 200 com a
  página "Ocorreu um erro..."** (5.392 bytes) em vez do grid, e
  `VerificarCaptchaPreenchido` responde corpo **vazio**. A lição do TJSE (mandar a
  requisição, não fazer `grep`) foi aplicada e **condenou** o módulo. Quinto tipo de
  bloqueio do repo: não é script barrado (TJPB), nem negação de borda (TJRN), nem desafio
  visível (STJ), nem widget que não emite token (TJSE) — é **flag de captcha em sessão de
  servidor**.
- 🔴 **MAS O TRIBUNAL NÃO É `bloqueado`: o MapJuris (`mapjuris.tce.mg.gov.br`) responde
  busca textual com ZERO ocorrências de captcha no HTML**, e o contrato foi reproduzido
  **fora do browser** com cookie jar (`POST /TextualDadosProcesso/_ListarExcertoIntegra`).
  É o TJBA ("o e-SAJ morto não era a porta") com variação nova — aqui as duas portas são
  oficiais e vizinhas. **Enumere TODOS os módulos antes de declarar bloqueado.**
- 🔴 **HTTP 000 POR CADEIA TLS INCOMPLETA, E AGORA VARIANDO POR HOST DENTRO DO MESMO
  TRIBUNAL.** `tcjuris`, `mapjuris` e `dadosabertos` dão **000** com verificação ligada e
  **200** com `-k`; o `www.tce.mg.gov.br` dá **200** normalmente — **mesmo certificado
  curinga `*.tce.mg.gov.br`**, só que o `www` manda o intermediário Sectigo e os outros
  três **não mandam**. Quem medisse o institucional concluiria que o TLS do tribunal está
  bom. ✅ A correção é a do TJPE: **fornecer o intermediário** (AIA
  `crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt`), **não** desligar a
  verificação — provado, 000 → 200.
- 🔴 **O FORMULÁRIO TRANSLITERA CARACTERES ANTES DE ENVIAR — contrato inédito no repo.** No
  TCJuris, `"` vira `◕`, `%` vira `☻`, `(` vira `↑` e `)` vira `↓` (em `Decisoes.js`, antes
  do POST). Um crawler que mandasse aspas cruas não estaria falando a língua do portal.
- 🔴 **O TERMO SOZINHO NÃO BUSCA, E O SINTOMA É NENHUM:** sem marcar ao menos uma
  "restrição" (Ementa / Inteiro teor / Indexação), `BuscaRegistros()` retorna **sem emitir
  requisição**. A primeira tentativa deste mapeamento "buscou" e não gerou XHR nenhum.
  ⚠️ E os checkboxes nascem `disabled`, habilitando só no **`keyup`** — `page.fill()` não
  os destrava, `page.type()` sim.
- 🔴 **PREENCHER O NÚMERO DO PROCESSO APAGA TODOS OS OUTROS FILTROS** (`LimparFormulario()`)
  **e força monocrática**. Some à coleção de contratos de consulta por número; e o
  `maxlength=10` confirma que não é CNJ.
- 🔴 **NO MAPJURIS OS TRÊS `tipoPesquisa` VÁLIDOS DEVOLVEM RESPOSTA BYTE A BYTE IDÊNTICA**
  (mesmo md5), enquanto o valor **inventado** devolve "Nenhum registro encontrado". A
  invariante do repo disparou: entre valores válidos o filtro **não muda nada**. ⚠️ Não foi
  decidido se é parâmetro ignorado ou janela pequena demais — falta o segundo salto do grid.
- ⚠️ **TERMO COMUM SEM JANELA DE DATA NÃO RESPONDE EM 180 s** (`licitação` abortado), e o
  mesmo termo com janela de um mês responde em **1,7 s**. O crawler terá de fatiar por data
  obrigatoriamente. Isso também explica busca que "trava" e não é bloqueio.
- ⚠️ **O WAF F5 BIG-IP responde diferente conforme o cliente:**
  `VerificarCaptchaPreenchido` e `RetornarRelatores` dão **403 "Request Rejected — Support
  ID"** no `curl` e **200** dentro do navegador, enquanto `_ListarExcertoIntegra` passa nos
  dois. **São dois mecanismos distintos (WAF × captcha) — não confunda um com o outro.**
- ✅ **Passo 0 medido, e o Dados Abertos NÃO serve:** `api`/`jurisprudencia`/`consulta` são
  NXDOMAIN; `dadosabertos.tce.mg.gov.br` existe (SPA Angular) mas seu backend é um
  **gateway WSO2** que devolve **401 em tudo, inclusive no path inventado** — negação
  uniforme, de onde não se conclui nem se há dataset de jurisprudência (a armadilha do
  `api.tjba`, terceira vez). Sem DataJud e sem CNJ, **não há plano B**.

⚠️ **Pendências declaradas do TCE-MG** (o próximo slot retoma daqui, **sem remapear**): o
segundo salto do grid — `TextualDadosProcesso/ConsultarInformacaoExcertoIntegra` — **não foi
mapeado**, e é ele que traz as linhas; a **Fase 3b (`browser-post-search`) não foi executada**
(não há anatomia de card, paginação, total, permalink nem inteiro teor); **nenhum operador foi
testado** em nenhum dos dois módulos; `_ListarTituloResenha` (teses/súmulas) está com contrato
capturado e **não medido**; o filtro de relator **não foi provado por contagem**; a
distribuição por ano **não foi medida**; e a ressalva do Bloco 5 — MG **não tem TCM** — segue
**não confirmada por medição** (não há combo de município na tela mapeada). ⏱️ Timebox
estourado: 20:00 → 21:20 com a busca respondendo e nenhum crawler escrito.

📌 **O que o TCE-BA (17/08/2026, slot 16:00) ensinou — 🟢 fechado, leia
[`CLAUDE-TCEBA.md`](CLAUDE-TCEBA.md).** Sétimo alvo do Bloco 5, fechado em ~35 min, e a
lição de abertura é que **o endpoint pode estar escrito no HTML da própria página** — o
Passo 0 mais barato do repo até agora. As lições valem para os 6 TCEs restantes:

- 🔴 **O BACKEND ESTAVA NUM `<input type="hidden">` DA PÁGINA.** `/jurisprudencia/consulta`
  traz `<input id="servidorRest" value="https://proinfo.tce.ba.gov.br/rest3">`, e quatro
  arquivos JS do portal (`ProInfoJulgamento.js`, `ProInfoProtocolo.js`, `ProInfoClient.js`,
  `jurisprudencias.js`) montam a URL inteira — **inclusive o header literal
  `Authorization: No Authorization`** e a lista ordenada dos 13 parâmetros. Não foi preciso
  abrir o DevTools para achar a API, só **ler o HTML e os `<script src>`**. Some ao TJBA
  (endpoint no bundle webpack): **antes de farejar a Network, leia o fonte da tela.**
- 🔴 **`qtRegistros` NÃO É TAMANHO DE PÁGINA — É UM LIMIAR QUE RECUSA. Contrato inédito no
  repo, e o modo de falhar é o pior possível: HTTP 400 com ZERO documento.** O portal manda
  200; acima disso o servidor responde `NegocioException: "A sua pesquisa retornou mais de
  200 ocorrências"` e **não devolve nada** — não uma primeira página, não um truncamento.
  **E o número da mensagem ECOA o valor pedido** (`qtRegistros=1000` → "mais de 1000"), o
  que prova que o teto é escolha do CLIENTE: `licitação` dá 400 com 200 e devolve **1.879**
  com 2000, 5000 e 20000. ✅ Total **exato**, não saturado. **Não existe paginação nenhuma**
  (a que o usuário vê é jPages no cliente). O crawler levanta o teto e, se ainda estourar,
  **fatia por ano** — e avisa quais anos ficaram de fora, porque aí a contagem é incompleta.
- 🔴 **O TERMO É UMA FRASE LITERAL: NÃO HÁ OPERADOR E O ESPAÇO NÃO É CONECTIVO.** Décimo
  segundo conjunto de operadores do repo, e o **primeiro sem conectivo nenhum**: `E`, `AND`,
  `OU`, `OR`, `NAO`, `NOT` e o espaço puro **zeram todos** (`nepotismo súmula` = 0). ✅ Mas
  `de nepotismo` = 4 e `prática de nepotismo` = 2 — **duas palavras funcionam quando são
  sequência real do texto**. A diferença não é o número de palavras, é se aquela sequência
  existe. **O zero de `nepotismo súmula` não é ausência de jurisprudência sobre os dois
  temas.** ⚠️ E as **aspas**, que em todo outro tribunal são o recurso que sobra quando os
  operadores falham, aqui são a única coisa que produz **HTTP 500**.
- ✅ **UM PAR DE MEDIÇÕES DECIDIU O CURINGA, onde uma sozinha teria mentido.** `nepotism*`
  = 7 é idêntico a `nepotismo` = 7 — lido sozinho, isso se lê como "`*` é ignorado". O que
  decide é a terceira medição: **`nepotism` = 0**. Prefixo truncado não casa (logo não é
  substring, é palavra inteira) e o `*` recupera exatamente o que o truncamento perdeu.
  **Quando duas hipóteses dão o mesmo número, meça a terceira.** ⚠️ O `$` zera.
- 🔴 **A EMENTA DEPENDE DO TIPO, E O TIPO DOMINANTE É O QUE NÃO TEM** — a lição do TJMG,
  medida em 1.879 documentos: **Voto é 66% do acervo e tem ementa em 0%** (4 de 1.248),
  contra Acórdão 92%, Resolução 77% e resoluções de Câmara 100%; total 28%. Quem dissecasse
  só o default registraria "o TCE-BA não tem ementa" e erraria em três tipos. **Para ementa,
  peça `-t ACRDO`.** ✅ O `resumoExibicao` é o **texto integral** e já vem na busca —
  conferido contra o PDF por `pdftotext` (13.972 chars × 15.001; a diferença é mobília de
  página). Não é ementa e não pode ser apresentado como tal.
- 🔴 **A CONSULTA POR NÚMERO CASA POR SUBSTRING, com sintoma plausível.** `numeroProtocolo=405`
  + ano devolve **6** documentos, arrastando `TCE/003405/2025` e `TCE/004050/2025`; sem ano,
  `000405` casa **13** processos de 2001, 2002, 2004… Tudo HTTP 200 com cards válidos. ✅ O
  valor inventado (999999 → 0) é o controle que prova que o campo é honrado e não ignorado.
  O Checker normaliza para 6 dígitos **e confere no cliente**, avisando quanto descartou.
- ⚠️ **AQUI O TESTE DO VALOR INVENTADO NÃO DECIDE — ao contrário do TJMT.** Em
  `listaIdTipoDecisao`, `XXINVENTADOXX` devolve **0**, exatamente como um tipo **válido
  porém ausente** (`ACRDO` = 0 em `nepotismo`). O controle que separa "ignorado" de "certo
  mas vazio" **falha neste parâmetro**; funcionou em `idColegiado`, `idRelator` e `anoDecisao`.
  **O controle é bom, mas não é universal — confira se ele discrimina antes de confiar nele.**
- 🔴 **CADEIA TLS INCOMPLETA DE NOVO, MESMA CA DO TCE-MG, UM DIA DEPOIS.** `proinfo` manda
  só a folha (`*.tce.ba.gov.br`, Sectigo OV R36) e omite o intermediário → HTTP 000, que se
  lê como portal fora do ar. ⚠️ E o `www.tce.ba.gov.br`, **com o mesmo certificado curinga**,
  responde 200 porque manda o intermediário. Medido em camadas (DNS 2 IPs → TCP abre → TLS
  quebra). ✅ Correção do TJPE: **fornecer o intermediário pelo AIA**, `rejectUnauthorized`
  ligado. **Dois tribunais seguidos com o mesmo defeito e a mesma CA — vale checar o AIA
  antes de medir qualquer TCE.**
- ⚠️ **O NOME DE ARQUIVO DO SERVIDOR NÃO IDENTIFICA O DOCUMENTO, e isso quase virou bug.**
  Numa única busca o `content-disposition` devolveu `VOTO - Copia.pdf`, `resolucao 021.pdf`,
  `TCE0048742016_VOTO.pdf` e `TCE_000405_2025 (VOTO).pdf`. Gravar por esse nome faz dois
  documentos colidirem e um **sobrescrever o outro em silêncio** — o crawler prefixa com o
  `idDocumentoDecisao`. **Nome que o servidor sugere não é chave.**
- ⚠️ **O SCHEMA É HETEROGÊNEO:** a união das chaves em 7 documentos dá 15 campos e **nenhum
  registro tem os 15** (`resumoDocumento`, `numeroDocumento` e `anoDocumento` só em parte).
  Quem lesse o primeiro registro e fixasse o schema perderia campos.
- 🔴 **Sem permalink de documento** (o acesso é **POST**, não há URL colável) e o permalink
  de **busca existe pela metade**: `?termo=` dispara a busca, mas **nenhum outro filtro entra
  pela URL** — mandá-lo como prova omite o recorte em silêncio (armadilha do TJTO).
  Quem identifica o julgado é o `id`: **1.879 documentos em 1.348 processos**.
- 🔴 **Não existe filtro de data, nem data de publicação** — só combos de **ano** (2001–2026).
  A data da sessão é real e **não é filtrável**. ✅ Base **corrente** (documento de 06/08/2026).
- ✅ **Sem captcha em etapa nenhuma** (busca e download medidos em separado), **sem vhost
  curinga** (todos os subdomínios NXDOMAIN) e ✅ **paginação estável** apesar dos dois IPs.
  🔴 Mas **sem CNJ e sem DataJud**: não há plano B, como em todo o Bloco 5 menos o TCE-RS.

⚠️ **Pendências declaradas do TCE-BA:** `idNatureza` (34 opções enumeradas), `anoProtocolo`
e `anoExercicio` **não foram provados por contagem**; `nomeOrgaoUnidade`, `numeroDecisao` e
`resumoDocumento` **como filtro de entrada** existem no cliente JS e não foram testados; o
curinga foi provado em **um par** e não se testou curinga no meio da palavra; a ressalva
TCM-BA apoia-se na **ausência do combo de município**, não numa medição do acervo municipal;
**rate limit não medido** e não se sabe se os dois IPs dessincronizam; os **47 documentos sem
data** da amostra não foram investigados. ⏱️ Timebox **não estourado**: 16:00 → 16:36, ~36 min.
