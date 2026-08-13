# CLAUDE-TJRJ-EJURIS — TJRJ, módulo eJURIS (`jur tjrj-ejuris`)

O **módulo legado** de jurisprudência do TJRJ, por **HTTP direto, sem browser**.
Irmão de [`CLAUDE-TJRJ.md`](CLAUDE-TJRJ.md) (`jur tjrj`, base nova do e-Proc).

- URL: `https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx`
- Mapeamento: [`human-codegen/TJRJ/01-ejuris/`](human-codegen/TJRJ/01-ejuris/) —
  o contrato inteiro está em [`03-contrato-tecnico.txt`](human-codegen/TJRJ/01-ejuris/03-contrato-tecnico.txt)
- Código: `src/TJRJEjurisNavigator.js` · `src/TJRJEjurisCrawler.js` · `src/TJRJEjurisChecker.js`
- Pilha: ASP.NET WebForms + um web-method JSON. Sem captcha efetivo (ver ressalva 1).

## ESCOPO — por que existem DOIS comandos para o TJRJ

| | `jur tjrj` (e-Proc) | `jur tjrj-ejuris` (este) |
|---|---|---|
| Acervo | 2º grau Justiça Comum, **~2023+** | 2ª Instância **desde ~1995** + Turmas Recursais |
| Turmas Recursais | ❌ não tem | ✅ tem (mas pequeno — ver ressalva 3) |
| Inteiro teor | HTML ~1 MB | **PDF público, com permalink** |
| Data de publicação | ✅ filtra | ❌ **não existe** |
| Recorte de data | dia (DD/MM/AAAA) | **só ANO** |

**Pedido histórico do RJ (antes de 2023) só tem resposta aqui.** Pedido recente
de Justiça Comum é melhor no `jur tjrj`, que recorta por dia.

## Uso

```bash
# acervo histórico da 2ª Instância (o caso comum)
./bin/jur tjrj-ejuris -q "dano moral" -di 2010 -df 2015 -m 5

# Juizados Especiais / Turma Recursal carioca
./bin/jur tjrj-ejuris -q "dano moral" --origem turmas -m 3

# procurar o termo no TEXTO do PDF em vez de na ementa (acha mais)
./bin/jur tjrj-ejuris -q "usucapião" -di 2024 -df 2024 --escopo inteiroTeor

# criminal (só particiona na origem comum)
./bin/jur tjrj-ejuris -q "tráfico" --competencia criminal -di 2020 -df 2024

# consulta por número (aceita CNJ com/sem máscara e a numeração antiga)
./bin/jur tjrj-ejuris -n "0514704-31.2015.8.19.0001" --json

# inteiro teor em PDF (público, sem captcha) e auditoria
./bin/jur tjrj-ejuris -q "tema" -m 1 --fetch-inteiro-teor --output-dir ./resultados/tjrj-ejuris
./bin/jur tjrj-ejuris -q "tema" --verificar 5 --json
./bin/jur tjrj-ejuris --listar-combos     # 5 origens, 16 ramos, 77 órgãos, 804 magistrados
```

Flags: `--origem comum|turmas|conselho|alcadacivel|alcadacriminal` ·
`--competencia civel|criminal` · `--escopo ementa|acordao|monocratica|inteiroTeor|ementario|todos`
· `--ramo/--magistrado/-oj` por label ou trecho · `-di/-df` em **AAAA**.

## Ressalvas

### 1. 🔴 A tela tem reCAPTCHA e o endpoint NÃO o exige

A página de resultado carrega reCAPTCHA Enterprise e chama
`Recaptcha.aspx/RecaptchaVerify`. **E mesmo assim o web-method responde 200 com
os documentos em HTTP puro, sem token.** Medido e reproduzido em 13/08/2026.

É o **avesso da lição do TJSE**: lá `grep turnstile` deu falso negativo e só o
POST provou o bloqueio; aqui `grep recaptcha` daria falso **positivo** e marcaria
o tribunal como bloqueado sem tentar. O que decide é mandar a requisição.

### 2. 🔴 Ano e competência SÓ funcionam na origem `comum`

| | origem `comum` | demais origens |
|---|---|---|
| ano | 2026 = 34.127 · 2020 = 45.245 ✅ | 1990 = 2015 = 2024 = 2026 = **1.002** ❌ |
| competência | cível 818.397 × criminal 6.784 ✅ | cível = criminal = **1.002** ❌ |

`1990` devolver o mesmo número é a prova de que o filtro é ignorado — a Turma
Recursal nem existia nesse formato. O crawler **avisa** e refaz o recorte de ano
no cliente, sobre o que paginou; nesse caso **o total do servidor não reflete o
recorte**. Repasse o aviso.

### 3. 🔴 A Turma Recursal daqui é pequena e só tem 2025-2026

O eJURIS é o único lugar do repo com Juizado Especial carioca — mas são
**~1,6 mil documentos** (`recurso` = 1.620, `dano moral` = 1.002,
`consumidor` = 633, **`usucapião` = 0**), e a amostra paginada só traz
**2025 e 2026**. Não é o acervo histórico dos Juizados: é uma janela recente.
**Diga isso ao usuário** em vez de entregar o número como se fosse o acervo.

As origens `alcadacivel` (1 documento), `alcadacriminal` (2) e `conselho` (78)
são resquícios. Não prometa acervo de Tribunal de Alçada.

### 4. 🔴 Não existe data de publicação

