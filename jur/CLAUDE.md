# jur — Brazilian Courts Jurisprudence Crawler

CLI para buscar jurisprudência nos tribunais brasileiros, construída com Playwright.

**Antes de qualquer busca, use a skill [`browser`](skills/browser/SKILL.md).**
Pedido vago? Passe primeiro pela skill [`improve-user-prompt`](skills/improve-user-prompt/SKILL.md).
Nunca cite um julgado sem a skill [`verificador`](skills/verificador/SKILL.md).

| Documento | Para que |
|---|---|
| **este arquivo** | Roteamento: qual tribunal, qual doc, quais flags comuns |
| [`CLAUDE-CODEGEN.md`](CLAUDE-CODEGEN.md) | Como mapear um tribunal **novo** (processo completo) |
| [`cobertura/CLAUDE-COBERTURA.md`](cobertura/CLAUDE-COBERTURA.md) | Os 61 tribunais catalogados e o status de cada um |
| `CLAUDE-<TRIBUNAL>.md` | Flags específicas e **ressalvas** de um tribunal |
| [`skills/README.md`](skills/README.md) | As 5 skills e quando usar cada uma |

## Roteamento — qual tribunal / qual doc

Escolha o tribunal pelo pedido do usuário e **leia o doc do tribunal** antes de montar o comando.
Cada doc traz as flags específicas, exemplos e ressalvas daquele tribunal.

| Comando | Tribunal | Escopo (estados) | Doc | Status |
|---------|----------|------------------|-----|--------|
| `trf1` | TRF 1ª Região | DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO | `CLAUDE-TRF1.md` | 🟡 CJF fora do ar (24/07/2026) |
| `trf2` | TRF 2ª Região | RJ, ES | `CLAUDE-TRF2.md` | 🟢 OK (HTTP direto, sem browser) |
| `trf3` | TRF 3ª Região | SP, MS | `CLAUDE-TRF3.md` | 🟡 instável (restrição de navegador) |
| `trf4` | TRF 4ª Região | RS, SC, PR | `CLAUDE-TRF4.md` | 🟢 OK |
| `trf5` | TRF 5ª Região | AL, CE, PB, PE, RN, SE | `CLAUDE-TRF5.md` | 🟢 OK |
| `trf6` | TRF 6ª Região | MG | `CLAUDE-TRF6.md` | 🟢 OK (HTTP direto, sem browser) — base **só a partir de 2023** |
| `stf`  | **Supremo Tribunal Federal** | Nacional (constitucional) | `CLAUDE-STF.md` | 🟢 OK (API direta; browser só p/ o token do WAF) |
| `stj`  | **Superior Tribunal de Justiça** | Nacional (lei federal infraconstitucional) | `CLAUDE-STJ.md` | 🟢 OK (SCON — **browser headful obrigatório**, Cloudflare) |
| `tcu`  | Tribunal de Contas da União | Federal (acórdãos) | `CLAUDE-TCU.md` | 🟢 OK |
| `tjgo` | TJ de Goiás | GO | `CLAUDE-TJGO.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjma` | TJ do Maranhão | MA | `CLAUDE-TJMA.md` | 🔴 busca **bloqueada por captcha**; só `-n` (nº do processo, via DataJud) |
| `tjpa` | TJ do Pará | PA | `CLAUDE-TJPA.md` | 🟢 OK (API direta, sem browser) |
| `tjpr` | TJ do Paraná | PR | `CLAUDE-TJPR.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjrj` | TJ do Rio de Janeiro | RJ | `CLAUDE-TJRJ.md` | 🟢 OK (HTTP direto, sem browser — só e-Proc/Justiça Comum 2º grau) |
| `tjrs` | TJ do Rio Grande do Sul | RS | `CLAUDE-TJRS.md` | 🟢 OK (HTTP direto, sem browser) |
| `tjsc` | TJ de Santa Catarina | SC | `CLAUDE-TJSC.md` | 🟢 OK (browser — portal atrás de verificação de segurança) |
| `tjsp` | TJ de São Paulo | SP | `CLAUDE-TJSP.md` | 🔴 sem acesso — não rodar |
| `trt9` | TRT 9ª Região (**trabalhista**) | PR | `CLAUDE-TRT9.md` | 🟢 OK (API direta, sem browser) |

Nenhum tribunal catalogado está mapeado à espera de crawler. Falta ainda o módulo
**eJURIS** do TJRJ (legado com Turmas Recursais e acervo histórico — o `jur tjrj` cobre
só o e-Proc). Os outros 43 tribunais (TJs restantes, TRTs, TST) não estão mapeados — veja
`cobertura/CLAUDE-COBERTURA.md` e use a skill [`codegen`](skills/codegen/SKILL.md) para mapear.

