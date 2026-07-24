---
name: jurisprudencia-search
description: Use when user asks about jurisprudencia, case law, or legal research from Turmas Recursais or TRF4. Guides intelligent query refinement, crawler execution, and result analysis.
---

# Jurisprudencia Search — Turmas Recursais

Skill para busca inteligente de jurisprudencia nas Turmas Recursais do TRF4.

<HARD-GATE>
NUNCA execute a busca sem antes entender a intencao do usuario.
NUNCA baixe mais de 50 inteiros teores sem confirmacao do usuario.
SEMPRE informe o usuario quando estiver refinando a busca.
SEMPRE leia o inteiro teor dos acordaos — nas Turmas Recursais a ementa e apenas uma frase.
</HARD-GATE>

## Checklist Obrigatorio

1. **Entender a intencao** — Qual o tema? Qual o objetivo (tese favoravel, panorama, tese contraria)?
2. **Montar query inicial** — Executar com --max-pages 1 --json para contar resultados
3. **Avaliar total de resultados** — Decidir se refina (ver arvore de decisao abaixo)
4. **Executar busca final** — Com --fetch-inteiro-teor se necessario
5. **Analisar resultados** — Ler os arquivos .txt e produzir resumo estruturado
6. **Apresentar ao usuario** — Resumo com casos favoraveis vs desfavoraveis, argumentos, tendencias

## Arvore de Decisao para Refinamento

```
Total de resultados da busca inicial:
|
|-- <= 50: Busca definitiva
|   Executar: ./bin/jur trf4 --origem turmas-recursais -q "QUERY" --fetch-inteiro-teor --output-dir ./resultados --json
|   Depois: Ler index.json e arquivos .txt para analise
|
|-- 51-200: Refinar com keywords
|   1. Extrair keywords da intencao do usuario (ver tabela abaixo)
|   2. Informar: "Sua busca retornou N resultados. Refinando com 'KEYWORD'..."
|   3. Re-executar com query expandida
|   4. Se <= 50: busca definitiva
|   5. Se > 50: adicionar filtro de data (ultimo ano)
|
|-- 201-1000: Refinar + limitar por data
|   1. Adicionar keywords + limitar ao ultimo ano
|   2. Informar: "Refinando busca e limitando ao ultimo ano..."
|   3. Se ainda > 200: limitar aos ultimos 6 meses
|   4. Se ainda > 200: pedir input do usuario
|
|-- > 1000: Refinamento agressivo
|   1. Keywords + data curta (6 meses)
|   2. Perguntar ao usuario: "Encontrei N resultados. Posso refinar com X, Y. Quer adicionar algo?"
|   3. Se nao resolver: --max-results 50, analisar amostra
|   4. Informar: "Analisando uma amostra dos 50 primeiros resultados..."
```

## Extracao de Keywords por Tema

| Tema do usuario | Keywords para refinar |
|-----------------|----------------------|
| Frentista / posto de combustivel | agentes nocivos, hidrocarbonetos, periculosidade, insalubridade, BTEX |
| BPC / LOAS | deficiencia, miserabilidade, renda per capita, vulnerabilidade social |
| Auxilio-doenca | incapacidade, pericia medica, CID, labor habitual |
| Aposentadoria rural | regime de economia familiar, inicio de prova material, boia-fria |
| Aposentadoria por idade | carencia, tempo de contribuicao, idade minima |

### Para filtrar por resultado desejado:

| Objetivo | Termos adicionais |
|----------|-------------------|
| Casos favoraveis | procedente, provimento, reconheceu, deu provimento, acolheu |
| Casos desfavoraveis | improcedente, negou provimento, rejeitou, desprovimento |
| Panorama geral | (nao adicionar termos de resultado) |

## Comandos do Crawler

### Busca inicial (contar resultados):
```bash
./bin/jur trf4 --origem turmas-recursais -q "QUERY" -m 1 --json
```
Resposta: `{"success":true,"totalResults":6835,"count":20,...}`

### Busca com filtros de data:
```bash
./bin/jur trf4 --origem turmas-recursais -q "QUERY" -di "01/01/2025" -df "26/03/2026" -m 5 --json
```

### Busca com download de inteiro teor:
```bash
./bin/jur trf4 --origem turmas-recursais -q "QUERY" -di "01/01/2025" -df "26/03/2026" --fetch-inteiro-teor --output-dir ./resultados --max-results 50 --json
```

### Busca com limite absoluto (amostra):
```bash
./bin/jur trf4 --origem turmas-recursais -q "QUERY" --fetch-inteiro-teor --output-dir ./resultados --max-results 50 --json
```

## Formato do Output de Analise

Apos ler os arquivos baixados, apresentar ao usuario:

### 1. Resumo Quantitativo
- Total de acordaos analisados: X
- Favoraveis ao segurado: Y (Z%)
- Desfavoraveis: W (V%)
- Parcialmente procedentes: N

### 2. Argumentos Recorrentes
Listar as 3-5 teses mais usadas pelos relatores, com frequencia.

### 3. Tendencia por Turma
Qual turma recursal tende a ser mais favoravel/desfavoravel ao segurado.

### 4. Casos Destaque
3-5 acordaos mais relevantes com:
- Numero do processo
- Relator
- Trecho-chave da fundamentacao
- Por que e relevante

### 5. Recomendacao Estrategica
- Qual tese priorizar
- Quais argumentos evitar
- Qual turma/relator e mais favoravel

## Tabela Anti-Racionalizacao

| Pensamento | Realidade |
|------------|-----------|
| "Vou buscar tudo de uma vez" | 6000 resultados = timeout + contexto estourado. Refine primeiro. |
| "O usuario ja disse o que quer" | Confirme a intencao: favoravel? contraria? panorama? |
| "50 resultados e' pouco" | 50 acordaos inteiros = analise robusta. Comece por ai. |
| "Nao preciso informar o refinamento" | O usuario DEVE saber cada refinamento que voce faz. |
| "A ementa basta" | Turmas Recursais: ementa = 1 frase generica. Inteiro teor e OBRIGATORIO. |
| "Posso analisar sem baixar" | Sem inteiro teor, voce nao tem o acordao. Baixe primeiro. |
| "Vou pular a contagem inicial" | A contagem define sua estrategia. NUNCA pule. |
