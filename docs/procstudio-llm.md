# JurCrawler: identidade e conexões de IA

A interface entra pela conta existente do ProcStudio. Não cria usuários nem recebe o JWT
Rails no navegador do JurCrawler. O frontend ProcStudio troca seu JWT por um código de
uso único, com PKCE S256, callback fixo e validade de até 60 segundos. O crawler troca esse
código no Rails e cria uma sessão local opaca. A sessão delegada dura no máximo 24 horas e
nunca ultrapassa o vencimento do JWT que a originou.

## Uso

1. Entre com ProcStudio.
2. Abra Configurações → IA. Escolha provedor, dê um nome e informe sua chave.
3. Busque um modelo no catálogo ou informe seu ID. OpenRouter identifica modelos sem
   suporte a ferramentas; esses modelos ficam desabilitados no catálogo.
4. O seletor do chat permite trocar a conexão e o modelo. A seleção persiste na sua conta.
5. Para scripts/MCP, crie uma chave pessoal em Integrações. Copie no momento da criação.

Anthropic, OpenAI, OpenRouter e Gemini têm adaptadores próprios; outros provedores precisam
expor Chat Completions compatível com OpenAI em HTTPS público. Não basta qualquer chave:
o provedor e o modelo precisam suportar chamadas de ferramentas. Falha no catálogo permite
ID manual; a geração pode recusar modelos incompatíveis. Esforço de raciocínio não é enviado
sem capacidade confirmada. Nenhuma chave de provedor é compartilhada pela instalação. Gemini preserva somente a assinatura opaca exigida para continuidade de ferramentas; não persiste texto de raciocínio privado.

## Conexão ProcStudio e cobrança

Além das conexões próprias (chave do usuário), a instalação pode oferecer a conexão
**ProcStudio**: a chave do provedor é do operador, vem só do ambiente (nunca vai ao banco do
usuário nem a rota alguma) e cada resposta é cobrada do saldo de IA do time no ProcStudio.
Sem `PROCSTUDIO_LLM_API_KEY` a conexão não existe e `GET /api/v1/saldo` devolve `{ "disponivel": false }`.

### Variáveis (operador)

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `PROCSTUDIO_LLM_API_KEY` | vazio | Chave do provedor (OpenRouter). Vazia: sem conexão ProcStudio. |
| `PROCSTUDIO_LLM_ENDPOINT` | `https://openrouter.ai/api/v1` | URL base compatível com OpenAI. |
| `PROCSTUDIO_LLM_MODELO` | `z-ai/glm-5.3-flash` | ID do modelo enviado ao provedor. O usuário nunca escolhe outro nesta conexão. |
| `PROCSTUDIO_LLM_MODELO_CATALOGO` | `glm-5.3-flash` | ID do mesmo modelo no catálogo de preços do Rails (`model_id` do `ai_usage`). |
| `PROCSTUDIO_LLM_UPSTREAM` | `z-ai` | Provedor fixado no OpenRouter (`provider.order`, sem fallback). Vazio desliga a fixação. |
| `PROCSTUDIO_LLM_ROTULO` | `GLM-5.3 Flash` | Nome mostrado na interface. |

Valor vazio vale como "usar o padrão", exceto em `PROCSTUDIO_LLM_UPSTREAM`, em que vazio é
válido e significa não fixar o provedor. Por isso o `compose.yml` usa `${PROCSTUDIO_LLM_UPSTREAM-z-ai}`
(sem `:`): variável ausente vira `z-ai`, variável definida e vazia continua vazia.
Com endpoint do OpenRouter e `UPSTREAM` preenchido, cada chamada pede `usage.include` para
trazer o custo real do provedor.

### Fluxo por rodada

1. **Pré-checagem** (antes de gravar a pergunta): o crawler consulta `service_access/ai_balance`
   no Rails, com cache de 30 s por conta. Recusas: **402** `saldo_insuficiente` (traz `saldoBrl` e
   `topupUrl`), **409** `cobranca_pendente` (há recibo ainda não registrado), **503**
   `procstudio_indisponivel` (Rails fora do ar, conta sem acesso à IA ou conexão sem cobrança montada).
   Falha fechada: sem veredito recente não há chamada ao provedor.
2. **Antes de cada rodada** do turno o mesmo teste roda de novo, porque o saldo pode acabar no meio.
3. **Depois de cada rodada** que informou consumo, o crawler registra o uso em
   `service_access/ai_usage` (5 s de timeout; `request_id = <conversa>:<turno>:<rodada>`, idempotente
   no Rails) e emite o evento SSE `custo` (`rodada`, tokens, `cobradoBrl`, `saldoBrl`, `modelo`).
   O evento `fim` carrega `custo` com a soma do turno.
4. O custo de cada turno fica na tabela `custo_turno`; `GET /api/v1/conversas/:id` devolve
   `custos` e `custoTotalBrl` (null se nada foi cobrado).
