# JurCrawler integrado ao ProcStudio

Data: 2026-09-19. Estado: especificação para revisão.

## Resultado esperado

O advogado entra com sua conta ProcStudio, configura um provedor de IA e escolhe
um modelo para pesquisar jurisprudência. Chaves, conversas, buscas e integrações
são privadas por usuário, inclusive entre colegas da mesma equipe. A interface
usa a identidade visual do ProcStudio.

O usuário confirmou que ninguém usou o JurCrawler: não haverá migração,
compatibilidade com o armazenamento anterior ou preservação dos dados do crawler.
Essa autorização não se aplica aos usuários, equipes ou dados do ProcStudio.

## Evidências do estado atual

- Crawler local atualizado em `main`, commit `4cde401` na investigação.
- Produção saudável, release `20260831-173126`; o arquivo TRF4Crawler.js difere
  do atual. Configurações e rota de chat conferidas têm o mesmo hash local/remoto.
- API pública de saúde responde; conversas sem autenticação devolvem 401.
- Chave LLM em `localStorage`, chave de instalação em hash no SQLite. A guarda
  atual aceita a chave sem propagar um proprietário para as operações.
- Produção não tem ANTHROPIC_API_KEY preenchida; o código permite esse fallback.
- Rails usa JWT HS256 assinado com secret_key_base, expiração de 24 horas.
  SvelteKit mantém auth_token em cookie HttpOnly. Não foi encontrado um contrato
  de SSO reutilizável na inspeção dos arquivos de autenticação.
- O repositório principal tem trabalho alheio em andamento. Implementação nele
  deve usar checkout isolado e preservar a branch e os arquivos atuais.

## Autenticação: Rails como autoridade

Reutilizar usuários, equipes e login existentes. Não criar senhas no crawler nem
compartilhar secret_key_base com outros serviços.

Fluxo proposto para os domínios distintos:

1. “Entrar com ProcStudio” cria uma tentativa no crawler com state aleatório e
   PKCE S256. A tentativa expira em cinco minutos e é vinculada ao navegador por
   cookie HttpOnly, Secure em HTTPS e SameSite=Lax.
2. Redirecionar para uma rota SvelteKit de autorização. Sem sessão ProcStudio,
   usar o login existente com retorno restrito a essa rota.
3. SvelteKit chama Rails usando o JWT do cookie pelo servidor. Rails autentica
   o usuário, resolve sua equipe e emite código opaco de uso único, validade de
   60 segundos, vinculado ao cliente, redirect_uri e desafio PKCE.
4. Retorno ao callback exato cadastrado para o crawler. O crawler confere state
   e troca o código pelo backend com autenticador exclusivo do serviço e verifier.
   Rails consome o código atomicamente e retorna uma sessão delegada opaca.
5. O navegador recebe somente uma sessão opaca do crawler. A sessão delegada
   fica cifrada no backend. Rails mantém hash da credencial delegada, usuário,
   equipe, cliente e expiração, limitada ao JWT que autorizou sua emissão.
6. Cada requisição protegida consulta Rails para validar a sessão delegada e
   obter user_id/team_id atuais. Falha de validação bloqueia o acesso; falha de
   comunicação apresenta indisponibilidade, sem aceitar identidade do browser.

URLs e credenciais são configuradas por ambiente. HML aceita apenas seu emissor,
cliente e callback; produção terá configuração independente. Códigos não são
JWTs de login e não permitem acessar a API geral do ProcStudio. Callback remove
o código da URL antes de renderizar conteúdo; logs não registram seu valor.

Logout no crawler revoga sua sessão delegada e apaga o cookie. O logout atual do
ProcStudio não revoga JWTs emitidos: não prometer logout global nesta entrega.
Usuário removido, equipe alterada ou sessão expirada invalidam a delegação.
Streams já autorizados têm prazo limitado pela sessão e são encerrados ao expirar.

Alternativas consideradas: compartilhar o segredo Rails amplia o poder do crawler;
encaminhar o JWT geral ao outro domínio amplia sua exposição. A delegação mantém
a validação de identidade no Rails e limita a credencial ao serviço consumidor.

## Isolamento obrigatório

Identidade interna: ambiente/emissor + user_id + team_id, todos confirmados pelo
Rails. Escopo aplicado no repositório de dados, não apenas na interface.

- Conversas, mensagens, jobs, resultados, cancelamentos, downloads, streams e
  sessões de tribunais pertencem a essa identidade.
- Credenciais e escolhas de provedor/modelo também são privadas por usuário.
- Acesso a identificador de outro usuário responde 404. Listagens não expõem
  títulos, contagens, prefixos ou estados de recursos de terceiros.
- Ferramentas da LLM recebem o mesmo escopo. Um modelo não pode ler um job alheio
  fornecendo seu identificador em ler_resultados.
- Não há compartilhamento implícito por equipe nem chave global de LLM.
- Caches de credenciais, clientes, modelos autorizados, streams e arquivos
  temporários não podem misturar identidades.

As chaves REST/MCP passam a ser pessoais. Valor exibido apenas na criação;
persistência somente do hash. Listar/revogar exige o proprietário. A autenticação
de integração verifica no Rails que usuário e equipe continuam válidos; uma
credencial de serviço usada nessa consulta não autoriza operações de usuário.

## Chaves de IA

Persistir no backend do crawler, cifradas com AES-256-GCM, nonce aleatório por
gravação e dados associados contendo proprietário, provedor e identificador.
Chave de criptografia exclusiva do ambiente, fornecida pela infraestrutura, fora
do banco e do repositório. Sem chave configurada, recusar armazenamento e uso.

