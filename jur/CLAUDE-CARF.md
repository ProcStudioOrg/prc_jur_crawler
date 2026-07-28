# CLAUDE-CARF — Conselho Administrativo de Recursos Fiscais

**Status: 🟢 OK (API direta, sem browser).** Mapeado em 27/07/2026.

A **primeira instância administrativa do repo depois do TCU**: o CARF é a 2ª instância
do contencioso administrativo tributário federal (processo administrativo fiscal — PAF),
julgando recursos contra autuações da Receita Federal. **Não é Judiciário**: a decisão
do CARF esgota a via administrativa; a discussão pode recomeçar do zero na Justiça
Federal (aí é `trf*`).

## Escopo

- **580.565 documentos** (27/07/2026), acórdãos **e** resoluções do CARF e dos antigos
  Conselhos de Contribuintes (1º/2º/3º CC, pré-2009) + Câmara Superior de Recursos
  Fiscais (CSRF). Anos de sessão de ~1993 a hoje (com lixo — ver ressalva 7).
- **Base viva**: sessões de julho/2026 já indexadas.
- Instância única — não há "1º grau" aqui (as decisões das DRJs não entram).
- **Súmulas CARF NÃO estão nesta base** (página estática:
  carf.economia.gov.br/jurisprudencia/sumulas-carf).

## A porta é o próprio Solr — e é oficial

A "Nova Pesquisa de Acórdãos" do portal do CARF é um **302 direto para a UI do Solr**
(`/solr/acordaos2/browse`). O crawler usa o MESMO handler com `wt=json` — mesma
relevância da tela oficial, sem auth, sem cookie, sem captcha, **na busca e no download**.

```
GET https://acordaos.economia.gov.br/solr/acordaos2/browse?q=<termos>&wt=json&rows=N&start=M
```

**Ementa completa, dispositivo E inteiro teor (texto do PDF) já vêm no payload da
busca** — zero request por documento, como TJDFT/TJCE. O PDF original tem permalink
público por documento.

## Exemplos

```bash
./bin/jur carf -q "aposentadoria especial" -m 2
./bin/jur carf -q '"vale transporte"' -di 01/01/2024 -df 31/12/2024
./bin/jur carf -q "PLR" -s "Câmara Superior de Recursos Fiscais"   # só a CSRF
./bin/jur carf -q "omissão de receitas" -ord recentes --full-text
./bin/jur carf -n 13890.000160/2006-17          # consulta por processo (Checker)
./bin/jur carf --decisao 2802-000.639           # consulta por nº do acórdão
./bin/jur carf --listar                          # domínio dos filtros com contagens
./bin/jur carf -q "ágio" -m 1 --fetch-inteiro-teor --pdf   # grava txt + PDF original
```

## Flags específicas

| Flag | O quê |
|---|---|
| `-s, --secao` | Seção de julgamento (7 valores; CSRF = "Câmara Superior de Recursos Fiscais") |
| `--camara`, `--turma` | Câmara (12) e Turma (77) — strings exatas do facet |
| `--materia` | Matéria/tributo (126 valores, com lixo — ver ressalva 8) |
| `-r, --relator` | Relator — string EXATA do facet (use `--listar`) |
| `-di/-df` | Data da **sessão** de julgamento |
| `-dpi/-dpf` | Data de **publicação** (filtro diferente — sessão 2024: 1.022 × publicação 2024: 1.106) |
| `--decisao` | Consulta direta pelo nº do acórdão/resolução |
| `--pdf` | Com `--fetch-inteiro-teor`: grava também o PDF original |

## Ressalvas (todas medidas em 27/07/2026)

1. **`OU`/`OR` NÃO EXISTE.** O handler aceita `OR` e o IGNORA (mm=100% do edismax):
   `vale OR transporte` = `vale AND transporte` = 28.655. Para disjunção, rode uma
   busca por termo e some. O default entre palavras é **E**. Funcionam: `NOT`/`-`,
   `"frase exata"`, `"frase"~N` (proximidade), `*` (curinga). O crawler avisa quando
   vê OU/OR na query. ⚠️ Os operadores do "Guia de pesquisa de acórdãos" oficial
   (`e`, `ou`, `não`, `$`) são da interface ANTIGA (JSF do sincon) — aqui não valem.
