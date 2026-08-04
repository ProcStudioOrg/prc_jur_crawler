# TJMS — Tribunal de Justiça de Mato Grosso do Sul

**Escopo:** MS · **Status:** 🟢 OK (HTTP direto, sem browser)
**Crawler:** `src/TJMSCrawler.js` · **Mapeamento:** `human-codegen/TJMS/01-cjsg/`
**Portal:** e-SAJ `cjsg` — https://esaj.tjms.jus.br/cjsg/consultaCompleta.do

> **Primeiro `cjsg` com crawler neste repo.** O TJCE tem `cjsg` mas foi mapeado
> pelo SJURIS; o TJSP tem `cjsg` e está 🔴 por captcha. **Não generalize daqui
> para os outros ESAJ sem medir** — a diferença que importa (ter ou não
> reCAPTCHA) muda por instalação.

## O que esta base cobre — e o que NÃO cobre

| Cobre | Não cobre |
|---|---|
| 2º grau: Câmaras, Seções, Órgão Especial | **1º grau (sentenças)** — é o `cjpg`, outro módulo, sem crawler |
| Turmas Recursais / Juizados Especiais | **Acervo do e-Proc** (migração desde 01/07/2026) |
| Acórdãos (o grosso), monocráticas (residual) | Súmulas e enunciados (ficam em `www.tjms.jus.br/sumulas`) |

### ⚠️ A lacuna do e-Proc — releia antes de afirmar cobertura recente

O TJMS **começou a migrar para o e-Proc em 01/07/2026** (justiça comum e 2º
grau) e ampliou em 05/08/2026 para as varas cíveis residuais da capital. O
`cjsg` é o índice do **SAJ**.

Medido em 04/08/2026, o módulo de jurisprudência do e-Proc do TJMS
**não está habilitado**:

```
GET https://eproc2g.tjms.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar
-> HTTP 200, mas o corpo é "Erro — Falha no processamento da solicitação."
   e o menu público não tem item "Jurisprudência"
```

(No TJRJ esse mesmo caminho funciona e virou o `TJRJNavigator` — aqui, não.)

**Consequência:** julgados nascidos no e-Proc a partir de julho/2026 tendem a
não aparecer em lugar nenhum de público. Ao responder pedido de jurisprudência
**muito recente** do TJMS, diga isso. **Reteste periodicamente** — o dia em que
o módulo subir, este tribunal ganha um segundo crawler.

## Passo 0 — API oficial: PROCURADA, NÃO EXISTE

Medido em 04/08/2026 (não é "não procurei"):

| Onde | Resultado |
|---|---|
| `dadosabertos.tjms.jus.br`, `api.tjms.jus.br`, `jurisprudencia.tjms.jus.br` | **sem DNS** |
| `/transparencia/dados-abertos` | 404 |
| `/api-docs`, `/swagger-ui.html`, `cjsg/swagger-ui.html` | 404 / 302 |
| **`www.tjms.jus.br/dados-abertos`** | **200 — e só publica dois endpoints** |

Os dois únicos serviços de dados abertos do TJMS, **nenhum de jurisprudência**:

```
GET https://www.tjms.jus.br/api/estrutura-judicial/foros
GET https://www.tjms.jus.br/api/estrutura-judicial/varas?idForo={n}
```

Por isso o acesso é `http` (POST direto no cjsg), não `api-oficial`.

## Bloqueio — as três respostas

| Pergunta | Resposta |
|---|---|
| Existe captcha / Cloudflare / verificação de navegador? | **NÃO.** Sem `grecaptcha`, sem sitekey, sem desafio |
| A **busca** funciona sem resolver nada? | **SIM** — POST direto, sem browser, sem cookie prévio |
| O **download** funciona sem resolver nada? | **SIM** — mas tem **rate limit**, ver ressalva 5 |

## Uso

```bash
# básico — 2º grau, acórdãos, termo na ementa
./bin/jur tjms -q "usucapião" -m 1

# Juizado Especial / Turma Recursal
./bin/jur tjms -q "dano moral" --origem turmas

# recorte por data de julgamento e por publicação (são filtros diferentes)
./bin/jur tjms -q "dano moral" -di 01/01/2025 -df 31/03/2025

# intervalo maior que 365 dias: o crawler fatia sozinho (ver ressalva 2)
./bin/jur tjms -q "dano moral" -di 01/01/2024 -df 04/08/2026
./bin/jur tjms -q "dano moral" -dpi 01/01/2025 -dpf 31/03/2025

# termo no inteiro teor, não só na ementa
./bin/jur tjms -q "responsabilidade civil do Estado" --escopo inteiroTeor

# baixar o PDF do acórdão
./bin/jur tjms -q "usucapião" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjms

# confirmar que um processo existe (Checker)
./bin/jur tjms -n "1401542-58.2023.8.12.0000"

# auditar a amostra contra a base
./bin/jur tjms -q "usucapião" -m 1 --verificar 5
```

