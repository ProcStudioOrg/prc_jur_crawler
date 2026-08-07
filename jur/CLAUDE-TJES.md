# TJES — Tribunal de Justiça do Espírito Santo

**Status: 🟢 OK** — API REST pública, HTTP direto, sem browser, **sem captcha em etapa
nenhuma**. Ementa e inteiro teor já vêm na busca. Mapeado em 07/08/2026.

- **Portal:** https://sistemas.tjes.jus.br/consulta-jurisprudencia/ (SPA Vue 3 + Vite)
- **API:** `https://sistemas.tjes.jus.br/consulta-jurisprudencia/api/{cores,facets,search}`
- **Mapeamento:** [`human-codegen/TJES/01-consulta-jurisprudencia/`](human-codegen/TJES/01-consulta-jurisprudencia/)
- **Comando:** `./bin/jur tjes`

## Escopo — **o único tribunal do repo com 1º grau**

Cinco acervos, **2.212.794 documentos** (medido em `/api/cores` em 07/08/2026):

| `--acervo` | Aba na tela | Documentos | Datas que tem |
|---|---|---|---|
| `pje1g` | 1º Grau PJe | **1.509.942** | só juntada |
| `pje2g` *(default)* | 2º Grau PJe | 219.643 | só juntada |
| `pje2g-mono` | 2º Grau Monocrático PJe | 96.869 | só juntada |
| `fisicos` | 2º Grau - Físicos (legado) | 326.849 | **julgamento + publicação** |
| `turmas` | Turmas Recursais - Projudi | 59.491 | **julgamento** |

✅ **A base está CORRENTE**: o documento mais recente do `pje1g` é de **07/08/2026 03:42**
— de hoje. Distribuição por ano no `pje2g`, base inteira: 2023 = 40.633, 2024 = 51.682,
2025 = 58.757, 2026 = 42.441 (até 07/08). Crescente, sem congelamento.

⚠️ Não cobre o que não está nesses cinco acervos. Matéria federal com origem no ES → `trf2`.

## Uso

```bash
# 2º grau, o default
./bin/jur tjes -q "usucapião AND posse" -m 2

# 1º grau — 1,5 milhão de sentenças, o maior acervo
./bin/jur tjes -q "\"dano moral\" AND consumidor" --acervo pje1g -m 2

# Turmas Recursais (Projudi, acervo legado)
./bin/jur tjes -q "usucapião" --acervo turmas

# Justiça Comum × Turma Recursal dentro do 2º grau do PJe
./bin/jur tjes -q "dano AND moral" --origem comum
./bin/jur tjes -q "dano AND moral" --origem turmas

# combos com contagem, por acervo
./bin/jur tjes --acervo pje2g --listar-filtros
./bin/jur tjes --listar-acervos

# consulta por número (é isto que o `verificador` usa)
./bin/jur tjes -n "5007137-47.2022.8.08.0011"

# inteiro teor em disco (não faz request extra — já veio na busca)
./bin/jur tjes -q "usucapião" -m 1 --fetch-inteiro-teor --verificar 5
```

---

## 🔴 RESSALVAS — leia antes de montar qualquer comando

### 1. O espaço entre termos é **OR**, não AND

Provado por aritmética exata no `pje2g`: `usucapião` = 1.574, `posse` = 49.466,
`usucapião AND posse` = 1.251, e **1.574 + 49.466 − 1.251 = 49.789**, que é exatamente
o resultado de `usucapião posse`.

Query de duas palavras devolve a **união**. O número grande é o segundo termo, não
abundância de jurisprudência. **Use `AND` para exigir os dois.** O crawler avisa.

### 2. Os operadores são os **INGLESES** — e os portugueses **inflam**

| Funciona ✅ | Não funciona ❌ |
|---|---|
| `AND` (1.251), `NOT` (323), `OR`, `"frase exata"` (445), curinga `*` (1.595) | `E`, `OU`, `ADJ` — **ignorados** (49.789, idêntico ao espaço) |
| | `NAO` — **INFLA** para 52.139 |
| | `PROX` — **INFLA** para 50.577 |

🔴 **`NAO` e `PROX` não zeram, inflam.** Zero é sintoma visível; inflar não é — 52.139 se
lê como "tema vastíssimo". `NOT` funciona e é exato (1.574 − 1.251 = 323).

⚠️ **É o inverso do TJPE** (onde `E`/`OU`/`NAO`/`PROX` funcionam e os ingleses enganam) e
igual ao TJBA. Não herde de nenhum dos dois.

