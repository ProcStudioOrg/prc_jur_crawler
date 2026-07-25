# TJPR — Tribunal de Justiça do Paraná

Comando: `./bin/jur tjpr` · Stack: `src/TJPRCrawler.js` + `src/TJPRNavigator.js` +
`src/TJPRChecker.js` · Testes: `node src/TJPRTestes.js` (`npm run test:tjpr`) ·
Verificação: `skills/verificador/tribunais/tjpr.md` ·
Mapeamento: `human-codegen/TJPR/`

## Sistema alvo

**Um único módulo** público de jurisprudência:
`https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=iniciar`

Struts 1.x sobre JSP (`.do`), aplicação **própria** do TJPR. O TJPR tramita em
Projudi, mas a jurisprudência **não** é o módulo do Projudi (diferente do TJGO).

**Sem browser**: um único POST resolve a busca inteira. `-v/--headed` são ignorados.

```
POST /jurisprudencia/publico/pesquisa.do?actionType=pesquisar
Content-Type: application/x-www-form-urlencoded   (corpo em ISO-8859-1)
```

**Abrangência**: só **2º grau** — Câmaras Cíveis/Criminais, Seções, Grupos de
Câmaras, Órgão Especial, 1ª Vice-Presidência, **Turmas Recursais dos Juizados
Especiais** e o acervo do extinto Tribunal de Alçada (até 2005).
Não há sentenças de 1º grau. 6.360.593 documentos na base (25/07/2026).

## Justiça Comum × Juizados Especiais — a desambiguação

Use **`--foro`**. Ele filtra pelos **ids dos órgãos julgadores** (campo
`idOrgaoJulgador`, lista separada por vírgula), a partir de
`human-codegen/TJPR/01-jurisprudencia/06-orgaos.json` (150 órgãos mapeados).

| `--foro` | O que entra | Órgãos |
|---|---|---|
| `comum` (**default**) | Justiça Comum de 2º grau: Câmaras, Seções, Grupos, Órgão Especial, 1ª Vice-Presidência, extinto TA | 132 ids |
| `juizados` | Juizados Especiais: Turmas Recursais (inclusive Suplementares e Reunidas), Turmas de Uniformização, Núcleo de Conciliação | 18 ids |
| `todos` | sem filtro de órgão | — |

Contagens medidas ("dano moral", EMENTA, julgamento 01/01–31/03/2026):

```
comum 2.952   juizados 4.062   todos 7.014   (= 2.952 + 4.062, a partição fecha)
```

Prints: `human-codegen/TJPR/01-jurisprudencia/08.01-resultados-justica-comum.png`
e `08.02-resultados-juizados-turmas-recursais.png`.
Detalhamento completo (incluindo por que o combo do site não serve):
`human-codegen/TJPR/01-jurisprudencia/03-desambiguacao-justica-comum-x-juizados.txt`.

Cada resultado sai com o campo `foro` já classificado, e o `--json` devolve
`orgaosFiltrados` (quantos ids foram enviados) e `forasDoForo` (quantos julgados
voltaram fora do foro pedido — **tem que ser 0**).

## Exemplos

```bash
# Justiça Comum (default), com período de julgamento
./bin/jur tjpr -q "dano moral" -di "01/01/2026" -df "31/03/2026" -m 2

# Juizados Especiais / Turmas Recursais — mesma busca, outro universo
./bin/jur tjpr -q "dano moral" -di "01/01/2026" -df "31/03/2026" --foro juizados

# Um órgão específico (vence o --foro)
./bin/jur tjpr -q "consumidor" -oj "3ª Turma Recursal"
./bin/jur tjpr -q "improbidade" -oj "Órgão Especial"

# Operadores nativos, dentro do -q
./bin/jur tjpr -q "prescrição E crédito"
./bin/jur tjpr -q "(desapropriação OU expropriação)"
./bin/jur tjpr -q "desapropriação !NAO indireta"
./bin/jur tjpr -q "constituciona$"
./bin/jur tjpr -q '"dano moral"'

# Buscar no inteiro teor em vez da ementa
./bin/jur tjpr -q "usucapião extraordinária" --escopo inteiroTeor

# Só acórdãos; data de publicação em vez de julgamento
./bin/jur tjpr -q "furto" -t acordao
./bin/jur tjpr -q "furto" -dpi "01/03/2026" -dpf "31/03/2026"

# VERIFICAR um julgado (consulta direta por número — dispensa -q, exit 1 se não existir)
./bin/jur tjpr -n "0003249-43.2020.8.16.0193" --json
./bin/jur tjpr --acordao <numero> --json

# Auditar uma busca + gravar inteiro teor
./bin/jur tjpr -q "juros" --foro juizados --verificar 5 --json
./bin/jur tjpr -q "aposentadoria" --fetch-inteiro-teor --output-dir ./resultados/tjpr

# Listagens auxiliares
./bin/jur tjpr --listar-orgaos --foro juizados     # 18 órgãos, do mapeamento
./bin/jur tjpr --listar-orgaos-ao-vivo             # relê a faceta do site (detecta órgão novo)
```

