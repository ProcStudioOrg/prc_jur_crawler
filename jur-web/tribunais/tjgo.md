# TJGO — Tribunal de Justiça de Goiás

> Medido em **03/08/2026** · `utf8` · HTML · [`../medicao/medicao.json`](../medicao/medicao.json)

Módulo de Consulta de Jurisprudência do Projudi. O formulário é POST, mas a mesma rota
aceita GET com os campos na query string.

## URL-modelo

```
https://projudi.tjgo.jus.br/ConsultaJurisprudencia
  ?PaginaAtual=2
  &PosicaoPaginaAtual={OFFSET}
  &Texto={QUERY}
  &ProcessoNumero={NUMERO_CNJ}
  &Id_Instancia=0
  &Id_Area=0
  &DataInicial={DD/MM/AAAA}
  &DataFinal={DD/MM/AAAA}
  &qtdeItensPagina=50
```

⚠️ `PaginaAtual=2` **não é a página 2** — é o identificador de tela do Projudi para
"resultado da consulta". Medido em 03/08/2026: `PaginaAtual=1` e `PaginaAtual=3` devolvem
**zero julgados**; só `=2` traz resultado. Mantenha em `2` sempre. Quem pagina é
`PosicaoPaginaAtual` (0, 50, 100… — medido: `0` e `50` trazem conjuntos diferentes).

## Encoding: UTF-8 na query, ISO-8859-1 na resposta

São coisas diferentes e é fácil trocar.

**A query vai em UTF-8** (`usucapião` → `usucapi%C3%A3o`). Medido em 03/08/2026 pelo
total que a própria página informa:

| Query | Registros |
|---|---|
| `Texto=usucapi%C3%A3o` (UTF-8) | **129.547** ✅ |
| `Texto=usucapi%E3o` (ISO-8859-1) | 785 |
| `Texto=usucapiao` (sem acento) | 1.681 |

⚠️ **Não repita aqui o que o TJPR exige** — lá é o inverso, e usar latin-1 no TJGO
derruba a busca de 129 mil para 785 sem nenhum erro visível.

**A resposta vem em ISO-8859-1**, declarada corretamente no header
(`Content-Type: text/html;charset=iso-8859-1`) e no `<meta>`. Ferramentas que respeitam o
header decodificam certo sozinhas. Se as ementas chegarem com `Jurisprudência`, foi a
decodificação — não é erro do tribunal, e não invalida os resultados.

**Exemplo pronto**:

```
https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=2&PosicaoPaginaAtual=0&Texto=usucapi%C3%A3o&Id_Instancia=0&Id_Area=0&qtdeItensPagina=50
```

## Como ler a resposta

HTML. Cada julgado traz número CNJ (segmento `.8.09.`), órgão, relator, data e o texto do
ato. **A ementa já vem no corpo.**

🚨 **Três armadilhas de leitura.** Nem todo número de processo na página é um resultado.

| Número | O que é |
|---|---|
| `9999999-99.9999.9.99.9999` | a máscara do jQuery (`$('#ProcessoNumero').mask(...)`) |
| `5000280-28.2010.8.09.0059` | número de exemplo dentro de um `<label>` do formulário |
| qualquer nº **citado dentro da ementa** | precedente que o julgado cita, não um resultado |

Os dois primeiros aparecem **mesmo quando a busca não achou nada** — contá-los faz uma
busca vazia parecer bem-sucedida. O terceiro é mais sutil: medido em 03/08/2026, uma
busca no TJGO trouxe `0000236-59.2019.8.16.0132` — segmento `.8.16.`, que é **TJPR**,
citado no corpo de um acórdão goiano.

**Regra:** julgado do TJGO tem segmento `.8.09.` e vem acompanhado de órgão, relator e
data numa linha de resultado. Número solto no meio de texto é citação alheia.
Para conferir o volume real da busca, use o **total que a página informa**
("… registros encontrados"), não a sua contagem de números.

## Verificação por número

```
https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=2&PosicaoPaginaAtual=0&Texto=&ProcessoNumero={NUMERO_CNJ}&Id_Instancia=0&Id_Area=0&qtdeItensPagina=50
```

Discrimina — medido em 03/08/2026, descontada a mobília acima:
`0396263-10.2007.8.09.0144` → 1 julgado, o próprio;
`0009999-99.2017.8.09.0051` (bem formado, inexistente) → **0**.

## Ressalvas

1. **Tipo "Acórdão" quase não existe.** As câmaras publicam o acórdão sob o tipo
   **"Ementa"** — no 1º semestre de 2026, "dano moral" rendeu 9.374 Ementas contra
   **4** Acórdãos. Filtrar por tipo "Acórdão" devolve quase nada e parece ausência de
   jurisprudência. Não filtre por tipo aqui.
2. **Operadores: só aspas duplas.** `E`, `OU`, `NÃO` **não são operadores** neste módulo —
   viram palavra literal e contaminam a busca. Só `"frase exata"` funciona. (Os
   operadores E/OU/ADJ/NÃO/PROX/$ pertencem ao módulo de Publicações, que é outro.)
3. **A base mistura 1º grau, 2º grau e juizados**, e inclui decisões publicadas no mesmo
   dia. Volume alto: use `DataInicial`/`DataFinal`. Ao citar, diga de que grau é o
   julgado — sentença de 1º grau não é precedente de tribunal.
4. `relator`/`magistrado` pode vir **vazio** em algumas serventias (ex.: UPJ das Garantias
   de Goiânia). Não invente o nome do relator.
5. Números CNJ do TJGO usam o segmento `.8.09.`.