**Exemplos de roteamento:**
- "Procure no Tribunal do Paraná" → `tjpr` → leia `CLAUDE-TJPR.md`
- "Juizado Especial no PR" / "Turma Recursal paranaense" → `tjpr --foro juizados`;
  Justiça Comum é `--foro comum` (default). A distinção é obrigatória — leia `CLAUDE-TJPR.md`
- "Juizado Especial no RS" / "Turma Recursal gaúcha" → `tjrs --origem turmas`;
  Justiça Comum é `--origem comum` (default). A distinção é obrigatória — leia `CLAUDE-TJRS.md`
- "TJSC" / "Santa Catarina estadual" → `tjsc` → leia `CLAUDE-TJSC.md`.
  Juizado Especial / Turma Recursal em SC → `tjsc --origem turmas` (Justiça Comum é o
  default `--origem comum`). ⚠️ o TJSC tem dois portais no ar: use só o comando, nunca
  `busca.tjsc.jus.br` (base congelada desde 08/10/2025)
- "TJMA" / "Maranhão estadual" → ⚠️ **a busca por termo não existe**: o JurisConsult exige
  captcha de imagem + reCAPTCHA, e este repo não resolve captcha. Diga isso ao usuário.
  Só `./bin/jur tjma -n <nº>` (confirma que um processo existe, via DataJud) e
  `--diagnostico` funcionam. Para matéria federal com origem no MA ofereça `trf1` —
  leia `CLAUDE-TJMA.md`
- "Busque no TRF2" / "RJ ou ES" → `trf2` → leia `CLAUDE-TRF2.md`.
  Juizado Especial Federal / Turma Recursal no RJ ou ES → `trf2 --origem turmas`
  (Justiça Federal comum é o default `--origem trf2`). ⚠️ **neste portal o espaço entre
  termos quebra a busca** — o crawler conserta sozinho (une com hífen), mas nunca chame o
  site na mão nem use `--literal` sem ler a ressalva 1. A base começa em **2018**:
  pedido histórico anterior a isso não tem resposta aqui
- "Matéria federal em Minas Gerais" / "TRF6" → `trf6` → leia `CLAUDE-TRF6.md`.
  Juizado Especial Federal / Turma Recursal em MG → `trf6 --origem turmas`
  (Justiça Federal comum é o default `--origem trf6`). ⚠️ **a base só tem de 2023 em
  diante** — o TRF6 foi instalado em ago/2022, desmembrado do TRF1. Jurisprudência
  federal de MG **até 2022** está no `trf1`, não aqui (medido: 27% da amostra do TRF1
  em 2019 é de subseções mineiras). Um pedido histórico exige os dois comandos.
  ⚠️ Ao contrário do TRF2, aqui o espaço entre termos funciona e os operadores são em
  português (`e`, `ou`, `não`, `prox`) — **nunca hifenize a query do TRF6**
- "TJRJ" / "Rio de Janeiro estadual" → `tjrj` → leia `CLAUDE-TJRJ.md`.
  ⚠️ só Justiça Comum 2º grau no e-Proc (~2023+); **Juizado Especial / Turma Recursal
  carioca e acervo antigo estão no eJURIS, sem crawler** — diga isso ao usuário em vez
  de rotular resultado do e-Proc como Juizado
- "Matéria previdenciária federal em SP" → `trf3` (instável; ver doc), com TRF4/TRF5 de comparativo
- **Matéria constitucional / precedente de maior hierarquia** ("o que o Supremo decidiu",
  "é constitucional?", ADI/ADPF/ADC, recurso extraordinário) → `stf` → leia `CLAUDE-STF.md`.
  **Súmula vinculante** → `stf --vinculantes` (são 63, e vinculam todo o Judiciário).
  **Repercussão geral / tema / tese** → `stf --rg`, `stf --tema "<nº ou texto>"`,
  `stf --tese "<texto>"`. No STF **não há Juizado nem Turma Recursal**: a desambiguação é por
  órgão (`-oj "Tribunal Pleno"` × Turmas) e por classe (`-c ADI,ADPF,ADC` × `-c RE,ARE`).
  Peça o número no formato do STF (`ARE 1596565`, `ADI 4277`) — a base **não indexa CNJ**
