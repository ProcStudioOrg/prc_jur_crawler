# FALCÃO — a Justiça do Trabalho inteira (TST + 24 TRTs + CSJT)

> Doc de **família**. Vale para os 26 comandos: `tst`, `trt1`…`trt24`, `csjt`.
> As ressalvas técnicas detalhadas (operadores, sessionId, limites, 429, schema)
> estão em [`CLAUDE-TRT9.md`](CLAUDE-TRT9.md), que é o mergulho profundo do sistema —
> leia-o antes de mexer no código. Aqui fica o que é **específico de escolher tribunal**.

## O fato central

A Justiça do Trabalho **não tem 26 bases de jurisprudência: tem uma**. O
[FALCÃO](https://jurisprudencia.jt.jus.br) é o acervo nacional, e o que separa um
tribunal do outro é um parâmetro (`tribunais=TRT2`), não um portal diferente.

Por isso, no repo:

| Camada | Arquivo | Serve |
|---|---|---|
| Família | `src/Falcao{Navigator,Crawler,Checker}.js` | os 26 acervos |
| Registro | `src/FalcaoTribunais.js` | metadados dos 26 + fábrica `classes(sigla)` |
| Atalho | `src/TRT9{Navigator,Crawler,Checker}.js` | re-export nomeado do TRT9 (compatibilidade) |
| CLI | laço em `bin/jur` | registra os 26 comandos com a MESMA superfície de flags |

**Não existe `TRT2Crawler.js`** — e não deve existir. `classes('TRT2').Crawler` devolve
a classe pronta. Escrever 25 trios de arquivos criaria 26 fontes da verdade para o mesmo
fato; a tabela `TRIBUNAIS` é a única. Uma correção no laço corrige a JT inteira.

## Roteamento — qual dos 26

`jur <cmd> -q "<termos>"`, com a mesma superfície em todos. Escolha pela **UF do vínculo
de trabalho**, não pelo domicílio do cliente.

| Cmd | Abrangência | Cmd | Abrangência |
|---|---|---|---|
| `tst` | Nacional — **corte superior** | `trt13` | PB |
| `trt1` | RJ | `trt14` | RO, AC |
| `trt2` | **SP — capital e Grande SP** | `trt15` | **SP — interior (Campinas)** |
| `trt3` | MG | `trt16` | MA |
| `trt4` | RS | `trt17` | ES |
| `trt5` | BA | `trt18` | GO |
| `trt6` | PE | `trt19` | AL |
| `trt7` | CE | `trt20` | SE |
| `trt8` | PA, AP | `trt21` | RN |
| `trt9` | PR | `trt22` | PI |
| `trt10` | DF, TO | `trt23` | MT |
| `trt11` | AM, RR | `trt24` | MS |
| `trt12` | SC | `csjt` | administrativo (não julga reclamação) |

⚠️ **São Paulo tem DOIS TRTs.** Capital e Grande SP → `trt2`; interior (sede em
Campinas) → `trt15`. Errar aqui devolve jurisprudência de outra região do estado.
Na dúvida sobre um caso paulista, rode os dois e diga ao usuário qual é qual.

⚠️ **Hierarquia.** O TST uniformiza a CLT para todo o país: para tese jurídica,
**cite o TST antes do TRT local** — mesma lógica de "STJ antes do TJ". O TRT serve
para o que é regional (súmula do regional, tendência da Turma, caso concreto local).

## Três armadilhas de escolher tribunal

### 1. O `codigoCNJ` do TST não é o do TST

O número CNJ (`NNNNNNN-DD.AAAA.5.TR.OOOO`) é atribuído **na origem e preservado**. O
acervo do TST guarda processos com o `TR` do **TRT de onde vieram** — uma única página
de resultados traz TR 04, 09, 15 e 07 misturados. Por isso, em `FalcaoTribunais.js`:

```
TST  -> codigoCNJ: null   // aceita qualquer processo da JT (J=5)
CSJT -> codigoCNJ: 90     // medido: todo o acervo é ...5.90.0000, não ...5.00.
TRTn -> codigoCNJ: n
```

Fixar `codigoCNJ: 0` no TST faria o Checker responder `doTribunal: false` para **todo
caso legítimo** — a verificação anti-alucinação passaria a rejeitar julgado verdadeiro.

### 2. Nem todo acervo tem as quatro coleções

Medido sem termo de busca (`listarColecoes({texto: ''})`), portanto é a forma da corte:

| Acervo | acordaos | sentencas | decisoesmonocraticas | recursorevista |
|---|---|---|---|---|
| TST | 1.484.024 | **0** | 3.902.926 | **0** |
| CSJT | 1.429 | **0** | 629 | **0** |
| TRT2 | 1.899.949 | 5.152.835 | 2.178.430 | 613.521 |

O TST é corte superior: não tem Vara do Trabalho, e não faz o juízo de admissibilidade
do Recurso de Revista — ele **recebe** o RR admitido pela Vice-Presidência do TRT.

A CLI **avisa em vez de devolver 0 calado** (`jur tst -g 1` erra explicando que 1º grau
está no TRT de origem). Isso existe porque `0` seria lido como "não há jurisprudência
sobre o tema" quando o certo é "essa pergunta é para outro tribunal".

### 3. O nome do órgão colegiado não é uniforme

TRT9 e TRT2 dizem **"Turma"**; o **TRT15 diz "Câmara"**; o TRT4 tem "Seção Especializada
em Execução". Nunca escreva heurística sobre o nome do órgão sem antes rodar
`jur <cmd> --listar-orgaos`. (É por isso que a asserção de regex de órgão vive só em
`TRT9Testes.js`, que é a suíte de um tribunal, e não na suíte de família.)

## Um host só — não paralelize

Os 26 comandos batem em `jurisprudencia.jt.jus.br`. **Tribunal diferente é o mesmo host**,
o oposto da regra geral do repo. Varrer os 26 em rajada rende **HTTP 429**, não 26× de
velocidade. O `FalcaoNavigator` tem backoff exponencial próprio para 429 (respeitando
`Retry-After`), mas o certo é espaçar. 429 é **bloqueio, não erro**: a ação é esperar,
não depurar seletor.

## Testes

| Suíte | O que faz |
|---|---|
| `node src/FalcaoTestes.js` | família, amostra (TST, TRT2, TRT15, TRT9, CSJT) — fixtures descobertas em runtime |
| `node src/FalcaoTestes.js TRT5 TRT18` | os acervos que você pedir |
| `node src/FalcaoTestes.js --todos` | os 26 (demorado; sujeito a 429) |
| `node src/TRT9Testes.js` | profundidade num tribunal só, com fixtures fixas conferidas à mão |

A suíte de família prova, por acervo: isolamento (nenhum documento de outro tribunal
vaza), soma exata de dois acervos, desambiguação por coleção, filtro de data, paginação
sem id repetido, e o Checker de ida e volta com número colhido do próprio acervo.

## `human-codegen`

**Não precisa ser refeito por tribunal** — a tela é a mesma para os 26.
`human-codegen/TRT9/` vale como mapeamento de todos.
