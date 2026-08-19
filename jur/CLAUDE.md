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
| [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md) | Os 70 tribunais catalogados e o status de cada um |
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
| `tcepr` | **TCE-PR** (Tribunal de Contas do Estado do Paraná — controle externo) | PR (Estado + **os 399 municípios**) | `CLAUDE-TCEPR.md` | 🟢 OK (portal ViaJuris, HTTP direto, sem browser — **sem captcha**; ementa, **tema**, inteiro teor, **citação oficial** e **permalink público** já vêm na busca). Base corrente, 1998–2026 |
| `tcesc` | **TCE-SC** (Tribunal de Contas do Estado de Santa Catarina — controle externo) | SC (Estado + **os 295 municípios**) | `CLAUDE-TCESC.md` | 🟢 OK (GraphQL público, HTTP direto, sem browser — **sem captcha**; citação oficial e **PDF público de inteiro teor** já vêm na busca). Base corrente, **5 bases via `--base`** (deliberações, enunciados, informativos, súmulas). 🔴 **O espaço entre termos é OR e não existe AND**; a maioria dos documentos vem **sem ementa** |
| `tcers` | **TCE-RS** (Tribunal de Contas do Estado do Rio Grande do Sul — controle externo) | RS (Estado + **os municípios gaúchos**) | `CLAUDE-TCERS.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; o **inteiro teor já vem na busca**, conferido contra o PDF). Base corrente, **4 bases via `--base`**. 🔴 **O espaço entre termos é OR** e os operadores que a tela anuncia (`E`/`OU`/`NÃO`/`PROX`/`MESMO`/`$`) **inflam até saturar ou zeram** — use `AND`/`OR`/`NOT`. 🔴 **A ementa desaparece a partir de 2020** |
| `tcesp` | **TCE-SP** (Tribunal de Contas do Estado de São Paulo — controle externo) | SP (Estado + **644 municípios**; 🔴 **NÃO a capital**, que é do TCM-SP) | `CLAUDE-TCESP.md` | 🟢 OK (HTTP direto, sem browser — **sem captcha**; **três permalinks públicos**, inclusive a **URL da busca**). Base corrente, 1.317.838 documentos, de 2008 em diante. 🔴 **Não existe ementa** — o texto é trecho com highlight. 🔴 **Os operadores são QUATRO CAIXAS, não inline**: `OU` dentro de `-q` é descartado e a busca continua AND. 🔴 **Um julgado decide vários processos** (fator ~2,9×): o total não é o nº de decisões |
| `tcerj` | **TCE-RJ** (Tribunal de Contas do Estado do Rio de Janeiro — controle externo) | RJ (Estado + **os municípios fluminenses**; 🔴 **NÃO a capital**, que é do TCM-RJ) | `CLAUDE-TCERJ.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; ementa íntegra na busca e **PDF público de inteiro teor com permalink**). 🔴 **Base CURADA e pequena** (1.089 documentos, 2021–2026): é a seleção do Serviço de Jurisprudência, **não o acervo de decisões**. 🔴 **Acento é obrigatório**; o `NÃO` **não exclui, deflaciona**, e `AND`/`OR` derrubam com HTTP 500. 🔴 O filtro de relator chama-se `--conselheiro` |
| `tceba` | **TCE-BA** (Tribunal de Contas do Estado da Bahia — controle externo) | BA (**só o Estado**; 🔴 **NÃO os municípios**, que são do TCM-BA) | `CLAUDE-TCEBA.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; o **texto integral já vem na busca** e o **PDF é público**). Base corrente, 2002–2026. 🔴 **O termo é FRASE LITERAL**: não há operador booleano e o espaço não é conectivo (`nepotismo súmula` = 0, `de nepotismo` = 4); aspas dão **HTTP 500**. 🔴 **Não existe paginação** — `qtRegistros` é limiar que **recusa com HTTP 400 e zero documento**. 🔴 **Voto (66% do acervo) vem sem ementa** |
| `tcepe` | **TCE-PE** (Tribunal de Contas do Estado de Pernambuco — controle externo) | PE (**Estado E municípios**; ✅ **PE não tem TCM** — 184 Prefeituras no combo, **inclusive o Recife**) | `CLAUDE-TCEPE.md` | 🟢 OK (API REST pública JHipster, HTTP direto, sem browser — **sem captcha**; o **texto integral já vem na busca**). Total **exato** (`X-Total-Count`), paginação **estável**. 🔴 **Não há operador booleano e o `OU` da tela RESTRINGE**: o espaço já é `E` implícito e E/OU/NAO são palavras comuns (`A OU B` = interseção). 🔴 **Acento não normalizado**: `licitacao` = 40 contra `licitação` = 13.636 — sem acento vem um **subconjunto plausível**, não zero. 🔴 **O default da tela omite os pareceres prévios** (263 de 272). 🔴 **Não há ementa** — só texto integral. 🔴 **49% dos permalinks apontam para `portalintranet.tce.pe`, que é NXDOMAIN** |
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
| `tjmt` | TJ de Mato Grosso | MT | `CLAUDE-TJMT.md` | 🟢 OK (API REST, HTTP direto, sem browser — **sem captcha**; ementa e inteiro teor já vêm na busca, e a **citação oficial vem pronta**). Base corrente; ⚠️ **não tem Turma Recursal** |
| `tjpa` | TJ do Pará | PA | `CLAUDE-TJPA.md` | 🟢 OK (API direta, sem browser) |
| `tjpb` | TJ da Paraíba | PB | `CLAUDE-TJPB.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; ementa e inteiro teor já vêm na busca). Base corrente, e **tem 1º grau** (1.970.661 sentenças, 78% do acervo) |
| `tjpe` | TJ de Pernambuco | PE | `CLAUDE-TJPE.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; ementa **e** inteiro teor já vêm na busca). Base corrente, cobre PJe + Projudi |
| `tjes` | TJ do Espírito Santo | ES | `CLAUDE-TJES.md` | 🟢 OK (API REST pública, HTTP direto, sem browser — **sem captcha**; ementa e inteiro teor já vêm na busca). Base corrente, e **o único do repo com 1º grau** (1,5 mi de sentenças) |
| `tjpi` | TJ do Piauí | PI | `CLAUDE-TJPI.md` | 🟢 OK (portal JusPI, HTTP direto, sem browser — **sem captcha**; ementa íntegra e **citação oficial** já vêm na busca, e **há permalink público**). Base corrente; inclui **súmulas do próprio TJ** |
| `tjpr` | TJ do Paraná | PR | `CLAUDE-TJPR.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjap` | TJ do Amapá — **Banco de Decisões e Sentenças** | AP | `CLAUDE-TJAP.md` | 🟢 OK (Laravel+Livewire, HTTP direto, sem browser — **sem captcha**; o **ato inteiro já vem na busca** e há **permalink**). 🔴 **É 1º GRAU**: acórdão do TJAP fica no Tucujuris, **atrás de Turnstile**. 🔴 **Esta base NÃO TEM EMENTA** em nenhum tipo. 🔴 **O espaço entre termos é OR** e **não existe operador booleano** (use `--frase`); acento obrigatório (`usucapiao`=1, `usucapião`=2.001). ⚠️ Total **satura em 10.000** e a paginação para junto; **16% de cópias PJe×Tucujuris** do mesmo ato; **15% sigiloso, sem texto** |
| `tjrj` | TJ do Rio de Janeiro | RJ | `CLAUDE-TJRJ.md` | 🟢 OK (HTTP direto, sem browser — só e-Proc/Justiça Comum 2º grau) |
| `tjrj-ejuris` | TJ do Rio de Janeiro — **módulo legado** | RJ | `CLAUDE-TJRJ-EJURIS.md` | 🟢 OK (HTTP direto, sem browser — **sem captcha efetivo**; ementa e decisão na busca, **inteiro teor em PDF público com permalink**). Cobre o **acervo histórico desde ~1995** e as **Turmas Recursais**, que o `tjrj` não tem |
| `tjrn` | TJ do Rio Grande do Norte | RN | `CLAUDE-TJRN.md` | 🔴 **sem busca** — o domínio **inteiro** do TJRN responde 403 (Akamai); só `-n` (nº do processo, via DataJud) |
| `tjro` | TJ de Rondônia | RO | `CLAUDE-TJRO.md` | 🟢 OK (portal JURIS, HTTP direto, sem browser — **sem captcha**; o **texto do documento já vem na busca**). **O maior acervo do repo** (4,0 mi) e **tem 1º grau** (1.928.898 sentenças). 🔴 **O botão "Turma recursal" do portal devolve Justiça Comum** — o Juizado é `--origem turmas`. 🔴 **O espaço entre termos é OR** e o `NÃO` acentuado **infla 24×** |
| `tjrr` | TJ de Roraima | RR | `CLAUDE-TJRR.md` | 🟢 OK (portal Juris/JSF, HTTP direto, sem browser — **sem captcha**; ementa íntegra na busca e **PDF de inteiro teor público**). Base corrente; ⚠️ **monocrática vem sem ementa** |
| `tjrs` | TJ do Rio Grande do Sul | RS | `CLAUDE-TJRS.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjsc` | TJ de Santa Catarina | SC | `CLAUDE-TJSC.md` | 🟢 OK (browser — portal atrás de verificação de segurança) |
| — | TJ de Sergipe | SE | `CLAUDE-TJSE.md` | 🔴 **sem comando** — captcha nos **dois** módulos (Turnstile no judicial, reCAPTCHA no administrativo); nem `-n` existe |
| `tjsp` | TJ de São Paulo | SP | `CLAUDE-TJSP.md` | 🔴 sem acesso — não rodar |
| `tjto` | TJ do Tocantins | TO | `CLAUDE-TJTO.md` | 🟢 OK (portal Jurisprudência 4.0, HTTP direto, sem browser — **sem captcha**; ementa, **citação oficial** e **permalink público** já vêm na busca). Base corrente, e **tem 1º grau** (254.501 sentenças, de 2024 em diante) |
| `tst` | **Tribunal Superior do Trabalho** | Nacional (**trabalhista**) | `CLAUDE-FALCAO.md` | 🟢 OK (API direta, sem browser) |
| `trt1`…`trt24` | TRTs 1ª a 24ª Região (**trabalhista**) | todo o país — ver tabela no doc | `CLAUDE-FALCAO.md` | 🟢 OK (API direta, sem browser) |
| `csjt` | Conselho Superior da JT (administrativo) | Nacional | `CLAUDE-FALCAO.md` | 🟢 OK (acervo pequeno) |

**A Justiça do Trabalho inteira está coberta**: os 26 acervos (TST + 24 TRTs + CSJT) vêm
de uma base nacional única, o FALCÃO — leia [`CLAUDE-FALCAO.md`](CLAUDE-FALCAO.md) para
escolher o comando. `CLAUDE-TRT9.md` é o mergulho técnico do sistema.

**Nenhum TJ está mais à espera de crawler.** O **TJPB** fechou 🟢 em 13/08/2026, o
**TJRO** em 17/08/2026 e o **TJAP** em 19/08/2026 — os três pelo slot da dívida de
crawler. ⚠️ Mas o `jur tjap` cobre **só o 1º grau** (Banco de Decisões e Sentenças): o
acervo de **acórdãos** do TJAP continua atrás de Turnstile e **não tem via aberta** —
leia `CLAUDE-TJAP.md` antes de prometer acórdão amapaense. O módulo **eJURIS** do TJRJ
(legado, com Turmas Recursais e acervo histórico) tem comando próprio,
`jur tjrj-ejuris` — o `jur tjrj` continua cobrindo só o e-Proc.
Dos 27 TJs, **22 têm comando 🟢**, 4 estão
bloqueados com o motivo medido (TJMA, TJRN, TJSE, TJSP) e 1 é instável (TJAM, base
congelada). Veja `cobertura/CLAUDE-COBERTURA.md` e use a
skill [`codegen`](skills/codegen/SKILL.md) para mapear.

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
- "TJSE" / "Sergipe estadual" / "Aracaju" → ⚠️ **não existe comando**: os **dois**
  módulos de jurisprudência do TJSE estão atrás de captcha — **Cloudflare Turnstile**
  no judicial e **reCAPTCHA** no administrativo — e este repo não resolve captcha.
  **Diga isso ao usuário em vez de entregar zero.** Aqui nem o `-n` existe (o
  caminho por DataJud está medido mas não foi implementado), então **não há nada a
  rodar**. ⚠️ **Não cite acórdão do TJSE de memória** — o `verificador` não confirma
  julgado sergipano enquanto o captcha durar. Ofereça `trf5` (Sergipe é da 5ª
  Região) para matéria federal, `trt20`/`tst` para trabalhista e `stf` para
  constitucional. ⚠️ **Nenhum TJ vizinho cobre jurisprudência estadual de SE** — não
  ofereça TJBA nem TJAL como substituto. 🟡 Pode ser que o portal funcione **no
  navegador do usuário** (o Turnstile pune IP de datacenter): se ele confirmar que
  carrega, o TJSE volta para a fila com o mapeamento pronto. Leia `CLAUDE-TJSE.md`
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
- "TJAP" / "Amapá" / "Macapá" / "Oiapoque" → `tjap` → leia `CLAUDE-TJAP.md`.
  🔴 **É 1º grau (sentença e decisão de Vara), não acórdão.** O acervo de acórdãos do TJAP
  mora dentro do Tucujuris e está atrás de Turnstile — se o pedido for de acórdão amapaense,
  diga que não há via oficial aberta em vez de entregar sentença como se fosse.
  🔴 **Esta base não tem ementa**: todo resultado sai com `semEmenta: true` e o texto é o ato inteiro.
  🔴 **O espaço entre termos é OR e nenhum operador booleano funciona** — `AND`/`ADJ`/`NAO` viram
  palavra e INFLAM a busca. Para exigir os termos juntos use `--frase` (frase ordenada).
  ⚠️ Acento é obrigatório e `usucapiao` devolve **1** (não zero) — nunca leia isso como escassez.
  ⚠️ 10.000 é TETO, não contagem; ~15% dos documentos são **sigilosos** e vêm sem texto.
- "TJRO" / "Rondônia estadual" / "Porto Velho" / "Ji-Paraná" → `tjro` → leia `CLAUDE-TJRO.md`.
  ✅ **É o MAIOR acervo do repo** (4.027.701 documentos) e **tem 1º GRAU**:
  `tjro --origem primeiro -t sentenca` (1.928.898 sentenças, 48% da base — o maior 1º grau
  catalogado). Sentença de 1º grau rondoniense é um pedido que só TJRO, TJPB, TJES e TJTO
  atendem.
  🔴 **NÃO use `--instancia 2` para pedir Turma Recursal — no TJRO o filtro de grau EXCLUI
  o Juizado.** O portal oficial tem três botões e os dois últimos mandam o mesmo payload;
  clicar em "Turma recursal" devolve **Justiça Comum**, com HTTP 200 e resultados
  plausíveis. Não zera nem infla: **troca o acervo**. O Juizado é `tjro --origem turmas`
  (recorte por órgão colegiado, com 5 nomes) e a Justiça Comum é `--origem comum`.
  ✅ A partição **fecha exata**. ⚠️ **O peso do Juizado varia 164× conforme o tema**:
  `dano moral` = **65,6%** (55.674 de 84.840) e `usucapião` = **0,4%** (3 de 676). Em
  consumo, ofereça as duas; em direito real a Turma Recursal é ruído.
  🔴 **O ESPAÇO ENTRE TERMOS É OR** (provado: 676 + 9.660 − 455 = 9.881). Query de duas
  palavras devolve a UNIÃO. Use `--todas "<termos>"` (campo estruturado, AND) ou `AND`.
  🔴 **`NÃO` acentuado NÃO exclui — INFLA 24×** (237.098 contra 221 da exclusão correta),
  porque o espaço é OR e "não" é palavra comum em ementa. **Inflar não dá sintoma.** Para
  excluir, use `--excluir "<termo>"`. Os operadores que funcionam são os **ingleses**
  (`AND`, `OR`, `NOT`, `"frase exata"`, `*`); `E`/`OU`/`NAO`/`ADJ`/`PROX` são **ignorados**
  e o `$` **degenera** (`usucapi$` = 22, não zera).
  ✅ **Os quatro campos estruturados são o caminho certo** e dispensam operador:
  `--todas` (AND), `--qualquer` (OR), `--excluir` (NOT), `--frase` (frase exata).
  ⚠️ **NÃO avise sobre acento na query** — o índice normaliza; o acento só importa no `NÃO`.
  🔴 **O mesmo documento é indexado várias vezes** (100 `_id` para 96 documentos reais, com
  casos de 4 cópias). O total do servidor conta as cópias — **relate o
  `totalDeduplicadoEstimado`**, que o crawler publica.
  🔴 **O tipo do documento É a natureza do texto**: `-t ementa` é ementa; `acordao`,
  `sentenca`, `voto`, `relatorio` e `decisao` trazem a **peça inteira**. O crawler marca
  `semEmenta` — não apresente esse texto como ementa.
  🔴 **A base só tem data de JULGAMENTO** (`dtpublicacao` null em 20/20): `-dpi/-dpf` são
  alias que avisam. **Nunca apresente a data do TJRO como publicação.** ✅ Mas a janela é
  bem-comportada: as duas meias janelas funcionam sozinhas e a aritmética fecha.
  🔴 **NÃO EXISTE PERMALINK** — nem por documento, nem de busca (o link pós-busca restaura
  o formulário e **não executa a busca**). Nunca mande esse link como prova; a verificação
  é por reconsulta: `./bin/jur tjro -n "<nº>"`.
  ⚠️ **O tipo `DECISÃO DA PRESIDÊNCIA` sumiu** (56.676 em 09/08 → 0 em 17/08): esse zero é
  reclassificação, não ausência de julgado.
  ✅ Base **corrente** (documento do próprio dia) e **sem captcha em etapa nenhuma**.
  Matéria federal com origem em RO → `trf1`
- "TJRR" / "Roraima estadual" / "Boa Vista" → `tjrr` → leia `CLAUDE-TJRR.md`.
  ⚠️ **O peso do Juizado varia 94× conforme o tema**: Turma Recursal é **37,5%**
  em `dano moral` (5.965 de 15.907) e **0,4%** em `usucapião` (4 de 991). Em
  consumo ofereça também `--origem turmas`; em direito real ela é ruído. ✅ A
  partição por órgão **fecha exata** (as 12 partes somam o total).
  🔴 **Só ACÓRDÃO tem ementa.** As 49.256 monocráticas (39% do acervo) vêm com
  card **sem bloco de ementa** — só processo, relator, órgão e datas; o texto
  delas só existe no PDF (`--fetch-inteiro-teor`). O crawler marca `semEmenta`;
  repasse o aviso e **não apresente o card da monocrática como ementa**.
  🔴 **A data FINAL sozinha é ignorada em silêncio** (devolve o acervo inteiro
  com HTTP 200); a inicial sozinha funciona. Mande as duas pontas — o crawler
  avisa. ⚠️ E o combo diz "TODOS" mas filtra **julgamento**: `-di/-df` é
  julgamento e `-dpi/-dpf` é publicação, e as duas datas são **reais e
  distintas** (diferente de TJPI, TJRO e TJES).
  🔴 **Os operadores são os PORTUGUESES** (`E`, `OU`, `NÃO`/`NAO`,
  `"frase exata"`, `*`, `$`), com aritmética exata; o **espaço é E (AND)**.
  `AND`/`OR`/`NOT`/`ADJ`/`PROX` **destroem** a busca (4, 22, 0, 4, 1).
  ⚠️ Aqui `NAO` e `NÃO` são o **mesmo** operador — inédito no repo.
  ⚠️ **Não avise sobre acento**: o cliente e o índice normalizam.
  ✅ **Há permalink por documento e o inteiro teor é PDF público**
  (`/pdf?id=<id>`, sem sessão e sem captcha). 🔴 Mas **a busca não tem URL** —
  nunca mande link de busca do TJRR como prova —, quem identifica o julgado é o
  **`id` do portal** (um processo tem vários documentos) e **1 em 10
  monocráticas não tem PDF nenhum** (o crawler marca `semInteiroTeor`).
  ⚠️ **Não há citação oficial pronta** — monte-a dos campos do card.
  A base é **só 2º grau + Turma Recursal**, de 2018 em diante, **sem 1º grau**,
  e está **corrente**. Matéria federal com origem em RR → `trf1`
- "TJRJ" / "Rio de Janeiro estadual" → **o RJ tem DOIS comandos, e escolher errado
  devolve zero que não é ausência de jurisprudência**:
  - `tjrj` (e-Proc) → Justiça Comum 2º grau, **~2023 em diante**, recorte por **dia**.
    É o melhor para pedido recente. Leia `CLAUDE-TJRJ.md`.
  - `tjrj-ejuris` (eJURIS legado) → **acervo histórico desde ~1995** e as **Turmas
    Recursais**. Leia `CLAUDE-TJRJ-EJURIS.md`.
  **Pedido anterior a 2023 só tem resposta no `tjrj-ejuris`** — o e-Proc não tem esse
  acervo, e o zero dele é a migração, não o tribunal.
  Juizado Especial / Turma Recursal carioca → `tjrj-ejuris --origem turmas`.
  🔴 **Mas avise que esse acervo é pequeno e recente**: ~1,6 mil documentos, todos de
  2025-2026 (`dano moral` = 1.002, `usucapião` = **0**). Não é o histórico dos
  Juizados; é uma janela. **Nunca rotule resultado do `jur tjrj` como Juizado.**
  🔴 **No eJURIS o recorte é por ANO, não por dia, e não existe data de publicação** —
  nunca apresente a data dele como publicação.
  🔴 **Ano e competência só filtram em `--origem comum`**: nas outras quatro origens o
  servidor os ignora (1990 e 2026 devolvem o mesmo total). O crawler avisa; repasse.
  🔴 **Os operadores do eJURIS são os PORTUGUESES** (`E`, `OU`, `NAO`/`NÃO` — que aqui
  são o **mesmo** operador —, `ADJ`, `PROX`, `"frase exata"`) e o **espaço é E (AND)**.
  `AND`/`OR`/`NOT` **derrubam a busca com HTTP 500**, e o curinga é **`$`**, não `*`.
  ⚠️ **NÃO avise sobre acento** (o índice normaliza), mas saiba que **stopword some em
  silêncio**: `contrato de trabalho` = `contrato trabalho`.
  ✅ **O inteiro teor é PDF público com permalink** (`gedcacheweb…GEDID=<ArqGed>`,
  confirmado em aba limpa) — o `tjrj` não tem isso. 🔴 Mas
  `ImpressaoConsJuris.aspx` **não é permalink**: sem sessão devolve HTTP 200 com uma
  casca idêntica para documentos diferentes. Nunca mande essa URL como prova.
  🔴 Quem identifica o julgado é o **`CodDoc`**, não o número do processo.
  ⚠️ No eJURIS o texto do card **muda de natureza por tipo**: em acórdão de 2ª
  Instância é ementa, em monocrática é a decisão e em **Turma Recursal é o voto
  inteiro** — não apresente os dois últimos como ementa.
  Matéria federal com origem no RJ → `trf2`
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
- "TJPB" / "Paraíba estadual" / "João Pessoa" / "Campina Grande" → `tjpb` → leia
  `CLAUDE-TJPB.md`. ✅ **Tem 1º GRAU**: `tjpb --instancia primeiro` (1.970.661 sentenças,
  **78% do acervo** — o maior 1º grau do repo, à frente de TJRO, TJES e TJTO). Sentença
  paraibana é um pedido que só o TJPB atende.
  Juizado Especial / Turma Recursal paraibana → `tjpb --instancia turmas`; 2º grau comum é
  `--instancia comum` (o default `--instancia todas` **mistura os três**). A partição
  **fecha exata** (8.998 + 3.169 + 41 = 12.208). ⚠️ Mas o peso da Turma Recursal depende
  do tema (0,3% em `usucapião`): em consumo, ofereça as duas.
  🔴 **O `advanced=true` da API é um PORTÃO, e o filtro fora do modo é IGNORADO com
  HTTP 200.** Data, comarca, classe, órgão, vara, relator, instância e número de processo
  **só valem no modo avançado**; `--grau` só vale **fora** dele. O crawler decide sozinho
  e avisa quando `--grau` virou recorte de cliente — repasse. **Nunca chame a API do TJPB
  na mão sem o portão**: `numeroProcesso` sem ele devolve a **base inteira** (2.515.754),
  inclusive para número inventado.
  🔴 **Acento é OBRIGATÓRIO e o índice NÃO normaliza** (`usucapiao` = 64,
  `usucapião` = 12.208) — padrão TJMS/TJBA. Número baixo aqui é quase sempre acento
  faltando. ✅ Os operadores são o **conjunto coerente** do repo: `E`/`OU`/`NÃO` **e**
  `AND`/`OR`/`NOT` funcionam, com aritmética exata; o espaço é `E` (AND); parênteses e
  `"frase exata"` valem; token desconhecido **zera** (sintoma visível). `PROX`/`ADJ` não
  são operadores.
  🔴 **Só ACÓRDÃO de 2º grau COMUM tem ementa** (76/76). Sentença de 1º grau (que também
  vem **sem relator**), decisão monocrática e **acórdão de Turma Recursal** trazem só o
  texto integral. O crawler marca `semEmenta` — não apresente esse texto como ementa.
  🔴 **A base só tem data de JULGAMENTO** (`meioPublicacao` null em 200/200): não existe
  publicação, e `-dpi/-dpf` são alias que avisam. ⚠️ E a data é um **timestamp de
  assinatura/indexação**, não a data da sessão — não a cite como data de sessão de
  julgamento. 🔴 **Meia janela de data é IGNORADA em silêncio** (devolve o acervo inteiro
  com HTTP 200): mande as duas pontas.
  ⚠️ **NÃO EXISTE PERMALINK** — o endpoint de documento responde 404 e a tela está atrás
  do Cloudflare. Nunca invente link do TJPB; a verificação é por reconsulta
  (`./bin/jur tjpb -n "<nº>"`, que aceita as duas formas do número). Quem identifica o
  julgado é o **`id` do documento**, não o número do processo.
  ✅ Ementa e inteiro teor vêm de graça na busca, sem captcha em etapa nenhuma, em texto
  plano. Base **corrente** (documento do próprio dia). ⚠️ Offset máximo de **10.000**:
  varredura profunda exige recorte por data. Matéria federal com origem na PB → `trf5`
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
- "TJES" / "Espírito Santo estadual" / "Vitória" / "Vila Velha" / "Serra" → `tjes` → leia
  `CLAUDE-TJES.md`. ✅ **É o ÚNICO tribunal do repo com 1º grau (sentenças) na base de
  jurisprudência — e o 1º grau é o MAIOR acervo**: 1.509.942 de 2.212.794 documentos.
  São cinco acervos, e o comando escolhe por `--acervo`: `pje1g` (1º grau),
  `pje2g` (default, 2º grau), `pje2g-mono` (monocráticas), `fisicos` (acervo físico
  legado) e `turmas` (Turmas Recursais do Projudi). Sentença de 1º grau capixaba é um
  pedido que **só o TJES atende** — nenhum outro tribunal do repo tem isso.
  Juizado Especial / Turma Recursal dentro do 2º grau do PJe → `tjes --origem turmas`;
  Justiça Comum é `--origem comum` (o default `--origem ambas` **mistura os dois**).
  ✅ Aqui a partição **compõe exatamente** (141.155 + 78.488 = 219.643), diferente do
  TJPE e do TJBA. ⚠️ Mas a proporção depende muito do tema: em `usucapião` a Turma
  Recursal é 1,4% do acervo e em `dano AND moral` é **67%** — em consumo, ofereça as duas.
  🔴 **O espaço entre termos é OR, não AND** (provado: 1.574 + 49.466 − 1.251 = 49.789).
  Query de duas palavras devolve a UNIÃO. **Use `AND`.**
  🔴 **Os operadores são os INGLESES** (`AND`, `OR`, `NOT`, `"frase exata"`, `*`).
  Os portugueses `E`/`OU`/`ADJ` são **ignorados**, e `NAO` e `PROX` **INFLAM** a
  contagem (52.139 e 50.577 contra 49.789) em vez de zerar — inflar não dá sintoma.
  É o **inverso do TJPE**; não herde de lá. ⚠️ **NÃO avise sobre acento** (o índice normaliza).
  🔴 **`-di/-df` filtram DATA DE JUNTADA, não data de julgamento — e a tela do tribunal
  exibe esse mesmo campo rotulado "Julg:"**. Nos três acervos do PJe **não existe** data
  de julgamento nem de publicação. **Nunca cite o "Julg:" do TJES como data de julgamento
  do acórdão.** Só `fisicos` e `turmas` têm `data_julgamento` real, e neles a API não
  filtra por ela. O crawler avisa; repasse o aviso.
  🔴 **Um filtro de data que não exclui nada muda a contagem**: `dano moral` = 106.282, e
  a mesma query com intervalo de 1900 a 2100 = **61.480**. Contagem com data **não é
  comparável** com contagem sem data, a menos que a query traga operador explícito.
  ⚠️ **O 1º grau e o acervo físico NÃO têm ementa** (só o texto integral), e as Turmas
  Recursais do Projudi têm **só ementa**, sem inteiro teor. Não apresente um pelo outro.
  🔴 **NÃO EXISTE PERMALINK.** Nunca invente link de acórdão do TJES — a verificação é por
  reconsulta: `./bin/jur tjes -n "<nº>"`. ⚠️ E **consultar o CNJ por termo de busca traz
  lixo**: o número devolve 31 documentos, sendo alguns que apenas o **citam** no corpo.
  ✅ Ementa e inteiro teor vêm de graça na busca, sem captcha em etapa nenhuma.
  Matéria federal com origem no ES → `trf2`
- "TJPI" / "Piauí estadual" / "Teresina" / "Parnaíba" → `tjpi` → leia `CLAUDE-TJPI.md`.
  ⚠️ **Não existe Juizado × Justiça Comum no TJPI** — os 27 órgãos são Câmaras
  Especializadas, Grupos, Pleno e Vice-Presidências; **não há Turma Recursal na
  base**. Não ofereça o recorte, e não leia a ausência como "o crawler não filtra".
  ✅ **É o primeiro tribunal do repo com SÚMULAS do próprio TJ pesquisáveis**
  (39 delas): `tjpi -q "<termo>" -t sumula`. 🔴 **Mas súmula não tem permalink**
  (HTTP 500 em 5/5 testadas) e não traz processo, relator, órgão nem citação —
  cite pelo texto, não por link.
  🔴 **A base NÃO TEM data de julgamento, só publicação.** Não existe `-di/-df`;
  use `-dpi/-dpf`. **Nunca apresente a data do TJPI como data de julgamento.**
  🔴 **`-dpi` sozinho é IGNORADO em silêncio** (devolve o acervo inteiro, com
  HTTP 200 e número plausível). Mande sempre as duas pontas. O crawler avisa.
  🔴 **Os operadores são em PORTUGUÊS** (`E`, `OU`, `NÃO` **acentuado**,
  `"frase exata"`, parênteses); `AND`/`OR`/`NOT`/`ADJ`/`PROX` **zeram a busca**.
  E ⚠️ **`nao` SEM acento não é operador** — vira palavra e a contagem **sobe**
  (282 contra 279), sem sintoma. **É o oposto do TJAC/TJAM/TJAL**, onde `NAO` é
  que funciona. O espaço entre termos é `E` (AND).
  ⚠️ **NÃO avise sobre acento na query** — o índice normaliza
  (`usucapiao` = `usucapião` = 585). O acento só importa para o operador.
  🔴 **Número de processo sozinho não funciona**, apesar de indexado e de o
  próprio campo prometer "Processos": o CNJ **mascarado** derruba a busca com
  **HTTP 500** e o sem máscara devolve **0 calado**. Use `./bin/jur tjpi -n "<nº>"`,
  que aplica o contorno medido. ⚠️ Ele pode arrastar acórdão que apenas **cita** o número —
  o Checker descarta e avisa.
  ✅ **Ementa íntegra, citação oficial pronta e permalink público** já vêm na
  busca, sem captcha em etapa nenhuma. O inteiro teor é 1 GET por documento
  (`--fetch-inteiro-teor`). ✅ **Decisão terminativa TEM ementa** — não repita
  aqui a ressalva de TJPE/TJCE/TJMT.
  ⚠️ A base é **só 2º grau, de 2018 em diante**: não tem 1º grau. Está
  **corrente**, mas com **defasagem de indexação nos últimos meses**
  (mai/2026 = 10.980, jun = 6.580, jul = 3.782) — em pedido dos últimos 30–60
  dias, diga isso em vez de entregar o número baixo como se fosse o acervo.
  Matéria federal com origem no PI → `trf1`
- "TJMT" / "Mato Grosso estadual" / "Cuiabá" / "Várzea Grande" / "Rondonópolis" → `tjmt` →
  leia `CLAUDE-TJMT.md`.
  🔴 **NÃO EXISTE Juizado × Justiça Comum no TJMT — e a tela promete que existe.** Os
  parâmetros que oferecem "Turma Recursal" são **ignorados** pelo servidor e o contador
  de Turma Recursal é **0 em toda busca**, inclusive em consumo (`dano moral` = 241.840
  acórdãos, **0 recursal**). **Pedido de jurisprudência de Juizado Especial de MT não tem
  resposta aqui** — diga isso ao usuário, porque esse zero **não** é ausência de julgado.
  O acervo de Turma Recursal (Projudi) não está indexado neste portal.
  🔴 **A janela de data filtra PUBLICAÇÃO, não julgamento** — use `-dpi/-dpf` (`-di/-df`
  são alias). A data de julgamento existe no documento e é real, mas **não é filtrável**.
  **Nunca apresente o recorte do TJMT como sendo por data de julgamento.**
  ⚠️ E o filtro de data do portal **está errado para o próprio usuário do TJMT**: a API lê
  MM/DD/YYYY enquanto a tela envia DD/MM/YYYY, então no site toda data com dia ≤ 12
  devolve o mês trocado e toda data com dia > 12 devolve o acervo inteiro. O crawler
  converte sozinho — só nunca chame a API na mão com data brasileira crua.
  🔴 **`OU` e `NÃO` NÃO funcionam**: são descartados em silêncio e a busca vira `E` (AND).
  Você pede união e recebe **interseção**, com número plausível e sem sintoma. Para união,
  rode duas buscas e some. E os **ingleses inflam 27×** (`AND`/`OR`/`NOT` desligam o AND
  implícito e tudo vira OR). O que funciona é `E`, `PROXIMO`, `"frase exata"` e `*`;
  `PROX` e `ADJ` **zeram**, e `$` **degenera** (`usucapi$` = 2). O crawler avisa em cada
  caso; repasse o aviso. ⚠️ **NÃO avise sobre acento na query** — o índice normaliza.
  🔴 **Decisão monocrática vem SEM ementa** (as 454.195 delas): o que existe é a decisão
  inteira. O crawler marca `semEmenta` e não a apresenta como ementa — repasse.
  ✅ **Ementa, inteiro teor e a CITAÇÃO OFICIAL já vêm na busca**, sem captcha:
  `--fetch-inteiro-teor` só grava em disco, e a citação vem pronta (nada de regex).
  ⚠️ **NÃO EXISTE PERMALINK por documento.** Nunca invente link de acórdão do TJMT — a
  verificação é por reconsulta: `./bin/jur tjmt -n "<nº>"` (aceita com ou sem máscara).
  ⚠️ **A paginação é INSTÁVEL** (sem campo de desempate): o crawler deduplica por `Id`,
  mas em varredura profunda espere lacunas. E **cada página de 100 são 33,7 MB** (o brasão
  vem em base64 dentro de cada acórdão) — o default `--page-size 20` é deliberado.
  ⚠️ `--thesaurus` **infla ~10×** (6.151 → 59.606); o número grande não é abundância.
  A base é **só 2º grau** (acórdão + monocrática), **sem 1º grau**, e está **corrente**.
  Matéria federal com origem no MT → `trf1`
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
- "TJTO" / "Tocantins estadual" / "Palmas" / "Araguaína" → `tjto` → leia `CLAUDE-TJTO.md`.
  Juizado Especial / Turma Recursal tocantinense → `tjto --origem turmas`; Justiça Comum é
  `--origem comum` (o default `--origem ambas` **mistura os dois**). Em TO o Juizado é
  **8,3%** do acervo — padrão TJAL, oposto de TJAC/TJAM/TJRO. ⚠️ **Não confunda a
  competência `TURMAS RECURSAIS` (Juizado, 20.785) com `TURMAS DAS CAMARAS CIVEIS`
  (2º grau comum, 186.534)** — os dois começam por "TURMAS" e são opostos.
  ✅ **Tem 1º GRAU**: `tjto -t sentenca` (254.501 sentenças) — pedido que só TJTO, TJES,
  TJPB e TJRO atendem. ⚠️ **Mas sentença e monocrática só existem de 2024 em diante**
  (acórdão vai a 2019); pedido histórico nesses tipos devolve pouco, e o zero não é
  ausência de decisão.
  🔴 **O ESPAÇO ENTRE TERMOS É OR, não AND** (provado: 1.807 + 29.310 − 1.257 = 29.860).
  Query de duas palavras devolve a UNIÃO. **Use `E` ou `AND`.**
  🔴 **`NAO` sem acento NÃO é operador e INFLA** (30.282 contra 550 da exclusão correta,
  sem sintoma) — escreva `NÃO` acentuado ou `NOT`. É o oposto do TJAC/TJAM/TJAL.
  `ADJ`/`PROX` são ignorados; `"frase exata"`, `*` e `$` funcionam.
  ⚠️ **NÃO avise sobre acento na query** — o índice normaliza; o acento só importa no `NÃO`.
  🔴 **Só ACÓRDÃO tem ementa**: sentença e monocrática trazem a **decisão inteira** e vêm
  **sem relator**. O crawler marca `semEmenta` — não apresente esse texto como ementa.
  ⚠️ A aba "Decisões Monocráticas" (a maior, 597.990) **mistura despacho de mero
  expediente** ("INTIME-SE") com decisão de mérito — não relate esse total como jurisprudência.
  🔴 **A base só tem data de JULGAMENTO** (o par é autuação/julgamento): não existe data de
  publicação. **Nunca apresente a data do TJTO como publicação.**
  ✅ **Ementa íntegra, CITAÇÃO OFICIAL pronta e PERMALINK público** (`documento.php?uuid=`,
  confirmado em aba limpa) vêm sem captcha; o permalink abre o **inteiro teor**.
  🔴 O que identifica o julgado é o **uuid**, não o nº do processo (um processo tem vários).
  ⚠️ **O permalink de BUSCA mente sobre o recorte**: por GET o portal ignora todos os
  filtros em silêncio e só o termo sobrevive. Nunca mande a URL da busca como prova.
  Matéria federal com origem no TO → `trf1`; trabalhista → `trt10`
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
- **Contas públicas do PARANÁ** ("o que o Tribunal de Contas do PR decidiu", licitação e
  contrato administrativo, aposentadoria/admissão de servidor **estadual ou municipal**,
  contas de prefeito, LRF, terceirização na administração) → `tcepr` → leia
  `CLAUDE-TCEPR.md`. É instância de **controle externo**, não Judiciário: para a mesma
  matéria judicializada, o caminho é `tjpr` (estadual) ou `trf4` (federal).
  🔴 **Não ofereça o `tcepr` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  ✅ **O Paraná não tem TCM**: conta de prefeitura, câmara e autarquia municipal está
  aqui (o combo de município traz os **399**). A armadilha "procure o TCM" vale para SP,
  RJ, BA, GO e PA — não para o PR.
  🔴 **Os operadores são os INGLESES** (`OR`, `NOT`, `"frase exata"`, `*`), e a tela
  anuncia os portugueses, que **não funcionam**: `ou` e `não` são **ignorados** e a busca
  vira `E` (AND) — você pede união e recebe interseção, com número plausível e sem
  sintoma (`nepotismo ou licitação` = 179; com `OR` = 17.763). O espaço é `E` (AND).
  ⚠️ `?` **zera** em silêncio e `*` **degenera** (devolve menos que o termo inteiro).
  ⚠️ **NÃO avise sobre acento** — o índice normaliza.
  🔴 **Sem `-q` o resultado vem SEM inteiro teor** (medido 0% contra 100% com termo):
  buscar só por filtro devolve ementa e tema, não o texto. Para o texto, use
  `--fetch-inteiro-teor`.
  🔴 **As duas pontas da data falham de maneiras opostas**: `-di` sozinho **zera** a
  busca e `-df` sozinho é **ignorado** (acervo inteiro). Mande as duas — o crawler avisa.
  ⚠️ E a janela é da **data da SESSÃO**; a publicação existe, é distinta e **não é
  filtrável**. Nunca apresente o recorte do TCE-PR como sendo por publicação.
  ⚠️ **Não há número CNJ nem DataJud** (contas não é Judiciário): o processo é
  `<sequencial>/<ano>`, e a verificação é `./bin/jur tcepr -n "393433/2026"`.
  🔴 Um processo rende **vários** acórdãos — quem identifica o julgado é o `id`.
  ✅ **Há permalink público por documento** (confirmado em aba limpa) e **citação
  oficial pronta**; 🔴 mas **não existe URL de busca** — nunca mande "o link da busca"
  do TCE-PR como prova.
  ⚠️ O inteiro teor do card vem **fora de ordem** (remontado por janelas de match,
  começa pelo bloco de assinatura): para leitura fiel, use o PDF
- **Contas públicas de SANTA CATARINA** ("o que o Tribunal de Contas de SC decidiu",
  licitação e contrato administrativo, ato de pessoal estadual ou municipal, contas de
  prefeito, tomada de contas, representação) → `tcesc` → leia `CLAUDE-TCESC.md`. É
  instância de **controle externo**, não Judiciário: para a mesma matéria judicializada,
  o caminho é `tjsc` (estadual) ou `trf4` (federal).
  🔴 **Não ofereça o `tcesc` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  ✅ **Santa Catarina não tem TCM**: conta de prefeitura, câmara e autarquia municipal
  está aqui (os 295 municípios). A armadilha "procure o TCM" vale para SP, RJ, BA, GO e
  PA — não para SC.
  🔴 **O ESPAÇO ENTRE TERMOS É `OR` (UNIÃO) E NÃO EXISTE `AND`.** Provado por aritmética
  (merenda 497 + escolar 4.774 − união 4.783 = interseção 488). Query de duas palavras
  devolve a união, e o número grande é o termo mais comum, não abundância de julgado.
  **Nenhum operador booleano funciona**: `E`/`OU`/`OR` são **ignorados** e
  `AND`/`NOT`/`NAO` viram palavra e **INFLAM** (`NAO` = 26.057 contra 9.446). O único
  recurso é a **frase exata entre aspas** — `-q "\"merenda escolar\""`.
  🔴 **Termo com menos de 3 caracteres é DESCARTADO e devolve o ACERVO INTEIRO**
  (27.783, HTTP 200). A tela anuncia "mínimo 3 caracteres" e o servidor não recusa:
  ignora o termo. **Nunca relate esse total como resultado da busca.**
  ⚠️ Curinga (`*`, `$`, `?`) **não existe** — é descartado em silêncio.
  ⚠️ **NÃO avise sobre acento** — o índice normaliza.
  🔴 **A maioria dos documentos vem SEM ementa**: o texto do card é o **trecho onde o
  termo casou** (começa no meio da frase). O crawler marca `semEmenta` e guarda em
  `trechoMatch` — **não o apresente como ementa nem como acórdão inteiro**. Para o texto
  integral, `--fetch-inteiro-teor`.
  🔴 **Há TRÊS eixos de data com coberturas muito diferentes**: autuação **100%**,
  publicação ~79% e **sessão ~37%** — filtrar por sessão descarta 63% em silêncio. O
  default é `--eixo-data autuacao`. ✅ As duas pontas funcionam sozinhas.
  🔴 **A citação pronta chama `dataDecisao` de "Sessão"** num documento cujo campo de
  sessão é null — **nunca apresente a data da citação do TCE-SC como data de sessão**.
  🔴 **`--singular` não particiona a base** (true + false < total): o que ele recorta é a
  aba "Ratificadas por Colegiado", e omitir a flag devolve um superset que a própria tela
  não mostra.
  ⚠️ **O portal tem 5 bases em três backends, e o comando cobre as cinco** — mas
  **escolher a base errada devolve zero que não é ausência de julgado**:
  `--base deliberacoes` (default, 27.783), `--base enunciados` (2.564, com força
  normativa), `--base informativos` (2.045) e `--base sumulas`. `licitação` dá 9.368 em
  deliberações, 352 em enunciados e **0** em informativos e súmulas.
  🔴 **A base de súmulas do TCE-SC são 3 documentos distintos** (4 registros, 2
  duplicados), embutidos no JavaScript do portal — não há endpoint. Não prometa um
  acervo de súmulas catarinense.
  🔴 **Enunciado de consulta tem vigência** (`st_valido`): o crawler marca `vigente` e
  avisa — **não cite enunciado revogado como orientação atual**.
  ✅ **Inteiro teor é PDF público com permalink** (confirmado em requisição limpa) e a
  **citação oficial vem pronta**; 🔴 mas **não existe URL de busca** — nunca mande "o link
  da busca" do TCE-SC como prova, e quem identifica o julgado é o `identificadorDocumento`,
  não o número do processo.
  ⚠️ **Não há número CNJ nem DataJud** (contas não é Judiciário): a verificação é
  `./bin/jur tcesc -n "REP 26/00137305"` (aceita também `2600137305`)
- **Contas públicas do RIO GRANDE DO SUL** ("o que o Tribunal de Contas do RS decidiu",
  licitação e contrato administrativo, ato de pessoal estadual ou municipal, contas de
  prefeito, tomada de contas, recurso de embargos) → `tcers` → leia `CLAUDE-TCERS.md`. É
  instância de **controle externo**, não Judiciário: para a mesma matéria judicializada,
  o caminho é `tjrs` (estadual) ou `trf4` (federal).
  🔴 **Não ofereça o `tcers` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  ✅ **O RS não tem TCM**: conta de prefeitura, câmara e autarquia municipal está aqui
  (provado por contagem no acervo). A armadilha "procure o TCM" vale para SP, RJ, BA, GO
  e PA — não para o Rio Grande do Sul.
  🔴 **O ESPAÇO ENTRE TERMOS É OR** (provado: 730 + 5.007 − 5.036 = 701 = `AND`). Query
  de duas palavras devolve a UNIÃO. **Use `AND`.**
  🔴 **Os operadores que a própria tela anuncia estão TODOS quebrados**: `E`, `OU`,
  `NÃO`, `NAO` e `MESMO` **inflam até saturar em 10.000+** (que se lê como "tema
  vastíssimo"), `PROX` é ignorado e o curinga `$` **zera**. Os que funcionam são os
  **ingleses** — `AND`, `OR`, `NOT`, `"frase exata"`. O crawler avisa; repasse.
  ⚠️ **NÃO avise sobre acento** (o índice normaliza) e termo curto **não** é descartado.
  🔴 **O total SATURA em 10.000 — mas o servidor declara isso** (`total.relacao`). É o
  primeiro tribunal do repo em que a saturação vem no payload. **Não relate 10.000 como
  contagem**; refine com `-di/-df` ou `--ano`.
  🔴 **A EMENTA DESAPARECE A PARTIR DE 2020**: 2019 = 20/20 com ementa, 2020 em diante
  = 0/20. Pedido de jurisprudência **recente** do TCE-RS volta **sem ementa**, e isso não
  é defeito do crawler. ✅ O que existe no lugar é o **texto integral**, que já vem na
  busca (campo `relatorio`, ~12,7 mil chars, conferido contra o PDF).
  🔴 **O campo `texto` degenera para um rótulo de uma palavra em 11%** ("Multa",
  "Provimento") — **nunca o apresente como ementa**. O crawler marca `dispositivoDegenerado`.
  🔴 **NÃO EXISTE DATA DE PUBLICAÇÃO** — o único eixo é a data da **sessão**. `-dpi/-dpf`
  são alias que avisam. Nunca apresente a data do TCE-RS como publicação.
  ✅ As **duas pontas** da janela funcionam sozinhas, e a janela no-op não altera a
  contagem. ⚠️ Só ISO na API — o crawler converte DD/MM/YYYY sozinho.
  🔴 **Número de processo: só dígitos.** A máscara **derruba com HTTP 500**, não devolve
  zero. O `-n` normaliza (`./bin/jur tcers -n "013714-0200/25-3"`).
  ⚠️ **Não há CNJ nem DataJud** (contas não é Judiciário), e quem identifica o julgado é
  o `id`, não o número do processo.
  🟢 **Os autos INTEIROS são públicos** (índice de peças por processo) — nenhum outro
  tribunal do repo expõe isso; ⚠️ mas parte das peças vem `publico: false`.
  ⚠️ **Não existe URL de busca** — nunca mande "o link da busca" do TCE-RS como prova.
  ⚠️ **Quatro bases** (`--base decisoes|sumulas|pareceres|informacoes`): a errada devolve
  zero que não é ausência de julgado
- **Contas públicas de SÃO PAULO** ("o que o Tribunal de Contas de SP decidiu",
  licitação e contrato administrativo, ato de pessoal estadual ou municipal, contas de
  prefeito, repasse ao terceiro setor, merenda e transporte escolar) → `tcesp` → leia
  [`CLAUDE-TCESP.md`](CLAUDE-TCESP.md). É instância de **controle externo**, não
  Judiciário: para a mesma matéria judicializada, o caminho seria `tjsp` (🔴 sem acesso)
  ou `trf3` (federal).
  🔴 **Não ofereça o `tcesp` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  🔴 **A CAPITAL NÃO ESTÁ NESTA BASE — é a ressalva mais importante do tribunal.** O
  TCE-SP cobre o Estado e os **644 demais municípios**; **São Paulo capital é do
  TCM-SP**, órgão separado que este repo **não cobre**. Pedido sobre contas da
  Prefeitura de São Paulo **não tem resposta aqui** — diga isso em vez de entregar o
  número baixo como se fosse o acervo. (A armadilha do TCM é falsa em PR, SC e RS;
  aqui ela é **verdadeira**.) ⚠️ E não há combo de município para conferir: o portal
  não filtra por município.
  🔴 **OS OPERADORES SÃO QUATRO CAIXAS, NÃO INLINE** — primeiro portal do repo assim.
  `-q` é E (AND), `--frase` é a frase exata, `--qualquer` é OU e `--excluir` é NÃO,
  e a aritmética **fecha exata** (17.806 + 89.312 − 16.707 = 90.411 = OR).
  ⚠️ **Dentro de `-q`, `OU` é DESCARTADO e a busca continua AND**: você pede união e
  recebe interseção (16.707 em vez de 90.411), com número plausível e **sem sintoma**.
  `AND`/`OR` inline **zeram**; `NAO` inline vira palavra. ✅ Aspas e `*` funcionam.
  ⚠️ **NÃO avise sobre acento** — o índice normaliza.
  🔴 **NÃO EXISTE EMENTA no TCE-SP, em tipo nenhum.** O que o portal mostra é um
  **trecho** com o termo destacado (~600–1.200 chars contra ~4.900 do PDF). O crawler
  marca `semEmenta` em **todos** — **não apresente o trecho como ementa nem como
  acórdão inteiro**. Para o texto, `--fetch-inteiro-teor` (PDF público).
  🔴 **UM JULGADO DECIDE VÁRIOS PROCESSOS**, e a listagem devolve uma linha por
  **processo**: 100 linhas = 84 processos = **35 documentos** (fator 2,86×). Logo
  "1.699 registros" **não é 1.699 acórdãos** — relate também o
  `totalDeduplicadoEstimado`. Quem identifica o julgado é o **id do PDF**, não o
  número do processo (e o número impresso no PDF nem é o da linha que o trouxe).
  🔴 **Súmula e Boletim vêm SEM metadados** (todas as colunas vazias): são a família
  "editorial", com PDF em outro host. ⚠️ E **"Sentença" aqui não é 1º grau do
  Judiciário** — é decisão singular de Conselheiro. **Não anuncie 1º grau no TCE-SP.**
  ✅ **As datas são o filtro mais bem-comportado do repo**: dois eixos reais
  (`-dpi/-dpf` publicação, `-di/-df` autuação), **as duas metades funcionam sozinhas**,
  a janela no-op não altera nada e a aritmetica fecha. ⚠️ Só DD/MM/YYYY — ISO dá 400.
  ✅ **Três permalinks públicos**, caso raro: a **URL da busca** (que de fato executa a
  busca em aba limpa, ao contrário do TJPE e do TJTO), o `exibir?proc=` e o PDF.
  🔴 **Relator e data de publicação NÃO vêm na busca** — só no `exibir?proc=`; use
  `--detalhes` (1 GET por processo). ⚠️ E **não há citação oficial pronta**.
  ⚠️ **Página fixa em 10** (`size`/`limit` ignorados): varredura funda é cara.
  ⚠️ **Não há CNJ nem DataJud**, e — diferente do TCE-RS — **não há Dados Abertos**:
  não existe plano B. A verificação é `./bin/jur tcesp -n "1681/989/20"`, e o número
  **exige a máscara** (sem ela o zero é silencioso)
- **Contas públicas do RIO DE JANEIRO** ("o que o Tribunal de Contas do RJ decidiu",
  licitação e contrato administrativo, ato de pessoal estadual ou municipal, contas de
  prefeito, representação) → `tcerj` → leia [`CLAUDE-TCERJ.md`](CLAUDE-TCERJ.md). É
  instância de **controle externo**, não Judiciário: para a mesma matéria judicializada,
  o caminho é `tjrj`/`tjrj-ejuris` (estadual) ou `trf2` (federal).
  🔴 **Não ofereça o `tcerj` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  🔴 **A CAPITAL NÃO ESTÁ NESTA BASE, e isso foi medido**: o Município do Rio de Janeiro é
  do **TCM-RJ**, órgão separado que este repo **não cobre**. O combo de município traz
  **91 dos 92 municípios** fluminenses — falta exatamente a capital. Pedido sobre contas
  da Prefeitura do Rio **não tem resposta aqui**; diga isso em vez de entregar o número
  baixo como se fosse o acervo. (A armadilha do TCM é falsa em PR, SC e RS; aqui, como em
  SP, é **verdadeira**.)
  🔴 **A BASE É CURADA E PEQUENA: 1.089 documentos.** É a seleção do Serviço de
  Jurisprudência (SJU) a partir das decisões plenárias — **não é o acervo de decisões do
  TCE-RJ**. Nunca relate 1.089 como "a jurisprudência do Tribunal de Contas do RJ". ✅ Em
  compensação **100% têm ementa**, e ela vem **íntegra na busca**.
  ⚠️ **A base começa em jul/2021** (mais recente: voto de 22/06/2026): pedido histórico
  anterior a 2021 não tem resposta aqui, e o zero é a base, não o tribunal.
  🔴 **ACENTO É OBRIGATÓRIO e o índice NÃO normaliza** (`licitacao` = 0 contra
  `licitação` = 267) — padrão TJMS/TJBA/TJPB. Número zero é quase sempre acento faltando.
  🔴 **O `NÃO` NÃO EXCLUI — ele DEFLACIONA**: vira palavra e entra no AND
  (`licitação NÃO pessoal` = 5 contra 260 da exclusão correta; sem acento zera). **Não
  existe operador de exclusão neste portal.** ✅ `E` e `OU` funcionam com aritmética
  exata (267 + 180 − 7 = 440) e o espaço é `E` (AND). 🔴 `AND` e `OR` **derrubam a busca
  com HTTP 500** — sintoma visível. Curinga não existe. O crawler avisa; repasse.
  🔴 **O filtro de relator chama-se `--conselheiro`**: o campo `relator` da API é
  **ignorado em silêncio** (devolve o acervo inteiro, inclusive com nome inventado) —
  apesar de `relator` existir no payload de resposta.
  ✅ **Permalink público em PDF** por acórdão, confirmado em requisição limpa, sem
  captcha em etapa nenhuma. 🔴 Mas **não existe URL de busca** — nunca mande "o link da
  busca" do TCE-RJ como prova — e **não há citação oficial pronta**.
  🔴 **Quem identifica o julgado é o `id` (jurisprudenciaId), não o processo** (1.089
  registros em 998 processos), e **dois registros podem ser teses distintas do MESMO
  acórdão**, logo do mesmo PDF. Não conte PDFs como julgados.
  ⚠️ **Não há data de publicação** — o eixo é a data do **voto** (`-dpi/-dpf` são alias).
  ⚠️ **Não há CNJ nem DataJud** (contas não é Judiciário) e **não existe filtro por
  número na API**: `./bin/jur tcerj -n "103.885-0/2026"` recorta no cliente, e a resposta
  negativa **não prova que o processo não existe** — prova que não há julgado
  *selecionado* para ele. Repasse essa ressalva
- **Contas públicas da BAHIA** ("o que o Tribunal de Contas da BA decidiu", licitação e
  contrato administrativo, ato de pessoal **estadual**, contas de governo, denúncia,
  auditoria) → `tceba` → leia [`CLAUDE-TCEBA.md`](CLAUDE-TCEBA.md). É instância de
  **controle externo**, não Judiciário: para a mesma matéria judicializada, o caminho é
  `tjba` (estadual) ou `trf1` (federal).
  🔴 **Não ofereça o `tceba` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado, não ausência de julgado.
  🔴 **OS MUNICÍPIOS NÃO ESTÃO NESTA BASE — nem Salvador.** Todos os 417 municípios
  baianos são do **TCM-BA**, órgão separado que este repo **não cobre**. Pedido sobre
  contas de prefeitura baiana **não tem resposta aqui**; diga isso em vez de entregar o
  número baixo como se fosse o acervo. (A armadilha do TCM é verdadeira em BA, SP, RJ,
  GO e PA; é falsa em PR, SC e RS.) ⚠️ O que foi medido é que **não há combo de
  município** — consistente com a competência, mas é a ausência do filtro que está
  medida, não a do acervo.
  🔴 **O TERMO É UMA FRASE LITERAL — não existe operador booleano E O ESPAÇO NÃO É
  CONECTIVO.** `E`, `AND`, `OU`, `OR`, `NAO`, `NOT` e o espaço puro **zeram todos**
  (`nepotismo súmula` = 0), e **as aspas derrubam a busca com HTTP 500**. ✅ Mas duas
  palavras funcionam quando são frase real do texto (`de nepotismo` = 4, `prática de
  nepotismo` = 2). **Esse zero não é ausência de jurisprudência sobre os dois temas** —
  é a ausência daquela sequência. Para cruzar dois conceitos, rode duas buscas e cruze.
  ✅ O casamento é por **palavra inteira** e `*` é curinga de verdade (`nepotism` = 0 ×
  `nepotism*` = 7); o `$` zera. ⚠️ **NÃO avise sobre acento** — o índice normaliza.
  🔴 **NÃO EXISTE PAGINAÇÃO, e `qtRegistros` é um limiar que RECUSA**: acima dele o
  servidor devolve **HTTP 400 e ZERO documento**, não uma primeira página — e o número
  da mensagem ecoa o valor pedido. O crawler manda 5.000 e, se estourar, **fatia por
  ano** e avisa quais ficaram de fora. ✅ O total é **exato**, não saturado.
  ⚠️ **A API é lenta** (38–110 s numa busca larga); isso não é bloqueio.
  🔴 **A EMENTA DEPENDE DO TIPO, e o tipo dominante é o que não tem**: **Voto é 66% do
  acervo e tem ementa em 0%**; Acórdão 92%, resoluções de Câmara 100%, total 28%. O
  crawler marca `semEmenta` — **não apresente o texto desses documentos como ementa**.
  ✅ Para ementa, peça `-t ACRDO`.
  ✅ **O texto integral já vem na busca** (conferido contra o PDF): `--fetch-inteiro-teor`
  só grava o PDF em disco.
  🔴 **NÃO EXISTE PERMALINK por documento** — o acesso é POST, não há URL colável. Nunca
  invente link de decisão do TCE-BA. ⚠️ E o permalink de **busca** existe pela metade
  (`?termo=` funciona, mas **nenhum outro filtro entra pela URL**): mandá-lo como prova
  omite o recorte em silêncio. Quem identifica o julgado é o **`id`**, não o processo
  (1.879 documentos em 1.348 processos).
  🔴 **Não existe filtro de data nem data de publicação** — só combos de **ano**
  (`--ano-decisao`, 2001–2026). Nunca apresente a data do TCE-BA como publicação.
  🔴 **A consulta por número casa por SUBSTRING** (`405` arrasta `003405` e `004050`):
  informe sempre o ano — `./bin/jur tceba -n "TCE/000405/2025"`. ⚠️ Não há CNJ nem
  DataJud, e a negativa não prova que o processo não existe
- **Contas públicas estaduais de PERNAMBUCO** (licitação e contrato administrativo,
  ato de pessoal, contas de governo e de gestão, denúncia, auditoria) → `tcepe` → leia
  [`CLAUDE-TCEPE.md`](CLAUDE-TCEPE.md). É instância de **controle externo**, não Judiciário.
  ✅ **Pernambuco NÃO tem TCM**: as contas dos 184 municípios — inclusive as do **Recife** —
  estão nesta base (medido: 184 "Prefeitura ..." no combo de unidades, e a Prefeitura da
  Cidade do Recife tem 2.072 deliberações). É o oposto de BA, SP, RJ, GO e PA.
  🔴 **Não ofereça o `tcepe` para matéria cível, penal, trabalhista ou previdenciária** —
  ele não tem esse acervo, e o zero seria o tribunal errado.
  🔴 **Nunca escreva `A OU B`**: não há operador booleano, o espaço já é `E` implícito e
  `OU` é palavra comum que RESTRINGE (137 contra 139 do AND). Para unir, rode duas buscas.
  🔴 **Escreva o termo ACENTUADO**: `licitacao` = 40 contra `licitação` = 13.636 — e o erro
  não aparece como zero, aparece como um acervo pequeno e plausível.
  🔴 **Não há ementa nesta base**: o que vem é o texto integral, e ele já chega na busca.
  ⚠️ Ao citar, confira o host do link: 49% dos julgados (era SIGA) só expõem
  `portalintranet.tce.pe`, que é **NXDOMAIN** — esses se verificam por `jur tcepe -n <processo>`.

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
