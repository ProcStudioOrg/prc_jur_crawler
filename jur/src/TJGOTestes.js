// src/TJGOTestes.js
// Suíte de testes do stack TJGO (Navigator, Crawler, Checker).
// Bate no site real — precisa de rede. Uso:
//   node src/TJGOTestes.js            # suíte completa
//   node src/TJGOTestes.js --rapido   # pula gravação em disco
//
// Cobre os 9 cenários mapeados em human-codegen/TJGO:
//   1 pesquisa simples · 2 Juizados × Justiça Comum · 3 Área Cível/Criminal
//   4 Órgão/Matéria · 5 Unidade específica · 6 Magistrado · 7 Tipo de Ato
//   8 Número do processo · 9 Data de publicação (+ paginação e lupas)
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJGONavigator = require('./TJGONavigator');
const TJGOCrawler = require('./TJGOCrawler');
const TJGOChecker = require('./TJGOChecker');

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

function dataBr(s) {
  // "DD/MM/YYYY[ HH:MM:SS]" → "YYYYMMDD" para comparação
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

(async () => {
  console.log('='.repeat(60));
  console.log('TJGO — Testes de integração (site real, HTTP direto)');
  console.log('='.repeat(60));

  const navigator = new TJGONavigator({ retries: 3 });
  const checker = new TJGOChecker({ navigator });
  // estado compartilhado entre testes
  let resultadoBruto = null;

  await teste('Lupa Tipo de Ato lista os 10 tipos (Acórdão, Sentença, ...)', async () => {
    const { total, itens } = await navigator.consultarTiposAto();
    assert(total >= 10, `esperava >= 10 tipos, veio ${total}`);
    const nomes = itens.map(i => i.desc1);
    for (const n of ['Acórdão', 'Sentença', 'Decisão Monocrática']) {
      assert(nomes.includes(n), `tipo ausente na lupa: ${n}`);
    }
  });

  await teste('Lupa Serventia e lupa Magistrado respondem com totais plausíveis', async () => {
    const serv = await navigator.consultarServentias('câmara cível');
    assert(serv.itens.length > 0, 'nenhuma serventia para "câmara cível"');
    const mag = await navigator.consultarMagistrados('silva');
    assert(mag.total > 10, `poucos magistrados "silva": ${mag.total}`);
  });

  await teste('T1 pesquisa simples: "furto" retorna resultados com campos-chave', async () => {
    const data = await navigator.buscar({ Texto: 'furto', qtdeItensPagina: '10' });
    assert(data.total > 1000, `total suspeito para "furto": ${data.total}`);
    assert(data.resultados.length === 10, `esperava 10, veio ${data.resultados.length}`);
    const r = data.resultados[0];
    for (const campo of ['numeroProcesso', 'idArquivo', 'serventia', 'magistrado', 'dataJulgamento']) {
      assert(r[campo], `campo ausente: ${campo}`);
    }
    assert(r.texto.length > 500, `texto completo suspeito (${r.texto.length} chars)`);
    resultadoBruto = r;
  });

  await teste('T2 desambiguação: Juizado Especial Cível × Varas Cíveis', async () => {
    const juizado = await navigator.buscar({ Texto: '"dano moral"', Id_ServentiaSubTipo: '1', qtdeItensPagina: '10' });
    const varas = await navigator.buscar({ Texto: '"dano moral"', Id_ServentiaSubTipo: '27', qtdeItensPagina: '10' });
    assert(juizado.total > 0 && varas.total > 0, 'algum dos filtros voltou vazio');
    assert(juizado.resultados.every(r => /juizado/i.test(r.serventia)),
      `serventia fora de Juizado: ${juizado.resultados.map(r => r.serventia).join('; ')}`);
    assert(varas.resultados.every(r => /vara|upj/i.test(r.serventia)),
      `serventia fora de Vara: ${varas.resultados.map(r => r.serventia).join('; ')}`);
  });

  await teste('T2c Instância = Turmas Recursais (Id_Instancia=151)', async () => {
    const data = await navigator.buscar({ Texto: 'consumidor', Id_Instancia: '151', qtdeItensPagina: '10' });
    assert(data.total > 0, 'nenhum resultado em Turmas Recursais');
    assert(data.resultados.every(r => /turma recursal/i.test(r.serventia)),
      `serventia fora de Turma Recursal: ${data.resultados.map(r => r.serventia).join('; ')}`);
  });

  await teste('T3 Área Criminal retorna varas/câmaras criminais', async () => {
    const data = await navigator.buscar({ Texto: 'furto', Id_Area: '2', qtdeItensPagina: '10' });
    assert(data.total > 0, 'área criminal vazia');
    // serventias cíveis puras não devem aparecer com área criminal
    assert(!data.resultados.some(r => /vara c[íi]vel|câmara c[íi]vel/i.test(r.serventia)),
      `serventia cível vazou na área criminal: ${data.resultados.map(r => r.serventia).join('; ')}`);
  });

  await teste('T4 Órgão/Matéria = Família (código 9) traz varas de família', async () => {
    const data = await navigator.buscar({ Texto: 'alimentos', Id_ServentiaSubTipo: '9', qtdeItensPagina: '10' });
    assert(data.total > 0, 'nenhum resultado para Família');
    assert(data.resultados.every(r => /fam[íi]lia|sucess/i.test(r.serventia)),
      `serventia fora de Família: ${data.resultados.map(r => r.serventia).join('; ')}`);
  });

  await teste('T5 Unidade específica: lupa resolve "1ª Câmara Cível" e filtra', async () => {
    const alvo = await navigator.resolverLupa('serventia', '1ª Câmara Cível');
    assert(alvo && alvo.id, 'lupa não resolveu a serventia');
    const data = await navigator.buscar({
      Texto: 'indenização', Id_Serventia: alvo.id, Serventia: alvo.nome, qtdeItensPagina: '10',
    });
    assert(data.total > 0, 'nenhum resultado na 1ª Câmara Cível');
    assert(data.resultados.every(r => r.serventia === alvo.nome),
      `vazou serventia diferente: ${data.resultados.map(r => r.serventia).join('; ')}`);
  });

  await teste('T6 Magistrado: lupa resolve nome e a busca filtra por ele', async () => {
    const alvo = await navigator.resolverLupa('magistrado', 'Adegmar José Ferreira');
    assert(alvo && alvo.id, 'lupa não resolveu o magistrado');
    const data = await navigator.buscar({ Id_Usuario: alvo.id, Usuario: alvo.nome, qtdeItensPagina: '10' });
    assert(data.total > 0, 'nenhum resultado para o magistrado');
    assert(data.resultados.every(r => r.magistrado.toUpperCase().includes('ADEGMAR')),
      `magistrado divergente: ${data.resultados.map(r => r.magistrado).join('; ')}`);
  });

  await teste('T7 Tipo de Ato = Acórdão filtra o conjunto de resultados', async () => {
    const data = await navigator.buscar({
      Texto: '"dano moral"', Id_ArquivoTipo: '22', ArquivoTipo: 'Acórdão', qtdeItensPagina: '10',
    });
    assert(data.total > 0, 'nenhum acórdão');
    assert(data.resultados.every(r => r.numeroProcesso && r.texto.length > 0),
      'resultado sem processo/texto');
  });

  await teste('T8 Número do processo retorna só atos daquele processo', async () => {
    const numero = resultadoBruto.numeroProcesso;
    const data = await navigator.buscar({ ProcessoNumero: numero });
    assert(data.total > 0, `processo ${numero} sem atos`);
    assert(data.resultados.every(r => r.numeroProcesso === numero),
      'voltou ato de outro processo');
    assert(data.resultados.some(r => r.idArquivo === resultadoBruto.idArquivo),
      `idArquivo ${resultadoBruto.idArquivo} não retornou na consulta por processo`);
  });

  await teste('T9 Data de julgamento: resultados dentro do intervalo', async () => {
    const data = await navigator.buscar({
      Texto: '"dano moral"', DataInicial: '01/06/2026', DataFinal: '30/06/2026', qtdeItensPagina: '10',
    });
    assert(data.total > 0, 'nenhum resultado no período');
    for (const r of data.resultados) {
      const d = dataBr(r.dataJulgamento);
      assert(d >= '20260601' && d <= '20260630', `julgamento fora do intervalo: ${r.dataJulgamento}`);
    }
  });

  await teste('Paginação: página 0 e página 1 não repetem atos', async () => {
    const [p0, p1] = await Promise.all([
      navigator.buscar({ Texto: 'furto', qtdeItensPagina: '10', PosicaoPaginaAtual: '0' }),
      navigator.buscar({ Texto: 'furto', qtdeItensPagina: '10', PosicaoPaginaAtual: '1' }),
    ]);
    const ids0 = new Set(p0.resultados.map(r => r.idArquivo));
    assert(p1.resultados.length > 0, 'página 1 vazia');
    assert(!p1.resultados.some(r => ids0.has(r.idArquivo)), 'páginas retornaram atos repetidos');
  });

  await teste('Checker/cnj: DV, segmento TJGO (8.09) e normalização', async () => {
    const cnj = require('./cnj');
    // número do placeholder oficial do formulário
    assert(checker.ehProcessoTJGO('5000280-28.2010.8.09.0059') === true, 'segmento 8.09 falhou');
    assert(checker.ehProcessoTJGO('0010095-26.2017.8.14.0003') === false, 'aceitou processo do TJPA');
    assert(cnj.normalizar('50002802820108090059') === '5000280-28.2010.8.09.0059', 'normalização falhou');
    assert(cnj.decompor('5000280-28.2010.8.09.0059').justicaNome === 'Justiça Estadual', 'decompor falhou');
  });

  await teste('Checker: consulta por processo confirma ato da busca', async () => {
    const res = await checker.consultarProcesso(resultadoBruto.numeroProcesso);
    assert(res.tjgo, 'número não é do segmento TJGO (J=8, TR=09)');
    assert(res.encontrado, 'processo não encontrado na base');
    assert(res.atos.some(a => String(a.idArquivo) === String(resultadoBruto.idArquivo)),
      `idArquivo ${resultadoBruto.idArquivo} não retornou`);
  });

  await teste('Crawler end-to-end: search() mapeia campos padrão do repo', async () => {
    const crawler = new TJGOCrawler({ pageSize: 10, includeFullText: true, log: () => {} });
    const orig = console.log; console.log = () => {}; // silencia logs internos
    let results;
    try {
      // 2º grau publica acórdãos quase sempre como tipo "Ementa" — o tipo
      // "Acórdão" formal é raríssimo (unidades por semestre); ver CLAUDE-TJGO.md
      results = await crawler.search('"dano moral"', {
        area: 'civel',
        tipoAto: 'Ementa',
        dataPublicacaoInicio: '01/01/2026',
        dataPublicacaoFim: '30/06/2026',
      }, { maxPages: 2 });
    } finally { console.log = orig; }
    assert(results.length === 20, `esperava 20 resultados (2 páginas), veio ${results.length}`);
    assert(results.totalResults > 0, 'totalResults ausente');
    const r = results[0];
    for (const campo of ['id', 'numeroProcesso', 'orgaoJulgador',
      'dataJulgamento', 'relator', 'uf', 'ementa', 'inteiroTeor']) {
      assert(r[campo] !== undefined && r[campo] !== '', `campo vazio: ${campo}`);
    }
    assert(r.uf === 'GO', 'uf incorreta');
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(r.dataJulgamento), `data não está em DD/MM/YYYY: ${r.dataJulgamento}`);
  });

  await teste('Checker: verificarResultados audita amostra da busca', async () => {
    const crawler = new TJGOCrawler({ pageSize: 10 });
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
    await teste('Navigator: salva texto completo (.txt e .html) em disco', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjgo-testes-'));
      try {
        const lote = navigator.salvarLote([resultadoBruto], dir, {
          log: () => {}, formats: ['txt', 'html'],
        });
        assert(lote[0].arquivo, 'salvarLote não gravou arquivo');
        const files = fs.readdirSync(dir);
        assert(files.some(f => f.endsWith('.txt')) && files.some(f => f.endsWith('.html')),
          `formatos ausentes: ${files.join(', ')}`);
        for (const f of files.filter(f => f !== 'index.json')) {
          const size = fs.statSync(path.join(dir, f)).size;
          assert(size > 500, `arquivo ${f} muito pequeno (${size} bytes)`);
        }
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
