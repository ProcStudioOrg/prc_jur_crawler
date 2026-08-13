// src/TJPBTestes.js
const TJPBCrawler = require('./TJPBCrawler');
const TJPBChecker = require('./TJPBChecker');
const TJPBNavigator = require('./TJPBNavigator');

/**
 * Suíte de integração do TJPB. Roda contra a API de verdade.
 *   node src/TJPBTestes.js            todos
 *   node src/TJPBTestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e,
 * principalmente, as RESSALVAS — sobretudo **o portão `advanced=true`**, que é
 * o defeito central deste tribunal: um filtro fora do seu modo é ignorado com
 * HTTP 200 e contagem plausível.
 */

const QUERY = 'usucapião';
const PROCESSO_CONHECIDO = '0800610-47.2022.8.15.0461';
const pausa = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); return true; };

teste('busca simples devolve resultados', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 10 });
  const r = await c.search(QUERY, {}, { maxPages: 1 });
  ok(r.length === 10, `esperava 10 resultados, veio ${r.length}`);
  ok(r.totalResults > 5000, `total suspeito: ${r.totalResults}`);
  ok(r.every((x) => x.numeroProcesso), 'resultado sem número de processo');
  return `${r.length} de ${r.totalResults}`;
});

teste('o inteiro teor JÁ VEM na busca, sem request extra', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 5, includeFullText: true });
  const r = await c.search(QUERY, {}, { maxPages: 1, maxResults: 5 });
  ok(r.every((x) => x.inteiroTeor && x.inteiroTeor.length > 500),
    'algum documento veio sem inteiro teor');
  return `menor inteiro teor: ${Math.min(...r.map((x) => x.inteiroTeor.length))} chars`;
});

teste('RESSALVA: só ACÓRDÃO de 2º grau COMUM tem ementa', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 20, includeFullText: true });
  const comuns = await c.search(QUERY, { instancia: 'comum', tipo: 'acordao' }, { maxPages: 1 });
  ok(comuns.length > 0, 'nenhum acórdão de 2º grau comum');
  ok(comuns.every((x) => !x.semEmenta && x.ementa.length > 200),
    'acórdão de 2º grau veio sem ementa — o schema mudou, revise mapDocumento');
  await pausa();
  const sentencas = await c.search(QUERY, { instancia: 'primeiro' }, { maxPages: 1, maxResults: 5 });
  ok(sentencas.length > 0, 'nenhuma sentença de 1º grau');
  ok(sentencas.every((x) => x.semEmenta && x.ementa === ''),
    'sentença de 1º grau veio com ementa — se for verdade, atualize a ressalva');
  ok(sentencas.every((x) => x.inteiroTeor && x.inteiroTeor.length > 500),
    'sentença sem inteiro teor: o texto dela só existe nesse campo');
  return `acórdão comum: ementa ${comuns[0].ementa.length} chars · sentença: semEmenta em ${sentencas.length}/${sentencas.length}`;
});

teste('🔴 PORTÃO: a janela de data só filtra com advanced=true', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const semFiltro = await nav.contar({ searchTerm: QUERY });
  await pausa();
  // O MESMO intervalo, com e sem o portão.
  const simples = await nav.contar({
    searchTerm: QUERY,
    intervaloJulgamentoPrimeiroDia: '2026-01-01',
    intervaloJulgamentoUltimoDia: '2026-08-13',
  });
  await pausa();
  const avancado = await nav.contar({
    searchTerm: QUERY,
    advanced: 'true',
    intervaloJulgamentoPrimeiroDia: '2026-01-01',
    intervaloJulgamentoUltimoDia: '2026-08-13',
  });
  ok(simples === semFiltro,
    `a data passou a filtrar no modo simples (${simples} vs ${semFiltro}) — o portão sumiu, revise o crawler`);
  ok(avancado < semFiltro / 5, `a data não restringiu no modo avançado: ${avancado} de ${semFiltro}`);
  return `sem filtro ${semFiltro} · simples ${simples} (IGNORADA) · avançado ${avancado}`;
});

teste('🔴 PORTÃO ao contrário: `grau` só filtra SEM advanced=true', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const semFiltro = await nav.contar({ searchTerm: QUERY });
  await pausa();
  const g1 = await nav.contar({ searchTerm: QUERY, grau: '1' });
  await pausa();
  const g2 = await nav.contar({ searchTerm: QUERY, grau: '2' });
  await pausa();
  const g1Avancado = await nav.contar({ searchTerm: QUERY, advanced: 'true', grau: '1' });
  ok(g1 + g2 === semFiltro, `a partição por grau deixou de fechar: ${g1} + ${g2} != ${semFiltro}`);
  ok(g1Avancado === semFiltro,
    `grau passou a valer no modo avançado (${g1Avancado} vs ${semFiltro}) — revise o crawler`);
  return `grau1 ${g1} + grau2 ${g2} = ${semFiltro} · no avançado grau é ignorado (${g1Avancado})`;
});

