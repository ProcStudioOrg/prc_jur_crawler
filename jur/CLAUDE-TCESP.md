# TCE-SP — Tribunal de Contas do Estado de São Paulo

**Status: 🟢 OK** (HTTP direto, sem browser — **sem captcha em etapa nenhuma**).
Mapeado e fechado em **15/08/2026** (slot 2000). Quarto alvo do Bloco 5.

| | |
|---|---|
| Comando | `./bin/jur tcesp` |
| Portal | `https://www.tce.sp.gov.br/jurisprudencia/` |
| Endpoint | `GET /jurisprudencia/pesquisar` (**GET; POST devolve 405**) |
| Tecnologia | Tomcat 8.0.43 + Spring MVC, renderizado no servidor. Não é SPA, não tem API JSON |
| Acervo | **1.317.838** documentos, sendo **168.766** acórdãos. Base começa em **2008**, **corrente** |
| Mapeamento | `human-codegen/TCESP/01-jurisprudencia/` |

## 🔴 ESCOPO — A CAPITAL NÃO ESTÁ NESTA BASE

**É a ressalva mais importante do tribunal.** O TCE-SP fiscaliza o Estado de São
Paulo e os **644 demais municípios paulistas**. A **capital (São Paulo)** é do
**TCM-SP**, órgão separado, com portal próprio que **este repo não cobre**.

Logo: pedido sobre contas da **Prefeitura de São Paulo** não tem resposta aqui, e
o número baixo **não é ausência de julgado**. Diga isso ao usuário em vez de
entregar zero. A armadilha declarada do Bloco 5 (`onde existe TCM, contas
municipais no TCE devolvem zero`) é **verdadeira em SP** — ao contrário de PR, SC
e RS, onde não há TCM.

⚠️ Diferente do TCE-PR, **não há combo de município para contar**: o portal não
filtra por município. A prova é por contagem no acervo (`Parte 1`/`Parte 2`
trazem `PREFEITURA MUNICIPAL DE <X>`), não por combo.

É instância de **controle externo, não Judiciário**: para a mesma matéria
judicializada, o caminho é `tjsp` (🔴 sem acesso) ou `trf3` (federal).
🔴 Não ofereça o `tcesp` para matéria cível, penal, trabalhista ou previdenciária.

## 🔴 O modelo de operadores é de QUATRO CAIXAS, não inline

**Primeiro portal do repo assim.** Em vez de escrever `A AND B` num campo, cada
operador booleano é uma flag própria:

| Flag | Caixa da tela | Semântica |
|---|---|---|
| `-q` | "Todas estas Palavras" | **E (AND)** — o espaço entre termos já é AND |
| `--frase` | "Esta expressão ou frase exata" | frase exata |
| `--qualquer` | "Qualquer uma dessas palavras" | **OU (OR)** |
| `--excluir` | "Nenhuma destas palavras" | **NÃO (NOT)** |

✅ **A aritmética fecha EXATA nos dois sentidos** — é o conjunto de operadores
mais bem-comportado já medido no repo (11º tribunal):

```
merenda 17.806 | escolar 89.312 | -q "merenda escolar" 16.707 | --qualquer 90.411
17.806 + 89.312 − 16.707 = 90.411 = OR    ✓
17.806 − 16.707          =  1.099 = NOT   ✓
frase exata 13.927 ≤ AND 16.707           ✓
```

### 🔴 Mas operador INLINE dentro de `-q` é armadilha

```
-q "merenda OU escolar"   = 16.707   🔴 `OU` DESCARTADO — continua AND
-q "merenda E escolar"    = 16.707   🔴 `E` descartado (o espaço já é AND)
-q "merenda AND escolar"  =      0   🔴 vira palavra literal e ZERA
-q "merenda OR escolar"   =      0   🔴 idem
-q "merenda NAO escolar"  =    320   🔴 vira palavra literal (não exclui)
```

🔴 **O `OU` inline é o pior caso: você pede união e recebe INTERSEÇÃO** (16.707
em vez de 90.411), com número plausível e **sem sintoma**. É a armadilha do TJMT
noutro fornecedor. O crawler detecta e avisa qual flag usar; repasse o aviso.

✅ **Aspas funcionam dentro de `-q`** (`"merenda escolar"` = 13.927 = `--frase`).
✅ Curinga `*` funciona e expande (`merend*` = 20.814). `$` é inerte.
✅ **NÃO avise sobre acento** — o índice normaliza (`licitacao` = `licitação` =
   352.861).
✅ **Termo curto NÃO é descartado** (`ab` = 9.243) — a armadilha do TCE-SC não se
   repete. ⚠️ Mas `de` devolve **1.317.838** (o acervo inteiro) porque "de" está
   mesmo em todo documento: é resultado legítimo, não filtro ignorado.

## 🔴 NÃO EXISTE EMENTA no TCE-SP

