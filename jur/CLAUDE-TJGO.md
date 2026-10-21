# TJGO — Tribunal de Justiça de Goiás

Comando: `./bin/jur tjgo` · Stack: `src/TJGOCrawler.js` + `src/TJGONavigator.js` +
`src/TJGOChecker.js` · Testes: `node src/TJGOTestes.js` · Verificação: `skills/TJGO-VERIFICACAO.md`

## Sistema alvo

O TJGO tem **três** sistemas de jurisprudência (mapeamento em `human-codegen/TJGO/`):

1. **PROJUDI — Novo Módulo de Pesquisa de Jurisprudência** ← **implementado aqui**
   `https://projudi.tjgo.jus.br/ConsultaJurisprudencia`
2. Jurisprudência Antiga (módulo legado) — não implementado
3. Jurisprudência Administrativa (Órgão Especial / Conselho Superior) — não implementado
   (o link do Conselho Superior estava em branco no mapeamento de jul/2026)

**Status atual:** 🔴 **sem-acesso desde out/2026 — a busca passou a exigir Cloudflare
Turnstile** (ver ressalva 00). Até 27/08/2026 era 🟡 busca funcional, com campos reduzidos
após mudança de markup.

**Sem browser** (enquanto valia): o formulário aceitava POST direto (charset ISO-8859-1) e o
Cloudflare Turnstile **não era exigido para a busca** — só para baixar o arquivo
original de um ato. Cada resultado já traz o **texto completo da decisão**,
então `--fetch-inteiro-teor` grava os .txt sem novo acesso à rede.
Flags `-v/--headed` são ignoradas.

## 🔴 Ressalva 00 — a busca exige Turnstile desde out/2026 (BRU-99)

O smoke de 19/10/2026 caiu em `success:true` com **0 resultados** (estava ok em 27/08).
Diagnóstico de 21/10/2026, classe **C — bloqueio** (não é filtro nem encoding):

- `./bin/jur tjgo -q "dano moral"` zera **sem período, com período e com termo alternativo**
  (`licitação`). Zero em três eixos não é zero legítimo.
- O POST da busca (`PaginaAtual=2`, mesmos campos de sempre) responde **HTTP 200 com a
  própria tela do formulário** (≈39 KB, campos ecoados), **sem o painel de resultados** —
  nem "N resultados encontrados", nem "Nenhum resultado". Dá no mesmo com
  `g-recaptcha-response` vazio, com token falso e com `JSESSIONID` colhido por GET antes.
- A tela mudou: `js/ConsultaJurisprudencia.js?v=0.0.7` ganhou `aguardarBotaoBuscarAtivo()`;
  `submitForm()` só envia depois que o callback do Turnstile (sitekey
  `0x4AAAAAABeYdOewv6AT0dzB`) habilita o `#btnBuscar`. Print:
  [`01.15-turnstile-na-busca.png`](human-codegen/TJGO/01-projudi/01.15-turnstile-na-busca.png)
  — widget em "Verificando..." acima do botão Consultar. Em headless ele **não** emite token.
- O que **continua livre**: as lupas AJAX (`?AJAX=ajax&Passo=1&PaginaAtual=1802...`
  respondem JSON) e, portanto, `--listar-*`, `--unidades`, `--magistrados`.

As três perguntas do `jur-fixer` §4: **o que bloqueia?** Cloudflare Turnstile no submit da
busca (antes era só no download do original). **A busca passa sem resolver?** Não.
**O download passa?** Não (já não passava).

O `TJGONavigator.exigirPainelDeResultados()` agora lança um erro explícito quando o servidor
devolve o formulário sem painel — **zero por bloqueio não vira "0 resultados"**. Não
automatizamos captcha; o catálogo marca `sem-acesso`. Alternativas: matéria federal com
origem em GO → `trf1`; trabalhista → `trt18`. Se o TJGO liberar a busca de novo, o smoke
volta a `ok` sozinho — aí remova o `Object.assign(JURISPRUDENCIA.TJGO, ...)` do
`cobertura/build.js` e rode `npm run docs`.

## Exemplos

