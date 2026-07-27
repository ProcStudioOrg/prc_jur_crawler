# TJCE — Tribunal de Justiça do Ceará

**Escopo:** CE · **Status:** 🟢 OK — **API direta, sem browser**
**Portal:** SJURIS — https://sjuris.tjce.jus.br/
**API:** `POST https://gateway.tjce.jus.br/sjuris/api/v1/jurisprudencia/?page=N&size=M`
**Crawler:** `src/TJCECrawler.js` + `TJCENavigator.js` + `TJCEChecker.js` + `TJCETestes.js`
**Mapeamento:** [`human-codegen/TJCE/`](human-codegen/TJCE/INDEX.md) · mapeado em 27/07/2026

Acervo medido: **813.941 documentos** — 565.878 acórdãos, 247.991 decisões
monocráticas, 72 súmulas. Por base: 622.257 de 2º grau e 191.688 de Turma
Recursal. Cobre **SAJ e PJe juntos**. Não tem 1º grau (sentenças).

## Uso

```bash
./bin/jur tjce -q "aposentadoria por invalidez"
./bin/jur tjce -q "usucapião extraordinária" -di 01/01/2025 -df 31/12/2025
./bin/jur tjce -q "dano moral" --base turmas          # Juizado Especial
./bin/jur tjce -q "auxílio-acidente" --fetch-inteiro-teor
./bin/jur tjce -n "0169160-51.2018.8.06.0001"         # consulta por processo
./bin/jur tjce --listar                                # domínio dos filtros
```

## Flags específicas

| Flag | Valores | Nota |
|---|---|---|
| `-b, --base` | `comum` (default), `turmas`, `todos` | **Justiça Comum × Juizado.** Ver ressalva 1 |
| `-t, --tipo` | `ambos` (default), `acordao`, `monocratica`, `sumula` | Ver ressalva 2 |
| `--origem` | `ambas` (default), `pje`, `saj` | Sistema de tramitação de origem |
| `-di/-df` | DD/MM/YYYY | **Só data de julgamento** — não há filtro por publicação |
| `-r`, `-oj`, `-c` | nome exato | Use `--listar` para o domínio |
| `-ord` | `relevancia` (default), `recentes` | |
| `--full-text` | | Inclui o inteiro teor no JSON — **sem request extra** |
| `--datajud` | com `-n` | Confirma pelo DataJud do CNJ (prova o processo, não a decisão) |

`-m` conta páginas de **20** resultados (teto da API).

## Ressalvas

**1. `--base` é obrigatório para separar Juizado de Justiça Comum.**
O default `comum` traz só 2º grau. Turma Recursal é `--base turmas`; `--base todos`
mistura os dois. Medido, mesma query: comum 4.869 × turmas 1.003 × todos 5.872.

**2. ⚠️ DECISÃO MONOCRÁTICA VEM SEM EMENTA — sempre.**
No SJURIS só ACÓRDÃO e TURMA RECURSAL têm ementa indexada. As 247.991
monocráticas têm o campo `ementa` vazio. É a mesma armadilha do TJMG, com uma
diferença importante: **aqui o inteiro teor está no mesmo objeto** (~16.000
chars), então o documento não se perde. O crawler marca `temEmenta: false` e
emite aviso na saída (`avisos[]` no modo `--json`) — **repasse o aviso ao
usuário** em vez de reportar "sem ementa" como se fosse "sem conteúdo".
Para citar monocrática, use `--full-text` ou `--fetch-inteiro-teor`.

**3. ⚠️ NÃO EXISTE PERMALINK.** O SJURIS vive inteiro em `/tela-consulta`; o card
não tem link e não há rota por documento. `processoUrl` e `inteiroTeorLink` saem
`null` de propósito. **Nunca invente uma URL de julgado do TJCE.** A citação se
verifica por reconsulta (`-n <número>`), não por link — diga isso ao usuário.

**4. O nº do processo não identifica o julgado.** Um processo costuma ter vários.
A identidade é o campo `id`, no formato `<numeroProcesso>_<idDocumento>`. Exemplo
real: o processo `0169160-51.2018.8.06.0001` tem dois julgados na base, um
acórdão de 11/02/2026 e uma monocrática de 08/06/2026.

