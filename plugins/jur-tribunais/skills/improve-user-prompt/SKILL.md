---
name: jur-improve-user-prompt
description: Use when a jurisprudência request is vague, broad or ambiguous ("procura sobre aposentadoria", "o que os tribunais decidem sobre isso") — turns it into a precise search plan (tribunal, query, date range, filters, objective) before any crawler runs. Invoke before jur-browser whenever the intent is not already explicit.
---
<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->

# jur-improve-user-prompt — pedido vago → plano de busca

Uma busca ruim custa minutos de crawler e devolve 6.000 resultados inúteis. Esta skill gasta
30 segundos antes para acertar o recorte.

<HARD-GATE>
NUNCA rode o crawler antes de ter os 4 obrigatórios abaixo definidos.
Se faltar informação que muda o resultado, PERGUNTE — no máximo 2 perguntas de uma vez.
Sempre mostre o plano final ao usuário antes de executar.
</HARD-GATE>

## Os 4 obrigatórios

| # | Campo | Se o usuário não disse |
|---|---|---|
| 1 | **Tribunal** | Deduza da UF/matéria mencionada; se não houver pista, **pergunte** |
| 2 | **Tema (query)** | Extraia os termos jurídicos do pedido; termos compostos entre aspas |
| 3 | **Objetivo** | favorável / contrária / panorama — **pergunte** se não for óbvio |
| 4 | **Recorte temporal** | default: últimos 2 anos; diga que assumiu isso |

Opcionais que valem perguntar quando o tema pede: instância (1º grau / 2º grau / Turmas
Recursais), competência (Juizado × Justiça Comum), área (cível × criminal), relator, órgão.

## Como deduzir o tribunal

| Pista no pedido | Tribunal |
|---|---|
| Nome de estado ou sigla de UF | TJ daquele estado (confirme se há falha) |
| "federal", INSS, benefício previdenciário, servidor federal | TRF da região daquela UF |
| Trabalhista, verbas rescisórias, CLT | TRT da UF do vínculo; todos estão no FALCÃO |
| Contas públicas, licitação, TCU | TCU |
| "Turmas Recursais", Juizado Especial Federal | TRF (`--origem turmas-recursais` no TRF4) |
| Nenhuma pista | **Pergunte.** Não escolha por você. |

Confira sempre `cobertura/CLAUDE-FALHAS.md`. Se o tribunal estiver ali, diga a
limitação **antes** e leia o guia para oferecer alternativa pertinente. Se não
estiver no catálogo de `CLAUDE.md`, trate como ainda não implementado.

## Como transformar o tema em query

1. **Extraia o termo técnico**, não o coloquial.
   "aposentadoria de quem trabalha com gasolina" → `"aposentadoria especial"` + `frentista`
2. **Termos compostos entre aspas.** `-q "tempo especial"`, não `-q tempo especial`.
3. **Não empilhe keywords na primeira busca.** Comece amplo, conte, depois refine —
   a árvore de decisão está na skill `jur-browser`.
4. **Operadores só se o tribunal suportar** — leia o `CLAUDE-<TRIBUNAL>.md`. Vários módulos
   tratam `E`/`OU`/`NÃO` como palavra literal.

## Perguntas que valem fazer

Faça no máximo duas por vez, e só quando a resposta muda o comando:

- "Você quer teses **favoráveis** ao seu cliente, as **contrárias** (para antecipar), ou um **panorama**?"
- "Qual instância interessa: 1º grau, 2º grau (câmaras) ou Turmas Recursais dos Juizados?"
- "Isso é **Juizado Especial** ou **Justiça Comum**? A jurisprudência é bem diferente."
- "Que período? Sem recorte a busca traz milhares de resultados."

Perguntas que **não** valem fazer (deduza ou assuma e avise): formato de saída, número de
resultados, se deve baixar inteiro teor.

## Saída — o plano

Apresente assim antes de executar:

```
Plano de busca
  Tribunal : TRF4 (RS/SC/PR) — Turmas Recursais
  Tema     : "tempo especial" + frentista, hidrocarbonetos
  Objetivo : teses favoráveis ao segurado
  Período  : 01/01/2024 a 24/07/2026  (assumido: últimos 2 anos)
  Inteiro teor: sim (Turmas Recursais têm ementa de uma frase)

  ./bin/jur trf4 --origem turmas-recursais -q "tempo especial frentista" \
    -di "01/01/2024" -df "24/07/2026" -m 1 --json

  Primeiro conto os resultados, depois refino se passar de 50.
```

Depois entregue para a skill `jur-browser` executar.

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "Entendi o que ele quer" | Objetivo (favorável/contrária/panorama) muda a query. Confirme. |
| "Pergunto depois de ver os resultados" | Depois já gastou o crawler. Pergunte antes. |
| "Vou perguntar tudo de uma vez" | Máximo 2 perguntas. O resto assuma e avise. |
| "Escolho o tribunal mais completo" | O tribunal é do caso do usuário, não o mais fácil. |
| "Coloco todas as keywords logo" | Query estreita demais devolve 0. Amplo → conte → refine. |
