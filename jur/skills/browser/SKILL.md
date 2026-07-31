---
name: jur-browser
description: Use when the user asks for jurisprudência, case law, precedents or legal research from any Brazilian court (TJ, TRF, TRT, STF, STJ, TCU) — routes to the right tribunal, refines the query, runs the jur crawler, downloads inteiro teor and produces a structured analysis.
---

# jur-browser — buscar jurisprudência

A skill principal: transforma um pedido do usuário em busca executada, verificada e analisada.

<HARD-GATE>
🚨 NUNCA RODE `jur stj` — O STJ ESTÁ BLOQUEADO DESDE 27/07/2026 (desafio interativo do
Cloudflare: 403 + cf-mitigated: challenge). Diga ao usuário que o STJ está inacessível.
NUNCA cite um REsp de memória para compensar: o `jur-verificador` também não confirma
nada no STJ enquanto durar o bloqueio, então o julgado é NÃO VERIFICÁVEL e não entra.
NÃO EXISTE SUBSTITUTO PARA O STJ em lei federal infraconstitucional — ao oferecer o
TJ/TRF local, rotule explicitamente como instância inferior. Matéria constitucional
segue no `stf`, que está 🟢. Ver o alerta no topo de `CLAUDE.md`.

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
| "TJRJ", Rio de Janeiro, estadual RJ | `jur tjrj` (só e-Proc: Justiça Comum 2º grau, ~2023+; ver `CLAUDE-TJRJ.md`) |
| Juizado Especial / Turma Recursal **estadual** no RJ, ou acervo carioca antigo | **SEM CRAWLER** — vive no eJURIS legado; diga isso e aponte https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx (nunca rotule resultado do `jur tjrj` como Juizado) |
| "TJSC", Santa Catarina, estadual SC | `jur tjsc` (⚠️ dois portais no ar — só o comando; ver `CLAUDE-TJSC.md`) |
| Juizado Especial / Turma Recursal **estadual** em SC | `jur tjsc --origem turmas` (Justiça Comum é `--origem comum`, o default) |
| "TJCE", Ceará, Fortaleza | `jur tjce` (SJURIS: 2º grau + Turma Recursal, **SAJ e PJe juntos**, 814 mil documentos; **sem 1º grau**). Inteiro teor e PDF já vêm na busca. ⚠️ **nunca use `esaj.tjce.jus.br/cjsg`** — cobre só o SAJ e exige browser; ver `CLAUDE-TJCE.md` |
| Juizado Especial / Turma Recursal **estadual** no CE | `jur tjce --base turmas` (Justiça Comum 2º grau é `--base comum`, o default; `--base todos` **mistura os dois**). A ementa da Turma Recursal é 4,5× menor que a do acórdão — baixe o inteiro teor antes de citar tese |
| Decisão monocrática no TJCE | `jur tjce --tipo monocratica --full-text` — ⚠️ **as 247.991 monocráticas vêm com `ementa` VAZIA**: só ACÓRDÃO e TURMA RECURSAL têm ementa indexada. O inteiro teor está no mesmo objeto, então nada se perde — mas sem `--full-text` a saída parece vazia. O crawler emite o aviso em `avisos[]`; repasse |
| Citar julgado do TJCE com link | **NÃO EXISTE PERMALINK** — o SJURIS vive todo em `/tela-consulta`, sem URL por documento. Nunca invente link; verifique por reconsulta `jur tjce -n "<número CNJ formatado>"` |
| "TJDFT", Distrito Federal, Brasília | `jur tjdft` (2º grau + Turma Recursal; **sem 1º grau**; com súmulas e informativos). API pública oficial; inteiro teor já vem na busca. ⚠️ `PROX`/`ADJ` **sem parênteses**; ver `CLAUDE-TJDFT.md` |
| Juizado Especial / Turma Recursal **estadual** no DF | `jur tjdft --acervo turmas` (Justiça Comum 2º grau é `--acervo comum`; o default `--acervo todos` **mistura os dois**). Cada resultado traz `juizado: true/false` |
| Decisão monocrática / da Presidência no TJDFT | `jur tjdft --acervo monocraticas` (ou `presidencia`) — e **filtre por publicação (`-dpi/-dpf`), nunca por julgamento**: esses acervos não têm data de julgamento e `-di/-df` devolve **0 sem erro** |
| "TJMG", Minas Gerais, estadual MG | `jur tjmg` (2º grau + Turmas Recursais; **sem 1º grau e sem súmulas**). ⚠️ operadores em português (`e`/`ou`/`não`/`$`) são **ignorados sem erro** — a sintaxe é `+ \| - "frase" ( ) * ~`; ver `CLAUDE-TJMG.md` |
| Juizado Especial / Turma Recursal **estadual** em MG | `jur tjmg --tipo turmas --escopo inteiroTeor` — **o `--escopo inteiroTeor` é obrigatório**: só `Acórdão` tem ementa indexada, então no escopo padrão o Juizado mineiro devolve **0 sempre**, o que se lê como "não há jurisprudência" e não é. Justiça Comum 2º grau é `--tipo acordao` (o default `--tipo todos` **mistura os dois**). Nesse tipo o campo `relator` vem vazio e a `ementa` é trecho (`ementaEhTrecho: true`) — baixe o inteiro teor antes de citar |
| Filtrar TJMG por comarca / órgão / magistrado / classe / assunto | separe múltiplos valores com **`;`**, não vírgula (18 órgãos julgadores têm vírgula no nome, todos de Turma Recursal). Os nomes precisam ser exatos — o crawler valida contra a API e sugere o correto, porque valor errado devolveria 0 sem erro. Liste com `jur tjmg --listar <campo>` |
| RJ ou ES federal | `jur trf2` (só 2º grau; base **começa em 2018**). ⚠️ neste portal o **espaço entre termos quebra a busca** — o crawler conserta sozinho, não use `--literal`; ver `CLAUDE-TRF2.md` |
| Juizado Especial **Federal** / Turma Recursal no RJ ou ES | `jur trf2 --origem turmas` (Justiça Federal comum é `--origem trf2`, o default) |
| RS/SC/PR federal, Turmas Recursais previdenciárias | `jur trf4` |
| SP/MS federal | `jur trf3` (⚠️ instável — ver doc) |
| AL/CE/PB/PE/RN/SE federal | `jur trf5` |
| **MG federal, de 2023 em diante** | `jur trf6` (só 2º grau). ⚠️ operadores em **português** e o espaço funciona — **nunca hifenize** a query do TRF6 (é o oposto do TRF2); ver `CLAUDE-TRF6.md` |
| Juizado Especial **Federal** / Turma Recursal em MG | `jur trf6 --origem turmas` (Justiça Federal comum é `--origem trf6`, o default; a origem `varas` existe no site e está **VAZIA**) |
| **MG federal ATÉ 2022** — "jurisprudência antiga de Minas" | `jur trf1`, **não** `trf6`. O TRF6 foi instalado em ago/2022 e sua base começa em **2023**; o acervo mineiro anterior ficou no TRF1 (medido: 27% da amostra do TRF1 em 2019 é de subseções `.4.01.38xx`). Pedido histórico = rodar os dois e dizer que são bases distintas |
| DF/GO/TO/MT/BA/PI/MA/PA/AP/AM/RR/AC/RO federal (e MG até 2022) | `jur trf1` |
| **Matéria constitucional / "o que o Supremo decidiu"** — direitos fundamentais, competência federativa, constitucionalidade de lei, ADI/ADPF/ADC, recurso extraordinário | `jur stf` (base `acordaos`, desde **1892**; instância única) |
| **Súmula vinculante** — "existe súmula sobre isso?", "isso vincula os outros tribunais?" | `jur stf --vinculantes` (são **63**; as 736 simples são `--sumulas-simples`, e `-b sumulas` traz as 799) |
| **Repercussão geral / tema / tese** — precedente que vincula o resto do Judiciário | `jur stf --rg`, `jur stf --tema "<nº ou texto>"`, `jur stf --tese "<texto>"` |
| Desambiguação no STF — **não existe Juizado nem Turma Recursal** | Por **órgão**: `-oj "Tribunal Pleno"` (maior peso) × `-oj "Primeira Turma,Segunda Turma"`. Por **classe**: `-c ADI,ADPF,ADC` (controle concentrado, *erga omnes*) × `-c RE,ARE` (controle difuso) × `-c HC,MS` (originárias) |
| Decisão monocrática de ministro do STF | `jur stf -b decisoes -r "<MINISTRO EM CAIXA ALTA>"` (741 mil docs; é uma **seleção**, não exaustiva) |
| Informativo do STF | `jur stf -b informativos` (⚠️ resumo **sem valor oficial** — nunca cite como se fosse ementa) |
| "Esse processo do STF existe?" / confirmar julgado do Supremo | `jur stf -n "ARE 1596565"` (classe+número, o formato nativo) ou `jur stf -n <CNJ>`. ⚠️ a base **não indexa CNJ**: buscar o número por `-q` devolve zero |
| **Interpretação de LEI FEDERAL infraconstitucional** — Código Civil, CPC, CDC, Código Penal, execução fiscal, benefício previdenciário, contrato, prescrição, "o que o STJ decidiu" | 🔴 **`jur stj` BLOQUEADO desde 27/07/2026 — NÃO RODE.** Desafio interativo do Cloudflare (403 + `cf-mitigated: challenge`); rodar só queima 10 tentativas e devolve `Target page… has been closed`. Diga que o STJ está inacessível; ofereça `trf*`/`tj*` **rotulado como instância inferior**, e diga que a orientação do STJ não pôde ser conferida. Matéria constitucional → `stf` (🟢). **Não cite REsp de memória.** As linhas abaixo valem para quando o bloqueio cair |
| Desambiguação no STJ — **não existe Juizado, Turma Recursal nem 1º grau** | Por **órgão**, e ele define a matéria: `-s publico` (1ª Seção: tributário, administrativo, previdenciário) × `-s privado` (2ª Seção: civil, consumidor, empresarial) × `-s penal` (3ª Seção) × `-oj CE` (Corte Especial). Por **tipo de documento**: `--base acordao` (default) × `--base monocratica` (15× maior, mas não forma jurisprudência colegiada) |
| **Tema repetitivo / precedente qualificado / IAC** — o que vincula os outros tribunais | `jur stj --temas -q "<assunto>"` (tese firmada + questão submetida + situação; roda headless). Os **acórdãos** julgados sob o rito: `jur stj -q "<termo>" --repetitivos` |
| Recorte temático pronto do STJ (superação, distinção, afetação, rol da ANS, insignificância…) | `jur stj -q "<termo>" --nota <chave>` — são 25, escritas pela Secretaria de Jurisprudência do STJ. Liste com `jur stj --listar-notas` |
| Súmula do STJ, Jurisprudência em Teses, Informativo | ⚠️ **não extraídos pelo crawler** (cada um tem tela própria). Diga isso e ofereça as URLs em `CLAUDE-STJ.md` |
| "Esse processo do STJ existe?" / confirmar julgado do STJ | `jur stj -n "REsp 1809043"` (classe+número) ou `jur stj -n "2019/0116080-0"` (registro). ⚠️ a base **não indexa CNJ**: com número CNJ o checker cai no DataJud e confirma só que o **processo** existe, não o julgado |
| Acórdãos de contas, TCU | `jur tcu` |
| **Contencioso administrativo TRIBUTÁRIO federal** — "o que o CARF decidiu", auto de infração da Receita, IRPF/IRPJ/PIS/COFINS/IPI/aduana em recurso administrativo | `jur carf` (API direta; **ementa + inteiro teor já vêm na busca**). É instância ADMINISTRATIVA: a mesma matéria judicializada é `trf*`/`stj`. ⚠️ `OU`/`OR` é **ignorado** (vira E) — para disjunção rode uma busca por termo e some; ver `CLAUDE-CARF.md` |
| Uniformização no CARF / "Câmara Superior" | `jur carf -s "Câmara Superior de Recursos Fiscais"` (a CSRF faz o papel de instância especial; turmas ordinárias = as demais seções) |
| Acervo histórico dos Conselhos de Contribuintes (pré-2009) | `jur carf -s "Primeiro Conselho de Contribuintes"` (idem Segundo/Terceiro — mesma base, 124 mil docs) |
| **Contencioso administrativo PREVIDENCIÁRIO** — "o que o CRPS decidiu", recurso contra indeferimento do INSS, Junta de Recursos, Câmara de Julgamento | 🔴 **NÃO HÁ BUSCA E NÃO HÁ CONTORNO**: o portal exige **login Gov.br** (medido 31/07/2026 — o HTTP 200 é a tela de login; `/api/now/table/*` dá 401), e a tentativa de contornar com perfil de Chrome dedicado **falhou no mesmo dia**: captcha + recusa por navegador desconhecido. **Diga isso ao usuário**; não devolva zero como se fosse ausência de julgado. Ofereça o `trf*` da região para a matéria já judicializada, e os **Enunciados do CRPS** (públicos, PDF no gov.br). Ver `CLAUDE-CRPS.md` |
| "Esse acórdão do CARF existe?" / confirmar julgado do CARF | `jur carf --decisao 2802-000.639` (nº do acórdão) ou `jur carf -n 13890.000160/2006-17` (nº do processo). ⚠️ **só com máscara** (sem pontuação = 0 em silêncio; o Checker formata sozinho). NÃO é CNJ e o DataJud não cobre o CARF |
| SP estadual | ⚠️ `jur tjsp` sem acesso — ofereça TRF3 (ou TRF4/TRF5 como comparativo) |
| "TJMA", Maranhão, estadual MA | ⚠️ **busca por termo não existe** — o JurisConsult exige captcha de imagem + reCAPTCHA e este repo não resolve captcha. **Diga isso ao usuário**, não tente. Ofereça `jur trf1` (o MA é da 1ª Região) para matéria federal; ver `CLAUDE-TJMA.md` |
| Juizado Especial / Turma Recursal **estadual** no MA | Mesmo bloqueio. As flags existem e estão mapeadas (`jur tjma --foro turmas` / `--foro juizados`), mas nenhuma busca completa |
| "Esse processo do TJMA existe?" / confirmar nº de processo do MA | `jur tjma -n <nº CNJ>` — **funciona** (DataJud/CNJ). ⚠️ confirma o **processo**, não o **julgado**: DataJud não tem ementa |
| **Matéria TRABALHISTA** — verbas rescisórias, horas extras, vínculo de emprego, insalubridade/periculosidade, justa causa, assédio moral, FGTS, adicional noturno | Justiça do Trabalho, **nunca** o TJ do estado (é outro ramo). Escolha pela UF do vínculo: `jur trt9` (PR), `jur trt2` (SP capital), `jur trt15` (SP interior), `jur trt3` (MG), `jur trt1` (RJ), `jur trt4` (RS)… — os 26 comandos em `CLAUDE-FALCAO.md` |
| **Tese trabalhista** — "o que decide a Justiça do Trabalho sobre X", uniformização, súmula/OJ | `jur tst` **primeiro** — o TST uniformiza a CLT para o país inteiro (mesma lógica de "STJ antes do TJ"). Use o TRT para o que é regional |
| ⚠️ Caso trabalhista em **São Paulo** | **SP tem DOIS TRTs**: capital e Grande SP → `jur trt2`; interior (Campinas) → `jur trt15`. Na dúvida rode os dois e diga qual é qual |
| **1º grau trabalhista** — "o que as Varas do Trabalho decidem", sentença | `jur <trt> -g 1` (coleção `sentencas`). ⚠️ **no `tst` não existe** — o comando avisa e manda ao TRT de origem |
| **2º grau trabalhista** — Turmas/Câmaras do TRT, acórdão, recurso ordinário | `jur <trt> -g 2` (default, coleção `acordaos`) |
| Comparar as duas instâncias trabalhistas | `jur <trt> -g ambos` |
| "Juizado Especial trabalhista" / "Turma Recursal trabalhista" | **NÃO EXISTE.** A JT não tem Juizados: o rito sumaríssimo (`-cp ATSum`) é julgado pela mesma Vara, com recurso para as mesmas Turmas. Diga isso e use `-g 1`/`-g 2` |
| Decisão monocrática de desembargador do trabalho | `jur <trt> -g monocraticas` |
| Admissibilidade de Recurso de Revista | `jur <trt> -g admissibilidade` — ⚠️ é ato do **TRT** de origem; o `tst` não tem essa coleção (ele recebe o RR já admitido) |
| Varrer vários TRTs na mesma pergunta | Serialize e espace: os 26 comandos batem no **mesmo host** e rajada rende HTTP 429. Não paralelize — é a exceção à regra geral do repo |

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

No **STF** funcionam todos, em português e minúsculas: `e`, `ou`, `não`, `"frase exata"`,
`"a b"~5` (proximidade), `~` (fuzzy), `$` (curinga), `?` (um caractere) e parênteses.
`ADJ`, `PROX` e `MESMO` **não existem** na pesquisa de jurisprudência do STF (existem no módulo
de Repercussão Geral do portal antigo, que é outra tela). Ver `CLAUDE-STF.md`.

No **STJ** funcionam **todos os oito** da barra do SCON, testados um a um: `e`, `ou`, `não`,
`adj` (e `adj5`), `prox` (e `prox10`), `mesmo` (mesmo campo), `com` (mesmo parágrafo),
`$` (radical) e `"frase exata"`. É a sintaxe mais rica do repositório — use `adj`/`prox` para
precisão. Só `*` não funciona (derruba a consulta). Ver `CLAUDE-STJ.md`.

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
