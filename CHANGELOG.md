# Changelog do JurCrawler

A versão fica em `jur/package.json` (fonte única) e aparece em `GET /api/v1/saude`
(`versao`). Cada deploy em produção leva uma versão nova:

- **patch** (1.0.x): correção de crawler, texto, ajuste sem mudança de contrato;
- **minor** (1.x.0): tribunal novo, recurso novo, campo novo na API;
- **major** (x.0.0): quebra de contrato da API REST/MCP.

Suba com `cd jur && npm version <patch|minor|major> --no-git-tag-version` e registre
aqui. No primeiro boot de cada release o servidor avisa o FFD
(`Deploy: jurcrawler v<versão>`), via `USAGE_WEBHOOK_URL` — ver `jur/servidor/aviso-deploy.js`.

## 1.3.0 — 26/10/2026

Saldo compartilhado: a conexão de IA nativa do ProcStudio, cobrada por rodada do saldo de IA do
time (detalhes em `docs/procstudio-llm.md`). Exige o PR ProcStudioOrg/ProcStudio#876 em produção.

- conexão `procstudio` gerenciada pelo operador (chave só no ambiente); modelo fixo `glm-5.3-flash`;
- cobrança por rodada em `service_access/ai_usage` (idempotente), pré-checagem de saldo em
  `service_access/ai_balance` (402 `saldo_insuficiente`, 409 `cobranca_pendente`, 503 `procstudio_indisponivel`);
- recibos não registrados ficam em `cobranca_pendente` e são reenviados por um varredor (60 s e no boot);
  alerta ao operador `procstudio_llm_operator_failure`, uma vez por recibo;
- evento SSE `custo`, `fim.custo`, tabela `custo_turno`, `custos`/`custoTotalBrl` em `GET /api/v1/conversas/:id`
  e rota nova `GET /api/v1/saldo`;
- interface: saldo, seletor de modelo com "recomendada", custo por resposta e total da conversa, cartão de
  bloqueio com "Adicionar créditos" e "Tentar de novo", reenvio sem duplicar a pergunta;
- ambiente local com carteira simulada (`JUR_LOCAL_SALDO_INICIAL`);
- credencial de serviço recusada (`SERVICE_AUTH`, 401 do Rails ou emissor desconhecido) não descarta mais o
  recibo: ele fica em `cobranca_pendente`, o varredor reenvia e o operador recebe o alerta `credencial_servico`
  (um por minuto); `ai_balance` com 401 também vira `SERVICE_AUTH`;
- usuário ou time inativo no ProcStudio (`ai_balance` com `active: false`) encerra a sessão do JurCrawler:
  `GET /api/v1/saldo` e o chat respondem 401 `sessao_invalida` (antes, 503 "indisponível") e a tela volta ao
  login com o motivo; Rails fora continua 503; carteira local simula os dois casos (`JUR_LOCAL_PROCSTUDIO`);
- envs novas: `PROCSTUDIO_LLM_API_KEY`, `PROCSTUDIO_LLM_ENDPOINT`, `PROCSTUDIO_LLM_MODELO`,
  `PROCSTUDIO_LLM_MODELO_CATALOGO`, `PROCSTUDIO_LLM_UPSTREAM`, `PROCSTUDIO_LLM_ROTULO`.

## 1.2.1 — 21/10/2026

Sentinela ligada em produção (`JUR_SENTINELA=1`), depois da validação ao vivo dos casos no H2
em 21/10 (87 casos locais: 59 ok, 16 falhas, 12 não verificáveis; detalhes em `docs/kaizen.md`).

- `jur/tests/sentinela-casos.json`: 12 casos que falham por crawler/portal ou IP saem da lista e
  vão para `_pendentes` com o motivo (STF: desafio do WAF mudou; TCDF: cadeia TLS incompleta;
  TJMS: filtro de relator ignorado; TJPI: filtro de data de publicação ignorado; TJRJ ejuris:
  filtro de data de julgamento ignorado; TJES: bloqueia o IP do H2). Ficam 77 casos; TJMT (API
  em 503 no dia) e TJRO (timeout só no H2) continuam na lista.

## 1.2.0 — 20/10/2026

Kaizen: o JurCrawler passa a enxergar as próprias falhas (detalhes em `docs/kaizen.md`).

- captura de falha com print, HTML e passo da navegação, por busca, sem custo em busca que dá certo;
- conferência dos filtros pedidos contra os resultados, com aviso ao usuário quando o tribunal ignora o filtro (na dúvida, `nao_verificavel`);
- resgates (navegador reserva e captcha resolvido à mão) registrados;
- outbox persistente para o FFD (`jur-diagnostico`), com retentativa e teto de tamanho;
- botão Relatar na interface: card no Linear BRU e cópia no FFD (`user-issues`), com o histórico da conversa;
  idempotente (mesmo título + descrição em 10 min devolve o mesmo card). Absorve o BRU-91
  (botão "Reportar" e rota `/api/v1/feedback`, em produção desde a 1.1.0): saem, e fica só o
  Relatar com a rota `/api/v1/relatos`, que faz o mesmo e ainda leva o contexto da busca, a
  conversa e a cópia no FFD;
- sentinela diária às 04:00 de São Paulo, com casos reais por tribunal e capacidade (`npm run sentinela`);
- envs novas: `KAIZEN_WEBHOOK_URL`, `KAIZEN_WEBHOOK_TOKEN`, `KAIZEN_SALT`, `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `JUR_SENTINELA`, `JUR_SENTINELA_MAX_REMOTO`, `JUR_SENTINELA_PRAZO_MIN`.

## 1.1.0 — 20/10/2026

Lote dos cards do Linear (detalhe em `docs/qa/2026-10-19-cards-linear-jurcrawler.md`; produção em
`docs/qa/2026-10-20-producao-lote-cards.md`):

- BRU-88: recorte de juizados do TJPR chega à tela, à API e ao chat;
- BRU-75: catálogo enxuto na listagem e detalhe por tribunal (`GET /api/v1/tribunais/{comando}`);
- BRU-87: tetos de admissão da fila com 429 e `Retry-After`;
- BRU-76: primeiro turno recusado não deixa conversa vazia;
- BRU-77: gate de release executável sem argumento (`npm run aceite`);
- BRU-91: botão "Reportar" vira card no Linear (`/api/v1/feedback`); substituído pelo Relatar na 1.2.0.

## 1.0.1 — 16/10/2026

- Tela de entrada nova: ícone oficial (lupa + raio) centralizado em 3D por camadas, nome
  JurCrawler, terminal em estilo CRT que reproduz a pesquisa real de pensão por morte no
  TJPR/STF (julgados verificados por número) e faixa "O que é o JurCrawler" com o robô 3D.
  Tudo escopado em `#login-procstudio`; o app logado não muda.
- `favicon.svg` e `icone.svg` com o ícone do JurCrawler; `robo.webp` servido com MIME correto.

## 1.0.0 — 14/10/2026

Primeira versão numerada. Reúne o que está em produção desde o SSO ProcStudio (24/09):

- navegadores remotos: TRF3 e Justiça do Trabalho pela Kernel, com a Steel de reserva;
- STJ pela Steel com resolvedor de captcha e navegador assistido aberto por padrão;
- TRF3: paginação, espera da lista e zero resultados falso corrigidos;
- aviso de deploy ao FFD.