`TemDataPublicacao` vem **false em 100% da amostra** e `DtHrPubl` é sempre o
`DateTime.MinValue` do .NET. Só há data de **julgamento**, e o recorte é **por
ano**, não por dia. **Nunca apresente a data do eJURIS como publicação**, e não
prometa recorte mensal.

### 5. 🔴 Os operadores ingleses DERRUBAM a busca (HTTP 500)

Os que funcionam são os **portugueses**, com o espaço valendo `E` (AND):

| Operador | Resultado (2024, só acórdão) |
|---|---|
| `dano` / `moral` | 60.471 / 49.416 |
| `dano moral` (espaço) = `dano e moral` | **49.063** — o espaço é AND |
| `dano ou moral` | 60.869 ✅ amplia |
| `dano nao moral` = `dano não moral` | 11.656 ✅ — **`NAO` e `NÃO` são o mesmo** |
| `dano adj moral` / `dano prox moral` | 46.223 / 48.960 ✅ |
| `"dano moral"` | 46.126 ✅ frase exata |
| `dan$` | 61.639 ✅ **o curinga é `$`, não `*`** |
| `AND` / `OR` / `NOT` | 🔴 **HTTP 500** |

⚠️ **Não avise sobre acento** — o índice normaliza (`usucapiao` = `usucapião` = 850).
⚠️ **Stopword some em silêncio**: `contrato de trabalho` = `contrato trabalho` = 944.
Termo que é só stopword (`de`) é recusado sem busca.

### 6. 🔴 Os quatro checkboxes são ESCOPO, não tipo de documento

Eles dizem **onde** o termo é procurado (2024, cível, "dano moral"):

| Escopo | Total |
|---|---|
| `ementa` (acórdão + monocrática, default) | 51.972 |
| `acordao` | 49.063 |
| `monocratica` | 3.334 |
| `inteiroTeor` (procura no texto do PDF) | **78.066** |
| `ementario` | 161 |
| **nenhum marcado** | **161** 🔴 = igual a `ementario` |

Desmarcar tudo **não devolve zero**: cai num default silencioso. E
`--escopo inteiroTeor` acha **mais** que o default porque procura no PDF inteiro
— não é um tipo de documento a mais.

### 7. ⚠️ O que o card chama de texto muda com o tipo

| Tipo | Tamanho | O que é |
|---|---|---|
| Acórdão 2ª Inst | 959–1.983 ch | **ementa** estruturada ("APELAÇÃO CÍVEL. …") |
| Monocrática | 1.659–3.979 ch | a **decisão**, não uma ementa |
| Turma Recursal | 1.803–10.123 ch | o **voto/inteiro teor** ("RECURSO Nº … V O T O") |
| Ementário | 907–2.905 ch | ementa + 27 campos próprios |

Não apresente o texto da Turma Recursal como ementa, nem o da monocrática.
✅ Em compensação **o texto já vem na busca**, sem request extra.

### 8. ✅ Permalink existe — e é só um

`https://www3.tjrj.jus.br/gedcacheweb/default.aspx?UZIP=1&GEDID=<ArqGed>`
devolve o **PDF do inteiro teor**, HTTP 200, **sem cookie e sem captcha**
(confirmado em contexto limpo). É o que torna a citação verificável.

🔴 **`ImpressaoConsJuris.aspx?CodDoc=…` NÃO é permalink**: sem sessão devolve
HTTP 200 com 1.239 caracteres de casca e um `grecaptcha.ready(...)`, **idêntico
para documentos diferentes** e sem o número de nenhum deles. Zero falso no molde
do TJPE. **Nunca mande essa URL como prova.**

🔴 **Quem identifica o julgado é o `CodDoc`, não o número do processo** — um
processo tem várias peças (`Decisoes[]` traz 1 a 3).

### 9. ⚠️ Detalhes que quebram o crawler se mexidos

- `hfListaPalavrasBloqueadas` **vazio no POST = HTTP 500** sem mensagem. O
  Navigator relê a lista do formulário a cada busca; não a fixe no código.
- O **GET da tela de resultado é obrigatório** entre o POST e o web-method.
- Página de **10** (20 no escopo `ementario`); não há combo de tamanho.
- Pedir página além do fim responde **HTTP 500**, não lista vazia — o crawler
  trata isso como fim, não como erro.
- ✅ **Paginação estável** (3/3 em sessões novas, ids idênticos) — ao contrário
  do e-Proc do TJRJ, que desliza a fronteira.
- ✅ **Total exato**, não saturado (`criptomoeda` = 1, `usucapiao` = 0).
- ✅ **Sem vhost curinga**: `/path-inventado-9z` devolve o mesmo 404 (md5 igual).

### 10. ⚠️ O combo de anos promete 20 anos que não existem

O `cmbAnoInicio` oferece **1975**, mas `1975` e `1985` devolvem **0**. A base
começa por volta de **1995** (524 em 1995, 3.252 em 2000). ✅ E está **corrente**:
2026 já tem 34.127.

## Desambiguação obrigatória do repo (Justiça Comum × Juizados)

É `--origem comum` (default, 818.397) × `--origem turmas` (1.002) — e a
diferença de três ordens de grandeza **não** significa que o Juizado carioca
decida pouco: significa que o eJURIS indexa pouco dele (ressalva 3). Para
Justiça Comum recente, prefira `jur tjrj` (e-Proc).
