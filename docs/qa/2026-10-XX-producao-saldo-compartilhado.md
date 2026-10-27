# Produção — saldo compartilhado, versão 1.4.0 (PREENCHER NO DEPLOY)

> Modelo. Nada abaixo foi executado ainda: preencher no deploy, com os valores reais.
> Pré-requisitos: PR ProcStudioOrg/ProcStudio#876 em produção e preço de `glm-5.3-flash` conferido no Rails.

- Release: `releases/<preencher no deploy>` · imagem `jur:<preencher no deploy>`
- Anterior (`.previous-release`): `<preencher no deploy>`
- Backup: `backups/<preencher no deploy>/`
- Variáveis novas no `infra/.env` da release: as seis `PROCSTUDIO_LLM_*` (ver `infra/README.md`).

## Verificações de saúde

| Verificação | Esperado | Resultado |
|---|---|---|
| `/api/v1/saude` | 200, `versao` 1.4.0 | preencher no deploy |
| `/api/v1/me` | 401 | preencher no deploy |
| `/__local/painel.js` | 404 | preencher no deploy |
| container | `healthy` | preencher no deploy |
| log do boot | `aviso de deploy: enviado` | preencher no deploy |
| `GET /api/v1/saldo` logado | `disponivel: true`, `saldoBrl` numérico | preencher no deploy |

## Conversa real com busca (seção 4.4, passo 4 do design)

Uma conversa real na conexão ProcStudio, com pelo menos uma busca em tribunal. Registrar os três valores
e conferir que são coerentes entre si.

| Valor | Onde ver | Registrado |
|---|---|---|
| Custo mostrado na interface (R$, resposta e total da conversa) | tela do chat / `custoTotalBrl` | preencher no deploy |
| Linha do `/ia-uso` do time (modelo, tokens, R$ cobrado, `request_id`) | ProcStudio `/ia-uso` | preencher no deploy |
| Geração no painel do OpenRouter (id, tokens, custo USD) | OpenRouter Activity | preencher no deploy |

Também registrar: saldo do time antes e depois (a queda deve ser igual à soma cobrada), e que
`cobranca_pendente` ficou vazia ao final.
