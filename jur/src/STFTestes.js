// src/STFTestes.js
// Suíte de integração do stack STF (Navigator, Crawler, Checker).
// Bate na API real — precisa de rede. Uso:
//   node src/STFTestes.js            # suíte completa
//   node src/STFTestes.js --rapido   # pula I/O em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const STFNavigator = require('./STFNavigator');
const STFCrawler = require('./STFCrawler');
const STFChecker = require('./STFChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    console.log(`PASS (${Date.now() - inicio}ms)`);
    resultados.push({ nome, ok: true });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  console.log('='.repeat(60));
  console.log('STF — Testes de integração (API real)');
  console.log('='.repeat(60));

  const navigator = new STFNavigator();
  const crawler = new STFCrawler({ navigator, log: () => {} });
  const checker = new STFChecker({ navigator, log: () => {} });

  await teste('Token do AWS WAF: obtido (browser) ou reaproveitado do cache', async () => {
    const c = await navigator.token();
    assert(/aws-waf-token=/.test(c), 'cookie aws-waf-token ausente');
  });

  await teste('Pré-processamento traduz os operadores em português', () => {
    const p = STFNavigator.preprocessarQuery;
    assert(p('dano e moral') === 'dano AND moral', `E: ${p('dano e moral')}`);
    assert(p('droga ou entorpecente') === 'droga OR entorpecente', `OU: ${p('droga ou entorpecente')}`);
    assert(p('prisão não preventiva') === 'prisão NOT preventiva', `NÃO: ${p('prisão não preventiva')}`);
    assert(p('indeniz$') === 'indeniz*', `$: ${p('indeniz$')}`);
    // dentro de aspas o operador é literal
    assert(p('princípio da "não" culpabilidade') === 'princípio da "não" culpabilidade', 'aspas anulam operador');
    // proximidade com OU expande em permutações
    assert(p('"(indenização ou reparação) danos morais"~5')
      === '("indenização danos morais"~5 OR "reparação danos morais"~5)', 'expansão de " "~N');
  });

  await teste('Busca simples: "dano moral" em acórdãos retorna resultados', async () => {
    const r = await navigator.buscar({ base: 'acordaos', queryString: 'dano moral', pageSize: 5 });
    assert(r.total > 1000, `total suspeito: ${r.total}`);
    assert(r.hits.length === 5, `esperava 5 hits, veio ${r.hits.length}`);
    for (const c of ['titulo', 'julgamento_data', 'orgao_julgador', 'ementa_texto']) {
      assert(r.hits[0][c] != null, `campo ausente: ${c}`);
    }
  });

  await teste('As 4 bases respondem e têm tamanhos plausíveis', async () => {
    const a = await navigator.contar({ base: 'acordaos' });
    const d = await navigator.contar({ base: 'decisoes' });
    const s = await navigator.contar({ base: 'sumulas' });
    const i = await navigator.contar({ base: 'informativos' });
    assert(a > 300000, `acórdãos: ${a}`);
    assert(d > 500000, `decisões: ${d}`);
    assert(s > 700 && s < 2000, `súmulas: ${s}`);
    assert(i > 5000, `informativos: ${i}`);
  });

  await teste('Súmulas VINCULANTES são um subconjunto real das súmulas', async () => {
    const todas = await navigator.contar({ base: 'sumulas' });
    const vinc = await navigator.contar({ base: 'sumulas', baseFilters: { is_vinculante: true } });
    const simples = await navigator.contar({ base: 'sumulas', baseFilters: { is_vinculante: false } });
    assert(vinc >= 50 && vinc < 100, `vinculantes: ${vinc}`);
    assert(vinc + simples === todas, `${vinc} + ${simples} != ${todas}`);
  });

  await teste('Repercussão geral: o filtro muda a contagem', async () => {
    const semFiltro = await navigator.contar({ base: 'acordaos', queryString: 'dano moral' });
    const comRG = await navigator.contar({ base: 'acordaos', queryString: 'dano moral', baseFilters: { is_repercussao_geral: true } });
    const semRG = await navigator.contar({ base: 'acordaos', queryString: 'dano moral', baseFilters: { is_repercussao_geral: false } });
    assert(comRG > 0 && comRG < semFiltro, `RG=${comRG} total=${semFiltro}`);
    assert(comRG + semRG === semFiltro, `${comRG} + ${semRG} != ${semFiltro}`);
  });

  await teste('Desambiguação por ÓRGÃO: Pleno + Turmas + Coletânea = total', async () => {
    // Ressalva mapeada: os documentos da Coletânea de acórdãos (anteriores a
    // 1950) têm orgao_julgador = null, e portanto SOMEM de qualquer filtro de
    // órgão. Só fecha a conta somando-os de volta.
    const q = 'dano moral';
    const total = await navigator.contar({ base: 'acordaos', queryString: q });
    const partes = {};
    for (const o of STFNavigator.ORGAOS) {
      partes[o] = await navigator.contar({ base: 'acordaos', queryString: q, filters: { orgao_julgador: [o] } });
    }
    const semOrgao = await navigator.contar({ base: 'acordaos', queryString: q, baseFilters: { is_colac: true } });
    const soma = Object.values(partes).reduce((a, b) => a + b, 0);
    assert(partes['Tribunal Pleno'] > 0 && partes['Primeira Turma'] > 0, JSON.stringify(partes));
    assert(partes['Tribunal Pleno'] !== total, 'filtro de órgão não foi aplicado');
    assert(soma + semOrgao === total, `${soma} (órgãos) + ${semOrgao} (coletânea) != ${total}`);
  });

  await teste('Desambiguação por CLASSE processual muda o resultado', async () => {
    const q = 'liberdade de expressão';
    const total = await navigator.contar({ base: 'acordaos', queryString: q });
    const adi = await navigator.contar({ base: 'acordaos', queryString: q, filters: { processo_classe_processual_unificada_classe_sigla: ['ADI'] } });
    const hc = await navigator.contar({ base: 'acordaos', queryString: q, filters: { processo_classe_processual_unificada_classe_sigla: ['HC'] } });
    assert(adi > 0 && adi < total, `ADI=${adi} total=${total}`);
    assert(hc !== adi, `HC=${hc} igual a ADI=${adi} — filtro suspeito`);
  });

  await teste('Filtro de data de julgamento restringe de fato', async () => {
    const q = 'dano moral';
    const total = await navigator.contar({ base: 'acordaos', queryString: q });
    const a2024 = await navigator.contar({ base: 'acordaos', queryString: q, filters: { julgamento_data: { from: '01012024', until: '31122024' } } });
    const a2023 = await navigator.contar({ base: 'acordaos', queryString: q, filters: { julgamento_data: { from: '01012023', until: '31122023' } } });
    assert(a2024 > 0 && a2024 < total, `2024=${a2024} total=${total}`);
    assert(a2024 !== a2023, `2024 (${a2024}) igual a 2023 (${a2023}) — filtro suspeito`);
  });

  await teste('Data de publicação é um filtro diferente do de julgamento', async () => {
    const q = 'dano moral';
    const j = await navigator.contar({ base: 'acordaos', queryString: q, filters: { julgamento_data: { from: '01012024', until: '31122024' } } });
    const p = await navigator.contar({ base: 'acordaos', queryString: q, filters: { publicacao_data: { from: '01012024', until: '31122024' } } });
    assert(j > 0 && p > 0, `julgamento=${j} publicacao=${p}`);
    assert(j !== p, 'julgamento e publicação deram a mesma contagem — suspeito');
  });

  await teste('Operadores: cada um muda a contagem no sentido esperado', async () => {
    const c = (q, ff) => navigator.contar({ base: 'acordaos', queryString: q, fieldFilters: ff });
    const droga = await c('droga', { sinonimo: false });
    const ent = await c('entorpecente', { sinonimo: false });
    const ou = await c('droga ou entorpecente', { sinonimo: false });
    assert(ou > Math.max(droga, ent), `OU não ampliou: ${droga}/${ent}/${ou}`);

    const prisao = await c('prisao');
    const naoPrev = await c('prisao nao preventiva');
    assert(naoPrev < prisao && naoPrev > 0, `NÃO não restringiu: ${prisao} -> ${naoPrev}`);

    const solto = await c('presunção de inocência');
    const exata = await c('"presunção de inocência"');
    assert(exata < solto, `frase exata não restringiu: ${solto} -> ${exata}`);

    const prox5 = await c('"provimento cargo"~5');
    const prox1 = await c('"provimento cargo"~1');
    assert(prox1 < prox5, `proximidade não funciona: ~1=${prox1} ~5=${prox5}`);

    const semCurringa = await c('indenização');
    const curringa = await c('indeniz$');
    assert(curringa > semCurringa, `curinga $ não ampliou: ${semCurringa} -> ${curringa}`);
  });

  await teste('Expressão com parênteses + OU passa (corpo acima do limiar do WAF)', async () => {
    const n = await navigator.contar({ base: 'acordaos', queryString: '(extradição nao china) ou (exequatur nao STJ)' });
    assert(n > 500, `contagem suspeita: ${n}`);
  });

  await teste('Escopo inteiro teor amplia a busca', async () => {
    const espelho = await navigator.contar({ base: 'acordaos', queryString: 'audiência de custódia' });
    const teor = await navigator.contar({ base: 'acordaos', queryString: 'audiência de custódia', fieldFilters: { pesquisa_inteiro_teor: true } });
    assert(teor > espelho, `inteiro teor não ampliou: ${espelho} -> ${teor}`);
  });

  await teste('Facetas: órgãos, ministros, classes e UFs vêm enumerados', async () => {
    const orgaos = await navigator.facetas('acordaos', 'orgao_julgador');
    const ministros = await navigator.facetas('acordaos', 'ministro_facet');
    const classes = await navigator.facetas('acordaos', 'processo_classe_processual_unificada_classe_sigla');
    const ufs = await navigator.facetas('acordaos', 'procedencia_geografica_uf_sigla');
    assert(orgaos.length >= 3, `órgãos: ${orgaos.length}`);
    assert(ministros.length > 100, `ministros: ${ministros.length}`);
    assert(classes.length > 50, `classes: ${classes.length}`);
    assert(ufs.length >= 26, `UFs: ${ufs.length}`);
  });

  await teste('Paginação anda além da página 1 (sem repetir documentos)', async () => {
    const p1 = await navigator.buscar({ base: 'acordaos', queryString: 'dano moral', pageSize: 10, page: 0 });
    const p2 = await navigator.buscar({ base: 'acordaos', queryString: 'dano moral', pageSize: 10, page: 1 });
    assert(p1.hits.length === 10 && p2.hits.length === 10, `p1=${p1.hits.length} p2=${p2.hits.length}`);
    const ids1 = new Set(p1.hits.map((h) => h._id));
    assert(!p2.hits.some((h) => ids1.has(h._id)), 'página 2 repetiu documentos da página 1');
  });

  await teste('Crawler: mapeia para o formato do repo e coleta 2 páginas', async () => {
    const r = await crawler.search('dano moral', {}, { maxPages: 2 });
    assert(r.length > 100, `coletou ${r.length}`);
    assert(r.totalResults > 1000, `totalResults=${r.totalResults}`);
    const d = r[0];
    for (const c of ['id', 'processo', 'orgaoJulgador', 'dataJulgamento', 'relator', 'ementa', 'processoUrl']) {
      assert(d[c] != null && d[c] !== '', `campo ausente no mapeamento: ${c}`);
    }
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(d.dataJulgamento), `data fora do padrão BR: ${d.dataJulgamento}`);
  });

  await teste('Crawler: filtro de data restringe (com x sem)', async () => {
    const sem = await crawler.search('dano moral', {}, { maxPages: 1 });
    const com = await crawler.search('dano moral', { dataJulgamentoInicio: '01/01/2024', dataJulgamentoFim: '31/12/2024' }, { maxPages: 1 });
    assert(com.totalResults < sem.totalResults, `${com.totalResults} >= ${sem.totalResults}`);
    for (const d of com) {
      const ano = Number(d.dataJulgamento.slice(6));
      assert(ano === 2024, `resultado fora do intervalo: ${d.processo} ${d.dataJulgamento}`);
    }
  });

  await teste('Checker: encontra ADI 4277 pelo formato classe+número', async () => {
    const r = await checker.consultarClasseNumero('ADI 4277');
    assert(r.encontrado, 'ADI 4277 não encontrada');
    assert(r.documentos.some((d) => /ADI\s*4277/.test(d.processo)), JSON.stringify(r.documentos.map((d) => d.processo)));
  });

  await teste('Checker: encontra o processo pelo Número Único (CNJ da origem)', async () => {
    const r = await checker.consultarNumeroUnico('0164903-80.2018.8.06.0001');
    assert(r.processoNoPortal.encontrado, 'portal não achou o número único');
    assert(r.processoNoPortal.titulo === 'ARE 1596565', `título: ${r.processoNoPortal.titulo}`);
    assert(r.encontrado, 'não chegou ao julgado');
  });

  await teste('Checker: número inventado NÃO é confirmado (anti-alucinação)', async () => {
    const r = await checker.consultar('RE 9999999');
    assert(!r.encontrado, 'confirmou um processo inexistente');
    const cnjFalso = await checker.consultarNumeroUnico('0002234-32.2010.1.00.0000');
    assert(!cnjFalso.processoNoPortal.encontrado, 'confirmou um número único inexistente');
  });

  await teste('Auditoria: --verificar confirma a amostra', async () => {
    const r = await crawler.search('feminicídio', {}, { maxPages: 1 });
    const audit = await checker.verificarResultados(r, { amostra: 3 });
    assert(audit.verificados === 3, `verificados=${audit.verificados}`);
    assert(audit.confirmados === 3, `divergências: ${JSON.stringify(audit.detalhes.filter((d) => !d.confirmado))}`);
  });

  if (!rapido) {
    await teste('Inteiro teor: sai em .txt a partir do texto já indexado', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-testes-'));
      try {
        const r = await crawler.search('repercussão geral', { dataJulgamentoInicio: '01/01/2024', dataJulgamentoFim: '31/12/2024' }, { maxPages: 1, maxResults: 3 });
        const saida = await crawler.fetchInteiroTeorBatch(r, dir, { log: () => {} });
        const ok = saida.filter((s) => s.arquivo);
        assert(ok.length >= 1, `nenhum inteiro teor salvo: ${JSON.stringify(saida)}`);
        assert(fs.statSync(ok[0].arquivo).size > 1000, `arquivo pequeno demais: ${ok[0].arquivo}`);
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
