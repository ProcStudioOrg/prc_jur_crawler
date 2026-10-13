# Implantação em produção — STJ pela Steel com resolvedor de captcha

Data: 2026-10-13. Ambiente: produção (`https://jurcrawler.com.br`).

- Commit: `9dbffd7` (merge de `feat/stj-steel-resolvedor` na `main`).
- Imagem: `jur:9dbffd7` (`sha256:37b0d33a…`), revisão gravada no label OCI.
- Release: `releases/20261013-141939-9dbffd7`; anterior `releases/20261013-122701-01345a1` (`jur:01345a1`).
- Pacote: `git archive` da `origin/main`, SHA-256 `bf7da5af…` conferido antes e depois do envio.
- `.env`: copiado da release anterior trocando só `JUR_IMAGE` (a `STEEL_API_KEY` já estava lá).

## Por que

Decisão do dono do projeto: exceção à regra "não automatizar captcha", só para o STJ, usando
o crédito da Steel. Desenho em [`CLAUDE-STJ.md`](../../jur/CLAUDE-STJ.md).

## Validação

| Verificação | Resultado |
|---|---|
| Steel + `solveCaptcha`, sonda na home do SCON | Turnstile resolvido em ~63s após o goto |
| A mesma sessão com `context.request` | HTTP 403 (sai do IP local) → consultas passaram para `fetch` na página |
| CLI real (`stj -q "usucapião extraordinária" -m 1`) via `comNavegadorRemoto`, local | 10 acórdãos, 52s e 43s |
| Imagem nova, container temporário no H2 | 10 acórdãos, 51s |
| Testes de navegador na imagem (`navegador-assistido`, `navegadores`) | 17/17 |
| `npm test` local | verde, exceto 1 teste de tempo do `llm`, que falha igual sem a mudança (load average acima de 170 no Mac) |
| Após a troca: `saude` · `me` · `__local/painel.js` · `docs` · `auth/login` | 200 · 401 · 404 · 200 · 303 |
| `navegadores.js` servido | SHA-256 idêntico ao commit |
| STJ real dentro do container no ar | 10 acórdãos, 51s |

## Backup e rollback

`backups/20261013-141939-9dbffd7/`: `dados-cache.tar.gz` (SHA256SUMS conferido), `previous.env`, `release.json`.
`.previous-release` aponta para `20261013-122701-01345a1`.

## Limites desta validação

O caminho de reserva (resolvedor não libera em 150s → pausa para o usuário) não aconteceu
de verdade; está coberto pelos testes da ponte de intervenção. A abertura automática do
painel foi testada no navegador com dados simulados, não com login real ProcStudio.
