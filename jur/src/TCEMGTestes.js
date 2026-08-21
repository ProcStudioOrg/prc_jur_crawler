// src/TCEMGTestes.js — integracao TCE-MG (MapJuris). Rode: node src/TCEMGTestes.js
const TCEMGCrawler = require('./TCEMGCrawler');
const TCEMGChecker = require('./TCEMGChecker');
const TCEMGNavigator = require('./TCEMGNavigator');

const log = () => {};
const T = [];
const t = (nome, fn) => T.push([nome, fn]);
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ⚠️ UMA SESSAO PARA A SUITE INTEIRA. Cada `new TCEMGNavigator()` abre uma sessao
// nova, e o TCE-MG responde HTTP 429 depois de ~20 delas em poucos minutos — a
// primeira versao desta suite derrubou o portal para si mesma no 14º teste.
const nav = new TCEMGNavigator({ log });
const crawler = () => new TCEMGCrawler({ log, nav });
/** Janela de referencia de todas as contagens abaixo (medidas em 20/08/2026). */
const W = { dataInicio: '01/01/2025', dataFim: '31/12/2025', maxPages: 1 };
const total = async (o) => (await crawler().buscar({ ...W, ...o })).total;

t('busca simples devolve total EXATO, resultados e permalink', async () => {
  const r = await crawler().buscar({ ...W, query: 'licitação' });
  eq(r.total, 21, 'licitação em 2025');
  eq(r.retornados, 21, 'o grid traz tudo de uma vez (quantidade=0 = TODOS)');
  eq(r.totalExato, true, 'total do MapJuris e exato, nao saturado');
  const d = r.resultados[0];
  ok(d.id && d.ementa && d.url, 'documento precisa de id, ementa e permalink');
  ok(d.url.includes(d.id), 'o permalink e montado com o id');
});

t('🔴 SEM o gridHelper o segundo salto responde 200 com <tr> VAZIO — casca de sucesso', async () => {
  const b = await nav.buscar({ termo: 'licitação', dataInicio: '01/01/2025', dataFim: '31/12/2025' });
  ok(b.gridHelper, 'a busca tem de trazer o hidden de colunas');

  // Com o template: linhas montadas.
  const bom = await nav.grid(b.gridHelper, { quantidade: 0 });
  eq(TCEMGCrawler._linhas(bom.html).length, 21, 'com gridHelper tem de montar 21 linhas');

  // Com um template VAZIO (o reflexo de quem nao leu o hidden): 200, total certo,
  // e NENHUMA celula. E o modo de falhar mais caro deste portal.
  const cru = await nav._req('POST', '/TextualDadosProcesso/ConsultarInformacaoExcertoIntegra', {
    body: TCEMGNavigator._form({
      strIrParaPagina: 1, strQuantidadeRegistros: '5', strFiltro: '', PrimeiraRequisicao: true,
      IdTabela: 'gridExcertoIntegra', strNomeCampoOrdenar: '', tipoOrdenacao: 0,
      strNomeColunaFiltrar: '', GerarExcel: false, primeiraRequisicao: true, gridHelper: '',
    }),
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: TCEMGNavigator.TELA },
  });
  eq(cru.status, 200, 'a casca vazia vem com HTTP 200');
  const j = JSON.parse(cru.body.toString('utf8'));
  ok(j.totalRegistros > 0, 'e o total ate vem certo');
  ok(!/<td/.test(j.htmlGrid || ''), 'mas nao ha celula nenhuma — 200 sem conteudo');
});

t('🔴 a GRID segue a ULTIMA busca da sessao, nao o parametro', async () => {
  const a = await nav.buscar({ termo: 'pregão', dataInicio: '01/01/2025', dataFim: '31/12/2025' });
  const ga = await nav.grid(a.gridHelper, { quantidade: 0 });
  eq(ga.total, 7, 'pregão em 2025');

  // Intercala outra busca NA MESMA SESSAO e repagina com o gridHelper de "pregão".
  await nav.buscar({ termo: 'nepotismo', dataInicio: '01/01/2020', dataFim: '31/12/2026' });
  const ga2 = await nav.grid(a.gridHelper, { quantidade: 0 });
  ok(ga2.total !== ga.total,
    'a grid TEM de devolver a busca nova — se devolvesse a antiga, a armadilha teria sumido ' +
    'e este teste precisaria ser reescrito');
  ok(ga2.status === 200 && TCEMGCrawler._linhas(ga2.html).length === ga2.total,
    'e o pior: vem HTTP 200 com cards validos, sem sintoma nenhum');
});

