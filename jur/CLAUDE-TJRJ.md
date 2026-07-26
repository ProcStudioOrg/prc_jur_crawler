# CLAUDE-TJRJ — TJ do Rio de Janeiro (`jur tjrj`)

Busca na jurisprudência do **e-Proc do TJRJ** por **HTTP direto, sem browser**.
Módulo `eproc-jur`, mesma família do TRF4/TJSC — mas sem o bloqueio F5 do TJSC.

- URL: `https://eproc1g.tjrj.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`
- Mapeamento: [`human-codegen/TJRJ/02-eproc/`](human-codegen/TJRJ/02-eproc/)
- Código: `src/TJRJNavigator.js` (HTTP + parser) · `src/TJRJCrawler.js` · `src/TJRJChecker.js`
- Testes: `node src/TJRJTestes.js` (13 testes contra o site real)
- Verificação antes de citar: [`skills/verificador/tribunais/tjrj.md`](skills/verificador/tribunais/tjrj.md)

## ESCOPO — a ressalva nº 1

A base cobre **só o 2º grau da Justiça Comum no sistema e-Proc** (decisões de ~2023 em
diante, pós-migração): Câmaras de Direito Privado/Público, Seções, Órgão Especial,
Conselho da Magistratura e Núcleos Digitais de 2º grau. O combo Origem da tela tem
**uma única opção** ("TJRJ").

**O que NÃO está aqui:**

| Fora da base | Onde vive |
|---|---|
| Turmas Recursais / Juizados Especiais | eJURIS (legado) — combo "Origem: Turma Recursal" |
| Acervo histórico (pré-migração, eJUD) | eJURIS (legado) |
| Tribunais de Alçada extintos | eJURIS (legado) |

O eJURIS está **mapeado** (`human-codegen/TJRJ/01-ejuris/`, ASP.NET WebForms com
operadores E/OU/ADJ/NÃO/PROX/$) mas **sem crawler**. Pedido de Juizado Especial
fluminense → diga que a cobertura automática não alcança e aponte
https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx.

## Uso

```bash
# busca básica (ementa, acórdãos+monocráticas, 10/página)
./bin/jur tjrj -q '"dano moral"' -m 3

# com recorte de datas de julgamento e só acórdãos
./bin/jur tjrj -q '"superendividamento"' -di 01/01/2026 -df 30/06/2026 -t acordao

# filtros avançados (o value é o LABEL do combo; trecho único resolve)
./bin/jur tjrj -q "consumidor" -oj "6ª Câmara de Direito Privado" -c "Agravo de Instrumento"
./bin/jur tjrj --listar-combos          # labels aceitos (39 órgãos, 32 classes, 207 relatores)

# consulta direta por nº de processo (Checker) e auditoria de lote
./bin/jur tjrj -n "0837546-34.2023.8.19.0038" --json
./bin/jur tjrj -q "tema" --verificar 5 --json

# inteiro teor (GET direto, HTML ~1 MB por julgado, texto extraído p/ .txt)
./bin/jur tjrj -q "tema" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjrj
```

Flags específicas: `--escopo ementa|inteiroTeor` (rdoCampo E/I) · `-t todas|acordao|monocratica`
· `-oj/-r/-c` por label ou trecho · `-ord recentes|antigos` · `--precedente-relevante`
· `-dpi/-dpf` datas de publicação (filtro separado do de julgamento).

## Operadores (testados em 24/07/2026, contagens comparadas)

| Operador | Funciona? | Exemplo |
|---|---|---|
| `"expressão exata"` | ✅ | `"dano moral"` → 3.929 na ementa |
| `E` | ✅ restringe | `crime e "dano moral"` → 17 |
| `OU` | ✅ amplia | `drogas ou entorpecentes` → 17 (≥ `drogas` sozinho, 12) |
| `NÃO` | ✅ restringe | `"dano moral" não consumidor` → 664 |
| `PROX` | anunciado na tela; não medido isoladamente | `aposentadoria prox contribuição` |
| `*` (prefixo) | ✅ | `embarg*` → 1.614 |

## Ressalvas técnicas

1. **Charset ISO-8859-1** na página e nas respostas. O servidor tolerou UTF-8 no corpo
   nos testes (mesma contagem), mas o Navigator envia **latin-1** (o que a tela envia)
   para não depender dessa tolerância. Não "conserte" isso para UTF-8.
2. **Ordenação com desempate instável no servidor.** A mesma página pedida duas vezes
   pode divergir em 1–2 documentos; a fronteira entre páginas desliza e a paginação
   repete/pula itens. O Navigator já envia `selOrdenacao` explícito (reduz, não zera) e
   o Crawler **deduplica por id** — por isso `-m 2` pode devolver 18–20 únicos, não 20.
   Não é bug do crawler.
3. **Total e paginação em hidden fields** (`hdnTotalResultado`, `hdnTotalPaginas`,
   `hdnPaginaAtual`). O texto "de 1000 documentos" que aparece no HTML é de outro
   contador (agrupamento) — ignore, use os hidden.
4. **Página fixa em 10 resultados** — não há `selTamanhoPagina` neste tribunal
   (diferente do TJSC). Buscas amplas pedem `-m` maior.
5. **Combos avançados usam o label como value** (`selOrgao[]=6ª Câmara de Direito
   Privado`). O Crawler resolve trechos contra a lista viva do AJAX
   (`ajax_carregar_listas_pesquisa`) e **aborta com erro** em caso de ambiguidade —
   melhor que filtro ignorado em silêncio.
6. **Inteiro teor**: GET no `data-link` do card (`download_inteiro_teor&
   id_jurisprudencia=<id>`), sem sessão; o parâmetro `termosPesquisados` é a query em
   base64 e serve só para o destaque visual. Resposta é HTML (~1 MB).
7. **Rótulos flexionam gênero** (RELATOR/RELATORA) — o parser casa por prefixo. Se o
   tribunal criar rótulo novo, é aqui que quebra primeiro.
8. `chkAgruparResultados` é o default da tela e o Navigator o espelha; desligue com
   `agrupar: false` só em depuração.

## Desambiguação obrigatória do repo (Justiça Comum × Juizados)

Neste tribunal ela é **estrutural**: a base do e-Proc é 100% Justiça Comum. Não há flag
`--foro`/`--origem` porque não há o que separar — a resposta correta para Juizados é a
ressalva de escopo acima, nunca um resultado desta base rotulado como Turma Recursal.
