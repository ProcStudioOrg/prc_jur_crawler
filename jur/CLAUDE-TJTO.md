# CLAUDE-TJTO — TJ do Tocantins (`jur tjto`)

Busca na jurisprudência do TJTO pelo portal **Jurisprudência 4.0**, por **HTTP
direto, sem browser**.

- URL: `https://jurisprudencia.tjto.jus.br/consulta.php`
- Mapeamento: [`human-codegen/TJTO/01-jurisprudencia/`](human-codegen/TJTO/01-jurisprudencia/)
- Código: `src/TJTONavigator.js` (HTTP + parser) · `src/TJTOCrawler.js` · `src/TJTOChecker.js`
- Testes: `node src/TJTOTestes.js` (16 testes contra o site real)
- Mapeado em 11/08/2026

Portal **caseiro em PHP 8 sobre Apache Solr** — não é o `eproc-jur` do
TRF4/TJRJ/TJSC, apesar de o TJTO tramitar em e-Proc. **Sem captcha, sem login,
sem token, sem cookie** em etapa nenhuma: busca, ementa e inteiro teor respondem
ao `curl` cru.

## ESCOPO

**2º grau (Câmaras) + Turmas Recursais + 1º GRAU (sentenças)** — 1.102.740
documentos: 250.249 acórdãos, 597.990 decisões monocráticas, 254.501 sentenças.

✅ **É o 4º tribunal do repo com 1º grau** na base de jurisprudência, depois de
TJPB (1.970.661), TJRO (1.926.426) e TJES (1.509.942).

⚠️ **Acórdão existe de 2019 em diante; monocrática e sentença só de 2024.** De
2019 a 2023 o acervo é praticamente só acórdão (2022 tem 38.203 acórdãos contra
388 monocráticas e 18 sentenças). Pedido histórico de sentença tocantinense
**não tem resposta aqui**, e esse zero não é ausência de decisão.

✅ **Base corrente**: ago/2026 (até o dia 11) com 604 acórdãos, 8.943
monocráticas e 2.975 sentenças. Sem defasagem de indexação.

## Uso

```bash
# busca básica (acórdãos, ementa íntegra já vem no resultado)
./bin/jur tjto -q "usucapião" -m 2

# ⚠️ ESPAÇO É OR — para exigir os dois termos use E (ou AND)
./bin/jur tjto -q "dano moral E consumidor"

# sentenças de 1º grau (só o TJTO, TJPB, TJRO e TJES têm isso)
./bin/jur tjto -q "usucapião" -t sentenca

# Juizado Especial / Turma Recursal × Justiça Comum
./bin/jur tjto -q "dano moral" --origem turmas
./bin/jur tjto -q "dano moral" --origem comum

# recorte por data de JULGAMENTO (a base não tem publicação)
./bin/jur tjto -q "usucapião" -di 01/01/2026 -df 31/12/2026

# consulta por número (aceita máscara OU 20 dígitos) e auditoria
./bin/jur tjto -n "0004697-71.2023.8.27.2737" --json
./bin/jur tjto -q "usucapião" --verificar 5

# inteiro teor (1 GET por documento, pelo permalink público)
./bin/jur tjto -q "usucapião" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjto

# as facetas capturadas no mapeamento
./bin/jur tjto --listar-filtros
```

Flags específicas: `-t acordao|monocratica|sentenca` (as 3 abas) ·
`--origem ambas|turmas|comum` · `--instancia todas|1|2` · `--somente-ementa` ·
`-c/-r/-oj/--competencia/--assunto` por **nome exato** da faceta ·
`--ordem RELEV|DESC|ASC` · `--page-size` (default 50).

## Ressalvas — leia antes de montar o comando

### 🔴 1. O ESPAÇO ENTRE TERMOS É **OR**, não AND

Provado por aritmética exata: `usucapiao` = 1.807, `posse` = 29.310,
`usucapiao E posse` = 1.257, e `usucapiao posse` = **29.860** = 1.807 + 29.310 −
1.257. Query de duas palavras devolve a **união** — o número grande é o segundo
termo, não abundância de jurisprudência. **Use `E` ou `AND`.**

### 🔴 2. `NAO` SEM ACENTO NÃO É OPERADOR — e o erro **infla**

`usucapiao NÃO posse` (acentuado) = **550**, a exclusão correta (1.807 − 1.257).
`usucapiao NAO posse` (sem acento) = **30.282** — o `NAO` vira palavra e entra na
união. Não zera, não dá erro: devolve 30 mil, que se lê como "tema vasto".

É o **oposto do TJAC/TJAM/TJAL** (onde só `NAO` funciona) e igual ao TJPI.

| Operador | Vale? | Contagem |
|---|---|---|
| espaço | **OR** | 29.860 |
| `E` / `AND` | ✅ | 1.257 |
| `OU` / `OR` | ✅ | 29.860 |
| `NÃO` (acentuado) / `NOT` | ✅ | 550 |
| `NAO` (sem acento) | 🔴 **infla** | 30.282 |
| `ADJ` / `PROX` | ❌ ignorados | ~29.860 |
| `"frase exata"` | ✅ | 660 |
| `*` e `$` | ✅ curinga | 1.817 |

