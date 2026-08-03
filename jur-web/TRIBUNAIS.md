# TRIBUNAIS.md — o que funciona só com `web_fetch`

> ⚙️ **Arquivo gerado.** Não edite à mão: rode `node jur-web/medicao/medir.mjs`.
> Última medição: **2026-08-03**.

**4 entradas aprovadas, cobrindo 29 acervos.**

Para entrar aqui um tribunal passa nos quatro critérios, todos medidos:

1. **Responde a GET** com nada além de um `User-Agent` de browser — sem POST, sem cookie, sem Origin/Referer;
2. **Busca de verdade** — o termo-controle `xkqzwvbnhjplmrt` devolve zero. Um portal que
   devolve a mesma listagem para qualquer pergunta é pior que um portal fora do ar:
   ele produz jurisprudência sorteada com cara de resposta;
3. **Traz a ementa no corpo** — sem ementa não há o que ler;
4. **Verifica por número** — um nº CNJ bem formado mas inexistente devolve zero, e o
   número real devolve ele mesmo. Sem isso não há como cumprir a invariante nº 1 do repo.

## ✅ Aprovados

| Tribunal | Acervos | Formato | Encoding | Julgados no teste | Doc |
|---|---|---|---|---|---|
| CARF — contencioso administrativo tributário federal | 1 | JSON | `utf8` | 20 (de 5256) | [`tribunais/carf.md`](tribunais/carf.md) |
| FALCÃO — TST + 24 TRTs + CSJT (26 acervos) | 26 | JSON | `utf8` | 10 (de 10000) | [`tribunais/falcao.md`](tribunais/falcao.md) |
| TJPR — Tribunal de Justiça do Paraná | 1 | HTML | `latin1` | 40 | [`tribunais/tjpr.md`](tribunais/tjpr.md) |
| TJGO — Tribunal de Justiça de Goiás | 1 | HTML | `utf8` | 97 (de 1353819) | [`tribunais/tjgo.md`](tribunais/tjgo.md) |

## ❌ Reprovados — exigem o CLI local

Não são "sem jurisprudência": são **inalcançáveis daqui**. Todos funcionam no
`jur/` com Playwright ou POST. Diga isso ao usuário e ofereça `./bin/jur <tribunal>`.

| Tribunal | Por que não dá por `web_fetch` |
|---|---|
| TRF2 — Justiça Federal RJ/ES (e-Proc) | POST-only: o GET devolve a tela de busca em branco, tanto em `listar_resultados` quanto em `pesquisar` |
| TRF6 — Justiça Federal MG (e-Proc, base 2023+) | aceita o GET e devolve 24 julgados para QUALQUER termo — não busca, lista |
| TJRJ — Tribunal de Justiça do Rio de Janeiro (e-Proc) | aceita o GET e devolve 22 julgados para QUALQUER termo — não busca, lista |
| TJRS — Tribunal de Justiça do Rio Grande do Sul (Solr) | POST-only: o GET no ajax.php devolve corpo vazio (0 bytes) |
| TJDFT — Tribunal de Justiça do DF e Territórios (API pública) | o GET em /pesquisa devolve as FACETAS (lista de relatores), nunca resultados; a busca é POST |
| TJMG — Tribunal de Justiça de Minas Gerais (Consulta Unificada) | POST-only, confirmado pelo próprio OpenAPI em /v3/api-docs: os únicos GET são rotas de status/admin |
| TJCE — Tribunal de Justiça do Ceará (SJURIS) | POST-only, dito pela própria API: {code:500, messages:["...Request method 'GET' not supported"]} |
| TJPA — Tribunal de Justiça do Pará | POST-only: HTTP 405 Method Not Allowed no /bff/api/decisoes/buscar |

## Fora desta medição

| Tribunal | Situação |
|---|---|
| **STJ** | 🔴 bloqueado desde 27/07/2026 (desafio interativo do Cloudflare) — **também no `jur/`**. Nenhum REsp é verificável hoje; não cite de memória. |
| **TJSP** | 🔴 sem acesso, nem aqui nem no `jur/`. |
| **STF** | exige token do WAF obtido por browser — só pelo CLI. |
| TRF1, TRF3, TRF4, TRF5, TJSC, TCU, TJMA, CRPS | dependem de DOM, captcha ou login — só pelo CLI. |
