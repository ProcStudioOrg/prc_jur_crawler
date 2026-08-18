// src/TCEPETestes.js — integracao TCE-PE. Rode: node src/TCEPETestes.js
const TCEPECrawler = require('./TCEPECrawler');
const TCEPEChecker = require('./TCEPEChecker');

const log = () => {};
const T = [];
const t = (nome, fn) => T.push([nome, fn]);
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const crawler = () => new TCEPECrawler({ log });
const total = async (o) => (await crawler().buscar({ size: 1, maxPages: 1, ...o })).total;

t('busca simples devolve total exato e resultados', async () => {
  const r = await crawler().buscar({ query: 'nepotismo', size: 3, maxPages: 1 });
  ok(r.total > 0, 'total deve ser > 0');
  eq(r.retornados, 3, 'retornados');
  eq(r.totalExato, true, 'totalExato');
  ok(r.resultados[0].titulo && r.resultados[0].url, 'documento precisa de titulo e permalink');
});

t('os tres tipos de documento PARTICIONAM EXATO', async () => {
  const base = await total({ query: 'nepotismo' });
  const ac = await total({ query: 'nepotismo', decisao: false, parecerPrevio: false });
  const de = await total({ query: 'nepotismo', acordao: false, parecerPrevio: false });
  const pp = await total({ query: 'nepotismo', acordao: false, decisao: false });
  eq(ac + de + pp, base, `acordao(${ac})+decisao(${de})+parecerPrevio(${pp}) deve fechar ${base}`);
});

t('o default da TELA omite os pareceres previos (subcontagem silenciosa)', async () => {
  const comPP = await total({ query: 'nepotismo' });
  const semPP = await total({ query: 'nepotismo', parecerPrevio: false });
  ok(semPP < comPP, `o default da tela (${semPP}) tem de ser MENOR que o completo (${comPP})`);
});

t('orgao julgador PARTICIONA e valor inventado zera', async () => {
  const base = await total({ query: 'nepotismo', parecerPrevio: false });
  const p = await total({ query: 'nepotismo', parecerPrevio: false, orgaoJulgador: 'Pleno' });
  const c1 = await total({ query: 'nepotismo', parecerPrevio: false, orgaoJulgador: '1a. Câmara' });
  const c2 = await total({ query: 'nepotismo', parecerPrevio: false, orgaoJulgador: '2a. Câmara' });
  eq(p + c1 + c2, base, `Pleno(${p})+1a(${c1})+2a(${c2}) deve fechar ${base}`);
  eq(await total({ query: 'nepotismo', orgaoJulgador: 'ZZINVENTADO' }), 0, 'orgao inventado');
});

t('🔴 as variantes com ª do combo de orgao sao MORTAS', async () => {
  eq(await total({ query: 'nepotismo', orgaoJulgador: '1ª Câmara' }), 0, '1ª Câmara (ª)');
  eq(await total({ query: 'nepotismo', orgaoJulgador: 'Tribunal Pleno' }), 0, 'Tribunal Pleno');
  ok((await total({ query: 'nepotismo', orgaoJulgador: '1a. Câmara' })) > 0, '1a. Câmara tem acervo');
});

t('filtro de data restringe de fato', async () => {
  const base = await total({ query: 'nepotismo' });
  const rec = await total({ query: 'nepotismo', dataInicio: '01/01/2026', dataFim: '31/12/2026' });
  ok(rec > 0 && rec < base, `recorte (${rec}) tem de ser > 0 e < ${base}`);
});

t('🔴 o espaco e "E" implicito e NAO ha operador booleano', async () => {
  const nep = await total({ query: 'nepotismo' });
  eq(await total({ query: 'nepotismo ZZQQINVENTADO' }), 0, 'espaco tem de ser AND');
  eq(await total({ query: 'nepotismo E' }), nep, '"E" e palavra comum, nao operador');
  const and = await total({ query: 'nepotismo licitação' });
  const ou = await total({ query: 'nepotismo OU licitação' });
  ok(ou <= and, `"OU" (${ou}) NAO pode ampliar o AND (${and}) — nao e operador de uniao`);
});

t('🔴 o acento NAO e normalizado', async () => {
  const com = await total({ query: 'licitação' });
  const sem = await total({ query: 'licitacao' });
  ok(sem > 0 && sem < com / 10, `sem acento (${sem}) e um subconjunto plausivel de ${com}, nao zero`);
});

t('NAO ha curinga e o casamento e por palavra inteira', async () => {
  eq(await total({ query: 'nepotism' }), 0, 'prefixo truncado');
  eq(await total({ query: 'nepotism*' }), 0, 'curinga *');
});

t('expressao exata funciona como frase', async () => {
  const frase = await total({ query: 'nepotismo cruzado', expressaoExata: true });
  const solto = await total({ query: 'nepotismo cruzado' });
  ok(frase <= solto, `frase (${frase}) nao pode exceder o AND (${solto})`);
});

t('paginacao anda e e ESTAVEL entre rodadas', async () => {
  const a = await crawler().buscar({ query: 'nepotismo', size: 5, maxPages: 3 });
  const b = await crawler().buscar({ query: 'nepotismo', size: 5, maxPages: 3 });
  eq(a.retornados, 15, 'tres paginas de 5');
  eq(JSON.stringify(a.resultados.map((x) => x.id)), JSON.stringify(b.resultados.map((x) => x.id)),
     'mesma busca deve devolver os mesmos ids na mesma ordem');
});

t('consulta por numero e EXATA', async () => {
  const c = new TCEPEChecker({ log });
  const r = await c.consultarProcesso('26100740-3AR001');
  eq(r.encontrado, true, 'processo conhecido');
  eq((await c.consultarProcesso('99999999-9')).encontrado, false, 'numero inventado');
});

t('data em DD/MM/YYYY e convertida; formato invalido explode cedo', async () => {
  eq(TCEPECrawler._iso('01/02/2026'), '2026-02-01', 'conversao');
  eq(TCEPECrawler._iso('2026-02-01'), '2026-02-01', 'ja ISO');
  let erro = null;
  try { TCEPECrawler._iso('2026'); } catch (e) { erro = e; }
  ok(erro, 'data invalida tem de levantar erro');
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
