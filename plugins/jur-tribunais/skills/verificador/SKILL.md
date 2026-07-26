---
name: jur-verificador
description: Use before citing any Brazilian court decision — validates the CNJ number and confirms the julgado actually exists in the official base by querying it by process number. Also use when a process number arrives from an external source (petition, another model, user text) and might be hallucinated.
---
<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->

# jur-verificador — confirmar que o julgado existe

Objetivo: **nunca** citar um julgado sem confirmar que ele existe na base oficial do tribunal.

<HARD-GATE>
Julgado não confirmado NÃO entra em resposta final.
Ementa NUNCA é parafraseada de memória — só do texto retornado pela base.
Número vindo de fonte externa é suspeito até prova em contrário.
</HARD-GATE>

## Quando aplicar

1. Antes de entregar ao usuário qualquer lista de julgados (veio de `jur` ou não).
2. Sempre que um nº de processo/acórdão vier de **fonte externa** — petição, texto do
   usuário, outro modelo. É o caso de maior risco de alucinação.
3. Quando houver suspeita de resultado desatualizado ou inventado.

## Passo 1 — Validar o número (offline, instantâneo)

A validação CNJ é genérica para todos os tribunais: `jur/src/cnj.js`.

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

Formato CNJ: `NNNNNNN-DD.AAAA.J.TR.OOOO` — `J` é o segmento e `TR` o tribunal.

| Tribunal | Segmento | Checagem |
|---|---|---|
| TJGO | `.8.09.` | `cnj.pertenceA(n, 8, 9)` |
| TJPA | `.8.14.` | `cnj.pertenceA(n, 8, 14)` |
| TJPR | `.8.16.` | `cnj.pertenceA(n, 8, 16)` |
| TJSP | `.8.26.` | `cnj.pertenceA(n, 8, 26)` |
| TRF1..TRF6 | `.4.01.` … `.4.06.` | `cnj.pertenceA(n, 4, <regiao>)` |
| TRT1..TRT24 | `.5.01.` … `.5.24.` | `cnj.pertenceA(n, 5, <regiao>)` |

Segmento diferente do tribunal alegado = **o número não é daquele tribunal. Pare aqui** e diga
isso ao usuário; é o sinal de alucinação mais comum.

> ⚠️ **Dígito verificador inválido é AVISO, não veto.** Acervos legados convertidos
> (Libra no TJPA ± 2007-2011, sistemas antigos no TJGO) têm numeração cujo DV não fecha
> mas que existe na base. A prova definitiva é sempre o passo 2.

> ⚠️ **TRF6: o segmento é MISTO (`.4.06.` OU `.4.01.`).** O TRF6 nasceu em ago/2022 do
> desmembramento do TRF1 e herdou os processos mineiros com a numeração antiga — 9% dos
> documentos do 2º grau, 24% das Turmas Recursais e 44% da TRU6 vêm com `.4.01.`.
> Rejeitar `.4.01.` como "não é do TRF6" é falso alerta de alucinação num julgado real.
> Leia [`tribunais/trf6.md`](tribunais/trf6.md) antes de citar o TRF6.

## Passo 2 — Confirmar na base oficial

```bash
./bin/jur <tribunal> -n "<numero>" --json
```

- `encontrado: true` → use os dados **retornados** (id, tipo, órgão, relator, datas, trecho).
- `encontrado: false` (exit code 1) → o julgado **não está na base de jurisprudência**.
  Não cite. Diga explicitamente que o processo pode existir no sistema de tramitação
  sem estar indexado na jurisprudência — são bases diferentes.

