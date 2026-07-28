// src/CARFTestes.js
const CARFCrawler = require('./CARFCrawler');
const CARFChecker = require('./CARFChecker');
const CARFNavigator = require('./CARFNavigator');

/**
 * Suíte de integração do CARF (Solr público). Roda contra o site de verdade.
 *   node src/CARFTestes.js            todos
 *   node src/CARFTestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e as
 * RESSALVAS do CLAUDE-CARF.md — o que quebra em silêncio se o site mudar.
 */

const QUERY = 'aposentadoria';
const PROCESSO_CONHECIDO = '13890.000160/2006-17';
const DECISAO_CONHECIDA = '2802-000.639';
const ID_CONHECIDO = '4738988';
const pausa = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
  return true;
};

teste('busca simples devolve resultados com ementa completa', async () => {
  const c = new CARFCrawler({ log: () => {} });
  const r = await c.search(QUERY, {}, { maxPages: 1 });
  ok(r.length > 0, 'busca não devolveu resultados');
  ok(r.totalResults > 10000, `total suspeito: ${r.totalResults} (aposentadoria tinha 18.609)`);
  ok(r[0].ementa.length > 100, `ementa curta demais: ${r[0].ementa.length} chars`);
  ok(r[0].numeroDecisao && r[0].id, 'resultado sem numeroDecisao/id');
  return `${r.length} resultados de ${r.totalResults}; ementa ${r[0].ementa.length} chars`;
});

teste('o inteiro teor JÁ VEM na busca, sem o prefixo Tika', async () => {
  const c = new CARFCrawler({ log: () => {}, includeFullText: true });
  const r = await c.search(QUERY, {}, { maxPages: 1, maxResults: 3 });
  const comTeor = r.filter((x) => x.temInteiroTeor);
  ok(comTeor.length > 0, 'nenhum resultado com inteiro teor');
  const texto = comTeor[0].inteiroTeor;
  ok(texto.length > 2000, `inteiro teor curto demais: ${texto.length} chars`);
  ok(!texto.startsWith('Metadados =>'), 'prefixo de metadados Tika não foi cortado');
  ok(!texto.includes(' '), 'NBSP não normalizado no inteiro teor');
  return `inteiro teor com ${texto.length} chars úteis, Tika removido`;
});

teste('filtro de data de sessão restringe de fato', async () => {
  const c = new CARFCrawler({ log: () => {} });
  const tudo = await c.search(QUERY, {}, { maxPages: 1, maxResults: 1 });
  await pausa();
  const so2024 = await c.search(QUERY, {
    dataSessaoInicio: '01/01/2024', dataSessaoFim: '31/12/2024',
  }, { maxPages: 1, maxResults: 1 });
  ok(so2024.totalResults > 0, 'filtro de 2024 zerou — deveria ter ~1.022');
  ok(so2024.totalResults < tudo.totalResults / 5,
    `filtro não restringiu: ${so2024.totalResults} vs ${tudo.totalResults}`);
  return `${tudo.totalResults} sem filtro → ${so2024.totalResults} em 2024`;
});

teste('datas de sessão e de publicação são filtros DIFERENTES', async () => {
  const c = new CARFCrawler({ log: () => {} });
  const sessao = await c.search(QUERY, {
    dataSessaoInicio: '01/01/2024', dataSessaoFim: '31/12/2024',
  }, { maxPages: 1, maxResults: 1 });
  await pausa();
  const pub = await c.search(QUERY, {
    dataPubInicio: '01/01/2024', dataPubFim: '31/12/2024',
  }, { maxPages: 1, maxResults: 1 });
  ok(sessao.totalResults !== pub.totalResults,
    `sessão e publicação deram igual (${sessao.totalResults}) — filtro ignorado?`);
  return `sessão 2024: ${sessao.totalResults} × publicação 2024: ${pub.totalResults}`;
});

teste('paginação anda, é estável 2× e sem sobreposição', async () => {
  const nav = new CARFNavigator({ log: () => {} });
  const p1a = await nav.buscar({ q: QUERY, fl: 'id' }, 0, 10);
  await pausa();
  const p1b = await nav.buscar({ q: QUERY, fl: 'id' }, 0, 10);
  const p2 = await nav.buscar({ q: QUERY, fl: 'id' }, 10, 10);
  const ids = (r) => r.docs.map((d) => d.id).join(',');
  ok(ids(p1a) === ids(p1b), 'a MESMA página devolveu ids diferentes em 2 execuções');
  const s1 = new Set(p1a.docs.map((d) => d.id));
  ok(!p2.docs.some((d) => s1.has(d.id)), 'páginas 1 e 2 se sobrepõem');
  return `página 1 estável; pág1 ∩ pág2 = vazio`;
});