5. "Tentar de novo" depois de um bloqueio no meio do turno refaz o histórico por
   `GET /api/v1/conversas/:id` (a pergunta e as rodadas já pagas) e o manda com `reenvio: true`:
   nada é gravado de novo e o turno continua de onde parou (depois de um `tool_result`, o modelo
   responde a ele). Se a última mensagem do pedido não for a última gravada (a conversa mudou
   nesse meio tempo), a resposta é **409** `reenvio_invalido`.
6. Erro do provedor numa rodada ≥ 2 também mantém na conversa as rodadas já cobradas. Recusa
   antes do stream (402, 409, 503) não grava nada: a pergunta sai da tela e volta para a caixa.

### Recibos pendentes

O recibo é gravado em `cobranca_pendente` (`em_voo = 1`) **antes** da primeira ida ao Rails.
Registrar tenta 3 vezes (esperas de 1 s e 3 s). Se todas falham, o recibo fica na fila e o turno
termina com `cobranca_pendente`; enquanto houver recibo na fila a conta não inicia turnos novos.
Um varredor reenvia a cada 60 s, por conta aberta, e `escopos.varrerPendencias()` o aciona no
boot (recibos "em voo" de um processo que caiu voltam à fila). Códigos terminais do Rails
(`USER_GONE`, `INVALID_USAGE`, `SERVICE_AUTH`, `TEAM_REJECTED`) descartam o recibo com o log
`billing_receipt_dropped`; recibo ilegível sai com `billing_receipt_corrupt`; recibo com mais de
24 h ainda pendente registra `billing_pending_stale`.

### Estados de erro (`erro.tipo`)

| `tipo` | Quando | O que o usuário vê |
| --- | --- | --- |
| `saldo_insuficiente` | Saldo abaixo do limite do plano (402, ou evento `erro` no meio do turno) | Cartão de bloqueio com "Adicionar créditos" e "Tentar de novo" |
| `cobranca_pendente` | Recibo pendente (409) ou registro que falhou 3 vezes | "Tente novamente em instantes"; o recibo segue na fila |
| `procstudio_indisponivel` | Rails fora do ar, `pricing_unavailable` (modelo do operador sem preço), erro do provedor na chave do operador | Mensagem com "Configurar uma conexão própria" |
| `usage_missing` | O provedor não informou o consumo da rodada | Erro no turno; a rodada não é cobrada |
| `reenvio_invalido` | `reenvio: true` com a conversa gravada mudada desde o bloqueio (409) | Pedido para enviar a pergunta de novo |

Falhas do operador geram o log `procstudio_llm_operator_failure` e um item `jur-diagnostico` no Kaizen
(`origem: 'cobranca'`, `tipo: 'falha'`, com `classe`, `erro`, `status` e `suprimidos`), **uma vez por
recibo**, não por tentativa. A `classe` diz a causa: `rails_indisponivel` (5xx do Rails em
`ai_balance`/`ai_usage`), `pricing_unavailable` (503 de preço do Rails) e `provedor` (402/429/5xx do
OpenRouter). Cada classe tem a própria janela de **um aviso por minuto por processo**, então um
`pricing_unavailable` não fica escondido atrás de uma queda do Rails. Os avisos cortados na janela
são contados e o total vai no campo `suprimidos` do aviso seguinte. Esse sinal é o que o operador
usa para agir (por exemplo, sincronizar o preço do modelo no Rails).

### Saldo na interface

`GET /api/v1/saldo` (`?forcar=1` ignora o cache) devolve `disponivel`, `saldoBrl`, `podeOperar`
(falso também com recibo pendente), `mensagem`, `topupUrl` e `modelo` (rótulo e preços por 1M de
tokens). A interface mostra o saldo no pill, o seletor de modelo marca a conexão ProcStudio como
"recomendada", cada resposta mostra seu custo e a conversa mostra o total.

### Ambiente local

`npm run dev:local` simula a carteira (`jur/dev/local.js`): saldo inicial R$ 10,00, ajustável em
centavos por `JUR_LOCAL_SALDO_INICIAL`; tolerância de −R$ 0,50 (bloqueia estritamente acima do
limite, como o Rails) e `topupPath` `/equipe?tab=billing`. Detalhes em [ambiente local](ambiente-local.md).

### Como conferir uma cobrança

1. A interface mostra o custo da resposta (e `custo` no SSE).
2. No ProcStudio, a página `/ia-uso` do time traz a linha do mesmo uso (modelo, tokens, valor cobrado,
   provedor `openrouter`); o `request_id` é `<conversa>:<turno>:<rodada>`.
3. No painel do OpenRouter (Activity/Generations) procure a geração pelo `providerGenerationId`
   enviado no recibo; o custo em USD deve bater com `providerCostUsd`.

Os três valores devem ser coerentes entre si (a cobrança em R$ vem do preço do catálogo do Rails,
não do custo do provedor). O registro de cada validação em produção vai em `docs/qa/`.

### Pendências conhecidas

