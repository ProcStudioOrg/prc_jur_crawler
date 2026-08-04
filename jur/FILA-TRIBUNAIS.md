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
| 3 | **TJAM** | AM | `https://consultasaj.tjam.jus.br/cjsg/consultaCompleta.do` → **200** | pendente |
| 4 | **TJAL** | AL | `https://www2.tjal.jus.br/cjsg/consultaCompleta.do` → **200** | pendente |

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

## Bloco 2 — ESAJ bloqueados, exigem descoberta (2 alvos)

| # | Alvo | UF | Entrada | Status |
|---|---|---|---|---|
| 5 | **TJBA** | BA | `esaj.tjba.jus.br` resolve (168.228.240.160) mas **conexão morre (000)**. Descobrir pelo portal `www.tjba.jus.br` (301) | pendente |
| 6 | **TJRN** | RN | `esaj.tjrn.jus.br/cjsg/` → **403**. Testar se é UA/geo; descobrir portal próprio | pendente |

## Bloco 3 — TJs sem pista (10 alvos)

Nenhum tem URL de jurisprudência na base — o campo `portal` do `tribunais.json` é
**consulta processual, não jurisprudência**. Comece pelo Passo 0, depois
`method_court_discovery.md` a partir do portal oficial `www.<tribunal>.jus.br`.

| # | Alvo | UF | Sistemas de tramitação (pista, não garantia) | Status |
|---|---|---|---|---|
| 7 | **TJPE** | PE | PJe, Projudi | pendente |
| 8 | **TJES** | ES | PJe, Projudi | pendente |
| 9 | **TJMT** | MT | PJe, Projudi | pendente |
| 10 | **TJPB** | PB | PJe, Projudi | pendente |
| 11 | **TJPI** | PI | PJe, Projudi | pendente |
| 12 | **TJRO** | RO | PJe, Projudi | pendente |
| 13 | **TJSE** | SE | Próprio (1ª e 2ª) — sistema caseiro, pode ter portal próprio | pendente |
| 14 | **TJTO** | TO | e-Proc, Projudi — irmão do TJRS/TJSC/TRF4 (e-Proc) | pendente |
| 15 | **TJAP** | AP | Tucujuris, PJe | pendente |
| 16 | **TJRR** | RR | PJe, Projudi | pendente |

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