2. **O "PDF" vem embrulhado num dump de Postgres.** O corpo servido começa com a
   assinatura binária `PGCOPY` (25 bytes antes do `%PDF`, 4 depois do `%%EOF`) —
   é a coluna bytea servida crua. Leitores de PDF toleram; parser estrito rejeita.
   O `CARFNavigator` fatia `%PDF`…`%%EOF` e entrega PDF íntegro.
3. **`conteudo_txt` tem prefixo Tika.** ~600 chars de metadados até o marcador
   `Conteúdo =>`, e o texto vem cheio de NBSP (`\xa0`) e soft hyphen (`\xad`).
   O Navigator corta e normaliza — não consuma o campo cru.
4. **Números SÓ COM MÁSCARA.** Processo `13890.000160/2006-17` e decisão
   `2802-000.639`; só dígitos devolve **0 em silêncio** (o guia antigo diz que
   aceita sem — nesta base NÃO). O Checker formata sozinho (17 dígitos → máscara
   de PAF; 10 dígitos → NNNN-NNN.NNN). **Não é numeração CNJ** (o Checker não usa
   `src/cnj.js`) e **o DataJud não cobre o CARF** (não é Judiciário).
5. **Sem campo de tipo de documento.** Acórdão e resolução (30.619) têm o mesmo
   padrão de número e o mesmo nome de arquivo; a distinção é o prefixo do
   dispositivo (`ACORDAM` × `RESOLVEM`) — é o que o campo `tipoDocumento` do
   resultado usa.
6. **0,3% sem inteiro teor.** 1.551 docs têm `arquivo_indexado_s:N` (texto do PDF
   não extraído); ementa e dispositivo existem mesmo assim. O crawler avisa.
7. **Lixo de datas na base.** Doc com ano de sessão **19944** vem primeiro no sort
   desc; facets com anos-fantasma ("0001", "1200"). Com `-ord recentes` o crawler
   cerca o range sozinho (`[1970 TO NOW+1YEAR]`).
8. **Facets sujos.** `materia_s` tem números de processo como valor;
   `nome_relator_s` tem 4.325 entradas com grafias duplicadas, "Não Informado"
   (56.614) e "Não se aplica". Filtro exige a string EXATA — use `--listar`.
9. **Nunca use `/select` para busca textual** (sem `df` = HTTP 400; só serve com
   query fielded) **nem o nome de shard** que a action do form vaza
   (`acordaos2_shardN_replica_nM` muda a cada requisição) — sempre o alias
   `/solr/acordaos2/`.
10. O 8º facet da tela, "Decisão", é **inútil** (faceta tokens do texto: "de",
    "por", "votos"…) — não existe como filtro no crawler.

## Limites medidos

- `rows` até **10.000** OK; `start` 500.000 OK; paginação **estável** (mesma página
  3× = idêntica; páginas não se sobrepõem); total **exato** (`numFoundExact:true`).
- Identidade do julgado: campo `id` do índice. Número citável: `numero_decisao_s`.
  Permalink: o PDF (`inteiroTeorLink`), público e sem sessão.

## Arquivos

`src/CARFCrawler.js` + `src/CARFNavigator.js` + `src/CARFChecker.js` +
`src/CARFTestes.js` (11 testes, `node src/CARFTestes.js`).
Mapeamento: `human-codegen/CARF/01-consulta-acordaos/`.

## O que mais existe (não mapeado)

- **Interface antiga** (JSF): `carf.fazenda.gov.br/sincon/public/pages/
  ConsultarJurisprudencia/consultarJurisprudenciaCarf.jsf` — ainda no ar (200),
  mesma base, menos recursos. Módulo secundário.
- **Súmulas CARF e Pareceres Vinculantes** — páginas estáticas do portal.
- API oficial documentada NÃO existe (dados abertos do CARF = PDFs gerenciais;
  sem Swagger; procurado e registrado em 27/07/2026).