⚠️ **NÃO avise sobre acento na query** — o índice normaliza (`usucapiao` =
`usucapião` = 1.807). O acento importa **só** para o operador `NÃO`.
✅ O `$` aqui **funciona como curinga** — diferente de TJAC/TJAM (zera), TJAL/TJMT
(degenera) e TJPE (ignorado).

### 🔴 3. Só ACÓRDÃO tem ementa

Sentença e decisão monocrática trazem **a decisão inteira** no lugar da ementa —
cabeçalho, partes, "SENTENÇA"/"DESPACHO/DECISÃO" e o corpo. O crawler marca
`semEmenta: true` nesses dois. **Não apresente esse texto como ementa.**
E os dois vêm **sem relator** — `-r` por nome de pessoa não acha nada em 1º grau.

⚠️ **A aba "Decisões Monocráticas" (597.990, a maior) mistura despacho de mero
expediente com decisão de mérito** — o exemplo dissecado é "Emenda à Inicial",
cujo corpo é "INTIME-SE". Esse total **não é jurisprudência toda**.

### 🔴 4. A base só tem data de JULGAMENTO

O par de datas do documento é (**autuação**, **julgamento**). **Não existe data
de publicação** — nem campo, nem filtro. `-di/-df` filtram julgamento.
**Nunca apresente a data do TJTO como data de publicação.**
⚠️ A citação oficial diz "juntado aos autos em …", que é **juntada**, não
publicação.

### 🔴 5. Juizado × Justiça Comum é `--origem`, e o rótulo engana

A partição é a competência **`TURMAS RECURSAIS`** (20.785 acórdãos na base).
⚠️ **Não confunda com `TURMAS DAS CAMARAS CIVEIS`** (186.534), que é 2º grau
comum: os dois começam por "TURMAS" e são coisas opostas.

Em TO o Juizado é **8,3%** do acervo de acórdãos — padrão TJAL, oposto de TJAC
(2,8× a favor do Juizado), TJAM (7,7×) e TJRO (53%). Em consumo, ofereça as duas.

⚠️ `--origem comum` é recorte de **cliente** (o portal só tem faceta positiva):
o total do servidor **não** reflete esse recorte. O crawler avisa.

⚠️ No TJTO a **Turma Recursal conta como 1º grau**, então `--instancia 1`
mistura Turma Recursal + monocrática de vara + sentença. Para Juizado use
`--origem turmas`, não `--instancia`.

### ✅ 6. Permalink público, citação pronta, sem captcha

`https://jurisprudencia.tjto.jus.br/documento.php?uuid=<uuid>` abre em aba limpa
(confirmado, HTTP 200 sem cookie) e traz o **inteiro teor** (~42 mil chars
úteis). A **citação oficial vem pronta** no campo `rodape_ementa`, sem regex:

> (TJTO, Apelação Cível, 0004697-71.2023.8.27.2737, Rel. ADOLFO AMARO MENDES,
> julgado em 24/06/2026, juntado aos autos em 08/07/2026 15:05:48)

🔴 **O que identifica o julgado é o `uuid`, não o nº do processo** — o
0004697-71.2023.8.27.2737 tem **dois** documentos (1 acórdão + 1 sentença).

### ⚠️ 7. O permalink de BUSCA mente sobre o recorte

A URL de resultado é reutilizável como GET, **mas só o termo sobrevive**: por
GET, todos os filtros são ignorados em silêncio (ver ressalva 8). Ela executa a
busca com o recorte errado. **Nunca mande a URL da busca como prova.**

### ⚠️ 8. Notas técnicas (para quem for mexer no crawler)

- 🔴 **Os filtros só existem no POST.** Por GET, `q` funciona e todo o resto é
  ignorado com HTTP 200. O crawler sempre usa POST.
- 🔴 **`tempo_julgados=pers` destranca o filtro de data.** Sem esse
  parâmetro-companheiro as duas datas são ignoradas em silêncio.
  Formato **DD/MM/YYYY**; ISO é ignorado.
- 🔴 **403 em todo path = User-Agent**, não bloqueio. Sem UA de navegador o
  nginx nega tudo, inclusive `/`.
- 🔴 **`documento.php` é ISO-8859-1**, enquanto `consulta.php` e `ementa.php`
  são UTF-8. Mesmo host, charsets diferentes.
- 🔴 **O teto de `rows` oscila** (é peso de payload): 100 é estável, 150–200
  oscilam, 250+ dão HTTP 500. O erro é honesto, nunca truncagem calada.
- ✅ Total **exato** (sem saturação), paginação **estável** (3/3), **sem teto de
  offset** (start=20.000 responde), **sem vhost curinga**.
- ✅ Filtro de data no-op (1900..2100) devolve o total, e meia ponta funciona.
- ⚠️ **Não existe API pública** — `dadosabertos`/`juris`/`sistemas`.tjto.jus.br
  são NXDOMAIN, `api.tjto.jus.br` não completa conexão, e `/swagger`,
  `/v3/api-docs`, `/dados-abertos` dão 404. ⚠️ Os hosts `eproc1g`/`eproc2g` que
  o `cobertura/tribunais.json` registra são **NXDOMAIN**: o e-Proc vivo é
  `eproc2.tjto.jus.br`.

## Onde mandar o que o TJTO não cobre

- Matéria **federal** com origem no TO → `trf1`
- **Trabalhista** → `trt10` (TO + DF) ou `tst`
- **Constitucional** → `stf`
