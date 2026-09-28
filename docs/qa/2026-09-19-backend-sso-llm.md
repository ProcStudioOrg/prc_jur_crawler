# QA do backend SSO / múltiplos provedores

Revisão: base `6e6ca20dd70550481339cd57109dde266b77d1e0` + diff local de implementação, 2026-09-19.
Escopo: aplicação HTTP, escopos individuais, sessões, credenciais, transporte e adaptadores LLM.
Nenhum código de produto alterado pelo QA; somente testes e este relatório. Nenhum commit/deploy/envio externo.

| Ambiente | Resultado | Evidência |
| --- | --- | --- |
| Local inicial | PASS | 15 testes de aplicacao, isolamento, cofre, conexoes-llm, destinos-llm, provedores, procstudio, sessoes-web. |
| Local após correções | PASS | 21 testes direcionados, zero falhas. Achados abaixo corrigidos pelo implementador e revalidados pelo QA. |
| HML / produção | NOT_RUN | Nenhuma implantação ou teste remoto desta revisão. |

## Achados

1. **P1 — resposta sem corpo pode derrubar o servidor inteiro.** `servidor/destinos-llm.js`, callback de `https.request`: `new Response(Readable.toWeb(res), {status: 204})` lança `TypeError` fora do executor síncrono da Promise. Não é capturado pelo caller. Um endpoint custom público respondendo 204/205 pode causar indisponibilidade global. Regressão em `tests/destinos-llm.test.js` executa transporte em subprocesso com resposta 204 simulada; exit observado 1. Usar body null nos status sem corpo e proteger montagem de headers/Response com try/catch/reject.

2. **P2 — listagem de relatores escapa isolamento e limite global.** `servidor/escopo.js` só envolve `executor.executar`. Como não injeta `listarFn`, `ferramentas.js` chama `executor.listar` sem cwd/env do proprietário e fora do limitador global. Listagem STF usa cache WAF em tmpdir global. Regressão em `tests/isolamento.test.js` confirma `options.cwd` undefined ao executar `listar_relatores` com scope. Injetar listagem com mesmo ambiente e semáforo das buscas.

3. **P2 — erros de catálogo expõem trecho bruto do provedor.** `servidor/provedores/index.js`, `listarModelos`: `response.json()` sem sanitização. A rota devolve `e.message`, incluindo trechos do corpo do upstream. Fixture `sk-abcd not json` reproduz vazamento dessa credencial fictícia inteira no SyntaxError. Regressão em `tests/provedores.test.js`. Sanitizar parsing/estrutura; limitar tamanho do catálogo, hoje sem teto explícito.

## Evidências / reprodução

A partir de `jur`:

```sh
node --test tests/aplicacao.test.js tests/isolamento.test.js tests/cofre.test.js tests/conexoes-llm.test.js tests/destinos-llm.test.js tests/provedores.test.js tests/procstudio.test.js tests/sessoes-web.test.js
```

Os testes de regressão não fazem chamadas externas: usam transporte/processo filho simulados e bancos/diretórios temporários.

## Aspectos revisados sem falha reproduzida

Identidade confirmada por Rails em cada requisição; isolamento por emissor/usuário/equipe; 404 para recursos alheios; cookies HttpOnly/SameSite; rejeição de credenciais ambíguas; CSRF por Origin; PKCE/state vinculados ao browser; sessão delegada criptografada; cifra AES-GCM vinculada a dono/conexão; hash de chaves pessoais; validação de destinos privados e pinagem DNS; erro upstream HTTP sanitizado no chat; limite de bytes no stream; revalidação periódica da sessão durante streams.

Pendências: browser integrado, chamadas reais aos provedores, proxy/access logs e HML não foram avaliados nesta subtarefa. Não declarar QA completo.


## Revalidação final

Os três achados acima foram corrigidos e seus testes passaram. Achado funcional adicional resolvido: SDK Anthropic entrega `Headers` de fetch, que precisam ser normalizados para objeto antes de `https.request`; regressão comprova envio de `x-api-key` e `content-type`. Transporte agora pede `Accept-Encoding: identity` explícito, evitando depender de descompressão implícita de fetch.

Teste de concorrência adicional comprovou teto de três listagens simultâneas entre 12 proprietários. Teste Gemini comprovou que `thoughtSignature` opaca e nome/ID de tool result sobrevivem ao ciclo stream → SQLite → recarregar → serializar para Gemini.

Comando direcionado acima: **21 PASS, zero FAIL**, após correções. Sem achados pendentes reproduzidos neste escopo.

Hashes de arquivos finais revalidados:

- `jur/servidor/aplicacao.js`: `fa4ce5c1ac376f5eeaffa120faa8a1d3e12a182c879926f8db4e51a2d9b7b4b4`
- `jur/servidor/escopo.js`: `6e19176eb8c5994cdd860790f7d36ed52ae53783d62e883420df0359d66f1118`
- `jur/servidor/destinos-llm.js`: `976bb1524c2cfff109cd99071e2dd79eeb9c83e67cd4edd68f1121fc6fb2d868`
- `jur/servidor/provedores/index.js`: `902be7aaeea39c33e2073d8254e3a058b94a1b9dd47b60497d8909e13b189bb3`

## Ensaio integrado posterior — 19/09/2026

PASS no navegador Chromium contra os três serviços reais locais: crawler → SvelteKit
(porta 3202) → Rails/Puma (Docker, porta 3201) → PostgreSQL isolado. Usuário FactoryBot
`jur-e2e@example.invalid`, sem acesso ou alteração de dados HML. Login retorna identidade
correta ao crawler (porta 3203), logout revoga sessão e `/me` volta a 401.
Dois POSTs exchange simultâneos do mesmo código tiveram status 200 e 401: uma só sessão.
Evidência: `/tmp/jur-integracao-real.log`. Reprodução em `jur/tests/manual/procstudio-sso.js`.

Browser crawler: 72 testes PASS. Aceite TJSC rápido: 6/6 verificações estruturais PASS;
não consulta portal ao vivo. HML continua NOT_RUN. Provedores pagos continuam simulados.

## Revisão final independente

Corrigidos e revalidados: cache não expulsa banco com job cancelado ainda pendente/em
execução; seletor ignora catálogo atrasado de conexão anterior antes de alterar estado.
Revisor executou 4 testes de isolamento e 1 browser da corrida: 5 PASS.
Suíte browser final: 73 PASS. ProcStudio build de produção concluído; 13 RSpec e 21 Vitest PASS.
Detector visual em modo degradado (módulos parser ausentes); apontou bordas existentes em
blockquote/estado de tribunal, preservadas por semântica. Painel verificado visualmente
em desktop e 390px; empilhamento sobre gaveta corrigido. Não é atestado WCAG completo.

Suíte unitária final: 301 PASS. Regra adicional: chaves curtas também são totalmente
mascaradas (nunca retornar o segredo inteiro como sufixo); teste CRUD direcionado PASS.
[Desktop](imagens/configuracoes-desktop.png) · [Mobile](imagens/configuracoes-mobile.png).
