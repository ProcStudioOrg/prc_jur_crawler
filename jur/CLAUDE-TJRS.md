# TJRS — Tribunal de Justiça do Rio Grande do Sul

Comando: `./bin/jur tjrs` · Stack: `src/TJRSCrawler.js` + `src/TJRSNavigator.js` +
`src/TJRSChecker.js` · Testes: `node src/TJRSTestes.js` (`npm run test:tjrs`) ·
Verificação: `skills/verificador/tribunais/tjrs.md` ·
Mapeamento: `human-codegen/TJRS/`

## Sistema alvo

**Um único módulo** de jurisprudência:
`https://www.tjrs.jus.br/buscas/jurisprudencia/?aba=jurisprudencia`

Front jQuery/AngularJS sobre um **Apache Solr**, exposto por um proxy PHP. Não é o
`eproc-jur` do TRF4 — o TJRS tramita em e-Proc, mas a jurisprudência é sistema próprio.

**Sem browser**: o formulário chama um endpoint AJAX que devolve o JSON cru do Solr.
Nenhum Cloudflare/captcha/token, nenhuma sessão, nenhum cookie. `-v/--headed` são ignorados.
Cada resultado já traz o **inteiro teor** — `--fetch-inteiro-teor` grava sem novo acesso à rede.

```
POST https://www.tjrs.jus.br/buscas/jurisprudencia/ajax.php
  action=consultas_solr_ajax&metodo=buscar_resultados&parametros=<form serializado>
```

**Abrangência**: só **2º grau** (não há 1º grau/sentenças) — Tribunal de Justiça,
Turmas Recursais dos Juizados e o acervo histórico do Tribunal de Alçada (extinto em 2005).
Julgados de 1902 até o dia corrente.

## Justiça Comum × Juizados Especiais — a desambiguação

É o filtro `--origem` (combo "Tribunal" do site → `cod_tribunal` no Solr). **Sempre explicite.**

| `--origem` | Combo do site | Solr | O que é |
|---|---|---|---|
| `comum` (**default**) | Tribunal de Justiça do RS | `cod_tribunal:3` | **Justiça Comum**, 2º grau (Câmaras, Grupos, Órgão Especial) |
| `turmas` | Turmas Recursais | `cod_tribunal:6` | **Juizados Especiais**, 2º grau (Turmas Recursais Cíveis, Criminal, Fazenda, Uniformização) |
| `alcada` | Tribunal de Alçada do RS | `cod_tribunal:4` | acervo histórico até 2005 |
| `exceto-turmas` | Todos (exceto Turmas Recursais) | `cod_tribunal:[3 TO 4]` | TJ + Alçada |
| `todas` | Todos | (sem cláusula) | tudo junto |

Contagens medidas nos dois caminhos (navegador **e** endpoint), `"dano moral"`,
julgamento 01/01/2026–30/06/2026:

```
comum  20.023   turmas  3.901   todas  23.924   (= 20.023 + 3.901)
```

Prints: `human-codegen/TJRS/01-jurisprudencia/06.01-resultados-justica-comum.png` e
`06.02-resultados-turmas-recursais.png`.

Cada busca devolve `filtroSolr` no `--json` — é a cláusula que o servidor de fato
montou. Se ela não tem `cod_tribunal:`, o filtro não foi aplicado.

## Exemplos

