# TCE-PR — Tribunal de Contas do Estado do Paraná

**Escopo:** controle externo do Estado do Paraná e dos **399 municípios** paranaenses
**Status:** 🟢 OK (portal ViaJuris, HTTP direto, sem browser — **sem captcha**)
**Crawler:** `src/TCEPRCrawler.js` · `src/TCEPRNavigator.js` · `src/TCEPRChecker.js`
**Mapeado em:** 14/08/2026 · `human-codegen/TCEPR/01-viajuris/`
**Base:** 148.490 acórdãos, 1998–2026, **corrente** (sessão mais recente 05/08/2026)

```bash
./bin/jur tcepr -q "licitação" -m 2
./bin/jur tcepr -q "nepotismo" --colegiado pleno -di 01/01/2025 -df 31/12/2025
./bin/jur tcepr -n "393433/2026"          # consulta por número de processo
./bin/jur tcepr --acordao "1979/2026"     # consulta por número de acórdão
```

---

## 🔴 ANTES DE QUALQUER COISA: isto NÃO é Judiciário

O TCE-PR é órgão de **controle externo**. Ele julga **contas**, não litígio entre
partes. Consequências que mudam a resposta ao usuário:

- **Não ofereça o TCE-PR para matéria cível, penal, trabalhista, previdenciária
  (RGPS) ou de família.** Ele não tem esse acervo, e o zero que ele devolveria
  não seria ausência de jurisprudência — seria o tribunal errado.
- **Ofereça-o** para: licitação e contrato administrativo, ato de pessoal
  (admissão, aposentadoria e pensão de servidor **estadual ou municipal do PR**),
  prestação de contas de prefeito e de gestor, responsabilidade fiscal (LRF),
  subsídio de agente político, terceirização na administração pública,
  transparência e consulta com força normativa.
- **Não há número CNJ.** O processo é `<sequencial>/<ano>` (ex.: `393433/2026`).
  Não peça CNJ ao usuário e não tente validar dígito verificador.
- **Não há DataJud.** A API do CNJ cobre o Judiciário; contas não tem alias
  `api_publica_*`. Aqui não existe plano B — e não é preciso: a consulta por
  número do próprio portal responde, sem captcha.
- É instância **administrativa**, como CARF e TCU. Para a mesma matéria já
  judicializada, o caminho é `tjpr` (estadual) ou `trf4` (federal, PR/SC/RS).

## ✅ O Paraná NÃO tem TCM — e por isso não há a armadilha do bloco

Em SP, RJ, BA, GO e PA parte das contas municipais fica **fora** do TCE, no TCM,
e procurá-las no TCE devolve zero que se lê como "não há julgado". **No Paraná
isso não acontece:** o TCE-PR fiscaliza o Estado **e todos os 399 municípios**,
o que está provado no próprio formulário — o combo de município traz **399
municípios** (`./bin/jur tcepr --listar-filtros`). Conta de prefeitura
paranaense, de câmara municipal e de autarquia municipal está **aqui**.

## Flags

Além das flags comuns (ver `CLAUDE.md`):

```
-q,  --query <text>        Termo livre — ver os operadores abaixo
-n,  --numero <numero>     Consulta por número de PROCESSO (<numero>/<ano>)
     --acordao <numero>    Consulta por número de ACÓRDÃO (<numero>/<ano>)
     --colegiado <c>       pleno | primeira-camara | segunda-camara
     --classificacao <c>   sumula | prejulgado | consulta-forca-normativa |
                           consulta-sem-forca-normativa |
                           uniformizacao-jurisprudencia | incidente-uniformizacao
     --ano-acordao <ano>   Ano do acórdão          --ano-processo <ano>
-r,  --relator <nome>      Nome EXATO do combo (--listar-filtros)
-c,  --classe <valor>      Classe processual (145 opções)
     --municipio <id>      Município (399 opções)
     --interessado <txt>   --entidade <txt>
-di, --data-inicio <date>  Data da SESSÃO inicial   ⚠️ mande as DUAS pontas
-df, --data-fim <date>     Data da SESSÃO final     ⚠️ mande as DUAS pontas
     --listar-filtros      Enumera os combos capturados no mapeamento
     --verificar [n]       Audita N resultados pelo permalink público
     --fetch-inteiro-teor  Baixa o PDF (o texto já vem na busca — isto só grava)
```

