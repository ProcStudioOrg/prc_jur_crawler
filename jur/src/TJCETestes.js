// src/TJCETestes.js
const TJCECrawler = require('./TJCECrawler');
const TJCEChecker = require('./TJCEChecker');
const TJCENavigator = require('./TJCENavigator');

/**
 * Suíte de integração do TJCE (SJURIS). Roda contra o site de verdade.
 *   node src/TJCETestes.js            todos
 *   node src/TJCETestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e,
 * principalmente, as RESSALVAS: o que quebra em silêncio se o site mudar.
 */

const QUERY = 'aposentadoria por invalidez';
const PROCESSO_CONHECIDO = '0169160-51.2018.8.06.0001';
const pausa = (ms = 3000) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
  return true;
};

teste('busca simples devolve resultados com ementa', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1 });
  ok(r.length > 0, 'busca não devolveu resultados');
  ok(r.totalResults > 100, `total suspeito: ${r.totalResults}`);
  ok(r[0].ementa.length > 200, `ementa curta demais: ${r[0].ementa.length} chars`);
  ok(r[0].processo && r[0].id, 'resultado sem processo/id');
  return `${r.length} resultados de ${r.totalResults}; ementa ${r[0].ementa.length} chars`;
});

teste('o inteiro teor JÁ VEM na busca (nenhum request extra)', async () => {
  const c = new TJCECrawler({ log: () => {}, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1, maxResults: 3 });
  ok(r.every((x) => x.temInteiroTeor), 'algum resultado veio sem `conteudo`');
  ok(r[0].inteiroTeor.length > 2000, `inteiro teor curto: ${r[0].inteiroTeor.length}`);
  ok(r[0].inteiroTeor.length > r[0].ementa.length, 'inteiro teor não é maior que a ementa');
  return `inteiro teor ${r[0].inteiroTeor.length} chars vs ementa ${r[0].ementa.length}`;
});

teste('RESSALVA: decisão monocrática vem SEM ementa e o crawler avisa', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const r = await c.search(QUERY, { tipo: 'monocratica' }, { maxPages: 1, maxResults: 5 });
  ok(r.length > 0, 'sem monocráticas para testar');
  const semEmenta = r.filter((x) => !x.temEmenta).length;
  ok(semEmenta > 0, 'esperava monocrática sem ementa — o portal pode ter mudado (bom sinal, atualize o doc)');
  ok(r.avisos.length > 0, 'crawler não emitiu o aviso de ementa vazia');
  return `${semEmenta}/${r.length} sem ementa; aviso emitido`;
});

teste('desambiguação Justiça Comum × Turma Recursal muda a contagem', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const comum = await c.search(QUERY, { base: 'comum', tipo: 'acordao' }, { maxPages: 1 });
  await pausa();
  const turmas = await c.search(QUERY, { base: 'turmas', tipo: 'acordao' }, { maxPages: 1 });
  ok(comum.totalResults !== turmas.totalResults,
    `filtro ignorado: comum e turmas devolveram ${comum.totalResults}`);
  ok(turmas.every((x) => /TURMA RECURSAL|Turma Recursal/i.test(x.orgaoJulgador)),
    'resultado de turmas trouxe órgão que não é Turma Recursal');
  return `comum ${comum.totalResults} × turmas ${turmas.totalResults}`;
});

teste('SJURIS cobre SAJ E PJe (é superset do e-SAJ)', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const pje = await c.search(QUERY, { origem: 'pje', tipo: 'acordao' }, { maxPages: 1 });
  await pausa();
  const saj = await c.search(QUERY, { origem: 'saj', tipo: 'acordao' }, { maxPages: 1 });
  await pausa();
  const ambas = await c.search(QUERY, { origem: 'ambas', tipo: 'acordao' }, { maxPages: 1 });
  ok(pje.totalResults > 0 && saj.totalResults > 0, 'uma das origens veio vazia');
  ok(ambas.totalResults === pje.totalResults + saj.totalResults,
    `soma não bate: ${pje.totalResults} + ${saj.totalResults} ≠ ${ambas.totalResults}`);
  return `PJE ${pje.totalResults} + SAJ ${saj.totalResults} = ${ambas.totalResults}`;
});

teste('RESSALVA: o período vai em dataJulgamentoInicial/Final e restringe', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const sem = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1 });
  await pausa();
  const com = await c.search(QUERY, {
    tipo: 'acordao', dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '31/12/2025',
  }, { maxPages: 1 });
  ok(com.totalResults > 0, 'filtro de data zerou a busca — confira o formato ISO com T03:00:00.000Z');
  ok(com.totalResults < sem.totalResults,
    `data não restringiu: ${sem.totalResults} → ${com.totalResults}`);
  ok(com.every((x) => /\/2025$/.test(x.dataJulgamento)), 'veio julgado fora do período pedido');
  return `${sem.totalResults} → ${com.totalResults} em 2025`;
});

