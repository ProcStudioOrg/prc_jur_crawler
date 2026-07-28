# CJF — os portais de jurisprudência do Conselho da Justiça Federal

**Status:** 🟡 usar com ressalva grave · sondado em **27/07/2026** · sem crawler próprio

O CJF hospeda a jurisprudência do **TRF1** (que não tem portal em `trf1.jus.br`), da **TNU** e
uma **Jurisprudência Unificada** que promete STF + STJ + TNU + TRF1–TRF5 numa busca só.

> Esta sondagem nasceu de uma pergunta certeira: *"o STJ está bloqueado por captcha — a
> unificada do CJF não resolveria?"* A resposta é **não**, e o porquê está medido abaixo.
> Vale ler antes de oferecer o CJF como plano B de qualquer coisa.

## Quais portais existem de fato

Testado um a um (`curl -o /dev/null -w %{http_code}`):

| Caminho | HTTP | O que é |
|---|---|---|
| `/trf1/index.xhtml` | **200** | portal do TRF1 — é o que o `./bin/jur trf1` usa |
| `/tnu/index.xhtml` | **200** | portal da Turma Nacional de Uniformização |
| `/unificada/index.xhtml` | **200** | busca multi-tribunal |
| `/stj/` `/stf/` `/trf2/` … `/trf5/` `/tr/` `/tru/` | **404** | **não existem** |

Ou seja: **não há portal do STJ no CJF**. O STJ só aparece dentro da `/unificada/`.

---

## ⚠️ RESSALVA Nº 1 — o filtro de data da `/unificada/` está QUEBRADO

**Qualquer** intervalo de datas devolve **0 documentos**. Não é sintaxe, não é campo errado,
não é o widget do PrimeFaces: os valores chegam ao input e persistem (conferido lendo o
`value` de volta depois de submeter), e o combo `Tipo:` já vem em `DTDP=Julgamento`.

Medido com `-q "aposentadoria"`:

| Consulta | Documentos |
|---|---|
| STJ **sem** filtro de data (controle) | **17.258** |
| STJ, 01/01/1990 – 27/07/2026 (intervalo que contém tudo) | **0** |
| STJ, ano a ano de 2019 a 2026 | **0** em todos |
| STJ, por publicação (`DTPP`) em vez de julgamento | **0** |
| TRF1, 01/04/2025 – 30/06/2025 (o portal `/trf1/` dá 10.572 no mesmo recorte) | **0** |
| TRF1, intervalo total | **0** |

Um intervalo de 36 anos que devolve zero enquanto a mesma busca sem filtro devolve 17 mil é
prova de defeito no servidor, não de acervo vazio. Três formas de preencher a data foram
testadas (`fill()`, digitação tecla a tecla com `Tab`, e `value` + eventos `input/change/blur`):
as três dão 0.

**Consequência prática:** na `/unificada/` só dá para buscar por **termo** e por **número**.
Recorte temporal tem de ser feito **depois**, lendo o campo `Data` de cada ficha.

## ⚠️ RESSALVA Nº 2 — o STJ da unificada parou em ~2019. Não substitui o SCON

Esta é a conclusão que interessa a quem está atrás do bloqueio do STJ. A ficha vem **completa**
(tipo, número, classe, relator, órgão julgador, data de julgamento, data e fonte da publicação,
ementa inteira) e o host **não tem Cloudflare** — `headless` passa. Tudo indica um plano B
perfeito, e não é:

| Termo buscado no STJ pela unificada | Documentos |
|---|---|
| `aposentadoria` | 17.258 (página 1 inteira de **2019**) |
| `benefício assistencial` | 529 (página 1 inteira de **2019**) |
| `pandemia` | **2** — ambos de 2019 |
| `covid` | **0** |
| `coronavírus` | **0** |
| `EC 103` | **0** |
| `revisão da vida toda` | **0** |

Um acervo do STJ sem covid, sem EC 103 e sem revisão da vida toda é um acervo que **termina
antes de 2020**. Serve como base histórica e para conferir a existência de um REsp antigo;
**não serve** para saber o que o STJ decide hoje.