```bash
# Busca simples (aspas duplas = frase exata; palavras soltas = E implícito)
./bin/jur tjgo -q '"auxílio-acidente"' -m 2

# Juizados vs Justiça Comum (desambiguação pelo Órgão/Matéria)
./bin/jur tjgo -q "dano moral" -om "Juizado Especial Cível"
./bin/jur tjgo -q "dano moral" -om "Varas Cíveis"
# Turmas Recursais (2ª instância dos Juizados) é INSTÂNCIA, não órgão:
./bin/jur tjgo -q "dano moral" -i turmas

# Área e instância
./bin/jur tjgo -q "furto" -a criminal -i tribunal

# Acórdãos de câmara com período de publicação
./bin/jur tjgo -q '"dano moral"' -ta Ementa -di "01/01/2026" -df "30/06/2026"

# Unidade específica e magistrado (nomes resolvidos pelas lupas)
./bin/jur tjgo -q "indenização" -u "1ª Câmara Cível"
./bin/jur tjgo -mag "Adegmar José Ferreira" -m 1

# Consulta direta por processo (checker) / auditoria de busca
./bin/jur tjgo -n "5000280-28.2010.8.09.0059" --json
./bin/jur tjgo -q "tema" --verificar 5 --json

# Listagens auxiliares
./bin/jur tjgo --listar-orgaos          # combo Órgão/Matéria completo (44 opções)
./bin/jur tjgo --listar-tipos-ato       # 10 tipos (Acórdão, Ementa, Sentença, ...)
./bin/jur tjgo --unidades "mineiros"    # lupa de serventias (1.744 na base)
./bin/jur tjgo --magistrados "silva"    # lupa de magistrados (46 mil na base)
```

## Flags específicas

| Flag | Valores | Observação |
|------|---------|------------|
| `-i, --instancia` | `todas` `1grau` `turmas` `tribunal` | `turmas` = Turma de Uniformização/Turmas Recursais |
| `-a, --area` | `todas` `civel` `criminal` | |
| `-om, --orgao-materia` | nome ou código | ver `--listar-orgaos`; competências de 1º grau + órgãos do Tribunal |
| `-u, --unidade` | nome da serventia | resolvido pela lupa (primeiro match; exato tem prioridade) |
| `-mag, --magistrado` | nome | resolvido pela lupa; pode combinar com `-u` |
| `-ta, --tipo-ato` | nome ou id | `Acórdão, Decisão, Decisão Monocrática, Despacho, Ementa, Sentença, ...` |
| `-p, --processo` | nº CNJ | filtro dentro da busca (use `-n` para consulta direta) |
| `-di / -df` | DD/MM/YYYY | **data de PUBLICAÇÃO** (único filtro de data do módulo) |
| `--qtde` | 10, 20, 50 | resultados por página (default 50) |
| `--full-text` | | inclui `inteiroTeor` completo no JSON |

## Ressalvas importantes

0. **Markup atualizado em agosto/2026:** os cards atuais fornecem processo,
   arquivo, classe/assunto, serventia, magistrado, texto completo e `Julgado em`
   por atributos `data-*`. Eles não exibem mais tipo do ato nem data de
   publicação no card. O crawler deixa `tipoDocumento` e `dataPublicacao` vazios
   para não inventar metadados; `dataJulgamento` é o campo comprovado. Os filtros
   por tipo e intervalo continuam sendo enviados ao portal, mas a auditoria deve
   validar apenas o conjunto retornado enquanto esses campos não voltarem.

1. **Tipo "Acórdão" quase não existe**: as câmaras publicam o acórdão como tipo
   **"Ementa"** (ex.: 1º sem/2026 — 9.374 Ementas × 4 Acórdãos para "dano moral").
   Para jurisprudência de 2º grau use `-ta Ementa` ou `-i tribunal` sem tipo.
2. **Operadores**: só aspas duplas (frase exata). `E`/`OU`/`NÃO` **não** são
   operadores neste módulo (viram palavra literal). Os operadores E/OU/ADJ/
   NÃO/PROX/$ pertencem ao sistema de Publicações (`/ConsultaPublicacao`),
   que é outro módulo (não implementado).
3. A base cobre **1º grau + 2º grau + juizados** e inclui decisões publicadas
   no mesmo dia (sentenças de hoje aparecem). Volume alto — use datas e `-m`.
4. O campo `ementa` do JSON é o início do texto completo do ato (10k chars);
   com `--full-text` o campo `inteiroTeor` traz o texto integral.
5. `relator`/`magistrado` pode vir vazio em algumas serventias (ex.: UPJ das
   Garantias de Goiânia).
6. Download do **arquivo original** (`TJGONavigator.baixarArquivoOriginal`)
   exige token Turnstile válido — em headless o widget NÃO resolve sozinho.
   Como o texto já vem na busca, isso raramente é necessário.
7. Números CNJ do TJGO usam segmento `.8.09.` (`cnj.pertenceA(n, 8, 9)`).
8. Encoding: POST do formulário em **ISO-8859-1**; query string das lupas em
   **UTF-8**. O navigator já trata os dois — não usar fetch/axios direto.
