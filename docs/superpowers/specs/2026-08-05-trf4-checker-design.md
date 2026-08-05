# TRF4Checker — verificação anti-alucinação por número (design)

> Aprovado em 05/08/2026. Abordagem escolhida pelo usuário: **B — browser,
> reutilizando o TRF4Crawler** (a alternativa HTTP direto foi provada viável no
> probe de 05/08/2026 — `listar_resultados` responde a POST puro em ~0,5s — e
> fica registrada como evolução futura).

## Objetivo

Dar ao comando `trf4` a mesma superfície de verificação dos demais tribunais:

| Flag | Comportamento |
|---|---|
| `-n, --numero <numero>` | Consulta direta por CNJ. Exit **0** se o julgado existe na base, **1** se não. |
| `--verificar [amostra]` | Auditoria pós-busca: reconsulta N resultados amostrados (default 5). |
| `--datajud` | Com `-n`: consulta também o DataJud (`api_publica_trf4`) como fonte secundária de metadados. |

Hoje o `CLAUDE-TRF4.md` diz "Não existe flag `-n` (…) a verificação é parcial".
Este design remove essa lacuna.

## Arquitetura

`src/TRF4Checker.js` (~200 linhas) espelha a **interface** do `TRF2Checker`:

- `normalizarNumeroCNJ` / `validarNumeroCNJ` — delegam a `src/cnj.js`.
- `ehProcessoTRF4(numero)` — `cnj.pertenceA(numero, 4, 4)` (justiça 4, tribunal 04).
- `ehFormatoCNJ(numero)` — 20 dígitos.
- `consultarProcesso(numero, {datajud})` — consulta principal (abaixo).
- `verificarResultados(results, {amostra, log})` — auditoria por amostragem.
- `consultarDataJud(numero)` — cópia do padrão TRF2 (índice `api_publica_trf4`;
  nunca lança; `{disponivel:false, erro}` em falha). Convenção do repo: cada
  Checker embute sua cópia; não criar helper compartilhado agora.
- CLI standalone: `node src/TRF4Checker.js <numero> [--datajud]`.

Diferença central para o TRF2: o transporte é o **TRF4Crawler** (Playwright
headless), não um Navigator HTTP. O Checker herda `gotoComRetry()` e o
tratamento do pool de backends instável.

## Fluxo de `consultarProcesso`

1. Sobe `TRF4Crawler` headless → `navigateToSearch()`.
2. Seleciona **todas as origens** no `selOrigem` — o julgado pode estar no
   acervo principal ou nas Turmas Recursais e a verificação não deve depender
   de acertar isso antes. Exige extensão pequena no `configureFilters`:
   `origem: 'todas'` marca todas as options (com refresh do selectpicker).
3. `executeSearch(<número com máscara>)` no `txtPesquisa` — medido em
   04-05/08/2026: número mascarado como texto livre devolve exatamente os
   documentos do processo ("Documento 1 de 5" para 5001471-45.2023.4.04.7005).
4. `extractResults()` e filtro por igualdade de dígitos do `numeroProcesso`
   (o campo vem como `5001471-45.2023.4.04.7005/TRF4` — comparar só dígitos).
5. Browser fechado em `finally`.

Saída no formato dos outros Checkers: `{numero, numeroConsultado, formatoCNJ,
numeroValido, trf4, encontrado, total, decisoes:[…], datajud?}`. DV inválido é
**aviso, nunca veto** (acervos migrados têm DV que não fecha).

## Honestidade em falha — vazio × indefinido

O `extractResults()` atual devolve `[]` em silêncio quando a listagem não
carrega. Para um verificador isso é inaceitável: "a resposta não veio" não pode
virar "o julgado não existe".

Regra: com zero `.resultadoItem`, o Checker procura o marcador de "nenhum
resultado" da própria página (medir o texto/seletor exato na implementação —
ex.: mensagem de resultado vazio do eproc). Sem resultados **e** sem marcador →
`throw` ("não é possível afirmar que o julgado não existe — repita"). Falha de
`gotoComRetry` propaga como erro, nunca como exit 1.

## Armadilha do `id`

O `id` dos cards do TRF4 (`resultado41762448648068703476149319811`) tem cara de
gerado por sessão. Na implementação, medir: buscar o mesmo processo duas vezes e
comparar ids. Se **instável**, `verificarResultados` confirma pela tupla
`numeroProcesso + tipoDocumento + dataJulgamento` (documentar no código); se
estável, confirmar por `id` como no TRF2.

## Custo — uma sessão para a auditoria inteira

Cada sessão de browser custa 15–25s. `verificarResultados` sobe **um** browser e
reusa a sessão para as N reconsultas (repete só `executeSearch`), em vez de
subir Chromium N vezes. Diferença deliberada em relação ao TRF2Checker (HTTP,
não precisa disso).

## Wiring, docs e testes

- `bin/jur` comando `trf4`: as 3 flags; `-n` sai antes da busca (exit 0/1, JSON
  com `--json`), `--verificar` acopla ao final da coleta como nos outros.
- `CLAUDE-TRF4.md`: remover "Não existe flag `-n`", documentar o Checker, a
  ressalva do id e o custo por sessão.
- `CLAUDE.md` (linha do trf4) e skill `browser` (tabela de roteamento).
- `skills/verificador/tribunais/trf4.md` novo + `node sync-plugin.js`.
- Testes (fixtures fixas, padrão `tests/aceite.js`):
  - real: `5001471-45.2023.4.04.7005` → `encontrado: true`, 5 documentos, exit 0;
  - bem-formado inexistente: `5009999-99.2023.4.04.7005` → `encontrado: false`, exit 1;
  - número de outro tribunal (ex. CNJ `…5.09.…`) → `trf4: false` no output.

## Fora de escopo

- Migrar a **busca** do TRF4 para HTTP direto (viável — probe passou — mas é
  outro projeto; este Checker não deve bloquear nele).
- Helper DataJud compartilhado entre Checkers.
