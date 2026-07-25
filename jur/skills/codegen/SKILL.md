---
name: jur-codegen
description: Use when adding a NEW Brazilian court to the jur crawler — navigates the tribunal's jurisprudência portal with a browser, takes screenshots of every filter, writes the human-codegen mapping, and scaffolds the Crawler/Navigator/Checker/Testes files. Also use to finish a partially mapped tribunal.
---

# jur-codegen — mapear um tribunal novo

Esta skill executa o processo especificado em [`CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md).
**Leia esse arquivo antes de começar** — ele é a especificação; esta skill é o roteiro.

<HARD-GATE>
NUNCA invente URL de jurisprudência. Descubra navegando e confirme que carrega.
NUNCA marque um tribunal como funcionando sem o checklist de aceite (§7 do CLAUDE-CODEGEN).
SEMPRE grave os três: descrição humana + HTML do elemento + print.
SEMPRE teste cada operador booleano em vez de presumir que funciona.
SEMPRE cheque a aba Network antes de decidir o acesso do crawler.
SEMPRE mapeie no Playwright, com prints, mesmo que o crawler final use `http` ou `api`.
SEMPRE prove que um filtro funciona comparando contagens, não só vendo que a busca responde.
</HARD-GATE>

## Fase 0 — Situar

```bash
node -e "const d=require('./cobertura/tribunais.json');
console.log(JSON.stringify(d.tribunais.find(t=>t.codigo===process.argv[1]),null,2))" TJSC
```

Isso dá o sistema processual, as UFs e o status atual. Depois:

1. Ache o **irmão mais próximo já mapeado** na mesma família (PJe / e-Proc / ESAJ / Projudi)
   em `cobertura/CLAUDE-COBERTURA.md` e leia o `CLAUDE-<IRMAO>.md`. Metade do trabalho está lá.
2. Lembre da ressalva: a família do sistema de **tramitação** é pista, não garantia sobre a
   **jurisprudência** — são sistemas diferentes.

## Fase 1 — Descobrir o portal de jurisprudência

Não é a URL de consulta processual. Se as URLs óbvias falharem, siga
[`cobertura/base/tribunais-brasileiros/method_court_discovery.md`](../../cobertura/base/tribunais-brasileiros/method_court_discovery.md):
portal oficial → "Serviços Processuais" / "Consulta" / "Sistemas" → dropdowns.

Um tribunal pode ter **vários módulos** (TJGO tem 3; TJRJ tem EJURIS + e-Proc; TJSP tem
ESAJ + e-Proc). Liste todos, e comece pelo módulo **principal de jurisprudência** — os
administrativos ficam para depois.

## Fase 2 — Escolher a forma de acesso do CRAWLER: `api` > `http` > `browser`

> ⚠️ Isto decide como o **crawler final** fala com o site. **Não dispensa o browser na Fase 3.**
> O mapeamento é sempre no Playwright, mesmo quando o crawler vai ser `http` puro.

Nesta ordem, sempre. Abra o DevTools na aba Network e **faça uma busca real**:

1. **`api`** — SPA (Angular/React)? Procure um endpoint JSON (`/bff/api/...`, `/rest/...`).
   Se existir, use-o: é ~10× mais rápido e não quebra com CSS.
2. **`http`** — Formulário clássico? Teste `POST`/`GET` direto sem browser. Confirme
   **charset** (ISO-8859-1 é comum em Projudi) e cookies obrigatórios. Exporte um HAR.
3. **`browser`** — Playwright só se as duas acima falharem.

## Fase 3 — Mapear no Playwright (o entregável principal)

**Abra a página no Playwright.** `curl` não serve aqui: combo populado por AJAX chega vazio no
HTML estático (só `<option value="-1">Todos</option>`), e sem browser não há print.
Receita completa em [`CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md) §5, Fase 2 — em resumo:

```js
const { chromium } = require('playwright');
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });          // networkidle = espera o AJAX
await p.screenshot({ path: '.../01.01-tela-inicial.png', fullPage: true });
console.log(await p.locator('form').first().evaluate((e) => e.outerHTML));
for (const s of await p.locator('select').all())          // combos JÁ populados
  console.log(await s.getAttribute('name'),
    await s.locator('option').evaluateAll((o) => o.map((x) => ({ value: x.value, texto: x.textContent.trim() }))));
```

Crie `human-codegen/<TRIBUNAL>/<NN>-<modulo>/` e preencha o
[`MODELO-TRIBUNAL.md`](../../human-codegen/MODELO-TRIBUNAL.md) como `NN-<slug>.txt`.

Para **cada** elemento de tela, os três:

1. **Descrição humana** — para que serve, com exemplo de uso real.
2. **HTML do elemento** — o `<select>` inteiro com todos os `<option value>`; o `<input>`
   com `name` e `id`, extraído do **DOM depois do AJAX**. É isso que o `jur-fixer` usa quando
   o site muda.