## Flags específicas

| Flag | Valores | Default | O que faz |
|---|---|---|---|
| `--origem` | `comum` · `turmas` · `ambas` | `comum` | **A desambiguação Justiça Comum × Juizado.** `dados.origensSelecionadas` T/R |
| `-t, --tipo` | `acordao` · `homologacao` · `monocratica` · `todos` | `acordao` | aba de tipo de publicação |
| `--escopo` | `ementa` · `inteiroTeor` | `ementa` | qual campo recebe o termo |
| `-ord, --ordem` | `publicacao` · `relevancia` | `publicacao` | ordenação |
| `-r, --relator` | nome/trecho | — | campo `nmAgente` |
| `--sem-sinonimos` | — | ligado | **não tem efeito**, ver ressalva 7 |
| `-di/-df` | DD/MM/AAAA | — | data de **julgamento** |
| `-dpi/-dpf` | DD/MM/AAAA | — | data de **publicação** |

Flags comuns (`-q -m -o -v --json --fetch-inteiro-teor --output-dir`) seguem o
padrão do repo. `-v/--headed` são **ignoradas** — não há browser.

---

# Ressalvas — leia antes de rodar

## 1. ⚠️ ACENTO É OBRIGATÓRIO. É a armadilha mais cara deste tribunal

O índice **não normaliza acentuação**:

```
-q "usucapiao"  ->     3 resultados
-q "usucapião"  -> 3.885 resultados
```

Três não é "o TJMS quase não julga usucapião" — é a query errada. O crawler
avisa quando a query tem palavra suspeita sem acento; **repasse o aviso** e
refaça a busca. Vale também para o operador: `NAO` (39.003) e `NÃO` (54.751)
são buscas diferentes.

## 2. ⚠️ Intervalo de data acima de 365 dias corridos devolve ZERO, sem erro

O cjsg aceita no máximo **365 dias corridos** (364 de diferença entre início e
fim). Um dia a mais e a resposta é **0, sem mensagem nenhuma**:

```
-di 01/01/2025 -df 31/12/2025   (364 de diferença) -> 6.567
-di 01/01/2025 -df 01/01/2026   (365 de diferença) -> 0
-di 04/08/2025 -df 04/08/2026   (365 de diferença) -> 0
```

Vale para julgamento **e** para publicação. É o zero silencioso mais fácil de
tomar aqui, porque **"jurisprudência do último ano" é exatamente 365 de
diferença**.

**O crawler fatia sozinho** em janelas de 365 dias corridos e junta os
resultados, avisando no log. Duas consequências:

- `-m N` passa a valer **por janela** — o teto real é `janelas × N` páginas;
- pedir intervalo longo **de julgamento e de publicação ao mesmo tempo** é
  recusado com erro explícito (o fatiamento cruzado multiplicaria as buscas).

Se você chamar o portal na mão, respeite o limite.

## 3. ⚠️ `ADJ` e `PROX` devolvem ZERO — não existem aqui

Operadores testados um a um (`dano`/`moral`, ementa, 2º grau, acórdãos):

| Operador | Vale? | Medição |
|---|---|---|
| espaço (E implícito) | sim | 67.328 |
| `E` | **sim** | 67.529 |
| `OU` | **sim** | 110.242 |
| `NAO` / `NÃO` | **sim** (e diferentes entre si) | 39.003 / 54.751 |
| `"frase exata"` | **sim** | 65.752 |
| `$` (radical) | efeito mínimo, não confie | `usucapi$` → 4 |
| `ADJ` | **NÃO** | `dano ADJ2 moral` → **0** |
| `PROX` | **NÃO** | `dano PROX5 moral` → **0** |

`ADJ`/`PROX` viram texto literal e **zeram a busca sem erro**. É o jeito mais
fácil de ler "não há jurisprudência" onde houve operador inexistente.

## 4. ⚠️ Decisão monocrática é acervo residual; "Homologação de Acordo" é zero

