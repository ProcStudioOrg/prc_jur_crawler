# TJPE — Tribunal de Justiça de Pernambuco

**Comando:** `./bin/jur tjpe`
**Portal:** https://consultajurisprudencia.app.tjpe.jus.br/
**Acesso:** API REST pública (JHipster), **HTTP direto, sem browser, sem captcha**
**Status:** 🟢 OK — base **corrente**
**Mapeado em:** 07/08/2026 · [`human-codegen/TJPE/`](human-codegen/TJPE/INDEX.md)

## Escopo — o que esta base tem e o que NÃO tem

| | |
|---|---|
| ✅ Tem | 2º grau (Câmaras e Grupos) + **Turmas Recursais / Colégios Recursais** |
| ✅ Cobre | **PJe e Projudi**, acervos eletrônico **e** físico |
| ✅ Ementa | campo próprio, real (~2,4 mil chars de texto útil em acórdão) |
| ✅ Inteiro teor | **já vem na busca** (~10,7 mil chars), sem captcha e sem request extra |
| ❌ Não tem | **1º grau (sentenças)** |
| ❌ Não tem | súmulas / enunciados |
| ❌ Não tem | ementa em decisão monocrática (só o texto da decisão) |

Matéria federal com origem em PE → `trf5`. Trabalhista → `trt6`/`tst`.
Constitucional → `stf`.

## Início rápido

```bash
./bin/jur tjpe -q "usucapião" -m 2
./bin/jur tjpe -q "dano moral" --origem turmas -di "01/01/2026" -df "31/07/2026"
./bin/jur tjpe -n "0056907-55.2023.8.17.2001"          # confirma que o julgado existe
./bin/jur tjpe -q "guarda compartilhada" --fetch-inteiro-teor --output-dir ./saida
./bin/jur tjpe --listar-filtros --json | jq '.relatores[:5]'
```

## Flags

| Flag | Efeito |
|---|---|
| `-q, --query` | termo. Operadores **em português** — ver ressalva 1 |
| `-n, --numero` | consulta direta por nº de processo (dispensa `-q`) |
| `-di / -df` | data de **julgamento** (DD/MM/YYYY) |
| `--origem` | `ambas` (default) · `comum` (2º grau) · `turmas` (Turmas Recursais) |
| `--meio` | `ambos` (default) · `eletronico` · `fisico` — meio de tramitação |
| `-t, --tipo` | `todos` (default) · `acordao` · `monocratica` |
| `-p, --processo` | filtra por nº **dentro** da busca |
| `-r, --relator` | nome exato (veja `--listar-filtros`) |
| `-c / -a` | classe / assunto CNJ, por **código** |
| `--listar-filtros` | despeja relatores (2.076), classes (798), assuntos (4.457), unidades (353) |
| `--verificar [N]` | audita N resultados reconsultando por número |
| `--fetch-inteiro-teor` | grava o inteiro teor (**sem request extra**) |
| `-m, --max-pages` | páginas (100 documentos por página) |

---

## Ressalvas — leia antes de montar a busca

### 1. 🔴 Os operadores são em PORTUGUÊS. Os ingleses ENGANAM.

**É o inverso exato do TJBA.** Medido contra `usucapiao` = 6.266:

| Funciona ✅ | Não funciona 🔴 |
|---|---|
| `E` (4.269) · `OU` (10.000) · `NAO` (2.007) · `NÃO` acentuado (2.007) · `PROX` (13) · `"frase exata"` (930) | `AND` → **0** · `OR` → **1** · `ADJ` → **0** · `NOT` → **1.281** |

⚠️ **`NOT` é o mais perigoso**: não zera — devolve 1.281, que se lê como busca
legítima, quando o operador certo (`NAO`) dá 2.007. O crawler avisa; repasse.

⚠️ **Espaço entre termos é `E` (AND)**, não OU: `usucapiao posse` = `usucapiao E
posse` = 4.269, menor que `usucapiao` sozinho.

⚠️ **`$` é ignorado** (não trunca) e **o curinga `*` devolve MENOS** que o termo
inteiro (`usucapi*` = 921 × `usucapiao` = 6.266) — não é truncamento de índice.

### 2. ✅ NÃO avise sobre acento aqui

O índice **normaliza**: `usucapiao` e `usucapião` dão **6.266** os dois.
(Ao contrário de TJMS e TJBA, onde acento é obrigatório.)

### 3. 🔴 O total satura em 10.000 — não é contagem

`x-total-count` trava em **10.000** e a paginação também para aí.
`recurso`, `posse`, `direito` e `alimentos` batem todos nesse número exato.
O crawler marca `saturado: true` e avisa. **Nunca relate 10.000 como número de
julgados** — refine com `-di/-df` para obter contagem exata.

### 4. 🔴 NÃO EXISTE PERMALINK — e o link da busca entrega ZERO FALSO

- Não há rota por documento (`/api/v1/jurisprudencias/{chave}` → **404**).
- A URL que aparece na barra depois de buscar **restaura o formulário mas não
  executa a busca**. Colada numa aba limpa ela mostra
  **"Nenhum resultado encontrado"** — onde existem 6.266 julgados.

⚠️ **Nunca mande esse link ao usuário como prova.** A verificação de julgado é
por reconsulta: `./bin/jur tjpe -n "<nº>"`.