teste('a partição por INSTÂNCIA fecha exata (e só existe no modo avançado)', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const semFiltro = await nav.contar({ searchTerm: QUERY });
  const partes = {};
  for (const [rotulo, valor] of Object.entries(TJPBCrawler.INSTANCIAS)) {
    await pausa();
    partes[rotulo] = await nav.contar({ searchTerm: QUERY, advanced: 'true', instancia: valor });
  }
  const soma = Object.values(partes).reduce((a, b) => a + b, 0);
  ok(soma === semFiltro, `a partição por instância não fecha: ${JSON.stringify(partes)} soma ${soma} != ${semFiltro}`);
  await pausa();
  const ignorado = await nav.contar({ searchTerm: QUERY, instancia: 'TURMAS_RECURSAIS' });
  ok(ignorado === semFiltro,
    `instancia passou a valer no modo simples (${ignorado}) — bom, mas revise o crawler`);
  return `${JSON.stringify(partes)} = ${semFiltro}`;
});

teste('RESSALVA: acento é OBRIGATÓRIO — o índice não normaliza', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const com = await nav.contar({ searchTerm: 'usucapião' });
  await pausa();
  const sem = await nav.contar({ searchTerm: 'usucapiao' });
  ok(sem < com / 10, `o índice passou a normalizar acento (${sem} vs ${com}) — retire o aviso do crawler`);
  return `com acento ${com} · sem acento ${sem}`;
});

teste('operadores: E/OU/NÃO e AND/OR/NOT, com aritmética exata', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const a = await nav.contar({ searchTerm: 'usucapião' });
  await pausa();
  const b = await nav.contar({ searchTerm: 'posse' });
  await pausa();
  const e = await nav.contar({ searchTerm: 'usucapião E posse' });
  await pausa();
  const ou = await nav.contar({ searchTerm: 'usucapião OU posse' });
  await pausa();
  const nao = await nav.contar({ searchTerm: 'usucapião NÃO posse' });
  ok(ou === a + b - e, `a união deixou de fechar: ${ou} != ${a} + ${b} - ${e}`);
  ok(nao === a - e, `a exclusão deixou de fechar: ${nao} != ${a} - ${e}`);
  return `E ${e} · OU ${ou} = ${a}+${b}-${e} · NÃO ${nao} = ${a}-${e}`;
});

teste('meia janela de data é IGNORADA em silêncio (avisar é obrigatório)', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const semFiltro = await nav.contar({ searchTerm: QUERY });
  await pausa();
  const soInicio = await nav.contar({
    searchTerm: QUERY, advanced: 'true', intervaloJulgamentoPrimeiroDia: '2026-01-01',
  });
  ok(soInicio === semFiltro,
    `a meia janela passou a filtrar (${soInicio} vs ${semFiltro}) — ótimo, atualize a ressalva`);
  return `só a ponta inicial devolve ${soInicio} = o acervo inteiro`;
});

teste('paginação anda e é ESTÁVEL entre execuções', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 10 });
  const r1 = await c.search(QUERY, {}, { maxPages: 3 });
  await pausa();
  const r2 = await c.search(QUERY, {}, { maxPages: 3 });
  ok(r1.length === 30, `esperava 30 documentos em 3 páginas, veio ${r1.length}`);
  ok(new Set(r1.map((x) => x.id)).size === 30, 'houve id repetido entre páginas');
  ok(JSON.stringify(r1.map((x) => x.id)) === JSON.stringify(r2.map((x) => x.id)),
    'a paginação ficou INSTÁVEL entre execuções — passe a deduplicar e avisar');
  return '3 páginas, 30 ids distintos, idênticas em 2 execuções';
});

teste('size máximo é 50 e o excesso dá HTTP 400 honesto', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const r = await nav.buscar({ searchTerm: QUERY }, 0, TJPBNavigator.SIZE_MAX);
  ok(r.content.length === 50, `size=50 devolveu ${r.content.length} itens`);
  let erro = null;
  try { await nav.buscar({ searchTerm: QUERY }, 0, 51); } catch (e) { erro = e; }
  ok(erro, 'size=51 não foi barrado');
  return `50 itens; acima disso o Navigator barra antes de gastar request`;
});

teste('offset acima de 10.000 é barrado (teto do Elasticsearch)', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  let erro = null;
  try { await nav.buscar({ searchTerm: QUERY }, 1000, 10); } catch (e) { erro = e; }
  ok(erro && /offset/.test(erro.message), 'o teto de offset não foi barrado pelo Navigator');
  const r = await nav.buscar({ searchTerm: QUERY }, 500, 10);
  ok(r.content.length === 10, 'offset 5.000 deveria responder normalmente');
  return 'offset 5.000 responde; 10.000 é barrado antes do HTTP 404';
});

teste('consulta por número acha um processo conhecido (nas duas formas)', async () => {
  const ck = new TJPBChecker({ log: () => {} });
  const comMascara = await ck.consultarProcesso(PROCESSO_CONHECIDO);
  ok(comMascara.encontrado, `não achou ${PROCESSO_CONHECIDO}`);
  ok(comMascara.valido && comMascara.doTribunal, 'o número conhecido não validou como do TJPB');
  await pausa();
  const semMascara = await ck.consultarProcesso(PROCESSO_CONHECIDO.replace(/\D/g, ''));
  ok(semMascara.encontrado, 'não achou o mesmo processo sem máscara');
  return `${comMascara.total} documento(s), as duas formas`;
});