O texto que o portal exibe é um **TRECHO** com o termo destacado
(`<span class="texto-resultado-busca">`), começando com `...`, de ~600–1.200
chars contra **4.855 chars úteis** do PDF do mesmo acórdão.

**Não existe campo de ementa em lugar nenhum**: nem no card, nem na página de
detalhe, nem no PDF — os acórdãos do TCE-SP abrem direto em
"Representante / Representado / Assunto", sem ementa estruturada.

O crawler marca `semEmenta: true` em **todos** os documentos e guarda o recorte
em `trechos[]`. **Nunca apresente o trecho como ementa nem como acórdão
inteiro.** Para o texto integral use `--fetch-inteiro-teor` (PDF público).

⚠️ `--trechos N` (0..6, default 3) controla quantos trechos vêm por documento.
🔴 **`--trechos 0` devolve HTTP 200, contagem certa e NENHUM texto** — o crawler
avisa.

## 🔴 Um julgado decide VÁRIOS processos — o total não é o nº de decisões

**Achado novo no repo, e inverte a armadilha conhecida.** O repo já registrou
que "um processo tem vários julgados" (TJTO, TJRR, TCE-PR). **No TCE-SP vale
também o contrário**: um mesmo acórdão decide vários processos apensados, e a
listagem devolve **uma linha por PROCESSO**, não por documento.

```
10 páginas de `merenda escolar` (acórdão):
100 linhas  →  84 processos distintos  →  35 PDFs distintos   (fator 2,86×)
Na 1ª página, 7 processos diferentes apontam para o MESMO PDF.
```

🔴 **"Foram encontrados 1.699 registros" NÃO é 1.699 acórdãos** — são pares
processo × documento. Relatar 1.699 como número de decisões infla ~2,9×.
O crawler deduplica por id do PDF e publica `totalDeduplicadoEstimado` junto do
total do servidor — **relate os dois números**.
⚠️ O `totalDeduplicadoEstimado` é extrapolado do fator observado nas páginas
coletadas: com `-m 1` ele é ruidoso (uma página deu 5,00× contra 2,86× em dez).
Use `-m 5` ou mais quando o número importar.

  - Quem identifica o **documento**: o **id do PDF** (`arqs_juri/pdf/<id>.pdf`)
  - Quem identifica o **processo**: `NNNN/NNN/AA`
  - ⚠️ E os dois números não se correspondem: o processo `1681/989/20` abre o PDF
    818386, cujo texto é o acórdão do processo **TC-016626.989.17-2**. **O número
    impresso no PDF não é o da linha que o trouxe.**

## 🔴 Duas famílias de documento — a editorial vem sem metadados

  **(a) Ligados a processo** — Acórdão, Relatório/Voto, Despacho, Parecer,
      Sentença, Nota Taquigráfica… Todas as 8 colunas preenchidas, PDF em
      `jurisprudencia.tce.sp.gov.br/arqs_juri/pdf/<id>.pdf`.

  **(b) Editoriais** — **Súmula** (52) e **Boletim de Jurisprudência** (50).
      🔴 **Todas as colunas vêm VAZIAS** — sem processo, sem data, sem parte,
      sem matéria. O PDF fica em outro host (`www.tce.sp.gov.br/sites/default/
      files/sumulas/` e `/publicacoes/`). O crawler marca `familia: 'editorial'`
      e não promete metadados que não existem.

⚠️ **"Sentença" aqui NÃO é sentença de 1º grau do Judiciário** — é a decisão
   singular de um Conselheiro. **Não anuncie que o TCE-SP tem 1º grau.**

## ✅ As datas são o filtro mais bem-comportado do repo

Dois eixos **reais e distintos**: publicação (`-dpi/-dpf`) e autuação (`-di/-df`).

```
base (merenda escolar, acórdão)             1.699
publicação 2023 inteiro                        92
publicação SÓ início 01/01/2023               227   ✅ meia janela FUNCIONA
publicação SÓ fim    31/12/2023             1.564   ✅ meia janela FUNCIONA
janela NO-OP 01/01/1900..31/12/2100         1.699   ✅ não altera nada
autuação 2023 inteiro                          34   ✅ eixo distinto
227 + 1.564 − 92 = 1.699 = total                    ✓ EXATO
```

✅ Passa nos três testes que outros reprovaram: TJPI/TJRR/TCE-PR tinham uma ponta
ignorada ou zerando; TJES tinha janela no-op derrubando 42%.
⚠️ **Só aceita DD/MM/YYYY** — ISO devolve **HTTP 400** (erro honesto, não zero).
O crawler converte sozinho.

## Consulta por número — exige a MÁSCARA

```
1681/989/20   →  3 documentos  ✅
168198920     →  0, HTTP 200, silencioso
9999/999/99   →  0, HTTP 200, silencioso
```

