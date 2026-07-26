# STF — Supremo Tribunal Federal

Portal: **https://jurisprudencia.stf.jus.br/pages/search** (SPA Angular).
Acesso do crawler: **`api`** — `POST https://jurisprudencia.stf.jus.br/api/search/search`.
O Playwright entra **uma vez a cada ~4 dias**, e só para resolver o desafio do AWS WAF; todo o
resto é HTTP puro (~0,5 s por busca). `-v`/`--headed` só afetam esse momento.

É a corte constitucional: instância única, jurisdição nacional. **Não existe Juizado Especial
nem Turma Recursal no STF** — a desambiguação daqui é por **órgão** e por **classe processual**.

## Abrangência da base (medida em 25/07/2026)

| Base (`-b`) | Documentos | Desde | O que é |
|---|---|---|---|
| `acordaos` (default) | **368.511** | **27/04/1892** (HC 300) | decisões colegiadas: Tribunal Pleno e Turmas |
| `decisoes` | **741.676** | 04/11/1968 | decisões monocráticas — **seleção, não exaustiva** |
| `sumulas` | **799** | 13/12/1963 | 736 simples + **63 vinculantes** |
| `informativos` | **11.571** | 08/08/1995 | resumos da Secretaria, **sem valor oficial** |

Documento mais recente na data do mapeamento: 29/06/2026.
A documentação do STF fala em acórdãos "publicados após 06/07/1950"; o que vem antes é a
sub-base **Coletânea de acórdãos** (25.425 documentos, `--coletanea`).

## Arquitetura (src/)

| Arquivo | Papel |
|---|---|
| `STFCrawler.js` | Monta filtros, pagina, mapeia para o formato do repo |
| `STFNavigator.js` | Token do WAF, CA intermediária, **porte fiel do construtor de query da SPA** |
| `STFChecker.js` | Consulta por classe+número **e** por número único CNJ; auditoria `--verificar` |
| `STFTestes.js` | Integração: `node src/STFTestes.js` (`--rapido` pula I/O em disco) |

## Exemplos

```bash
# Acórdãos por termo (E implícito), com recorte de data
./bin/jur stf -q "liberdade de expressão" -di "01/01/2023" -df "31/12/2024" -m 2 --json

# SÚMULAS VINCULANTES (as 63) — efeito vinculante sobre todo o Judiciário
./bin/jur stf --vinculantes -m 1
./bin/jur stf -b sumulas -q "servidor público"        # todas as súmulas
./bin/jur stf --sumulas-simples                        # só as 736 não vinculantes

# REPERCUSSÃO GERAL — os paradigmas que vinculam os demais tribunais
./bin/jur stf -q "prescrição tributária" --rg
./bin/jur stf --tema "890"                             # busca pelo nº ou texto do TEMA
./bin/jur stf --tese "responsabilidade civil do Estado"

# Só o Plenário (jurisprudência de maior peso) / só uma Turma
./bin/jur stf -q "dano moral" -oj "Tribunal Pleno"
./bin/jur stf -q "dano moral" -oj "Primeira Turma,Segunda Turma"

# Controle concentrado × recurso extraordinário
./bin/jur stf -q "liberdade de expressão" -c "ADI,ADPF,ADC"
./bin/jur stf -q "liberdade de expressão" -c "RE,ARE"

# Decisões monocráticas de um ministro
./bin/jur stf -b decisoes -q "prisão preventiva" -r "GILMAR MENDES"

# Buscar dentro do inteiro teor (só acórdãos publicados a partir de 2012)
./bin/jur stf -q "audiência de custódia" --inteiro-teor

# Consulta direta por número — os DOIS formatos do STF
./bin/jur stf -n "ADI 4277"                            # classe + número (nativo)
./bin/jur stf -n "0164903-80.2018.8.06.0001"           # número único (CNJ da origem)

# Salvar inteiro teor + auditar a amostra contra a base
./bin/jur stf -q "feminicídio" --fetch-inteiro-teor --output-dir ./resultados-stf --verificar 5

# Listar as opções de uma faceta
./bin/jur stf --listar-facetas orgao_julgador
./bin/jur stf --listar-facetas processo_classe_processual_unificada_classe_sigla
```

## Flags específicas

