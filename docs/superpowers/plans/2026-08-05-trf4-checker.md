# TRF4Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao `jur trf4` verificação anti-alucinação por número de processo (`-n`, `--verificar`, `--datajud`), via browser reutilizando o TRF4Crawler.

**Architecture:** `src/TRF4Checker.js` espelha a interface do TRF2Checker mas dirige o TRF4Crawler (Playwright headless) — uma sessão de browser por consulta, e UMA sessão para a auditoria inteira do `--verificar`. Vazio × indefinido discriminado pelo input `#hdnTotalResultado` (medido em 05/08/2026: com resultados `value="5"`; vazio `value` ausente/vazio; input não presente = página não carregou → erro, nunca "não existe").

**Tech Stack:** Node.js (CommonJS), Playwright via BaseCrawler, `src/cnj.js` (normalizar/validar/pertenceA), DataJud API pública (`api_publica_trf4`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-trf4-checker-design.md`.
- Nunca transformar falha de leitura em "julgado não existe" (regra de ouro dos Checkers).
- Nunca desligar verificação de certificado (decisão deliberada do TRF4Crawler).
- Convenção do repo: cada Checker embute sua cópia do DataJud (sem helper compartilhado).
- `numeroProcesso` do TRF4 vem com sufixo (`5001471-45.2023.4.04.7005/TRF4`) — **sempre** `String(n).split('/')[0]` antes de extrair dígitos (o "/TRF4" contém o dígito 4 e corrompe a comparação).
- Fixtures medidas: real `5001471-45.2023.4.04.7005` (5 documentos); inexistente bem-formado `5009999-99.2023.4.04.7005` (0).
- Testes são ao vivo (convenção do repo — sem mock de tribunal); rede instável do TRF4 = repetir, não afrouxar.

---

### Task 1: Extensões no TRF4Crawler (`origem: 'todas'` + `estadoResultados()`)

**Files:**
- Modify: `jur/src/TRF4Crawler.js` (método `configureFilters`, ~linha 131; novo método após `getTotalResults`)

**Interfaces:**
- Produces: `configureFilters({origem: 'todas'})` seleciona todas as options do `#selOrigem`; `estadoResultados()` → `Promise<{estado: 'itens'|'vazio'|'indefinido', total: number|null}>`.

- [ ] **Step 1: `origem: 'todas'` no configureFilters**

No topo do `configureFilters`, antes do `if (filters.origem === 'turmas-recursais')`, inserir:

```js
    if (filters.origem === 'todas') {
      // Checker: o julgado pode estar no acervo principal ou nas Turmas
      // Recursais — a verificação não presume onde.
      await this.page.evaluate(() => {
        const sel = document.getElementById('selOrigem');
        if (!sel) return;
        for (const opt of sel.options) opt.selected = true;
        if (typeof jQuery !== 'undefined' && jQuery.fn.selectpicker) {
          jQuery('#selOrigem').selectpicker('refresh');
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      console.log('Set origin: todas');
    } else if (filters.origem === 'turmas-recursais') {
```

(e remover o `if` original que este `else if` substitui — a cadeia segue igual.)

- [ ] **Step 2: `estadoResultados()`**

Após `getTotalResults()`:

```js
  /**
   * Vazio × indefinido — medido em 05/08/2026: a página de resultados traz
   * <input name="hdnTotalResultado"> SEMPRE; com resultados value="N", sem
   * resultados value ausente/vazio. Input não presente = a listagem não
   * carregou — para um verificador isso é ERRO, nunca "não existe".
   */
  async estadoResultados() {
    const el = this.page.locator('input[name="hdnTotalResultado"]');
    if (await el.count() === 0) return { estado: 'indefinido', total: null };
    const v = (await el.first().getAttribute('value')) ?? '';
    if (v.trim() === '') return { estado: 'vazio', total: 0 };
    const n = parseInt(v.replace(/\./g, ''), 10);
    return { estado: 'itens', total: Number.isNaN(n) ? null : n };
  }
```

- [ ] **Step 3: Verificação ao vivo**

```bash
cd jur && node -e "
const TRF4Crawler = require('./src/TRF4Crawler');
(async () => {
  const c = new TRF4Crawler({ headless: true });
  await c.init(); await c.navigateToSearch();
  await c.configureFilters({ origem: 'todas' });
  await c.executeSearch('5001471-45.2023.4.04.7005');
  console.log('real:', JSON.stringify(await c.estadoResultados()));
  await c.executeSearch('5009999-99.2023.4.04.7005');
  console.log('falso:', JSON.stringify(await c.estadoResultados()));
  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });"
```

Expected: `real: {"estado":"itens","total":5}` e `falso: {"estado":"vazio","total":0}`. (503/cert expirado = backend ruim: repetir.)

- [ ] **Step 4: Commit**

```bash
git add jur/src/TRF4Crawler.js
git commit -m "feat(trf4): origem 'todas' e estadoResultados() no crawler — base do Checker"
```

---

### Task 2: `src/TRF4Checker.js`

**Files:**
- Create: `jur/src/TRF4Checker.js`

**Interfaces:**
- Consumes: Task 1 (`configureFilters({origem:'todas'})`, `estadoResultados()`); `TRF4Crawler.init/navigateToSearch/executeSearch/extractResults/hasNextPage/goToNextPage/close`; `cnj.normalizar/validar/pertenceA`.
- Produces: `new TRF4Checker({log?, headless?, timeout?})`; `consultarProcesso(numero, {datajud?, crawler?}) → {numero, numeroConsultado, formatoCNJ, numeroValido, trf4, encontrado, total, decisoes[], datajud?}`; `verificarResultados(results, {amostra?, log?}) → {verificados, confirmados, divergentes, detalhes[]}`; CLI `node src/TRF4Checker.js <numero> [--datajud]` exit 0/1.

- [ ] **Step 1: Escrever o arquivo completo**

```js
// src/TRF4Checker.js
const https = require('node:https');
const TRF4Crawler = require('./TRF4Crawler');
const cnj = require('./cnj');

/**
 * Checker do TRF4: consulta por número de processo e auditoria anti-alucinação.
 *
 * Diferença para o TRF2Checker (que é HTTP): o transporte aqui é o TRF4Crawler
 * (Playwright headless) — o eproc do TRF4 tem um pool de backends instável e o
 * crawler já carrega o retry certo (gotoComRetry). Por isso:
 *   - cada consultarProcesso() avulso abre e fecha UMA sessão de browser (~15-25s);
 *   - verificarResultados() abre UMA sessão e a reusa para a amostra inteira
 *     (a página de resultados mantém o formulário — só o executeSearch repete).
 *
 * A consulta marca TODAS as origens (acervo principal + Turmas Recursais):
 * a verificação não deve depender de acertar onde o julgado está.
 *
 * VAZIO × INDEFINIDO: decidido por estadoResultados() (input hdnTotalResultado,
 * medido em 05/08/2026). Listagem não lida = erro, nunca "não existe".
 *
 * ⚠️ O número na busca é TEXTO LIVRE no inteiro teor: além dos documentos DO
 * processo, podem voltar documentos de OUTROS processos que citam o número.
 * Por isso o filtro por igualdade de dígitos do numeroProcesso (sem o sufixo
 * "/TRF4", que contém o dígito 4 e corromperia a comparação).
 *
 * ⚠️ O `id` dos cards (resultado417624486…) é gerado por página, não estável
 * entre consultas — a conferência do verificarResultados é pela tupla
 * numeroProcesso + tipoDocumento + dataJulgamento, não por id.
 *
 * FONTE SECUNDÁRIA (opcional): DataJud (CNJ), índice api_publica_trf4. Só
 * metadados — diz que o PROCESSO existe, não que a DECISÃO citada existe.
 *
 * CLI: node src/TRF4Checker.js <numero-processo> [--datajud]
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_trf4/_search';
const DATAJUD_KEY = process.env.DATAJUD_API_KEY ||
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/** Máximo de páginas varridas por consulta (10 cards/página). */
const MAX_PAGINAS = 3;

/** Dígitos do número SEM o sufixo de origem ("/TRF4" tem dígito e corrompe). */
const soDigitos = (n) => String(n ?? '').split('/')[0].replace(/\D/g, '');

class TRF4Checker {
  constructor(options = {}) {
    this.options = options;
    this.log = options.log ?? (() => {});
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /**
   * @see cnj.validar
   * DV inválido é AVISO, nunca veto: acervos migrados exibem números cujo
   * dígito não fecha e que existem na base. A prova é consultarProcesso().
   */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número é CNJ da Justiça Federal da 4ª Região (justiça 4, tribunal 04). */
  ehProcessoTRF4(numero) { return cnj.pertenceA(numero, 4, 4); }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) { return soDigitos(numero).length === 20; }

  /** Sobe browser + página de busca com TODAS as origens marcadas. @private */
  async _abrirSessao() {
    const crawler = new TRF4Crawler({
      headless: this.options.headless ?? true,
      timeout: this.options.timeout ?? 60000,
    });
    await crawler.init();
    try {
      await crawler.navigateToSearch();
      await crawler.configureFilters({ origem: 'todas' });
    } catch (err) {
      await crawler.close().catch(() => {});
      throw err;
    }
    return crawler;
  }

  /** Uma consulta dentro de uma sessão já aberta. @private */
  async _consultarNaSessao(crawler, formatado) {
    await crawler.executeSearch(formatado);
    const estado = await crawler.estadoResultados();
    // NUNCA transformar "a resposta não veio" em "o julgado não existe".
    // Para um verificador, falhar alto é melhor do que mentir.
    if (estado.estado === 'indefinido') {
      throw new Error(
        `TRF4: a listagem não pôde ser lida para ${formatado} — NÃO é possível ` +
        'afirmar que o julgado não existe. Repita a consulta.',
      );
    }
    if (estado.estado === 'vazio') return { total: 0, decisoes: [] };

    const alvo = soDigitos(formatado);
    const decisoes = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const brutos = await crawler.extractResults();
      decisoes.push(...brutos.filter((d) => soDigitos(d.numeroProcesso) === alvo));
      if (!(await crawler.hasNextPage())) break;
      if (pagina < MAX_PAGINAS) await crawler.goToNextPage();
    }
    return { total: estado.total, decisoes };
  }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara (sufixo "/TRF4" tolerado)
   * @param {Object} options {datajud?:boolean, crawler?:TRF4Crawler} — com
   *   `crawler`, reusa a sessão dada (e NÃO a fecha); sem, abre e fecha a sua.
   */
  async consultarProcesso(numero, options = {}) {
    const digits = soDigitos(numero);
    const base = {
      numero: String(numero ?? ''),
      numeroConsultado: digits,
      formatoCNJ: false,
      numeroValido: false,
      trf4: false,
      encontrado: false,
      total: 0,
      decisoes: [],
    };
    if (!digits) return base;

    const formatoCNJ = this.ehFormatoCNJ(digits);
    const formatado = formatoCNJ ? this.normalizarNumeroCNJ(digits) : String(numero).split('/')[0].trim();

    let crawler = options.crawler ?? null;
    const sessaoPropria = !crawler;
    try {
      if (sessaoPropria) crawler = await this._abrirSessao();
      const r = await this._consultarNaSessao(crawler, formatado);

      const out = {
        ...base,
        numero: formatado,
        formatoCNJ,
        numeroValido: formatoCNJ ? this.validarNumeroCNJ(digits) : null,
        trf4: formatoCNJ ? this.ehProcessoTRF4(digits) : null,
        encontrado: r.decisoes.length > 0,
        total: r.decisoes.length,
        decisoes: r.decisoes.map((d) => ({
          id: d.id,
          tipoDocumento: d.tipoDocumento,
          numeroProcesso: d.numeroProcesso,
          orgaoJulgador: d.orgaoJulgador,
          relator: d.relator,
          uf: d.uf,
          dataJulgamento: d.dataJulgamento,
          dataPublicacao: d.dataPublicacao,
          processoUrl: d.processoUrl,
          inteiroTeorLink: d.inteiroTeorLink,
          ementa: (d.ementa || '').substring(0, 2000),
        })),
      };
      if (options.datajud) out.datajud = await this.consultarDataJud(digits);
      return out;
    } finally {
      if (sessaoPropria && crawler) await crawler.close().catch(() => {});
    }
  }

  /**
   * Fonte secundária: DataJud (CNJ). Metadados apenas — serve para dizer que o
   * PROCESSO existe, não que a DECISÃO citada existe.
   * Nunca lança: devolve `{disponivel:false, erro}` se a API mudar ou a chave
   * pública for rotacionada pelo CNJ.
   */
  consultarDataJud(numero) {
    const digits = String(numero ?? '').replace(/\D/g, '');
    const corpo = JSON.stringify({ size: 5, query: { match: { numeroProcesso: digits } } });
    return new Promise((resolve) => {
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${DATAJUD_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            if (j.error) {
              const e = j.error;
              return resolve({
                disponivel: false,
                erro: [e.type, e.reason, e.root_cause?.[0]?.reason].filter(Boolean).join(' — ') || 'erro do DataJud',
              });
            }
            const hits = j.hits?.hits ?? [];
            resolve({
              disponivel: true,
              encontrado: hits.length > 0,
              total: j.hits?.total?.value ?? hits.length,
              processos: hits.map((h) => ({
                tribunal: h._source?.tribunal,
                grau: h._source?.grau,
                classe: h._source?.classe?.nome,
                orgaoJulgador: h._source?.orgaoJulgador?.nome,
                dataAjuizamento: h._source?.dataAjuizamento,
                ultimaAtualizacao: h._source?.dataHoraUltimaAtualizacao,
              })),
            });
          } catch (e) {
            resolve({ disponivel: false, erro: e.message });
          }
        });
      });
      req.setTimeout(20000, () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ disponivel: false, erro: e.message }));
      req.write(corpo);
      req.end();
    });
  }

  /**
   * Auditoria: amostra N itens, reconsulta cada um por número e confirma que
   * um documento com a MESMA tupla (numeroProcesso + tipoDocumento +
   * dataJulgamento) volta da base. Não usa `id` — no TRF4 ele é gerado por
   * página, não é estável entre consultas.
   *
   * UMA sessão de browser para a amostra inteira (~15-25s por sessão; N
   * sessões seriam N× isso).
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    let crawler = null;
    try {
      crawler = await this._abrirSessao();
      for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
        const r = results[i];
        const numero = r.numeroProcesso ?? r.processo;
        const item = { indice: i, numeroProcesso: numero, confirmado: false, motivo: '' };
        try {
          const digitos = soDigitos(numero);
          if (digitos.length === 20 && !this.validarNumeroCNJ(digitos)) {
            item.avisoDV = 'dígito verificador CNJ não confere';
          } else if (digitos.length !== 20) {
            item.avisoDV = 'número fora do formato CNJ (20 dígitos)';
          }
          const res = await this.consultarProcesso(numero, { crawler });
          if (!res.encontrado) {
            item.motivo = 'processo não encontrado na base';
          } else {
            const doc = res.decisoes.find((d) =>
              (!r.tipoDocumento || d.tipoDocumento === r.tipoDocumento) &&
              (!r.dataJulgamento || d.dataJulgamento === r.dataJulgamento));
            if (!doc) {
              item.motivo = 'processo existe mas nenhum documento com ' +
                `tipo "${r.tipoDocumento}" e julgamento ${r.dataJulgamento} retornou`;
            } else {
              item.confirmado = true;
              item.tipoDocumento = doc.tipoDocumento;
              item.orgaoJulgador = doc.orgaoJulgador;
            }
          }
        } catch (err) {
          item.motivo = `erro na consulta: ${err.message}`;
        }
        log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
        detalhes.push(item);
      }
    } finally {
      if (crawler) await crawler.close().catch(() => {});
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

TRF4Checker.DATAJUD_URL = DATAJUD_URL;

module.exports = TRF4Checker;

// CLI: node src/TRF4Checker.js <numero> [--datajud]
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TRF4Checker.js <numero-processo (CNJ)> [--datajud]');
    process.exit(2);
  }
  new TRF4Checker().consultarProcesso(numero, { datajud: process.argv.includes('--datajud') })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Testar ao vivo — real, falso e DataJud**

```bash
cd jur
node src/TRF4Checker.js 5001471-45.2023.4.04.7005; echo "exit=$?"
node src/TRF4Checker.js 5009999-99.2023.4.04.7005; echo "exit=$?"
node src/TRF4Checker.js 5001471-45.2023.4.04.7005 --datajud | tail -30
```

Expected: real → `encontrado: true`, ≥1 decisão, exit 0; falso → `encontrado: false`, exit 1; `--datajud` → bloco `datajud` com `disponivel: true`.

- [ ] **Step 3: Medir a suspeita do id (registro, não bloqueio)**

Rodar a consulta real duas vezes e comparar `decisoes[0].id`. Se divergirem, a decisão da tupla está confirmada (documentar o valor medido no commit). Se coincidirem, manter tupla mesmo assim (id estável hoje não é garantia) e registrar no doc.

- [ ] **Step 4: Commit**

```bash
git add jur/src/TRF4Checker.js
git commit -m "feat(trf4): TRF4Checker — verificação por número via browser (uma sessão p/ auditoria)"
```

---

### Task 3: Wiring no `bin/jur`

**Files:**
- Modify: `jur/bin/jur` (imports ~linha 6; comando trf4 ~linhas 70-86; action ~87+)

**Interfaces:**
- Consumes: Task 2 (`TRF4Checker.consultarProcesso`, `verificarResultados`).
- Produces: `jur trf4 -n <numero> [--datajud] [--json]` exit 0/1; `jur trf4 -q … --verificar [N]` acopla `verificacao` ao resumo.

- [ ] **Step 1: Import**

Junto aos requires do topo: `const TRF4Checker = require('../src/TRF4Checker');`

- [ ] **Step 2: Flags**

Trocar `.requiredOption('-q, --query <text>', 'Search query')` por:

```js
  .option('-q, --query <text>', 'Search query')
  .option('-n, --numero <numero>', 'Consulta direta por numero de processo (CNJ) — usa o TRF4Checker (browser)')
  .option('--verificar [amostra]', 'Audit results: re-query N sampled processos against the base (default 5)')
  .option('--datajud', 'Com -n: consulta tambem o DataJud (CNJ) como fonte secundaria de metadados')
```

- [ ] **Step 3: Bloco `-n` no início da action (antes de qualquer log de busca)**

```js
    // Modo consulta direta por numero (TRF4Checker) — a verificacao de um julgado
    if (opts.numero) {
      const checker = new TRF4Checker({ log, headless: !(opts.visible || opts.headed) });
      const res = await checker.consultarProcesso(opts.numero, { datajud: !!opts.datajud });
      if (jsonMode) process.stdout.write(JSON.stringify({ success: true, ...res }) + '\n');
      else console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    }
    if (!opts.query) throw new Error('Informe -q "<termos>" (ou -n <numero> para consulta direta)');
```

(Atenção ao tratamento de erro da action: se o catch geral imprime `{success:false}` e sai com 1, o throw acima cai nele — verificar que o `-n` roda ANTES dos logs de cabeçalho da busca.)

- [ ] **Step 4: `--verificar` após a coleta**

Localizar no action do trf4 onde os resultados finais existem (antes da escrita do resumo/output; espelhar o padrão do trf2, `bin/jur` ~linhas 398-401):

```js
      let verificacao = null;
      if (opts.verificar) {
        const amostra = opts.verificar === true ? 5 : parseInt(opts.verificar, 10);
        log(`\nVerificando ${amostra} resultados contra a base (browser, uma sessão)...`);
        verificacao = await new TRF4Checker({ log }).verificarResultados(results, { amostra, log });
      }
```

e acoplar `...(verificacao ? { verificacao } : {})` ao objeto do resumo `--json`, como no trf2.

- [ ] **Step 5: Testar CLI ao vivo**

```bash
cd jur
./bin/jur trf4 -n 5001471-45.2023.4.04.7005 --json; echo "exit=$?"
./bin/jur trf4 -n 5009999-99.2023.4.04.7005 --json; echo "exit=$?"
./bin/jur trf4 -q "Tuicial" -m 1 --verificar 2 --json | tail -1
./bin/jur trf4 --json 2>&1 | tail -1   # sem -q e sem -n → erro claro
```

Expected: exits 0, 1; resumo com `"verificacao":{"verificados":2,...}`; erro "Informe -q".

- [ ] **Step 6: Commit**

```bash
git add jur/bin/jur
git commit -m "feat(trf4): flags -n, --verificar e --datajud no comando trf4"
```

---

### Task 4: Documentação e skill verificador

**Files:**
- Modify: `jur/CLAUDE-TRF4.md` (nota "Não existe flag `-n`", ~linha 40)
- Modify: `jur/CLAUDE.md` (linha do trf4 na tabela de roteamento)
- Modify: `jur/skills/browser/SKILL.md` (se citar a ausência de checker do TRF4 — grep antes)
- Create: `jur/skills/verificador/tribunais/trf4.md` (usar `trf2.md` como molde — ler antes)
- Run: `node sync-plugin.js` (espelha skills no plugin)

- [ ] **Step 1: CLAUDE-TRF4.md**

Substituir a nota "**Não existe flag `-n`.** …" por:

```markdown
- **Verificação por número: `-n` (TRF4Checker).** `./bin/jur trf4 -n <CNJ>` consulta a
  base marcando TODAS as origens (acervo principal + Turmas Recursais) e devolve exit 0
  se o julgado existe, 1 se não. `--datajud` acrescenta o DataJud como fonte secundária
  (metadados do PROCESSO, não da decisão). `--verificar [N]` audita uma busca reconsultando
  N amostras — numa ÚNICA sessão de browser (cada sessão custa 15-25s).
  ⚠️ O `id` dos cards é gerado por página (não estável): a conferência é pela tupla
  numeroProcesso + tipoDocumento + dataJulgamento.
  ⚠️ Vazio × indefinido: decidido pelo input `hdnTotalResultado` (medido 05/08/2026);
  listagem não lida vira ERRO ("repita"), nunca "não existe".
```

- [ ] **Step 2: CLAUDE.md + skill browser**

`grep -n "trf4" jur/CLAUDE.md jur/skills/browser/SKILL.md` e atualizar menções de "verificação parcial / sem checker" do TRF4. Na tabela de status, manter 🟢 e acrescentar "(com Checker `-n`)" se as outras linhas seguirem esse padrão — conferir o estilo das linhas vizinhas.

- [ ] **Step 3: skills/verificador/tribunais/trf4.md**

Ler `jur/skills/verificador/tribunais/trf2.md` e escrever o trf4.md no mesmo formato, com: comando `jur trf4 -n`, fixtures reais medidas, a ressalva do id por página, a regra vazio×indefinido, e o custo browser (15-25s por sessão). Rodar `node sync-plugin.js` depois.

- [ ] **Step 4: cobertura**

`grep -rn "checker" jur/cobertura/build.js jur/cobertura/tribunais.json | head` — se houver campo de checker por tribunal, marcar o TRF4 e rodar `npm run docs`.

- [ ] **Step 5: Commit**

```bash
git add jur/CLAUDE-TRF4.md jur/CLAUDE.md jur/skills/ plugins/ jur/cobertura/ 2>/dev/null
git commit -m "docs(trf4): checker -n/--verificar/--datajud documentado (CLAUDE, skills, cobertura)"
```

---

### Task 5: Aceite mecânico

**Files:**
- Test: `jur/tests/aceite.js` (já genérico — item "Checker: nº real encontra, nº falso não")

- [ ] **Step 1: Rodar o aceite do TRF4**

```bash
cd jur && node tests/aceite.js TRF4 --sem-desambiguacao
```

Expected: item do Checker ✅ (real exit 0, falso `9999999-99.2099.8.99.9999` exit 1). Itens não relacionados ao Checker que falharem por pré-existência (ex.: seção do CLAUDE-TRF4.md) são registrados, não corrigidos em silêncio — reportar ao usuário.

- [ ] **Step 2: Smoke não regride**

```bash
cd jur && node tests/smoke.js 2>&1 | tail -5
```

Expected: TRF4 continua 🟢 (busca intacta).

- [ ] **Step 3: Commit final (se sobrou ajuste)**

```bash
git add -A jur/ && git commit -m "test(trf4): aceite do checker passa (real=0, falso=1)"
```

## Self-review

- Cobertura do spec: flags (T3), arquitetura/fluxo (T2), origem todas + vazio×indefinido (T1), id/tupla (T2 §3), sessão única no --verificar (T2), DataJud (T2), docs+skill (T4), testes (T5). Fora de escopo respeitado (sem HTTP, sem helper DataJud).
- Sem placeholders; código completo nos passos.
- Tipos consistentes: `estadoResultados()` consumido em T2; `soDigitos` trata o sufixo "/TRF4" nos dois pontos que comparam número.
