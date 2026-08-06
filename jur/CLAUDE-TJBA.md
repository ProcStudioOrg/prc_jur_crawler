# TJBA — Tribunal de Justiça da Bahia

**Comando:** `./bin/jur tjba` · **Acesso:** GraphQL público, HTTP direto, **sem browser**
**Status:** 🟢 OK · **Mapeado em:** 06/08/2026 · **Mapeamento:** `human-codegen/TJBA/01-jurisprudencia/`

Portal: <https://jurisprudencia.tjba.jus.br> (SPA React)
Porta de fato: `https://jurisprudenciaws.tjba.jus.br/graphql` — **sem autenticação,
introspecção aberta**. É o tribunal de acesso mais limpo do bloco estadual: sem
captcha em lugar nenhum, e o **inteiro teor já vem na busca**.

## Escopo

- **2º grau + Turmas Recursais.** **Não tem 1º grau** (sentenças).
- Acervo de **Projudi e PJe**. 4.008.679 documentos, base **corrente**
  (2026 = 81.737 publicações; documento mais recente 07/08/2026).
- Matéria federal com origem na BA → `trf1`.

## Flags

| Flag | Efeito |
|---|---|
| `-q` | termo. **Operadores: `AND`, `OR`, `NOT`, `"frase exata"`, curinga `*`** |
| `-n` | consulta direta por nº de processo (dispensa `-q`) |
| `-dpi` / `-dpf` | data de **publicação** (DD/MM/YYYY) — é o único par filtrável |
| `--origem` | `comum` (2º grau, default) · `turmas` (Turmas Recursais) · `ambas` |
| `-t` | `todos` (default) · `acordao` · `monocratica` — ⚠️ ver ressalva 3 |
| `-p` | filtra por nº de processo **dentro** da busca |
| `-r` | relator(a) — **NOME exato**, não id (ver ressalva 15) |
| `-oj` | órgão(s) julgador(es) — **ids** separados por vírgula |
| `-c` | classe(s) processual(is) — **ids** separados por vírgula |
| `--listar-filtros` | lista órgãos, relatores e classes disponíveis e sai |
| `-ord` | só `publicacao` — **o TJBA não ordena por relevância** (ver ressalva 16) |
| `--verificar N` | audita N resultados reconsultando por número |
| `--fetch-inteiro-teor` | grava o texto (já veio na busca — **sem request extra**) |
| `-m` | páginas (50 registros/página) |

```bash
./bin/jur tjba -q "usucapião AND posse" -m 2
./bin/jur tjba -q "dano moral" --origem turmas -dpi 01/01/2026 -dpf 30/06/2026
./bin/jur tjba -n "0046401-59.2024.8.05.0080"
```

---

## Ressalvas

### 1. 🔴 Os operadores que a TELA oferece estão quebrados e INFLAM a busca

O portal tem botões `E`, `OU` e `NÃO`. **Nenhum dos três é operador** — são
palavra literal, e como o default é OR eles explodem o resultado:

| Query | Resultado |
|---|---|
| `usucapião` | 2.171 |
| `usucapião E posse` | **3.596.546** (de 4.008.679 na base) |
| `usucapião OU posse` | **2.232.843** |
| `usucapião NÃO posse` | **2.610.979** |
| `usucapião AND posse` | **810** ✅ |
| `usucapião NOT posse` | **1.043** ✅ |

**Use os operadores em inglês.** `PROX`/`ADJ` não existem (`PROX5` é ignorado,
`ADJ` vira palavra). `"frase exata"` e curinga `*` funcionam. O crawler detecta
`E`/`OU`/`NÃO` na query e avisa — repasse o aviso.

### 2. 🔴 Espaço entre termos é OR, não AND

`usucapião posse` = 87.501 = 2.171 + 86.140 − 810 (aritmética exata de união).
Uma query de duas palavras devolve a **união**, então o número grande não é
"muita jurisprudência sobre o tema" — é o segundo termo sozinho. Para exigir os
dois, `AND`. O crawler avisa em query multi-palavra sem operador.

### 3. 🔴 O filtro `-t` (tipo) não compõe com `--origem`

**Sem termo** a partição é exata (3.128.425 acórdão + 880.254 monocrática =
4.008.679 = total). **Com termo ela quebra:** `apelação` dá 211.538 acórdãos +
501.375 monocráticas = 712.913, contra um total real de 539.050. E cruzar com
instância faz a instância ser **ignorada**: `2º grau + monocrática` = 501.375,
exatamente igual a `monocrática` nas duas instâncias.

