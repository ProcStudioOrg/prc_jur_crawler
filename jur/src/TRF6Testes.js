// src/TRF6Testes.js
// Suíte de testes do stack TRF6 (Navigator, Crawler, Checker).
// Bate no site real — precisa de rede, mas NÃO sobe browser (o portal fala HTTP).
//   node src/TRF6Testes.js            # suíte completa
//   node src/TRF6Testes.js --rapido   # pula download de inteiro teor
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TRF6Navigator = require('./TRF6Navigator');
const TRF6Crawler = require('./TRF6Crawler');
const TRF6Checker = require('./TRF6Checker');

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

(async () => {
  console.log('='.repeat(60));
  console.log('TRF6 — Testes de integração (site real, HTTP puro)');
  console.log('='.repeat(60));

  const navigator = new TRF6Navigator({ log: () => {} });
  const crawler = new TRF6Crawler({ navigator, log: () => {} });
  const checker = new TRF6Checker({ navigator });

  // Termo e período fixos. As contagens são comparadas ENTRE SI, nunca contra
  // valores absolutos — a base cresce todo dia.
  const TERMO = 'dano moral';
  const DI = '01/01/2026';
  const DF = '31/03/2026';

  const contagem = {};
  let primeiroResultado = null;

  await teste('Navigator: normalizarQuery NÃO mexe na query (aqui o espaço funciona)', async () => {
    assert(TRF6Navigator.normalizarQuery('dano moral').query === 'dano moral',
      'hifenizou a query — isso é o remédio do TRF2 e aqui QUEBRA os operadores');
    assert(TRF6Navigator.normalizarQuery('dano ou moral').alterada === false, 'mexeu no OU');
    assert(TRF6Navigator.normalizarQuery('"aposentadoria especial"').alterada === false, 'mexeu na frase exata');
    assert(TRF6Navigator.normalizarQuery('dano and moral').aviso, 'não avisou sobre operador em inglês');
    assert(TRF6Navigator.normalizarQuery('"and justice for all"').aviso === null,
      'confundiu "and" dentro de frase exata com operador');
  });

  await teste('Navigator: espaço e hífen dão a MESMA contagem (não há o bug do TRF2)', async () => {
    const comEspaco = await navigator.pesquisar({ query: 'dano moral', origens: ['1'] });
    const comHifen = await navigator.pesquisar({ query: 'dano-moral', origens: ['1'] });
    contagem.espaco = comEspaco.total;
    contagem.hifen = comHifen.total;
    assert(comEspaco.total === comHifen.total,
      `espaço e hífen divergiram (espaço=${comEspaco.total} hífen=${comHifen.total}) — ` +
      'se isso acontecer, o TRF6 regrediu para o comportamento do TRF2; releia CLAUDE-TRF6.md');
  });

  await teste('Navigator: álgebra dos operadores fecha exato (E / OU / NÃO)', async () => {
    const n = async (q) => (await navigator.pesquisar({ query: q, origens: ['1'] })).total;
    const [a, b, e, ou, nao] = await Promise.all([
      n('dano'), n('moral'), n('dano e moral'), n('dano ou moral'), n('dano nao moral'),
    ]);
    Object.assign(contagem, { dano: a, moral: b, E: e, OU: ou, NAO: nao });
    assert(ou === a + b - e, `OU não fecha: ${ou} != ${a} + ${b} - ${e}`);
    assert(nao === a - e, `NÃO não fecha: ${nao} != ${a} - ${e}`);
  });

  await teste('Navigator: operador em INGLÊS vira termo literal (é armadilha, não sinônimo)', async () => {
    const pt = await navigator.pesquisar({ query: 'dano e moral', origens: ['1'] });
    const en = await navigator.pesquisar({ query: 'dano and moral', origens: ['1'] });
    assert(en.total < pt.total / 10,
      `esperava "and" devolvendo quase nada; veio and=${en.total} e=${pt.total}`);
  });

  await teste('Crawler: busca simples devolve resultados com os campos do repo', async () => {
    const r = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 1 });
    assert(r.length > 0, 'nenhum resultado');
    assert(r.totalResults > 0, 'totalResults ausente');
    const x = r[0];
    // ⚠️ .4.06. E .4.01. são válidos: o acervo herdou processos do TRF1 (ago/2022)
    assert(/^\d{7}-\d{2}\.\d{4}\.4\.(06|01)\.\d{4}$/.test(x.numeroProcesso),
      `nº fora do padrão CNJ do TRF6/TRF1: ${x.numeroProcesso}`);
    assert(x.dataJulgamento, 'sem data de julgamento');
    assert(x.inteiroTeorLink, 'sem link de inteiro teor');
    assert(x.ementa || x.decisao, 'sem ementa nem decisão');
    assert(['MG', ''].includes(x.uf), `UF inesperada num tribunal de MG: ${x.uf}`);
    primeiroResultado = x;
    contagem.buscaSimples = r.totalResults;
  });

  await teste('Crawler: a DESAMBIGUAÇÃO funciona — origens somam exato', async () => {
    const f = { dataInicio: DI, dataFim: DF };
    const trf6 = await crawler.search(TERMO, { ...f, origem: 'trf6' }, { maxPages: 1 });
    const turmas = await crawler.search(TERMO, { ...f, origem: 'turmas' }, { maxPages: 1 });
    const tru = await crawler.search(TERMO, { ...f, origem: 'tru' }, { maxPages: 1 });
    const varas = await crawler.search(TERMO, { ...f, origem: 'varas' }, { maxPages: 1 });
    const todas = await crawler.search(TERMO, { ...f, origem: 'todas' }, { maxPages: 1 });
    Object.assign(contagem, {
      origemTRF6: trf6.totalResults, origemTurmas: turmas.totalResults,
      origemTRU: tru.totalResults, origemVaras: varas.totalResults, origemTodas: todas.totalResults,
    });
    assert(trf6.totalResults !== turmas.totalResults,
      'TRF6 e Turmas Recursais devolveram a MESMA contagem — o filtro de origem não está sendo aplicado');
    assert(todas.totalResults === trf6.totalResults + turmas.totalResults + tru.totalResults + varas.totalResults,
      `soma não fecha: ${todas.totalResults} != ${trf6.totalResults}+${turmas.totalResults}+${tru.totalResults}+${varas.totalResults}`);
    // sinal na própria saída: o sufixo do processo muda com a origem
    assert(turmas.length === 0 || turmas[0].sufixoOrigem === 'MG',
      `Turma Recursal deveria vir com sufixo MG, veio "${turmas[0]?.sufixoOrigem}"`);
    assert(trf6[0].sufixoOrigem === 'TRF6',
      `2º grau comum deveria vir com sufixo TRF6, veio "${trf6[0]?.sufixoOrigem}"`);
    assert(turmas.length === 0 || /TURMA RECURSAL/i.test(turmas[0].orgaoJulgador),
      `órgão julgador não parece Turma Recursal: ${turmas[0]?.orgaoJulgador}`);
  });

  await teste('Crawler: "Varas Federais" (1º grau) está declarada e VAZIA — e o crawler avisa', async () => {
    const r = await crawler.search(TERMO, { origem: 'varas' }, { maxPages: 1 });
    assert(r.totalResults === 0, `Varas Federais deixou de ser vazia (${r.totalResults}) — atualize CLAUDE-TRF6.md`);
    assert(r.avisos.some((a) => /VAZIA/i.test(a)), 'não avisou que a origem está vazia');
  });

  await teste('Crawler: avisa que a base começa em 2023 quando pedem período anterior', async () => {
    const r = await crawler.search(TERMO, { origem: 'trf6', dataInicio: '01/01/2018', dataFim: '31/12/2019' }, { maxPages: 1 });
    assert(r.totalResults === 0, `esperava 0 antes de 2023, veio ${r.totalResults}`);
    assert(r.avisos.some((a) => /TRF1/.test(a)), 'não apontou o TRF1 como acervo anterior');
  });

  await teste('Crawler: filtro de data de JULGAMENTO restringe de fato', async () => {
    const sem = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 1 });
    const com = await crawler.search(TERMO, { origem: 'trf6', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
    contagem.semData = sem.totalResults;
    contagem.comData = com.totalResults;
    assert(com.totalResults < sem.totalResults, `data não restringiu: ${com.totalResults} >= ${sem.totalResults}`);
    for (const r of com.slice(0, 5)) {
      const [d, m, a] = r.dataJulgamento.split('/').map(Number);
      assert(a === 2026 && m >= 1 && m <= 3, `julgamento fora do intervalo: ${r.dataJulgamento}`);
      assert(d >= 1 && d <= 31, `dia inválido: ${r.dataJulgamento}`);
    }
  });

  await teste('Crawler: data de PUBLICAÇÃO é um filtro DIFERENTE do de julgamento', async () => {
    const julg = await crawler.search(TERMO, { origem: 'trf6', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
    const publ = await crawler.search(TERMO, { origem: 'trf6', dataPubInicio: DI, dataPubFim: DF }, { maxPages: 1 });
    contagem.dataJulgamento = julg.totalResults;
    contagem.dataPublicacao = publ.totalResults;
    assert(publ.totalResults > 0, 'filtro de publicação zerou');
    assert(publ.totalResults !== julg.totalResults,
      'julgamento e publicação deram a MESMA contagem — provavelmente é o mesmo filtro');
    for (const r of publ.slice(0, 5)) {
      assert(/\/(01|02|03)\/2026$/.test(r.dataPublicacao), `publicação fora do intervalo: ${r.dataPublicacao}`);
    }
  });

  await teste('Crawler: paginação anda além da página 1 (itens distintos)', async () => {
    const r = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 3 });
    assert(r.length > 10, `paginação parou na página 1: ${r.length} resultados`);
    const ids = new Set(r.map((x) => x.id));
    assert(ids.size === r.length, `ids repetidos entre páginas: ${r.length} itens, ${ids.size} únicos`);
  });

  await teste('Crawler: --por-pagina 100 traz 100 numa página só', async () => {
    const r = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 1, tamanhoPagina: 100 });
    assert(r.length === 100, `esperava 100 numa página, veio ${r.length}`);
  });

  await teste('Crawler: tipo de documento fatia a busca e soma o total', async () => {
    const f = { origem: 'trf6', dataInicio: DI, dataFim: DF };
    const total = await crawler.search(TERMO, f, { maxPages: 1 });
    const partes = [];
    for (const t of ['acordao', 'monocratica', 'sumula', 'despacho-vice']) {
      partes.push((await crawler.search(TERMO, { ...f, tipos: [t] }, { maxPages: 1 })).totalResults);
    }
    const soma = partes.reduce((a, b) => a + b, 0);
    contagem.tipos = partes;
    assert(soma === total.totalResults, `tipos não somam o total: ${soma} != ${total.totalResults}`);
  });

  await teste('Crawler: tipo inexistente na origem é RECUSADO (não filtra de mentira)', async () => {
    let erro = null;
    try {
      await crawler.search(TERMO, { origem: 'turmas', tipos: ['monocratica'] }, { maxPages: 1 });
    } catch (e) { erro = e; }
    assert(erro, 'aceitou "monocratica" nas Turmas Recursais, onde só existe Acórdão');
  });

  await teste('Crawler: escopo ementa é mais restrito que inteiro teor (o default)', async () => {
    const it = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 1 });
    const em = await crawler.search(TERMO, { origem: 'trf6', escopo: 'ementa' }, { maxPages: 1 });
    contagem.inteiroTeor = it.totalResults;
    contagem.ementa = em.totalResults;
    assert(em.totalResults < it.totalResults, `ementa não restringiu: ${em.totalResults} >= ${it.totalResults}`);
  });

  await teste('Crawler: filtro de órgão julgador restringe', async () => {
    const sem = await crawler.search(TERMO, { origem: 'trf6' }, { maxPages: 1 });
    const com = await crawler.search(TERMO, { origem: 'trf6', orgaos: ['Plenário'] }, { maxPages: 1 });
    assert(com.totalResults < sem.totalResults, `órgão não restringiu: ${com.totalResults} >= ${sem.totalResults}`);
  });

  await teste('Checker: valida CNJ e aceita tanto .4.06. quanto .4.01. (herança do TRF1)', async () => {
    assert(checker.ehFormatoCNJ('1017514-90.2019.4.01.9999'), 'não reconheceu formato CNJ');
    assert(checker.ehProcessoTRF6('1017514-90.2019.4.01.9999'), 'rejeitou processo herdado do TRF1');
    assert(checker.ehHerancaTRF1('1017514-90.2019.4.01.9999'), 'não marcou como herança do TRF1');
    assert(!checker.ehProcessoTRF6('5014543-38.2025.8.24.0054'), 'aceitou processo do TJSC como TRF6');
    assert(!checker.ehProcessoTRF6('5081315-58.2021.4.02.5101'), 'aceitou processo do TRF2 como TRF6');
  });

  await teste('Checker: acha um processo conhecido pelo número', async () => {
    assert(primeiroResultado, 'sem resultado da busca anterior');
    const res = await checker.consultarProcesso(primeiroResultado.numeroProcesso);
    assert(res.encontrado, `processo ${primeiroResultado.numeroProcesso} não encontrado`);
    assert(res.decisoes.some((d) => d.id === primeiroResultado.id),
      `documento ${primeiroResultado.id} não voltou (ids: ${res.decisoes.map((d) => d.id).join(', ')})`);
  });

  await teste('Checker: número inexistente devolve encontrado:false (sem explodir)', async () => {
    const res = await checker.consultarProcesso('0000000-00.2099.4.06.9999');
    assert(res.encontrado === false, 'inventou um processo que não existe');
  });

  await teste('Checker: auditoria confirma a amostra', async () => {
    const r = await crawler.search(TERMO, { origem: 'trf6', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
    const audit = await checker.verificarResultados(r, { amostra: 3 });
    assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
    assert(audit.confirmados === 3,
      `divergências: ${JSON.stringify(audit.detalhes.filter((d) => !d.confirmado))}`);
  });

  if (!rapido) {
    await teste('Navigator: baixa o inteiro teor e grava em disco', async () => {
      assert(primeiroResultado?.inteiroTeorLink, 'sem link de inteiro teor');
      const { html, texto } = await navigator.baixarInteiroTeor(primeiroResultado.inteiroTeorLink);
      assert(html.length > 1000, `HTML muito curto: ${html.length}`);
      assert(texto.length > 300, `texto muito curto: ${texto.length}`);
      assert(!texto.includes('�'), 'texto com mojibake — decodificação de charset quebrou');

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trf6-testes-'));
      try {
        const lote = await navigator.baixarLote([primeiroResultado], dir, { log: () => {}, formats: ['txt', 'html'] });
        assert(lote[0].arquivo, `baixarLote não gravou: ${lote[0].downloadError || ''}`);
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  console.log('='.repeat(60));
  console.log(`Contagens observadas: ${JSON.stringify(contagem)}`);
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
