// src/TJROTestes.js
const TJROCrawler = require('./TJROCrawler');
const TJROChecker = require('./TJROChecker');
const { TJRONavigator, TURMAS_RECURSAIS } = require('./TJRONavigator');

/**
 * Suíte de integração do TJRO. Roda contra a API de verdade.
 *   node src/TJROTestes.js            todos
 *   node src/TJROTestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e,
 * principalmente, as RESSALVAS. As três centrais deste tribunal:
 *   1. o espaço entre termos é OR, e `NÃO` acentuado infla 24×;
 *   2. `grau_jurisdicao: "2"` EXCLUI as Turmas Recursais que promete incluir;
 *   3. o mesmo documento é indexado várias vezes sob `_id` diferentes.
 *
 * ⚠️ A pausa entre testes NÃO é cortesia: o backend do TJRO bloqueia por IP depois
 * de ~35 requisições sem throttle, e o bloqueio dura ~12 minutos chegando ao código
 * como erro de rede genérico. O Navigator já espaça 1,2 s; aqui espaçamos de novo.
 */

const QUERY = 'usucapião';
const PROCESSO_CONHECIDO = '7009829-15.2024.8.22.0014';
const pausa = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); return true; };

teste('busca simples devolve resultados', async () => {
  const c = new TJROCrawler({ log: () => {}, pageSize: 10 });
  const r = await c.search(QUERY, { tipo: 'ementa' }, { maxPages: 1 });
  ok(r.length >= 9, `esperava ~10 resultados, veio ${r.length}`);
  ok(r.totalResults > 300, `total suspeito: ${r.totalResults}`);
  ok(r.every((x) => x.processo), 'resultado sem número de processo');
  ok(r.every((x) => x.dataJulgamento), 'resultado sem data de julgamento');
  return `${r.length} de ${r.totalResults}`;
});

teste('o texto do documento JÁ VEM na busca, sem request extra', async () => {
  const c = new TJROCrawler({ log: () => {}, pageSize: 5, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'ementa' }, { maxPages: 1, maxResults: 5 });
  ok(r.every((x) => x.inteiroTeor && x.inteiroTeor.length > 500),
    'algum documento veio sem texto');
  return `menor texto: ${Math.min(...r.map((x) => x.inteiroTeor.length))} chars`;
});

teste('🔴 o acento vem em ENTIDADE HTML e é integralmente recuperável', async () => {
  // ⚠️ Este teste existe porque o mapeamento de 09/08 registrou o oposto ("o corpo
  // já perdeu o acento na origem, não há como recuperar"). Era artefato de um strip
  // ingênuo: o HTML cru não tem um único byte não-ASCII, só entidades.
  const c = new TJROCrawler({ log: () => {}, pageSize: 5, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'ementa' }, { maxPages: 1, maxResults: 5 });
  const texto = r.map((x) => x.inteiroTeor).join('\n');
  ok(!/&[a-zA-Z]+;/.test(texto), 'sobrou entidade HTML não decodificada no texto');
  ok(/[áàâãéêíóôõúüç]/.test(texto), 'nenhum acento minúsculo no texto — a decodificação quebrou');
  ok(/[ÁÂÃÉÍÓÔÕÚÇ]/.test(texto), 'nenhum acento MAIÚSCULO — o mapa de entidades voltou a ser case-insensitive');
  ok(!/AçãO|USUCAPIãO/.test(texto), 'caixa trocada no cabeçalho: `&Ccedil;` foi tratado como `&ccedil;`');
  return 'entidades decodificadas, maiúsculas e minúsculas preservadas';
});

teste('🔴 o ESPAÇO entre termos é OR (aritmética exata)', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const base = { tipos: ['EMENTA'] };
  const a = (await nav.contar({ ...base, query: 'usucapião' })).total;
  const b = (await nav.contar({ ...base, query: 'posse' })).total;
  const uniao = (await nav.contar({ ...base, query: 'usucapião posse' })).total;
  const inter = (await nav.contar({ ...base, todas: 'usucapião posse' })).total;
  ok(uniao === a + b - inter, `o espaço deixou de ser OR: ${uniao} != ${a} + ${b} - ${inter}`);
  ok(uniao > a && uniao > b, 'a união ficou menor que uma das partes');
  return `${a} + ${b} - ${inter} = ${uniao} ✓`;
});