| Flag | Valores | Notas |
|---|---|---|
| `-b, --base` | `acordaos` (default), `decisoes`, `sumulas`, `informativos` | muda o acervo inteiro |
| `-n, --numero` | `"ARE 1596565"` ou CNJ | dispensa `-q`; sai com código 1 se não encontrar |
| `-oj, --orgao` | `"Tribunal Pleno"`, `"Primeira Turma"`, `"Segunda Turma"`, `"Terceira Turma"` | vírgula separa; nome exato |
| `-c, --classe` | `ADI,ADPF,ADC,RE,ARE,AI,HC,MS,Rcl,Ext...` | 73 siglas em `human-codegen/STF/01-jurisprudencia/07-classes-acordaos.json` |
| `-r, --relator` | `"GILMAR MENDES"` | 144 nomes em `07-ministros-acordaos.json`, CAIXA ALTA e com acento |
| `-uf, --uf` | `SP,PR,RJ...` | UF de **origem** do processo |
| `--rg` / `--sem-rg` | | repercussão geral reconhecida ou não |
| `--vinculantes` / `--sumulas-simples` | | implicam `-b sumulas` |
| `--questao-ordem`, `--coletanea` | | sub-bases de acórdãos |
| `--presidencia` | | base `decisoes`: só decisões da Presidência |
| `--tema`, `--tese`, `--partes`, `--legislacao`, `--ementa` | texto | campos específicos da pesquisa avançada |
| `--inteiro-teor` | | amplia a busca para o texto integral (só ≥ 2012) |
| `--sem-sinonimos`, `--sem-plural`, `--radicais` | | trocam o analisador do Elasticsearch |
| `-ord` | `relevancia` (default), `recentes`, `antigos` | |
| `--page-size` | até **250** | default 100 |
| `--listar-facetas [nome]` | | enumera as opções de um filtro |
| `--verificar [N]` | default 5 | reconsulta N processos e confirma os ids |
| `--full-text` | | inclui o inteiro teor no JSON |

## Operadores — testados um a um, por contagem (base `acordaos`, 25/07/2026)

| Operador | Funciona? | Exemplo | Traduzido | Se o cliente NÃO traduzir |
|---|---|---|---|---|
| `E` implícito | sim | `dano moral` | 2.945 | 2.945 |
| `e` explícito | sim | `dano e moral` | 2.945 | **2.879** |
| `ou` | sim | `droga ou entorpecente` | 10.127 | **4.194** |
| `não` | sim | `prisão não preventiva` | 6.108 | **6.905** |
| `"frase exata"` | sim | `"presunção de inocência"` | 1.768 (sem aspas: 2.003) | igual |
| `" "~N` proximidade | sim | `"provimento cargo"~5` = 1.277; `~1` = 743 | igual |
| `~` fuzzy | sim | `indenização~` 11.433 (sem til 11.308) | igual |
| `$` curinga | sim | `indeniz$` | 12.423 | **1** |
| `?` um caractere | sim | `Pelu?o` → 8.827 (Peluso) | igual |
| `( )` parênteses | sim | `(extradição nao china) ou (exequatur nao STJ)` → 1.982 | 0 |

**Não existem `ADJ`, `PROX` nem `MESMO`** na SPA de jurisprudência — mas existem no módulo de
Repercussão Geral do portal ASP, que tem outro conjunto (`e ou adj não prox mesmo $`).
Não misture as sintaxes: ver `human-codegen/STF/02-repercussao-geral/`.

Regras finas: dentro de aspas o operador é literal (`princípio da "não" culpabilidade` busca a
palavra "não"); dentro de `" "~N` só valem `ou` e parênteses, e o cliente expande em
permutações (`"(indenização ou reparação) danos morais"~5` →
`("indenização danos morais"~5 OR "reparação danos morais"~5)`, 1.717 resultados).

## API oficial: procurei, **não existe**

| Onde procurei | Resultado |
|---|---|
| `dadosabertos.stf.jus.br` | **NXDOMAIN** |
| `portal.stf.jus.br/dadosabertos/` | HTTP 200 servindo a página de erro 404 do portal |
| `transparencia.stf.jus.br` | existe — é o painel **Corte Aberta** (Qlik Sense), estatística de acervo e produtividade, **sem jurisprudência** |
| Swagger / OpenAPI / `/api-docs` / `/v1/` / `/rest/` | nada publicado em `stf.jus.br` |
| **DataJud (CNJ)** — `api_publica_stf`, `api_publica_STF` | `index_not_found_exception`: **o STF não está no DataJud** |
| Base nacional do ramo | não há (a Falcão cobre só a Justiça do Trabalho) |

O que existe — e é ótimo — é a **API interna da SPA**: `POST /api/search/search`, um
passthrough de Elasticsearch, mais `GET /api/admin/loadConfig` (ministros em exercício).

## Ressalvas

1. **AWS WAF.** Sem o cookie `aws-waf-token`, qualquer requisição a `jurisprudencia.stf.jus.br`
   — inclusive a API — devolve `202` com `x-amzn-waf-action: challenge` e corpo vazio. O desafio
   é JavaScript e um Chromium headless comum resolve em ~5 s. O token é guardado em
   `$TMPDIR/jur-stf-waf-token.json` e vale ~4 dias; o navigator renova sozinho ao receber 202.
   `portal.stf.jus.br` **não** tem WAF (mas devolve 403 sem User-Agent de navegador).