teste('🔴 sem advanced=true o numeroProcesso devolve A BASE INTEIRA', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const total = await nav.contar({});
  await pausa();
  const ingenuo = await nav.contar({ numeroProcesso: '99999999999999999999' });
  await pausa();
  const correto = await nav.contar({ advanced: 'true', numeroProcesso: '99999999999999999999' });
  ok(ingenuo === total,
    `o portão do numeroProcesso mudou (${ingenuo} vs ${total}) — revise o Checker`);
  ok(correto === 0, `número inventado devolveu ${correto} no modo avançado`);
  return `sem portão: ${ingenuo} (= base inteira) · com portão: ${correto}`;
});

teste('--verificar confirma a amostra e casa o id do documento', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 5 });
  const r = await c.search(QUERY, {}, { maxPages: 1, maxResults: 3 });
  const v = await new TJPBChecker({ log: () => {} }).verificarResultados(r, { amostra: 3 });
  ok(v.confirmados === 3, `${v.confirmados}/3 confirmados`);
  ok(v.detalhes.every((d) => d.documentoIdConfirmado), 'algum id de documento não reapareceu na reconsulta');
  return '3/3 confirmados, id conferindo';
});

teste('os combos são AUTOCOMPLETE: exigem termo e devolvem {id, nome}', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  let erro = null;
  try { await nav.opcoes('comarcas'); } catch (e) { erro = e; }
  ok(erro, 'o combo sem termo deveria ser barrado');
  const comarcas = await nav.opcoes('comarcas', 'joao');
  ok(Array.isArray(comarcas) && comarcas.length > 0, 'autocomplete de comarca veio vazio');
  ok(comarcas[0].id !== undefined && comarcas[0].nome, 'o formato do combo mudou');
  // ⚠️ O mesmo NOME tem vários ids — e cada um filtra uma contagem diferente.
  const joaoPessoa = comarcas.filter((x) => /jo[ãa]o pessoa/i.test(x.nome));
  ok(joaoPessoa.length > 1, 'os ids duplicados de João Pessoa sumiram — reveja a ressalva');
  return `${comarcas.length} comarcas para "joao", ${joaoPessoa.length} delas "João Pessoa"`;
});

teste('os filtros por id filtram DE FATO (e só no modo avançado)', async () => {
  const nav = new TJPBNavigator({ log: () => {} });
  const semFiltro = await nav.contar({ searchTerm: QUERY });
  await pausa();
  const ignorado = await nav.contar({ searchTerm: QUERY, codigoComarca: '200' });
  await pausa();
  const a = await nav.contar({ searchTerm: QUERY, advanced: 'true', codigoComarca: '200' });
  await pausa();
  const b = await nav.contar({ searchTerm: QUERY, advanced: 'true', codigoComarca: '0' });
  await pausa();
  // ✅ Parâmetro repetido é OR e a soma fecha exata.
  const ab = await nav.contar({ searchTerm: QUERY, advanced: 'true', codigoComarca: ['200', '0'] });
  ok(ignorado === semFiltro, `codigoComarca passou a valer no modo simples (${ignorado})`);
  ok(a > 0 && a < semFiltro, `codigoComarca não restringiu: ${a} de ${semFiltro}`);
  ok(ab === a + b, `o multi-valor deixou de fechar: ${ab} != ${a} + ${b}`);
  await pausa();
  const inventado = await nav.contar({ searchTerm: QUERY, advanced: 'true', codigoComarca: '999999' });
  ok(inventado === 0, `comarca inventada devolveu ${inventado} — deveria ser 0`);
  return `${a} + ${b} = ${ab} · inventada = 0 · no modo simples é ignorado (${ignorado})`;
});

teste('a base está CORRENTE (o passo que o TJAM impôs)', async () => {
  const c = new TJPBCrawler({ log: () => {}, pageSize: 5 });
  const r = await c.search('', {}, { maxPages: 1, maxResults: 5 });
  const maisRecente = r.map((x) => x.dataJulgamento).sort().pop();
  const dias = (Date.now() - Date.parse(maisRecente)) / 86400000;
  ok(dias < 30, `o documento mais recente tem ${Math.round(dias)} dias — a base pode ter congelado`);
  // ⚠️ Não há data de publicação nesta base: campo declarado null, não omitido.
  ok(r.every((x) => x.dataPublicacao === null), 'apareceu data de publicação — atualize a ressalva');
  return `mais recente: ${maisRecente} (${Math.round(dias)} dia(s))`;
});

(async () => {
  const so = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < testes.length; i++) {
    if (so !== null && so !== i + 1) continue;
    const t = testes[i];
    process.stdout.write(`${String(i + 1).padStart(2)}. ${t.nome}\n`);
    try {
      const detalhe = await t.fn();
      console.log(`    OK — ${detalhe}`);
      pass++;
    } catch (err) {
      console.log(`    FALHOU — ${err.message}`);
      fail++;
    }
    await pausa(1200);
  }
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
