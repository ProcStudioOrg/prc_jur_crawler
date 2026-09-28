# Conciliação da main — 28/09/2026

Integrados os commits locais `adbf92c` (TCE-CE) e `edecb34` (TCE-GO) à
`origin/main` em `87b16c2`, preservando os históricos por merge. O remoto contém
SSO ProcStudio, conexões de IA, navegadores assistidos, ambiente local e os
registros de implantação anteriores.

## Ajustes de integração

- Completados nomes, referências dos crawlers e testes de TCE-CE/TCE-GO no
  catálogo gerado.
- Registradas as capacidades de relator: TCE-GO usa o nome exato em caixa alta do
  relator do processo; TCE-CE recusa o filtro nas ferramentas de chat/MCP e indica
  a consulta ao PDF, pois a flag da CLI apenas emite um aviso.
- Renomeados 18 JSON de evidência com o prefixo `01-`, sem alterar seu conteúdo;
  referências e índices regenerados conforme a nomenclatura do mapeamento.
- Versionados os scripts locais de mapeamento TCE-ES, com instruções de execução.
- Preservados os ajustes locais do CRPS: o índice e a contagem de capturas refletem
  os arquivos presentes. Capturas autenticadas são ignoradas pelo Git e não foram
  excluídas nesta conciliação.
- Logs de notificação do agente diário permanecem locais, agora ignorados pelo Git.

## Validação

Executada em `jur/`, com Node 22.14.0 e dependências do `package-lock.json`:

| Verificação | Resultado |
| --- | --- |
| `npm test` | 331 passaram, zero falhas |
| `npm run test:browser` | 90 passaram, zero falhas |
| `npm run aceite -- TJSC --rapido` | 6/6 obrigatórios |
| `npm run aceite -- TCECE --rapido --sem-desambiguacao` | 6/6 obrigatórios, nomenclatura aderente |
| `npm run aceite -- TCEGO --rapido --sem-desambiguacao` | 6/6 obrigatórios, nomenclatura aderente |
| `npm run docs` e `node sync-plugin.js --check` | Índices regenerados e 21 skills sincronizadas |
| `node --check` nos dois scripts TCE-ES | Sintaxe válida |
| `git diff --check` e revisão das correções | Sem problemas encontrados |

Os testes de regressão demonstraram antes da correção a ausência dos metadados e
da classificação de relator. A dependência local ausente `@anthropic-ai/sdk` foi
instalada com `npm ci`, sem modificar o lockfile. Uma execução conjunta das suítes
excedeu o limite de 180 ms do teste de paralelismo de ferramentas de IA (195 ms);
o teste passou na suíte final, executada sem navegadores simultâneos, sem mudança
no código de IA ou no limite do teste.

Os aceites rápidos verificam estrutura e documentação; não representam uma nova
validação dos portais externos. Os scripts de captura foram apenas inspecionados,
sem sobrescrever evidências. Não houve deploy nesta conciliação. A branch
`fix/openrouter-stream-abort` e seu worktree foram preservados.