⚠️ O documento é identificado por **`chave`**, não pelo número do processo — o
mesmo processo tem vários julgados.

### 5. ⚠️ Juizado × Justiça Comum é recorte de CLIENTE

O filtro de órgão da API **não é confiável para agrupar**: alguns ids vazam
outro órgão (o id 7314, de uma Turma Recursal, devolve 3.439 documentos
majoritariamente do "1º Grupo de Câmaras Cíveis"), e as partições somam
8.090 contra um total de 6.266. Por isso `--origem` é aplicado no cliente, pelo
nome do órgão gravado no documento.

**Consequência prática:** com `--origem comum` ou `turmas`, o `totalResults` do
servidor se refere ao acervo **sem** esse recorte. O crawler avisa.

Quanto isso importa depende do tema (medido numa página de 100):

| Tema | Turmas Recursais | Justiça Comum |
|---|---|---|
| `usucapião` | 0,5 % | 99,5 % |
| `dano moral` | **34 %** | 66 % |

→ Em consumo (dano moral, telefonia, banco, plano de saúde, transporte aéreo),
**ofereça as duas**. Em direito real e família, `comum` basta.

### 6. ⚠️ No acervo ELETRÔNICO não existe data de publicação distinta

Medido em 60 documentos de cada origem:

- **`ELETRONICO`**: `dataJulgamento` e `dataPublicacao` são o **mesmo instante**
  (diferem por milissegundos) — 60/60. É carimbo de assinatura/ingestão.
- **`FISICO`**: datas reais e distintas (semanas de intervalo) — 60/60.

Não é a data-sentinela do TJAM (`-di/-df` funciona nas duas pontas), mas
**não prometa ao usuário um recorte por publicação que metade da base não tem**.

### 7. ⚠️ Decisão monocrática NÃO tem ementa

Medido em 40 de cada tipo: acórdão tem `textoEmenta` (39/40) **e** `textoAcordao`
(40/40); monocrática tem **só** `textoDecisao` (40/40) e `textoEmenta` vazio em
todas. Ao apresentar monocrática, diga que o texto é a decisão inteira, não uma
ementa.

### 8. ⚠️ Existem documentos ILEGÍVEIS que derrubam a página inteira

Há registro que faz a API responder **HTTP 500 em qualquer página que o
contenha**. Com `usucapiao`, o documento no offset 186 derruba
`page=1&size=100` de forma determinística (8/8), com as páginas vizinhas verdes.

O crawler detecta o 500, bisecta a página, pula **só** o documento ruim e avisa
quantos se perderam (`documentosIlegiveis` no resumo). É defeito da base, não da
busca — mas **repasse o aviso**, porque o documento pulado não aparece no
resultado.

### 9. ✅ Não há bloqueio nenhum — mas o TLS engana

Sem captcha, sem Cloudflare, sem login, em nenhuma etapa (busca, ementa, inteiro
teor, consulta processual).

⚠️ **`curl` devolve HTTP 000 e isso NÃO é bloqueio.** O servidor apresenta só o
certificado folha e **omite o intermediário** (`Amazon RSA 2048 M01`); o
navegador busca esse intermediário sozinho pelo AIA, `curl` e Node não. O
`TJPENavigator` embute o intermediário e mantém a verificação de TLS **ligada**.
Se algum dia o comando falhar com "cadeia incompleta", o certificado do TJPE
mudou de emissor — atualize a constante, não desligue a verificação.

### 10. ⚠️ Número de processo vai SEM máscara

O campo indexado é o CNJ de 20 dígitos. `0056907-55.2023.8.17.2001` devolve
**0 em silêncio**; `00569075520238172001` devolve 1. O `Checker` normaliza
sozinho — a ressalva vale se você chamar a API na mão.

### 11. ⚠️ 41 documentos estão fora do default do próprio portal

`tipo A` (4.303) + `tipo D` (1.922) = 6.225, contra um total de 6.266. Há 41
documentos cujo `tipoSentenca` não é nem `A` nem `D`, invisíveis tanto ao portal
quanto ao crawler. Não foram identificados.

---

## Vigência da base

✅ **CORRENTE.** Documento mais recente em 07/08/2026: julgado em **01/08/2026**
(275 documentos nesse dia). A ingestão é em lote, então os últimos dias podem
aparecer vazios sem que a base tenha parado.

⚠️ A contagem por ano **satura em 10.000 em todos os anos de 2019 a 2026** — para
medir vigência é preciso janela **diária ou mensal**, não anual.

## Pendências declaradas

1. Os 41 documentos com `tipoSentenca` fora de `A`/`D` não foram identificados.
2. O filtro `orgaoJulgador.in` não foi domado (ver ressalva 5) — a causa do
   vazamento de órgão é desconhecida.
3. `classeCNJ.in` e `assuntoCNJ.in` estão expostos como flags mas **não passaram
   pelo teste de contagem** — não está provado que restringem.
4. Não foi medido se o documento ilegível é sempre o mesmo registro ou um por corte.
5. `numAntigo.equals` (numeração antiga) não foi exercitado com número real.

## Testes

```bash
node src/TJPETestes.js        # 18 testes de integração, contra o site real
node src/TJPETestes.js 6      # só o teste 6
```