teste('os 4 campos da pesquisa avançada filtram de verdade', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const base = { tipos: ['EMENTA'] };
  const so = (await nav.contar({ ...base, query: 'usucapião' })).total;
  const todas = (await nav.contar({ ...base, todas: 'usucapião posse' })).total;
  const sem = (await nav.contar({ ...base, query: 'usucapião', sem: 'posse' })).total;
  const frase = (await nav.contar({ ...base, frase: 'usucapião extraordinária' })).total;
  ok(todas < so, `todas_palavras não restringiu: ${todas} >= ${so}`);
  ok(sem === so - todas, `sem_palavras deixou de ser subtração exata: ${sem} != ${so} - ${todas}`);
  ok(frase > 0 && frase < so, `trecho_exato fora da faixa: ${frase}`);
  return `todas=${todas} · sem=${sem} (= ${so}-${todas}) · frase=${frase}`;
});

teste('🔴 chave desconhecida em `fields` ZERA a busca em silêncio', async () => {
  // Controle da armadilha que justifica `_fields` ser a única porta de entrada.
  const nav = new TJRONavigator({ log: () => {} });
  const bom = (await nav.contar({ query: QUERY, tipos: ['EMENTA'] })).total;
  const json = await nav.buscar({ query: QUERY, tipos: ['EMENTA'], size: 0 });
  ok(bom > 0, 'a busca de controle já veio zerada');
  // injeta uma chave inventada direto no payload, sem passar por _fields
  const cru = await nav._post('/search/varios_parametros/', {
    from: 0, size: 0, sort: [{ _score: 'desc' }],
    fields: { ...TJRONavigator._fields({ query: QUERY, tipos: ['EMENTA'] }), xx_inventado_9z: 'posse' },
  });
  ok(cru.hits.total.value === 0,
    `chave inventada devolveu ${cru.hits.total.value} — se parou de zerar, atualize a ressalva`);
  ok(json.hits.total.value === bom, 'a busca de controle mudou entre chamadas');
  return `${bom} com o payload certo, 0 com chave inventada`;
});

teste('🔴 grau "2" EXCLUI as Turmas Recursais; a partição correta é por colegiado', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const base = { todas: 'dano moral', tipos: ['EMENTA'] };
  const ambas = (await nav.contar(base)).total;
  const comum = (await nav.contar({ ...base, grau: '2' })).total;
  const turmas = (await nav.contar({ ...base, colegiados: TURMAS_RECURSAIS })).total;
  ok(turmas > 0, 'nenhum documento de Turma Recursal — a lista de colegiados mudou de nome');
  ok(comum + turmas === ambas,
    `a partição deixou de fechar: ${comum} + ${turmas} = ${comum + turmas}, esperado ${ambas}`);
  ok(comum < ambas, `grau "2" devolveu tudo (${comum}) — o filtro passou a incluir as TRs`);
  return `comum ${comum} + turmas ${turmas} = ${ambas} ✓ (Juizado = ${(100 * turmas / ambas).toFixed(1)}%)`;
});

teste('🔴 o mesmo documento é indexado várias vezes (dedup)', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const j = await nav.buscar({ query: QUERY, tipos: ['EMENTA'], size: 100 });
  const hits = j.hits.hits;
  const ids = new Set(hits.map((h) => h._id));
  const chaves = new Set(hits.map((h) => TJROCrawler._chaveDedup(h._source)));
  ok(ids.size === hits.length, 'o `_id` deixou de ser único — o dedup precisa de outra chave');
  ok(chaves.size <= ids.size, 'o dedup produziu mais chaves que ids, o que é impossível');
  return `${ids.size} _id distintos para ${chaves.size} documentos reais (${ids.size - chaves.size} cópias)`;
});

teste('a janela de data restringe, e a meia janela também funciona', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const base = { query: QUERY, tipos: ['EMENTA'] };
  const sem = (await nav.contar(base)).total;
  const ano = (await nav.contar({ ...base, dataInicio: '2024-01-01', dataFim: '2024-12-31' })).total;
  const soInicio = (await nav.contar({ ...base, dataInicio: '2024-01-01' })).total;
  const soFim = (await nav.contar({ ...base, dataFim: '2024-12-31' })).total;
  ok(ano > 0 && ano < sem, `a janela não restringiu: ${ano} de ${sem}`);
  // ✅ Aqui a meia janela NÃO é ignorada em silêncio (defeito do TJPI/TJRR).
  ok(soInicio < sem, `só a data inicial devolveu o acervo inteiro (${soInicio}) — virou o defeito do TJPI`);
  ok(soFim < sem, `só a data final devolveu o acervo inteiro (${soFim}) — virou o defeito do TJRR`);
  ok(soInicio + soFim - ano === sem,
    `a aritmética das pontas deixou de fechar: ${soInicio} + ${soFim} - ${ano} != ${sem}`);
  return `sem=${sem} · 2024=${ano} · só início=${soInicio} · só fim=${soFim} ✓`;
});

