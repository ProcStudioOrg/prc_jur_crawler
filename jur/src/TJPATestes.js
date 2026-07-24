// src/TJPATestes.js
// Suíte de testes do stack TJPA (Navigator, Crawler, Checker).
// Bate na API real — precisa de rede. Uso:
//   node src/TJPATestes.js            # suíte completa
//   node src/TJPATestes.js --rapido   # pula download em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJPANavigator = require('./TJPANavigator');
const TJPACrawler = require('./TJPACrawler');
const TJPAChecker = require('./TJPAChecker');

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
  console.log('TJPA — Testes de integração (API real)');
  console.log('='.repeat(60));

  // a API do TJPA oscila (504 em buscas pesadas) — retries altos na suíte
  const navigator = new TJPANavigator({ retries: 4 });
  const checker = new TJPAChecker({ navigator });
  // estado compartilhado entre testes
  let decisaoBruta = null;

  await teste('API acessível: GET /filtros retorna origens e relatores', async () => {
    const filtros = await navigator.obterFiltros();
    assert(Array.isArray(filtros.origens) && filtros.origens.length >= 2,
      `esperava 2 origens, veio ${filtros.origens?.length}`);
    assert(filtros.relatores?.length > 50, 'lista de relatores suspeita');
    assert(filtros.classes?.length > 50, 'lista de classes suspeita');
  });

  await teste('Pesquisa livre: "furto" retorna resultados com campos-chave', async () => {
    const data = await navigator.buscar({ query: 'furto', size: 3 });
    assert(data.totalElements > 0, 'totalElements = 0');
    assert(data.content.length === 3, `esperava 3, veio ${data.content.length}`);
    const d = data.content[0];
    for (const campo of ['id', 'numeroprocesso', 'tipo', 'datajulgamento']) {
      assert(d[campo] != null, `campo ausente: ${campo}`);
    }
    assert((d.ementatextopuro || d.textoementa), 'sem ementa');
    assert((d.textopuro || d.textooriginal), 'sem inteiro teor');
    decisaoBruta = d;
  });

  await teste('Filtro de datas: julgamentos ficam dentro do intervalo', async () => {
    const data = await navigator.buscar({
      query: 'dano moral',
      dataJulgamentoInicio: '2024-01-01',
      dataJulgamentoFim: '2024-06-30',
      size: 10,
    });
    assert(data.totalElements > 0, 'nenhum resultado no período');
    for (const d of data.content) {
      assert(d.datajulgamento >= '2024-01-01' && d.datajulgamento <= '2024-06-30',
        `data fora do intervalo: ${d.datajulgamento}`);
    }
  });

  await teste('Paginação: página 0 e página 1 trazem ids distintos', async () => {
    const [p0, p1] = await Promise.all([
      navigator.buscar({ query: 'furto', size: 5, page: 0 }),
      navigator.buscar({ query: 'furto', size: 5, page: 1 }),
    ]);
    const ids0 = new Set(p0.content.map(d => d.id));
    assert(p1.content.length > 0, 'página 1 vazia');
    assert(!p1.content.some(d => ids0.has(d.id)), 'páginas retornaram ids repetidos');
  });

  await teste('Escopo inteiroTeor e queryType anywords funcionam', async () => {
    // consulta curta de propósito: buscas pesadas no inteiro teor derrubam o
    // gateway deles (504); os retries do navigator cobrem oscilações
    const data = await navigator.buscar({
      query: 'furto',
      queryScope: 'inteiroTeor',
      queryType: 'anywords',
      size: 1,
    });
    assert(data.totalElements > 0, 'nenhum resultado com escopo inteiroTeor');
  });

  await teste('Checker: consulta por processo confirma decisão da busca', async () => {
    const res = await checker.consultarProcesso(decisaoBruta.numeroprocesso);
    // numeroValido NÃO é exigido: acervo legado (Libra) tem DV que não fecha
    assert(res.tjpa, 'número não é do segmento TJPA (J=8, TR=14)');
    assert(res.encontrado, 'processo não encontrado na base');
    assert(res.decisoes.some(d => String(d.id) === String(decisaoBruta.id)),
      `id ${decisaoBruta.id} não retornou na consulta por processo`);
  });

  await teste('Checker/cnj: valida DV moderno, rejeita DV errado, avisa legado', async () => {
    const cnj = require('./cnj');
    // número moderno (PJe) com DV correto
    assert(cnj.validar('0010095-26.2017.8.14.0003') === true, 'número válido rejeitado');
    assert(cnj.validar('0010095-27.2017.8.14.0003') === false, 'DV errado aceito');
    assert(cnj.validar('abc') === false, 'lixo aceito');
    // número legado migrado do Libra: DV não fecha (comportamento documentado)
    assert(cnj.validar('0009553-49.2007.8.14.0006') === false,
      'esperava DV legado inválido — se passou, a base mudou');
    assert(cnj.normalizar('00100952620178140003') === '0010095-26.2017.8.14.0003',
      'normalização falhou');
    assert(cnj.pertenceA('0010095-26.2017.8.14.0003', 8, 14) === true, 'pertenceA falhou');
    assert(cnj.decompor('0010095-26.2017.8.14.0003').justicaNome === 'Justiça Estadual',
      'decompor falhou');
  });

  await teste('Checker: consulta por número de documento (acórdão)', async () => {
    const numeroDoc = String(decisaoBruta.id).replace(/^9999/, '');
    const res = await checker.consultarDocumento(numeroDoc);
    assert(res.encontrado, `documento ${numeroDoc} não encontrado`);
    assert(res.decisoes.some(d => String(d.id) === String(decisaoBruta.id)),
      'id não confere na busca por documento');
  });

  await teste('Crawler end-to-end: search() mapeia campos padrão do repo', async () => {
    const crawler = new TJPACrawler({ pageSize: 5, log: () => {} });
    const orig = console.log; console.log = () => {}; // silencia logs internos
    let results;
    try {
      results = await crawler.search('apelação', {
        dataJulgamentoInicio: '01/01/2024',
        dataJulgamentoFim: '31/12/2024',
        tipo: 'acordao',
        ordenacao: 'recentes',
      }, { maxPages: 2 });
    } finally { console.log = orig; }
    assert(results.length === 10, `esperava 10 resultados (2 páginas), veio ${results.length}`);
    assert(results.totalResults > 0, 'totalResults ausente');
    const r = results[0];
    for (const campo of ['id', 'tipoDocumento', 'numeroProcesso', 'processoUrl',
      'orgaoJulgadorColegiado', 'dataJulgamento', 'relator', 'uf', 'ementa', 'inteiroTeorLink']) {
      assert(r[campo] !== undefined && r[campo] !== '', `campo vazio: ${campo}`);
    }
    assert(r.uf === 'PA', 'uf incorreta');
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(r.dataJulgamento), `data não está em DD/MM/YYYY: ${r.dataJulgamento}`);
    assert(r.tipoDocumento === 'Acórdão', `filtro tipo=acordao vazou: ${r.tipoDocumento}`);
    // ordenação client-side por julgamento mais recente
    const chave = s => s.split('/').reverse().join('');
    for (let i = 1; i < results.length; i++) {
      assert(chave(results[i - 1].dataJulgamento) >= chave(results[i].dataJulgamento),
        'ordenação "recentes" não está decrescente');
    }
  });

  await teste('Checker: verificarResultados audita amostra da busca', async () => {
    const crawler = new TJPACrawler({ pageSize: 5 });
    const orig = console.log; console.log = () => {};
    let results;
    try {
      results = await crawler.search('roubo', {}, { maxPages: 1 });
    } finally { console.log = orig; }
    const audit = await checker.verificarResultados(results, { amostra: 3 });
    assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
    assert(audit.confirmados === 3,
      `divergências na auditoria: ${JSON.stringify(audit.detalhes.filter(d => !d.confirmado))}`);
  });

  if (!rapido) {
    await teste('Navigator: salva inteiro teor (.txt e .html) em disco', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjpa-testes-'));
      try {
        const files = navigator.salvarDecisao(decisaoBruta, dir, { formats: ['txt', 'html'] });
        assert(files.length === 2, `esperava 2 arquivos, veio ${files.length}`);
        for (const f of files) {
          const size = fs.statSync(path.join(dir, f)).size;
          assert(size > 200, `arquivo ${f} muito pequeno (${size} bytes)`);
        }
        const lote = await navigator.baixarLote([decisaoBruta], dir, { log: () => {} });
        assert(lote[0].arquivo, 'baixarLote não gravou arquivo');
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  console.log('='.repeat(60));
  const falhas = resultados.filter(r => !r.ok);
  console.log(`${resultados.length - falhas.length}/${resultados.length} testes passaram`);
  if (falhas.length) {
    for (const f of falhas) console.log(`  FAIL: ${f.nome} — ${f.erro}`);
    process.exit(1);
  }
})().catch(err => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
