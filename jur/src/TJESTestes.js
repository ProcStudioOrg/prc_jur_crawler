// src/TJESTestes.js — integração contra o site real. Rode: node src/TJESTestes.js
//
// Cada teste é SENTINELA de uma ressalva medida em 07/08/2026. Quando um deles
// falhar, o comportamento do TJES mudou e o CLAUDE-TJES.md está desatualizado —
// a mensagem diz exatamente o quê.
const { TJESNavigator, ACERVOS } = require('./TJESNavigator');
const TJESCrawler = require('./TJESCrawler');
const TJESChecker = require('./TJESChecker');

const nav = new TJESNavigator({ log: () => {} });
let ok = 0;
let falhas = 0;

async function t(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  ✅ ${nome}`);
  } catch (e) {
    falhas += 1;
    console.log(`  ❌ ${nome}\n     ${e.message}`);
  }
}

const eq = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg}: esperado ${b}, veio ${a}`);
};
const total = async (params) => (await nav.search({ perPage: 1, ...params })).total;

(async () => {
  console.log('TJES — testes de integração (site real)\n');

  console.log('Acervos');
  await t('os 5 cores existem e somam ~2,21 mi de documentos', async () => {
    const c = await nav.cores();
    for (const def of Object.values(ACERVOS)) {
      if (!c[def.core]) throw new Error(`core ${def.core} sumiu de /api/cores`);
    }
    const soma = Object.values(ACERVOS).reduce((s, d) => s + c[d.core].total_docs, 0);
    if (soma < 2_000_000) throw new Error(`soma dos acervos caiu para ${soma} (era 2.212.794)`);
  });
  await t('o 1º grau continua sendo o maior acervo', async () => {
    const c = await nav.cores();
    if (c.pje1g.total_docs < c.pje2g.total_docs) {
      throw new Error('pje1g deixou de ser maior que pje2g — reveja o escopo no doc');
    }
  });
  await t('omitir `core` cai no MENOR acervo do PJe (pje2g_mono)', async () => {
    const r = await fetch('https://sistemas.tjes.jus.br/consulta-jurisprudencia/api/search?q=usucapi%C3%A3o&per_page=1');
    const j = await r.json();
    eq(j.core_used, 'pje2g_mono', 'default da API mudou');
  });

  console.log('\nOperadores — os ingleses funcionam, os portugueses inflam');
  await t('espaço é OR (aritmética exata)', async () => {
    const [a, b, and, esp] = await Promise.all([
      total({ core: 'pje2g', q: 'usucapião' }),
      total({ core: 'pje2g', q: 'posse' }),
      total({ core: 'pje2g', q: 'usucapião AND posse' }),
      total({ core: 'pje2g', q: 'usucapião posse' }),
    ]);
    eq(a + b - and, esp, 'o espaço deixou de ser OR');
  });
  await t('NOT é exato (a − a∩b)', async () => {
    const [a, and, not] = await Promise.all([
      total({ core: 'pje2g', q: 'usucapião' }),
      total({ core: 'pje2g', q: 'usucapião AND posse' }),
      total({ core: 'pje2g', q: 'usucapião NOT posse' }),
    ]);
    eq(a - and, not, 'NOT deixou de ser exato');
  });
  await t('E / OU / ADJ continuam IGNORADOS', async () => {
    const esp = await total({ core: 'pje2g', q: 'usucapião posse' });
    for (const op of ['E', 'OU', 'ADJ']) {
      const v = await total({ core: 'pje2g', q: `usucapião ${op} posse` });
      if (v !== esp) throw new Error(`"${op}" virou operador (${v} ≠ ${esp}) — atualize o doc`);
    }
  });
  await t('NAO e PROX continuam INFLANDO', async () => {
    const esp = await total({ core: 'pje2g', q: 'usucapião posse' });
    for (const op of ['NAO', 'PROX']) {
      const v = await total({ core: 'pje2g', q: `usucapião ${op} posse` });
      if (v <= esp) throw new Error(`"${op}" parou de inflar (${v} ≤ ${esp}) — atualize o doc`);
    }
  });
  await t('acento continua normalizado', async () => {
    const [com, sem] = await Promise.all([
      total({ core: 'pje2g', q: 'usucapião' }),
      total({ core: 'pje2g', q: 'usucapiao' }),
    ]);
    eq(sem, com, 'o índice deixou de normalizar acento — passe a avisar sobre isso');
  });

  console.log('\nO filtro no-op que muda a contagem');
  await t('filtro de data 1900→2100 ainda derruba a contagem de query multi-termo', async () => {
    const sem = await total({ core: 'pje2g', q: 'dano moral' });
    const com = await total({ core: 'pje2g', q: 'dano moral', dataIni: '1900-01-01', dataFim: '2100-01-01' });
    if (com >= sem) {
      throw new Error(
        `o defeito sumiu (${com} ≥ ${sem}) — ótimo, mas remova a ressalva §4 do CLAUDE-TJES.md`,
      );
    }
  });
  await t('`sort` NÃO muda a contagem (só o filtro de data muda)', async () => {
    const sem = await total({ core: 'pje2g', q: 'dano moral' });
    const com = await total({ core: 'pje2g', q: 'dano moral', sort: 'dt_juntada desc' });
    eq(com, sem, 'agora `sort` também mexe na contagem — a ressalva §4 precisa crescer');
  });

  console.log('\nJurisdição — Justiça Comum × Turma Recursal');
  await t('compõe exatamente SEM termo', async () => {
    const [tudo, tj, tr] = await Promise.all([
      total({ core: 'pje2g' }),
      total({ core: 'pje2g', jurisdicao: 'Tribunal de Justiça' }),
      total({ core: 'pje2g', jurisdicao: 'Turma Recursal' }),
    ]);
    eq(tj + tr, tudo, 'a partição por jurisdição deixou de fechar');
  });
  await t('compõe exatamente COM termo de uma palavra', async () => {
    const [tudo, tj, tr] = await Promise.all([
      total({ core: 'pje2g', q: 'usucapião' }),
      total({ core: 'pje2g', q: 'usucapião', jurisdicao: 'Tribunal de Justiça' }),
      total({ core: 'pje2g', q: 'usucapião', jurisdicao: 'Turma Recursal' }),
    ]);
    eq(tj + tr, tudo, 'a composição com termo quebrou — vire recorte de cliente, como no TJPE');
  });
  await t('valor inexistente devolve 0 com HTTP 200 (zero silencioso)', async () => {
    eq(await total({ core: 'pje2g', q: 'usucapião', jurisdicao: 'INVENTADO_9Z' }), 0, 'mudou');
  });

  console.log('\nDatas — o rótulo enganoso');
  await t('o filtro de data incide sobre dt_juntada, não sobre julgamento', async () => {
    const j = await nav.search({ core: 'pje2g', q: 'usucapião', perPage: 200, dataIni: '2025-06-01', dataFim: '2025-06-30' });
    if (!j.docs.length) throw new Error('a janela de junho/2025 ficou vazia');
    const fora = j.docs.filter((d) => !/^2025-06/.test(d.dt_juntada));
    eq(fora.length, 0, `${fora.length} documentos com dt_juntada fora da janela`);
  });
  await t('os cores do PJe continuam SEM data de julgamento', async () => {
    const j = await nav.search({ core: 'pje2g', q: 'usucapião', perPage: 1 });
    const k = Object.keys(j.docs[0]);
    if (k.some((x) => /data_julgamento|dataJulgamento/.test(x))) {
      throw new Error('apareceu data de julgamento no PJe — ótimo, atualize a ressalva §3');
    }
  });
  await t('os cores legados continuam COM data de julgamento', async () => {
    for (const core of ['legado', 'turma_recursal_legado']) {
      const j = await nav.search({ core, q: 'usucapião', perPage: 1 });
      if (!j.docs[0] || !j.docs[0].data_julgamento) {
        throw new Error(`${core} perdeu data_julgamento`);
      }
    }
  });
  await t('`sort=dt_juntada` num core legado dá HTTP 500 explícito, não zero', async () => {
    try {
      await nav.search({ core: 'legado', q: 'usucapião', perPage: 1, sort: 'dt_juntada desc' });
    } catch (e) {
      if (/HTTP 500|sort param field/.test(e.message)) return;
      throw e;
    }
    throw new Error('o core legado passou a aceitar sort=dt_juntada — simplifique o Navigator');
  });

  console.log('\nPaginação e total');
  await t('total é EXATO, não saturado', async () => {
    const v = await total({ core: 'pje2g', q: 'usucapião' });
    if (v % 1000 === 0) throw new Error(`total ${v} caiu em número redondo — investigue teto`);
  });
  await t('página além do fim devolve docs vazio sem erro', async () => {
    const j = await nav.search({ core: 'pje2g', q: 'usucapião', page: 99999, perPage: 2 });
    eq(j.docs.length, 0, 'passou a devolver documentos além do fim');
    if (typeof j.total !== 'number') throw new Error('perdeu o total além do fim');
  });
  await t('mesma página 3× devolve os mesmos ids (estabilidade)', async () => {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const j = await nav.search({ core: 'pje2g', q: 'usucapião', page: 3, perPage: 10 });
      runs.push(j.docs.map((d) => d.id).join(','));
    }
    eq(new Set(runs).size, 1, 'a paginação ficou instável — reveja a ressalva §11');
  });

  console.log('\nDocumento e Checker');
  await t('ementa e inteiro teor vêm na busca e são campos distintos', async () => {
    const j = await nav.search({ core: 'pje2g', q: 'usucapião', perPage: 1 });
    const d = j.docs[0];
    if (!d.ementa || !d.acordao) throw new Error('ementa ou acordao vieram vazios');
    if (d.ementa.length >= d.acordao.length) {
      throw new Error('ementa ficou >= acordao — confira se não viraram o mesmo campo, como no TJBA');
    }
  });
  await t('o 1º grau continua SEM ementa (e com inteiro_teor)', async () => {
    const j = await nav.search({ core: 'pje1g', q: 'usucapião', perPage: 1 });
    const d = j.docs[0];
    if (d.ementa) throw new Error('o pje1g ganhou ementa — atualize a tabela de schemas');
    if (!d.inteiro_teor) throw new Error('o pje1g perdeu inteiro_teor');
  });
  await t('nr_processo com máscara acha; sem máscara não acha', async () => {
    const NP = '5007137-47.2022.8.08.0011';
    eq(await total({ core: 'pje2g', nrProcesso: NP }), 1, 'nr_processo com máscara parou de achar');
    eq(await total({ core: 'pje2g', nrProcesso: NP.replace(/\D/g, '') }), 0, 'sem máscara passou a achar');
  });
  await t('consultar o CNJ por `q` ainda traz lixo citacional', async () => {
    const NP = '5007137-47.2022.8.08.0011';
    const v = await total({ core: 'pje2g', q: NP });
    if (v <= 1) throw new Error(`q=<cnj> devolveu ${v} — o campo parou de tokenizar; simplifique o Checker`);
  });
  await t('Checker acha um processo conhecido', async () => {
    const r = await new TJESChecker().consultarProcesso('5007137-47.2022.8.08.0011');
    if (!r.encontrado) throw new Error('não achou');
    if (!r.valido) throw new Error('o CNJ de teste passou a ser inválido');
  });

  console.log('\nCrawler ponta a ponta');
  await t('crawl + normalização + auditoria', async () => {
    const c = new TJESCrawler({ log: () => {} });
    const s = await c.crawl({ query: 'usucapião AND extraordinária', acervo: 'pje2g', maxPages: 1, perPage: 5 });
    if (s.coletados !== 5) throw new Error(`coletou ${s.coletados} de 5`);
    for (const r of s.resultados) {
      if (!r.id || !r.processo || !r.inteiroTeor) throw new Error('documento normalizado incompleto');
      if (r.dataJulgamento !== null) throw new Error('o pje2g devolveu dataJulgamento — reveja normalizarDoc');
      if (!r.dataJuntada) throw new Error('dataJuntada vazia');
    }
    const a = await new TJESChecker().auditar(s.resultados, 3);
    eq(a.confirmados, 3, 'a auditoria não confirmou a amostra');
  });
  await t('os 5 acervos respondem pelo crawler', async () => {
    for (const acervo of Object.keys(ACERVOS)) {
      const s = await new TJESCrawler({ log: () => {} }).crawl({ query: 'usucapião', acervo, maxPages: 1, perPage: 2 });
      if (!s.coletados) throw new Error(`acervo ${acervo} devolveu 0`);
    }
  });
  await t('a base continua CORRENTE (documento do ano em curso)', async () => {
    const j = await nav.search({ core: 'pje1g', perPage: 1, sort: 'dt_juntada desc' });
    const iso = j.docs[0].dt_juntada;
    const dias = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (dias > 45) {
      throw new Error(`documento mais recente tem ${Math.round(dias)} dias (${iso}) — a base pode ter congelado, como no TJAM`);
    }
  });

  console.log(`\n${ok} passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})();
