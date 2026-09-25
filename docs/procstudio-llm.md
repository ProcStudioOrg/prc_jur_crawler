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
