# Autenticação e publicação de `jurcrawler.com.br`

**Data:** 2026-08-31  
**Escopo:** BRU-73, publicação HTTPS no h2 e configuração repetível de deploy.

## Objetivo

Publicar a interface em `https://jurcrawler.com.br` sem expor conversas,
buscas, chat, gerenciamento de chaves ou MCP a clientes sem uma chave de
conexão válida.

O domínio foi registrado em 2026-08-31. No momento desta especificação, o
Registro.br informa `nicbr waiting activation`, usa o DNS automático
`a.auto.dns.br`/`b.auto.dns.br` e ainda não publica registros A ou AAAA.

## Decisões

- `https://jurcrawler.com.br` será o endereço canônico. `www` redirecionará
  para o domínio raiz.
- O container continuará acessível somente em `127.0.0.1:3000` no h2.
- O Nginx existente terminará TLS e encaminhará tráfego ao container.
- A interface e seus arquivos estáticos serão públicos. Dados e operações
  continuarão privados por chave de conexão.
- `Sec-Fetch-Site`, `Origin`, `Host` e outros metadados de requisição nunca
  serão aceitos como credencial.
- A validação de `Origin` hostil continuará como defesa adicional contra
  requisições dirigidas por outro site. Ela não substituirá autenticação.
- Não será criada autenticação multiusuário, conta ou senha nesta entrega.

## Fronteira de autenticação

Rotas públicas:

- `/` e arquivos estáticos da interface;
- `/docs` e `/api/v1/openapi.json`;
- `/api/v1/saude`.

Rotas protegidas:

- todas as demais rotas `/api/v1/*`;
- `/mcp`.

Quando `JUR_EXIGIR_CHAVE=1`, uma rota protegida só aceitará
`Authorization: Bearer <chave>`. Uma chave ausente, inválida ou revogada
receberá `401`, inclusive quando o cliente enviar `Sec-Fetch-Site` com
`same-origin` ou `none`. Uma origem hostil continuará recebendo `403`.

`JUR_EXIGIR_CHAVE=0` permanecerá disponível apenas para desenvolvimento
local. Produção manterá a exigência habilitada.

## Interface

Configurações terá um campo específico para a chave de conexão desta
instalação, separado da chave Anthropic. A chave de conexão ficará no
`localStorage` do browser e será anexada como Bearer a todas as chamadas da
API, inclusive chat e streams SSE.

Sem chave, a página carregará normalmente, não exibirá dados privados e
mostrará um estado bloqueado com caminho direto para Configurações. Um `401`
limpará apenas o estado autenticado da tela; não apagará automaticamente o
segredo salvo, para que falhas transitórias não destruam a configuração.

A chave Anthropic continuará no browser e seguirá para o chat no cabeçalho
próprio já usado pelo produto. Ela não será copiada para o servidor, imagem,
Compose, Git ou configuração do Nginx.

## Chave inicial

Antes de substituir a release privada atual, será emitida uma única chave de
conexão pela interface de loopback, alcançada por túnel SSH. O valor não será
impresso em logs nem salvo no repositório ou em aliases. Ele será entregue ao
clipboard local e colado no novo campo de Configurações após o deploy.

Depois da correção, criar, listar e revogar chaves também exigirá uma chave
válida. Não haverá rota pública de bootstrap nem comportamento especial para
“primeira chave”, evitando que o primeiro visitante reivindique a instalação.

## Publicação no h2

O fluxo será:

1. corrigir BRU-73 e executar as suítes local, browser e aceite;
2. construir e validar a imagem Docker;
3. emitir a chave inicial ainda com a release privada;
4. publicar uma release imutável no h2, mantendo o volume SQLite existente;
5. confirmar localmente no h2 que estáticos e saúde respondem, Bearer válido
   funciona e o cabeçalho forjado recebe `401`;
