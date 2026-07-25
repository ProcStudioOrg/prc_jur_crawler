// src/TJRSTestes.js
// Suíte de testes do stack TJRS (Navigator, Crawler, Checker).
// Bate no site real — precisa de rede. Uso:
//   node src/TJRSTestes.js            # suíte completa
//   node src/TJRSTestes.js --rapido   # pula gravação em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJRSNavigator = require('./TJRSNavigator');
const TJRSCrawler = require('./TJRSCrawler');
const TJRSChecker = require('./TJRSChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    console.log(`PASS (${Date.now() - inicio}ms)`);
    resultados.push({ nome, ok: true, ms: Date.now() - inicio });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const silencioso = () => ({ log: () => {} });

(async () => {
  console.log('='.repeat(60));
  console.log('TJRS — Testes de integração (site real)');
  console.log('='.repeat(60));

  const navigator = new TJRSNavigator({ retries: 3, log: () => {} });
  const checker = new TJRSChecker({ navigator });

  // Termo e período fixos: as contagens abaixo são comparadas entre si, não
  // contra valores absolutos (a base cresce todo dia).
  const TERMO = 'dano moral';
  const DI = '01/01/2026';
  const DF = '30/06/2026';

  let docBruto = null;

  await teste('Navigator: combo Tribunal traz Justiça Comum E Turmas Recursais', async () => {
    const t = await navigator.listarTribunais();
    assert(t.length >= 4, `esperava >=4 tribunais, veio ${t.length}`);
    assert(t.some(o => o.id === '3' && /Justi(ç|c)a do RS/i.test(o.label)), 'Tribunal de Justiça do RS ausente');
    assert(t.some(o => o.id === '6' && /Turmas Recursais/i.test(o.label)), 'Turmas Recursais ausente');
  });

  await teste('Navigator: órgãos julgadores dependem do tribunal (TJ >> Turmas)', async () => {
    const tj = await navigator.listarOrgaosJulgadores(TJRSNavigator.TRIBUNAIS.comum);
    const tr = await navigator.listarOrgaosJulgadores(TJRSNavigator.TRIBUNAIS.turmas);
    assert(tj.length > 50, `esperava >50 órgãos no TJ, veio ${tj.length}`);
    assert(tr.length > 5 && tr.length < 50, `esperava 5..50 órgãos nas Turmas, veio ${tr.length}`);
    assert(tr.every(o => /Turma/i.test(o.label)), 'órgão das Turmas Recursais fora do padrão "Turma..."');
  });

  await teste('Navigator: combos de relator e classe processual populados', async () => {
    const rel = await navigator.listarRelatores(TJRSNavigator.TRIBUNAIS.comum);
    const cls = await navigator.listarTiposDeProcessos(TJRSNavigator.TRIBUNAIS.comum);
    const cnjCls = await navigator.listarClassesCNJ();
    assert(rel.length > 500, `lista de relatores suspeita: ${rel.length}`);
    assert(cls.length > 100, `lista de classes processuais suspeita: ${cls.length}`);
    assert(cnjCls.length > 100, `lista de classes CNJ suspeita: ${cnjCls.length}`);
  });

  await teste('Busca simples: retorna docs com os campos-chave', async () => {
    const data = await navigator.buscar({ q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum });
    assert(data.response.numFound > 0, 'numFound = 0');
    assert(data.response.docs.length === 10, `esperava 10 docs/página, veio ${data.response.docs.length}`);
    docBruto = data.response.docs[0];
    for (const campo of ['numero_processo', 'cod_ementa', 'tipo_documento', 'data_julgamento', 'nome_tribunal']) {
      assert(docBruto[campo] != null, `campo ausente no doc: ${campo}`);
    }
  });

  // ---- O teste mais importante: a desambiguação precisa MUDAR a contagem.
  await teste('DESAMBIGUAÇÃO: Justiça Comum × Turmas Recursais dão contagens diferentes', async () => {
    const form = { q_palavra_chave: TERMO, data_julgamento_de: DI, data_julgamento_ate: DF };
    const comum = await navigator.buscar({ ...form, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum });
    const turmas = await navigator.buscar({ ...form, filtroTribunal: TJRSNavigator.TRIBUNAIS.turmas });
    const todas = await navigator.buscar({ ...form, filtroTribunal: TJRSNavigator.TRIBUNAIS.todas });

    const nComum = comum.response.numFound;
    const nTurmas = turmas.response.numFound;
    const nTodas = todas.response.numFound;
    console.log(`\n    comum=${nComum} turmas=${nTurmas} todas=${nTodas}`);

    assert(nComum > 0 && nTurmas > 0, `alguma das duas veio vazia (comum=${nComum}, turmas=${nTurmas})`);
    assert(nComum !== nTurmas, 'contagens IGUAIS: o filtro de tribunal não foi aplicado');
    assert(nTodas >= nComum + nTurmas,
      `todas (${nTodas}) deveria conter comum+turmas (${nComum + nTurmas})`);
    assert(decodeURIComponent(comum.filtro).includes('cod_tribunal:3'), 'cláusula cod_tribunal:3 ausente');
    assert(decodeURIComponent(turmas.filtro).includes('cod_tribunal:6'), 'cláusula cod_tribunal:6 ausente');

    // e cada lado só devolve órgãos do seu lado
    assert(comum.response.docs.every(d => d.cod_tribunal === 3), 'doc de outro tribunal na Justiça Comum');
    assert(turmas.response.docs.every(d => d.cod_tribunal === 6), 'doc de outro tribunal nas Turmas Recursais');
    assert(turmas.response.docs.every(d => /Turma/i.test(d.orgao_julgador)),
      'órgão julgador fora do padrão nas Turmas Recursais');
  });

  await teste('Filtro de data de julgamento restringe de fato', async () => {
    const base = { q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum };
    const semData = await navigator.buscar(base);
    const comData = await navigator.buscar({ ...base, data_julgamento_de: DI, data_julgamento_ate: DF });
    assert(comData.response.numFound < semData.response.numFound,
      `data não restringiu: ${comData.response.numFound} >= ${semData.response.numFound}`);
    assert(decodeURIComponent(comData.filtro).includes('data_julgamento:['), 'cláusula de data ausente no filtro');
    for (const d of comData.response.docs) {
      const ano = Number(String(d.data_julgamento).slice(0, 4));
      assert(ano === 2026, `julgamento fora do período: ${d.data_julgamento}`);
    }
  });

  await teste('Filtro de data de PUBLICAÇÃO é distinto do de julgamento', async () => {
    const base = { q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum };
    const pub = await navigator.buscar({ ...base, data_publicacao_de: DI, data_publicacao_ate: DF });
    assert(decodeURIComponent(pub.filtro).includes('data_publicacao:['), 'cláusula data_publicacao ausente');
    assert(pub.response.numFound > 0, 'filtro de publicação zerou a busca');
  });

  await teste('Paginação: página 2 traz documentos diferentes da página 1', async () => {
    const form = { q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum };
    const p1 = await navigator.buscar(form, 1);
    const p2 = await navigator.buscar(form, 2);
    assert(p2.pages.includes('start=10'), `esperava start=10 na página 2, veio "${p2.pages}"`);
    const ids1 = new Set(p1.response.docs.map(d => d.cod_ementa));
    const novos = p2.response.docs.filter(d => !ids1.has(d.cod_ementa));
    assert(novos.length >= 8, `página 2 repetiu documentos da 1 (${10 - novos.length} repetidos)`);
  });

  await teste('Operadores: AND implícito, "frase exata", OR e -exclusão mudam a contagem', async () => {
    const t = TJRSNavigator.TRIBUNAIS.comum;
    const n = async (q) => (await navigator.buscar({ q_palavra_chave: q, filtroTribunal: t })).response.numFound;
    const [and, frase, ou, excl] = await Promise.all([
      n('ausencia de constrangimento ilegal'),
      n('"ausencia de constrangimento ilegal"'),
      n('financiamento OR credito'),
      n('habeas corpus -multa'),
    ]);
    const andFin = await n('financiamento credito');
    assert(frase < and, `aspas não restringiram: ${frase} >= ${and}`);
    assert(ou > andFin, `OR não expandiu: ${ou} <= ${andFin}`);
    const semExcl = await n('habeas corpus');
    assert(excl < semExcl, `"-palavra" não excluiu: ${excl} >= ${semExcl}`);
  });

  await teste('Seção Cível × Crime separa os resultados', async () => {
    const base = { q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum };
    const civel = await navigator.buscar({ ...base, filtroSecaoCivel: 'civel' });
    const crime = await navigator.buscar({ ...base, filtroSecaoCrime: 'crime' });
    assert(civel.response.numFound !== crime.response.numFound, 'contagens iguais: filtro de seção ignorado');
    assert(civel.response.docs.every(d => d.secao === 'CIVEL'), 'doc não-cível no filtro cível');
    assert(crime.response.docs.every(d => d.secao === 'CRIME'), 'doc não-crime no filtro crime');
  });

  await teste('Tipo de decisão (acórdão × monocrática) filtra', async () => {
    const base = { q_palavra_chave: TERMO, filtroTribunal: TJRSNavigator.TRIBUNAIS.comum };
    const ac = await navigator.buscar({ ...base, filtroacordao: 'acordao' });
    const mono = await navigator.buscar({ ...base, filtroMonocratica: 'monocratica' });
    assert(ac.response.docs.every(d => d.tipo_documento === 'Acordao'), 'não-acórdão no filtro de acórdão');
    assert(mono.response.docs.every(d => d.tipo_documento === 'Monocratica'), 'não-monocrática no filtro');
  });

  await teste('Crawler: search() mapeia para o formato do repo', async () => {
    const crawler = new TJRSCrawler({ navigator, ...silencioso() });
    const results = await crawler.search(TERMO, {
      origem: 'comum', dataJulgamentoInicio: DI, dataJulgamentoFim: DF,
    }, { maxPages: 1 });
    assert(results.length === 10, `esperava 10, veio ${results.length}`);
    assert(results.totalResults > 0, 'totalResults ausente');
    const r = results[0];
    for (const campo of ['id', 'numeroProcesso', 'tipoDocumento', 'dataJulgamento', 'relator', 'ementa', 'uf']) {
      assert(r[campo] != null && r[campo] !== '', `campo vazio no resultado mapeado: ${campo}`);
    }
    assert(r.uf === 'RS', `uf errada: ${r.uf}`);
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(r.dataJulgamento), `data não convertida: ${r.dataJulgamento}`);
    assert(r.processoUrl.startsWith('https://consulta.tjrs.jus.br/'), 'processoUrl fora do padrão');
  });

  await teste('Crawler: --origem turmas devolve só Turmas Recursais', async () => {
    const crawler = new TJRSCrawler({ navigator, ...silencioso() });
    const results = await crawler.search(TERMO, { origem: 'turmas' }, { maxPages: 1 });
    assert(results.length > 0, 'nenhum resultado nas Turmas Recursais');
    assert(results.every(r => r.tribunal === 'Turmas Recursais'), 'resultado fora das Turmas Recursais');
    assert(results.filtroSolr.includes('cod_tribunal:6'), 'filtroSolr sem cod_tribunal:6');
  });

  await teste('Crawler: maxPages/maxResults respeitados', async () => {
    const crawler = new TJRSCrawler({ navigator, ...silencioso() });
    const r2 = await crawler.search(TERMO, { origem: 'comum' }, { maxPages: 2 });
    assert(r2.length === 20, `maxPages 2 deveria dar 20, veio ${r2.length}`);
    const r5 = await crawler.search(TERMO, { origem: 'comum' }, { maxPages: 3, maxResults: 15 });
    assert(r5.length === 15, `maxResults 15 deveria cortar em 15, veio ${r5.length}`);
  });

  await teste('Crawler: classe processual é resolvida por NOME (id não funciona no site)', async () => {
    const crawler = new TJRSCrawler({ navigator, ...silencioso() });
    const results = await crawler.search(TERMO, {
      origem: 'turmas', classeProcessual: 'Recurso Inominado',
    }, { maxPages: 1 });
    assert(results.length > 0, 'classe processual por nome não retornou nada');
    assert(results.every(r => /Recurso Inominado/i.test(r.classeProcessual)),
      `classe processual divergente: ${results.map(r => r.classeProcessual).join(', ')}`);
  });

  await teste('Inteiro teor vem no próprio payload da busca (sem nova request)', async () => {
    assert(docBruto, 'sem doc bruto do teste anterior');
    const html = navigator.inteiroTeorHtml(docBruto);
    const txt = navigator.inteiroTeor(docBruto);
    assert(html.length > 1000, `HTML do inteiro teor pequeno demais: ${html.length}`);
    assert(txt.length > 500, `texto do inteiro teor pequeno demais: ${txt.length}`);
    assert(!/<style|<script/i.test(txt), 'stripHtml deixou style/script no texto');
  });

  await teste('Checker: consulta por número CNJ encontra o processo', async () => {
    assert(docBruto, 'sem doc bruto');
    const res = await checker.consultarProcesso(docBruto.numero_processo);
    assert(res.encontrado, `processo ${docBruto.numero_processo} não encontrado`);
    assert(res.decisoes.some(d => String(d.id) === String(docBruto.cod_ementa)),
      'documento consultado não voltou na consulta por número');
    assert(res.filtroSolr.includes('numero_processo:'), 'cláusula numero_processo ausente');
  });

  await teste('Checker: número inexistente não é confirmado', async () => {
    const res = await checker.consultarProcesso('99999999999999999999');
    assert(!res.encontrado, 'número inventado foi "encontrado" — verificação inútil');
  });

  await teste('Checker: numeração legada (pré-CNJ) é aceita', async () => {
    const res = await checker.consultarProcesso('70084452564');
    assert(res.encontrado, 'processo legado 70084452564 não encontrado');
    assert(res.formatoCNJ === false, 'número legado classificado como CNJ');
    assert(res.numeroValido === null, 'DV cobrado de número não-CNJ');
  });

  await teste('Checker: valida segmento CNJ do TJRS (8.21)', async () => {
    assert(checker.ehProcessoTJRS('5112564-16.2026.8.21.7000'), 'não reconheceu CNJ do TJRS');
    assert(!checker.ehProcessoTJRS('0009553-49.2007.8.14.0006'), 'aceitou CNJ do TJPA como TJRS');
  });

  await teste('Checker: verificarResultados audita a amostra da busca', async () => {
    const crawler = new TJRSCrawler({ navigator, ...silencioso() });
    const results = await crawler.search('usucapiao', { origem: 'comum' }, { maxPages: 1 });
    const audit = await checker.verificarResultados(results, { amostra: 3 });
    assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
    assert(audit.confirmados === 3,
      `divergências: ${JSON.stringify(audit.detalhes.filter(d => !d.confirmado))}`);
  });

  if (!rapido) {
    await teste('Navigator: grava inteiro teor (.txt e .html) em disco', async () => {
      assert(docBruto, 'sem doc bruto');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjrs-testes-'));
      try {
        const files = navigator.salvarDecisao(docBruto, dir, { formats: ['txt', 'html'] });
        assert(files.length === 2, `esperava 2 arquivos, veio ${files.length}`);
        for (const f of files) {
          const size = fs.statSync(path.join(dir, f)).size;
          assert(size > 200, `arquivo ${f} muito pequeno (${size} bytes)`);
        }
        const lote = await navigator.baixarLote([docBruto], dir, { log: () => {} });
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
})().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
