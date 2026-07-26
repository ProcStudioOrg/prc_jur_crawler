# TRT9 — referência de verificação

> Referência da skill [`jur-verificador`](../SKILL.md). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TRT9. Rode os comandos da raiz do repo (`jur/`).
>
> ⚠️ **Para qualquer OUTRO tribunal trabalhista, leia [`falcao.md`](falcao.md)** — é o
> doc dos 26 acervos. A regra do `.5.09.` abaixo é **do TRT9**: o `tst` aceita processo
> de qualquer TRT de origem e o `csjt` usa `.5.90.`. Generalizar a regra daqui para o
> TST faria o verificador rejeitar julgado legítimo.

Base oficial: **FALCÃO** — https://jurisprudencia.jt.jus.br (acervo nacional da Justiça
do Trabalho: TST + 24 TRTs + CSJT). Toda verificação usa o `TRT9Checker`.

## Quando aplicar

1. Antes de entregar ao usuário qualquer julgado trabalhista do Paraná.
2. Sempre que um número `.5.09.` vier de fonte externa (petição, texto, outro modelo).
3. Quando o número alegado for de "TRT do Paraná" mas o segmento não bater.

## Passo 1 — Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- TRT9 exige segmento `.5.09.` — J=5 (Justiça do Trabalho), TR=09.
  `cnj.pertenceA(n, 5, 9)`. Segmento diferente = **não é TRT9. Pare aqui.**
- ⚠️ Confusão comum: `.8.16.` é **TJPR** (Justiça Estadual do Paraná), outro ramo.
  Número trabalhista nunca é `.8.`; número estadual nunca é `.5.`.
- DV inválido é **aviso**, não veto — a prova é o passo 2.

## Passo 2 — Confirmar na base oficial

```bash
./bin/jur trt9 -n "0000065-19.2024.5.09.0053" --json
```

Retorno:
```json
{"encontrado": true, "numeroValido": true, "justicaDoTrabalho": true,
 "doTribunal": true, "graus": ["1","2"], "documentos": [...]}
```

- `encontrado: true` → cada item de `documentos` traz `colecao`, `grau`, `orgaoJulgador`,
  `relator`, `dataJulgamento` e um trecho da ementa. Use **esses** dados, não a memória.
- `encontrado: false` (exit 1) → **não cite**. O processo pode existir no PJe sem estar
  indexado na jurisprudência — bases diferentes. Diga isso explicitamente.
- `graus` mostra em quais instâncias o processo aparece: `["1","2"]` = tem sentença de
  Vara **e** acórdão de Turma. É informação útil, cite-a.

### ⚠️ Por que o checker existe (e por que não basta "buscar o número")

A busca por número no Falcão é **textual**: ela devolve processos vizinhos.
`0000065-19.2024.5.09.0053` traz junto `0000416-67.2024.5.09.4199`. Quem verificar
"olhando se veio resultado" confirma julgado que não existe. O `TRT9Checker` filtra por
igualdade exata do número normalizado — **use sempre `-n`, nunca `-q "<numero>"`.**

Outra: número **sem máscara** (20 dígitos corridos) devolve 0 na API, mesmo existindo.
O checker normaliza antes de consultar; a busca livre não.

## Passo 3 — Auditar buscas em lote

```bash
./bin/jur trt9 -q "tema" -di "01/01/2025" -df "31/03/2025" --verificar 5 --json
```

`confirmados < verificados` → investigue antes de usar.

## Passo 4 — Conferir o conteúdo

Nem todo documento da JT tem ementa: sentenças de 1º grau quase nunca têm, e só ~70% dos
acórdãos do TRT9 têm. Se `possuiEmenta: false`, **não invente ementa** — baixe o inteiro
teor (`--fetch-inteiro-teor`) e cite a partir do arquivo.

Não há permalink por documento no Falcão — `inteiroTeorLink` é `null` de propósito.
A citação verificável é: tribunal + órgão julgador + classe + número + relator + data,
todos vindos do retorno de `-n`.

## Critério de aprovação

Um julgado do TRT9 só entra em resposta final se: segmento `.5.09.` **e**
`encontrado: true` via `-n` **e** o texto citado veio do retorno da base (não de memória)
**e** o grau/órgão citado bate com a `colecao` de onde o documento veio.
