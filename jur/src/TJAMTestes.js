// src/TJAMTestes.js
// Suíte de testes do stack TJAM (Navigator, Crawler, Checker) — e-SAJ cjsg.
// Bate no site real — precisa de rede. Uso:
//   node src/TJAMTestes.js            # suíte completa
//   node src/TJAMTestes.js --rapido   # pula a gravação em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJAMNavigator = require('./TJAMNavigator');
const TJAMCrawler = require('./TJAMCrawler');
const TJAMChecker = require('./TJAMChecker');

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

/** O cjsg responde por mais de um nó (`.cjsg1`…`.cjsg3`). Tolerância pequena. */
const proximos = (a, b, tolerancia = 0.01) =>
  Math.abs(a - b) <= Math.max(5, Math.max(a, b) * tolerancia);

(async () => {
  console.log('='.repeat(60));
  console.log('TJAM — Testes de integração (site real, e-SAJ cjsg)');
  console.log('='.repeat(60));

  const navigator = new TJAMNavigator();
  const checker = new TJAMChecker({ navigator });
  let julgadoBase = null;
  let totalComum = 0;

  await teste('busca simples devolve resultados e total exato', async () => {
    const r = await navigator.buscar({ query: 'dano moral' });
    assert(r.total > 1000, `total baixo demais: ${r.total}`);
    assert(r.resultados.length === TJAMNavigator.POR_PAGINA,
      `esperava ${TJAMNavigator.POR_PAGINA} cards, veio ${r.resultados.length}`);
    assert(!r.formularioDeVolta, 'o cjsg devolveu o formulário em vez do resultado');
    totalComum = r.total;
    julgadoBase = r.resultados[0];
  });

  await teste('a página é de 10 — não 20 (TJAC) nem 100 (TJMS)', async () => {
    assert(TJAMNavigator.POR_PAGINA === 10, `POR_PAGINA=${TJAMNavigator.POR_PAGINA}`);
  });

  await teste('o card traz ementa ÍNTEGRA, não trecho', async () => {
    assert(julgadoBase, 'sem julgado base');
    assert(julgadoBase.ementa.length > 500,
      `ementa curta demais (${julgadoBase.ementa.length} chars) — virou trecho?`);
    assert(!/Data de registro/i.test(julgadoBase.ementa),
      'o rodapé de citação vazou para dentro da ementa');
  });

  await teste('a citação é extraída e começa pela CLASSE (formato do AM)', async () => {
    assert(julgadoBase.citacao, 'sem citação');
    assert(/^TJAM\. /.test(julgadoBase.citacao), `citação sem prefixo: ${julgadoBase.citacao}`);
    assert(/Relator \(a\):/.test(julgadoBase.citacao), 'citação sem relator');
    assert(/Data de registro:/.test(julgadoBase.citacao), 'citação sem data de registro');
  });

  await teste('metadados do card estão preenchidos', async () => {
    for (const campo of ['processo', 'classe', 'relator', 'comarca', 'orgaoJulgador', 'dataPublicacao']) {
      assert(julgadoBase[campo], `campo vazio: ${campo}`);
    }
    assert(julgadoBase.uf === 'AM' && julgadoBase.tribunal === 'TJAM', 'uf/tribunal errados');
  });

  await teste('paginação anda e é estável (mesma página 2×)', async () => {
    const filtros = { query: 'dano moral' };
    const assinatura = TJAMNavigator.corpo(filtros);
    await navigator.buscar(filtros);
    const a = await navigator.paginar(2, 'A', assinatura);
    assert(a.resultados.length > 0, 'página 2 veio vazia');
    const b = await navigator.paginar(2, 'A', assinatura);
    assert(a.resultados.map((r) => r.id).join(',') === b.resultados.map((r) => r.id).join(','),
      'a mesma página devolveu documentos diferentes entre requisições');
  });

  await teste('paginar() sem sessão falha em vez de devolver página errada', async () => {
    const virgem = new TJAMNavigator();
    let erro = null;
    try { await virgem.paginar(2, 'A'); } catch (e) { erro = e; }
    assert(erro, 'paginar() sem sessão deveria falhar');
  });

  await teste('paginar() depois de OUTRA busca na mesma sessão é recusado', async () => {
    const assinaturaAntiga = TJAMNavigator.corpo({ query: 'dano moral' });
    await navigator.buscar({ query: 'usucapião' });
    let erro = null;
    try { await navigator.paginar(2, 'A', assinaturaAntiga); } catch (e) { erro = e; }
    assert(erro && /ÚLTIMA busca/.test(erro.message),
      'o guard de paginação órfã não disparou — trocaDePagina.do pagina a última busca da sessão');
  });

  await teste('a desambiguação comum × turmas muda a contagem', async () => {
    const comum = await navigator.buscar({ query: 'dano moral', origens: ['T'] });
    const turmas = await navigator.buscar({ query: 'dano moral', origens: ['R'] });
    assert(!proximos(comum.total, turmas.total),
      `contagem igual (${comum.total} × ${turmas.total}) = filtro ignorado`);
    assert(turmas.total > comum.total,
      `no AM os Colégios Recursais devem ser MAIORES que o 2º grau (${turmas.total} × ${comum.total})`);
  });

  await teste('o filtro de data restringe de fato', async () => {
    const r = await navigator.buscar({
      query: 'dano moral',
      dataPublicacaoInicio: '01/01/2024', dataPublicacaoFim: '31/03/2024',
    });
    assert(r.total > 0, 'filtro de data zerou');
    assert(r.total < totalComum, `filtro não restringiu (${r.total} × ${totalComum})`);
  });

  await teste('acento NÃO muda a busca (ao contrário do TJMS)', async () => {
    const sem = await navigator.buscar({ query: 'usucapiao' });
    const com = await navigator.buscar({ query: 'usucapião' });
    assert(proximos(sem.total, com.total),
      `o índice deveria normalizar acento: ${sem.total} × ${com.total}`);
  });

  await teste('ADJ/PROX/$ zeram a busca — e o crawler avisa', async () => {
    const r = await navigator.buscar({ query: 'dano ADJ2 moral' });
    assert(r.total === 0, `ADJ deveria zerar, veio ${r.total}`);
    assert(TJAMCrawler.avisarOperadores('dano ADJ2 moral').length, 'sem aviso para ADJ');
    assert(TJAMCrawler.avisarOperadores('usucapi$').length, 'sem aviso para $');
    assert(TJAMCrawler.avisarOperadores('dano NÃO moral').length, 'sem aviso para NÃO acentuado');
  });

  await teste('intervalo > 1 ano é RECUSA, não zero', async () => {
    const r = await navigator.buscar({
      query: 'dano moral',
      dataJulgamentoInicio: '01/01/2020', dataJulgamentoFim: '31/12/2025',
    });
    assert(r.formularioDeVolta, 'esperava o formulário de volta (busca recusada)');
    assert(r.avisoIntervalo, 'esperava o aviso "no máximo 1 ano" na tela');
  });

  await teste('o crawler fatia por ANO DE CALENDÁRIO, não por 364 dias', async () => {
    const j = TJAMCrawler.janelas('01/01/2023', '31/12/2024');
    assert(j && j.length === 2, `esperava 2 janelas, veio ${j && j.length}`);
    // ano comum E ano bissexto inteiros cabem numa busca só — um fatiador de
    // 364 dias corridos partiria 2024 em duas sem necessidade
    assert(TJAMCrawler.janelas('01/01/2025', '31/12/2025') === null, 'ano comum não deveria fatiar');
    assert(TJAMCrawler.janelas('01/01/2024', '31/12/2024') === null, 'ano bissexto não deveria fatiar');
    // e o limite é a véspera da data-aniversário, medido nos dois sentidos
    assert(TJAMCrawler.janelas('15/06/2023', '14/06/2024') === null, '365 dias aqui é aceito pelo portal');
    assert(TJAMCrawler.janelas('15/06/2023', '15/06/2024') !== null, '366 dias aqui é recusado pelo portal');
    assert(TJAMCrawler.janelas('01/03/2023', '29/02/2024') === null, '366 dias sobre 29/02 é aceito pelo portal');
  });

  await teste('a aba H existe no formulário mas o acervo é ZERO', async () => {
    const r = await navigator.buscar({ query: 'dano moral', origens: ['T', 'R'], tipos: ['H'] });
    assert(r.totais.H === 0, `esperava H=0, veio ${r.totais.H}`);
  });

  await teste('a base está PARADA — 2026 devolve zero', async () => {
    const r = await navigator.buscar({
      query: 'dano moral',
      dataPublicacaoInicio: '01/01/2026', dataPublicacaoFim: '31/12/2026',
    });
    assert(!r.formularioDeVolta, 'a busca foi recusada, não é o caso a medir');
    assert(r.total === 0,
      `🎉 2026 devolveu ${r.total} — A BASE VOLTOU A SER ALIMENTADA. Atualize CLAUDE-TJAM.md.`);
  });

  await teste('a data-sentinela 01/06/2004 existe e é o ano de 2004 inteiro', async () => {
    const dia = await navigator.buscar({
      query: 'dano moral', dataJulgamentoInicio: '01/06/2004', dataJulgamentoFim: '01/06/2004',
    });
    const ano = await navigator.buscar({
      query: 'dano moral', dataJulgamentoInicio: '01/01/2004', dataJulgamentoFim: '31/12/2004',
    });
    assert(dia.total > 0, 'a sentinela sumiu?');
    assert(dia.total === ano.total,
      `o ano de 2004 deveria ser só o dia 01/06 (${ano.total} × ${dia.total})`);
    assert(TJAMCrawler.avisarDataSentinela({ dataJulgamentoInicio: '01/01/2025' }),
      'sem aviso da data-sentinela ao filtrar por julgamento');
  });

  await teste('consulta por número encontra um processo conhecido', async () => {
    const r = await checker.consultarProcesso('0708349-62.2020.8.04.0001');
    assert(r.encontrado, 'processo conhecido não encontrado');
    assert(r.formatoCNJ && r.numeroValido, 'número CNJ deveria ser válido');
    assert(r.tjam, 'deveria ser reconhecido como processo do TJAM (justiça 8, tribunal 04)');
  });

  await teste('consulta por número funciona sem máscara', async () => {
    const r = await checker.consultarProcesso('07083496220208040001');
    assert(r.encontrado, 'não encontrou sem máscara');
  });

  await teste('🔴 o inteiro teor continua atrás de reCAPTCHA', async () => {
    let erro = null;
    try { await navigator.inteiroTeor(julgadoBase.cdAcordao, julgadoBase.cdForo); } catch (e) { erro = e; }
    assert(erro, '🎉 o getArquivo.do devolveu PDF — O BLOQUEIO CAIU. Atualize CLAUDE-TJAM.md.');
    assert(/reCAPTCHA/i.test(erro.message), `falhou por outro motivo: ${erro.message}`);
  });

  await teste('não existe permalink — e o crawler não finge que existe', async () => {
    assert(julgadoBase.inteiroTeorLink === null, 'inteiroTeorLink deveria ser null');
    assert(julgadoBase.inteiroTeorUrlBloqueada.includes('getArquivo.do'),
      'a URL bloqueada deveria estar rotulada para diagnóstico');
  });

  await teste('crawler.search() devolve julgados deduplicados', async () => {
    const crawler = new TJAMCrawler({ log: () => {} });
    const r = await crawler.search('dano moral', {}, { maxPages: 2 });
    assert(r.length === 20, `esperava 20 (2 páginas de 10), veio ${r.length}`);
    assert(new Set(r.map((x) => x.id)).size === r.length, 'houve duplicata');
    assert(crawler.ultimaBusca.totalTJAM > 1000, 'total não registrado');
  });

  if (!rapido) {
    await teste('--fetch-inteiro-teor grava a ementa e diz que o PDF não veio', async () => {
      const crawler = new TJAMCrawler({ log: () => {} });
      const r = await crawler.search('dano moral', {}, { maxPages: 1 });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjam-'));
      const saida = await crawler.fetchInteiroTeorBatch(r.slice(0, 2), dir, { log: () => {} });
      assert(saida.length === 2, 'não gravou os dois');
      const txt = fs.readFileSync(path.join(dir, saida[0].arquivo), 'utf-8');
      assert(txt.includes('=== EMENTA'), 'sem bloco de ementa');
      assert(/NÃO DISPONÍVEL/.test(txt), 'não avisou que o inteiro teor não veio');
      assert(/Permalink: NÃO EXISTE/.test(txt), 'não avisou a ausência de permalink');
      assert(txt.length > 1000, `arquivo curto demais: ${txt.length}`);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  console.log('='.repeat(60));
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`${ok}/${resultados.length} testes passaram`);
  for (const r of resultados.filter((x) => !x.ok)) console.log(`  FAIL: ${r.nome} — ${r.erro}`);
  process.exit(ok === resultados.length ? 0 : 1);
})();