---

## Ressalvas — leia antes de montar o comando

### 🔴 Os operadores são os INGLESES, e a tela anuncia os que NÃO funcionam

Logo acima do campo, o portal imprime a legenda `e ou não ( ) * ? ~`. Medido:

| Query | Total | Veredito |
|---|---|---|
| `nepotismo` | 379 | — |
| `licitação` | 17.563 | — |
| `nepotismo licitação` (espaço) | 179 | **espaço é E (AND)** |
| `nepotismo ou licitação` | 179 | 🔴 **`ou` IGNORADO — devolve a INTERSEÇÃO** |
| `nepotismo OR licitação` | **17.763** | ✅ união (379 + 17.563 − 179 = 17.763) |
| `licitação não nepotismo` | 178 | 🔴 `não` vira palavra |
| `licitação NOT nepotismo` | **17.384** | ✅ exclusão (17.563 − 179) |
| `"concorrência pública"` | 959 | ✅ frase exata |
| `licita*` | 12.291 | ⚠️ **degenera** (menos que o termo inteiro) |
| `licita??o` | **0** | 🔴 zera em silêncio, apesar da legenda |

🔴 **O `ou` é o mais perigoso**: você pede união e recebe interseção, com número
plausível e **sem sintoma nenhum**. Se o usuário quiser "A ou B", escreva `OR`.
O crawler avisa em cada caso — repasse o aviso.

⚠️ **NÃO avise sobre acento**: o índice normaliza (`licitacao` = `licitação` =
17.563). ⚠️ E o `*` **restringe** em vez de ampliar, porque o termo simples já
expande sozinho — número menor com curinga não é busca mais específica.

### 🔴 Sem termo livre, o resultado vem SEM inteiro teor

Medido: **com** `-q` o texto integral vem em **100%** dos cards (50/50 em
acórdão, 14/14 em prejulgado, 20/20 em consulta, 2/2 em súmula); **sem** `-q`,
em **0%** (0/50 na base inteira, 0/20 filtrando só por colegiado, 0/20 só por
ano). O bloco é o *match* do termo no texto — sem termo não há o que casar.

Ou seja: `./bin/jur tcepr --classificacao sumula` (sem `-q`) devolve ementa e
tema, **não o texto**. Para o texto nesse caso, use `--fetch-inteiro-teor`.
⚠️ Isto **não** é característica do tipo de documento: os quatro tipos trazem o
texto quando há termo.

### 🔴 A janela de data falha dos dois lados, de maneiras opostas

`-di` sozinho **ZERA** a busca (0 registros, HTTP 200); `-df` sozinho é
**IGNORADO** (devolve o acervo inteiro, HTTP 200). **Mande sempre as duas
pontas** — o crawler não envia meia janela e avisa quando você tenta.

⚠️ **A janela é da data da SESSÃO de julgamento.** A data de publicação existe e
é distinta (sessão 05/08/2026, publicação 11/08/2026), mas **não é filtrável**.
Nunca apresente o recorte do TCE-PR como sendo por data de publicação.

### 🔴 O número como a tela mostra devolve zero calado

O card exibe `Processo: 393433/2026`. Mandar exatamente isso no campo devolve
**0 com HTTP 200**: o portal quer o sequencial e o ano **em campos separados**.
Use `./bin/jur tcepr -n "393433/2026"`, que aplica o contorno.

⚠️ **Um processo rende vários acórdãos** (embargos, recurso, prejulgado) — o
`-n` devolve a **lista**, e quem identifica o julgado é o **`id` do documento**,
não o número do processo.

### ✅ O que vem de graça: quase tudo

