# Frontend do `jur` no estilo Claude — chat, histórico, disponibilidade e camada de integração

**Data:** 2026-08-22
**Status:** aprovado
**Substitui:** a seção 4.6 (frontend) de `2026-08-22-dockerizacao-e-frontend-design.md`
**Branch:** `docker-frontend` (nada foi mergeado ainda; este trabalho sucede a Task 12)

## 1. Por que refazer

O primeiro frontend pôs a lista de 75 tribunais na lateral e o chat no centro. O pedido era um
chat. A lista virou o protagonista de uma tela onde deveria ser referência consultada, e a
lateral — o lugar natural do histórico de conversas — foi ocupada por dado estático.

Além disso, três coisas que a interface exige não existem no backend: escolha de modelo (o
`claude-opus-5` é fixo em `llm.js`), persistência de conversa (as tabelas `conversa` e
`mensagem` foram criadas na Task 5 e nunca escritas) e uma camada de autenticação por chave.

E não existe documentação da API: são 10 rotas no ar e uma documentada por um `curl` de exemplo
no README.

## 2. Layout

Referência visual: Claude.ai. Paleta, tipografia e densidade seguem o mesmo espírito, em claro
e escuro.

### 2.1 Lateral (~260px)

De cima para baixo:

- marca `jur`
- botão **Nova conversa**
- **histórico de conversas**, mais recentes primeiro, com o título derivado da primeira
  mensagem do usuário; conversa ativa destacada
- rodapé: bloco de **configuração**, que abre o painel de chaves (§2.4)

Sai da lateral: a lista de tribunais e o placar. Eles migram para §2.3.

### 2.2 Centro — tela inicial (sem conversa aberta)

- saudação
- campo de mensagem, com o **seletor de modelo** no canto inferior direito (`Opus 5 · High`)
- abaixo, nesta ordem:
  1. **Modelos de prompt** — cards que preenchem o campo ao clique. Quatro, cobrindo os usos
     reais: buscar tese firmada; comparar entendimento entre tribunais; verificar se um julgado
     existe; levantar precedentes por período.
  2. **Disponibilidade** — §2.3
  3. **Manual** — seção recolhível e curta: o que o sistema faz, como a busca funciona, o que os
     quatro estados significam, e por que zero resultado não prova ausência de jurisprudência.

### 2.3 Disponibilidade

Substitui a lista vertical. Bloco horizontal com:

- contadores por estado (ok · instáveis · bloqueados · exige sessão)
- grade compacta de siglas, coloridas por estado
- clique numa sigla abre a **ressalva completa** num painel — **sem depender de hover**, que é o
  requisito que a Task 12 já tinha corrigido e não pode regredir

Some quando há conversa aberta.

### 2.4 Painel de configuração

Duas seções distintas, e a distinção precisa ficar óbvia na tela:

- **Chave da LLM** — a chave da Anthropic que *o jur usa* para conversar. Continua vivendo no
  `localStorage` do browser e indo por cabeçalho; **nunca** é persistida no servidor.
- **Chaves de conexão** — chaves que *o jur emite* para clientes externos (Claude Code, MCP,
  scripts) se autenticarem contra a API do jur. Gerar, listar, revogar. O valor completo é
  exibido **uma única vez**, no momento da criação.

### 2.5 Centro — em conversa

Mensagens e campo, apenas. Chamadas de ferramenta aparecem como linha discreta (`▸ buscar_jurisprudencia(...)`).

### 2.6 Tema

Claro `#FAF9F5` sobre `#1F1E1D`; escuro `#262624` sobre `#FAF9F5`; acento `#D97757`. Alternador
manual; `prefers-color-scheme` como padrão. Sem framework, sem build step — a restrição do
projeto não muda.

## 3. Backend

### 3.1 Escolha de modelo

`POST /api/v1/chat` passa a aceitar `model` e `effort`, validados contra allowlist em
`validacao.js` (o módulo compartilhado que já existe). Fora da lista → 400 na rota, texto legível
na tool.

- modelos: `claude-opus-5` (padrão), `claude-sonnet-5`, `claude-haiku-4-5`
- esforço: `low`, `medium`, `high` (padrão)

`effort` viaja em `output_config.effort`. As restrições da API seguem valendo: sem
`budget_tokens`, sem `temperature`/`top_p`, sem prefill, `max_tokens: 64000` em streaming.

### 3.2 Persistência de conversa

Usa `conversa` e `mensagem`, já criadas em `db.js`.

- `POST /api/v1/conversas` → cria e devolve `{id}`
- `GET /api/v1/conversas` → lista (id, título, atualizado_em)
- `GET /api/v1/conversas/:id` → mensagens
- `DELETE /api/v1/conversas/:id`
- `POST /api/v1/chat` aceita `conversaId` e grava as mensagens do turno

**Grava o `content` estruturado**, não só texto: os blocos `tool_use` e `tool_result` precisam
sobreviver, senão no turno seguinte o modelo perde os `job_id` das buscas que ele mesmo fez — o
defeito que o histórico só-no-browser tem hoje.

Título: derivado da primeira mensagem do usuário, truncado.

### 3.3 Chaves de conexão

Tabela nova `chave_conexao(id, nome, hash, prefixo, criado_em, ultimo_uso_em, revogado_em)`.

- guarda **hash** da chave, nunca o valor
- `prefixo` (primeiros caracteres) serve para o usuário reconhecer qual é qual na lista
- `POST /api/v1/chaves` → gera, devolve o valor **uma vez**
- `GET /api/v1/chaves` → lista sem valores
- `DELETE /api/v1/chaves/:id` → revoga

**Exigência:** as rotas de API (`/api/v1/*` exceto `saude`, e `/mcp`) passam a exigir
`Authorization: Bearer <chave>` **ou** origem local legítima (o próprio frontend). A verificação
de `Origin` que existe hoje continua como segunda barreira.

Isto fecha o achado residual da revisão final: `POST /api/v1/buscas` aceitava requisição
cross-origin e enfileirava busca real contra tribunal usando o IP do operador.

### 3.4 Documentação da API

- **OpenAPI 3.1** em `jur/servidor/openapi.js`, servido em `GET /api/v1/openapi.json`
- página legível em `GET /docs`, renderizada do mesmo documento, sem CDN (a restrição de
  ambiente fechado vale: nada de script externo)
- cobre as 10 rotas existentes mais as novas de §3.2 e §3.3: parâmetros, respostas, códigos de
  erro, e o cabeçalho de autenticação
- **teste que falha quando uma rota registrada não está documentada** — a mesma lógica da
  reconciliação catálogo↔CLI que já existe

## 4. O que não muda

- O invariante central: zero resultados nunca viaja sem ressalva; falha de crawler nunca se
  disfarça de busca vazia. Todos os caminhos novos preservam isso.
- Sem framework, sem build step, CommonJS, `node:test`.
- A chave da LLM não é persistida no servidor.
- `JUR_BIND` continua em loopback por padrão.

## 5. Fora de escopo

- Multiusuário e login. As chaves de conexão autenticam *clientes*, não pessoas.
- Painel de job com progresso e cancelar na UI (era §4.6 do spec anterior) — continua sem
  consumidor; vira card separado.
- Propagação dos `avisos` que 21 subcomandos do crawler emitem e o executor descarta — card
  separado, é trabalho de backend com valor próprio.
- Streaming de contagem de tokens.
