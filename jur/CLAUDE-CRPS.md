# CLAUDE-CRPS — Conselho de Recursos da Previdência Social

**Status: 🔴 bloqueado — captcha + validação de dispositivo do Gov.br.** Não existe busca
funcionando, e a tentativa de contornar com perfil de Chrome dedicado **já foi feita e
falhou em 31/07/2026** (ver seção abaixo). Não prometa jurisprudência do CRPS ao usuário
enquanto esta linha estiver aqui, e não re-tente o caminho do perfil dedicado.

Portal: `https://jurisprudenciacrps.dataprev.gov.br/jurisprudencia`

## O que é

Contencioso administrativo previdenciário: as Juntas de Recursos e as Câmaras de
Julgamento que revisam decisões do INSS. **Não é Judiciário** — para a mesma matéria
já judicializada, o caminho são os `trf*` (federal) e, para tese, o `stj` (hoje 🔴).

## A ressalva que custa caro: HTTP 200 aqui NÃO é acesso

Medido em **31/07/2026**:

| Sonda | Resultado |
|---|---|
| `GET /jurisprudencia` (curl, sem cookie) | **200**, `text/html`, 170 KB |
| a mesma página no Playwright headless | **zero inputs, zero selects**, um botão: "Entrar com gov.br" |
| `GET /api/now/table/<qualquer>` | **401** `User is not authenticated` |
| `GET /api/now/sp/page?id=index` | 200, mas só descreve o widget de **login** |

O 200 é a **tela de login**. Um probe anterior (27/07/2026) leu esse 200 como "portal
aberto sem cookie" e a conclusão era falsa. **Prova de acesso não é código HTTP — é
achar o campo de busca.** É a mesma família de armadilha do reCAPTCHA do e-SAJ, que
devolve formulário vazio com 200.

O portal é um **ServiceNow** (Service Portal + AngularJS): `sp_min.jsx`, `GlideFlow.js`,
`*.jsdbx`, escopo `x_data7_*` (Dataprev). Isso importa porque ServiceNow tem API REST
documentada (`/api/now/table/...`) — que aqui responde 401, mas passa a ser o caminho
óbvio assim que houver sessão.

## Tentativa de 31/07/2026 — o perfil dedicado FALHOU

`jur crps --login` foi construído e rodado. **Não passou.** Relatado pelo usuário na
tentativa real (o `--status` e o caminho técnico funcionam; quem barra é o Gov.br):

1. **Captcha no login Gov.br** — o repo não resolve captcha. Invariante antiga, mesma
   parede do TJSP e do TJMA.
2. **O Gov.br recusou por ser navegador diferente** — e esta é a descoberta que muda o
   desenho: não basta a sessão persistir, o Gov.br **valida o dispositivo/navegador**.
   Um perfil de Chrome novo e dedicado é, para ele, um navegador desconhecido — logo o
   próprio isolamento que torna o perfil seguro é o que o faz ser rejeitado.

**Conclusão: a estratégia "perfil dedicado + login uma vez" está descartada para o
Gov.br.** Não insista nela numa próxima sessão — foi tentada e falhou por design da
contraparte, não por bug nosso.

### O que sobrou para tentar depois

**CDP contra o SEU Chrome já logado** — a opção 2 do plano original, ainda não testada.
É o único caminho que não esbarra nas duas barreiras acima, porque não cria navegador
novo nem exige login novo: reaproveita a sessão que já existe no navegador que o Gov.br
já conhece.

```bash
# no seu Chrome normal, já logado no Gov.br:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
# e no crawler: chromium.connectOverCDP('http://localhost:9222')
```

Ressalvas antes de tentar: exige o Chrome aberto e você logado no momento da rodada
(operação **assistida**, nunca cron), e o `--remote-debugging-port` abre uma porta de
controle total do navegador na máquina — não deixe ligado por padrão.

Se o CDP também falhar, o CRPS provavelmente é **inviável por automação** e a resposta
honesta ao usuário passa a ser: Enunciados públicos + `trf*` para matéria judicializada.

## Comandos disponíveis hoje

Nenhum faz busca. Os três servem para **destravar** o mapeamento.

```bash
./bin/jur crps --login      # abre o Chrome; VOCÊ autentica no Gov.br; já captura em seguida
./bin/jur crps --status     # a sessão salva ainda vive? grava a medição (curva de TTL)
./bin/jur crps --capturar   # com sessão viva: grava prints, campos e o XHR da busca
```

`-q` existe e **falha com mensagem explícita** — nunca devolve zero silencioso.

### Por que o login é humano e vai continuar sendo

Gov.br é a identidade pessoal do usuário, pode exigir 2FA e nível de conta prata/ouro.
O repo **não automatiza credencial nem captcha**. O desenho é: humano autentica uma vez,
a sessão fica num **perfil de Chrome dedicado** (`~/.config/jur-crps-profile`, chmod 700),
e as rodadas seguintes reaproveitam.

⚠️ **Nunca aponte `--profile-dir` para o Chrome pessoal**: `launchPersistentContext`
trava o diretório de perfil e falha com o navegador aberto. Perfil dedicado, sempre.

⚠️ **Credencial Gov.br não vai para `~/.config/procstudio-agents/env`.** O que persiste
é o perfil do browser. E o CRPS **não entra no cron** dos tribunais — a fila de
`FILA-TRIBUNAIS.md` não toca em nada que exija login.

### Por que `--login` já captura na mesma janela

A sessão Gov.br é o recurso escasso e o TTL é desconhecido. Não dá para "voltar depois
com calma": no primeiro login a captura sai inteira — prints, todos os `<select>` já
populados por AJAX, HTML e **o XHR de cada busca**, que é o contrato que o crawler vai
reproduzir. O crawler nasce depois, offline, a partir disso.

## O que ainda NÃO se sabe (e por isso não está codado)

Nada abaixo está presumido no código:

1. **TTL da sessão** — ServiceNow costuma derrubar por inatividade em ~30 min, mas quem
   manda é o SSO do Gov.br por cima. `--status` grava cada medição em
   `human-codegen/CRPS/sessao-ttl.log`; rodando de tempos em tempos sai a curva real.
   É o TTL que decide se o CRPS vira comando sob demanda ou entra em rotina.
2. **Contrato da busca** — endpoint, payload, paginação, teto de `size`.
3. **Inteiro teor** — vem no payload da busca (como TJCE/TJDFT/CARF) ou exige request extra.
4. **Acervo** — se cobre Juntas de Recursos e Câmaras de Julgamento juntas, e desde quando.

## Fora do portal: os Enunciados são públicos

Os Enunciados do CRPS (uniformizam a jurisprudência administrativa e vinculam os
conselheiros) estão no gov.br **sem login**, mas como **PDF único** — "Enunciados de
nº 1 a 19", atualizado 23/07/2026. É documento estático, não base pesquisável: não
justifica crawler, e serve como fonte para citação direta.

## Segurança da captura

`human-codegen/CRPS/.gitignore` barra `*.html`, `*.png`, `xhr-sessao.json` e o log de
sessão. Motivo: o HTML do ServiceNow embute o token CSRF `g_ck`, o XHR carrega payload
de sessão autenticada, e os prints mostram nome/CPF de quem logou. **Revise antes de
versionar qualquer coisa dessa pasta.**
