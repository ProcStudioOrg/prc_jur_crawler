// src/TCDFTestes.js — integracao TCDF. Rode: node src/TCDFTestes.js
const TCDFCrawler = require('./TCDFCrawler');
const TCDFChecker = require('./TCDFChecker');
const TCDFNavigator = require('./TCDFNavigator');

const log = () => {};
const T = [];
const t = (nome, fn) => T.push([nome, fn]);
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${b}, veio ${a}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const crawler = () => new TCDFCrawler({ log });
const total = async (o) => (await crawler().buscar({ size: 1, maxPages: 1, ...o })).total;

t('busca simples devolve total EXATO, resultados e permalink', async () => {
  const r = await crawler().buscar({ query: 'nepotismo', size: 3, maxPages: 1 });
  ok(r.total > 0, 'total deve ser > 0');
  eq(r.retornados, 3, 'retornados');
  eq(r.totalExato, true, 'termo estreito tem de dar total exato (relation=eq)');
  const d = r.resultados[0];
  ok(d.id && d.titulo && d.url, 'documento precisa de e-doc, titulo e permalink');
  ok(d.url.includes(d.id), 'o permalink e montado com o e-doc');
});

t('🔴 o acervo SEM termo vem SATURADO em 10.000, nao exato', async () => {
  const r = await crawler().buscar({ size: 1, maxPages: 1 });
  eq(r.total, 10000, 'o teto do ES');
  eq(r.totalExato, false, 'relation tem de ser "gte"');
  ok(r.avisos.some((a) => /SATURADO/.test(a)), 'o crawler tem de avisar da saturacao');
});

t('🔴 `q=` vazio ZERA na API crua — e o Navigator protege disso', async () => {
  // A armadilha, medida direto na API, sem passar pelo Navigator:
  const https = require('https');
  const cru = (qs) => new Promise((res, rej) => {
    https.get(`https://${TCDFNavigator.HOST_BUSCA}/jurisprudencia/?${qs}`,
      { headers: { 'User-Agent': TCDFNavigator.UA } }, (r) => {
        let b = ''; r.setEncoding('utf8'); r.on('data', (c) => (b += c));
        r.on('end', () => { try { res(JSON.parse(b).data.hits.total.value); } catch (e) { rej(e); } });
      }).on('error', rej);
  });
  eq(await cru('q=&from=0&maxPerPage=1'), 0, 'q= vazio tem de zerar na API crua');
  eq(await cru('q=%20&from=0&maxPerPage=1'), 0, 'q= com um espaco tambem zera');
  ok((await cru('from=0&maxPerPage=1')) >= 10000, 'q AUSENTE devolve o acervo');

  // E a protecao: o Navigator OMITE a chave, entao q:'' nao pode zerar.
  const nav = new TCDFNavigator({ log });
  ok((await nav.buscarPagina({ q: '', from: 0, maxPerPage: 1 })).total >= 10000,
    'o Navigator tem de omitir q vazio em vez de manda-lo');
  ok((await total({})) >= 10000, 'buscar() sem query nao pode zerar');
});

t('paginacao ANDA e e ESTAVEL entre requisicoes', async () => {
  const a = await crawler().buscar({ query: 'nepotismo', size: 5, maxPages: 2 });
  eq(a.retornados, 10, 'duas paginas de 5');
  eq(new Set(a.resultados.map((r) => r.id)).size, 10, 'sem id repetido entre paginas');
  const b = await crawler().buscar({ query: 'nepotismo', size: 5, maxPages: 2 });
  eq(a.resultados.map((r) => r.id).join(','), b.resultados.map((r) => r.id).join(','),
    'a mesma busca tem de devolver os mesmos ids (medido 3/3 no mapeamento)');
});

t('🔴 profundidade: o crawler para antes do HTTP 500 do max_result_window', async () => {
  // Precisa de uma busca MAIOR que a janela, senao o loop acaba por esgotar o
  // total antes de bater na parede. Sem termo o acervo e 18.370 (saturado em 10.000).
  const r = await crawler().buscar({ size: 400, maxPages: 40 });
  ok(r.avisos.some((a) => /Paginacao interrompida/.test(a)),
    'passar de from+size=10000 tem de virar aviso, nao HTTP 500');
  ok(r.retornados <= 10000, `nao pode passar da janela, veio ${r.retornados}`);
});