t('filtro de data RESTRINGE de fato (contagens diferentes)', async () => {
  const ano2025 = await total({ query: 'licitação' });
  const ano2026 = await total({ query: 'licitação', dataInicio: '01/01/2026', dataFim: '31/12/2026' });
  const junho = await total({ query: 'licitação', dataInicio: '01/06/2026', dataFim: '30/06/2026' });
  eq(ano2025, 21, '2025');
  eq(ano2026, 6, '2026 inteiro');
  eq(junho, 1, 'so junho/2026');
  ok(junho < ano2026 && ano2026 < ano2025, 'janela menor tem de trazer menos');
});

t('🔴 tipoPesquisa: INDEXACAO e SUBCONJUNTO — e a diferenca so aparece nas LINHAS', async () => {
  const janela = { termo: 'licitação', dataInicio: '01/01/2025', dataFim: '30/06/2025' };
  const bytes = {};
  const totais = {};
  for (const tp of ['IndexExcerto', 'EXCERTO', 'INDEXACAO']) {
    const b = await nav.buscar({ ...janela, tipoPesquisa: tp });
    bytes[tp] = b.bytes;
    totais[tp] = (await nav.grid(b.gridHelper, { quantidade: 0 })).total;
  }
  // A casca e IGUAL nos tres — foi o que fez o mapeamento de 16/08 concluir
  // "parametro ignorado". Ela nao carrega informacao nenhuma sobre o filtro.
  eq(bytes.IndexExcerto, bytes.EXCERTO, 'casca identica');
  eq(bytes.EXCERTO, bytes.INDEXACAO, 'casca identica');
  // E as LINHAS separam.
  eq(totais.IndexExcerto, 11, 'IndexExcerto');
  eq(totais.EXCERTO, 11, 'EXCERTO da o mesmo que IndexExcerto');
  eq(totais.INDEXACAO, 6, 'INDEXACAO e subconjunto');

  // Valor inventado nao e "aba vazia": o portal diz explicitamente que nao achou.
  const inv = await nav.buscar({ ...janela, tipoPesquisa: 'INVENTADO9Z' });
  eq(inv.vazio, true, 'tipoPesquisa invalido tem de cair no "Nenhum registro encontrado"');
});

t('filtro de relator prova por CONTAGEM; e o NOME sozinho nao filtra', async () => {
  eq(await total({ query: 'licitação' }), 21, 'sem relator');
  eq(await total({ query: 'licitação', codRelator: '44' }), 7, 'CONS. DURVAL ANGELO');
  eq(await total({ query: 'licitação', codRelator: '100' }), 6, 'CONS. EM EXERC. TELMO PASSARELI');
  eq(await total({ query: 'licitação', codRelator: '99999' }), 0, 'codigo inventado tem de zerar');
  // 🔴 O NOME e decorativo: mandado sozinho, devolve o total sem filtro.
  eq(await total({ query: 'licitação', nomeRelator: 'CONS. DURVAL ANGELO' }), 21,
    'nomeRelator sem codigo NAO pode filtrar — se filtrasse, o aviso do crawler estaria errado');
});

t('🔴 natureza filtra, MAS o valor inventado nao discrimina — ele e IGNORADO', async () => {
  eq(await total({ query: 'licitação', natureza: '17' }), 21, 'CONSULTA = a base inteira');
  eq(await total({ query: 'licitação', natureza: '20' }), 0, 'DENUNCIA nao esta nesta base');
  // O controle classico falha aqui: valor invalido volta como se nao houvesse filtro.
  eq(await total({ query: 'licitação', natureza: 'XXINVENTADOXX' }), 21,
    'natureza nao-numerica tem de ser IGNORADA (e o crawler avisa disso)');
});

t('conectores: E/OU/aspas/% funcionam; espaco e "NAO" sem til ZERAM', async () => {
  eq(await total({ query: 'licitação E pregão' }), 7, 'E = intersecao');
  eq(await total({ query: 'licitação OU pregão' }), 21, 'OU = uniao');
  eq(await total({ query: '"pregão eletrônico"' }), 1, 'frase exata');
  eq(await total({ query: 'licita%' }), 25, 'curinga % amplia (licitação sozinho = 21)');
  eq(await total({ query: 'licitação pregão' }), 0, 'espaco NAO e conectivo');
  eq(await total({ query: 'licitação NAO pregão' }), 0, '"NAO" sem til nao e operador');
  eq(await total({ query: 'licita*' }), 0, 'o curinga NAO e "*"');
});