Numa única busca, sem captcha e sem request extra:

- **ementa íntegra**;
- **tema** — resumo analítico próprio do TCE-PR, campo que nenhum TJ do repo tem;
- **inteiro teor** (quando há termo — ver acima);
- **classificação de termos** (tesauro, em caminho hierárquico);
- **referências normativas**, artigo por artigo;
- **citação oficial pronta**, no formato do Tribunal:
  `(REPRESENTAÇÃO DA LEI DE LICITAÇÕES n.º 393433/2026, Acórdão n.º 1979/2026,
  Tribunal Pleno, Rel. …, julgado em 05/08/2026, veiculado em 11/08/2026 no DETC)`;
- **permalink público** — `https://viajuris.tce.pr.gov.br/Pesquisa/Visualizar/<slug>/<id>`,
  confirmado em aba limpa. ⚠️ O **slug é decorativo**; quem resolve é o `id`.

⚠️ **O inteiro teor do card vem FORA DE ORDEM.** Ele é 98% do PDF em volume
(14.970 chars contra 15.328, com 95% das janelas amostradas presentes), mas é
remontado por janelas de match: começa pelo bloco de assinatura digital, não
pelo cabeçalho. Para **análise** serve; para **leitura fiel na ordem original**,
use `--fetch-inteiro-teor` e leia o PDF.

⚠️ **NÃO existe URL de busca.** A rota nunca muda. Nunca mande "o link da busca"
do TCE-PR como prova — mande o permalink do documento.

### ⚠️ O PDF não começa com `%PDF`

O arquivo servido em `Content-Type: application/pdf` é um **envelope PKCS#7
assinado em DER** (a assinatura digital do Tribunal), com o PDF embutido a
partir do **offset 57**. Leitores comuns e o `pdftotext` abrem normalmente, mas
qualquer validação por *magic number* reprova. `TCEPRNavigator.ehPdf()` trata.

### ⚠️ Dois controles da tela não filtram nada

O combo **"no campo… / EMENTA / TEMA"** é **ignorado** (quatro valores, inclusive
um inventado, devolvem os mesmos 17.563) — por isso **não existe flag de escopo
de campo** no CLI: ela mentiria. E o `<select>` de classificação de decisão é
**decorativo**: quem filtra é um campo oculto, que o crawler já manda.

### ✅ O que foi medido e está bem

- **Partição por colegiado fecha exata**: Pleno 10.918 + 1ª Câmara 3.555 +
  2ª Câmara 3.090 = 17.563 = o total sem filtro.
- **Total exato**, sem saturação (a aritmética da última página fecha).
- **Paginação estável** (a mesma página 3× devolve os mesmos ids na mesma ordem).
- **Zero é zero de verdade** — a resposta encolhe para 631 bytes com
  `0 registros encontrados`, não é página de erro nem formulário vazio.
- **Base corrente e funda**: 1998 a 2026, sem buraco; nada do congelamento do
  TJAM nem da defasagem de ponta do TJPI.
- **Não há Juizado × Justiça Comum** (é controle externo) — o recorte
  equivalente é o colegiado. Ausência medida, não presumida.

---

## Pendências declaradas

Não foram provados por contagem (existem no formulário e alguns estão expostos
como flag): `--classe` (145 opções), `--municipio` (399), o bloco de
**referência normativa** (tipo/emissor/nome/número/ano da lei e
artigo/parágrafo/inciso/alínea/item) e o bloco de **precedentes**
(`TIPO_PRECEDENTE`, `NUMERO_PRECEDENTE`, `ANO_PRECEDENTE`, `PrecedenteDoTribunal`).
Também não foram medidos: o combo de **ordenação**; a **árvore do tesauro**
(`modalArvoreClassificacao`) e a busca por referência normativa a partir do card;
a **multi-seleção** do filtro de classificação (testado com um valor por vez);
o **rate limit**; e o **dataset de Dados Abertos** não foi baixado nem comparado
com a busca.
