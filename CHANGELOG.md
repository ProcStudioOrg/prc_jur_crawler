# Changelog do JurCrawler

A versão fica em `jur/package.json` (fonte única) e aparece em `GET /api/v1/saude`
(`versao`). Cada deploy em produção leva uma versão nova:

- **patch** (1.0.x): correção de crawler, texto, ajuste sem mudança de contrato;
- **minor** (1.x.0): tribunal novo, recurso novo, campo novo na API;
- **major** (x.0.0): quebra de contrato da API REST/MCP.

Suba com `cd jur && npm version <patch|minor|major> --no-git-tag-version` e registre
aqui. No primeiro boot de cada release o servidor avisa o FFD
(`Deploy: jurcrawler v<versão>`), via `USAGE_WEBHOOK_URL` — ver `jur/servidor/aviso-deploy.js`.

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