t('🔴 o operador NÃO restringe DEMAIS — responde plausivel e perde resultado', async () => {
  // ⚠️ Janela de SEIS meses de proposito: sao tres buscas em sequencia, e no ano
  // cheio (12 a 25 s cada) a terceira ja bateu no timeout de 180 s do Navigator
  // numa tarde ruim. Os numeros abaixo sao os de 01/01–30/06/2025.
  const M = { dataInicio: '01/01/2025', dataFim: '30/06/2025', maxPages: 1 };
  const a = await crawler().buscar({ ...M, query: 'licitação' });
  const b = await crawler().buscar({ ...M, query: 'pregão' });
  const n = await crawler().buscar({ ...M, query: 'licitação NÃO pregão' });
  eq(a.total, 11, 'licitação no semestre');
  eq(b.total, 4, 'pregão no semestre');
  const idsB = new Set(b.resultados.map((r) => r.id));
  const diferenca = a.resultados.filter((r) => !idsB.has(r.id));
  eq(diferenca.length, 7, 'A menos B, calculado no cliente');
  eq(n.total, 4, 'o que o servidor devolve para A NÃO B');
  ok(n.resultados.every((r) => !idsB.has(r.id)),
    'os que voltam sao legitimos — o defeito e omissao, nao contaminacao');
  ok(n.avisos.some((x) => /PERDE RESULTADO/.test(x)), 'o crawler tem de avisar');
});

t('paginacao ANDA alem da p.1, e e ESTAVEL rodada duas vezes', async () => {
  const b = await nav.buscar({ termo: 'contrat%', dataInicio: '01/01/2025', dataFim: '31/12/2025' });
  const p1 = await nav.grid(b.gridHelper, { quantidade: 10, pagina: 1 });
  const p2 = await nav.grid(b.gridHelper, { quantidade: 10, pagina: 2, primeira: false });
  const p2bis = await nav.grid(b.gridHelper, { quantidade: 10, pagina: 2, primeira: false });
  eq(p1.total, 34, 'total');
  const ids = (g) => TCEMGCrawler._linhas(g.html).map((l) => (l.match(/DetalhesExcerto\/(\d+)/) || [])[1]);
  eq(ids(p1).length, 10, 'p1');
  eq(ids(p2).length, 10, 'p2');
  eq(ids(p2).join(','), ids(p2bis).join(','), 'a p.2 tem de ser identica nas duas execucoes');
  eq(ids(p1).filter((x) => ids(p2).includes(x)).length, 0, 'p1 e p2 nao podem se sobrepor');

  // Total EXATO: 10 + 10 + 10 + 4.
  const p4 = await nav.grid(b.gridHelper, { quantidade: 10, pagina: 4, primeira: false });
  eq(ids(p4).length, 4, 'ultima pagina parcial');
  // Estourar a paginacao nao erra nem embrulha: 200 com zero linha.
  const p99 = await nav.grid(b.gridHelper, { quantidade: 10, pagina: 99, primeira: false });
  eq(p99.status, 200, 'pagina alem do fim ainda e 200');
  eq(ids(p99).length, 0, 'e vem sem linha nenhuma');
});

t('quantidade=0 (TODOS) traz o lote inteiro; nao ha teto de pagina', async () => {
  const b = await nav.buscar({ termo: 'contrat%', dataInicio: '01/01/2025', dataFim: '31/12/2025' });
  const n = (q) => nav.grid(b.gridHelper, { quantidade: q }).then((g) => TCEMGCrawler._linhas(g.html).length);
  eq(await n(0), 34, 'TODOS');
  eq(await n(100), 34, '100');
  eq(await n(1000), 34, '1000 — nao ha recusa por tamanho (ao contrario do TCE-BA)');
});

t('consulta por numero: casamento EXATO, sem substring, e sem janela de data', async () => {
  const ck = new TCEMGChecker({ log, nav });
  const r = await ck.consultarProcesso('1188139');
  eq(r.encontrados, 1, 'o processo conhecido');
  eq(r.resultados[0].id, '1188139', 'id');
  eq(r.resultados[0].relator, 'CONS. AGOSTINHO PATRUS', 'relator');
  // O vizinho imediato NAO casa: nao ha prefixo nem substring (o oposto do TCE-BA).
  eq((await ck.consultarProcesso('1188138')).encontrados, 0, 'vizinho de numero');
  eq((await ck.consultarProcesso('999999999')).encontrados, 0, 'controle do valor inventado');
  // Pontuacao de copiar-e-colar e descartada.
  eq((await ck.consultarProcesso('1.188.139')).encontrados, 1, 'com pontuacao');
  // E numero CNJ e recusado com explicacao, em vez de virar zero silencioso.
  const cnj = await ck.consultarProcesso('0710702-55.2018.8.02.0001');
  eq(cnj.valido, false, 'CNJ tem de ser recusado');
  ok(/NAO usa numeracao CNJ/.test(cnj.motivo), 'com a razao dita');
});

t('--verificar confirma a amostra por reconsulta do numero', async () => {
  const r = await crawler().buscar({ ...W, query: 'licitação' });
  const v = await new TCEMGChecker({ log, nav }).verificar(r.resultados, 3);
  eq(v.amostra, 3, 'amostra');
  eq(v.confirmados, 3, 'os tres tem de confirmar');
  ok(v.itens.every((i) => i.conferiuRelator && i.conferiuDataSessao), 'relator e data tem de bater');
});