**Recorte o acervo por `--origem`, que é confiável; use `-t` isolado e com
desconfiança.** O crawler avisa quando `-t` é usado.

📌 Fato colateral: nesta base tipo e instância são quase perfeitamente
correlacionados — **Turma Recursal grava como `ACORDAO`, 2º grau grava como
`DECISAO_MONOCRATICA`**. Em `apelação`, apenas 14 documentos de 2º grau são
acórdão. Então `-t acordao` te dá, na prática, Turma Recursal.

### 4. 🔴 A API repete documentos, e o pior caso é o default

Com `--origem comum` (o default) a API devolve **cada documento duas vezes**:
50 pedidos → 25 hashes distintos, fator **2,00**. Com `--origem turmas` ou
`ambas` o fator é ~1,03. **O `itemCount` do servidor está inflado na mesma
proporção**: os 1.336 de `usucapião` em Justiça Comum correspondem a ~668
documentos reais.

O crawler deduplica por `hash`, mede o fator e publica
`totalDeduplicadoEstimado` + `fatorDuplicacao` no resumo JSON, avisando quando
o fator ≥ 1,15. **Ao relatar contagem do TJBA em Justiça Comum, use o valor
deduplicado, não o total do servidor.**

### 5. 🔴 O campo `ementa` NÃO é ementa — é o inteiro teor

`ementa` e `conteudo` são a mesma string, e o texto é o **documento completo**:
cabeçalho do tribunal, partes, relatório, voto e assinatura.

- ✅ **Bom:** o inteiro teor vem de graça na busca. **Não há captcha em lugar
  nenhum** — ao contrário de TJAC/TJAM/TJAL, onde o download é bloqueado.
  `--fetch-inteiro-teor` só grava em disco.
- ⚠️ **Ruim:** **não existe campo de ementa separado.** Ao apresentar resultado
  do TJBA, diga que o texto é o acórdão inteiro; quem quiser só a ementa tem de
  recortá-la.

### 6. 🔴 Não existe permalink

A URL não muda após a busca (`https://jurisprudencia.tjba.jus.br/` sempre) — a
SPA não tem rota por documento. O `hash` (UUID) identifica o documento na API
mas **não é endereçável**. **Nunca invente link de acórdão do TJBA.**
Verificação é por reconsulta: `./bin/jur tjba -n "<nº>"`.

### 7. ⚠️ Acento é obrigatório — o índice NÃO normaliza

`usucapiao` = **4**, `usucapião` = **2.171**. É o padrão do TJMS e o **oposto**
de TJAC/TJAM/TJAL. Número baixo aqui é quase sempre acento faltando, não
ausência de jurisprudência. O crawler avisa em query sem acento. Caixa é
indiferente.

### 8. ⚠️ Desmarcar as duas instâncias devolve MAIS, não zero

`segundoGrau: false` + `turmasRecursais: false` = 2.173, contra 2.171 com as
duas marcadas. "Nenhum selecionado" é lido como "sem filtro". O crawler nunca
emite esse par, mas quem chamar a API na mão precisa saber.

### 9. ⚠️ Só há filtro de data de PUBLICAÇÃO

`dataJulgamento` vem no resultado mas **não é filtrável** — por isso só existem
`-dpi/-dpf`. ✅ **Não há teto de intervalo** (5 anos responde normalmente): ao
contrário de TJMS/TJAC/TJAM/TJAL, não é preciso fatiar. E **não há
data-sentinela** detectada.

### 10. ⚠️ A base está corrente, mas a curva de UM termo engana

A base cresce até 2026 (81.737 publicações). Mas `usucapião` cai de 503 em 2018
para 0 em 2026 — isso é do termo, não da base. **Antes de diagnosticar
congelamento no TJBA, meça a base inteira**, não a série de um termo (a lição do
TJAM aplicada ao contrário).

### 11. ⚠️ Estourar a paginação dá erro, não página vazia

`pageNumber` acima de `pageCount` responde `Internal Server Error`. O crawler
pára em `pageCount`. Paginação é 0-based, estável (mesma página 2× = mesmos
hashes) e sem sobreposição entre páginas.

### 12. ⚠️ `detalharProcesso` não serve para verificação