A API devolve somente metadados, status e máscara. Nunca devolver segredo salvo
para preencher input. Atualização exige nova chave; exclusão impede novos usos.
Segredos não entram em logs, URLs, mensagens de erro, histórico, prompts, eventos
SSE ou telemetria. O serviço precisa decifrá-los em memória para chamar a LLM;
isso protege armazenamento e acesso entre usuários, não de um administrador do
servidor com acesso aos segredos da infraestrutura.

Remover jur.chaveLlm e jur.chaveConexao do armazenamento antigo ao iniciar a nova
interface, sem importá-los. Sem fallback para chave de operador no ambiente.

## Provedores e modelos

Camada de adaptação independente da interface. Provedores iniciais: Anthropic,
OpenAI, Google Gemini, OpenRouter e endpoint compatível com OpenAI Chat Completions.
Confirmar contratos nas documentações oficiais durante o plano de implementação.

Cada conexão contém provedor, credencial, endpoint quando aplicável e modelo
padrão. Catálogo carregado pelo backend a partir do provedor; campo de ID manual
quando o catálogo não estiver disponível, com validação explícita. OpenRouter
recebe seleção pesquisável por nome, ID e fornecedor. Não inferir provedor pelo
prefixo da chave nem manter três modelos Anthropic fixos no HTML.

Endpoints personalizados exigem HTTPS, não recebem cookies ou tokens ProcStudio
e bloqueiam destinos privados, loopback, link-local e metadata, inclusive em DNS
e redirecionamentos. Endpoints locais exigiriam configuração administrativa
específica e ficam fora desta entrega.

Adaptadores preservam streaming, chamadas de ferramentas, resultados, histórico,
cancelamento e limites de iterações. Histórico interno independente do provedor;
troca de modelo mantém referências e resultados das buscas anteriores.
Esforço de raciocínio aparece somente quando suportado. Modelos sem ferramentas
recebem explicação de incompatibilidade com pesquisa, sem simular execução.
Chave inválida, quota, timeout e modelo indisponível têm mensagens distintas e
sanitizadas. Nenhuma falha muda silenciosamente de provedor ou usa outra chave.

“Qualquer LLM” significa provedores suportados e protocolos compatíveis; não
prometer execução de APIs arbitrárias sem adaptador nem pesquisa sem tools.

## Interface ProcStudio

Referência canônica: ../ProcStudio-Docker/frontend/DESIGN.md e src/app.css.
Preservar o frontend leve existente do crawler; não migrar o aplicativo inteiro
para Svelte apenas para reproduzir os componentes visuais.

- Azul #0277EE para ações, seleção e foco; marinho #01013D para identidade.
- Superfícies #FEFEFA e #F0F4F3; texto #373F45; destaque suave #98D9FD.
- Tipografia legível conforme o app ProcStudio; documentar a diferença existente
  entre Inter no cânone e system font no CSS do app antes de carregar fontes.
- Remover coral, composição e detalhes que imitam Claude. Botões e campos com
  raios contidos, bordas discretas e contraste verificado.
- Tela inicial com acesso ProcStudio; área autenticada identifica a conta ativa.
- Configurações com abas IA e Integrações, cabeçalho fixo, corpo com rolagem
  discreta, sem barra encostada na borda arredondada nem rolagem dupla.
- IA: etapas Provedor → Credencial → Modelo. Campo secreto vazio para edição,
  ação de substituir/remover e confirmação de salvamento/validação.
- Chat: seletor pesquisável mostra conexão/provedor e modelo selecionado;
  esforço condicional. Sem conexão, ação clara para configurar a IA.
- Integrações: somente chaves pessoais REST/MCP. Eliminar chave de instalação
  da experiência de login.
- Teclado, foco retido/devolvido no modal, Esc, labels, estados de carregamento,
  vazio e erro; verificar desktop, mobile e zoom.

## Implantação e verificações

Implementar primeiro identidade e isolamento; depois credenciais e adaptadores;
por fim integrar o fluxo visual e validar ponta a ponta em HML.

Testes mínimos: dois usuários na mesma equipe e um em outra; acesso cruzado a
conversa, job, arquivo, ferramenta e stream; código expirado/reutilizado, state e
PKCE inválidos, callback não cadastrado, usuário removido e equipe alterada;
CSRF em mutações autenticadas por cookie; ausência de segredos em respostas e
logs; ciphertext adulterado; SSRF; streaming/tool calls para cada adaptador;
troca de provedor no histórico; modelos incompatíveis e falhas de catálogo.

Testes reais com provedores dependem de credenciais de teste autorizadas. Nunca
usar credencial pessoal encontrada em arquivo ou banco como fixture automática.
Mocks validam contrato interno, não comprovam integração real com o provedor.

Rails: RSpec e RuboCop do escopo, frontend principal com testes/lint aplicáveis,
Bruno e documentação atualizados. Crawler: npm test, npm run test:browser e
npm run aceite -- TJSC --rapido. QA separa evidências locais e HML.

Reset autorizado somente dos dados do JurCrawler. Executar no deploy da versão
nova, delimitando banco/resultados/cache do serviço; não apagar volumes de outros
serviços nem usar docker compose down -v. Nenhum reset durante desenvolvimento
do desenho. Publicação depende de configuração do SSO no Rails HML e dos testes.

## Fora do escopo

Cadastro/senhas novos, migração de dados do crawler, compartilhamento de chaves
entre colegas, cobrança de IA pelo ProcStudio, alterações nos crawlers de
tribunais além das necessárias à compatibilidade, logout global e novo serviço
de identidade independente do Rails.