Tribunais com consulta direta por número implementada: **TJGO**, **TJMG**, **TJPA**,
**TJRJ**, **TJRS**, **TJSC**, **TRF2**, **TRF6**, **STJ** e **a Justiça do Trabalho
inteira** (TST + TRT1..TRT24 + CSJT). Especificidades em
[`tribunais/tjgo.md`](tribunais/tjgo.md), [`tribunais/tjmg.md`](tribunais/tjmg.md),
[`tribunais/tjpa.md`](tribunais/tjpa.md), [`tribunais/tjrj.md`](tribunais/tjrj.md),
[`tribunais/tjrs.md`](tribunais/tjrs.md), [`tribunais/tjsc.md`](tribunais/tjsc.md),
[`tribunais/trf2.md`](tribunais/trf2.md), [`tribunais/trf6.md`](tribunais/trf6.md),
[`tribunais/stj.md`](tribunais/stj.md) e — para os 26 acervos trabalhistas —
[`tribunais/falcao.md`](tribunais/falcao.md) (o TRT9 tem detalhe extra em
[`tribunais/trt9.md`](tribunais/trt9.md)).

> ⚠️ **TJMG: `encontrado: false` não é veredito.** A base de jurisprudência mineira cobre
> 2º grau e Turmas Recursais, e **não** tem 1º grau. O `TJMGChecker` consulta o DataJud
> por conta própria quando não acha e devolve `motivo` distinguindo "processo existe mas
> não tem julgado publicado" de "não existe em lugar nenhum". **Leia o `motivo` antes de
> acusar alucinação** — e note que o campo `ementa` da busca é TRECHO, não ementa. Ver
> [`tribunais/tjmg.md`](tribunais/tjmg.md).

> ⚠️ **Justiça do Trabalho: a regra do `TR` não é uniforme.** O `tst` aceita processo
> de **qualquer** TRT de origem (o número é preservado desde a origem) e o `csjt` usa
> `.5.90.`. Exigir `.5.00.` no TST rejeitaria todo julgado legítimo — leia
> [`tribunais/falcao.md`](tribunais/falcao.md) antes de verificar qualquer trabalhista.

> ⚠️ **STJ: pule o passo 1.** A base do STJ **não indexa número CNJ**, e o CNJ que aparece
> num acórdão dele é o do processo de **origem** — checar o segmento contra "STJ" gera falso
> alerta de alucinação num julgado real. Verifique por `REsp 1809043` ou pelo registro
> `2019/0116080-0`. Leia [`tribunais/stj.md`](tribunais/stj.md) antes de citar o STJ.

Nos demais (`trf1`, `trf3`, `trf4`, `trf5`, `tjpr`, `tcu`) use a flag `-n`/`--numero`
como filtro dentro da busca — ver o `CLAUDE-<TRIBUNAL>.md`. Se o tribunal não tem consulta por
número, **diga que a verificação é parcial** em vez de afirmar que confirmou.

## Passo 3 — Auditar buscas em lote

Numa pesquisa que vai alimentar relatório, adicione `--verificar [N]` (default 5):

```bash
./bin/jur <tribunal> -q "tema" --verificar 5 --json
```

O checker reamostra N resultados, reconsulta cada um por número e confere que o mesmo
id/documento retorna. `confirmados < verificados` → **investigue antes de usar os dados**.

## Passo 4 — Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie decisão de memória. Cite a partir do texto que a base devolveu:

- `ementa` no JSON (nos crawlers que já trazem o texto);
- `--full-text` para o campo `inteiroTeor` completo;
- `--fetch-inteiro-teor` para gravar os `.txt` em disco e citar do arquivo.

## Critério de aprovação

Um julgado só entra em resposta final se **todos** valerem:

- [ ] Segmento/tribunal do número CNJ bate com o tribunal alegado
- [ ] `encontrado: true` na consulta por número (ou verificação parcial declarada como tal)
- [ ] O trecho citado veio do texto retornado pela base, não de memória

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "Veio do crawler, então existe" | Confirme por número. Índice desatualizado acontece. |
| "O DV não fecha, então é falso" | Acervo legado tem DV quebrado e existe. Cheque na base. |
| "Lembro dessa ementa" | Memória não é fonte. Cite do texto retornado. |
| "Verificar todos é lento" | Verifique a amostra que vai para a resposta. `--verificar` faz isso. |
| "Esse tribunal não tem checker, deixa" | Então declare a verificação como **parcial**. Não afirme o que não checou. |