teste('⚠️ data em DD/MM/YYYY dá erro HONESTO, não número errado', async () => {
  // O oposto do TJMT, que parseia MM/DD em silêncio e devolve o mês trocado.
  const nav = new TJRONavigator({ log: () => {} });
  let erro = null;
  try {
    await nav.contar({ query: QUERY, tipos: ['EMENTA'], dataInicio: '01/01/2024', dataFim: '31/12/2024' });
  } catch (e) { erro = e; }
  ok(erro, 'DD/MM/YYYY passou sem erro — se virou silencioso, isto é um zero/número falso');
  ok(/HTTP 5\d\d/.test(erro.message), `esperava HTTP 5xx, veio: ${erro.message.slice(0, 80)}`);
  // E o crawler recusa antes de chegar na rede.
  let erroCrawler = null;
  try { TJROCrawler.paraDataApi('31/12/2024x'); } catch (e) { erroCrawler = e; }
  ok(erroCrawler, 'o crawler aceitou data malformada');
  return 'API: HTTP 500 · crawler: recusa antes da rede';
});

teste('paginação anda e é ESTÁVEL (mesma página duas vezes)', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const base = { query: QUERY, tipos: ['EMENTA'] };
  const p1 = await nav.buscar({ ...base, from: 0, size: 10 });
  const p2 = await nav.buscar({ ...base, from: 20, size: 10 });
  const p2bis = await nav.buscar({ ...base, from: 20, size: 10 });
  const ids1 = p1.hits.hits.map((h) => h._id);
  const ids2 = p2.hits.hits.map((h) => h._id);
  const ids2bis = p2bis.hits.hits.map((h) => h._id);
  ok(ids2.length === 10, `a página 3 veio com ${ids2.length} itens`);
  ok(ids1.every((i) => !ids2.includes(i)), 'a página 1 e a página 3 se sobrepõem');
  ok(JSON.stringify(ids2) === JSON.stringify(ids2bis),
    'a mesma página devolveu ordens diferentes — a paginação ficou instável');
  return `páginas distintas e a repetição bateu 10/10`;
});

teste('consulta por número: 20 dígitos acha, MÁSCARA zera na API', async () => {
  const nav = new TJRONavigator({ log: () => {} });
  const digitos = PROCESSO_CONHECIDO.replace(/\D/g, '');
  const comDigitos = (await nav.contar({ nrProcesso: digitos })).total;
  const comMascara = (await nav.contar({ nrProcesso: PROCESSO_CONHECIDO })).total;
  ok(comDigitos > 0, `o processo conhecido sumiu da base (${comDigitos})`);
  // 🔴 E a TELA pede exatamente esta forma que a API rejeita.
  ok(comMascara === 0, `a máscara passou a funcionar (${comMascara}) — atualize a ressalva`);
  // ✅ O Checker normaliza, então aceita as duas formas do usuário.
  const chk = new TJROChecker({ log: () => {} });
  const r = await chk.consultarProcesso(PROCESSO_CONHECIDO);
  ok(r.encontrado, 'o Checker não achou o processo mesmo normalizando o número');
  ok(r.documentos.length > 1, `esperava vários documentos do mesmo processo, veio ${r.documentos.length}`);
  return `${comDigitos} com 20 dígitos · 0 com máscara · Checker: ${r.total} doc (${r.tipos.join(', ')})`;
});

teste('número inventado não é confirmado', async () => {
  const chk = new TJROChecker({ log: () => {} });
  const r = await chk.consultarProcesso('9999999-99.9999.8.22.9999');
  ok(!r.encontrado, 'um número inventado foi confirmado — o Checker não serve');
  ok(r.valido === false, 'o DV de um número inventado passou na validação');
  return 'não encontrado, como esperado';
});

teste('a base está CORRENTE (o passo que o TJAM impôs)', async () => {
  const c = new TJROCrawler({ log: () => {}, pageSize: 20 });
  // Ordena por julgamento decrescente para achar a ponta da base.
  const nav = c.navigator;
  const j = await nav.buscar({ tipos: [], size: 20, sort: [{ dtjulgamento: 'desc' }] });
  const datas = j.hits.hits
    .map((h) => h._source.dtjulgamento_str)
    .filter(Boolean)
    .map((d) => { const [dd, mm, aa] = d.split('/'); return `${aa}-${mm}-${dd}`; })
    .sort();
  const maisRecente = datas[datas.length - 1];
  const dias = (Date.now() - Date.parse(maisRecente)) / 86400000;
  ok(dias < 45, `o documento mais recente tem ${Math.round(dias)} dias — a base pode ter congelado`);
  // ⚠️ Não há data de publicação nesta base: campo declarado null, não omitido.
  const r = await c.search(QUERY, { tipo: 'ementa' }, { maxPages: 1, maxResults: 5 });
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
    await pausa(1500);
  }
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
