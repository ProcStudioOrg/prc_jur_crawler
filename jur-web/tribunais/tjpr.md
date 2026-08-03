# TJPR — Tribunal de Justiça do Paraná

> Medido em **03/08/2026** · `latin1` · HTML · [`../medicao/medicao.json`](../medicao/medicao.json)

Módulo público de jurisprudência (Struts). O formulário original é POST, **mas a mesma
ação aceita GET com os campos na query string** — foi assim que este tribunal entrou aqui.
Não precisa de cookie de sessão: pode chamar a URL de busca direto.

## URL-modelo

```
https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=pesquisar
  &criterioPesquisa={QUERY}
  &idLocalPesquisa=1
  &ambito=-1
  &idsTipoDecisaoSelecionados=-1
  &segredoJustica=pesquisar+com
  &dataJulgamentoInicio={DD/MM/AAAA}
  &dataJulgamentoFim={DD/MM/AAAA}
  &idOrgaoJulgador={IDS}
  &pageNumber={N}
  &sortColumn=processo_sDataJulgamento
  &sortOrder=DESC
  &iniciar=Pesquisar
```

Tudo numa linha, sem quebras. Campos vazios podem ser omitidos — o Struts trata ausente
como "sem filtro".

| Campo | Valores |
|---|---|
| `idLocalPesquisa` | `1` ementa (padrão) · `2` inteiro teor · `99` ambas |
| `idsTipoDecisaoSelecionados` | `-1` todas · `1` acórdão · `2` monocrática |
| `ambito` | `-1` todas — **não use para separar Juizado** (ressalva 2) |
| `pageNumber` | 1-based; a página 80 funciona, não há teto conhecido |

## 🚨 Encoding: ISO-8859-1, e o erro é silencioso

O `<form>` declara `accept-charset="ISO-8859-1"`. Percent-encode **os bytes latin-1**,
não UTF-8. Medido em 03/08/2026 com `usucapião`:

| URL | Julgados |
|---|---|
| `criterioPesquisa=usucapi%E3o` (latin-1) | **48** |
| `criterioPesquisa=usucapi%C3%A3o` (UTF-8) | **2** |

Não dá erro. HTTP 200, página normal, quase nenhum resultado — e a conclusão errada
("não há jurisprudência sobre isso") sai pronta. **Copie da tabela, não calcule.**

| | latin-1 (use esta) | | | latin-1 |
|---|---|---|---|---|
| á | `%E1` | | ó | `%F3` |
| à | `%E0` | | ô | `%F4` |
| â | `%E2` | | õ | `%F5` |
| ã | `%E3` | | ú | `%FA` |
| é | `%E9` | | ü | `%FC` |
| ê | `%EA` | | ç | `%E7` |
| í | `%ED` | | º | `%BA` |
| Á `%C1` À `%C0` Â `%C2` Ã `%C3` É `%C9` Ê `%CA` Í `%CD` Ó `%D3` Ô `%D4` Õ `%D5` Ú `%DA` Ç `%C7` ª `%AA` ||||

Espaço vira `+`. Aspas de frase exata: `%22`.

**Exemplo pronto** (`usucapião extraordinária`, ementa, 2026):

```
https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=pesquisar&criterioPesquisa=usucapi%E3o+extraordin%E1ria&idLocalPesquisa=1&ambito=-1&idsTipoDecisaoSelecionados=-1&pageNumber=1&sortColumn=processo_sDataJulgamento&sortOrder=DESC&iniciar=Pesquisar
```

## Como ler a resposta

HTML; o `web_fetch` entrega ~53 KB de texto por página. Cada julgado vem como bloco:

```
1.
0003611-14.2017.8.16.0011  (Acórdão)
Relator: Mauro Bley Pereira Junior
Processo: 0003611-14.2017.8.16.0011
Órgão Julgador: 1ª Câmara Criminal
Data Julgamento: 01/08/2026
APELAÇÃO CRIME – SENTENÇA CONDENATÓRIA – … (ementa, truncada em "Leia mais..")
```

A ementa **já vem no corpo**, truncada. Número no padrão CNJ `.8.16.`.

## Verificação por número

```
https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=pesquisar&processo={NUMERO_CNJ}&idLocalPesquisa=1&ambito=-1&idsTipoDecisaoSelecionados=-1&pageNumber=1&iniciar=Pesquisar
```

Discrimina de verdade — medido em 03/08/2026:
`0003611-14.2017.8.16.0011` → 1 julgado, o próprio;
`0009999-99.2017.8.16.0011` (bem formado, inexistente) → **0**.

⚠️ A página **ecoa o número consultado** no campo do formulário mesmo sem achar nada.
Não conclua "existe" só porque o número aparece no texto — confirme que veio uma
**linha de resultado** com relator, órgão e data.

## Ressalvas

1. **`ambito` (BASE DE CONSULTA) não separa Juizado de Justiça Comum.** As bases se
   sobrepõem: dentro de `ambito=6` ("TRIBUNAL DE JUSTIÇA") há 226 julgados da 6ª Turma
   Recursal — e essa turma, com 99.268 documentos, **não** aparece em `ambito=4`. Quem
   usar `ambito=6` como "Justiça Comum" entrega julgado de Juizado como se fosse de
   Câmara. A separação correta é por `idOrgaoJulgador` — ver `../../jur/CLAUDE-TJPR.md`.
   **Sem os ids em mãos, não afirme que o resultado é Justiça Comum ou é Juizado.**
2. **Corte IDH contamina a página.** Decisões da Corte Interamericana entram na mesma
   tabela e no mesmo contador. Por isso uma página rende 40 julgados do TJPR (e não 50).
   Descarte-as: não são jurisprudência paranaense.
3. **`PROX`n não funciona** — expande em vez de restringir e o número é ignorado
   (`mandado liminar` 510 → `mandado liminar PROX4` 6.916). Use `"frase exata"`.
4. **`!NAO` só é confiável depois de UM termo.** Com dois termos antes, o total *sobe*
   (`dano moral !NAO consumidor` = 7.950 > `dano moral` = 7.014). Confira o total antes
   de citar.
5. 50 registros por página, dos quais até 10 podem ser da Corte IDH.