teste('RESSALVA: size acima de 20 é rejeitado pela API', async () => {
  const nav = new TJCENavigator({ log: () => {}, retries: 0 });
  const pagina = await nav.buscar({ busca: QUERY }, 0, 50); // o navigator capa em 20
  ok(pagina.content.length <= TJCENavigator.SIZE_MAX,
    `devolveu ${pagina.content.length}, acima do teto ${TJCENavigator.SIZE_MAX}`);
  return `size pedido 50 → ${pagina.content.length} (capado em ${TJCENavigator.SIZE_MAX})`;
});

teste('paginação anda além da página 1 e é estável entre execuções', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const a = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 2 });
  await pausa();
  const b = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 2 });
  ok(a.length > TJCENavigator.SIZE_MAX, `não passou da página 1: ${a.length} resultados`);
  ok(new Set(a.map((x) => x.id)).size === a.length, 'a paginação repetiu documentos');
  const iguais = a.filter((x, i) => x.id === b[i]?.id).length;
  ok(iguais === a.length, `paginação instável: ${iguais}/${a.length} iguais entre execuções`);
  return `${a.length} documentos, ${iguais}/${a.length} estáveis`;
});

teste('total é exato, não saturado', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const raro = await c.search('xilofone', { tipo: 'acordao' }, { maxPages: 1 });
  await pausa();
  const comum = await c.search('aposentadoria', { tipo: 'acordao' }, { maxPages: 1 });
  ok(raro.totalResults === 0 || raro.totalResults < 100, `termo raro devolveu ${raro.totalResults}`);
  ok(comum.totalResults % 1000 !== 0, `total redondo (${comum.totalResults}) cheira a teto de contador`);
  return `raro ${raro.totalResults} × comum ${comum.totalResults}`;
});

teste('Checker acha um processo conhecido e distingue julgado de processo', async () => {
  const ck = new TJCEChecker({ log: () => {} });
  const res = await ck.consultarProcesso(PROCESSO_CONHECIDO);
  ok(res.encontrado, `processo conhecido não encontrado: ${PROCESSO_CONHECIDO}`);
  ok(res.dvValido, 'DV do processo de teste não confere');
  ok(res.doTribunal, 'processo de teste não é do TJCE');
  ok(res.julgados.length >= 1, 'processo sem julgados');
  // o `id` do documento é a identidade — o nº do processo não basta
  ok(res.julgados.every((j) => j.id.startsWith(PROCESSO_CONHECIDO.replace(/\D/g, ''))),
    'id de julgado não deriva do processo');
  return `${res.julgados.length} julgado(s): ${res.julgados.map((j) => j.tipoDocumento).join(', ')}`;
});

teste('Checker rejeita processo inexistente', async () => {
  const ck = new TJCEChecker({ log: () => {} });
  const res = await ck.consultarProcesso('9999999-99.2099.8.06.0001');
  ok(!res.encontrado, 'checker confirmou um processo que não existe');
  return 'inexistente devolveu encontrado=false';
});

teste('DataJud responde para o TJCE (fallback do Checker)', async () => {
  const ck = new TJCEChecker({ log: () => {} });
  const res = await ck.consultarDataJud(PROCESSO_CONHECIDO);
  ok(res.encontrado, 'DataJud não achou o processo conhecido');
  ok(res.processos.some((p) => p.tribunal === 'TJCE'), 'DataJud devolveu outro tribunal');
  return `${res.processos.length} registro(s), graus: ${res.processos.map((p) => p.grau).join(',')}`;
});

teste('auditoria --verificar confirma a amostra', async () => {
  const c = new TJCECrawler({ log: () => {} });
  const r = await c.search('auxílio-acidente', { tipo: 'acordao' }, { maxPages: 1, maxResults: 5 });
  await pausa();
  const ck = new TJCEChecker({ log: () => {} });
  const v = await ck.verificarResultados(r, { amostra: 3 });
  ok(v.confirmados === v.verificados, `divergências: ${JSON.stringify(v.detalhes.filter((d) => !d.confirmado))}`);
  return `${v.confirmados}/${v.verificados} confirmados`;
});

teste('domínio dos filtros responde com contagens', async () => {
  const nav = new TJCENavigator({ log: () => {} });
  const bases = await nav.listaCampos(TJCENavigator.CAMPOS.base);
  const chaves = bases.map((b) => b.chave);
  ok(chaves.includes(TJCENavigator.BASES.comum), `"${TJCENavigator.BASES.comum}" sumiu do domínio: ${chaves}`);
  ok(chaves.includes(TJCENavigator.BASES.turmas), `"${TJCENavigator.BASES.turmas}" sumiu do domínio: ${chaves}`);
  return bases.map((b) => `${b.chave}=${b.quantidade}`).join(' | ');
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
    await pausa(2000);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
