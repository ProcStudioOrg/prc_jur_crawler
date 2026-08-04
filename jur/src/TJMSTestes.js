// src/TJMSTestes.js
// Suíte de testes do stack TJMS (Navigator, Crawler, Checker) — e-SAJ cjsg.
// Bate no site real — precisa de rede. Uso:
//   node src/TJMSTestes.js            # suíte completa
//   node src/TJMSTestes.js --rapido   # pula download em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJMSNavigator = require('./TJMSNavigator');
const TJMSCrawler = require('./TJMSCrawler');
const TJMSChecker = require('./TJMSChecker');

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

/**
 * O cjsg do TJMS responde por mais de um nó (JSESSIONID termina em `.cjsg2`,
 * `.cjsg3`) e os índices ficam alguns documentos fora de sincronia: a MESMA
 * busca devolve 67.322 num nó e 67.529 noutro. Comparações de contagem neste
 * arquivo usam esta tolerância — exigir igualdade exata daria flaky.
 */
const proximos = (a, b, tolerancia = 0.01) =>
  Math.abs(a - b) <= Math.max(5, Math.max(a, b) * tolerancia);

(async () => {
  console.log('='.repeat(60));
  console.log('TJMS — Testes de integração (site real, e-SAJ cjsg)');
  console.log('='.repeat(60));

  const navigator = new TJMSNavigator();
  const checker = new TJMSChecker({ navigator });
  let julgadoBase = null;
  let totalComum = 0;

  await teste('Busca por ementa devolve total e cards', async () => {
    const r = await navigator.buscar({ query: 'usucapião', origens: ['T'], tipos: ['A'] });
    assert(r.total > 1000, `total inesperadamente baixo: ${r.total}`);
    assert(r.resultados.length === TJMSNavigator.POR_PAGINA,
      `esperava ${TJMSNavigator.POR_PAGINA} cards, veio ${r.resultados.length}`);
    julgadoBase = r.resultados[0];
    assert(julgadoBase.cdAcordao, 'card sem cdAcordao (o identificador do documento)');
    assert(/^\d{7}-\d{2}\.\d{4}\.8\.12\.\d{4}$/.test(julgadoBase.numeroProcesso),
      `nº de processo fora do padrão CNJ do TJMS: ${julgadoBase.numeroProcesso}`);
  });

  await teste('Card traz ementa completa, não trecho com highlight', async () => {
    assert(julgadoBase, 'teste anterior não produziu julgado');
    assert(julgadoBase.ementa.length > 300,
      `ementa curta demais (${julgadoBase.ementa.length} chars) — pode ser trecho`);
    assert(!/<(b|em|mark)>/i.test(julgadoBase.ementa),
      'ementa contém tag de highlight — está vindo do corpo destacado, não do textAreaDados');
    assert(julgadoBase.citacao.startsWith('TJMS.'),
      `citação oficial não extraída: "${julgadoBase.citacao}"`);
  });

  await teste('Metadados do card: órgão, relator, comarca e as DUAS datas', async () => {
    for (const campo of ['orgaoJulgador', 'relator', 'comarca', 'dataJulgamento', 'dataPublicacao', 'classe']) {
      assert(julgadoBase[campo], `campo "${campo}" veio vazio`);
    }
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(julgadoBase.dataJulgamento),
      `dataJulgamento fora do formato: ${julgadoBase.dataJulgamento}`);
  });

  await teste('ACENTO muda a busca — o índice não normaliza', async () => {
    const com = await navigator.buscar({ query: 'usucapião', origens: ['T'], tipos: ['A'] });
    const sem = await navigator.buscar({ query: 'usucapiao', origens: ['T'], tipos: ['A'] });
    assert(com.total > sem.total * 100,
      `esperava ordem de grandeza de diferença; com=${com.total} sem=${sem.total}. ` +
      'Se ficaram parecidos, o portal passou a normalizar acento e o aviso do crawler está obsoleto.');
  });

  await teste('DESAMBIGUAÇÃO: --origem comum × turmas muda a contagem', async () => {
    const comum = await navigator.buscar({ query: 'dano moral', origens: ['T'], tipos: ['A'] });
    const turmas = await navigator.buscar({ query: 'dano moral', origens: ['R'], tipos: ['A'] });
    totalComum = comum.total;
    assert(comum.total > 0 && turmas.total > 0, 'uma das origens devolveu zero');
    assert(!proximos(comum.total, turmas.total),
      `contagens iguais (${comum.total} × ${turmas.total}) = filtro de origem IGNORADO`);
  });

  await teste('Filtro de data de julgamento restringe de fato', async () => {
    const comData = await navigator.buscar({
      query: 'dano moral', origens: ['T'], tipos: ['A'],
      dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '31/03/2025',
    });
    assert(comData.total > 0, 'filtro de data zerou a busca');
    assert(comData.total < totalComum / 5,
      `data não restringiu: ${comData.total} contra ${totalComum} sem filtro`);
  });

  await teste('Filtro de data de publicação é DIFERENTE do de julgamento', async () => {
    const julg = await navigator.buscar({
      query: 'dano moral', origens: ['T'], tipos: ['A'],
      dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '31/03/2025',
    });
    const publ = await navigator.buscar({
      query: 'dano moral', origens: ['T'], tipos: ['A'],
      dataPublicacaoInicio: '01/01/2025', dataPublicacaoFim: '31/03/2025',
    });
    assert(julg.total !== publ.total,
      `julgamento e publicação devolveram o mesmo total (${julg.total}) — um dos dois é ignorado`);
  });

  await teste('LIMITE DE 365 DIAS: intervalo maior devolve 0 sem erro', async () => {
    const dentro = await navigator.buscar({
      query: 'dano moral', origens: ['T'], tipos: ['A'],
      dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '31/12/2025',   // 364 de diferença
    });
    const fora = await navigator.buscar({
      query: 'dano moral', origens: ['T'], tipos: ['A'],
      dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '01/01/2026',   // 365 de diferença
    });
    assert(dentro.total > 1000, `janela de 365 dias corridos deveria trazer resultados, veio ${dentro.total}`);
    assert(fora.total === 0,
      `365 dias de diferença passou a funcionar (${fora.total}). Se o portal afrouxou o limite, ` +
      'reveja TJMSCrawler.MAX_DIAS_INTERVALO — o fatiamento virou custo à toa.');
  });

  await teste('Crawler: fatia intervalo longo em janelas e devolve resultados', async () => {
    const janelas = TJMSCrawler.janelas('04/08/2025', '04/08/2026');
    assert(janelas && janelas.length === 2, `esperava 2 janelas, veio ${janelas && janelas.length}`);
    assert(janelas[0][0] === '04/08/2025' && janelas[0][1] === '03/08/2026', `1ª janela errada: ${janelas[0]}`);
    assert(janelas[1][0] === '04/08/2026', `2ª janela não emenda: ${janelas[1]}`);
    assert(TJMSCrawler.janelas('01/01/2025', '31/12/2025') === null, 'fatiou intervalo que já cabia');

    const crawler = new TJMSCrawler({ log: () => {} });
    const r = await crawler.search('dano moral',
      { dataJulgamentoInicio: '04/08/2025', dataJulgamentoFim: '04/08/2026' }, { maxPages: 1 });
    assert(r.length > 0, 'busca de "último ano" devolveu vazio — o fatiamento não pegou');
    assert(crawler.ultimaBusca.janelasDeData === 2, 'ultimaBusca não registrou o fatiamento');
  });

  await teste('Paginação anda além da página 1 e traz documentos novos', async () => {
    const p1 = await navigator.buscar({ query: 'usucapião', origens: ['T'], tipos: ['A'] });
    const p2 = await navigator.paginar(2, 'A');
    assert(p2.resultados.length > 0, 'página 2 veio vazia');
    const ids1 = new Set(p1.resultados.map((r) => r.id));
    const novos = p2.resultados.filter((r) => !ids1.has(r.id)).length;
    assert(novos > TJMSNavigator.POR_PAGINA * 0.9,
      `página 2 repetiu demais a página 1 (só ${novos} novos)`);
  });

  await teste('Paginar SEM sessão é erro explícito, não zero silencioso', async () => {
    const virgem = new TJMSNavigator();
    let erro = null;
    try { await virgem.paginar(2, 'A'); } catch (e) { erro = e; }
    assert(erro && /JSESSIONID|sessão/i.test(erro.message),
      'paginar() sem cookie deveria lançar erro — senão o crawler lê 0 como "acabou"');
  });

  await teste('Total é EXATO, não saturado (termo inexistente devolve 0)', async () => {
    const r = await navigator.buscar({ query: 'anencefalia', origens: ['T'], tipos: ['A'] });
    assert(r.total === 0, `esperava 0 para termo raro, veio ${r.total}`);
  });

  await teste('Tipo de publicação: monocrática é aba própria e rotula certo', async () => {
    const r = await navigator.buscar({ query: 'dano moral', origens: ['T'], tipos: ['D'] });
    assert(r.totais.D !== undefined, 'aba D não veio na resposta');
    if (r.resultados.length) {
      assert(r.resultados[0].tipoDocumento === 'Decisão Monocrática',
        `monocrática rotulada como "${r.resultados[0].tipoDocumento}"`);
    }
  });

  await teste('Operadores E / OU mudam a contagem (não viram palavra literal)', async () => {
    const e = await navigator.buscar({ query: 'dano E moral', origens: ['T'], tipos: ['A'] });
    const ou = await navigator.buscar({ query: 'dano OU moral', origens: ['T'], tipos: ['A'] });
    assert(ou.total > e.total,
      `OU (${ou.total}) deveria trazer mais que E (${e.total}) — se iguais, viraram texto literal`);
  });

  await teste('Checker: consulta por nº acha processo conhecido e valida CNJ', async () => {
    const r = await checker.consultarProcesso('1401542-58.2023.8.12.0000');
    assert(r.encontrado, 'processo conhecido não encontrado no cjsg');
    assert(r.formatoCNJ && r.numeroValido, 'número CNJ não validou');
    assert(r.tjms, 'CNJ não reconhecido como TJMS (justiça 8, tribunal 12)');
  });

  await teste('Checker: um processo pode ter MAIS DE UM documento', async () => {
    const r = await checker.consultarProcesso('1401542-58.2023.8.12.0000');
    assert(r.total >= 2,
      `esperava acórdão + monocrática (${r.total} veio). O nº do processo não identifica o documento — ` +
      'é o cdAcordao que identifica.');
    const ids = new Set(r.decisoes.map((d) => d.cdAcordao));
    assert(ids.size === r.decisoes.length, 'cdAcordao repetido entre decisões do mesmo processo');
  });

  await teste('Checker: número inexistente não é dado como encontrado', async () => {
    const r = await checker.consultarProcesso('9999999-99.9999.8.12.9999');
    assert(!r.encontrado, 'número inventado voltou como encontrado');
  });

  await teste('Inteiro teor é PDF e baixa SEM sessão (contexto limpo)', async () => {
    assert(julgadoBase, 'sem julgado base');
    const virgem = new TJMSNavigator();
    const doc = await virgem.inteiroTeor(julgadoBase.cdAcordao, julgadoBase.cdForo);
    assert(doc.ehPdf, `esperava PDF, veio ${doc.contentType}`);
    assert(doc.bytes > 10000, `PDF pequeno demais (${doc.bytes} bytes)`);
  });

  await teste('Permalink do documento abre em contexto limpo', async () => {
    const url = TJMSNavigator.permalink(julgadoBase.cdAcordao, julgadoBase.cdForo);
    assert(url === julgadoBase.inteiroTeorLink, 'permalink divergente do inteiroTeorLink do card');
    const res = await fetch(url);
    assert(res.status === 200, `permalink respondeu HTTP ${res.status} sem cookie`);
  });

  await teste('Crawler: search() dedup por cdAcordao ao paginar', async () => {
    const crawler = new TJMSCrawler({ log: () => {} });
    const r = await crawler.search('usucapião', { origem: 'comum', tipo: 'acordao' }, { maxPages: 2 });
    assert(r.length > TJMSNavigator.POR_PAGINA, `esperava 2 páginas, veio ${r.length}`);
    const ids = new Set(r.map((x) => x.cdAcordao));
    assert(ids.size === r.length, `duplicatas no resultado (${r.length} itens, ${ids.size} ids)`);
  });

  await teste('Crawler: avisarAcento pega query sem acento e ignora a acentuada', async () => {
    assert(TJMSCrawler.avisarAcento('usucapiao'), 'não avisou sobre "usucapiao"');
    assert(!TJMSCrawler.avisarAcento('usucapião'), 'avisou à toa sobre "usucapião"');
  });

  await teste('Crawler: origem/tipo inválidos falham cedo, com mensagem útil', async () => {
    const crawler = new TJMSCrawler({ log: () => {} });
    for (const [f, campo] of [[{ origem: 'juizado' }, 'origem'], [{ tipo: 'sumula' }, 'tipo']]) {
      let erro = null;
      try { crawler.montarFiltros('x', f); } catch (e) { erro = e; }
      assert(erro && erro.message.includes(campo), `${campo} inválido não foi rejeitado`);
    }
  });

  if (!rapido) {
    await teste('fetchInteiroTeorBatch grava PDF + texto útil', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjms-testes-'));
      try {
        const crawler = new TJMSCrawler({ log: () => {} });
        const lote = await crawler.fetchInteiroTeorBatch([julgadoBase], dir, { log: () => {} });
        assert(lote[0].arquivo, `fetchInteiroTeorBatch não gravou arquivo: ${lote[0].downloadError}`);
        const size = fs.statSync(path.join(dir, lote[0].arquivo)).size;
        assert(size > 2000, `arquivo muito pequeno (${size} bytes)`);
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
        if (TJMSCrawler.temPdfToText()) {
          const txt = fs.readFileSync(path.join(dir, lote[0].arquivo), 'utf-8');
          assert(txt.includes('=== INTEIRO TEOR (PDF) ==='), 'seção de inteiro teor ausente');
          assert(txt.split('=== INTEIRO TEOR (PDF) ===')[1].trim().length > 1000,
            'inteiro teor vazio — o PDF não rendeu texto');
        }
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
