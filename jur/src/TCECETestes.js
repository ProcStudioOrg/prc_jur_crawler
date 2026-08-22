// src/TCECETestes.js
// Integracao do TCE-CE (Contexto). Rode: node src/TCECETestes.js
const TCECENavigator = require('./TCECENavigator');
const TCECECrawler = require('./TCECECrawler');
const TCECEChecker = require('./TCECEChecker');

const log = console.log.bind(console);
const nav = new TCECENavigator({ log: () => {} });
const crawler = new TCECECrawler({ log: () => {}, nav });

let ok = 0;
let falhou = 0;
function checar(nome, cond, detalhe = '') {
  if (cond) { ok++; log(`  ✅ ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
  else { falhou++; log(`  ❌ ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
}

(async () => {
  log('\n== 1. Busca simples (default = so "Documentos de Decisão") ==');
  const b = await crawler.buscar({ query: 'nepotismo', maxPages: 1 });
  checar('devolve resultados', b.resultados.length === 10, `${b.resultados.length} de ${b.total}`);
  checar('total exato abaixo do teto', b.totalExato === true, `total ${b.total}`);
  checar('so tipos de decisao', b.resultados.every((r) => TCECECrawler.TIPOS_DECISAO.some((t) => t.descricao === r.tipo)),
    [...new Set(b.resultados.map((r) => r.tipo))].join(', '));

  log('\n== 2. O filtro "Documentos de Decisão" restringe de verdade ==');
  const cru = await crawler.buscar({ query: 'nepotismo', todosDocumentos: true, maxPages: 1 });
  checar('acervo cru e MUITO maior', cru.total > b.total * 5, `${cru.total} cru contra ${b.total} de decisao`);

  log('\n== 3. Filtros provados por CONTAGEM (nao por "respondeu") ==');
  const so4 = await crawler.buscar({ query: 'nepotismo', tipo: '4', maxPages: 1 });
  checar('idtipodocumento 4 (ACÓRDÃO) restringe', so4.total < b.total && so4.total > 0, `${so4.total}`);
  const inval = await crawler.buscar({ query: 'nepotismo', tipo: '999999', maxPages: 1 });
  checar('id invalido ZERA (nao e ignorado)', inval.total === 0, `${inval.total}`);
  const forta = await crawler.buscar({ query: 'nepotismo', localidade: '60', todosDocumentos: true, maxPages: 1 });
  checar('idlocalidade 60 (FORTALEZA) restringe', forta.total < cru.total && forta.total > 0, `${forta.total}`);

  log('\n== 4. Data de GERACAO do documento — as duas pontas ==');
  const d24 = await crawler.buscar({ query: 'nepotismo', todosDocumentos: true, dataInicio: '01/01/2024', dataFim: '31/12/2024', maxPages: 1 });
  checar('janela 2024 restringe', d24.total < cru.total && d24.total > 0, `${d24.total} de ${cru.total}`);
  const soGte = await crawler.buscar({ query: 'nepotismo', todosDocumentos: true, dataInicio: '01/01/2024', maxPages: 1 });
  const soLte = await crawler.buscar({ query: 'nepotismo', todosDocumentos: true, dataFim: '31/12/2024', maxPages: 1 });
  checar('ponta -di sozinha funciona', soGte.total > 0 && soGte.total < cru.total, `${soGte.total}`);
  checar('ponta -df sozinha funciona', soLte.total > 0 && soLte.total < cru.total, `${soLte.total}`);
  checar('as duas pontas somam mais que a janela', soGte.total + soLte.total > d24.total);

  log('\n== 5. Paginacao por search_after — anda e e ESTAVEL ==');
  const p3 = await crawler.buscar({ query: 'nepotismo', maxPages: 3 });
  checar('3 paginas = 30 documentos', p3.resultados.length === 30, `${p3.resultados.length}`);
  checar('sem repeticao entre paginas', new Set(p3.resultados.map((r) => r.id)).size === p3.resultados.length);
  const p3b = await crawler.buscar({ query: 'nepotismo', maxPages: 3 });
  checar('mesma busca duas vezes = mesmos ids na mesma ordem',
    JSON.stringify(p3.resultados.map((r) => r.id)) === JSON.stringify(p3b.resultados.map((r) => r.id)));

  log('\n== 6. palavraExata desliga o stemming (o unico controle de texto que funciona) ==');
  const stem = await crawler.buscar({ query: 'nepotismos', maxPages: 1 });
  const exato = await crawler.buscar({ query: 'nepotismos', palavraExata: true, maxPages: 1 });
  checar('palavraExata restringe de verdade', exato.total < stem.total, `${stem.total} -> ${exato.total}`);

  log('\n== 7. Os filtros MORTOS do contrato continuam mortos (regressao) ==');
  for (const [campo, clausula] of [
    ['dtsessao', { exists: { field: 'dtsessao' } }],
    ['esferajulgamento', { exists: { field: 'esferajulgamento' } }],
    ['idmembrorelator', { terms: { idmembrorelator: ['1232'] } }],
    ['tpespeciecategoria', { terms: { tpespeciecategoria: ['1'] } }],
  ]) {
    const r = await nav.buscarPagina({ texto: 'nepotismo', filtros: [clausula] });
    checar(`${campo} continua morto (0)`, r.total === 0, `${r.total}`);
  }

  log('\n== 8. Acento e removido, nao so normalizado ==');
  const semAcento = await crawler.buscar({ query: 'servidao', todosDocumentos: true, maxPages: 1 });
  const comAcentoErrado = await crawler.buscar({ query: 'servidão', todosDocumentos: true, maxPages: 1 });
  checar('grafias diferentes = mesma contagem', semAcento.total === comAcentoErrado.total, `${semAcento.total}`);

  log('\n== 9. Erro do servidor dentro do envelope HTTP 200 vira ERRO, nao "zero" ==');
  let levantou = false;
  try {
    await nav.buscarPagina({ texto: 'nepotismo', filtros: [{ range: { dtfinalizado: { gte: '01/01/2024' } } }] });
  } catch (e) { levantou = /400 Bad Request|erro no envelope/i.test(e.message); }
  checar('data DD/MM/YYYY sem `format` levanta erro', levantou);

  log('\n== 10. Acervo publicado e data de carga ==');
  const acervo = await nav.totalAcervo();
  const carga = await nav.dataCarga();
  checar('total-documentos responde', Number.isInteger(acervo) && acervo > 1e6, `${acervo}`);
  checar('data-carga responde', !!carga, String(carga));

  log('\n== 11. Consulta por numero de processo + PDF ==');
  const chk = new TCECEChecker({ log: () => {} });
  const proc = await chk.consultarProcesso('23945/2022-6');
  checar('processo conhecido e encontrado', proc.encontrados > 0, `${proc.encontrados} documentos`);
  const semDigito = await chk.consultarProcesso('23945/2022');
  checar('sem digito verificador ZERA (term exato)', semDigito.encontrados === 0);
  const ver = await chk.verificar(b.resultados, 2);
  checar('amostra confirmada por reconsulta + PDF', ver.confirmados === ver.amostra,
    `${ver.confirmados}/${ver.amostra}`);
  checar('o PDF publico abre e tem bytes', ver.itens.every((i) => i.pdfBytes > 10000),
    ver.itens.map((i) => i.pdfBytes).join(', '));

  log('\n== 12. O `conteudo` da busca NAO substitui o PDF ==');
  const ac = await crawler.buscar({ query: 'nepotismo', tipo: '4', maxPages: 1 });
  const curtos = ac.resultados.filter((r) => !r.inteiroTeorCompleto).length;
  checar('ha acordao com `conteudo` truncado', curtos > 0,
    `${curtos} de ${ac.resultados.length} com menos de 5.000 chars`);

  log(`\n=== TCE-CE: ${ok} ok, ${falhou} falha(s) ===`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