```bash
# Justiça Comum (default), com período de julgamento
./bin/jur tjrs -q "dano moral" -di "01/01/2026" -df "30/06/2026" -m 2

# Juizados Especiais / Turmas Recursais — mesma busca, outro universo
./bin/jur tjrs -q "dano moral" -di "01/01/2026" -df "30/06/2026" --origem turmas

# Frase exata, exclusão e OU (operadores nativos, dentro do -q)
./bin/jur tjrs -q '"ausência de constrangimento ilegal"'
./bin/jur tjrs -q 'habeas corpus -multa'
./bin/jur tjrs -q 'financiamento OR crédito'

# Buscar no inteiro teor em vez da ementa
./bin/jur tjrs -q "usucapião extraordinária" --escopo inteiroTeor

# Órgão julgador, seção e tipo de decisão
./bin/jur tjrs -q "furto" -s crime -t acordao -oj "Sexta Câmara Criminal"
./bin/jur tjrs -q "consumidor" --origem turmas -oj "Turma Recursal Criminal"

# Relator, classe processual, comarca, data de publicação
./bin/jur tjrs -q "alimentos" -r "Fernando Carlos Tomasi Diniz"
./bin/jur tjrs -q "dano moral" --origem turmas -cp "Recurso Inominado"
./bin/jur tjrs -q "dano moral" --comarca "PORTO ALEGRE" -dpi "01/01/2026" -dpf "31/03/2026"

# VERIFICAR um julgado (consulta direta por número — CNJ ou legado)
./bin/jur tjrs -n "5263607-16.2024.8.21.0001" --json
./bin/jur tjrs -n 70084452564 --json

# Auditar uma busca + gravar inteiro teor
./bin/jur tjrs -q "usucapião" --verificar 5 --json
./bin/jur tjrs -q "usucapião" --fetch-inteiro-teor --output-dir ./resultados/tjrs

# Listagens auxiliares (combos, populados por AJAX)
./bin/jur tjrs --listar-tribunais
./bin/jur tjrs --listar-orgaos --origem turmas       # 23 turmas recursais
./bin/jur tjrs --listar-orgaos --origem comum        # 108 órgãos do TJ
./bin/jur tjrs --listar-relatores --origem comum     # 1.317 nomes
./bin/jur tjrs --listar-classes-cnj
```

## Flags específicas

| Flag | Valores | Observação |
|---|---|---|
| `--origem` | `comum` (default) `turmas` `alcada` `exceto-turmas` `todas` | **a desambiguação** — ver tabela acima |
| `-n, --numero` | CNJ ou nº legado | consulta direta; dispensa `-q`; exit 1 se não encontrar |
| `-di / -df` | DD/MM/YYYY | data de **julgamento** |
| `-dpi / -dpf` | DD/MM/YYYY | data de **publicação** (filtro distinto — as contagens diferem) |
| `--escopo` | `ementa` (default) `inteiroTeor` | qual índice do Solr é consultado |
| `-s, --secao` | `civel` `crime` `ambas` `todas` (default) | |
| `-t, --tipo` | `acordao` `monocratica` `admissibilidade` `duvida` (vírgula) | sem nada = todos |
| `-oj, --orgao` | nome ou código | exige `--origem comum\|turmas\|alcada` (o combo depende do tribunal) |
| `-r, --relator` | nome ou código | casa relator **ou** redator |
| `-cp, --classe-processual` | nome, ex.: `"Apelação Cível"` | ver ressalva 3 |
| `-cc, --classe-cnj` / `-ac, --assunto-cnj` | nome ou código | assunto depende da classe |
| `--comarca` | texto exato MAIÚSCULO, ex.: `"PORTO ALEGRE"` | filtro escondido na tela, ativo no backend |
| `-p, --processo` | nº | filtro **dentro** da busca (use `-n` para consulta direta) |
| `--expressao` / `--qualquer` / `--sem` | texto | os três campos da busca avançada |
| `-ord` | `recentes` (default) `antigos` | ordena por data de julgamento |
| `--verificar [N]` | default 5 | reconsulta N processos e confere o `cod_ementa` |
| `--full-text` | | inclui `inteiroTeor` no JSON (arquivos ficam grandes) |
| `-m, --max-pages` | default 10 | **10 resultados/página, fixo** |

## Operadores de pesquisa — testados um por um

Documentação oficial no modal "Ajuda" (`human-codegen/TJRS/01-jurisprudencia/07-ajuda-oficial.txt`).

| Sintaxe | Funciona? | Evidência (numFound, Justiça Comum) |
|---|---|---|
| `palavra palavra` (E implícito) | ✅ | `financiamento credito` = 165.483 |
| `OR` **em maiúsculas** | ✅ | `financiamento OR credito` = 1.391.325 |
| `-palavra` (exclusão) | ✅ | `habeas corpus` 307.383 → `habeas corpus -multa` 1.859 |
| `"frase exata"` | ✅ | sem aspas 28.694 → com aspas 14.135 |
| `+palavra` (força stopword) | ✅ | `inciso +IV` |
| `E` / `OU` / `NÃO` por extenso | ❌ | viram palavra literal (`usucapiao E extraordinaria` = 4.478) |
| `ADJ` / `PROX` | ❌ | **0 resultados** — viram termo literal |
| `$` / `*` (radical/curinga) | ❌ | são **descartados**: `aliment$` = `aliment*` = `alimentos` = 307.996 |

