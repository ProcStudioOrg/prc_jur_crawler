# Publicação segura no servidor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan after the server parameters are supplied. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar o `jur` em um servidor próprio sem expor a interface e a chave Anthropic a clientes não autorizados.

**Architecture:** A primeira publicação deve ser privada: Docker Compose mantém o app em `127.0.0.1:3000` e uma VPN de rede, como Tailscale ou WireGuard, controla quem alcança o host. Publicação na internet fica bloqueada até existir autenticação real da interface ou separação segura entre UI e API/MCP.

**Tech Stack:** Docker Engine + Compose, Node.js 22 dentro da imagem, Chromium/Playwright, SQLite em volume, VPN/firewall do servidor.

**Spec:** `infra/README.md`, seções “Exposição na rede” e “Autenticação”.

## Global Constraints

- Nunca publicar a porta 3000 diretamente em `0.0.0.0` na internet.
- Manter `JUR_EXIGIR_CHAVE=1` em produção.
- Guardar `ANTHROPIC_API_KEY` fora do git, em arquivo 0600 ou secret store.
- Persistir `/dados` e `/cache`; incluir `jur.db` no backup.
- Reservar ao menos 4 GB de RAM, 4 GB de disco livre para imagem/cache e 1 GB de `/dev/shm`.
- `trf3` e `crps` continuam indisponíveis dentro do container.

---

### Task 1: Parâmetros que o dono do servidor precisa fornecer

**Files:**
- No repository changes

- [ ] **Step 1: Registrar host e acesso**

Coletar sem publicar segredos: distribuição Linux, arquitetura (`amd64`/`arm64`),
RAM, disco livre, usuário SSH e se Docker/Compose já estão instalados.

- [ ] **Step 2: Escolher alcance**

Recomendado para a primeira versão: acesso privado por Tailscale/WireGuard.
Internet pública exige uma tarefa anterior de autenticação da interface.

- [ ] **Step 3: Definir nome e backup**

Registrar hostname, diretório de deploy, retenção de `jur.db` e destino do backup.

### Task 2: Gate local de release

**Files:**
- Verify only

- [ ] **Step 1: Rodar suíte de código e browser**

```bash
cd jur
npm test
npm run test:browser
npm run aceite
```

- [ ] **Step 2: Construir a imagem do zero**

```bash
docker build --pull -f infra/Dockerfile -t jur:release .
```

- [ ] **Step 3: Provar crawler HTTP e crawler com Chromium**

```bash
docker run --rm jur:release node bin/jur tcu -q "licitação" -m 1 --json
docker run --rm --shm-size=1g jur:release node bin/jur tjsc -q "dano moral" -m 1 --json
```

- [ ] **Step 4: Provar servidor, autenticação e persistência**

Subir `infra/compose.yml`, conferir `/api/v1/saude`, confirmar 401 sem Bearer nas
rotas programáticas, criar uma conversa de teste, reiniciar o container e provar
que `/dados/jur.db` e os resultados sobreviveram.

### Task 3: Preparar o servidor privado

**Files:**
- Create on server: deployment directory and `.env` with mode `0600`
- Reuse: `infra/compose.yml`

- [ ] **Step 1: Instalar ou validar Docker Engine e Compose**

Expected: `docker version` e `docker compose version` retornam sucesso.

- [ ] **Step 2: Configurar rede privada e firewall**

Permitir SSH e tráfego da VPN; negar 3000 nas interfaces públicas. Manter no
Compose `127.0.0.1:3000:3000`.

- [ ] **Step 3: Instalar código e segredo**

Clonar uma revisão imutável/tag. Criar `.env` 0600 com `ANTHROPIC_API_KEY`; não
copiar a chave para histórico do shell, Compose ou repositório.

- [ ] **Step 4: Subir e esperar healthcheck**

```bash
docker compose -f infra/compose.yml up -d --build
docker compose -f infra/compose.yml ps
curl -fsS http://127.0.0.1:3000/api/v1/saude
```

### Task 4: Verificação pós-publicação

**Files:**
- Verify only

- [ ] **Step 1: Testar acesso autorizado pela VPN**

Abrir interface, executar uma busca curta e confirmar que outro dispositivo fora
da VPN não alcança a porta.

- [ ] **Step 2: Testar API/MCP com chave própria**

Gerar uma chave de conexão na interface e fazer uma chamada Bearer de leitura e
uma busca curta. Revogar a chave de teste ao final.

- [ ] **Step 3: Provar backup e restauração**

Parar o serviço, copiar o volume de `/dados`, restaurar em volume temporário e
confirmar que conversas, chaves e jobs reaparecem.

- [ ] **Step 4: Registrar configuração de deploy**

Depois de URL/host e comandos estarem confirmados, adicionar `## Deploy
Configuration` ao `AGENTS.md` para uso futuro por `land-and-deploy`.

### Task 5: Caminho posterior para internet pública

**Files:**
- Requires a separate security/design task

- [ ] **Step 1: Escolher identidade para pessoas e política para clientes**

A UI precisa de login real. API/MCP precisam preservar Bearer tokens. Basic Auth
no mesmo host não serve porque disputa o cabeçalho `Authorization`.

- [ ] **Step 2: Separar superfícies ou implementar sessão de usuário**

Opções aceitáveis: UI com sessão/OIDC em host próprio e API/MCP em host separado;
ou autenticação nativa multiusuário com autorização por rota.

- [ ] **Step 3: Só então adicionar TLS público, domínio e canário**

Exigir HTTPS, rate limiting, limites de custo por usuário, logs sem segredos e
monitoramento periódico de `/api/v1/saude` mais uma busca canário.