t('🔴 pagina grande demais e RECUPERADA, nao tratada como fim de acervo', async () => {
  // maxPerPage=2000 responde HTTP 200 com PHP fatal error; 1000 responde HTTP 500.
  // Os dois sao a MESMA causa (memoria do proxy) e os dois tem de ser recuperados.
  // ⚠️ O LIMIAR NAO E FIXO — depende do worker PHP que atender. Medido: 1000
  // sozinho da 500 em 6/6 tentativas, mas 1000 LOGO DEPOIS de um 2000 que
  // estourou passa (o worker reciclou). Por isso o teste NAO afirma que houve
  // reducao: afirma que a pagina foi entregue e que o total nao se perdeu.
  const nav = new TCDFNavigator({ log });
  for (const n of [1000, 2000]) {
    const r = await nav.buscarPagina({ q: 'licitação', from: 0, maxPerPage: n });
    ok(r.documentos.length > 0, `maxPerPage=${n} tem de se recuperar, veio 0 documento`);
    ok(r.maxPerPageUsado <= n, `maxPerPage usado (${r.maxPerPageUsado}) nao pode subir`);
    eq(r.documentos.length, r.maxPerPageUsado, 'a pagina entregue tem de ter o tamanho usado');
    eq(r.total, 6684, 'e o total continua o mesmo depois da reducao');
  }
});

t('FILTRO DE DATA restringe de verdade e bate com o filtro de ano', async () => {
  const base = await total({ query: 'nepotismo' });
  const ano2023 = await total({ query: 'nepotismo', ano: 2023 });
  const range2023 = await total({ query: 'nepotismo', dataInicio: '01/01/2023', dataFim: '31/12/2023' });
  const meio2023 = await total({ query: 'nepotismo', dataInicio: '01/01/2023', dataFim: '30/06/2023' });
  ok(ano2023 < base, `o ano (${ano2023}) tem de restringir a base (${base})`);
  eq(range2023, ano2023, 'o range por sessao_data tem de bater com filter[ano] — conferencia cruzada');
  ok(meio2023 < range2023, `meio ano (${meio2023}) tem de ser menor que o ano cheio (${range2023})`);
  eq(await total({ query: 'nepotismo', dataInicio: '01/01/1900', dataFim: '31/12/1900' }), 0, 'controle');
});

t('cada filtro exposto MUDA a contagem (nenhum e decorativo)', async () => {
  const base = await total({ query: 'nepotismo' });
  ok((await total({ query: 'nepotismo', selecionada: true })) < base, 'selecionada');
  ok((await total({ query: 'nepotismo', sessaoTipo: 'EXTRAORDINÁRIA' })) < base, 'sessao_tipo');
  ok((await total({ query: 'nepotismo', relator: 'Inácio Magalhães Filho' })) < base, 'relator');
  eq(await total({ query: 'nepotismo', numero: 4760 }), 1, 'numero do documento');
  eq(await total({ query: 'nepotismo', ano: 1899 }), 0, 'ano inexistente');
});

t('🔴 "Selecionada" e SUBCONJUNTO de "Inteiro teor", nao outra base', async () => {
  const inteiro = await total({ query: 'nepotismo' });
  const sel = await total({ query: 'nepotismo', selecionada: true });
  ok(sel < inteiro, `selecionada(${sel}) tem de ser menor que inteiro teor(${inteiro})`);
  const r = await crawler().buscar({ query: 'nepotismo', selecionada: true, size: 5, maxPages: 1 });
  ok(r.resultados.every((d) => d.selecionada && d.situacao === 'Publicada'), 'todos Publicada');
});

t('🔴 filtro QUEBRADO no servidor NAO e enviado — e vira aviso', async () => {
  const r = await crawler().buscar({ query: 'nepotismo', assunto: 'Pregão eletrônico', size: 1, maxPages: 1 });
  eq(r.total, await total({ query: 'nepotismo' }), 'assunto nao pode ser enviado (zeraria)');
  ok(r.avisos.some((a) => /FILTRO QUEBRADO/.test(a)), 'tem de avisar');
  ok(!('assunto' in r.filtros), 'o filtro quebrado nao pode ir na query string');
});

t('🔴 "E"/"OU" em portugues AMPLIAM e o crawler avisa', async () => {
  const or = await total({ query: 'nepotismo OR licitação' });
  const ptE = await total({ query: 'nepotismo E licitação' });
  const ptOU = await total({ query: 'nepotismo OU licitação' });
  ok(ptE > or, `"E" (${ptE}) tem de AMPLIAR sobre o OR real (${or}) — nao e operador`);
  ok(ptOU > or, `"OU" (${ptOU}) tem de AMPLIAR sobre o OR real (${or})`);
  const r = await crawler().buscar({ query: 'nepotismo E licitação', size: 1, maxPages: 1 });
  ok(r.avisos.some((a) => /NAO sao operadores/.test(a)), 'tem de avisar');
});

