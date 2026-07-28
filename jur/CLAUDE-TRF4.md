# TRF4 — Tribunal Regional Federal da 4ª Região

**Escopo:** RS, SC, PR · **Status:** OK
**Crawler:** `src/TRF4Crawler.js`

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-di, --data-inicio <date>       Decision start date (DD/MM/YYYY)
-df, --data-fim <date>          Decision end date (DD/MM/YYYY)
-dpi, --data-pub-inicio <date>  Publication start date (DD/MM/YYYY)
-dpf, --data-pub-fim <date>     Publication end date (DD/MM/YYYY)
--origem <tipo>                 trf4 (default) | turmas-recursais
--fetch-inteiro-teor            Download full text of each result
--output-dir <dir>              Directory for downloaded files (default: ./resultados)
--max-results <number>          Max total results to collect
```

## Exemplos

```bash
./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"

# Download do inteiro teor
./bin/jur trf4 -q "aposentadoria especial enfermeiro" --fetch-inteiro-teor --output-dir ./resultados
```

## Notas

- **Turmas Recursais:** sempre baixar o inteiro teor (`--fetch-inteiro-teor`) — as ementas
  costumam ser curtas e o conteúdo relevante está no documento completo.

- **O espaço entre termos é `E`** — medido em 27/07/2026 (recorte 27/06–27/07/2026):
  `tempo` 11.091, `especial` 16.456, `tempo especial` **9.085**. Menor que o menor dos dois,
  logo conjunção, não disjunção. É o **oposto do TRF2** (onde o espaço quebra a busca e o
  crawler hifeniza sozinho) e igual ao TRF6: **nunca hifenize a query do TRF4**.

- **Não existe flag `-n`.** Para conferir um julgado, passe o número CNJ como texto livre em
  `-q` — devolve exatamente o documento (medido em 2 processos, 1 resultado cada). Ao citar
  julgado do TRF4, diga que a verificação é **parcial**: não há Checker dedicado.

- **Volume:** 9.198 documentos em 30 dias com `-q "previdenciário"` — o maior do repo em
  matéria federal. Cerca de **70% são decisões monocráticas**; para tese colegiada, filtre.

## ⚠️ Ressalva — o pool de backends do TRF4 é instável (diagnosticado em 26/07/2026)

O host `eproc-jur.trf4.jus.br` resolve para **um único IP** (170.81.138.194), mas responde de
forma **diferente a cada conexão**: atrás dele há mais de um backend e nem todos estão sãos.
Medido na mesma sessão, com minutos de diferença:

| Backend | Sintoma |
|---|---|
| são | HTTP 200 em 0,4s, certificado válido até **26/12/2026** |
| degradado | HTTP 503, chegando a pendurar 76s |
| defeituoso | certificado **expirado em 28/06/2026** → `net::ERR_CERT_DATE_INVALID` |

Sem tratamento, a taxa de sucesso do smoke ficava em ~25%. **Não é mudança de layout** — os 6
seletores usados pelo crawler (`#txtPesquisa`, `#divPesquisaAvancada`, `#dtDecisaoInicio`,
`#dtDecisaoFim`, `#dtPublicacaoInicio`, `#dtPublicacaoFim`) foram verificados e existem. Também
**não é bloqueio anti-bot**: `curl` passa normalmente.

O que o crawler faz (`gotoComRetry()`): até 3 tentativas de `goto` com 18s de timeout e backoff
de 1,5s/3s, para reconectar e cair num backend são. Com isso o smoke passou **6/6**, em 12–23s.

Duas decisões deliberadas, que **não devem ser revertidas sem pensar**:

1. **Nunca desligar a verificação de certificado** (`ignoreHTTPSErrors`) para contornar o
   backend com certificado expirado. Aceitar certificado inválido abriria a porta para
   man-in-the-middle numa ferramenta cuja função é justamente **confirmar a autenticidade de um
   julgado**. Melhor falhar e avisar.
2. **Não usar `waitForLoad()` (networkidle) nesta página.** O TRF4 deixa
   `infra-impressao-global.css` pendurado indefinidamente, o `networkidle` nunca chega e a busca
   morre por timeout mesmo com a página já utilizável. O crawler espera o seletor `#txtPesquisa`.

O orçamento de tempo do retry é apertado de propósito (~58s + 20s do seletor) para caber nos 90s
do `tests/smoke.js`. Com 5 tentativas de 45s a falha levava ~900s — o que é pior do que falhar,
porque trava a suíte inteira.
