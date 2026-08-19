// src/TJAPTestes.js
// Testes de integracao do TJAP — Banco de Decisoes e Sentencas.
// Rode: node src/TJAPTestes.js
const TJAPCrawler = require('./TJAPCrawler');
const TJAPChecker = require('./TJAPChecker');
const { TOTAL_TETO, POR_PAGINA } = require('./TJAPNavigator');

const silencio = () => {};
let ok = 0; let falhou = 0;

function checar(nome, condicao, detalhe = '') {
  if (condicao) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

(async () => {
  console.log('TJAP — testes de integracao (rede real)\n');

  console.log('1. Busca simples e forma do documento');
  const c = new TJAPCrawler({ log: silencio, includeFullText: true });
  const r = await c.search('usucapião', {}, { maxPages: 2 });
  checar('a busca devolve resultados', r.length > 0, `veio ${r.length}`);
  checar('total exato (nao saturado) para "usucapião"', r.totalResults > 0 && r.totalResults < TOTAL_TETO, `total ${r.totalResults}`);
  checar('pagina traz 10 documentos', r.length + (c.ultimaBusca.duplicadosDescartados) === 2 * POR_PAGINA,
    `${r.length} + ${c.ultimaBusca.duplicadosDescartados} dup`);
  const d = r.find((x) => !x.sigiloso);
  checar('ha documento nao-sigiloso com texto util', !!d && d.tamanhoTexto > 500, d ? `${d.tamanhoTexto} chars` : 'nenhum');
  checar('permalink no formato /reader/<sistema>/<id>?tipo=', /\/reader\/(PJE|TUCUJURIS)\/\d+\?tipo=banco-(sentenca|decisao)$/.test(d.processoUrl), d && d.processoUrl);
  checar('declara que NAO ha ementa', d.semEmenta === true && d.ementa === '');
  checar('declara 1o grau e UF AP', d.grau === 1 && d.uf === 'AP');
  checar('so ha data de juntada', !!d.dataJuntada && d.dataJulgamento === null && d.dataPublicacao === null);

  console.log('\n2. Acento nao e normalizado (o zero silencioso que vale 1)');
  const semAcento = await new TJAPCrawler({ log: silencio }).search('usucapiao', {}, { maxPages: 1 });
  checar('"usucapiao" devolve pouquissimo perto de "usucapião"', semAcento.totalResults < r.totalResults / 100,
    `${semAcento.totalResults} vs ${r.totalResults}`);

  console.log('\n3. O filtro de tipo restringe DE FATO (particao fecha exata)');
  const cs = new TJAPCrawler({ log: silencio });
  const sent = await cs.search('usucapião', { tipo: 'sentenca' }, { maxPages: 1 });
  const dec = await cs.search('usucapião', { tipo: 'decisao' }, { maxPages: 1 });
  checar('sentenca + decisao = total', sent.totalResults + dec.totalResults === r.totalResults,
    `${sent.totalResults} + ${dec.totalResults} != ${r.totalResults}`);
  checar('cada metade e menor que o total', sent.totalResults < r.totalResults && dec.totalResults < r.totalResults);

  console.log('\n4. O filtro de sistema restringe DE FATO');
  const pje = await cs.search('usucapião', { sistema: 'pje' }, { maxPages: 1 });
  const tuc = await cs.search('usucapião', { sistema: 'tucujuris' }, { maxPages: 1 });
  checar('PJE + TUCUJURIS = total', pje.totalResults + tuc.totalResults === r.totalResults,
    `${pje.totalResults} + ${tuc.totalResults} != ${r.totalResults}`);

  console.log('\n5. O filtro de data restringe DE FATO');
  const comData = await cs.search('usucapião', { dataInicio: '01/01/2020', dataFim: '31/12/2020' }, { maxPages: 1 });
  checar('janela de 2020 restringe', comData.totalResults > 0 && comData.totalResults < r.totalResults,
    `${comData.totalResults} vs ${r.totalResults}`);
  const porAno = await cs.search('usucapião', { anos: [2020] }, { maxPages: 1 });
  checar('--ano 2020 bate com a janela de data', porAno.totalResults === comData.totalResults,
    `${porAno.totalResults} vs ${comData.totalResults}`);

  console.log('\n6. O espaco e OR — a armadilha principal');
  const so = await cs.search('enfiteuse', {}, { maxPages: 1 });
  const dois = await cs.search('usucapião enfiteuse', {}, { maxPages: 1 });
  checar('dois termos = a UNIAO dos dois (nao a intersecao)',
    dois.totalResults === r.totalResults + so.totalResults,
    `${dois.totalResults} != ${r.totalResults} + ${so.totalResults}`);
  const comLixo = await cs.search('usucapião zzqxwjqq', {}, { maxPages: 1 });
  checar('termo inexistente NAO zera a busca (prova do OR)', comLixo.totalResults === r.totalResults,
    `${comLixo.totalResults} vs ${r.totalResults}`);

  console.log('\n7. --frase e frase ORDENADA (o unico AND que existe)');
  const frase = await cs.search('', { frase: 'usucapião extraordinária' }, { maxPages: 1 });
  const inversa = await cs.search('', { frase: 'extraordinária usucapião' }, { maxPages: 1 });
  checar('a frase restringe muito', frase.totalResults > 0 && frase.totalResults < r.totalResults, `${frase.totalResults}`);
  checar('a ordem importa (logo e frase, nao AND)', inversa.totalResults === 0, `invertida deu ${inversa.totalResults}`);

  console.log('\n8. Deduplicacao PJe x Tucujuris');
  const cd = new TJAPCrawler({ log: silencio });
  const amostra = await cd.search('usucapião', {}, { maxPages: 8 });
  const ids = new Set(amostra.map((x) => x.id));
  checar('nenhum id repetido na saida', ids.size === amostra.length);
  const chaves = new Set(amostra.map((x) => `${x.processo}§${x.tipoDocumento}§${x.orgaoJulgador}`));
  checar('nenhum (processo,tipo,orgao) repetido — a copia foi removida', chaves.size === amostra.length,
    `${chaves.size} chaves para ${amostra.length} documentos`);
  checar('a duplicacao existe e foi contada', cd.ultimaBusca.duplicadosDescartados > 0,
    `descartados ${cd.ultimaBusca.duplicadosDescartados}`);

  console.log('\n9. Saturacao em 10.000 — e o crawler declara');
  const sat = await new TJAPCrawler({ log: silencio }).search('dano moral', {}, { maxPages: 1 });
  checar('"dano moral" satura no teto', sat.totalResults === TOTAL_TETO, `${sat.totalResults}`);
  const cSat = new TJAPCrawler({ log: silencio });
  await cSat.search('a', {}, { maxPages: 1 });
  checar('o crawler marca totalSaturado', cSat.ultimaBusca.totalSaturado === true);

  console.log('\n10. Consulta por numero e permalink');
  const ck = new TJAPChecker({ log: silencio });
  const comMascara = await ck.consultarProcesso('0001783-98.2002.8.03.0001');
  checar('acha o processo conhecido', comMascara.encontrado, JSON.stringify(comMascara.documentos.length));
  checar('todos os documentos sao do processo pedido',
    comMascara.documentos.every((x) => x.numeroProcesso === '0001783-98.2002.8.03.0001'));
  const inventado = await ck.consultarProcesso('9999999-99.2099.8.03.9999');
  checar('numero inventado NAO e encontrado', inventado.encontrado === false);
  checar('e o crawler avisa que o escopo e 1o grau', !!inventado.avisoEscopo);
  const doc = await ck.navigator.abrirDocumento(comMascara.documentos[0].processoUrl);
  checar('o permalink abre em contexto limpo', doc.encontrado === true, `status ${doc.status}`);
  const semTipo = await ck.navigator.abrirDocumento(comMascara.documentos[0].processoUrl.split('?')[0]);
  checar('sem o ?tipo= o permalink NAO abre (HTTP 200 mentindo)',
    semTipo.status === 200 && semTipo.encontrado === false, `status ${semTipo.status}, encontrado ${semTipo.encontrado}`);

  console.log('\n11. DataJud (segunda fonte, so metadados)');
  const dj = await ck.consultarDataJud('0001041-58.2016.8.03.0009');
  checar('DataJud responde para o TJAP', dj.encontrado === true);
  checar('DataJud nao tem inteiro teor (declarado)', dj.temInteiroTeor === false);

  console.log('\n12. Combos vem do snapshot da home');
  const combos = await new TJAPCrawler({ log: silencio }).listarFiltros();
  checar('lista os 5 combos', combos.length === 5 && combos.includes('magistrados'), combos.join(','));
  const mags = await new TJAPCrawler({ log: silencio }).listarFiltros('magistrados');
  checar('magistrados tem ~130 opcoes', mags.length > 100, `${mags.length}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${ok} ok, ${falhou} falhou`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