2. **Corpo pequeno + `) OR (` = HTTP 403.** O WAF inspeciona corpos de **até 8.192 bytes** e
   trata `) OR (` como assinatura de SQL injection. Bisecção controlada: o mesmo corpo com
   7.630 B levou 403 e com 9.430 B respondeu 200/1.982. A SPA nunca esbarra nisso porque sempre
   manda o bloco `highlight`; o crawler faz o mesmo. **Se você montar a requisição na mão, não
   remova o `highlight`.**

3. **Cadeia TLS incompleta.** O servidor manda só o certificado folha (`CN=*.stf.jus.br`), sem o
   intermediário GlobalSign. `curl` no macOS passa (keychain), **Node falha** com
   `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. O navigator busca o intermediário pela extensão AIA do
   próprio certificado, guarda em `$TMPDIR/jur-stf-ca.pem` e o acrescenta ao bundle de CAs —
   sem desligar a verificação. Se um dia o STF trocar de CA, o cache é regerado sozinho.

4. **Os operadores são traduzidos no CLIENTE.** `e`/`ou`/`não`/`$` viram `AND`/`OR`/`NOT`/`*`
   em JavaScript antes de a query sair do navegador. Quem chama a API sem repetir essa tradução
   manda o operador como termo buscado — e a contagem muda sem erro nenhum
   (`indeniz$` = 12.423 traduzido contra **1** literal). Está em
   `STFNavigator.preprocessarQuery()`, com teste dedicado na suíte.

5. **A base de jurisprudência não indexa CNJ.** `-q "0164903-80.2018.8.06.0001"` devolve zero.
   O identificador nativo é **classe + número + incidente** (`ARE 1596565 AgR`). Para ir do CNJ
   ao julgado, `-n <cnj>` faz o caminho de duas etapas pelo portal.

6. **O "Número Único" do STF costuma ser o CNJ da ORIGEM.** ARE 1596565 → `0164903-80.2018.8.06.0001`
   (J=8, TR=06 = TJCE). E processo físico antigo usa codificação própria com **J=0**
   (ADI 4277 → `0006667-55.2009.0.01.0000`), cujo **dígito verificador não fecha**.
   `cnj.validar()` falso aqui é AVISO, não veto. No portal, o parâmetro `numeroUnico` exige os
   **20 dígitos sem máscara** — com máscara a página não redireciona e o processo "some".

7. **A Coletânea de acórdãos some de qualquer filtro de órgão.** Os 25.425 documentos anteriores
   a 1950 têm `orgao_julgador = null`. Pleno + 1ª + 2ª + 3ª Turma = 343.086; a base tem 368.511.
   Se o recorte for histórico, **não** use `-oj`; use `--coletanea`.

8. **Limites técnicos.** 250 documentos por requisição (`--page-size`) e **10.000 por consulta**
   (além disso o servidor devolve 403 com `"O maior registro que pode ser acessado..."`).
   Consulta larga: fatie por ano com `-di/-df`.

9. **Busca no inteiro teor só alcança acórdãos publicados a partir de 2012** — antes disso o STF
   não gerava o texto integral em formato digital. Zero resultado em acórdão dos anos 1990 com
   `--inteiro-teor` é limite da base, não erro de sintaxe.

10. **Relevância enviesada de propósito.** A função de score dá peso 1,15 a `Tribunal Pleno`,
    1,1 a `is_repercussao_geral` e decaimento exponencial por data. A primeira página vem cheia
    de paradigmas de RG mesmo sem filtro — ótimo para citar, enganoso para estimar cobertura.

11. **Sinônimos ligados por padrão.** O Tesauro do STF trata "droga" e "entorpecente" como
    sinônimos: as duas buscas dão 10.127. Com `--sem-sinonimos`, 6.027 e 4.687. Se precisar de
    contagem literal, desligue.

12. **Inteiro teor de graça.** O campo `inteiro_teor_texto` já vem no resultado da busca
    (17–20 mil caracteres num acórdão típico). `--fetch-inteiro-teor` é só I/O local: nenhuma
    requisição extra, nenhum PDF, nenhum captcha.

13. **`informativos` chama-se `novo_informativo` no índice.** Só importa para quem montar a
    query na mão; o crawler já traduz.

## Mapeamento

`human-codegen/STF/` — 4 módulos, 24 prints, 77 arquivos, `INDEX.md` sem pendências:

| Módulo | O que é | Status |
|---|---|---|
| `01-jurisprudencia/` | a SPA (4 bases, operadores, facetas, API) | **implementado** |
| `02-repercussao-geral/` | portal ASP de acompanhamento dos temas de RG | mapeado, não implementado (a RG *citável* está no módulo 01) |
| `03-sumulas/` | "Aplicação das Súmulas no STF" (portal ASP) | mapeado, não implementado |
| `04-consulta-processual/` | `listarProcessos.asp` — a base do `Checker` | **implementado** |
