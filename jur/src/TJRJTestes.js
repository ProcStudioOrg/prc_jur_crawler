// src/TJRJTestes.js
// Suíte de testes do stack TJRJ (Navigator, Crawler, Checker) — módulo e-Proc.
// Bate no site real — precisa de rede. Uso:
//   node src/TJRJTestes.js            # suíte completa
//   node src/TJRJTestes.js --rapido   # pula download em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJRJNavigator = require('./TJRJNavigator');
const TJRJCrawler = require('./TJRJCrawler');
const TJRJChecker = require('./TJRJChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    const ms = Date.now() - inicio;
    console.log(`PASS (${ms}ms)`);
    resultados.push({ nome, ok: true, ms });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log('='.repeat(60));
  console.log('TJRJ — Testes de integração (site real, e-Proc)');
  console.log('='.repeat(60));

  const navigator = new TJRJNavigator();
  const checker = new TJRJChecker({ navigator });
  // estado compartilhado entre testes
  let julgadoBase = null;
  let totalBaseline = 0;

  await teste('Combos AJAX: classes, relatores e órgãos chegam populados', async () => {
    const listas = await navigator.listas();
    assert(listas.classes.length > 10, `lista de classes suspeita (${listas.classes.length})`);
    assert(listas.relatores.length > 100, `lista de relatores suspeita (${listas.relatores.length})`);
    assert(listas.orgaos.length > 20, `lista de órgãos suspeita (${listas.orgaos.length})`);
    assert(listas.orgaos.some((o) => /Câmara de Direito/.test(o)), 'sem Câmaras na lista de órgãos');
  });

  await teste('Busca simples: "dano moral" na ementa retorna campos-chave', async () => {
    const r = await navigator.buscar({ query: '"dano moral"', escopo: 'E', tiposDocumento: ['1'] });
    assert(r.total > 100, `total suspeito: ${r.total}`);
    assert(r.resultados.length === TJRJNavigator.POR_PAGINA,
      `esperava ${TJRJNavigator.POR_PAGINA} itens, veio ${r.resultados.length}`);
    const d = r.resultados[0];
    for (const campo of ['id', 'tipoDocumento', 'numeroProcesso', 'classe', 'orgaoJulgador',
      'dataJulgamento', 'relator', 'ementa', 'inteiroTeorLink']) {
      assert(d[campo], `campo vazio: ${campo}`);
    }
    assert(d.uf === 'RJ', `uf incorreta: ${d.uf}`);
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataJulgamento), `data fora de DD/MM/YYYY: ${d.dataJulgamento}`);
    julgadoBase = d;
    totalBaseline = r.total;
  });

  await teste('Filtro de data de julgamento restringe a contagem de fato', async () => {
    const r = await navigator.buscar({
      query: '"dano moral"', escopo: 'E', tiposDocumento: ['1'],
      dataDecisaoInicio: '01/06/2026', dataDecisaoFim: '30/06/2026',
    });
    assert(r.total > 0, 'nenhum resultado no período');
    assert(r.total < totalBaseline, `filtro ignorado: ${r.total} = baseline ${totalBaseline}`);
    const chave = (s) => s.split('/').reverse().join('');
    for (const d of r.resultados) {
      assert(chave(d.dataJulgamento) >= '20260601' && chave(d.dataJulgamento) <= '20260630',
        `data fora do intervalo: ${d.dataJulgamento}`);
    }
  });

  await teste('Tipo de documento: monocráticas ≠ acórdãos e o rótulo confere', async () => {
    const r = await navigator.buscar({ query: '"dano moral"', escopo: 'E', tiposDocumento: ['2'] });
    assert(r.total > 0 && r.total !== totalBaseline, `filtro de tipo ignorado (${r.total})`);
    assert(/monocr/i.test(r.resultados[0].tipoDocumento),
      `tipo vazou: ${r.resultados[0].tipoDocumento}`);
  });

  await teste('Escopo inteiro teor amplia a contagem sobre a ementa', async () => {
    const r = await navigator.buscar({ query: '"dano moral"', escopo: 'I', tiposDocumento: ['1'] });
    assert(r.total > totalBaseline, `esperava mais que ${totalBaseline} no inteiro teor, veio ${r.total}`);
  });

  await teste('Paginação AJAX: página 2 traz ids distintos da página 1', async () => {
    const p1 = await navigator.buscar({ query: '"dano moral"', escopo: 'E', tiposDocumento: ['1'] });
    const p2 = await navigator.buscar({ query: '"dano moral"', escopo: 'E', tiposDocumento: ['1'], pagina: 2 });
    assert(p2.pagina === 2, `hdnPaginaAtual não avançou: ${p2.pagina}`);
    const ids1 = new Set(p1.resultados.map((d) => d.id));
    assert(p2.resultados.length > 0, 'página 2 vazia');
    // o desempate da ordenação oscila entre requisições e a fronteira das
    // páginas desliza 1–2 documentos (ver CLAUDE-TJRJ.md); o que não pode é a
    // página 2 ser a página 1 de novo
    const repetidos = p2.resultados.filter((d) => ids1.has(d.id)).length;
    assert(repetidos <= 3, `página 2 repetiu ${repetidos}/10 ids da página 1`);
  });

  await teste('Filtro por órgão julgador (label) restringe a contagem', async () => {
    const r = await navigator.buscar({
      query: '"dano moral"', escopo: 'E', tiposDocumento: ['1'],
      orgaos: [julgadoBase.orgaoJulgador],
    });
    assert(r.total > 0, 'nenhum resultado com o órgão do julgado base');
    assert(r.total < totalBaseline, `filtro de órgão ignorado: ${r.total} = ${totalBaseline}`);
    for (const d of r.resultados) {
      assert(d.orgaoJulgador === julgadoBase.orgaoJulgador,
        `órgão vazou: ${d.orgaoJulgador}`);
    }
  });

  await teste('Operadores: E restringe, OU amplia, latin-1 não corrompe acento', async () => {
    const [e, ou, soDrogas, acento] = [
      await navigator.buscar({ query: 'crime e "dano moral"', escopo: 'E', tiposDocumento: ['1'] }),
      await navigator.buscar({ query: 'drogas ou entorpecentes', escopo: 'E', tiposDocumento: ['1'] }),
      await navigator.buscar({ query: 'drogas', escopo: 'E', tiposDocumento: ['1'] }),
      await navigator.buscar({ query: '"gratuidade de justiça"', escopo: 'E', tiposDocumento: ['1'] }),
    ];
    assert(e.total > 0 && e.total < totalBaseline, `operador E não restringiu (${e.total})`);
    assert(ou.total >= soDrogas.total, `OU (${ou.total}) < termo isolado (${soDrogas.total})`);
    assert(acento.total > 100, `acento provavelmente corrompido: ${acento.total} resultados`);
  });

  await teste('Checker: consulta por processo confirma julgado da busca', async () => {
    const res = await checker.consultarProcesso(julgadoBase.numeroProcesso);
    assert(res.tjrj, 'número não é do segmento TJRJ (J=8, TR=19)');
    assert(res.encontrado, 'processo não encontrado na base');
    assert(res.decisoes.some((d) => String(d.id) === String(julgadoBase.id)),
      `id ${julgadoBase.id} não retornou na consulta por processo`);
  });

  await teste('Checker/cnj: valida DV, rejeita DV errado, reconhece TJRJ', async () => {
    const cnj = require('./cnj');
    assert(cnj.validar('0837546-34.2023.8.19.0038') === true, 'número válido rejeitado');
    assert(cnj.validar('0837546-35.2023.8.19.0038') === false, 'DV errado aceito');
    assert(cnj.pertenceA('0837546-34.2023.8.19.0038', 8, 19) === true, 'pertenceA falhou');
  });

  await teste('Crawler end-to-end: search() pagina e mapeia o formato do repo', async () => {
    const crawler = new TJRJCrawler({ log: () => {} });
    const results = await crawler.search('"dano moral"', { tipo: 'acordao' }, { maxPages: 2 });
    // o desempate da ordenação oscila no servidor (ver CLAUDE-TJRJ.md): entre
    // duas requisições a fronteira das páginas se move e o dedup descarta
    // repetidos — 20 é o teto, um pequeno déficit é comportamento do site
    assert(results.length >= 15 && results.length <= 20,
      `esperava 15–20 resultados únicos em 2 páginas, veio ${results.length}`);
    const ids = new Set(results.map((r) => r.id));
    assert(ids.size === results.length, 'dedup falhou: ids repetidos na saída');
    assert(crawler.ultimaBusca.totalTJRJ > 100, 'ultimaBusca.totalTJRJ ausente');
    const r = results[0];
    for (const campo of ['id', 'tipoDocumento', 'numeroProcesso', 'orgaoJulgador',
      'dataJulgamento', 'relator', 'uf', 'ementa', 'inteiroTeorLink']) {
      assert(r[campo] !== undefined && r[campo] !== '', `campo vazio: ${campo}`);
    }
    assert(r.tribunal === 'TJRJ', 'tribunal incorreto');
  });

  await teste('Checker: verificarResultados audita amostra da busca', async () => {
    const crawler = new TJRJCrawler({ log: () => {} });
    const results = await crawler.search('"execução fiscal"', { tipo: 'acordao' }, { maxPages: 1 });
    const audit = await checker.verificarResultados(results, { amostra: 3 });
    assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
    assert(audit.confirmados === 3,
      `divergências na auditoria: ${JSON.stringify(audit.detalhes.filter((d) => !d.confirmado))}`);
  });

  if (!rapido) {
    await teste('Crawler: baixa inteiro teor (.txt) em disco com index.json', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjrj-testes-'));
      try {
        const crawler = new TJRJCrawler({ log: () => {} });
        const lote = await crawler.fetchInteiroTeorBatch([julgadoBase], dir, { log: () => {} });
        assert(lote[0].arquivo, 'fetchInteiroTeorBatch não gravou arquivo');
        const size = fs.statSync(path.join(dir, lote[0].arquivo)).size;
        assert(size > 2000, `arquivo muito pequeno (${size} bytes)`);
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  console.log('='.repeat(60));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`${resultados.length - falhas.length}/${resultados.length} testes passaram`);
  if (falhas.length) {
    for (const f of falhas) console.log(`  FAIL: ${f.nome} — ${f.erro}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