✅ **NÃO avise sobre acento**: o índice normaliza (`usucapiao` = `usucapião` = 1.574).

### 3. 🔴 `-di/-df` filtram **DATA DE JUNTADA**, não data de julgamento

Nos três acervos do PJe **não existe data de julgamento nem de publicação**. O único campo
de data é `dt_juntada` — quando o documento foi anexado aos autos.

🔴 **E a tela do tribunal exibe esse mesmo campo rotulado "Julg:".** Medido: o card do
processo `5007137-47.2022.8.08.0011` mostra "Julg: 15/05/2024", e o `dt_juntada` do
documento é `2024-05-15T21:57:47.315Z`. **É o mesmo valor com outro nome.**

**Nunca cite a data que o portal chama de "Julg:" como data de julgamento do acórdão.**
Só os acervos `fisicos` e `turmas` têm `data_julgamento` de verdade — e neles a API **não
oferece filtro por ela** (`-di/-df` são ignorados, e o crawler avisa).

✅ Não há teto de intervalo (1900→2100 responde) e não há data-sentinela.

### 4. 🔴 Um filtro de data que **não exclui nada** derruba a contagem em 42%

| Query | Total |
|---|---|
| `dano moral` | **106.282** |
| `dano moral` + `-di 01/01/1900 -df 01/01/2100` | **61.480** |
| `dano moral` + ordenação | 106.282 |

O intervalo 1900→2100 não exclui um único documento, e mesmo assim a contagem cai. **Na
presença de um filtro de data o conectivo implícito vira AND.**

**Consequência:** contagem **com** data **não é comparável** com contagem **sem** data,
a menos que a query traga operador explícito. Escreva `AND`/`OR` e o problema some. O
crawler avisa. *(A causa interna não foi isolada — o medido é o efeito.)*

### 5. Justiça Comum × Turma Recursal — `--origem`, e aqui **compõe**

Só nos acervos `pje2g` e `pje2g-mono`. Medido, base inteira: Tribunal de Justiça 141.155 +
Turma Recursal 78.488 = **219.643 = total, exato**. E compõe **com termo** também
(`usucapião`: 1.552 + 22 = 1.574 ✅) — diferente do TJPE e do TJBA.

⚠️ **A proporção depende muito do tema:** em `usucapião` a Turma Recursal é 1,4%; em
`dano AND moral` é **67%** (39.118 × 19.276 — o dobro da Justiça Comum). **Em matéria de
consumo, ofereça as duas.**

⚠️ Para as **Turmas Recursais do Projudi** (acervo legado, 59.491 docs) o caminho é
`--acervo turmas`, não `--origem turmas`. São bases diferentes.

### 6. ⚠️ O default da API é o **menor** acervo do PJe

Omitir `core` na API cai em `pje2g_mono` (96.869 docs), porque é a aba ativa da tela. Quem
chamar a API na mão sem `core` mede o acervo errado achando que mediu o principal. O
crawler manda `core` sempre; o default do CLI é `pje2g`.

### 7. 🔴 **NÃO EXISTE PERMALINK**, e consultar por `q` traz lixo citacional

A SPA vive toda em `/consulta-jurisprudencia/`: a URL **não muda** ao buscar nem ao abrir um
documento. Nunca invente link de acórdão do TJES.

A verificação é por reconsulta: `./bin/jur tjes -n "<nº>"`, que usa o parâmetro
`nr_processo`. Medido para `5007137-47.2022.8.08.0011`:

| Forma | Resultado |
|---|---|
| `nr_processo=<com máscara>` | **1** ✅ |
| `q=<com máscara>` | 31 ❌ |
| `q="<com máscara>"` | 2 ❌ — o 2º apenas **cita** o número no corpo |
| `q=<sem máscara>` | 0 ❌ |

🔴 O CNJ é tokenizado no campo de texto. **Buscar julgado por `q` devolve processos que só
mencionam o número.** ⚠️ O campo quer a **máscara** — o oposto do TJPE.

⚠️ **O nº do processo NÃO identifica o julgado**: o campo que identifica é `id`, e ele é
por acervo. Um processo tem vários documentos.

### 8. ⚠️ Cinco acervos, **quatro schemas** — e o 1º grau não tem ementa