**5. O inteiro teor e o PDF já vêm na busca.** Nada de request por documento:
a resposta traz `conteudo` (texto puro, ~29 KB) e `pdfAutenticadoBase64` (o PDF
autenticado). `--fetch-inteiro-teor` só grava em disco.

**6. Ementa de Turma Recursal é curta** (732 × 3.339 chars do acórdão). Para tese
jurídica em matéria de Juizado, baixe o inteiro teor.

**7. Teto de 20 resultados por página.** Acima disso a API devolve 504 sempre
(testado até 1000). O crawler capa em 20 e avisa. Paginação profunda além de
10.000 documentos devolve erro de shard do Elasticsearch.

**8. Paginação é estável** — medido duas vezes, 60/60 documentos idênticos posição
a posição. Ao contrário de TJRJ/TJMG/TJDFT, aqui não é preciso desempate.

**9. 504 esporádico** mesmo dentro dos limites. O Navigator faz 3 tentativas com
backoff de 3s/6s/9s. Um 504 isolado é ruído, não quebra.

**10. `--listar` mostra classes duplicadas por caixa** ("Ação Direta de
Inconstitucionalidade" 101 e "AÇÃO DIRETA DE INCONSTITUCIONALIDADE" 24). São
entradas distintas do índice — filtrar por uma não traz a outra.

## Por que SJURIS e não o e-SAJ

A página oficial de jurisprudência do TJCE linka os dois portais, e o rótulo do
SJURIS diz "PJe" — o que sugere, erradamente, que ele cobriria só o PJe.
**Não é o caso: o SJURIS indexa SAJ e PJe.** Medido na mesma query:
PJE 1.691 + SAJ 3.178 = 4.869 sem filtro de origem.

O e-SAJ (`esaj.tjce.jus.br/cjsg/consultaCompleta.do`) funciona, mas é pior nos
dois eixos: cobre só o SAJ **e exige browser**, porque a busca carrega um token
de reCAPTCHA v3 gerado no cliente. Sem o token o servidor responde HTTP 200 com
o formulário vazio de volta, **sem erro nenhum** — quem não comparar o tamanho
da resposta conclui que a busca não achou nada. O Playwright headless passa no
v3, então o e-SAJ serve de plano B se o SJURIS cair; não é o plano A.

## API oficial: procurada, não existe para jurisprudência

- `https://www.tjce.jus.br/transparencia/dados-abertos/` — existe, mas é API de
  **transparência** (orçamento, pessoal, estatística), não de jurisprudência.
- `https://www.tjce.jus.br/estatistica/api-publica/` — a página "API Pública" do
  TJCE aponta para o DataJud do CNJ, não para base própria.
- `dadosabertos.tjce.jus.br` não resolve; não há Swagger/OpenAPI publicado.
- **DataJud** (`api_publica_tjce`) responde e cobre G1 e G2 — usado como fallback
  do Checker com `--datajud`. É metadado: prova que o **processo** existe, nunca
  que a **decisão** existe.

Logo, a API do SJURIS é `api` (interna, não documentada), descoberta na aba
Network da SPA — não `api-oficial`.

## Verificação

```bash
./bin/jur tjce -n "0169160-51.2018.8.06.0001"            # existe? quais julgados?
./bin/jur tjce -q "termo" --verificar 5                  # auditar a amostra
node src/TJCEChecker.js 0169160-51.2018.8.06.0001        # direto
node src/TJCETestes.js                                   # suíte de integração
```

O Checker busca o número **formatado e entre aspas** no texto livre, porque a
API **não tem filtro por número de processo**. A forma importa e foi medida:

| forma | resultado |
|---|---|
| `"0169160-51.2018.8.06.0001"` formatado + aspas | 1 documento — exato ✅ |
| `"01691605120188060001"` só dígitos + aspas | 3 documentos errados ❌ |
| `0169160-51.2018.8.06.0001` sem aspas | 294 documentos de ruído ❌ |