3. **Print** — nome no padrão do [`CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md) §3:
   `NN.MM-<slug>.png`. Um por tela **e um por combo/modal aberto**.

Combos gigantes (magistrado, serventia, tipo de ato, assunto) **não cabem em print**:
liste tudo pelo navegador e salve como `magistrados.json`, `unidades.json`,
`tipos-ato.json` ao lado da descrição.

Se um `<select>` só tem "Todos", **presuma AJAX** e reabra no browser — é tipicamente aí que
mora o filtro que separa Justiça Comum de Juizados.

Ao terminar rode:

```bash
node human-codegen/index.js     # gera o INDEX.md e lista o que ficou faltando
```

O `INDEX.md` aponta "seções sem print" e "seções sem descrição" — **zere essas pendências**
antes de escrever código.

## Fase 4 — Testes exploratórios (antes do código)

Rode no navegador e registre o resultado de cada um:

1. Busca simples, sem filtro nem operador
2. Juizados Especiais × Justiça Comum — a desambiguação precisa ficar evidente
3. Cível × Criminal (se o tribunal distinguir; se não, escreva que não distingue)
4. Órgão/Matéria — listando todas as opções
5. Unidade específica (serventia/comarca)
6. Magistrada ou magistrado
7. Tipo de ato — atenção: o tipo óbvio pode ser raro (no TJGO acórdão é publicado como "Ementa")
8. **Número do processo** — alimenta o `Checker`
9. Datas de julgamento **e** de publicação (são filtros diferentes) + cada operador booleano

## Fase 5 — Código

Espelhe o padrão TJGO/TJPA:

| Arquivo | Papel |
|---|---|
| `src/<T>Crawler.js` | Monta filtros, pagina, mapeia para o formato do repo |
| `src/<T>Navigator.js` | Fala com o site: requests, sessão, encoding, inteiro teor |
| `src/<T>Checker.js` | Consulta por nº + validação CNJ + auditoria (`--verificar`) |
| `src/<T>Testes.js` | Integração: `node src/<T>Testes.js` |

Registre o subcomando em `bin/jur` respeitando as flags comuns (`-q -m -o -v --json`) e as
convenções do repo (`-di/-df` em DD/MM/YYYY, `--fetch-inteiro-teor`, `--output-dir`).
Reaproveite `src/BaseCrawler.js`, `src/cnj.js` e `src/inteiroTeorFetcher.js`.

## Fase 6 — Documentar e registrar

1. `CLAUDE-<TRIBUNAL>.md` — escopo, status, flags específicas, exemplos e **ressalvas**.
   As ressalvas são a parte mais valiosa: operadores que não funcionam, tipos de ato
   enganosos, encoding, limites técnicos, bloqueios parciais.
2. Linha na tabela de roteamento do `CLAUDE.md`.
3. Linha na tabela de roteamento de [`../browser/SKILL.md`](../browser/SKILL.md) — **é a que
   de fato roteia o usuário**. Tribunal ausente dela nunca é escolhido, por mais completo que
   esteja o crawler. Inclua também a linha da desambiguação (Juizado × Justiça Comum).
4. `cobertura/build.js` — entradas em `JURISPRUDENCIA` e `REPO` → `node cobertura/build.js`.
5. `tests/smoke.js` — **nada a fazer**: ele deriva a lista da cobertura. Só rode
   `node tests/smoke.js <cmd>` e confirme verde.
6. `node sync-plugin.js` — espelha as skills alteradas no plugin.

## Critério de aceite (§7 do CLAUDE-CODEGEN)

- [ ] `./bin/jur <cmd> -q "termo" -m 1 --json` → `success:true` com resultados
- [ ] Filtro de data restringe de fato (compare contagens com e sem)
- [ ] Paginação anda além da página 1
- [ ] Consulta por nº encontra um processo conhecido
- [ ] `--verificar N` confirma a amostra
- [ ] Página aberta **no Playwright**; print de cada tela e de cada combo/modal aberto
- [ ] Todo `<select>` que só tinha "Todos" no HTML estático foi enumerado no browser
- [ ] **Cada filtro de desambiguação muda a contagem** — rode Justiça Comum e Juizados e
      compare. Contagem igual = filtro ignorado, mesmo que a busca "funcione"
- [ ] `CLAUDE-<TRIBUNAL>.md` com flags e ressalvas
- [ ] Roteamento no `CLAUDE.md` **e** em `skills/browser/SKILL.md`
- [ ] `cobertura/build.js` atualizado + build rodado
- [ ] `node human-codegen/index.js` rodado e `INDEX.md` sem pendências
- [ ] `node tests/smoke.js <cmd>` verde (o smoke lê a cobertura sozinho — não edite o arquivo)

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "É PJe, deve ser igual ao TRF1" | A jurisprudência é outro sistema. Confirme navegando. |
| "Os operadores devem funcionar" | Teste cada um. Muitos viram palavra literal. |
| "O print eu tiro depois" | Sem print o `jur-fixer` não conserta nada. Print é entregável. |
| "Vou usar browser, é mais rápido de escrever" | Cheque o Network. API direta não quebra com CSS. |
| "Vai ser `http`, então nem abro o browser" | O modo de acesso é do crawler. O mapeamento é sempre no browser. |
| "Esse `<select>` só tem 'Todos'" | É AJAX. Abra no browser e enumere. |
| "Retornou resultados, o filtro funciona" | Compare as contagens com e sem. Igual = ignorado. |
| "Achei a URL, está mapeado" | Só é 🟢 com o checklist inteiro. |
| "Esse combo tem 4 mil opções, deixa" | Liste e salve o JSON. É rápido e é o que falta depois. |
| "Documento no fim" | A ressalva descoberta agora você esquece em 10 minutos. |
