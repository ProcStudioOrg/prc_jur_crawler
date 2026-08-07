# jur — Brazilian Courts Jurisprudence Crawler

> # 🚨 ALERTA ATIVO — LEIA ANTES DE QUALQUER BUSCA
>
> ## O `stj` ESTÁ BLOQUEADO. NÃO RODE `jur stj`. (desde 27/07/2026)
>
> O SCON entrou atrás de um **desafio interativo do Cloudflare**. Medido em
> 27/07/2026: `scon.stj.jus.br` e `processo.stj.jus.br` devolvem **HTTP 403** com
> o header `cf-mitigated: challenge`, e no Playwright a página trava em
> "Just a moment… / **responda ao desafio abaixo**" — não é mais a verificação
> automática que passava sozinha. **Este repo não automatiza captcha.**
>
> **O que fazer quando o usuário pedir jurisprudência do STJ:**
> 1. **Diga que o STJ está inacessível hoje** e por quê. Não rode o comando para
>    "tentar mesmo assim" — ele gasta 10 tentativas e devolve
>    `Target page, context or browser has been closed`.
> 2. **NÃO EXISTE SUBSTITUTO PARA O STJ.** Ele é a corte que uniformiza a lei
>    federal infraconstitucional; nenhum TJ ou TRF ocupa esse lugar. Ofereça o
>    tribunal local (`trf*`/`tj*`) **dizendo explicitamente que é jurisprudência
>    de instância inferior** e que a orientação do STJ não pôde ser conferida.
>    Para matéria **constitucional**, o `stf` continua 🟢 e é o caminho certo.
> 3. **NÃO CITE JULGADO DO STJ DE MEMÓRIA.** O `verificador` também não consegue
>    confirmar nada no STJ enquanto o bloqueio durar — logo, qualquer REsp que
>    você "lembre" é não verificável e não entra na resposta. Esta é a invariante
>    nº 1 do repo e o bloqueio não a suspende, a torna mais séria.
>
> Diagnóstico e reteste: [`CLAUDE-STJ.md`](CLAUDE-STJ.md). Se o desafio cair,
> reverta o status aqui, em `skills/browser/SKILL.md` e em `cobertura/build.js`.

CLI para buscar jurisprudência nos tribunais brasileiros, construída com Playwright.

**Antes de qualquer busca, use a skill [`browser`](skills/browser/SKILL.md).**
Pedido vago? Passe primeiro pela skill [`improve-user-prompt`](skills/improve-user-prompt/SKILL.md).
Nunca cite um julgado sem a skill [`verificador`](skills/verificador/SKILL.md).

| Documento | Para que |
|---|---|
| **este arquivo** | Roteamento: qual tribunal, qual doc, quais flags comuns |
| [`CLAUDE-CJF.md`](CLAUDE-CJF.md) | Os portais do CJF (TRF1, TNU, Unificada) e **por que a Unificada não salva o STJ bloqueado** |
| [`CLAUDE-CODEGEN.md`](CLAUDE-CODEGEN.md) | Como mapear um tribunal **novo** (processo completo) |
| [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md) | Os 61 tribunais catalogados e o status de cada um |
| [`TODO.md`](TODO.md) | Próximos alvos: TJs restantes + **instâncias administrativas** (CARF, CRPS, TCEs) |
| `CLAUDE-<TRIBUNAL>.md` | Flags específicas e **ressalvas** de um tribunal |
| [`skills/README.md`](skills/README.md) | As 6 skills e quando usar cada uma |

## Roteamento — qual tribunal / qual doc

Escolha o tribunal pelo pedido do usuário e **leia o doc do tribunal** antes de montar o comando.
Cada doc traz as flags específicas, exemplos e ressalvas daquele tribunal.