Com `dano moral`, 2º grau: **67.529 acórdãos**, **48 monocráticas**, **0
homologações**. Não é filtro quebrado — a aba `D` responde certo com os 48.
É acervo mesmo. **Não prometa cobertura de monocrática do TJMS.**

## 5. ⚠️ Rate limit no download do inteiro teor (e só nele)

Baixando 100 PDFs sem pausa: **53 OK, 47 × HTTP 403**, começando por volta do
50º. **Não é bloqueio** — os mesmos documentos voltam 200 após ~4s. O crawler
usa 1,2s entre downloads com backoff ×3 até 20s e fecha **100/100**.

Se você chamar o `getArquivo.do` na mão, respeite a pausa.

## 6. ⚠️ A paginação é instável: ~1 documento em 100 pode ser pulado

A ordenação (`dtPublicacao` ou `relevancia`) **não tem campo de desempate**.
Medido pedindo a mesma página 5 vezes na mesma sessão: 2 variantes, sempre 100
cards, diferindo em 1 documento. Diferente do TJDFT, **fixar o cookie não
resolve** — o teste já é com cookie fixo.

O crawler deduplica por `cdAcordao`, o que evita repetição; **não evita o
documento pulado**. Ao afirmar cobertura exaustiva de um tema no TJMS,
mencione essa margem.

## 7. ⚠️ O checkbox "sinônimos" não faz nada

`veiculo` com sinônimos → **224**; sem → **224**. Contagem idêntica ⇒ o
backend ignora. `--sem-sinonimos` existe por fidelidade ao formulário.

## 8. ⚠️ O total oscila entre os nós do balanceador

O JSESSIONID termina em `.cjsg2` ou `.cjsg3`, e os índices estão levemente
dessincronizados. A **mesma busca** devolve 67.322 / 67.328 / 67.529 — ~0,3%.

Trate o total como **ordem de grandeza**, não como número reprodutível.
Comparações de filtro (com × sem) continuam válidas porque a diferença que
importa é de ordem de grandeza.

## 9. ⚠️ Busca sem termo devolve zero — não existe "listar tudo"

Com os dois campos de texto vazios (mesmo com todas as origens e tipos
marcados): **0 cards**. Se você quer só filtrar por data ou órgão, precisa de
algum termo.

## 10. ⚠️ Quem identifica o julgado é o `cdAcordao`, não o nº do processo

Medido: `1401542-58.2023.8.12.0000` devolve **dois** documentos (um acórdão e
uma monocrática). O `verificador` deve casar por `cdAcordao`.

**Permalink** (confirmado em contexto limpo, sem cookie):

```
https://esaj.tjms.jus.br/cjsg/getArquivo.do?cdAcordao=<id>&cdForo=<foro>
```

⚠️ Ele **baixa** o PDF (`Content-Disposition: inline; filename=<registro>.pdf`)
em vez de renderizar no navegador. É um link válido para citação — só não é uma
página. E o `filename` é o **nº de registro do acórdão**, um terceiro
identificador: não confunda com `cdAcordao` nem com o CNJ.

## 11. A ementa já vem na busca; o inteiro teor não

A ementa **íntegra** (não trecho, não highlight) está no HTML da própria busca,
em `div#textAreaDados_<cdAcordao>`, junto com a **citação oficial** do tribunal.
Nunca faça request para "expandir ementa".

O inteiro teor é PDF (~330–530 KB, ~23–29 mil caracteres de texto) e exige um
`getArquivo.do` por documento. `--fetch-inteiro-teor` grava o `.pdf` **e** um
`.txt` com metadados + ementa + texto extraído (usa `pdftotext`; sem ele, salva
o PDF e diz que não extraiu).

---

## Manutenção

```bash
node src/TJMSTestes.js            # suíte de integração (site real)
node src/TJMSTestes.js --rapido   # pula o download em disco
node tests/smoke.js tjms
```

Quando quebrar, use a skill [`fixer`](skills/fixer/SKILL.md) contra os prints
de `human-codegen/TJMS/01-cjsg/`.

**O que checar primeiro num retorno vazio**, nesta ordem:
1. acento na query (ressalva 1);
2. intervalo de data acima de 365 dias corridos (ressalva 2);
3. operador `ADJ`/`PROX` na query (ressalva 3);
4. `--origem` errada (comum × turmas);
5. paginação sem cookie — o `trocaDePagina.do` devolve HTTP 200 com zero cards
   se faltar o JSESSIONID. O `TJMSNavigator` lança erro nesse caso de propósito;
   se alguém "consertar" isso devolvendo lista vazia, volta o bug silencioso.
