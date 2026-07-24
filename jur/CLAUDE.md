# jur - Brazilian Courts Jurisprudence Crawler

CLI tool for searching jurisprudence (case law) across multiple Brazilian courts, built with Playwright.
Para aumentar a acurácia use a skill `./skills/IMPROVE-PROMPT.md`.

## Roteamento — qual tribunal / qual doc

Escolha o tribunal pelo pedido do usuário e **leia o doc do tribunal** antes de montar o comando.
Cada doc traz as flags específicas, exemplos e ressalvas daquele tribunal.

| Comando | Tribunal | Escopo (estados) | Doc | Status |
|---------|----------|------------------|-----|--------|
| `trf1` | TRF 1ª Região | DF, MG, GO, TO, MT, BA, PI, MA, PA, AP, AM, RR, AC, RO | `CLAUDE-TRF1.md` | OK |
| `trf2` | TRF 2ª Região | RJ, ES | `CLAUDE-TRF2.md` | OK |
| `trf3` | TRF 3ª Região | SP, MS | `CLAUDE-TRF3.md` | ⚠️ instável (restrição de navegador) |
| `trf4` | TRF 4ª Região | RS, SC, PR | `CLAUDE-TRF4.md` | OK |
| `trf5` | TRF 5ª Região | AL, CE, PB, PE, RN, SE | `CLAUDE-TRF5.md` | OK |
| `tcu`  | Tribunal de Contas da União | Federal (acórdãos) | `CLAUDE-TCU.md` | OK |
| `tjgo` | TJ de Goiás | GO | `CLAUDE-TJGO.md` | OK (HTTP direto, sem browser) |
| `tjpa` | TJ do Pará | PA | `CLAUDE-TJPA.md` | OK (API direta, sem browser) |
| `tjpr` | TJ do Paraná | PR | `CLAUDE-TJPR.md` | OK |
| `tjsp` | TJ de São Paulo | SP | `CLAUDE-TJSP.md` | ⚠️ sem acesso — não rodar |

**Exemplos de roteamento:**
- "Procure no Tribunal do Paraná" → `tjpr` → leia `CLAUDE-TJPR.md`
- "Busque no TRF2" / "RJ ou ES" → `trf2` → leia `CLAUDE-TRF2.md`
- "Matéria previdenciária federal em SP" → `trf3` (instável; ver doc), com TRF4/TRF5 de comparativo
- "Acórdãos do TCU" → `tcu` → leia `CLAUDE-TCU.md`

Mapa de sistema processual por tribunal (ex.: TRF4 = e-Proc, TRF6 = PJe) em `cobertura/COBERTURA-SISTEMAS.md`.

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
./bin/jur trf1 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf1.json &
./bin/jur trf2 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf2.json &
./bin/jur trf5 -q "tempo especial" -di "01/01/2026" -df "31/03/2026" --json -o /tmp/trf5.json &
wait
```

## Modo JSON (pipelines / agentes IA)

```bash
./bin/jur trf4 -q "beneficio assistencial" --json
```

Retorna: `{"success":true,"count":42,"output":"/absolute/path/to/results.json"}`
Em erro: `{"success":false,"error":"error message"}`

## Output Format

Resultados salvos como array JSON. Campos variam por tribunal; principais:
`id`, `tipoDocumento`, `processo`, `processoUrl`, `orgaoJulgador`, `dataJulgamento`,
`dataPublicacao`, `relator`, `uf`, `ementa`, `inteiroTeorLink`.

## Notes for AI Agents

1. Sempre use aspas em termos compostos: `-q "termo composto"`
2. Datas em formato brasileiro: DD/MM/YYYY
3. Use `--json` para parsing programático
4. Limite páginas com `-m` para buscas rápidas
5. Chromium é obrigatório: `npx playwright install chromium`
6. Timeout padrão: 60 segundos por operação; ~20 resultados por página
7. **TRF3 é instável** — ver docs respectivos
8. Antes de montar o comando, leia o doc do tribunal alvo (coluna "Doc" acima)

Erros comuns: **Timeout** (reduza escopo com `-m`) · **No results** (revise termo/data) ·
**Browser not found** (`npx playwright install chromium`).

## Project Structure
