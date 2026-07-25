---
name: jur-browser
description: Use when the user asks for jurisprudência, case law, precedents or legal research from any Brazilian court (TJ, TRF, TRT, STF, STJ, TCU) — routes to the right tribunal, refines the query, runs the jur crawler, downloads inteiro teor and produces a structured analysis.
---

# jur-browser — buscar jurisprudência

A skill principal: transforma um pedido do usuário em busca executada, verificada e analisada.

<HARD-GATE>
NUNCA execute a busca sem antes entender a intenção do usuário.
NUNCA cite um julgado sem passar pela skill `jur-verificador`.
NUNCA baixe mais de 50 inteiros teores sem confirmação do usuário.
SEMPRE leia o doc do tribunal (`CLAUDE-<TRIBUNAL>.md`) antes de montar o comando.
SEMPRE informe o usuário a cada refinamento que você fizer.
</HARD-GATE>

## Checklist obrigatório

1. **Entender a intenção** — tema, objetivo (tese favorável / contrária / panorama), recorte temporal.
   Em caso de pedido vago, use a skill `jur-improve-user-prompt` primeiro.
2. **Rotear o tribunal** — tabela em `CLAUDE.md`; cobertura completa em `cobertura/CLAUDE-COBERTURA.md`.
3. **Ler o doc do tribunal** — `CLAUDE-<TRIBUNAL>.md`: flags específicas, operadores que de fato
   funcionam, e as **ressalvas** (é onde mora o que quebra).
4. **Contar antes de coletar** — rodar com `-m 1 --json` para saber o volume.
5. **Refinar** conforme a árvore de decisão abaixo, informando o usuário.
6. **Executar a busca final**, com `--fetch-inteiro-teor` quando a ementa não bastar.
7. **Verificar** — `jur-verificador` sobre a amostra que vai para a resposta.
8. **Analisar e apresentar** no formato da §"Saída".

## Roteamento

| Pedido do usuário | Comando |
|---|---|
| "Tribunal do Paraná", "TJPR", jurisprudência estadual PR | `jur tjpr` (só 2º grau) |
| Juizado Especial / Turma Recursal **estadual** no PR | `jur tjpr --foro juizados` (Justiça Comum é `--foro comum`, o default) |
| "TJGO", Goiás | `jur tjgo` |
| "TJPA", Pará | `jur tjpa` |
| "TJRS", Rio Grande do Sul, estadual RS | `jur tjrs` (só 2º grau) |
| Juizado Especial / Turma Recursal **estadual** no RS | `jur tjrs --origem turmas` (Justiça Comum é `--origem comum`, o default) |
| "TJSC", Santa Catarina, estadual SC | `jur tjsc` (⚠️ dois portais no ar — só o comando; ver `CLAUDE-TJSC.md`) |
| Juizado Especial / Turma Recursal **estadual** em SC | `jur tjsc --origem turmas` (Justiça Comum é `--origem comum`, o default) |
| RJ ou ES federal | ⚠️ `jur trf2` **quebrado** — site migrou; ver `CLAUDE-TRF2.md` |
| RS/SC/PR federal, Turmas Recursais previdenciárias | `jur trf4` |
| SP/MS federal | `jur trf3` (⚠️ instável — ver doc) |
| AL/CE/PB/PE/RN/SE federal | `jur trf5` |
| DF/MG/GO/TO/MT/BA/PI/MA/PA/AP/AM/RR/AC/RO federal | `jur trf1` |
| Acórdãos de contas, TCU | `jur tcu` |
| SP estadual | ⚠️ `jur tjsp` sem acesso — ofereça TRF3 (ou TRF4/TRF5 como comparativo) |
| **Matéria trabalhista no PR** — verbas rescisórias, horas extras, vínculo de emprego, insalubridade/periculosidade, justa causa, assédio moral, FGTS, adicional noturno | `jur trt9` (**não** `tjpr`: é outro ramo da Justiça) |
| **1º grau trabalhista PR** — "o que as Varas do Trabalho decidem", sentença | `jur trt9 -g 1` (coleção `sentencas`) |
| **2º grau trabalhista PR** — Turmas do TRT9, acórdão, recurso ordinário | `jur trt9 -g 2` (default, coleção `acordaos`) |
| Comparar as duas instâncias trabalhistas | `jur trt9 -g ambos` |
| "Juizado Especial trabalhista" / "Turma Recursal trabalhista" | **NÃO EXISTE.** A JT não tem Juizados: o rito sumaríssimo (`-cp ATSum`) é julgado pela mesma Vara, com recurso para as mesmas Turmas. Diga isso e use `-g 1`/`-g 2` |
| Decisão monocrática de desembargador do trabalho (PR) | `jur trt9 -g monocraticas` |
| Admissibilidade de Recurso de Revista (PR) | `jur trt9 -g admissibilidade` |

