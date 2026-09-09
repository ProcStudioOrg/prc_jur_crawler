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
-r, --relator <nomes>           Filtro nativo por relator(a); vírgula separa vários. Casa por
                                substring, sem acento e sem caixa ("penteado")
--orgao-julgador <orgaos>       Filtro nativo por órgão julgador ("10ª Turma"; vírgula separa)
--tipo-documento <tipos>        acordao | monocratica | vice (vírgula separa)
--campo <campo>                 inteiro-teor (default do portal) | ementa
--listar-combos                 Lista origens, tipos, órgãos, relatores e classes do portal e sai
--fetch-inteiro-teor            Download full text of each result
--output-dir <dir>              Directory for downloaded files (default: ./resultados)
--max-results <number>          Max total results to collect
```

## Exemplos

```bash
./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"

# Download do inteiro teor
./bin/jur trf4 -q "aposentadoria especial enfermeiro" --fetch-inteiro-teor --output-dir ./resultados

# Entendimento de UM relator sobre um tema, só acórdãos, só onde a ementa fala do tema
./bin/jur trf4 -q '"contribuinte individual" "agentes biológicos"' -r penteado --tipo-documento acordao --campo ementa

# A mesma pergunta para a turma inteira
./bin/jur trf4 -q '"contribuinte individual" "agentes biológicos"' --orgao-julgador "10ª Turma" --tipo-documento acordao --campo ementa

# Descobrir o nome exato de um relator / órgão antes de filtrar
./bin/jur trf4 --listar-combos --json
```

## Filtros nativos: relator, órgão julgador, tipo, campo (mapeado em 09/09/2026)

A pesquisa avançada do portal tem `<select multiple>` de **Relator / Relatora** (`#selRelator`,
256 nomes), **Órgão julgador** (`#selOrgao`, 34 — as Turmas vão até a 12ª), **Tipo Documento**
(`#selTipoDocumento`: Acórdão, Decisão monocrática, Despacho/Decisão da Vice-Presidência),
**Classe** (`#selClasse`, 174) e o rádio **Inteiro teor × Ementa** (`#optInteiroTeor`/`#optEmenta`).
O crawler expõe os quatro primeiros como `-r`, `--orgao-julgador`, `--tipo-documento`, `--campo`.
As listas são carregadas por XHR depois do DOM (`hdnUrlCarregarListasCombobox`): o crawler espera
o combo ter option antes de casar.

- **Casamento por igualdade primeiro, substring depois**, sempre sem acento e sem caixa.
  `"1ª Turma"` marca só a 1ª Turma (substring marcaria também `11ª TURMA` e `1ª TURMA
  SUPLEMENTAR`); `"penteado"` acha `LUIZ FERNANDO WOWK PENTEADO`. O combo repete alguns
  nomes com e sem acento (`ALTAIR ANTONIO GREGORIO` / `GREGÓRIO`) — a normalização casa os
  dois, o que é o desejado.
- **Valor que não casa com nenhuma option é ERRO, nunca zero.** Um nome errado devolveria
  0 resultados e se leria como "esse relator nunca julgou isso". Medido: `-r "xyzabc"` →
  `Relator: nenhuma opção do portal casa com "xyzabc" (parecidos: nenhum)`.
- 🔴 **O nome do relator como termo de busca NÃO é filtro de relator.** `-q '... PENTEADO'`
  acha todo acórdão que *cita* um precedente dele (medido: 261 resultados, dos quais a maioria
  de outros relatores). Use `-r`.
- 🔴 **O default do portal é buscar no inteiro teor, e isso infla o resultado com ruído.**
  Medido em 09/09/2026 com `-r penteado --tipo-documento acordao`: `"contribuinte
  individual" "agentes biológicos"` dá **520** no inteiro teor e **98** com `--campo ementa`
  — e no inteiro teor a primeira página era de acórdãos sobre hidrocarbonetos, ruído e
  fumos metálicos que só mencionam a frase de passagem. Para "o que o relator decide sobre
  X", `--campo ementa` é o recorte certo; o inteiro teor serve para achar acórdão que discute
  X sem levar X ao título.
- `--tipo-documento acordao` corta os ~70% de decisões monocráticas do acervo (ver Volume).
- O servidor (`servidor/relator.js`) classifica o TRF4 como `trecho` com listagem
  `--listar-combos`.

## Notas

- **Turmas Recursais:** sempre baixar o inteiro teor (`--fetch-inteiro-teor`) — as ementas
  costumam ser curtas e o conteúdo relevante está no documento completo.

- **O espaço entre termos é `E`** — medido em 27/07/2026 (recorte 27/06–27/07/2026):
  `tempo` 11.091, `especial` 16.456, `tempo especial` **9.085**. Menor que o menor dos dois,
  logo conjunção, não disjunção. É o **oposto do TRF2** (onde o espaço quebra a busca e o
  crawler hifeniza sozinho) e igual ao TRF6: **nunca hifenize a query do TRF4**.

- **Verificação por número: `-n` (TRF4Checker).** `./bin/jur trf4 -n <CNJ>` consulta a
  base marcando TODAS as origens (acervo principal + Turmas Recursais) e devolve exit 0
  se o julgado existe, 1 se não. `--datajud` acrescenta o DataJud como fonte secundária
  (metadados do PROCESSO, não da decisão). `--verificar [N]` audita uma busca reconsultando
  N amostras — numa ÚNICA sessão de browser (cada sessão custa 15-25s).
  ⚠️ O número vira busca de texto livre no inteiro teor: podem voltar cards de OUTROS
  processos que citam o número (medido: 5 cards, 4 do processo) — o Checker filtra por
  igualdade de dígitos do `numeroProcesso`, sem o sufixo `/TRF4`.
  ⚠️ O `id` dos cards repetiu entre duas consultas (medido 05/08/2026), mas o formato não
  é documentado: a conferência do `--verificar` usa a tupla numeroProcesso + tipoDocumento
  + dataJulgamento, não o id.
  ⚠️ Vazio × indefinido: decidido pelo input `hdnTotalResultado` da página (com resultados
  `value="N"`; vazio sem value; input ausente = listagem não carregou → ERRO "repita",
  nunca "não existe"). Medido em 05/08/2026.

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
