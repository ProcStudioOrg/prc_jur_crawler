# Kaizen — falhas, sentinela e relatos

O Kaizen faz o JurCrawler denunciar as próprias quebras: o crawler falha, o servidor guarda
a evidência (print, HTML, passo), classifica, agrupa por assinatura e manda ao FFD, onde vira
página de diagnóstico e um bloco pronto para o `jur-fixer`. Nada disso pode atrasar ou
derrubar uma busca: toda chamada ao Kaizen fica em `try/catch`, gzip e leitura são assíncronos
e nada segura vaga do pool.

Código: `jur/servidor/kaizen/*`, `jur/src/navegadorPreload.js`, `jur/servidor/executor.js`,
`jur/servidor/rotas/relatos.js`, `jur/servidor/issue-reporter/*`. Envs em
[`infra/README.md`](../infra/README.md#kaizen-falhas-sentinela-e-relatos).

## Fluxo de ponta a ponta

```
crawler (filho) --preload--> <job>.falha/ --executor--> jobs.js --kaizen.registrarErro--> outbox (SQLite) --> FFD
```

1. **Captura (no filho).** `navegadorPreload.js` envolve o Playwright. Quando o crawler falha
   (`process.exit(1)` ou exceção), grava em `<job>.falha/` (ao lado do `<job>.json`): `tela.png`,
   `pagina.html` e `meta.json` (URL sem query, título, passo, rota local/remota). A foto é
   **preguiçosa**: uma rejeição do Playwright só *marca* a página como pendente, sem I/O (cerca
   de 60 crawlers engolem rejeições esperadas em buscas que dão certo). A foto sai só no
   `close()` de página/contexto/navegador que ainda encontre página pendente, com a página
   viva, e limitada a 3 s. Sem página aberta, ou com `screenshot` travado, a saída acontece em
   até 8 s com o `meta.json` mesmo assim.
2. **Executor.** Define `JUR_FALHA_DIR` e `JUR_CAPTURA` para o filho (internas, não vão no
   `.env`). Consulta pura por número (`-n` sem `query`) roda com `JUR_CAPTURA=0`. No estouro do
   tempo manda `SIGUSR2` ao filho, que tem uma janela curta para gravar a captura antes do kill.
3. **Registro.** `jobs.js` chama `kaizen.registrarErro` na falha e `registrarConcluido` na
   conclusão. Cancelamento pelo usuário **não é falha**: a captura é apagada. Zero resultado
   com página normal também não é falha.
4. **Outbox.** O payload é enfileirado em `kaizen.db` (SQLite no diretório de dados) e a captura
   em disco é sempre apagada, com ou sem FFD configurado.
5. **FFD.** `POST ${KAIZEN_WEBHOOK_URL}/<source>` com `x-webhook-token`. Sources:
   `jur-diagnostico` (falhas, resgates, resumo da sentinela) e `user-issues` (relatos).

### Marcar o `passo`

O passo vem de `globalThis.__jurPasso` quando o crawler o define; sem ele, vira
`pagina:<host/caminho com dígitos como #>`. Em crawler novo, marque as etapas:

```js
globalThis.__jurPasso = 'submeter';   // antes de clicar em pesquisar
globalThis.__jurPasso = 'paginar';
```

Só `[a-z0-9_:./#-]`, até 80 caracteres (o resto vira `_`).

## Classes

Decididas por `classificar.js`, na ordem em que a evidência é mais confiável. A rota
(`local`/`remoto`, a partir do rótulo do navegador usado) importa: 403 no navegador local é o
IP do servidor bloqueado; no remoto, é o fornecedor.

| Classe | Quando |
|---|---|
| `fornecedor_remoto` | Sem navegador remoto disponível, falha de conexão ou erro do Kernel/Steel |
| `bloqueio_ip` | 403 / `ERR_CONNECTION_*` / `ERR_HTTP2_PROTOCOL_ERROR` em rota local |
| `captcha` | Texto de captcha, turnstile ou "verificação ainda não foi concluída" |
| `timeout` | Estouro do executor (`timeout apos Nms`) ou `TimeoutError` do Playwright |
| `seletor` | `waiting for locator/selector`, `waitForSelector` |
| `desconhecido` | Nenhuma das anteriores |
| `filtro_ignorado:<filtro>` | Conferência: o tribunal ignorou o filtro (busca terminou "bem") |
| `vazio_suspeito` | **Só na sentinela**: caso conhecido devolveu menos que o esperado |
| `resgate:reserva` / `resgate:captcha_manual` | Ver Resgates |

### Assinatura

`tribunal|classe|passo|erro_normalizado`, cortada em 200 caracteres. A normalização troca
sequências de dígitos por `#`, remove acentos, URLs e ids e põe em minúsculo; assim a mesma
quebra em dias diferentes cai no mesmo grupo no FFD. Segredos (URL CDP com `apiKey`,
`Bearer ...`) são removidos antes de entrar na assinatura ou no payload.

## Conferência de filtros

Roda em `registrarConcluido` (puro, em `conferencia.js`): compara os filtros pedidos
(`periodoJulgamento`, `periodoPublicacao`, `magistrado`, `juizados`, `numero`) com o que o
tribunal devolveu. Filtro que o tribunal não tem é descartado antes.

- **Amostra mínima:** menos de 3 resultados com o campo legível = `nao_verificavel` (para
  `numero`, menos de 1).
- **`ignorado` só com mais de 50% violando.** Menos que isso é `ok`.
- Tolerância de 1 dia no período de julgamento e 4 dias no de publicação.
- Campo de data em formato não reconhecido (`Sessão de 12 de Setembro de 2024`, vazio) conta
  como "sem campo", nunca como violação.
- Magistrado: relator por código (`forma: codigo`) é `nao_verificavel`; campo que traz órgão
  em vez de pessoa ("Gabinete 3", "Turma") e sobreposição parcial de nome também não contam.
- Juizados: só viola quando o órgão é positivamente um colegiado comum.

**Por que "na dúvida, `nao_verificavel`":** um falso positivo vira aviso errado ao usuário e
card falso no Linear/FFD; um falso negativo só adia o alerta (a sentinela repete no dia
seguinte). Falhar fechado em dúvida custa pouco; acusar sem prova custa a confiança nos alertas.

Quando um filtro é `ignorado`, o usuário recebe um aviso no resultado da busca (por exemplo,
"o tribunal parece ter ignorado o filtro de data: 8 de 10 resultados fora do período") e o
FFD recebe a falha `filtro_ignorado:<filtro>` com até 5 exemplos.

## Resgates

Não são falhas: são casos em que o sistema se salvou, registrados para custo e confiabilidade.

- `resgate:reserva`: a busca só funcionou no provedor reserva (Steel) depois de falha no
  primeiro (Kernel). Leva as falhas do primeiro.
- `resgate:captcha_manual`: o usuário resolveu o captcha à mão no painel Navegadores.

## Outbox

`outbox.js`, tabela no `kaizen.db` (modo WAL, arquivo `0600`).

- Drena a cada 60 s e logo após enfileirar, **um envio por vez**.
- 2xx apaga. 408, 429, 5xx e erro de rede: backoff de 1, 5, 15 e 60 min e depois de hora em
  hora. Outro 4xx descarta e loga (reenviar não resolve).
- Descarta após 48 h. Teto de 200 MB / 5000 itens: descarta os mais velhos.
- HTML acima de 4 MB vai truncado, com aviso no fim do próprio HTML.
- Sem `KAIZEN_WEBHOOK_URL` a outbox fica desligada (`enfileirar` devolve `false`).

## No FFD

- **`/jur-falhas`**: falhas agrupadas por assinatura, com contagem, tribunais, classe, print,
  HTML, exemplos e conferência. O relato do usuário aponta para
  `/jur-falhas?assinatura=...` quando a busca dele tem captura.
- **User Issues**: relatos do botão Relatar (`user-issues`).
- **Conserto: botão "copiar para o jur-fixer".** Na página da falha, o botão copia um bloco
  com tribunal, classe, passo, erro, URL sem query, parâmetros e exemplos. Cole-o numa sessão
  do Claude Code neste repo e chame a skill `jur-fixer` (ela compara a tela atual com os
  prints do `human-codegen`); depois da correção, suba o patch (`CHANGELOG.md`).

## Relato (botão Relatar)

Rotas em `servidor/rotas/relatos.js`, só pela interface (chave pessoal de REST/MCP recebe 403):

- `GET /api/v1/relatos/meta`: se o relato está habilitado e o que o widget deve mostrar.
- `POST /api/v1/relatos`: valida título (4+ caracteres) e descrição; **o servidor monta o
  contexto**: usuário, equipe, versão, a busca (`jobId`) e a conversa (`conversaId`) da
  própria conta. O `extra` do navegador só aponta qual busca/conversa está na tela; id de
  outra conta simplesmente não existe aqui.
- **Histórico da conversa:** as últimas 12 mensagens, já sanitizadas, em até 6 KB, cortando as
  mais antigas. Vai num bloco recolhido no card do Linear e no `contexto` do FFD.
- **Linear BRU:** título `[jur] {título} ({autor})`, estado inicial `Todo`, sem grupo de módulo
  ou tipo. Sem `LINEAR_API_KEY` + `LINEAR_TEAM_ID` o Linear fica desligado.
- **Linear fora do ar:** o erro é logado (sem a chave), o usuário não vê a falha e o relato
  segue para o FFD. Só se nem o FFD aceitar (e o Linear estiver desligado/falhou) a resposta é
  "Não conseguimos registrar agora".
- `widget.js` é cópia byte a byte de `ai-dashboard/issue-reporter/widget.js` do FFD; a chave
  do Linear nunca vai ao navegador.

## Sentinela

Uma busca conhecida por tribunal x capacidade, montada de resultado real (casos em
`jur/tests/sentinela-casos.json`, relidos a cada rodada), para achar a quebra antes do usuário.

- **Agenda** (`agenda.js`): dentro do próprio processo, às **04:00 de São Paulo**
  (`JUR_SENTINELA=1`). Sem cron no host: o container é a unidade de deploy.
- **Remoto** (TRF3, Falcão, STJ) custa por sessão: só **às segundas-feiras** e na rodada do
  **primeiro boot de uma versão nova** (marcador `.versao-verificada`, que evita repetir no
  restart da mesma versão). Teto de `JUR_SENTINELA_MAX_REMOTO` sessões por rodada (padrão 6;
  Kernel e a Steel de reserva contam as duas).
- **Educada:** serial, 5 s entre casos, fora do pool; espera as buscas de usuários acabarem
  e, se o servidor ficar ocupado por 30 min, desiste do resto. Prazo total
  `JUR_SENTINELA_PRAZO_MIN` (padrão 180); o que sobra vira "pulado".
- **Dúvida não é falha:** `vazio_suspeito` e `timeout` repetem uma vez após 2 min (a captura
  da primeira tentativa só é descartada depois que a segunda existe).
- **Disjuntor:** duas dúvidas seguidas no mesmo tribunal pulam o resto dos casos dele na
  rodada.
- Vereditos: `ok`, `falha` (vira `jur-diagnostico` com `origem: sentinela`), `nao_verificavel`,
  `pulado`. Ao fim, um resumo (rodados/ok/falhas/não verificáveis) vai ao FFD.
- **À mão:** `cd jur && npm run sentinela` (casos locais), `-- tjpr trf4` (só esses
  tribunais), `-- --remoto` (inclui remotos, pagos), `-- --json`, `-- --timeout 120`,
  `-- --enviar` (manda ao FFD; sem isso nada sai da máquina). Exit 1 se algum caso falhar.

## Privacidade

- **Sem segredo no que sai:** token Kernel/Steel/CDP, cookie, chave de API e chave pessoal não
  entram em payload, `meta.json`, URL ou erro. URLs sempre sem query. O erro de conexão CDP é
  trocado por "Não foi possível conectar ao navegador remoto."
- **Usuário:** `usuario_hash` = SHA256(`usuario_id` + `KAIZEN_SALT`); sem sal, `null`. Nunca
  e-mail no `jur-diagnostico`. O relato leva `usuário <id> / equipe <id>`, sem e-mail.
- **Print e HTML são de página pública de tribunal**, mas podem conter dados de processo: o FFD
  é de acesso restrito e o `kaizen.db` é `0600`. Capturas em disco são apagadas após o
  registro.
- A chave do Linear fica só no servidor.

## Pendências

- **TJGO** devolve 0 resultados hoje (a sentinela achou); precisa de `jur-fixer`.
- **83 dos 89 casos da sentinela ainda não foram validados ao vivo.** Antes de ligar
  `JUR_SENTINELA=1` em produção, validar no H2 com `cd jur && npm run sentinela --json` e
  corrigir os casos que falharem por motivo do caso (não do tribunal).
- **Cancelar numa sessão remota (CDP)** deixa a sessão do Kernel/Steel aberta até o timeout do
  provedor (comportamento anterior ao Kaizen).