Tribunal não coberto → diga isso explicitamente, mostre o status em
`cobertura/CLAUDE-COBERTURA.md`, e ofereça (a) o tribunal vizinho coberto ou
(b) mapear o tribunal com a skill `jur-codegen`. **Nunca invente resultado.**

Buscas em tribunais diferentes rodam em paralelo — cada crawler sobe seu próprio processo:

```bash
./bin/jur trf4 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf4.json &
./bin/jur trf1 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf1.json &
wait
```

## Árvore de decisão para refinamento

```
Total da busca inicial (-m 1 --json):
|
|-- <= 50   Busca definitiva. Colete tudo, com --fetch-inteiro-teor se necessário.
|
|-- 51-200  Refine com keywords do tema (tabela abaixo).
|           Informe: "Sua busca retornou N resultados. Refinando com 'KEYWORD'..."
|           Ainda > 50 -> adicione filtro de data (último ano).
|
|-- 201-1000  Keywords + último ano. Ainda > 200 -> últimos 6 meses.
|             Ainda > 200 -> peça recorte ao usuário.
|
|-- > 1000  Refinamento agressivo: keywords + 6 meses.
            Pergunte: "Encontrei N resultados. Posso refinar por X, Y. Quer acrescentar algo?"
            Sem solução -> --max-results 50 e diga que está analisando uma AMOSTRA.
```

## Extração de keywords por tema

| Tema | Keywords para refinar |
|---|---|
| Frentista / posto de combustível | agentes nocivos, hidrocarbonetos, periculosidade, insalubridade, BTEX |
| BPC / LOAS | deficiência, miserabilidade, renda per capita, vulnerabilidade social |
| Auxílio-doença | incapacidade, perícia médica, CID, labor habitual |
| Aposentadoria rural | regime de economia familiar, início de prova material, boia-fria |
| Aposentadoria por idade | carência, tempo de contribuição, idade mínima |
| Tempo especial | agentes nocivos, ruído, PPP, LTCAT, enquadramento por categoria |
| Dano moral consumidor | inscrição indevida, negativação, quantum indenizatório |

### Filtrar por resultado desejado

| Objetivo | Termos adicionais |
|---|---|
| Casos favoráveis | procedente, provimento, reconheceu, deu provimento, acolheu |
| Casos desfavoráveis | improcedente, negou provimento, rejeitou, desprovimento |
| Panorama geral | (não adicionar termos de resultado) |

## Ementa não basta — quando baixar o inteiro teor

- **Turmas Recursais (qualquer tribunal)**: a ementa costuma ser uma frase genérica.
  Inteiro teor é **obrigatório**.
- **TJGO / TJPA**: o texto completo já vem no payload da busca — `--fetch-inteiro-teor`
  grava em disco sem novo acesso à rede. Use sem medo.
- Demais tribunais: baixe quando a análise depender de fundamentação, não só de resultado.

## Operadores

Os operadores válidos **variam por tribunal e por módulo** — estão no `CLAUDE-<TRIBUNAL>.md`.
Não presuma: no TJGO, por exemplo, `E`/`OU`/`NÃO` viram palavra literal no módulo de
jurisprudência (só `"frase exata"` funciona). Sempre cite termos compostos entre aspas:
`-q "aposentadoria especial"`.

## Saída

### 1. Resumo quantitativo
Total analisado · favoráveis (n, %) · desfavoráveis · parcialmente procedentes.

### 2. Argumentos recorrentes
As 3-5 teses mais usadas pelos relatores, com frequência.

### 3. Tendência por órgão/turma
Qual turma/câmara tende a ser mais favorável.

### 4. Casos destaque
3-5 acórdãos: nº do processo, relator, trecho-chave **citado do texto retornado**, e por que é relevante.

### 5. Recomendação estratégica
Qual tese priorizar, quais argumentos evitar, qual órgão/relator é mais favorável.

### 6. Verificação
Quantos julgados foram confirmados na base oficial (`jur-verificador`). Diga se algum não confirmou.

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "Vou buscar tudo de uma vez" | 6.000 resultados = timeout + contexto estourado. Conte primeiro. |
| "O usuário já disse o que quer" | Confirme: favorável? contrária? panorama? |
| "50 resultados é pouco" | 50 acórdãos inteiros = análise robusta. Comece por aí. |
| "Não preciso informar o refinamento" | O usuário DEVE saber cada refinamento. |
| "A ementa basta" | Em Turmas Recursais a ementa é uma frase. Baixe o inteiro teor. |
| "Posso analisar sem baixar" | Sem inteiro teor você não tem o acórdão. |
| "Vou pular a contagem inicial" | A contagem define a estratégia. NUNCA pule. |
| "Sei as flags de cor" | Leia o `CLAUDE-<TRIBUNAL>.md`. As flags mudam por tribunal. |
| "Esse tribunal deve funcionar" | Confira `cobertura/CLAUDE-COBERTURA.md`. TJSP não roda. |
| "Verifico depois" | Verifique antes de mostrar. Julgado não confirmado não entra na resposta. |
