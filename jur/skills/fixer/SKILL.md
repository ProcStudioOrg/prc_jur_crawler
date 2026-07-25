---
name: jur-fixer
description: Use when a jur tribunal crawler that used to work starts failing — zero results, timeout, selector not found, login wall, captcha, layout change. Diagnoses by comparing the live page against the human-codegen screenshots taken when it worked, then fixes the selector or flow.
---

# jur-fixer — consertar crawler que quebrou

Tribunais mudam o site sem avisar. Esta skill descobre **o que mudou** comparando a página de
hoje com os prints de `human-codegen/<TRIBUNAL>/` — tirados quando o crawler funcionava.

<HARD-GATE>
NUNCA "conserte" mudando o comportamento esperado para caber no bug.
SEMPRE reproduza a falha antes de editar código.
SEMPRE distinga "o site mudou" de "o site nos bloqueou" — o conserto é diferente.
Depois de consertar, atualize os prints E o `CLAUDE-<TRIBUNAL>.md`.
</HARD-GATE>

## Passo 1 — Reproduzir e classificar

```bash
./bin/jur <tribunal> -q "termo simples" -m 1 --json
```

Classifique a falha antes de qualquer coisa:

| Sintoma | Classe | Caminho |
|---|---|---|
| `success:false` + timeout | **A. Site lento/fora** | Repita; cheque a URL no navegador. Pode não ser bug nosso. |
| 0 resultados, sem erro | **B. Filtro/parse quebrado** | Passo 2 |
| Erro de seletor / elemento não encontrado | **B. Layout mudou** | Passo 2 |
| HTML de login, captcha, Turnstile, "verificação de navegador" | **C. Bloqueio** | Passo 4 |
| JSON inválido / campos vazios | **D. Contrato da API mudou** | Passo 3 |
| Funciona com `--headed`, falha headless | **C. Detecção de bot** | Passo 4 |

## Passo 2 — Comparar com o mapeamento (layout)

1. Abra o `INDEX.md` do tribunal: `human-codegen/<TRIBUNAL>/INDEX.md`. Ele mapeia
   **seção ↔ print ↔ descrição**.
2. Ache a seção do elemento que quebrou (combo de instância, calendário, botão de busca…).
3. Abra o print correspondente e o `.txt` da seção — o `.txt` tem **o HTML do elemento**
   como era quando funcionava (`name`, `id`, `value` dos `option`).
4. Abra a página de hoje com `--headed` (ou Playwright/DevTools) e compare:

| O que comparar | Onde estava | Onde está agora |
|---|---|---|
| `name`/`id` do input | HTML no `.txt` da seção | DOM atual |
| `value` das opções do combo | HTML no `.txt` da seção | DOM atual |
| Posição/rótulo do botão | print da seção | tela atual |
| URL de submit / método | `CLAUDE-<TRIBUNAL>.md` §acesso | aba Network |

5. O conserto é no `<T>Navigator.js` (fala com o site) ou no `<T>Crawler.js` (monta filtros).
   Mude **só** o seletor/parâmetro que mudou.

> Print faltando ou seção sem descrição? O `INDEX.md` lista essas pendências
> ("seções sem print" / "seções sem descrição"). Sem o print você está adivinhando —
> tire o print agora (`--headed` + screenshot) e grave no padrão do
> [`CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md) §3.

## Passo 3 — Contrato de API mudou

Para tribunais com acesso `api` (TJPA) ou `http` (TJGO):

1. Reproduza a request crua (`curl`/`fetch`) com os mesmos headers.
2. Compare os campos da resposta com o mapeamento em `<T>Crawler.js` (a função que
   normaliza para o formato do repo).
3. Cheque **encoding**: TJGO faz POST em ISO-8859-1 e querystring em UTF-8. Misturar
   os dois produz 0 resultados silenciosamente.
4. Cheque limites técnicos: TJPA corta em 10.000 resultados (`excedeuLimiteTecnico`).

## Passo 4 — Bloqueio, não bug

Responda as três perguntas e registre no `CLAUDE-<TRIBUNAL>.md`:

```
O que bloqueia? (Cloudflare / Turnstile / captcha / verificação de navegador / login)
A BUSCA funciona sem resolver?
O DOWNLOAD funciona sem resolver?
```

Costuma ser **assimétrico** — no TJGO a busca passa e só o download do arquivo original
exige Turnstile. Saber disso é a diferença entre "não dá" e "dá, com ressalva".

Escalada, nesta ordem:

1. `--headed` como modo padrão documentado (é o caso do TRF3).
2. Fallback alternativo já existente (`src/trf3_drission.py`).
3. Se a busca ainda passa mas o download não: documente a ressalva e siga usando o texto
   que vem no payload da busca.
4. Bloqueio total: marque `sem-acesso` em `cobertura/build.js`, rode o build, e aponte o
   tribunal alternativo no `CLAUDE-<TRIBUNAL>.md` (como TJSP → TRF3).

**Não** tente contornar proteção anti-bot ativa. Documente, degrade com honestidade, e ofereça
a alternativa.

## Passo 5 — Fechar o conserto

- [ ] `./bin/jur <tribunal> -q "termo" -m 1 --json` volta a retornar resultados
- [ ] Paginação anda além da página 1
- [ ] Suíte do tribunal passa (`node src/<T>Testes.js`), quando existir
- [ ] `node tests/smoke.js <cmd>` verde
- [ ] Prints atualizados em `human-codegen/<TRIBUNAL>/` no padrão do §3
- [ ] `node human-codegen/index.js` rodado (regenera o `INDEX.md`)
- [ ] Ressalva nova registrada em `CLAUDE-<TRIBUNAL>.md`
- [ ] `cobertura/build.js` atualizado se o status mudou + `node cobertura/build.js`

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "Vou só trocar o seletor até passar" | Compare com o print. Chute vira bug silencioso. |
| "0 resultados = site vazio" | Quase sempre é filtro/encoding quebrado. Teste sem filtro. |
| "Está bloqueado, desisto" | Cheque se a BUSCA passa. Bloqueio é quase sempre parcial. |
| "Conserto agora, documento depois" | A ressalva é o entregável mais valioso. Documente junto. |
| "Não preciso atualizar o print" | O próximo conserto depende dele. Atualize. |
| "Funciona na minha máquina" | Rode `tests/smoke.js`. Headless ≠ headed. |
