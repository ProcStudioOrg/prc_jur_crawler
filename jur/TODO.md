# TODO — próximos alvos do `jur`

Duas frentes: os **judiciais** que faltam (JURCRAWLERS) e as **instâncias
administrativas**. Status vivo dos judiciais:
[`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md). Para mapear
qualquer alvo novo, use a skill `codegen` e cumpra o Passo 0 (procurar API
oficial e portal novo antes do DevTools — a lição do TJCE/TJMG/TJDFT).

## 1. Judiciais (JURCRAWLERS) — bloqueios residuais

Em ordem de alavanca (ver memória do projeto e o placar):

- **TJSP**: ✅ voltou a funcionar via Playwright; reCAPTCHA invisível é aceito,
  mas a integração depende de browser. Ver [`CLAUDE-TJSP.md`](CLAUDE-TJSP.md).
- **ESAJ restantes** (TJAL, TJAM, TJMS, TJAC): cjsg responde 200 e o Playwright
  headless passa no reCAPTCHA v3 — dá para um crawler ESAJ parametrizado por
  host. Mas procure o portal próprio de cada um antes, como no TJCE.
- **TJBA** (host de cjsg não resolve) e **TJRN** (403): exigem descoberta separada.
- **TJRJ-eJURIS, TJRO**: reclassificar e corrigir regressões detectadas no smoke;
  ambos têm cobertura documentada, mas falharam no teste desta rodada.
- **TJRN, TJSE, TJMA**: sem acesso confirmado; não há atalho estadual implementado.

### 1.1 TNU/CJF — encerrado para este projeto

Decisão registrada: **não investir mais tempo em TNU/CJF**. A cobertura é
desatualizada/congelada e não substitui os portais próprios; qualquer menção a
TNU/CJF deve ser tratada como histórico, não como fonte atual de jurisprudência.
As demais coberturas federais/estaduais tornam essa rota irrelevante para fechar
o produto.

## 2. Instâncias administrativas

Julgados administrativos que não passam pelo Judiciário mas orientam a advocacia
(contas, previdenciário, tributário). Hoje só o **TCU** (🟢 `jur tcu`).

### 2.1 CARF — ✅ FEITO em 27/07/2026

Mapeado, codado (🟢 `jur carf`), testado (11/11) e registrado na cobertura —
ver [`CLAUDE-CARF.md`](CLAUDE-CARF.md). Sobras opcionais do CARF: interface
antiga (sincon JSF) e as Súmulas CARF/Pareceres Vinculantes (páginas estáticas),
não mapeadas de propósito.

### 2.2 CRPS — 🔴 BLOQUEADO em 31/07/2026 (não re-tente o perfil dedicado)

> **Esta seção abaixo está SUPERADA.** O que ela chama de "plano B" foi construído
> (`jur crps --login`) e **falhou na tentativa real**: captcha no Gov.br **e** recusa
> por navegador desconhecido — o Gov.br valida o dispositivo, então perfil novo e
> isolado é exatamente o que ele rejeita. A hipótese de que "o gate pode estar só em
> parte do fluxo" também caiu: o HTTP 200 sem cookie era a **tela de login**.
> Único caminho restante: **CDP contra o Chrome pessoal já logado**, não testado,
> operação assistida. **Estado atual e ressalvas: [`CLAUDE-CRPS.md`](CLAUDE-CRPS.md).**
> Mantido abaixo só como registro do raciocínio original.

<details>
<summary>Plano original (superado)</summary>

#### CRPS — Conselho de Recursos da Previdência Social (INSS)

Busca de julgados/pareceres do contencioso previdenciário administrativo.
**Hard gate: exige login Gov.br** (e-Recursos). O repo não automatiza captcha
nem credencial — o caminho é **reaproveitar um perfil de Chrome já logado
localmente**, que é simples com Playwright:

1. **Perfil persistente** — `chromium.launchPersistentContext(userDataDir,
   {channel: 'chrome'})` apontando para um perfil dedicado (fazer o login
   Gov.br uma vez, headed; as sessões seguintes reutilizam os cookies).
   Ressalva: o diretório de perfil tem lock — não usar o perfil principal com
   o Chrome aberto; criar um perfil só do crawler.
2. **CDP** — Chrome real aberto com `--remote-debugging-port=9222` e
   `chromium.connectOverCDP()`: zero problema de lock, sessão compartilhada
   ao vivo. Bom para operação assistida.
3. Importar só os cookies para headless (skill `/setup-browser-cookies` do
   gstack) — frágil para Gov.br, que amarra sessão a mais do que cookie;
   preferir 1 ou 2.

**Link correto da busca de julgados (fornecido pelo usuário em 27/07/2026):**
`https://jurisprudenciacrps.dataprev.gov.br/jurisprudencia` — probe do mesmo dia
respondeu **HTTP 200 sem redirect** para curl sem cookie; o hard gate de Gov.br
pode estar só em parte do fluxo (download/inteiro teor?) — confirmar no
mapeamento. Enunciados e súmulas do CRPS são públicos e podem ser um primeiro
crawler sem login.

</details>

### 2.3 TCEs — Tribunais de Contas Estaduais

Pedidos pelo usuário: **PR, SC, RS, SP, RJ, MG, BA**.
Sugeridos para fechar os estados grandes: **PE, CE, GO, DF (TCDF), PA, ES**
(e MT, se a régua for PIB do agro).

| Alvo | UF | Observação |
|---|---|---|
| TCE-PR | PR | |
| TCE-SC | SC | |
| TCE-RS | RS | |
| TCE-SP | SP | ⚠️ o TCE-SP **não** cobre a capital — contas municipais de SP capital são do **TCM-SP** |
| TCE-RJ | RJ | idem: capital carioca é do **TCM-RJ** |
| TCE-MG | MG | |
| TCE-BA | BA | contas municipais baianas são do **TCM-BA** (todos os municípios) |
| TCE-PE | PE | sugerido |
| TCE-CE | CE | sugerido (o TCM-CE foi extinto em 2017 — o TCE absorveu) |
| TCE-GO | GO | sugerido; municípios goianos são do **TCM-GO** |
| TCDF | DF | sugerido |
| TCE-PA | PA | sugerido; municípios paraenses são do **TCM-PA** |
| TCE-ES | ES | sugerido |

Nota de escopo: onde existe TCM (SP, RJ, BA, GO, PA), decidir se o TCM entra
no catálogo junto — senão a busca de "contas municipais" no TCE devolve zero
que se lê como "não há julgado", a armadilha clássica do repo.

Já há 10 TCEs e o TCDF mapeados no catálogo. Ainda faltam sondar/cobrir
16 TCEs estaduais e os TCMs de BA, GO, PA, RJ e SP; a prioridade deve ser
definida depois de verificar se o Jusbrasil oferece fonte licenciada para esses
acervos.

## 3. `jur-web/` — pendências

O [`jur-web/`](../jur-web/) nasceu em 03/08/2026 com 29 acervos (FALCÃO, CARF,
TJPR, TJGO). Duas coisas ficaram para depois:

- [ ] **Validar no navegador de verdade.** A medição prova que os portais
      respondem a GET puro com `curl`/`fetch`; falta confirmar que o `web_fetch`
      do Claude.ai entrega a resposta legível (HTML → markdown sem perder a
      ementa, JSON sem truncar). **Até isso ser feito o `jur-web/` não é 100%.**
- [ ] **Empacotar como plugin do marketplace** — `plugins/jur-web/` + entrada no
      `.claude-plugin/marketplace.json`, para instalar por `/plugin install`.
      Hoje só existe a pasta; depende da validação acima.
- [ ] Reavaliar os reprovados quando os portais mudarem: TRF6 e TJRJ aceitam GET
      mas **não buscam** (devolvem listagem fixa) — se um dia passarem a filtrar,
      entram sem trabalho novo. Basta rodar `node jur-web/medicao/medir.mjs`.