6. aguardar o domínio ficar ativo e apontar A para `168.231.91.47`;
7. instalar o virtual host, emitir o certificado e recarregar o Nginx;
8. executar os mesmos testes pelo domínio público.

O virtual host terá redirecionamento HTTP para HTTPS, preservará `Host` e os
cabeçalhos de encaminhamento, desabilitará buffering para SSE e usará timeout
compatível com respostas longas. A resposta incluirá pelo menos
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e proteção
contra enquadramento por terceiros.

O Certbot e seu timer já estão instalados e ativos. Instalar o virtual host,
testar a configuração e emitir o certificado exigirá uma sessão humana de
`sudo`, pois `brpl` pertence ao grupo `sudo`, mas não possui autorização sem
senha.

## DNS e ativação

O serviço não será exposto antes de todos estes estados serem verdadeiros:

- Registro.br não informa mais `nicbr waiting activation`;
- `jurcrawler.com.br` e `www.jurcrawler.com.br` resolvem para o h2;
- a release corrigida está saudável em loopback;
- o teste de bypass do BRU-73 falha fechado;
- o certificado cobre os dois nomes e a renovação automática permanece ativa.

Compra, pagamento, autenticação no Registro.br e confirmação de alterações
irreversíveis pertencem ao humano. O agente pode conduzir a navegação quando
autorizado, mas não digitará senha, resolverá CAPTCHA nem confirmará pagamento.

## Validação

Testes automatizados devem provar:

- arquivos estáticos e rotas públicas respondem sem chave;
- todas as rotas protegidas respondem `401` sem Bearer;
- `Sec-Fetch-Site: same-origin` e `none` não alteram o resultado;
- Bearer válido funciona e chave revogada deixa de funcionar;
- a interface anexa Bearer a REST, chat e streams;
- a interface abre Configurações e explica o estado sem chave;
- `Origin` hostil continua bloqueado;
- a chave Anthropic e a chave de conexão não são confundidas.

Validação externa deve confirmar:

- HTTP redireciona para HTTPS;
- o domínio raiz carrega e `www` redireciona para ele;
- `/api/v1/saude` responde `200`;
- API e MCP sem chave respondem `401`;
- o cabeçalho forjado responde `401`;
- Bearer válido executa uma leitura e uma busca curta;
- a porta 3000 continua inacessível publicamente;
- reiniciar o container preserva conversas, jobs e chaves.

## Rollback

A release anterior permanecerá no servidor. Se a nova release falhar antes de
abrir o domínio, o symlink `current` volta à versão anterior e o Compose é
recriado sem tocar nos volumes. Se o problema estiver no proxy, o novo virtual
host é desabilitado e o Nginx é recarregado somente após `nginx -t` passar.

Nenhum rollback revoga chaves ou restaura banco automaticamente. Alterações no
volume exigem backup e decisão separada.

## Configuração persistente

Após a validação pública:

- `AGENTS.md` registrará o deploy customizado por SSH, URL, comandos de status,
  health check, testes pré-deploy e procedimento de rollback;
- `/Users/brpl/code/dotfiles2` ganhará `h2jur`, que abre apenas o túnel SSH;
- nenhum segredo será incluído nos dois arquivos;
- BRU-73 receberá evidências locais e públicas e só então será concluída.

## Fora de escopo

- cadastro de usuários, recuperação de senha e autorização por usuário;
- cobrança, quotas e painel administrativo;
- armazenar a chave Anthropic no servidor;
- expor diretamente a porta 3000;
- substituir o Nginx existente por Cloudflare Tunnel.

## Critérios de aceite

A entrega termina quando `https://jurcrawler.com.br` apresenta certificado
válido, a UI funciona com a chave salva no browser, clientes sem chave não
alcançam qualquer dado ou operação, o bypass do BRU-73 está coberto por teste e
falha com `401`, a persistência sobrevive a reinício e o procedimento de deploy
está documentado sem segredos.