| conceito | `pje1g` | `pje2g` / `pje2g-mono` | `fisicos` | `turmas` |
|---|---|---|---|---|
| processo | `nr_processo` | `nr_processo` | `numero_processo_legado` | `num_processo` |
| magistrado | `magistrado` | `magistrado` | `nome_desembargador` | `nome_juiz` |
| **ementa** | **não existe** | `ementa` ✅ | **não existe** | `cont_ementa` |
| inteiro teor | `inteiro_teor` | `acordao` | `conteudo_decisao_html` | **não existe** |
| data julgamento | não existe | não existe | ✅ | ✅ |

⚠️ **O 1º grau (1,5 mi de docs) e os físicos não têm ementa** — só o texto integral. E as
**Turmas Recursais do Projudi têm só ementa**, sem inteiro teor. O `TJESCrawler` normaliza
tudo, mas o campo vazio continua vazio: não apresente inteiro teor como ementa.

⚠️ **A mesma classe existe em várias grafias no índice** (`APELAÇÃO CÍVEL` 55.407 ×
`Recurso Inominado Cível` 46.974 × `RECURSO INOMINADO CÍVEL` 29.907, e valores com espaço
no início). Filtrar por `-c` com uma grafia perde as outras.

### 9. ✅ Ementa e inteiro teor vêm de graça, sem captcha

Não há captcha, login, WAF nem rate limit observado (~120 requisições seguidas). A cadeia
TLS é completa (diferente do TJPE). `--fetch-inteiro-teor` só **grava em disco** — não faz
request extra.

Tamanhos típicos no `pje2g`: ementa ~2.976 chars, `acordao` ~18.562 chars.

### 10. ⚠️ Zeros e erros silenciosos medidos

- Valor de filtro inexistente (`--origem` com nome errado, órgão inventado) → **0 com
  HTTP 200**.
- `q=` **vazio** → `total=0`; **omitir `q`** → acervo inteiro. São coisas diferentes.
- ✅ `core` inválido, ou `sort=dt_juntada` num acervo legado → **HTTP 500 com mensagem
  explícita do Solr** (`sort param field can't be found: dt_juntada`). Erro visível, não
  zero silencioso — ao contrário dos casos acima.
- `sistemas.tjes.jus.br/` na **raiz** devolve **503**; o path do módulo responde 200.
  Um 503 na raiz não diz nada sobre o módulo.

### 11. ✅ Paginação exata e estável; total **exato**, não saturado

- `per_page` **sem teto medido**: 5.000 responde e devolve o resultado inteiro. O crawler
  usa 100.
- Página além do fim devolve `docs: []` com o `total` correto (não erra).
- **Estabilidade: 3/3 requisições da mesma página devolveram os mesmos 10 ids**, sem
  `sort` e com `sort`. Não há o problema de dessincronização do TJDFT/TJRJ.
- **Total é exato**, não saturado: contagens como 1.574, 106.282, 42.441 — nada travado em
  número redondo. Não há teto de contador nem de janela.

---

## Passo 0 — o que se procurou e **não** existe

`dadosabertos.tjes.jus.br`, `api.tjes.jus.br`, `jurisprudencia.tjes.jus.br`,
`projudi.tjes.jus.br` e `esaj.tjes.jus.br` são **NXDOMAIN**. `/dados-abertos` e
`/transparencia/dados-abertos` no portal dão **404**.

⚠️ **Swagger é falso positivo aqui:** `/consulta-jurisprudencia/{swagger-ui.html,v3/api-docs}`
respondem **HTTP 200 com 749 bytes**, que é o `index.html` do SPA. Confira o tamanho antes
de comemorar.

✅ **Não há vhost curinga** (`/path-inventado-9z` → 404 real, md5 distinto da home) — a
armadilha do TJAC/TJAL não se repete.

⚠️ `/api/cores` **vaza o endereço interno do Solr** (`http://172.27.208.227:8080/solr/…`).
IP privado, inalcançável de fora, **não acessado**. Registrado como fato de arquitetura.

## Pendências declaradas

- Os combos (órgão, magistrado, classe, assunto) foram enumerados **só no `pje2g`**. O
  `pje1g` tem `comarca`, que não existe no 2º grau, e **não foi enumerado**.
- `-c` (classe) e `-a` (assunto) estão expostos como flags mas **não foram provados por
  contagem**.
- A causa interna do §4 (filtro no-op que muda a contagem) **não foi isolada**.
- Os combos listam as **100 opções mais frequentes**, não todas — a API aceita outros
  valores, mas não há endpoint que devolva a lista completa.