| Comando | Tribunal | Escopo (estados) | Doc | Status |
|---------|----------|------------------|-----|--------|
| `trf1` | TRF 1ª Região | DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO | `CLAUDE-TRF1.md` | 🟡 no ar, mas a **base congelou em 31/07/2025** |
| `trf2` | TRF 2ª Região | RJ, ES | `CLAUDE-TRF2.md` | 🟢 OK (HTTP direto, sem browser) |
| `trf3` | TRF 3ª Região | SP, MS | `CLAUDE-TRF3.md` | 🟡 instável (restrição de navegador) |
| `trf4` | TRF 4ª Região | RS, SC, PR | `CLAUDE-TRF4.md` | 🟢 OK (com Checker: `-n`, `--verificar`, `--datajud`) |
| `trf5` | TRF 5ª Região | AL, CE, PB, PE, RN, SE | `CLAUDE-TRF5.md` | 🟢 OK |
| `trf6` | TRF 6ª Região | MG | `CLAUDE-TRF6.md` | 🟢 OK (HTTP direto, sem browser) — base **só a partir de 2023** |
| `stf`  | **Supremo Tribunal Federal** | Nacional (constitucional) | `CLAUDE-STF.md` | 🟢 OK (API direta; browser só p/ o token do WAF) |
| `stj`  | **Superior Tribunal de Justiça** | Nacional (lei federal infraconstitucional) | `CLAUDE-STJ.md` | 🔴 **BLOQUEADO — não rodar** (desafio interativo do Cloudflare desde 27/07/2026; ver alerta no topo) |
| `tcu`  | Tribunal de Contas da União | Federal (acórdãos) | `CLAUDE-TCU.md` | 🟢 OK |
| `carf` | **CARF** (Receita Federal — contencioso administrativo tributário) | Federal (acórdãos e resoluções do PAF) | `CLAUDE-CARF.md` | 🟢 OK (API direta, sem browser — Solr público; **inteiro teor já vem na busca**) |
| `crps` | **CRPS** (contencioso administrativo **previdenciário** — INSS) | Federal (Juntas de Recursos e Câmaras de Julgamento) | `CLAUDE-CRPS.md` | 🔴 **sem busca** — login Gov.br; contorno por perfil dedicado **tentado e falhou** (captcha + navegador não validado) |
| `tjac` | TJ do Acre | AC | `CLAUDE-TJAC.md` | 🟡 **busca 🟢 OK** (HTTP direto, sem browser — e-SAJ cjsg); **inteiro teor 🔴 reCAPTCHA** e **sem permalink**. A ementa íntegra vem na busca |
| `tjal` | TJ de Alagoas | AL | `CLAUDE-TJAL.md` | 🟡 **busca 🟢 OK** (HTTP direto, sem browser — e-SAJ cjsg), **base corrente**; inteiro teor 🔴 reCAPTCHA e **sem permalink**. A ementa íntegra vem na busca |
| `tjba` | TJ da Bahia | BA | `CLAUDE-TJBA.md` | 🟢 OK (GraphQL público, HTTP direto, sem browser — **sem captcha**; o **inteiro teor já vem na busca**). Base corrente, cobre Projudi + PJe |
| `tjam` | TJ do Amazonas | AM | `CLAUDE-TJAM.md` | 🟡 **busca 🟢 OK** (HTTP direto, sem browser — e-SAJ cjsg), mas a **base congelou em jan/2025**; inteiro teor 🔴 reCAPTCHA e **sem permalink**. A ementa íntegra vem na busca |
| `tjce` | TJ do Ceará | CE | `CLAUDE-TJCE.md` | 🟢 OK (API direta, sem browser — SJURIS, **SAJ + PJe juntos**; **não** use o e-SAJ) |
| `tjdft` | TJ do DF e Territórios | DF | `CLAUDE-TJDFT.md` | 🟢 OK (**API pública oficial**, sem browser) |
| `tjgo` | TJ de Goiás | GO | `CLAUDE-TJGO.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjma` | TJ do Maranhão | MA | `CLAUDE-TJMA.md` | 🔴 busca **bloqueada por captcha**; só `-n` (nº do processo, via DataJud) |
| `tjmg` | TJ de Minas Gerais | MG | `CLAUDE-TJMG.md` | 🟢 OK (API direta, sem browser — Consulta Unificada; **não** use o `www5`) |
| `tjms` | TJ de Mato Grosso do Sul | MS | `CLAUDE-TJMS.md` | 🟢 OK (HTTP direto, sem browser — e-SAJ cjsg, **sem captcha**; base **só SAJ**, não cobre o e-Proc) |
| `tjpa` | TJ do Pará | PA | `CLAUDE-TJPA.md` | 🟢 OK (API direta, sem browser) |
| `tjpe` | TJ de Pernambuco | PE | `CLAUDE-TJPE.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; ementa **e** inteiro teor já vêm na busca). Base corrente, cobre PJe + Projudi |
| `tjpr` | TJ do Paraná | PR | `CLAUDE-TJPR.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjrj` | TJ do Rio de Janeiro | RJ | `CLAUDE-TJRJ.md` | 🟢 OK (HTTP direto, sem browser — só e-Proc/Justiça Comum 2º grau) |
| `tjrn` | TJ do Rio Grande do Norte | RN | `CLAUDE-TJRN.md` | 🔴 **sem busca** — o domínio **inteiro** do TJRN responde 403 (Akamai); só `-n` (nº do processo, via DataJud) |
| `tjrs` | TJ do Rio Grande do Sul | RS | `CLAUDE-TJRS.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjsc` | TJ de Santa Catarina | SC | `CLAUDE-TJSC.md` | 🟢 OK (browser — portal atrás de verificação de segurança) |
| `tjsp` | TJ de São Paulo | SP | `CLAUDE-TJSP.md` | 🔴 sem acesso — não rodar |
| `tst` | **Tribunal Superior do Trabalho** | Nacional (**trabalhista**) | `CLAUDE-FALCAO.md` | 🟢 OK (API direta, sem browser) |
| `trt1`…`trt24` | TRTs 1ª a 24ª Região (**trabalhista**) | todo o país — ver tabela no doc | `CLAUDE-FALCAO.md` | 🟢 OK (API direta, sem browser) |
| `csjt` | Conselho Superior da JT (administrativo) | Nacional | `CLAUDE-FALCAO.md` | 🟢 OK (acervo pequeno) |

**A Justiça do Trabalho inteira está coberta**: os 26 acervos (TST + 24 TRTs + CSJT) vêm
de uma base nacional única, o FALCÃO — leia [`CLAUDE-FALCAO.md`](CLAUDE-FALCAO.md) para
escolher o comando. `CLAUDE-TRT9.md` é o mergulho técnico do sistema.

Nenhum tribunal catalogado está mapeado à espera de crawler. Falta ainda o módulo
**eJURIS** do TJRJ (legado com Turmas Recursais e acervo histórico — o `jur tjrj` cobre
só o e-Proc). Os outros 16 tribunais (TJs restantes) não estão mapeados — veja
`cobertura/CLAUDE-COBERTURA.md` e use a skill [`codegen`](skills/codegen/SKILL.md) para mapear.

**Exemplos de roteamento:**
- "Procure no Tribunal do Paraná" → `tjpr` → leia `CLAUDE-TJPR.md`
- "Juizado Especial no PR" / "Turma Recursal paranaense" → `tjpr --foro juizados`;
  Justiça Comum é `--foro comum` (default). A distinção é obrigatória — leia `CLAUDE-TJPR.md`
- "Juizado Especial no RS" / "Turma Recursal gaúcha" → `tjrs --origem turmas`;
  Justiça Comum é `--origem comum` (default). A distinção é obrigatória — leia `CLAUDE-TJRS.md`
- "TJSC" / "Santa Catarina estadual" → `tjsc` → leia `CLAUDE-TJSC.md`.
  Juizado Especial / Turma Recursal em SC → `tjsc --origem turmas` (Justiça Comum é o
  default `--origem comum`). ⚠️ o TJSC tem dois portais no ar: use só o comando, nunca
  `busca.tjsc.jus.br` (base congelada desde 08/10/2025)
- "TJMA" / "Maranhão estadual" → ⚠️ **a busca por termo não existe**: o JurisConsult exige
  captcha de imagem + reCAPTCHA, e este repo não resolve captcha. Diga isso ao usuário.
  Só `./bin/jur tjma -n <nº>` (confirma que um processo existe, via DataJud) e
  `--diagnostico` funcionam. Para matéria federal com origem no MA ofereça `trf1` —
  leia `CLAUDE-TJMA.md`
- "TJRN" / "Rio Grande do Norte estadual" / "Natal" → ⚠️ **não existe busca**: **todo o
  domínio do TJRN responde 403** (Access Denied do Akamai) — o portal de jurisprudência, o
  site institucional e o `/robots.txt`. **Não é captcha**, não há o que resolver, e não
  adianta `--headed`. Diga isso ao usuário em vez de entregar zero.
  Só `./bin/jur tjrn -n <nº>` (confirma que um processo **existe**, via DataJud) e
  `--diagnostico` funcionam. ⚠️ **`-n` confirma processo, nunca julgado** — o DataJud não
  tem ementa nem inteiro teor. **Não cite acórdão do TJRN de memória**: o `verificador`
  não consegue confirmar julgado do RN enquanto o 403 durar.
  Ofereça `trf5` (o RN é da 5ª Região) para matéria federal, `trt21`/`tst` para
  trabalhista e `stf` para constitucional — **nenhum TJ vizinho cobre jurisprudência
  estadual do RN**. Leia `CLAUDE-TJRN.md`
- "Busque no TRF2" / "RJ ou ES" → `trf2` → leia `CLAUDE-TRF2.md`.
  Juizado Especial Federal / Turma Recursal no RJ ou ES → `trf2 --origem turmas`
  (Justiça Federal comum é o default `--origem trf2`). ⚠️ **neste portal o espaço entre
  termos quebra a busca** — o crawler conserta sozinho (une com hífen), mas nunca chame o
  site na mão nem use `--literal` sem ler a ressalva 1. A base começa em **2018**:
  pedido histórico anterior a isso não tem resposta aqui
- "Matéria federal em Minas Gerais" / "TRF6" → `trf6` → leia `CLAUDE-TRF6.md`.
  Juizado Especial Federal / Turma Recursal em MG → `trf6 --origem turmas`
  (Justiça Federal comum é o default `--origem trf6`). ⚠️ **a base só tem de 2023 em
  diante** — o TRF6 foi instalado em ago/2022, desmembrado do TRF1. Jurisprudência
  federal de MG **até 2022** está no `trf1`, não aqui (medido: 27% da amostra do TRF1
  em 2019 é de subseções mineiras). Um pedido histórico exige os dois comandos.
  ⚠️ Ao contrário do TRF2, aqui o espaço entre termos funciona e os operadores são em
  português (`e`, `ou`, `não`, `prox`) — **nunca hifenize a query do TRF6**
- "TJRJ" / "Rio de Janeiro estadual" → `tjrj` → leia `CLAUDE-TJRJ.md`.
  ⚠️ só Justiça Comum 2º grau no e-Proc (~2023+); **Juizado Especial / Turma Recursal
  carioca e acervo antigo estão no eJURIS, sem crawler** — diga isso ao usuário em vez
  de rotular resultado do e-Proc como Juizado
- "TJCE" / "Ceará estadual" / "Fortaleza" → `tjce` → leia `CLAUDE-TJCE.md`.
  Juizado Especial / Turma Recursal cearense → `tjce --base turmas`; Justiça Comum
  2º grau é `--base comum` (default). `--base todos` mistura os dois.
  ⚠️ **Decisão monocrática vem SEM ementa** (as 247.991 delas): só ACÓRDÃO e TURMA
  RECURSAL têm ementa indexada. Diferente do TJMG, aqui o inteiro teor está no
  mesmo objeto — use `--full-text`. O crawler avisa; repasse o aviso.
  ⚠️ **Não existe permalink**: o SJURIS vive todo em `/tela-consulta` e não há URL
  por julgado. Nunca invente link de acórdão do TJCE — a verificação é por
  reconsulta (`-n <número>`).
  ⚠️ **Nunca use `esaj.tjce.jus.br/cjsg`** — é o portal antigo: cobre só o SAJ
  (o SJURIS cobre SAJ **e** PJe) e exige browser por causa do reCAPTCHA v3, que
  quando falha devolve o formulário vazio com HTTP 200, sem erro.
  A base **não tem 1º grau (sentenças)**; para matéria federal cearense use `trf5`
- "TJDFT" / "Distrito Federal estadual" / "Brasília" → `tjdft` → leia `CLAUDE-TJDFT.md`.
  Juizado Especial / Turma Recursal do DF → `tjdft --acervo turmas`; Justiça Comum 2º grau
  é `--acervo comum` (o default `--acervo todos` **mistura os dois**). Único tribunal do
  repo com **API pública oficial documentada**, e o inteiro teor **já vem no resultado da
  busca** — `--fetch-inteiro-teor` só grava em disco, sem request extra.
  ⚠️ **Decisões monocráticas e da Presidência não têm data de julgamento**: filtrar com
  `-di/-df` apaga esses dois acervos em silêncio (2.743 → 0). Para elas use `-dpi/-dpf`
  (publicação). O crawler avisa — repasse o aviso.
  ⚠️ Os operadores em português **funcionam** aqui (`E`, `OU`, `NÃO`, `$`, `"frase"`) — ao
  contrário do TJMG. Mas `PROX`/`ADJ` só funcionam **sem parênteses** (`PROX5`, não
  `PROX(5)`), apesar de o botão da tela escrever `PROX(N)`.
  ⚠️ Rate limit de 60 requisições por janela; 429 é bloqueio, não erro
- "TJMG" / "Minas Gerais estadual" → `tjmg` → leia `CLAUDE-TJMG.md`.
  Juizado Especial / Turma Recursal mineira → `tjmg --tipo turmas --escopo inteiroTeor`;
  Justiça Comum 2º grau é `--tipo acordao` (o default `--tipo todos` **mistura os dois**).
  ⚠️ **O `--escopo inteiroTeor` não é preferência, é obrigatório para Juizado**: só o tipo
  `Acórdão` tem ementa indexada, então no escopo padrão Turma Recursal, Monocrática e
  Vice-Presidência devolvem **0 sempre** — um zero que se lê como "não há jurisprudência
  sobre o tema" e não é. O crawler avisa; repasse o aviso ao usuário.
  ⚠️ Os operadores em português (`e`, `ou`, `não`, `$`) do portal antigo são **ignorados
  sem erro** aqui: a sintaxe é a do Elasticsearch (`+`, `|`, `-`, `"frase"`, `( )`, `*`, `~`).
  ⚠️ **Nunca use `www5.tjmg.jus.br/jurisprudencia`** — é o portal antigo, devolve 401 +
  captcha, e é o único que a página oficial do TJMG ainda linka. A base **não tem 1º grau
  (sentenças) nem súmulas**; para matéria federal mineira use `trf6` (2023+) ou `trf1` (até 2022)
- "TJAC" / "Acre estadual" / "Rio Branco" → `tjac` → leia `CLAUDE-TJAC.md`.
  ⚠️ **No Acre o Juizado é MAIOR que a Justiça Comum — 2,8×** (medido: 7.649 × 21.353
  para o mesmo termo). Isso **inverte** o padrão de todos os outros TJs do repo: o
  default `--origem comum` esconde 74% do acervo em matéria de consumo. Em dano moral,
  telefonia, banco e transporte aéreo, **ofereça as duas** (`--origem turmas` e
  `--origem comum`). Número baixo em `comum` não é escassez de jurisprudência.
  ⚠️ **O inteiro teor está atrás de reCAPTCHA — só o download; a busca é livre.**
  O que se tem é a **ementa íntegra** (~4.200 chars em acórdão, ~5.600 em Turma
  Recursal, no padrão estruturado do CNJ), que já vem na busca. Diga ao usuário que a
  análise vem da ementa e que o relatório/voto do TJAC não são acessíveis — **não
  apresente a ementa como se fosse o acórdão inteiro**.
  ⚠️ **NÃO EXISTE PERMALINK.** Nunca invente link de acórdão do TJAC (o `getArquivo.do`
  é captcha e o popup de ementa é modal sem URL). A verificação é por reconsulta:
  `./bin/jur tjac -n "<nº>"`.
  ⚠️ **NÃO avise sobre acento aqui** — ao contrário do TJMS, o índice do TJAC normaliza
  (`usucapiao` e `usucapião` dão 334 os dois). O que zera a busca sem erro é `ADJ`,
  `PROX` e `$`; e `NÃO` acentuado **não** é o operador de exclusão (escreva `NAO`).
  ⚠️ Intervalo de data acima de **1 ano** devolve 0 — o crawler fatia sozinho e avisa.
  A base é **só 2º grau + Turmas Recursais do SAJ**: não tem 1º grau e não cobre o
  acervo do e-Proc (o TJAC roda os dois sistemas). Começa por volta de **2000**.
  Matéria federal com origem no AC → `trf1`
- "TJAM" / "Amazonas estadual" / "Manaus" → `tjam` → leia `CLAUDE-TJAM.md`.
  🔴 **A BASE CONGELOU NO COMEÇO DE 2025 — diga isso antes de entregar resultado.**
  Medido: por data de julgamento, 2024 = 9.023 e 2025 = 62; **2026 = 0**; o
  documento mais recente é de publicação 06/10/2025. Confirmado em três cortes
  independentes. Pedido de jurisprudência recente do AM devolve 0, e esse zero
  **não** é ausência de jurisprudência. A base cobre bem **2013–2024**; para
  matéria federal com origem no AM use `trf1`. **Não há substituto estadual**
  (Projudi atrás de WAF, PJe não responde, não existe e-Proc).
  🔴 **No Amazonas o Juizado é 7,7× a Justiça Comum** (252.381 × 32.755 para o
  mesmo termo) — a inversão do TJAC levada ao extremo. O default `--origem comum`
  esconde 89% do acervo em matéria de consumo. Em dano moral, telefonia, banco,
  plano de saúde e transporte aéreo, **ofereça as duas** (`--origem turmas` e
  `--origem comum`). ⚠️ o filtro se chama "Colégios Recursais" na tela, mas o
  órgão que volta nos dados é `2ª Turma Recursal`.
  ⚠️ **Use `-dpi/-dpf` (publicação), não `-di/-df` (julgamento)**: 481 julgados
  carregam a data-sentinela `01/06/2004` — e numa amostra das 30 publicações
  mais recentes, 11 estavam assim. Filtrar por julgamento descarta os documentos
  recentes em silêncio. O crawler avisa; repasse o aviso.
  ⚠️ **O inteiro teor está atrás de reCAPTCHA — só o download; a busca é livre.**
  O que se tem é a ementa íntegra (média 2.589 chars em acórdão), que já vem na
  busca. **Não a apresente como se fosse o acórdão inteiro.**
  ⚠️ **NÃO EXISTE PERMALINK.** Nunca invente link de acórdão do TJAM — a
  verificação é por reconsulta: `./bin/jur tjam -n "<nº>"`.
  ⚠️ **NÃO avise sobre acento aqui** — o índice normaliza (`usucapiao` e
  `usucapião` dão 340 os dois). O que zera a busca sem erro é `ADJ`, `PROX` e
  `$`; e `NÃO` acentuado **não** é o operador de exclusão (escreva `NAO`).
  ⚠️ As abas `homologacao` e `monocratica` são **quase vazias** (193 monocráticas
  contra 472.094 acórdãos). Isso é o cjsg não indexar, não o tribunal não decidir.
  A base é **só 2º grau + Colégios Recursais do SAJ**: não tem 1º grau (o `cjpg`
  não existe aqui) e não cobre o Projudi
- "TJAL" / "Alagoas estadual" / "Maceió" → `tjal` → leia `CLAUDE-TJAL.md`.
  ⚠️ **Aqui a inversão do TJAC/TJAM se DESFAZ: em Alagoas a Justiça Comum é 3,3×
  o Juizado** (103.280 × 31.474 para o mesmo termo). Não generalize em nenhum
  sentido — quem concluiu de AC e AM que "nos TJs pequenos o Juizado domina"
  erra aqui. O default `--origem comum` ainda esconde 23% do acervo, então em
  consumo ofereça também `--origem turmas`. ⚠️ o filtro se chama "Colégios
  Recursais" na tela, mas o órgão que volta é `Turma Recursal Unificada`, e lá
  **o relator vem genérico** (`Juiz 1 Turma Recursal Unificada`) — `-r` por nome
  de pessoa não acha julgado de Turma Recursal.
  ✅ **A base está CORRENTE** (jul/2026 com 981 publicações; julgado mais recente
  23/07/2026) — ao contrário do TJAM. E **não há data-sentinela**: `-di/-df`
  (julgamento) é confiável aqui, tanto quanto `-dpi/-dpf`.
  ⚠️ **O inteiro teor está atrás de reCAPTCHA — só o download; a busca é livre.**
  O que se tem é a **ementa íntegra**, que já vem na busca e é a mais rica da
  família (média 4.746 chars em acórdão). **Não a apresente como se fosse o
  acórdão inteiro.**
  ⚠️ **NÃO EXISTE PERMALINK.** Nunca invente link de acórdão do TJAL — a
  verificação é por reconsulta: `./bin/jur tjal -n "<nº>"`.
  ⚠️ **NÃO avise sobre acento aqui** — o índice normaliza (`usucapiao` e
  `usucapião` dão 1.819 os dois). O que zera sem erro é `ADJ` e `PROX`; e `NÃO`
  acentuado **não** é o operador (escreva `NAO`). ⚠️ o `$` aqui **não zera,
  degenera**: `dan$` devolve 2 — parece busca específica e não é.
  ⚠️ O formulário só oferece a aba "Acórdãos", mas `-t monocratica` funciona
  assim mesmo (43 documentos). `-t homologacao` devolve 0 e esse zero é
  **ambíguo** — não diga que o TJAL não homologa acordos.
  A base é **só 2º grau + Colégios Recursais do SAJ**, de ~2013 em diante: não
  tem 1º grau (o `cjpg` não existe aqui) e não cobre o Projudi.
  Matéria federal com origem em AL → `trf5`
- "TJBA" / "Bahia estadual" / "Salvador" → `tjba` → leia `CLAUDE-TJBA.md`.
  Juizado Especial / Turma Recursal baiana → `tjba --origem turmas`; Justiça Comum
  2º grau é `--origem comum` (default). A distinção é obrigatória e está medida
  (1.336 × 835 para o mesmo termo).
  🔴 **NUNCA use `E`, `OU` ou `NÃO` na query do TJBA** — apesar de o portal
  oferecer os três botões, eles **não são operadores**: viram palavra literal e
  **inflam** a busca (`usucapião E posse` = 3.596.546 de 4.008.679 documentos).
  Os que funcionam são os ingleses: `AND`, `OR`, `NOT`, mais `"frase exata"` e
  curinga `*`. `PROX`/`ADJ` não existem. O crawler avisa; repasse o aviso.
  🔴 **Espaço entre termos é OR, não AND** (provado: 2.171 + 86.140 − 810 =
  87.501). Query de duas palavras devolve a **união** — o número grande é o
  segundo termo, não abundância de jurisprudência. Use `AND` para exigir os dois.
  🔴 **A API repete cada documento em `--origem comum`** (fator 2,00), que é o
  default. O crawler deduplica e publica `totalDeduplicadoEstimado` — **relate
  esse número, não o total do servidor**, que está inflado na mesma proporção.
  ⚠️ **O campo "ementa" é na verdade o INTEIRO TEOR** (cabeçalho, partes,
  relatório, voto, assinatura); não existe ementa separada nesta base. ✅ Em
  compensação **não há captcha nenhum** e o inteiro teor vem de graça na busca —
  `--fetch-inteiro-teor` só grava em disco.
  ⚠️ **Acento é obrigatório e não é normalizado** (`usucapiao` = 4,
  `usucapião` = 2.171) — padrão TJMS, oposto de TJAC/TJAM/TJAL.
  ⚠️ **O filtro `-t` (tipo) não compõe com `--origem`**: com termo de busca,
  acórdão + monocrática somam MAIS que o total, e a instância é ignorada.
  Recorte por `--origem`. E note que nesta base Turma Recursal grava como
  `ACORDAO` e 2º grau como `DECISAO_MONOCRATICA` — `-t acordao` te dá, na
  prática, Turma Recursal.
  ⚠️ **NÃO EXISTE PERMALINK.** Nunca invente link de acórdão do TJBA — a
  verificação é por reconsulta: `./bin/jur tjba -n "<nº>"`.
  ⚠️ Só há filtro de data de **publicação** (`-dpi/-dpf`); `dataJulgamento` não é
  filtrável. ✅ Não há teto de intervalo (não precisa fatiar) nem data-sentinela.
  A base é **2º grau + Turmas Recursais** (Projudi + PJe), **sem 1º grau**, e
  está **corrente**. Matéria federal com origem na BA → `trf1`
- "TJPE" / "Pernambuco estadual" / "Recife" → `tjpe` → leia `CLAUDE-TJPE.md`.
  Juizado Especial / Turma Recursal pernambucana → `tjpe --origem turmas`; Justiça
  Comum 2º grau é `--origem comum` (o default `--origem ambas` **mistura os dois**).
  ⚠️ **Aqui a distinção é recorte de CLIENTE** — o filtro de órgão da API não é
  confiável (ids vazam outro órgão) — então com `--origem` o total do servidor se
  refere ao acervo **sem** o recorte. O crawler avisa; repasse. Quanto importa
  depende do tema: `dano moral` = 34% Turma Recursal, `usucapião` = 0,5%. Em
  consumo, ofereça as duas.
  🔴 **Os operadores aqui são em PORTUGUÊS — `E`, `OU`, `NAO`, `PROX`,
  `"frase exata"` — e os INGLESES é que enganam** (o inverso do TJBA): `AND` e
  `ADJ` **zeram**, `OR` devolve 1, e **`NOT` devolve 1.281 contra 2.007 do `NAO`**
  — número plausível, resultado errado. O espaço entre termos é `E` (AND).
  ⚠️ `$` é ignorado e o curinga `*` devolve **menos** que o termo inteiro.
  ⚠️ **NÃO avise sobre acento** — o índice normaliza (`usucapiao` = `usucapião` = 6.266).
  🔴 **O total satura em 10.000** e a paginação para aí. `recurso`, `posse`,
  `direito` batem todos nesse número — **não relate 10.000 como contagem**;
  refine com `-di/-df`. O crawler marca `saturado`.
  🔴 **NÃO EXISTE PERMALINK, e o link da busca entrega ZERO FALSO**: a URL que
  aparece depois de buscar restaura o formulário mas **não roda a busca** — colada
  numa aba limpa mostra "Nenhum resultado encontrado" onde há 6.266 julgados.
  Nunca mande esse link como prova. A verificação é por reconsulta
  (`./bin/jur tjpe -n "<nº>"`), e o documento é identificado pela `chave`, não
  pelo número do processo.
  ✅ **Ementa e inteiro teor são campos distintos e reais, e os dois já vêm na
  busca**, sem captcha — `--fetch-inteiro-teor` só grava em disco.
  ⚠️ **Decisão monocrática vem SEM ementa** (só o texto da decisão) — não a
  apresente como ementa.
  ⚠️ **No acervo eletrônico não existe data de publicação distinta**: `dataJulgamento`
  e `dataPublicacao` são o mesmo instante (medido 60/60). No físico são datas reais.
  ⚠️ Existem **documentos ilegíveis** que devolvem HTTP 500 e derrubam a página
  inteira; o crawler pula só o documento ruim e avisa quantos se perderam.
  A base é **2º grau + Turmas Recursais** (PJe + Projudi), **sem 1º grau**, e está
  **corrente**. Matéria federal com origem em PE → `trf5`
- "TJMS" / "Mato Grosso do Sul estadual" / "Campo Grande" → `tjms` → leia `CLAUDE-TJMS.md`.
  Juizado Especial / Turma Recursal sul-mato-grossense → `tjms --origem turmas`; Justiça
  Comum 2º grau é `--origem comum` (default). A distinção é obrigatória e está medida
  (67.328 × 21.801 para o mesmo termo).
  ⚠️ **Acento é obrigatório na query e não é normalizado**: `usucapiao` devolve 3 e
  `usucapião` devolve 3.885. Um número baixo aqui é quase sempre acento faltando, não
  ausência de jurisprudência. O crawler avisa; repasse o aviso.
  ⚠️ **`ADJ` e `PROX` não existem** neste portal — viram texto literal e **zeram a busca
  sem erro**. `E`, `OU`, `NÃO`, `"frase exata"` funcionam.
  ⚠️ **Intervalo de data acima de 365 dias corridos devolve 0 sem erro** — e "o último
  ano" cai exatamente nisso. O crawler fatia em janelas sozinho e avisa; só saiba que
  aí o `-m N` passa a valer **por janela**.
  ⚠️ A base é **só 2º grau + Turmas Recursais do sistema SAJ**: não tem 1º grau, e
  **não cobre o acervo do e-Proc** (o TJMS migra desde 01/07/2026 e o módulo de
  jurisprudência do e-Proc não está no ar). Para pedido de jurisprudência **muito
  recente**, diga isso. Matéria federal com origem em MS → `trf3`
- "Matéria previdenciária federal em SP" → `trf3` (instável; ver doc), com TRF4/TRF5 de comparativo
- **Matéria constitucional / precedente de maior hierarquia** ("o que o Supremo decidiu",
  "é constitucional?", ADI/ADPF/ADC, recurso extraordinário) → `stf` → leia `CLAUDE-STF.md`.
  **Súmula vinculante** → `stf --vinculantes` (são 63, e vinculam todo o Judiciário).
  **Repercussão geral / tema / tese** → `stf --rg`, `stf --tema "<nº ou texto>"`,
  `stf --tese "<texto>"`. No STF **não há Juizado nem Turma Recursal**: a desambiguação é por
  órgão (`-oj "Tribunal Pleno"` × Turmas) e por classe (`-c ADI,ADPF,ADC` × `-c RE,ARE`).
  Peça o número no formato do STF (`ARE 1596565`, `ADI 4277`) — a base **não indexa CNJ**
- **Interpretação de LEI FEDERAL infraconstitucional** (Código Civil, CPC, CDC, Código Penal,
  Lei de Execução Fiscal, benefício previdenciário, contrato, prescrição) → seria o `stj`, a
  corte que uniformiza a lei federal e orienta todos os TJs e TRFs.
  🔴 **MAS O `stj` ESTÁ BLOQUEADO DESDE 27/07/2026 — NÃO RODE O COMANDO.** Desafio
  interativo do Cloudflare (403 + `cf-mitigated: challenge`). Diga ao usuário que o STJ
  está inacessível, ofereça o tribunal local **rotulando-o como instância inferior**, e
  **não cite REsp de memória** — o `verificador` também não confirma nada no STJ agora.
  O resto desta entrada vale para quando o bloqueio cair.
  Leia `CLAUDE-STJ.md`. No STJ **não há Juizado, Turma Recursal nem 1º grau**: a desambiguação
  é (a) por **órgão** — `-s publico` (tributário/administrativo/previdenciário),
  `-s privado` (civil/consumidor/empresarial), `-s penal`, `-oj CE` (Corte Especial) — e
  (b) por **tipo de documento**: `--base acordao` (default) × `--base monocratica`.
  **Tema repetitivo / precedente vinculante** → `stj --temas -q "<assunto>"`; os acórdãos
  julgados sob o rito → `stj -q "<termo>" --repetitivos`.
  ⚠️ O comando **abre uma janela de Chromium** (Cloudflare não libera headless) e a base
  **não indexa número CNJ** — peça o número no formato do STJ (`REsp 1809043`) ou o
  registro (`2019/0116080-0`)
- "Acórdãos do TCU" → `tcu` → leia `CLAUDE-TCU.md`
- **Contencioso administrativo PREVIDENCIÁRIO** ("o que o CRPS decidiu", recurso contra
  indeferimento do INSS, Junta de Recursos, Câmara de Julgamento) → 🔴 **não há busca**:
  o portal exige login Gov.br e o contorno por perfil de Chrome dedicado **já foi tentado
  e falhou** (captcha + Gov.br recusa navegador não validado).
  **Diga isso ao usuário**, não ofereça zero como resposta.
  Alternativas honestas: `trf*` da região (matéria já judicializada) e os **Enunciados do
  CRPS**, públicos em PDF no gov.br. Leia `CLAUDE-CRPS.md`
- **Contencioso administrativo TRIBUTÁRIO federal** ("o que o CARF decidiu", auto de
  infração da Receita, IRPF/IRPJ/PIS/COFINS/IPI em recurso administrativo, CSRF) →
  `carf` → leia `CLAUDE-CARF.md`. É instância ADMINISTRATIVA, não Judiciário: para a
  mesma matéria já judicializada, o caminho é `trf*`/`stj`. ⚠️ Na query do CARF o
  `OU` não existe (é ignorado — rode duas buscas e some); números só com máscara
  (`13890.000160/2006-17`, `2802-000.639`)
- **Matéria TRABALHISTA** (verbas rescisórias, horas extras, vínculo de emprego,
  insalubridade/periculosidade, justa causa, assédio, FGTS) → Justiça do Trabalho, que é
  **outro ramo**: nunca o TJ do estado. Escolha pela UF do vínculo — `trt9` (PR),
  `trt2` (SP capital), `trt15` (SP interior), `trt3` (MG)… — e **cite o `tst` antes do
  TRT** para tese jurídica, que é a corte que uniformiza a CLT (mesma lógica de
  "STJ antes do TJ"). Tabela dos 26 comandos em [`CLAUDE-FALCAO.md`](CLAUDE-FALCAO.md).
  A desambiguação é por grau: `-g 2` acórdãos (default), `-g 1` sentenças de Vara.
  **Não existe Juizado Especial na JT.** ⚠️ **SP tem dois TRTs** (`trt2` capital ×
  `trt15` interior) e o **TST não tem 1º grau** (`-g 1` lá avisa e manda ao TRT de origem)
- Tribunal não coberto → **diga isso**; ofereça o vizinho coberto ou mapear com `codegen`

## Installation

```bash
npm install
npx playwright install chromium
```

## Quick Start

```bash
./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"
```

Rode `./bin/jur <command> --help` para a lista completa de flags de um tribunal.

## Flags comuns (todos os tribunais)

| Flag | Long | Description |
|------|------|-------------|
| `-q` | `--query` | Search query (required) |
| `-m` | `--max-pages` | Max pages to crawl (default: 10) |
| `-o` | `--output` | Output JSON file |
| `-v` | `--visible` | Show browser window |
| | `--headed` | Alias for `--visible` |
| | `--json` | Quiet mode: suppress logs, JSON summary only |

## Rodando em paralelo

Cada crawler sobe seu próprio browser — rode tribunais diferentes em paralelo:

```bash
./bin/jur trf4 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf4.json &
./bin/jur trf5 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf5.json &
./bin/jur tjgo -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/tjgo.json &
wait
```

## Modo JSON (pipelines / agentes IA)

```bash
./bin/jur trf4 -q "beneficio assistencial" --json
```

Retorna: `{"success":true,"count":42,"output":"/absolute/path/to/results.json"}`
Em erro: `{"success":false,"error":"error message"}`

## Output Format

Resultados salvos como array JSON em `resultados/`. Campos variam por tribunal; principais:
`id`, `tipoDocumento`, `processo`, `processoUrl`, `orgaoJulgador`, `dataJulgamento`,
`dataPublicacao`, `relator`, `uf`, `ementa`, `inteiroTeorLink`.

## Manutenção

```bash
npm run docs          # regenera cobertura/ e os INDEX.md de human-codegen/
npm run smoke         # os tribunais 🟢 ainda funcionam? (ver tests/README.md)
npm test              # testes unitários
node sync-plugin.js   # espelha jur/skills/ no plugin (--check só verifica)
```

`cobertura/CLAUDE-COBERTURA.md` e os `INDEX.md` são **gerados** — edite as fontes
(`cobertura/build.js`, os arquivos de `human-codegen/`) e rode `npm run docs`.

## Notes for AI Agents

1. Sempre use aspas em termos compostos: `-q "termo composto"`
2. Datas em formato brasileiro: DD/MM/YYYY
3. Use `--json` para parsing programático
4. Limite páginas com `-m` para buscas rápidas
5. Chromium é obrigatório: `npx playwright install chromium`
6. Timeout padrão: 60 segundos por operação; ~20 resultados por página
7. **Antes de montar o comando, leia o doc do tribunal alvo** (coluna "Doc" acima) — as flags
   e os operadores válidos mudam por tribunal
8. **Operadores não são universais**: no TJGO, `E`/`OU`/`NÃO` viram palavra literal no módulo
   de jurisprudência (só `"frase exata"` funciona). Nunca presuma — leia o doc.
9. **Turmas Recursais**: a ementa é uma frase genérica. Use `--fetch-inteiro-teor`.
10. **Verifique antes de citar**: skill `verificador`. Julgado não confirmado não entra na resposta.

Erros comuns: **Timeout** (reduza escopo com `-m`) · **No results** (revise termo/data;
quase sempre é filtro ou encoding, não base vazia) · **Browser not found**
(`npx playwright install chromium`) · **Site mudou** (skill [`fixer`](skills/fixer/SKILL.md)).