`./bin/jur tcesp -n "1681/989/20"` (aceita as duas formas — o Checker aplica a
máscara). Some à coleção: TJPE só dígitos, TJES só máscara, TJPI derruba com 500,
TJMT aceita as duas, TCE-PR quer partido em dois campos, **TCE-SP só máscara**.

🔴 **Não há número CNJ nem DataJud** (contas não é Judiciário), e — diferente do
TCE-RS — **não há Dados Abertos**: `dadosabertos.`/`api.tce.sp.gov.br` são
NXDOMAIN e `/dados-abertos` é 404 real. **Não existe plano B** se o portal cair.

## 🔴 Zero é SILENCIOSO

Quando nada casa, o portal **reexibe o formulário** (~37 KB), sem o `Foram
encontrados N registros` e **sem mensagem nenhuma** de "nenhum resultado". O
crawler distingue zero de erro pelo **status HTTP** (lição do TJPI: um zero pode
ser um 500 disfarçado) e avisa quando o contador não aparece.

## Paginação e custo

- ✅ **Total EXATO, não saturado**: `offset=1690` devolve exatamente 9 de 1.699.
- ✅ **Paginação estável** (mesma página 3× = lista idêntica) e **sem sessão**.
- ⚠️ **Página FIXA em 10** — `size`, `limit` e `qtd` são **ignorados em silêncio**.
  Varrer 1.699 resultados custa **170 requisições**: é o portal mais caro por
  documento do Bloco 5. `-m N` vale N × 10 documentos.
- ✅ `offset` além do total devolve 0 linhas, HTTP 200, sem erro. Sem teto medido.

## ✅ Três permalinks públicos — caso raro no repo

1. **A URL da busca** é reutilizável: colada em contexto limpo (sem cookie, sem
   sessão) ela **executa a busca** com todos os filtros. 🔴 Isso a separa do
   TJPE (a URL restaura o formulário e não roda a busca) e do TJTO (por GET os
   filtros são ignorados em silêncio).
2. **`exibir?proc=<NNNN/NNN/AA>`** — página de detalhe do processo. 🔴 **É aqui
   que moram o RELATOR e a DATA DE PUBLICAÇÃO**, que a tabela de busca não traz,
   mais o **Objeto completo** (na tabela vem truncado com "..."). Use
   `--detalhes` para o crawler buscá-los (1 GET por processo).
3. **O PDF do inteiro teor** — público, sem sessão, sem referer, sem captcha.
   ✅ O magic number `%PDF` **vale aqui** (não se repete o envelope PKCS#7 em DER
   do TCE-PR). ⚠️ Passa por um 302 para caminho fragmentado por dígitos
   (`/pdf/818386.pdf` → `/pdf/6/8/3/818386.pdf`); o crawler segue o redirect em
   vez de reconstruir a regra, que foi inferida de um exemplo só.

⚠️ **Não há citação oficial pronta** (diferente de TCE-PR, TJMT, TJPI, TJTO) —
monte-a dos campos do `exibir`.

## Exemplos

```bash
# busca básica (E implícito no espaço)
./bin/jur tcesp -q "merenda escolar" -t acordao -m 5

# união de termos — NUNCA escreva "OU" dentro de -q
./bin/jur tcesp --qualquer "nepotismo improbidade" -t acordao

# frase exata + exclusão
./bin/jur tcesp --frase "dispensa de licitação" --excluir "arquivamento" -t acordao

# janela de publicação (DD/MM/YYYY; ISO dá 400)
./bin/jur tcesp -q "transporte escolar" -t acordao -dpi 01/01/2025 -dpf 31/12/2025

# trazer relator e data de publicação (a busca não tem)
./bin/jur tcesp -q "merenda escolar" -t acordao -m 2 --detalhes

# súmulas do próprio TCE-SP (família editorial: sem metadados)
./bin/jur tcesp -t sumula --trechos 1

# inteiro teor em PDF
./bin/jur tcesp -q "merenda escolar" -t acordao -m 2 --fetch-inteiro-teor

# confirmar que um processo existe
./bin/jur tcesp -n "1681/989/20"

# combos (14 tipos, 24 relatores, 9 auditores, 164 matérias)
./bin/jur tcesp --listar-filtros
```

## Pendências declaradas

- `--auditor` (9 opções) está exposto mas **não foi provado por contagem** — só
  `relator`, `materia` e `tipoDocumento` foram.
- `--num-ini/--num-fim` ("Números que variam") **filtra** (1.148 de 1.699) mas o
  que ele casa (ano? valor? qualquer número no texto?) **não foi isolado**.
- **Rate limit não medido.**
- **Ordenação** (`campoPulsaOrdem`, 8 colunas) não foi medida — só o default.
- O acervo total (1.317.838) veio de janela de data ampla; **não foi conferido
  contra a soma dos 14 tipos**.
- Não foi medido se `materia` compõe **multi-valor** (só valor único).
- A regra do caminho fragmentado do PDF foi **inferida de um exemplo só**.