t('os operadores de verdade funcionam (AND/OR/NOT/aspas/curinga/campo)', async () => {
  const nep = await total({ query: 'nepotismo' });
  const lic = await total({ query: 'licitação' });
  const and = await total({ query: 'nepotismo AND licitação' });
  const not = await total({ query: 'nepotismo NOT licitação' });
  ok(and < nep, 'AND restringe');
  eq(and + not, nep, `AND(${and}) + NOT(${not}) tem de fechar o termo sozinho (${nep})`);
  eq(await total({ query: 'nepotismo licitação' }), await total({ query: 'nepotismo OR licitação' }),
    'o espaco e OR implicito');
  ok((await total({ query: 'licita*' })) > lic, 'o curinga amplia');
  ok((await total({ query: '"servidor efetivo"' })) < (await total({ query: 'servidor efetivo' })),
    'aspas sao frase exata');
  ok((await total({ query: 'jurisprudencia_ementa:nepotismo' })) < nep, 'sintaxe de campo restringe');
});

t('🔴 campo desconhecido ZERA em vez de ser ignorado', async () => {
  eq(await total({ query: 'zzqqinventado:nepotismo' }), 0, 'campo inexistente no q');
  const nav = new TCDFNavigator({ log });
  const r = await nav.buscarPagina({ q: 'nepotismo', maxPerPage: 1, filtros: { campo_que_nao_existe: "'x'" } });
  eq(r.total, 0, 'campo inexistente em filter[] tambem zera');
});

t('o texto JA VEM na busca: ementa e inteiro teor sem segundo salto', async () => {
  const r = await crawler().buscar({ query: 'nepotismo', selecionada: true, size: 3, maxPages: 1 });
  const d = r.resultados[0];
  ok(d.ementa && d.ementa.length > 100, `ementa curta demais: ${(d.ementa || '').length}`);
  ok(d.inteiroTeorChars > d.ementa.length, 'o inteiro teor tem de ser maior que a ementa');
  ok(d.dataJulgamento && d.dataPublicacao, 'HA data de julgamento E de publicacao');
});

t('consulta por numero: e-doc e exato, processo rende varios julgados', async () => {
  const c = new TCDFChecker({ log });
  const porEdoc = await c.consultarProcesso('B0AB532D');
  eq(porEdoc.encontrados, 1, 'e-doc identifica UM documento');
  eq(porEdoc.resultados[0].id, 'B0AB532D', 'e o documento certo');
  const porProc = await c.consultarProcesso('4518/2020');
  ok(porProc.encontrados > 1, `um processo rende varios julgados, veio ${porProc.encontrados}`);
  eq((await c.consultarProcesso('ZZZZZZZZ')).encontrados, 0, 'controle negativo');
});

t('🔴 o numero CRU nunca vai solto no q (derrubaria com HTTP 500)', async () => {
  for (const n of ['4518/2020', '00600-00004518/2020-04']) {
    const q = TCDFChecker.montarConsulta(n).q;
    ok(/^processo_numero(_completo)?:/.test(q), `${n} tem de ir escopado em campo, veio: ${q}`);
  }
  // e a prova de que o cru realmente derruba:
  let erro = null;
  try { await total({ query: '4518/2020' }); } catch (e) { erro = e; }
  ok(erro && /500/.test(erro.message), 'o numero cru tem de estourar HTTP 500');
});

t('--verificar confirma a amostra por reconsulta', async () => {
  const r = await crawler().buscar({ query: 'nepotismo', size: 3, maxPages: 1 });
  const v = await new TCDFChecker({ log }).verificar(r.resultados, 3);
  eq(v.amostra, 3, 'amostra');
  eq(v.confirmados, 3, 'os tres tem de confirmar');
  ok(v.itens.every((i) => i.conferiuNumero && i.conferiuRelator), 'numero e relator tem de bater');
});

t('data em DD/MM/YYYY e convertida; formato invalido explode cedo', async () => {
  eq(TCDFCrawler._iso('01/02/2026'), '2026-02-01', 'conversao');
  eq(TCDFCrawler._iso('2026-02-01'), '2026-02-01', 'ja ISO');
  let erro = null;
  try { TCDFCrawler._iso('2026'); } catch (e) { erro = e; }
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