t('o TEXTO ja vem na busca: ementa em 21/21 e inteiro teor util', async () => {
  const r = await crawler().buscar({ ...W, query: 'licitação' });
  eq(r.resultados.filter((d) => d.semEmenta).length, 0, 'nenhum documento sem ementa');
  ok(r.resultados.every((d) => d.inteiroTeorChars > 3000), 'todo inteiro teor tem texto util');
  ok(r.resultados.every((d) => !/&[A-Za-z]+;/.test(d.ementa)),
    'as entidades HTML tem de estar decodificadas — a base mistura UTF-8 cru e &Ecirc;');
  const d = r.resultados[0];
  ok(d.classificacao && d.classificacao[0]['Área'], 'classificacao vira lista estruturada');
  ok(d.referenciaLegal && d.referenciaLegal[0]['Tipo da norma'], 'referencia legal idem');
});

t('PDF do excerto baixa (e a rota do card, sozinha, e quebrada)', async () => {
  const p = await nav.pdf('1188139');
  ok(p.ok, `PDF tem de vir (veio HTTP ${p.status} ${p.contentType})`);
  ok(p.bytes > 20000, 'PDF com conteudo');
  ok(/Excerto_1188139/.test(p.nomeServidor || ''), 'nome sugerido pelo servidor');
  // O href do card e relativo e, resolvido na tela, da 404. Fica registrado:
  const ruim = await nav._req('GET', '/TextualDadosProcesso/Excerto/ExportPdf/1188139');
  eq(ruim.status, 404, 'a rota do href do card, resolvida como o navegador resolveria, e 404');
});

t('🔴 o permalink e VALIDO, mas conferi-lo por GET cru da falso negativo', async () => {
  const p = await nav.permalinkUtil('1188139');
  eq(p.status, 200, 'abre sem cookie');
  ok(p.bytes > 20000, 'e vem uma pagina inteira');
  // ✅ No navegador (Playwright, contexto limpo) esta mesma URL renderiza 54.707
  // chars COM a ementa — print 03.08. O `false` abaixo e so do HTML cru.
  eq(p.temConteudoNoHtmlCru, false,
    'o GET cru NAO pode trazer a ementa (o conteudo entra por AJAX). Se passar a trazer, ' +
    'o portal mudou e a ressalva do Checker precisa ser reescrita');
});

t('sessao e obrigatoria: sem cookie a rota real vai para LogOff', async () => {
  // Navigator SEM sessao aberta — mas sem chamar abrirSessao(), para nao gastar
  // uma das sessoes que o portal limita (ver o 429).
  const cru = new TCEMGNavigator({ log });
  const semSessao = await cru._req('GET', '/TextualDadosProcesso');
  eq(semSessao.status, 302, 'sem cookie e 302');
  ok(/LogOff/i.test(semSessao.headers.location || ''), 'rota REAL vai para /Login/LogOff');
  // E a rota inventada tambem e 302 — so o Location distingue as duas.
  const inventada = await cru._req('GET', '/rota-que-nao-existe-9z');
  eq(inventada.status, 302, 'rota inexistente tambem e 302');
  ok(/ErrorStatus\/404/i.test(inventada.headers.location || ''),
    'mas vai para ErrorStatus/404 — o status sozinho nao separa');
});

t('combos vem populados por AJAX (chegam vazios no HTML estatico)', async () => {
  const c = await nav.combos();
  ok(Array.isArray(c.relatores) && c.relatores.length >= 50, 'relatores');
  ok(Array.isArray(c.naturezas) && c.naturezas.length >= 200, 'naturezas');
  ok(c.relatores.some((o) => o.Value === '44'), 'o codigo 44 (DURVAL ANGELO) tem de estar la');
});

t('sem -di/-df o crawler FATIA por ano e avisa que o total e soma de fatias', async () => {
  const r = await crawler().buscar({ query: 'licitação', maxPages: 2 });
  eq(r.fatias.length, 2, 'duas fatias de ano');
  eq(r.totalEhSomaDeFatias, true, 'e o campo tem de dizer isso');
  ok(r.avisos.some((a) => /fatia|fatias/i.test(a)), 'com aviso explicito de cobertura parcial');
  eq(r.total, r.fatias.reduce((s, f) => s + (f.total || 0), 0), 'o total e a soma');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of T) {
    try { await fn(); console.log(`✅ ${nome}`); }
    catch (e) { falhas++; console.log(`❌ ${nome}\n   ${e.message}`); }
  }
  console.log(`\n${T.length - falhas}/${T.length} testes passaram`);
  process.exit(falhas ? 1 : 0);
})();
