// src/TCEGOTestes.js
// Integracao do TCE-GO (SPA Iago). Rode: node src/TCEGOTestes.js
const TCEGONavigator = require('./TCEGONavigator');
const TCEGOCrawler = require('./TCEGOCrawler');
const TCEGOChecker = require('./TCEGOChecker');

const log = console.log.bind(console);
const nav = new TCEGONavigator({ log: () => {} });
const crawler = new TCEGOCrawler({ log: () => {}, nav });

let ok = 0;
let falhou = 0;
function checar(nome, cond, detalhe = '') {
  if (cond) { ok++; log(`  ✅ ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
  else { falhou++; log(`  ❌ ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
}

(async () => {
  log('\n== 1. Busca simples ==');
  const b = await crawler.buscar({ query: 'aposentadoria', ano: '2024', maxPages: 1 });
  checar('devolve resultados', b.resultados.length === 25, `${b.resultados.length} de ${b.total}`);
  checar('total EXATO abaixo do teto', b.totalExato === true, b.totalNota);
  checar('modelo lexical em termo de 1 palavra', b.modelosDeBusca.join() === 'BM25', b.modelosDeBusca.join());
  checar('todo resultado tem id e ementa', b.resultados.every((r) => r.id && r.ementa), '');

  log('\n== 2. 🔴 `summary` NUNCA sai como ementa ==');
  const r0 = b.resultados[0];
  checar('campo `ementa` e o do tribunal', typeof r0.ementa === 'string' && r0.ementa.length > 50);
  checar('resumo de IA vai em campo separado e rotulado',
    !!r0.ementaArtificialIA && /IA|Artificial/.test(r0.ementaArtificialAviso || ''));
  checar('nao ha campo `summary` cru no resultado', !('summary' in r0));

  log('\n== 3. Filtros provados por CONTAGEM (nao por "respondeu") ==');
  const base = await crawler.buscar({ ano: '2024', maxPages: 1, size: 1 });
  const ac = await crawler.buscar({ ano: '2024', tipo: 'Acórdão', maxPages: 1, size: 1 });
  const inv = await crawler.buscar({ ano: '2024', tipo: 'Bananas', maxPages: 1, size: 1 });
  checar('base do ano e exata', base.total === 4987, `${base.total}`);
  checar('type restringe', ac.total < base.total && ac.total > 0, `${ac.total} de ${base.total}`);
  checar('type inventado ZERA (nao e ignorado)', inv.total === 0, `${inv.total}`);

  const c1 = await crawler.buscar({ ano: '2024', colegiado: 'Primeira Camara', maxPages: 1, size: 1 });
  const c2 = await crawler.buscar({ ano: '2024', colegiado: 'Segunda Camara', maxPages: 1, size: 1 });
  const c3 = await crawler.buscar({ ano: '2024', colegiado: 'Tribunal Pleno', maxPages: 1, size: 1 });
  checar('particao de colegiado FECHA EXATA', c1.total + c2.total + c3.total === base.total,
    `${c1.total} + ${c2.total} + ${c3.total} = ${c1.total + c2.total + c3.total}`);

  log('\n== 4. 🔴 `session` exige o ACENTO — sem ele zera em silencio ==');
  // ⚠️ O escopo importa: "Extraordinária" tem 29 no ACERVO INTEIRO e ZERO em 2024.
  // O mapeamento de 19/08 registrou os 29 sob a base `year=2024` e errou o escopo.
  const sCom = await crawler.buscar({ sessao: 'Extraordinária', maxPages: 1, size: 1 });
  const sSem = await crawler.buscar({ sessao: 'Extraordinaria', maxPages: 1, size: 1 });
  checar('com acento devolve resultados (acervo inteiro)', sCom.total === 29, `${sCom.total}`);
  checar('sem acento devolve ZERO com HTTP 200', sSem.total === 0, `${sSem.total}`);
  const sAdm = await crawler.buscar({ ano: '2024', sessao: 'Extraordinária Administrativa', maxPages: 1, size: 1 });
  const sOrd = await crawler.buscar({ ano: '2024', sessao: 'Ordinaria', maxPages: 1, size: 1 });
  checar('particao de tipo_sessao em 2024 FECHA EXATA', sOrd.total + sAdm.total === base.total,
    `${sOrd.total} + ${sAdm.total} = ${sOrd.total + sAdm.total} contra ${base.total}`);

  log('\n== 5. 🔴 A janela de data so funciona FECHADA ==');
  const jan = await crawler.buscar({ dataInicio: '01/01/2024', dataFim: '31/01/2024', maxPages: 1, size: 1 });
  const ano = await crawler.buscar({ dataInicio: '01/01/2024', dataFim: '31/12/2024', maxPages: 1, size: 1 });
  checar('janela fechada de janeiro restringe', jan.total > 0 && jan.total < 1000, `${jan.total}`);
  checar('janela do ano inteiro = o ano', ano.total === base.total, `${ano.total} contra ${base.total}`);
  const soDi = await crawler.buscar({ dataInicio: '01/01/2024', maxPages: 1, size: 1 });
  checar('ponta -di sozinha e IGNORADA (satura)', soDi.total >= 10000 || soDi.totalNota.includes('agregado'),
    `${soDi.total} / ${soDi.totalNota}`);
  checar('o crawler AVISA sobre a ponta solta',
    TCEGOCrawler.avisos({ dataInicio: '01/01/2024' }).some((a) => /SOZINHO E IGNORADO/.test(a)));

  log('\n== 6. 🔴 O total saturado cai no agregado, que e EXATO ==');
  const sat = await crawler.buscar({ maxPages: 1, size: 1 });
  checar('acervo inteiro vira total exato pelo agregado', sat.totalExato === true && sat.total > 300000,
    `${sat.total} (busca dizia ${sat.totalBruto})`);
  checar('nota explica a troca', /agregado/.test(sat.totalNota || ''), sat.totalNota);

  log('\n== 7. Paginacao — anda e e ESTAVEL ==');
  const p3 = await crawler.buscar({ query: 'aposentadoria', ano: '2024', maxPages: 3, size: 10 });
  checar('3 paginas = 30 documentos', p3.resultados.length === 30, `${p3.resultados.length}`);
  checar('sem repeticao entre paginas', new Set(p3.resultados.map((r) => r.id)).size === 30);
  const p3b = await crawler.buscar({ query: 'aposentadoria', ano: '2024', maxPages: 3, size: 10 });
  checar('mesma sequencia na segunda rodada',
    p3.resultados.map((r) => r.id).join() === p3b.resultados.map((r) => r.id).join());

  log('\n== 8. 🔴 O servidor troca de modelo sozinho, e o crawler expoe isso ==');
  const emb = await crawler.buscar({ query: 'aposentadoria pregao', ano: '2024', maxPages: 1, size: 3 });
  checar('termo de 2 palavras caiu no SEMANTICO', emb.modelosDeBusca.includes('EMBEDDINGS'),
    emb.modelosDeBusca.join());
  checar('e o crawler AVISA que o resultado pode nao conter o termo',
    emb.avisos.some((a) => /EMBEDDINGS|SEMANTICO/i.test(a)));
  checar('avisa sobre operador booleano no termo',
    TCEGOCrawler.avisos({ query: 'aposentadoria AND pregao' }).some((a) => /NAO HA OPERADOR BOOLEANO/.test(a)));
  checar('avisa sobre aspas de uma palavra so',
    TCEGOCrawler.avisos({ query: '"aposentadoria"' }).some((a) => /uma palavra/.test(a)));

  log('\n== 9. Consulta por numero — as duas chaves ==');
  const chk = new TCEGOChecker({ log: () => {} });
  const porProc = await chk.consultarProcesso('201700010015938');
  checar('processo de 15 digitos encontra', porProc.encontrados === 1, `${porProc.encontrados}`);
  checar('permalink do PROCESSO responde', /^https?:\/\//.test(porProc.permalinkProcesso || ''),
    porProc.permalinkProcesso || 'nenhum');
  checar('declara que CNJ nao se aplica', porProc.cnjAplicavel === false);
  const porDec = await chk.consultarProcesso('04119/2024');
  checar('numero de decisao COM ano encontra 1', porDec.encontrados === 1, `${porDec.encontrados}`);
  const semAno = await chk.consultarProcesso('04119');
  checar('numero SEM ano avisa que nao identifica',
    semAno.avisos.some((a) => /SEM ano nao identifica/.test(a)), `${semAno.encontrados} achados`);

  log('\n== 10. Inteiro teor em TEXTO, nos quatro tipos ==');
  for (const t of TCEGOCrawler.TIPOS) {
    const one = await crawler.buscar({ tipo: t, maxPages: 1, size: 1 });
    const doc = one.resultados[0];
    const texto = doc ? await nav.inteiroTeor(doc.id) : null;
    checar(`inteiro teor de "${t}"`, !!texto && texto.length > 500, `${texto ? texto.length : 0} chars`);
  }

  log('\n== 11. --verificar confirma a amostra ==');
  const v = await chk.verificar(b.resultados, 2);
  checar('amostra confirmada', v.confirmados === v.amostra, `${v.confirmados}/${v.amostra}`);

  log(`\n===== ${ok} ok, ${falhou} falhou =====`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