## Flags específicas

| Flag | Valores | Observação |
|---|---|---|
| `--foro` | `comum` (default) `juizados` `todos` | **a desambiguação** — ver tabela acima |
| `-n, --numero` | CNJ (com ou sem máscara) | consulta direta; dispensa `-q`; exit 1 se não encontrar |
| `--acordao` | nº do acórdão | consulta direta pelo campo "NUMERAÇÃO DO ACÓRDÃO" |
| `-oj, --orgao` | nome (parcial, sem acento serve) ou id | um órgão só; ignora `--foro` |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto) |
| `--escopo` | `ementa` (default) `inteiroTeor` `ambas` | combo "EMENTA/INTEIRO TEOR" |
| `-l, --local` | `1` `2` `99` | forma legada de `--escopo`; se informada, vence |
| `-t, --tipo` | `todas` (default) `acordao` `monocratica` `duvida` | combo "TIPO DE DECISÃO" |
| `--base` | `todas` (default) `turmas` `tj` `vice` `cidh` | combo "BASE DE CONSULTA" (`ambito`) do site — **não** é a desambiguação, ver ressalva 2 |
| `-p, --processo` | nº | filtro **dentro** da busca (use `-n` para consulta direta) |
| `-ord, --ordem` | `recentes` (default) `antigos` | ordena por data de julgamento |
| `--verificar [N]` | default 5 | reconsulta N processos e confere o id do documento |
| `--listar-orgaos` / `--listar-orgaos-ao-vivo` | | combina com `--foro` para filtrar a lista |
| `--fetch-inteiro-teor` / `--output-dir` | | 1 requisição HTTP por julgado |
| `-m, --max-pages` | default 10 | **50 registros por página** (ver ressalva 5) |

## Operadores de pesquisa — testados um por um

Ajuda oficial: `human-codegen/TJPR/01-jurisprudencia/02-busca-livre-e-operadores.txt`
(print `02.02-ajuda-operadores.png`). Contagens na janela 01/01–31/03/2026, EMENTA:

| Sintaxe | Funciona? | Evidência |
|---|---|---|
| `a b` (E implícito) | sim | `prescrição crédito` = 678 (controles 4.192 e 7.485) |
| `E` explícito | sim | `prescrição E crédito` = 678, idêntico ao implícito |
| `OU` (com ou sem parênteses) | sim | `(desapropriação OU expropriação)` = 258 (controles 107 e 153) |
| `!NAO` / `!NÃO` | sim, com ressalva 3 | `desapropriação !NAO indireta` 107 → 88 |
| `$` (radical) | sim | `constituciona$` = 4.231 contra `constitucional` = 3.227 |
| `"frase exata"` | sim | `"dano moral"` = 6.841 contra `dano moral` = 7.014 |
| maiúsculas / acentos | indiferentes | `DANO MORAL` = `dano moral`; `usucapião` = `usucapiao` |
| **`PROX`n** | **NÃO — não use** | ver ressalva 4 |

## Ressalvas