- **Interpretação de LEI FEDERAL infraconstitucional** (Código Civil, CPC, CDC, Código Penal,
  Lei de Execução Fiscal, benefício previdenciário, contrato, prescrição) → `stj`, a corte que
  uniformiza a lei federal e orienta todos os TJs e TRFs. **Cite o STJ antes do TJ local.**
  Leia `CLAUDE-STJ.md`. No STJ **não há Juizado, Turma Recursal nem 1º grau**: a desambiguação
  é (a) por **órgão** — `-s publico` (tributário/administrativo/previdenciário),
  `-s privado` (civil/consumidor/empresarial), `-s penal`, `-oj CE` (Corte Especial) — e
  (b) por **tipo de documento**: `--base acordao` (default) × `--base monocratica`.
  **Tema repetitivo / precedente vinculante** → `stj --temas -q "<assunto>"`; os acórdãos
  julgados sob o rito → `stj -q "<termo>" --repetitivos`.
  ⚠️ O comando **abre uma janela de Chromium** (Cloudflare não libera headless) e a base
  **não indexa número CNJ** — peça o número no formato do STJ (`REsp 1809043`) ou o
  registro (`2019/0116080-0`)
- "Acórdãos do TCU" → `tcu` → leia `CLAUDE-TCU.md`
- **Matéria trabalhista no PR** (verbas rescisórias, horas extras, vínculo, insalubridade,
  justa causa, assédio) → `trt9`, **não** `tjpr`. Justiça do Trabalho é outro ramo.
  A desambiguação é por grau: `-g 2` acórdãos das Turmas (default), `-g 1` sentenças de
  Vara do Trabalho. **Não existe Juizado Especial na JT** — leia `CLAUDE-TRT9.md`
- Tribunal não coberto → **diga isso**; ofereça o vizinho coberto ou mapear com `codegen`

## Installation

```bash
npm install
npx playwright install chromium
```

## Quick Start

```bash
./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"
```

Rode `./bin/jur <command> --help` para a lista completa de flags de um tribunal.

## Flags comuns (todos os tribunais)

| Flag | Long | Description |
|------|------|-------------|
| `-q` | `--query` | Search query (required) |
| `-m` | `--max-pages` | Max pages to crawl (default: 10) |
| `-o` | `--output` | Output JSON file |
| `-v` | `--visible` | Show browser window |
| | `--headed` | Alias for `--visible` |
| | `--json` | Quiet mode: suppress logs, JSON summary only |

## Rodando em paralelo

Cada crawler sobe seu próprio browser — rode tribunais diferentes em paralelo:

```bash
./bin/jur trf4 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf4.json &
./bin/jur trf5 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf5.json &
./bin/jur tjgo -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/tjgo.json &
wait
```

## Modo JSON (pipelines / agentes IA)

```bash
./bin/jur trf4 -q "beneficio assistencial" --json
```

Retorna: `{"success":true,"count":42,"output":"/absolute/path/to/results.json"}`
Em erro: `{"success":false,"error":"error message"}`

## Output Format

Resultados salvos como array JSON em `resultados/`. Campos variam por tribunal; principais:
`id`, `tipoDocumento`, `processo`, `processoUrl`, `orgaoJulgador`, `dataJulgamento`,
`dataPublicacao`, `relator`, `uf`, `ementa`, `inteiroTeorLink`.

## Manutenção

```bash
npm run docs          # regenera cobertura/ e os INDEX.md de human-codegen/
npm run smoke         # os tribunais 🟢 ainda funcionam? (ver tests/README.md)
npm test              # testes unitários
node sync-plugin.js   # espelha jur/skills/ no plugin (--check só verifica)
```

`cobertura/CLAUDE-COBERTURA.md` e os `INDEX.md` são **gerados** — edite as fontes
(`cobertura/build.js`, os arquivos de `human-codegen/`) e rode `npm run docs`.

## Notes for AI Agents

1. Sempre use aspas em termos compostos: `-q "termo composto"`
2. Datas em formato brasileiro: DD/MM/YYYY
3. Use `--json` para parsing programático
4. Limite páginas com `-m` para buscas rápidas
5. Chromium é obrigatório: `npx playwright install chromium`
6. Timeout padrão: 60 segundos por operação; ~20 resultados por página
7. **Antes de montar o comando, leia o doc do tribunal alvo** (coluna "Doc" acima) — as flags
   e os operadores válidos mudam por tribunal
8. **Operadores não são universais**: no TJGO, `E`/`OU`/`NÃO` viram palavra literal no módulo
   de jurisprudência (só `"frase exata"` funciona). Nunca presuma — leia o doc.
9. **Turmas Recursais**: a ementa é uma frase genérica. Use `--fetch-inteiro-teor`.
10. **Verifique antes de citar**: skill `verificador`. Julgado não confirmado não entra na resposta.

Erros comuns: **Timeout** (reduza escopo com `-m`) · **No results** (revise termo/data;
quase sempre é filtro ou encoding, não base vazia) · **Browser not found**
(`npx playwright install chromium`) · **Site mudou** (skill [`fixer`](skills/fixer/SKILL.md)).
