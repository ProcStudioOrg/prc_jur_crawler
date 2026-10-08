# QA em produção — SSO ProcStudio, isolamento e LLM (PRC-1064)

Data: 2026-10-08. Ambiente: produção (`https://jurcrawler.com.br`). Não existe HML do crawler.
Release: `releases/20260929-133356-7e25ea8` (label `org.opencontainers.image.revision` = `7e25ea8`).
Conta: usuário A de teste (titular `b67ea2fa…`). Outro titular usado como alvo: `a38401cd…`
(IDs lidos do volume em modo somente leitura; nada foi escrito nos bancos).

## Resultado

| Item | Resultado | Evidência |
|---|---|---|
| Smoke público | PASS | `/api/v1/saude` 200, `/api/v1/me` sem sessão 401, `/__local/painel.js` 404 |
| Login via ProcStudio | PASS | `/auth/login` 303 → `procstudio.com.br/_auth/jurcrawler` → login → `/auth/callback?code=…` 303 → `/` |
| JWT fora da URL | PASS | Só `state`, `code_challenge` e o código de uso único aparecem em URL |
| Cookies | PASS | `jur_session` e `auth_token` com `HttpOnly` + `Secure`; localStorage e sessionStorage vazios |
| Replay do código | PASS | Reusar o mesmo `callback?code=` → 303 `/?login=erro`, sem `jur_session` |
| Chat com ferramenta | PASS | OpenRouter `z-ai/glm-5.3-flash`: `buscar_jurisprudencia` (TJSC, 2024) → `ler_resultados` (job `ef8f1208…`) → resposta com 2 julgados |
| Persistência | PASS | Após recarregar: conversa listada e modelo selecionado mantido |
| Credencial | PASS | `/conexoes-llm` devolve só `id, provider, name, model, endpoint, maskedKey`; nenhum `sk-or-v1-…` nas listas |
| IDs de outro titular (sessão) | PASS | 12/12 → 404: GET conversa, `/buscas`, `/stream`; GET busca, `/resultados`, `/eventos`; GET `/modelos`, POST `/validar`, PATCH conexão; DELETE conversa, busca e conexão. Próprios → 200 |
| Listas de A | PASS | `/conversas`, `/buscas`, `/conexoes-llm` não contêm IDs do outro titular |
| Bearer pessoal REST | PASS | `/me` 200; busca própria 200; conversa do outro 404 |
| Bearer pessoal MCP | PASS | `initialize` ok; `tools/list` = `listar_tribunais, buscar_jurisprudencia, listar_relatores, ler_resultados`; `ler_resultados` próprio ok, do outro → `Job desconhecido` (`isError`) |
| Revogação da chave | PASS | DELETE 200 → REST e MCP 401; registro mantém `revogadoEm` |
| Logout | PASS | `/me` 401; `sessao_web` em `acesso.db` caiu de 2 para 1 linha (sessão apagada no servidor, não só o cookie) |

## Não executado

- Usuário B da **mesma equipe** pela interface: sem senha da conta B. O isolamento foi
  comprovado contra os dados reais de outro titular via API/MCP, que é a mesma barreira.
- Expiração natural da sessão (24 h).

## Observação

A página `procstudio.com.br/login?redirectTo=…` manda a URL completa ao Google Analytics,
incluindo `state` e `code_challenge`. Não são segredos (o desafio PKCE é público por
desenho e o `state` é de uso único), mas não precisam sair do domínio.