teste('filtro de seção muda a contagem (CSRF < total)', async () => {
  const c = new CARFCrawler({ log: () => {} });
  const tudo = await c.search(QUERY, {}, { maxPages: 1, maxResults: 1 });
  await pausa();
  const csrf = await c.search(QUERY, {
    secao: 'Câmara Superior de Recursos Fiscais',
  }, { maxPages: 1, maxResults: 1 });
  ok(csrf.totalResults > 0, 'CSRF zerou — string do facet mudou?');
  ok(csrf.totalResults < tudo.totalResults, 'filtro de seção não restringiu');
  return `${tudo.totalResults} sem filtro → ${csrf.totalResults} na CSRF`;
});

teste('consulta por número de PROCESSO (com máscara) acha o julgado', async () => {
  const ch = new CARFChecker({ log: () => {} });
  const res = await ch.consultarProcesso(PROCESSO_CONHECIDO);
  ok(res.encontrado, `processo conhecido não encontrado: ${PROCESSO_CONHECIDO}`);
  ok(res.julgados.some((j) => j.numeroDecisao === DECISAO_CONHECIDA),
    `decisão ${DECISAO_CONHECIDA} não veio nos julgados`);
  return `${res.julgados.length} julgado(s) do processo`;
});

teste('a normalização de máscara é obrigatória (sem ela = 0)', async () => {
  const nav = new CARFNavigator({ log: () => {} });
  const sem = await nav.buscar({ q: `numero_processo_s:${PROCESSO_CONHECIDO.replace(/\D/g, '')}` }, 0, 1);
  ok(sem.numFound === 0, `sem máscara deveria dar 0, deu ${sem.numFound} — a base mudou?`);
  const ch = new CARFChecker({ log: () => {} });
  const res = await ch.consultarProcesso(PROCESSO_CONHECIDO.replace(/\D/g, ''));
  ok(res.encontrado, 'o Checker não normalizou os 17 dígitos para a máscara');
  return 'dígitos crus = 0 na base; o Checker formata e encontra';
});

teste('consulta por número de DECISÃO e auditoria --verificar', async () => {
  const ch = new CARFChecker({ log: () => {} });
  const res = await ch.consultarDecisao(DECISAO_CONHECIDA);
  ok(res.encontrado, `decisão conhecida não encontrada: ${DECISAO_CONHECIDA}`);
  ok(res.julgados.some((j) => String(j.id) === ID_CONHECIDO),
    `id esperado ${ID_CONHECIDO} não veio`);
  const audit = await ch.verificarResultados([
    { id: ID_CONHECIDO, numeroDecisao: DECISAO_CONHECIDA },
  ], { amostra: 1 });
  ok(audit.confirmados === 1, 'auditoria não confirmou o documento conhecido');
  return `decisão confirmada, id ${ID_CONHECIDO}`;
});

teste('PDF original: 200 sem sessão e desembrulhado do PGCOPY', async () => {
  const nav = new CARFNavigator({ log: () => {} });
  const data = await nav.buscar({ q: `id:${ID_CONHECIDO}` }, 0, 1);
  ok(data.docs.length === 1, 'doc conhecido sumiu');
  const pdf = await nav.baixarPdf(data.docs[0]);
  ok(pdf.slice(0, 4).toString() === '%PDF', `PDF não começa em %PDF: ${pdf.slice(0, 8).toString('hex')}`);
  ok(pdf.length > 50000, `PDF pequeno demais: ${pdf.length} bytes`);
  return `PDF íntegro com ${pdf.length} bytes (wrapper PGCOPY removido)`;
});

teste('RESSALVA: OR é ignorado (vira E) — se isso mudar, o doc está errado', async () => {
  const nav = new CARFNavigator({ log: () => {} });
  const and = await nav.buscar({ q: 'vale AND transporte', fl: 'id' }, 0, 1);
  await pausa();
  const or = await nav.buscar({ q: 'vale OR transporte', fl: 'id' }, 0, 1);
  ok(and.numFound === or.numFound,
    `OR passou a funcionar (AND=${and.numFound}, OR=${or.numFound}) — ATUALIZE o CLAUDE-CARF.md`);
  return `OR ainda é ignorado (ambos ${and.numFound}) — ressalva vigente`;
});

// ---------------------------------------------------------------- runner
(async () => {
  const so = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const rodar = so ? [testes[so - 1]].filter(Boolean) : testes;
  if (!rodar.length) {
    console.error(`Teste ${so} não existe (1..${testes.length})`);
    process.exit(2);
  }
  let falhas = 0;
  for (let i = 0; i < rodar.length; i++) {
    const t = rodar[i];
    const n = so ?? i + 1;
    process.stdout.write(`[${n}/${testes.length}] ${t.nome}... `);
    try {
      const detalhe = await t.fn();
      console.log(`OK${detalhe ? ` — ${detalhe}` : ''}`);
    } catch (err) {
      falhas += 1;
      console.log(`FALHOU — ${err.message}`);
    }
    if (i < rodar.length - 1) await pausa();
  }
  console.log(falhas ? `\n${falhas} teste(s) falharam` : '\nTodos os testes passaram');
  process.exit(falhas ? 1 : 0);
})();
