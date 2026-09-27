# Acompanhamento de navegadores e CAPTCHA manual

O painel **Navegadores**, acima da conversa, mostra a capacidade global do servidor
e apenas as pesquisas da conta autenticada. Abra-o para ativar **Acompanhar navegador**
ou **Resolver CAPTCHA manualmente**. As opções valem para novas pesquisas; CAPTCHA
ativa também o acompanhamento. Desligados por padrão.

Quando houver verificação, a automação para: clique na imagem, envie texto ou use as
teclas do painel. Depois selecione **Continuar pesquisa**. O servidor confere se o
portal foi liberado; clicar em continuar não declara o desafio resolvido. A janela
normal de intervenção é de 120 segundos. Durante esse período a sessão ocupa uma vaga.
É possível cancelar pesquisas, inclusive na fila. Não há resolução automática.

## Capacidade e operação

`JUR_CONCORRENCIA=3` é o padrão conservador. Configure `JUR_CONCORRENCIA=5` no ambiente
do Compose se o servidor comportar cinco execuções. A interface usa a configuração
real: `2 de 5 navegadores disponíveis`; quando lotado, `5 de 5 navegadores ocupados`
e a posição da sua pesquisa. Fila FIFO global para buscas e listagens de filtros,
compartilhada entre todas as contas. Cancelar uma espera impede o lançamento da CLI.

Uma vaga representa uma execução reservada: inclui inicialização e consultas HTTP
feitas pelo crawler, não somente um processo Chromium já aberto. Limite válido por
processo da aplicação; execute **uma instância** no Compose atual. Não multiplique
réplicas sem trocar o pool por coordenação compartilhada. Jobs interrompidos por
reinício viram erro, conforme o comportamento existente.

`JUR_CAPTCHA_TIMEOUT_MS=120000` controla a espera humana; a execução inteira continua
limitada pelo timeout de 10 minutos da CLI. O Docker inclui Xvfb para o Chromium com
janela do STJ e usa `init: true` no Compose. Fora do Compose, execute a imagem com
`docker run --init --shm-size=1g ...`. A tela passa pela API autenticada, sem expor
VNC ou porta CDP.

As imagens JPEG são capturadas sob demanda, sem gravação. O painel fechado ou aba
oculta para a captura. A API revalida a conta, confere o proprietário do job e bloqueia
ações fora da pausa humana. Nenhuma chave, cookie ou URL CDP é entregue à interface.

## STJ e TJSP

- STJ: o catálogo continua `sem-acesso`. A opção manual habilita uma **tentativa
  assistida** exclusivamente para aquela conta, também no chat e MCP. O critério de
  retomada é o campo de pesquisa oficial visível. Não garante liberação pelo Cloudflare.
- TJSP: identifica desafios visíveis; o selo permanente do reCAPTCHA invisível não é
  um bloqueio por si só. Após intervenção, formulário ou resultados precisam estar
  confirmados. Bloqueio não vira resultado vazio.

Diagnóstico local em 26/09/2026, Chromium headless: STJ respondeu HTTP 403,
`Just a moment...`, sem `#pesquisaLivre`; TJSP respondeu HTTP 200 com formulário e
iframe de selo reCAPTCHA `size=invisible`. A busca real `dano moral`, limitada a uma
página no TJSP, terminou com **20 resultados** nesta rodada. **Não houve resolução
humana de CAPTCHA real nesta validação.** Os testes reproduzíveis de intervenção
usam um desafio local controlado.

## Browserbase, Stagehand e Skyvern

Browserbase é um provedor opcional implementado. Configure `BROWSERBASE_API_KEY` e
`BROWSERBASE_PROJECT_ID` apenas no servidor. A opção aparece no painel; só cria uma
sessão remota se o usuário a escolher para novas pesquisas. Pode haver cobrança do
provedor. O pai provisiona o browser via API, o Playwright conecta por CDP e a mesma
tela autenticada transporta imagens e comandos. O encerramento solicita
`REQUEST_RELEASE`; sem confirmação após duas tentativas, há log operacional e
expiração remota de 600 segundos. Gravação, logs da sessão e solver de CAPTCHA ficam
desativados. As chamadas foram testadas com transporte simulado, sem conta paga.

Stagehand e Skyvern foram avaliados como motores adicionais, mas **não foram
integrados ao crawler nesta mudança**. O acompanhamento/controle por Playwright não
consome tokens de LLM; as chamadas do chat continuam usando a conexão de IA da conta.
Uma comparação futura de motores deve medir tokens, latência e sucesso no mesmo
fluxo, com a mesma consulta, mantendo CAPTCHA humano fora do agente. Não foi medido
um percentual de economia de Stagehand neste projeto.

Fontes técnicas consultadas:

- [Browserbase: Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view)
- [Criar sessão](https://docs.browserbase.com/reference/api/create-a-session) e [encerrar sessão](https://docs.browserbase.com/reference/api/update-a-session)
- [Stagehand — SDK e exemplos atuais](https://github.com/browserbase/stagehand)
- [Skyvern — automação visual e SDK](https://github.com/skyvern-ai/skyvern)
- [Playwright — execução no Docker e processo init](https://playwright.dev/docs/docker)

## Testar

```sh
cd jur
npm ci
npx playwright install chromium
node --test tests/navegadores-*.test.js tests/navegador-assistido.test.js
node --test tests/browser/navegador-assistido.test.js tests/browser/navegadores.test.js
npm test
npm run test:browser
npm run aceite -- TJSC --rapido
```

Os testes de navegador verificam imagem JPEG real por IPC, desafio local resolvido
com clique/texto/teclas, continuar antes da resolução, timeout, opt-in, isolamento,
fila/cancelamento e painel desktop/mobile. Para validar CAPTCHA real, entre no app,
ative ajuda manual e inicie uma busca curta (`maxPaginas: 1`) em STJ ou TJSP.

Validação desta entrega em 26/09/2026: 323 testes unitários/API e 89 de navegador
passaram; aceite rápido TJSC passou nos seis critérios obrigatórios. A imagem Docker
foi construída, produziu um JPEG de Chromium com janela no Xvfb e iniciou pelo CMD
padrão com `--init`, respondendo HTTP 200 em `/api/v1/saude`. Nenhum deploy foi feito.

## API

REST usa a sessão HttpOnly da interface ou chave pessoal. POST por cookie exige
`Origin` da aplicação. Contratos também estão no OpenAPI e na coleção Bruno.

| Rota | Função |
|---|---|
| `GET /api/v1/navegadores` | Capacidade, preferências e sessões da conta |
| `POST /api/v1/navegadores/preferencias` | `{acompanhar, captcha, provedor}` para novas buscas |
| `GET /api/v1/navegadores/:id/tela` | `{imagem, largura, altura}`; JPEG base64, no-store |
| `POST /api/v1/navegadores/:id/acao` | `clicar`, `texto`, `tecla`, `rolar` ou `continuar` |
| `DELETE /api/v1/buscas/:id` | Cancela execução ou espera |

Clique usa `x`/`y` entre 0 e 1, relativos à imagem. Texto limitado a 1000 caracteres.
Teclas e ações têm allowlist. Sem comandos de navegação arbitrária ou JavaScript.
