# Changelog do JurCrawler

A versão fica em `jur/package.json` (fonte única) e aparece em `GET /api/v1/saude`
(`versao`). Cada deploy em produção leva uma versão nova:

- **patch** (1.0.x): correção de crawler, texto, ajuste sem mudança de contrato;
- **minor** (1.x.0): tribunal novo, recurso novo, campo novo na API;
- **major** (x.0.0): quebra de contrato da API REST/MCP.

Suba com `cd jur && npm version <patch|minor|major> --no-git-tag-version` e registre
aqui. No primeiro boot de cada release o servidor avisa o FFD
(`Deploy: jurcrawler v<versão>`), via `USAGE_WEBHOOK_URL` — ver `jur/servidor/aviso-deploy.js`.

## 1.3.1 — 24/10/2026

BRU-99: as 5 regressões do `npm run smoke` de 19/10 (diagnóstico em
`docs/qa/2026-10-21-bru-99-smoke-regressoes.md`; revalidação após rebase sobre a 1.3.0 em
`docs/qa/2026-10-24-bru-99-rebase.md`).

- TCDF volta a funcionar: o portal manda só a folha do certificado, emitida pela intermediária
  nova do Let's Encrypt (`YR1`), cuja raiz `ISRG Root YR` não está no trust store do Node 22.
  A cadeia pública entra em `jur/src/certs/` e é passada como `ca` só no `TCDFNavigator`.
- TCEGO volta a funcionar: a API migrou para o proxy da SPA (`decisoes.tce.go.gov.br/api/proxy`),
  exige o cookie de contexto `_tce_nav_ctx` com idade mínima e limita a 20 requests por janela.
  A casca "sem contexto" (HTTP 200 com total 0) vira erro explícito, não "0 resultados".
- TJMT rebaixado para `instavel`: API em manutenção declarada (HTTP 503 "Site em manutenção —
  TJMT", BigIP) desde 19/10; o Navigator nomeia a manutenção. Casos da sentinela em `_pendentes`.
- TJGO rebaixado para `sem-acesso`: a busca passou a exigir Cloudflare Turnstile; zero por bloqueio
  vira erro explícito. Não automatizamos captcha.
- TCE-PA rebaixado para `sem-acesso`: captcha do F5 Shape já no primeiro request.

Correções da sentinela de 21/10 (BRU-101), validadas da debian2 em 24/10/2026 — ver
`docs/qa/2026-10-24-bru-101-sentinela.md`.

- STF: o portal saiu do AWS WAF (responde `server: volt-adc`, F5 Distributed Cloud) e deixou de
  emitir o cookie `aws-waf-token`; o crawler exigia o cookie e falhava. O token virou *lazy* em
  `STFNavigator` (`cookieAtual`, `_post`): a requisição sai com o cookie que houver e o navegador
  só abre se o servidor devolver o desafio. Os 3 casos (periodoJulgamento, periodoPublicacao,
  numero) voltam à sentinela.
- TJMS: o campo `nmAgente` (texto) não filtra relator — o cjsg ignora em silêncio. `-r` agora
  resolve o trecho na grid do popup Relatores (`TJMSNavigator.resolverRelatores`: autocomplete +
  `searchAgente.jsp` na mesma sessão) e manda as entidades em `agenteSelectedEntitiesList` /
  `dados.agentes[i]`; trecho sem entidade é erro. Caso `magistrado` volta (100 de 100 do relator).
- TJPI: a CLI descartava `-dpi/-dpf` (só `-di/-df` chegava ao `data_min/data_max`); o portal
  aplica o filtro normalmente. Caso `periodoPublicacao` volta (25 de 25 em 08/2026).
- TJRJ eJURIS: o servidor só filtra por ano; com `-di/-df` em DD/MM/AAAA o crawler recorta o
  dia no cliente sobre as páginas lidas, com aviso (lista do mais novo ao mais antigo, 10 por
  página). O caso `periodoJulgamento` da sentinela usa a janela do ano, que é o que o portal
  filtra.
- TJES: HTTP 403 só do H2 (IP de produção bloqueado); da debian2 e do Mac responde 200. Catálogo
  `instavel` com nota datada e resumo na ficha; os dois casos ficam em `_pendentes` até o H2
  voltar a passar.
- `jur/tests/sentinela-casos.json`: 84 casos ativos (77 da 1.2.1 + TCDF 4 + STF 3 + TJMS magistrado +
  TJPI periodoPublicacao + TJRJ-ejuris periodoJulgamento − TJMT 3); TJMT, TJES, TJGO e TCE-PA em
  `_pendentes` com motivo. A sentinela do h2 lê os casos da imagem — os casos devolvidos só entram
  na rodada das 04:00 com esta release. Acompanhamento dos rebaixados: BRU-100 (TJMT, TJGO, TCE-PA)
  e TJES (IP do H2).

## 1.3.0 — 22/10/2026

- Banco de processos: a sentinela passa a mandar ao FFD (source `jur-processos`, `acao: alvos`)
  os números CNJ que cada busca bem-sucedida devolveu. O FFD enfileira como alvos de captura
  do processo inteiro (agente da debian2 + extensão do ProcStudio) para o benchmark de IA
  jurídica. Só número, capacidade, query e data do julgado saem; nem texto nem usuário.
  Busca de usuário também alimenta a fila quando `KAIZEN_ALVOS_BUSCA=1` (padrão desligado).
  A key `jurcrawler` do FFD precisa do escopo `jur-processos` (feito em 22/10). Ver
  `docs/kaizen.md` > Banco de processos.

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
