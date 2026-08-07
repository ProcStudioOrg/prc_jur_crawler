// src/TJPETestes.js
const TJPECrawler = require('./TJPECrawler');
const TJPEChecker = require('./TJPEChecker');
const TJPENavigator = require('./TJPENavigator');

/**
 * Suíte de integração do TJPE. Roda contra o site de verdade.
 *   node src/TJPETestes.js            todos
 *   node src/TJPETestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e,
 * principalmente, as RESSALVAS: o que quebra em silêncio se o site mudar.
 */

const QUERY = 'usucapiao';
const PROCESSO_CONHECIDO = '0056907-55.2023.8.17.2001';
const pausa = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); return true; };

teste('busca simples devolve resultados com ementa e inteiro teor', async () => {
  const c = new TJPECrawler({ log: () => {}, includeFullText: true });
  const r = await c.search(QUERY, {}, { maxPages: 1 });
  ok(r.length > 0, 'busca não devolveu resultados');
  ok(r.totalResults > 1000, `total suspeito: ${r.totalResults}`);
  ok(r[0].ementa.length > 200, `ementa curta demais: ${r[0].ementa.length} chars`);
  ok(r[0].numeroProcesso && r[0].chave, 'resultado sem processo/chave');
  return `${r.length} de ${r.totalResults}; ementa ${r[0].ementa.length} chars`;
});

teste('o inteiro teor JÁ VEM na busca e é MAIOR que a ementa', async () => {
  const c = new TJPECrawler({ log: () => {}, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1, maxResults: 5 });
  ok(r.every((x) => x.inteiroTeor && x.inteiroTeor.length > 1000), 'algum acórdão veio sem inteiro teor');
  ok(r[0].inteiroTeor.length > r[0].ementa.length,
    `inteiro teor (${r[0].inteiroTeor.length}) não é maior que a ementa (${r[0].ementa.length})`);
  return `inteiro teor ${r[0].inteiroTeor.length} vs ementa ${r[0].ementa.length} chars`;
});

teste('RESSALVA: o HTML do Word é limpo e o acento sobrevive', async () => {
  const c = new TJPECrawler({ log: () => {}, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1, maxResults: 3 });
  const txt = r.map((x) => x.inteiroTeor).join('\n');
  ok(!/<[a-z][^>]*>/i.test(txt), 'sobrou tag HTML no texto');
  ok(!/&[a-zA-Z]+;/.test(txt), 'sobrou entidade HTML não decodificada');
  ok(/[áàâãéêíóôõúüç]/i.test(txt), 'nenhum acento no texto — o decodificador de entidade quebrou');
  ok(!/Normal 0 \d+ false/.test(txt), 'sobrou o cabeçalho de export do MS Word');
  return `${txt.length} chars limpos, com acento e sem tag`;
});

teste('RESSALVA: tipoSentenca usa a LETRA (A/D); o rótulo da tela zera', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const base = { 'origem.in': 'ELETRONICO,FISICO', 'pesquisaLivre.contains': QUERY };
  const comLetra = await nav.contar({ ...base, 'tipoSentenca.in': 'A,D' });
  const comRotulo = await nav.contar({ ...base, 'tipoSentenca.in': 'ACORDAO,DECISAO' });
  ok(comLetra.total > 0, 'a busca com A,D devolveu 0 — a API mudou');
  ok(comRotulo.total === 0,
    `ACORDAO,DECISAO devolveu ${comRotulo.total}: a API passou a aceitar o rótulo, revise a ressalva`);
  return `A,D=${comLetra.total} x ACORDAO,DECISAO=${comRotulo.total} (zero silencioso confirmado)`;
});

teste('RESSALVA: sem tipoSentenca.in a busca por termo devolve HTTP 500', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  let status = null;
  try {
    await nav.contar({ 'origem.in': 'ELETRONICO,FISICO', 'pesquisaLivre.contains': QUERY });
  } catch (e) { status = e.status; }
  ok(status === 500, `esperado HTTP 500 sem tipoSentenca.in, veio: ${status}`);
  return 'HTTP 500 confirmado — o filtro é obrigatório, o Crawler sempre o manda';
});