> 🔴 **O bloqueio do STJ continua de pé.** A invariante nº 1 do repo não muda: julgado do STJ
> posterior a 2019 permanece **não verificável** enquanto o SCON estiver atrás do desafio do
> Cloudflare. Ver o alerta no topo de [`CLAUDE.md`](CLAUDE.md).

## ⚠️ RESSALVA Nº 3 — TNU e TRF1 também congelaram, cada um na sua data

O portal **`/tnu/`** é o melhor dos três: tem campos de data **próprios** (`j_idt53_input` e
`j_idt55_input`, diferentes dos da unificada) e **o filtro funciona**. Mas o acervo para no
meio de 2025:

| TNU, `-q "aposentadoria"` | Documentos |
|---|---|
| sem filtro de data | 1.884 |
| 2025 Q1 (jan–mar) | 67 |
| 2025 Q2 (abr–jun) | 94 |
| 2025 Q3 (jul–set) | **0** |
| 2025 Q4 · 2026 inteiro | **0** |

O **TRF1** congelou em **31/07/2025** — a medição mês a mês está em
[`CLAUDE-TRF1.md`](CLAUDE-TRF1.md).

E a unificada é **esparsa** mesmo onde tem conteúdo: o TRF4 tem ali **16.573** documentos no
total, contra **9.198 só nos últimos 30 dias** no portal do próprio TRF4. Nenhum tribunal deve
ser consultado pela unificada quando existe portal próprio mapeado.

---

## Mapa dos campos (para quem for escrever o crawler)

JSF/PrimeFaces, formulário `formulario`. Os ids `j_idt*` **não** se deslocam entre
re-renderizações (conferido: sobrevivem ao clique nos checkboxes de tribunal).

```
formulario:textoLivre            texto livre (busca)
formulario:ckbAvancada_input     abre a "Pesquisa avançada" (as datas só existem depois)
formulario:j_idt59_input         data inicial   ⚠️ unificada — filtro quebrado
formulario:j_idt62_input         data final     ⚠️ unificada — filtro quebrado
formulario:j_idt53_input         data inicial   ✅ /tnu/ — funciona
formulario:j_idt55_input         data final     ✅ /tnu/ — funciona
formulario:combo_tipo_data_input DTDP=Julgamento (default) | DTPP=Publicação
formulario:j_idt70:0..7          tribunais, nesta ordem:
                                 0=STF 1=STJ 2=TNU 3=TRF1 4=TRF2 5=TRF3 6=TRF4 7=TRF5
button:has-text("Pesquisar")     submete
.table_resultado                 uma tabela por julgado (mesma marcação do /trf1/)
```

⚠️ O default da unificada vem com **TNU marcado e o resto desmarcado** — quem não mexer nos
checkboxes está buscando só na TNU sem perceber.

## Quando usar o CJF

| Situação | Vale? |
|---|---|
| Jurisprudência recente do TRF2/TRF4/TRF5/TRF6 | ❌ use o portal próprio — é mais completo e mais novo |
| TRF1 (13 UFs) até julho/2025 | ✅ é a única fonte mapeada |
| TRF1 depois de julho/2025 | ❌ **não existe** — avise o usuário |
| TNU até meados de 2025 | ✅ pelo `/tnu/`, com filtro de data |
| STJ posterior a 2019 | ❌ **não substitui o SCON bloqueado** |
| STJ anterior a 2020, ou conferir REsp antigo | ✅ com ementa completa, sem Cloudflare |
| Qualquer recorte por período na `/unificada/` | ❌ filtro quebrado — filtre depois, pela ficha |

## Reteste

```bash
# o filtro de data voltou? (deve devolver > 0 quando consertarem)
curl -s -o /dev/null -w "%{http_code}\n" https://jurisprudencia.cjf.jus.br/unificada/index.xhtml
# a alimentação do TRF1 voltou?
./bin/jur trf1 -q "aposentadoria" -di "01/01/2026" -df "31/12/2026" -m 1 --json
```

Se o TRF1 voltar a devolver resultado em 2026, atualize esta página, o
[`CLAUDE-TRF1.md`](CLAUDE-TRF1.md) e a constante `JURISPRUDENCIA.TRF1` em
`cobertura/build.js`, e rode `node cobertura/build.js`.