1. **O corpo do POST tem que ir em ISO-8859-1** (`accept-charset="ISO-8859-1"`).
   É o modo de falha mais perigoso deste tribunal, porque é **silencioso**:
   mandando UTF-8, o servidor lê `usucapião` como `usucapiÃ£o` e responde
   "Nenhum registro encontrado!" — o crawler devolve `success:true` com zero
   resultados e ninguém desconfia. Medido: latin1 `usucapião` = 467 julgados,
   UTF-8 `usucapião` = 0. `TJPRNavigator.encodeLatin1()` cuida disso e
   `TJPRTestes.js` tem um teste dedicado. Nunca monte o corpo com
   `URLSearchParams`/`encodeURIComponent` aqui.
   Assimetria: **respostas** de `pesquisa.do` e das fichas vêm em UTF-8; as de
   `ajax.do` (autocomplete, facetas) vêm em ISO-8859-1.

2. **O combo "BASE DE CONSULTA" (`ambito`, exposto como `--base`) NÃO separa
   Juizados de Justiça Comum.** Ele diz em que base o documento foi publicado,
   não a competência, e as bases se sobrepõem:
   `ambito=4` (TURMAS RECURSAIS) 3.819 + `ambito=6` (TRIBUNAL DE JUSTIÇA) 3.195
   + `ambito=7` 6 = 7.020 contra 7.014 do total. Pior: dentro de `ambito=6`
   ("TRIBUNAL DE JUSTIÇA") há 226 julgados da **6ª Turma Recursal dos Juizados
   Especiais**, 16 da Turma de Uniformização e 6 da 1ª Vice-Presidência (que é o
   âmbito 7). E a 6ª Turma Recursal — 99.268 documentos no acervo — **não**
   aparece em `ambito=4`. Quem usar `--base tj` como "Justiça Comum" entrega
   julgado de Juizado como se fosse de Câmara. Use `--foro`.

3. **`!NAO` só é confiável depois de UM termo.** Com dois termos antes, a
   expressão deixa de ser "E" e o total **sobe**:
   `dano moral` 7.014 → `dano moral !NAO consumidor` **7.950**.
   Com um termo funciona: `moral !NAO consumidor` 7.488 → 4.636.
   Se precisar excluir num contexto de dois termos, confira o total antes de citar.

4. **`PROX`n não funciona — expande em vez de restringir, e o número é ignorado.**
   `mandado liminar` = 510, mas `mandado liminar PROX4` = `PROX1` = `PROX40` =
   `mandado PROX4 liminar` = **6.916** (controles: `mandado` 2.394,
   `liminar` 4.309). O botão PROX existe na tela e a ajuda oficial o documenta,
   mas o resultado não é proximidade. Não use; prefira `"frase exata"`.

5. **50 registros por página, e até 10 deles podem ser da Corte IDH.** Não há
   combo de quantidade. Enquanto houver decisões da Corte Interamericana na
   resposta, uma página rende **40** julgados do TJPR; depois que elas acabam,
   50. Por isso `count` para `-m 1` oscila entre 40 e 50 — não é bug.
   Paginação por `pageNumber` (1-based) + `sortColumn=processo_sDataJulgamento`;
   dá para pedir a página 80 direto. Testado até a página 80 sem erro; sem teto
   técnico de resultados (diferente do TJPA, que corta em 10.000).

6. **Toda busca vem contaminada por decisões da Corte IDH** (Corte
   Interamericana de Direitos Humanos, acervo internacional hospedado pelo TJPR).
   Elas entram na **mesma tabela** (`<tr class="... cidh">`, link
   `/jurisprudencia/c/<id>/IDH-<id>`), aparecem mesmo com `--base tj` e mesmo em
   consulta por número de processo, e são somadas no **contador geral** da tela.
   O parser descarta essas linhas; o número correto é o `totalTJPR` do `--json`
   ("N registro(s) da Jurisprudência do Tribunal de Justiça"), nunca o geral.
   Restringir `-t acordao|monocratica|duvida` faz a Corte IDH desaparecer.

7. **`idOrgaoJulgadorSelecao` (o hidden do autocomplete da tela) é ignorado pela
   busca.** Mandar `idOrgaoJulgadorSelecao=249` devolve o total sem filtro. O
   campo que filtra é `idOrgaoJulgador`, que **não existe no HTML do formulário**
   — ele é criado pelo painel "Filtrar no Resultado" (`refinarResultado()` em
   `js/jurisprudencia.js`) e aceita lista separada por vírgula. Foi essa
   descoberta que viabilizou o `--foro`.