O GraphQL expõe `detalharProcesso(numeroProcesso)`, que fala com o sistema de
tramitação ao vivo: **estourou 120 s** e devolveu `Internal Server Error` para um
número que a busca acha instantaneamente. O `TJBAChecker` usa `numeroRecurso`
contra o índice de jurisprudência.

### 13. ⚠️ A lista de "turmas recursais" do próprio tribunal está suja

`findAllOrgaosJulgadoresGroupByInstancia.orgaosJulgadoresTurmaRecursal` inclui
`PRIMEIRA CAMARA CÍVEL`, `QUARTA CAMARA CÍVEL` e
`PRIMEIRA CAMARA CRIMINAL - SEGUNDA TURMA` — câmaras de 2º grau. O **booleano**
`turmasRecursais` é confiável; a **lista de nomes** não é.

### 14. ⚠️ Duas armadilhas de host, e como elas se comportam aqui

- 🔴 **`esaj.tjba.jus.br` está morto e não é a porta.** Resolve
  (168.228.240.160), portas 80/443 aceitam TCP, mas o servidor **derruba o
  handshake TLS** (`errno=104`; curl `(35) Recv failure`). Medido em 31/07/2026 e
  reconfirmado em 06/08/2026. Não importa: o SPA cobre acervo maior.
- 🔴 **`api.tjba.jus.br` NÃO é a API de jurisprudência.** É a API **processual**
  (`/processo/*`, `/serventia/*`, PJe/Projudi), documentada em
  `/v3/api-docs`, e **todo endpoint responde 401**. Não a persiga.
- ✅ **Não há vhost curinga aqui** (a armadilha do TJAC/TJAL não se repete):
  `www.tjba.jus.br/path-inventado-9z` → **404**, diferente da home.
  `dadosabertos.tjba.jus.br` é **NXDOMAIN**.

### 15. 🔴 `-r` (relator) vai por NOME; `-oj` e `-c` vão por ID — e errar dá 0 calado

Assimetria medida na própria API: `orgaos` e `classes` são `[Int]` e querem os
**ids**, mas `relatores` é `[String]` e quer o **nome do relator**. Passar o id
no lugar do nome **devolve 0 sem erro nenhum**:

| Relator | por id | por nome |
|---|---|---|
| MARINEIS FREITAS CERQUEIRA (id 140) | **0** | 279 |
| MOACYR PITTA LIMA FILHO (id 180) | **0** | 313 |
| EMILIO SALOMAO PINTO RESEDA (id 185) | **0** | 4.435 |
| NICIA OLGA ANDRADE DE SOUZA DANTAS (id 229) | **0** | 33.251 |

Use `--listar-filtros` para obter nomes e ids. Os três filtros restringem de
fato, e `orgaos` é **aditivo e disjunto** (órgão 17 = 25, órgão 21 = 16.417, os
dois juntos = **16.442**, soma exata).

### 16. ⚠️ Não existe ordenação por relevância

`ordenadoPor` só aceita `dataPublicacao` na prática. O valor `score` **derruba a
consulta** (`Internal Server Error`), e qualquer valor desconhecido também.
`dataJulgamento` é aceito mas devolve a mesma ordem da publicação. O crawler
força `dataPublicacao` e avisa se `-ord` pedir outra coisa.

---

## Pendências declaradas

1. **Não foi medido se o acervo do ESAJ está indexado** no portal. Os documentos
   inspecionados trazem cabeçalho `PROJUDI`; o `esaj.tjba.jus.br` está
   inacessível para comparação. O TJBA roda três sistemas.
2. **A causa da duplicação não foi isolada** — só o fato de ser específica de
   `segundoGrau` sozinho, com fator ~2. O crawler contorna deduplicando, mas
   isso é remédio, não diagnóstico.
3. **Não há `src/TJBATestes.js`** — o tribunal foi validado pelo checklist de
   aceite e pelo `tests/smoke.js`, mas não tem a suíte de integração com
   sentinelas que TJAM/TJAL têm (as sentinelas naturais aqui seriam: a base
   deixar de ser corrente, o fator de duplicação sumir — o que indicaria
   correção no servidor e tornaria o dedupe desnecessário — e os operadores
   `E`/`OU`/`NÃO` passarem a funcionar).

✅ **Fechadas neste mapeamento:** os filtros `orgaos`/`relatores`/`classes`
foram provados por contagem e expostos no CLI (ressalva 15), e a ordenação foi
verificada (ressalva 16).