teste('RESSALVA: operadores em PORTUGUÊS funcionam; os ingleses enganam', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const base = { 'origem.in': 'ELETRONICO,FISICO', 'tipoSentenca.in': 'A,D' };
  const q = async (t) => (await nav.contar({ ...base, 'pesquisaLivre.contains': t })).total;
  const [e, and, nao, not] = [
    await q('usucapiao E posse'), await q('usucapiao AND posse'),
    await q('usucapiao NAO posse'), await q('usucapiao NOT posse'),
  ];
  ok(e > 100, `"E" deveria funcionar, deu ${e}`);
  ok(and === 0, `"AND" deveria ZERAR (é palavra literal), deu ${and}`);
  ok(nao > not, `"NAO"(${nao}) deveria diferir de "NOT"(${not})`);
  return `E=${e} AND=${and} | NAO=${nao} NOT=${not}`;
});

teste('espaço entre termos é E (AND), não OU', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const base = { 'origem.in': 'ELETRONICO,FISICO', 'tipoSentenca.in': 'A,D' };
  const q = async (t) => (await nav.contar({ ...base, 'pesquisaLivre.contains': t })).total;
  const [espaco, comE, um] = [await q('usucapiao posse'), await q('usucapiao E posse'), await q('usucapiao')];
  ok(espaco === comE, `espaço(${espaco}) deveria ser igual a E(${comE})`);
  ok(espaco < um, `espaço(${espaco}) deveria ser MENOR que o termo sozinho(${um}) — se for maior, virou OU`);
  return `"a b"=${espaco} = "a E b"=${comE} < "a"=${um}`;
});

teste('acento é normalizado (NÃO avisar sobre acento neste tribunal)', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const base = { 'origem.in': 'ELETRONICO,FISICO', 'tipoSentenca.in': 'A,D' };
  const sem = (await nav.contar({ ...base, 'pesquisaLivre.contains': 'usucapiao' })).total;
  const com = (await nav.contar({ ...base, 'pesquisaLivre.contains': 'usucapião' })).total;
  ok(sem === com, `acento passou a importar: sem=${sem} com=${com} — revise CLAUDE-TJPE.md`);
  return `usucapiao=${sem} = usucapião=${com}`;
});

teste('filtro de data restringe de fato', async () => {
  const c = new TJPECrawler({ log: () => {} });
  const todos = await c.search(QUERY, {}, { maxPages: 1 });
  const um = await c.search(QUERY, { dataInicio: '01/01/2025', dataFim: '31/12/2025' }, { maxPages: 1 });
  ok(um.totalResults < todos.totalResults,
    `data não restringiu: ${um.totalResults} vs ${todos.totalResults} (filtro ignorado)`);
  return `sem data=${todos.totalResults} x 2025=${um.totalResults}`;
});

teste('meio de tramitação particiona o acervo exatamente', async () => {
  const c = new TJPECrawler({ log: () => {} });
  const [amb, ele, fis] = await Promise.all([
    c.search(QUERY, { meio: 'ambos' }, { maxPages: 1 }),
    c.search(QUERY, { meio: 'eletronico' }, { maxPages: 1 }),
    c.search(QUERY, { meio: 'fisico' }, { maxPages: 1 }),
  ]);
  ok(ele.totalResults + fis.totalResults === amb.totalResults,
    `partição quebrou: ${ele.totalResults}+${fis.totalResults} != ${amb.totalResults}`);
  return `${ele.totalResults} + ${fis.totalResults} = ${amb.totalResults}`;
});

teste('RESSALVA: o crawler sobrevive ao documento ilegível (HTTP 500)', async () => {
  const c = new TJPECrawler({ log: () => {} });
  const r = await c.search(QUERY, {}, { maxPages: 3 });
  ok(r.length > 250, `paginação parou cedo demais: ${r.length} de 3 páginas de 100`);
  return `${r.length} coletados; ${c.ultimaBusca.documentosIlegiveis} documento(s) ilegível(is) pulado(s)`;
});