8. **Os autocompletes são sensíveis a acento e exigem 4 caracteres.**
   `camara` devolve vazio; `câmara` devolve as 40+ câmaras. Vale para relator,
   órgão, comarca, classe e assunto. Por isso `-oj` resolve o nome
   **localmente** contra `06-orgaos.json` (aceita sem acento) em vez de depender
   do autocomplete.

9. **A tela abre colapsada.** Só "PESQUISA LIVRE" aparece; data, órgão, âmbito,
   tipo de decisão e número do processo só existem depois de `toggleFiltros()`.
   Quem mapear pelo HTML da primeira tela conclui que o TJPR "só tem busca
   livre" — foi o que aconteceu com o mapeamento antigo.

10. **Datas na ficha do julgado vêm em formato Java**
    (`Tue Mar 31 00:00:00 BRT 2026`), não em DD/MM/YYYY como na listagem;
    `TJPRNavigator.parseDocumento()` converte. A **data de publicação** e a
    **comarca** só existem na ficha, não na listagem.

11. **O inteiro teor não precisa de browser.** Ele já vem no HTML da ficha
    (`/jurisprudencia/j/<id>/<slug>`), dentro de `div#texto<id>` escondido por
    `display:none` — o link "Íntegra do Acórdão" só remove o `display`.
    O crawler anterior abria cada julgado no Playwright e clicava no link.
    Atenção: `/jurisprudencia/j/<id>` **sem** slug devolve 404; use
    `/jurisprudencia/j/<id>/documento`.
    Documentos antigos ou só com imagem têm `texto<id>` vazio →
    `temInteiroTeor: false` (não é erro).

12. **`--escopo` default mudou para `ementa`**, que é o default da tela. O
    crawler antigo mandava INTEIRO TEOR (`-l 2`), o que altera muito o recall.
    A flag legada `-l 1|2|99` continua funcionando e vence `--escopo`.

13. **Um processo tem várias entradas** (uma por documento: acórdão, decisão
    monocrática, dúvida de competência). O identificador do *documento* é o
    `value` do checkbox `idsSelecionados` → campo `id` na saída. A auditoria
    (`--verificar`) confere o `id`, não só o número do processo.

14. **Numeração**: CNJ do TJPR usa `.8.16.` (`cnj.pertenceA(n, 8, 16)`). O acervo
    tem numeração anterior à Resolução CNJ 65/2008, para a qual o dígito
    verificador não fecha e o julgado existe. **DV inválido é aviso, não veto** —
    a prova é `jur tjpr -n <numero>` devolver o julgado.

15. **Sem permalink de busca**: tudo é POST, a URL nunca muda. O link citável é o
    da ficha do julgado (`processoUrl`), que é estável.
    A citação padrão do tribunal (`(TJPR - 3ª Turma Recursal - ... - Rel.: ... -
    J. 24.03.2026)`) vem no campo `citacao` quando se baixa o inteiro teor.

16. **Filtros mapeados mas ainda NÃO expostos no CLI**: relator, comarca, classe
    processual e assunto CNJ. O Navigator já monta os campos (`idRelator`,
    `idComarca`, `idClasseProcessual`, `idAssunto`), mas resolver nome→id exige
    uma ida ao autocomplete e os nomes da base são inconsistentes (com e sem
    cargo, maiúsculas e minúsculas). Ficaram fora para não entregar filtro que
    erra em silêncio — pendências 1 e 3 em
    `human-codegen/TJPR/01-jurisprudencia/10-testes-exploratorios-e-pendencias.txt`.

17. **Não existe separação Cível × Criminal** neste módulo (não há combo de
    área/matéria como no TJGO). Dá para aproximar por órgão
    (`-oj "6ª Câmara Criminal"`) ou pelo assunto CNJ.

18. **Sem bloqueio algum**: nenhum Cloudflare, Turnstile ou captcha; nem para
    buscar, nem para baixar inteiro teor. Só itens em segredo de justiça geram
    registro de auditoria do lado do tribunal (o filtro
    `segredoJustica=pesquisar com` é o default).