## Ressalvas importantes

1. **Peso da resposta.** O inteiro teor vem embutido em cada resultado
   (`documento_text`, base64), então **uma página de 10 resultados pesa 200 KB a 11 MB**
   (mediana ~5 MB). É o preço de não precisar baixar nada. Use `-m` baixo; `-m 10` pode
   transferir dezenas de MB.
2. **Encoding do inteiro teor é ISO-8859-1/windows-1252**, mesmo quando o HTML declara
   `encoding="UTF-8"`. Ler como UTF-8 produz `Poder Judici�rio`. O navigator já trata
   (tenta UTF-8 estrito, cai para windows-1252). Não decodifique o base64 por fora.
3. **O filtro "Classe Processual" do site oficial está QUEBRADO.** O combo envia o id
   numérico e o servidor monta `tipo_processo:"397"`, mas o campo Solr guarda texto →
   **0 resultados sempre**. O crawler resolve o nome e envia o *label*, que funciona.
   E o combo é a lista legada, incompleta: `"Recurso Inominado"` (30.793 julgados nas
   Turmas Recursais) **não está** entre as opções — por isso `-cp` aceita texto livre
   e apenas avisa quando o nome não está no combo.
4. **Stemmer português no índice**: singular/plural e flexões já colapsam
   (`alimento` == `alimentos`). Curinga não só é inútil, **atrapalha**: `usucapi*`
   devolve 1.554 contra 34.502 de `usucapiao`.
5. **10 resultados por página, fixo.** `rows=10` é hardcoded no `ajax.php`; mandar
   `rows` no formulário é ignorado. Paginação é pelo campo **`pagina_atual`** (1-based) —
   mandar `start` direto **é ignorado** e devolve a página 1 de novo.
6. **Numeração legada.** Metade do acervo é pré-CNJ (Themis: `70084452564`, `591059829`,
   até números de 5 dígitos). Para esses o DV do CNJ **não se aplica** — o checker devolve
   `formatoCNJ:false` e `numeroValido:null`. Números CNJ do TJRS usam `.8.21.`
   (`cnj.pertenceA(n, 8, 21)`).
7. **Um processo tem várias entradas** (uma por decisão: monocrática, acórdão,
   admissibilidade). O identificador do *documento* é `cod_ementa` → campo `id` na saída.
   A auditoria confere o `id`, não só o número do processo.
8. **Filtros que existem no HTML mas estão comentados na tela** e ainda funcionam no
   backend: `--comarca` (`origem:"..."`), `--ref-legislativa`
   (`referencia_legislativa:(...)`, quase só acervo antigo). Já `filtroAssunto` é
   **quebrado** no servidor (monta um `&fq=` solto e devolve 0) e por isso não é exposto —
   use `-ac/--assunto-cnj`.
9. **`--escopo inteiroTeor` cobre mais e menos ao mesmo tempo**: mais julgados no total
   (50.509 × 34.502 para "usucapiao"), mas os documentos antigos não têm texto anexado —
   a Ajuda oficial avisa isso.
10. **Sem permalink de busca**: a URL nunca muda (tudo é AJAX). O permalink citável é o
    do acompanhamento processual, em `processoUrl`:
    `https://consulta.tjrs.jus.br/consulta-processual/processo/resumo?numeroProcesso=<dígitos>`.
    O link de inteiro teor em DOC (`inteiroTeorLink`) só existe no acervo legado —
    processos do e-Proc vêm `null` (a própria tela avisa: "Processos do EPROC exibem
    Inteiro Teor apenas em formato HTML").
11. **Ordenação**: só por data de julgamento (`recentes`/`antigos`). Não há ordenação por
    relevância exposta. A tela diz "aproximadamente N resultados" — o número é do Solr.
12. **Sem teto técnico de resultados** (diferente do TJPA, que corta em 10.000). Paginação
    profunda testada até `pagina_atual=5000` (start 49.990) sem erro.