teste('paginação é ESTÁVEL entre requisições', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const f = { 'origem.in': 'ELETRONICO,FISICO', 'tipoSentenca.in': 'A,D', 'pesquisaLivre.contains': QUERY, sort: 'dataJulgamento,desc' };
  const a = (await nav.buscar(f, 0, 20)).itens.map((x) => x.chave).join(',');
  const b = (await nav.buscar(f, 0, 20)).itens.map((x) => x.chave).join(',');
  ok(a === b, 'a mesma página devolveu documentos diferentes entre requisições');
  return 'mesma página 2x = idêntica';
});

teste('total saturado no teto de 10.000 é sinalizado', async () => {
  const c = new TJPECrawler({ log: () => {} });
  await c.search('recurso', {}, { maxPages: 1, maxResults: 1 });
  ok(c.ultimaBusca.saturado === true, 'termo amplo não foi marcado como saturado');
  ok(c.ultimaBusca.avisos.some((a) => /SATURADO/.test(a)), 'faltou o aviso de saturação');
  return `total=${c.ultimaBusca.totalTJPE} marcado como saturado`;
});

teste('consulta por número encontra processo conhecido', async () => {
  const r = await new TJPEChecker().consultarProcesso(PROCESSO_CONHECIDO);
  ok(r.valido, 'CNJ considerado inválido');
  ok(r.doTribunal, 'não reconhecido como TJPE');
  ok(r.encontrado, `processo conhecido não encontrado: ${PROCESSO_CONHECIDO}`);
  return `${r.total} documento(s); ementa ${r.documentos[0].tamanhoEmenta} chars`;
});

teste('RESSALVA: número COM máscara zera a consulta em silêncio', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const base = { 'origem.in': 'ELETRONICO,FISICO', 'tipoSentenca.in': 'A,D' };
  const semMascara = (await nav.contar({ ...base, 'npuSemFormatacao.equals': PROCESSO_CONHECIDO.replace(/\D/g, '') })).total;
  const comMascara = (await nav.contar({ ...base, 'npuSemFormatacao.equals': PROCESSO_CONHECIDO })).total;
  ok(semMascara > 0, 'o número sem máscara parou de achar — a API mudou');
  ok(comMascara === 0, `com máscara achou ${comMascara}: revise a ressalva do Checker`);
  return `sem máscara=${semMascara} x com máscara=${comMascara}`;
});

teste('--verificar confirma a amostra', async () => {
  const c = new TJPECrawler({ log: () => {} });
  const r = await c.search(QUERY, {}, { maxPages: 1, maxResults: 5 });
  const v = await new TJPEChecker().verificarResultados(r, { amostra: 5 });
  ok(v.confirmados === v.verificados, `só ${v.confirmados}/${v.verificados} confirmados`);
  return `${v.confirmados}/${v.verificados} confirmados`;
});

teste('a base do TJPE está CORRENTE (não congelou)', async () => {
  const c = new TJPECrawler({ log: () => {} });
  const r = await c.search('', { tipo: 'todos' }, { maxPages: 1, maxResults: 1 });
  ok(r.length > 0, 'busca sem termo não devolveu nada');
  const [d, m, a] = r[0].dataJulgamento.split('/').map(Number);
  const maisRecente = new Date(a, m - 1, d);
  const diasAtras = (Date.now() - maisRecente.getTime()) / 86400000;
  ok(diasAtras < 60, `documento mais recente tem ${Math.round(diasAtras)} dias — a base pode ter congelado`);
  return `mais recente: ${r[0].dataJulgamento} (${Math.round(diasAtras)} dias atrás)`;
});

teste('combos de filtro respondem', async () => {
  const nav = new TJPENavigator({ log: () => {} });
  const [rel, cls, uni] = await Promise.all([nav.relatores(), nav.classes(), nav.unidadesJudiciais()]);
  ok(rel.length > 100, `poucos relatores: ${rel.length}`);
  ok(cls.length > 100, `poucas classes: ${cls.length}`);
  ok(uni.length > 100, `poucas unidades: ${uni.length}`);
  return `${rel.length} relatores, ${cls.length} classes, ${uni.length} unidades`;
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
    await pausa(1500);
  }
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
