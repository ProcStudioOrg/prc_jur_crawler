# Hub e lista de falhas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir o hub a no máximo 120 linhas e substituir a matriz humana de cobertura por uma lista gerada somente com falhas.

**Architecture:** O JSON atual permanece como catálogo interno. `cobertura/build.js` gera uma visão Markdown negativa e os documentos operacionais passam a apontar para ela; detalhes continuam nos guias por tribunal.

**Tech Stack:** Node.js 22, `node:test`, Markdown, shell, gerador documental existente.

**Spec:** `docs/superpowers/specs/2026-08-30-hub-e-falhas-design.md`

## Global Constraints

- `jur/CLAUDE.md` deve ter no máximo 120 linhas.
- `cobertura/tribunais.json` não muda de formato nem de consumidores.
- TJSP usa status `instavel`; STJ usa `sem-acesso`.
- Ressalvas técnicas pertencem somente a `CLAUDE-<TRIBUNAL>.md`.
- Preservar as alterações preexistentes do usuário e não criar commit automático no worktree sujo.

---

### Task 1: Gerador da lista negativa

**Files:**
- Create: `jur/tests/falhas-documentacao.test.js`
- Modify: `jur/cobertura/build.js`
- Create: `jur/cobertura/CLAUDE-FALHAS.md`
- Delete: `jur/cobertura/CLAUDE-COBERTURA.md`

**Interfaces:**
- Consumes: `build().tribunais[].jurisprudencia.status`
- Produces: `renderFalhas(data): string` e `cobertura/CLAUDE-FALHAS.md`

- [ ] **Step 1: Escrever teste que executa o gerador e valida somente exceções**

```js
test('gera lista humana somente com falhas', () => {
  execFileSync(process.execPath, ['cobertura/build.js'], { cwd: JUR });
  const md = readFileSync(join(JUR, 'cobertura/CLAUDE-FALHAS.md'), 'utf8');
  assert.match(md, /\| STJ \| sem-acesso \|/);
  assert.match(md, /\| TJSP \| instavel \|/);
  assert.doesNotMatch(md, /\| TJPR \|/);
  assert.equal(existsSync(join(JUR, 'cobertura/CLAUDE-COBERTURA.md')), false);
});
```

- [ ] **Step 2: Rodar o teste e confirmar falha pela ausência do novo arquivo**

Run: `cd jur && node --test tests/falhas-documentacao.test.js`
Expected: FAIL apontando `CLAUDE-FALHAS.md` ausente.

- [ ] **Step 3: Implementar `renderFalhas`, marcar TJSP como instável e remover saída antiga**

O Markdown deve conter uma tabela com `Tribunal`, `Estado`, `Cmd`, `Motivo` e
`Guia`; filtrar `status !== 'ok'`. O gerador deve apagar o arquivo legado se ele
existir.

- [ ] **Step 4: Rodar o teste focal**

Run: `cd jur && node --test tests/falhas-documentacao.test.js`
Expected: PASS.

### Task 2: Hub e TODO mínimos

**Files:**
- Modify: `jur/CLAUDE.md`
- Modify: `TODO.md`
- Modify: `CLAUDE.md`
- Modify: `jur/CLAUDE-TJSP.md`

**Interfaces:**
- Consumes: guias `jur/CLAUDE-*.md` e `CLAUDE-FALHAS.md`
- Produces: roteamento humano sem detalhes duplicados

- [ ] **Step 1: Reescrever o hub com tabelas compactas por ramo**

Preservar o fluxo obrigatório, mapear comandos para guias e omitir qualquer
ressalva operacional. Medir com `wc -l jur/CLAUDE.md`.

- [ ] **Step 2: Limpar o TODO para as pendências reais**

Manter 16 TCEs, 5 TCMs, CRPS/CDP e extensões opcionais do CARF. Remover itens já
concluídos e `jur-web`.

- [ ] **Step 3: Corrigir o guia do TJSP**

Descrever o estado como incerto/instável, dependente do comportamento diário do
reCAPTCHA, sem afirmar funcionamento garantido.

- [ ] **Step 4: Atualizar a raiz para a invariante negativa**

Trocar referências a “cobertura gerada” por “falhas geradas”; manter o JSON
descrito somente como catálogo interno.

### Task 3: Consumidores documentais e skills

**Files:**
- Modify: `jur/CLAUDE-CODEGEN.md`
- Modify: `jur/FILA-TRIBUNAIS.md`
- Modify: `jur/skills/browser/SKILL.md`
- Modify: `jur/skills/codegen/SKILL.md`
- Modify: `jur/skills/improve-user-prompt/SKILL.md`
- Regenerate: `plugins/jur-tribunais/skills/**`

**Interfaces:**
- Consumes: `cobertura/CLAUDE-FALHAS.md`
- Produces: regra uniforme “se não aparece em falhas, siga para o guia”

- [ ] **Step 1: Substituir referências operacionais à matriz antiga**

Run after edit: `rg -n 'CLAUDE-COBERTURA' CLAUDE.md TODO.md jur/CLAUDE*.md jur/FILA-TRIBUNAIS.md jur/skills plugins/jur-tribunais/skills`
Expected: nenhum resultado.

- [ ] **Step 2: Sincronizar as skills empacotadas**

Run: `cd jur && node sync-plugin.js`
Expected: skills do plugin atualizadas a partir de `jur/skills`.

- [ ] **Step 3: Verificar sincronização**

Run: `cd jur && node sync-plugin.js --check`
Expected: exit 0.

### Task 4: Verificação local completa

**Files:**
- Verify only

**Interfaces:**
- Consumes: todos os artefatos anteriores
- Produces: evidência local de consistência

- [ ] **Step 1: Regenerar documentação**

Run: `cd jur && npm run docs`
Expected: `CLAUDE-FALHAS.md` regenerado sem recriar `CLAUDE-COBERTURA.md`.

- [ ] **Step 2: Verificar links e teto do hub**

Run: `test "$(wc -l < jur/CLAUDE.md)" -le 120`
Expected: exit 0.

- [ ] **Step 3: Rodar testes unitários**

Run: `cd jur && npm test`
Expected: exit 0.

- [ ] **Step 4: Rodar testes de browser**

Run: `cd jur && npm run test:browser`
Expected: exit 0.

- [ ] **Step 5: Rodar aceite**

Run: `cd jur && npm run aceite`
Expected: exit 0.

- [ ] **Step 6: Rodar smoke informativo**

Run: `cd jur && npm run smoke`
Expected: registrar falhas externas separadamente de regressões locais; não reclassificar automaticamente portais por uma única rodada.