- O Rails exposto é o PR ProcStudioOrg/ProcStudio#876; a conexão só funciona com ele em produção.
- Os turnos vivos e o cache de saldo ficam em memória: reiniciar o container derruba os turnos em
  andamento (os recibos já gravados sobrevivem e são reenviados).
- O preço de `glm-5.3-flash` precisa estar sincronizado no catálogo do Rails; sem ele a conexão
  responde `procstudio_indisponivel`.

## Armazenamento e isolamento

- `/dados/acesso.db`: hashes de sessão e de chaves pessoais; tokens delegados Rails cifrados.
- `/dados/usuarios/<sha256(emissor, usuário, equipe)>/jur.db`: conexões de IA cifradas,
  preferências, conversas e jobs exclusivos daquele titular.
- Resultados, arquivos temporários e sessões dos crawlers ficam no mesmo diretório pessoal.
- O cofre usa AES-256-GCM, nonce aleatório por gravação e AAD com identidade, provedor e ID.
  A chave mestra `JUR_ENCRYPTION_KEY` fica na configuração privada do serviço, fora dos bancos.
- Respostas só mostram metadados e últimos quatro caracteres da credencial. O browser não
  persiste credenciais em localStorage. Senhas digitadas são removidas do DOM ao fechar/sair.
- Administradores com acesso ao processo **e** à chave mestra podem decifrar o cofre; isto
  é criptografia em repouso, não criptografia ponta a ponta. Backups exigem a mesma proteção.

Não troque a chave mestra sem recifrar os dados: perder a chave torna os segredos ilegíveis.
A remoção de uma conexão impede chamadas seguintes, inclusive próximas rodadas de ferramentas.
O Rails revalida usuário/equipe em cada requisição e a cada 30s durante streams. Exclusão,
troca de equipe, expiração e revogação encerram o acesso; logout encerra a sessão do crawler.
Chaves de integração são revogadas separadamente e não dependem da sessão de navegador.

## Diagnóstico de streams interrompidos

Uma interrupção durante a leitura do stream gera uma linha JSON no log do container com
`event: "llm_stream_failure"`. O campo `origin` separa `provider` (o socket do provedor
terminou antes da resposta) de `signal` (o JurCrawler cancelou a requisição, por exemplo
após revogação ou expiração da sessão). Quando o provedor já informou seu identificador,
`generationId` permite correlacionar o incidente com o painel dele. O diagnóstico inclui
somente provedor, modelo, fase e metadados técnicos do erro; não inclui prompt nem credencial.

Não há retry automático depois que um stream começou: repetir uma rodada que já produziu
texto ou executou ferramentas poderia duplicar cobrança e buscas. O usuário recebe uma
mensagem legível e pode decidir se quer tentar novamente.

## Configuração e publicação

Primeiro publique a alteração aditiva no ProcStudio (migration de códigos/sessões,
endpoints service_access e rota frontend `/_auth/jurcrawler`). Configure:

| Serviço | Variável | Valor |
| --- | --- | --- |
| Rails | `JURCRAWLER_CLIENT_ID` | mesmo ID do crawler |
| Rails | `JURCRAWLER_CLIENT_SECRET` | segredo aleatório compartilhado somente servidor-servidor |
| Rails/frontend | `JURCRAWLER_REDIRECT_URI` | URL pública exata do crawler + `/auth/callback` |
| Rails | `SERVICE_ACCESS_ISSUER` | identificador estável, igual a `PROCSTUDIO_ISSUER` |
| Frontend | `JURCRAWLER_CLIENT_ID` | mesmo ID do Rails |
| Crawler | variáveis de `infra/.env.example` | URLs e segredos próprios do ambiente |

Gere a chave do cofre com `openssl rand -base64 32` e armazene diretamente no gerenciador
privado de segredos. Gere outro segredo independente para autenticação de serviço.
Nenhum deles é uma chave de provedor de LLM.

O reset inicial foi autorizado apenas para o crawler sem usuários. A nova aplicação recusa
`/dados/jur.db` legado. Na primeira publicação, pare somente o crawler e mova os arquivos
legados para um backup protegido fora do volume ativo, ou use um volume novo. Não altere
banco, usuários ou volumes do ProcStudio. Nunca execute `docker compose down -v`.
Publicar primeiro Rails/frontend; depois release imutável do crawler com novas variáveis.
Valide login, duas contas, chave/modelo, chat, MCP, logout e revogação em HML antes de produção.
Rollback do código usa o procedimento de release existente; preserve os volumes.

## Verificação

`cd jur && npm test && npm run test:browser && npm run aceite -- TJSC --rapido`.
Os testes automatizados de provedores usam respostas simuladas; não consomem chaves pagas.
O relatório de revisão fica em [QA backend](qa/2026-09-19-backend-sso-llm.md).
Contrato HTTP atualizado em `/api/v1/openapi.json`; exemplos Bruno em `collection/JurCrawler`.

Referências de protocolo: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat),
[OpenRouter](https://openrouter.ai/docs/api/reference/overview),
[Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).
