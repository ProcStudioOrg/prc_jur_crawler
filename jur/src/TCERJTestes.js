/**
 * TCERJTestes — testes de integracao do TCE-RJ contra o portal ao vivo.
 * Rode: node src/TCERJTestes.js
 *
 * Cada teste corresponde a uma ressalva MEDIDA em 16/08/2026. Se um deles
 * falhar, o portal mudou — use a skill `fixer` com os prints de
 * human-codegen/TCERJ/01-portal-jurisprudencia/.
 */

const TCERJNavigator = require('./TCERJNavigator');
const TCERJCrawler = require('./TCERJCrawler');
const TCERJChecker = require('./TCERJChecker');

let ok = 0;
let falhou = 0;
const falhas = [];

function checar(nome, condicao, detalhe = '') {
  if (condicao) {
    ok++;
    console.log(`  ✅ ${nome}`);
  } else {
    falhou++;
    falhas.push(nome);
    console.log(`  ❌ ${nome} ${detalhe}`);
  }
}

const total = async (nav, filtro) => (await nav.pesquisar(filtro, 1, 1)).totalResults;

(async () => {
  const nav = new TCERJNavigator();
  const mudo = () => {};

  console.log('\n== 1. Busca basica e acervo ==');
  const acervo = await total(nav, {});
  checar('acervo responde e e pequeno/curado (500..5000)', acervo > 500 && acervo < 5000, `acervo=${acervo}`);
  const lic = await total(nav, { texto: 'licitação' });
  checar('busca por termo responde', lic > 0, `licitação=${lic}`);
  checar('termo < acervo (o filtro de texto filtra)', lic < acervo, `${lic} >= ${acervo}`);

  console.log('\n== 2. 🔴 ACENTO E OBRIGATORIO — o indice NAO normaliza ==');
  const semAcento = await total(nav, { texto: 'licitacao' });
  checar('licitacao (sem acento) devolve 0', semAcento === 0, `semAcento=${semAcento}`);

  console.log('\n== 3. Operadores: E/OU funcionam com aritmetica exata ==');
  const pes = await total(nav, { texto: 'pessoal' });
  const espaco = await total(nav, { texto: 'licitação pessoal' });
  const opE = await total(nav, { texto: 'licitação E pessoal' });
  const opOu = await total(nav, { texto: 'licitação OU pessoal' });
  checar('espaco = E (AND)', espaco === opE, `espaco=${espaco} E=${opE}`);
  checar('OU fecha a aritmetica (A + B - AND = OR)', lic + pes - opE === opOu, `${lic}+${pes}-${opE} != ${opOu}`);

  console.log('\n== 4. 🔴 "NAO" NAO EXCLUI: vira palavra e DEFLACIONA ==');
  const naoInexistente = await total(nav, { texto: 'licitação NÃO zzzinexistente' });
  checar('licitação NÃO <inexistente> = 0 (exclusao daria o total do termo)', naoInexistente === 0, `=${naoInexistente}, termo=${lic}`);
  const naoPessoal = await total(nav, { texto: 'licitação NÃO pessoal' });
  checar('licitação NÃO pessoal < AND (deflaciona, nao exclui)', naoPessoal < opE, `NAO=${naoPessoal} AND=${opE}`);

  console.log('\n== 5. 🔴 "AND"/"OR" derrubam a busca com HTTP 500 ==');
  let erroAnd = null;
  try { await total(nav, { texto: 'licitação AND pessoal' }); } catch (e) { erroAnd = e.message; }
  checar('AND devolve HTTP 500 (erro visivel, nao zero calado)', !!erroAnd && /500/.test(erroAnd), `erro=${erroAnd}`);

  console.log('\n== 6. 🔴 O campo de relator e `conselheiro`; `relator` e IGNORADO ==');
  const nome = 'Marianna Montebello Willeman';
  const porConselheiro = await total(nav, { conselheiro: nome });
  const porRelator = await total(nav, { relator: nome });
  const porRelatorInventado = await total(nav, { relator: 'ZZZ INEXISTENTE' });
  checar('conselheiro FILTRA', porConselheiro > 0 && porConselheiro < acervo, `=${porConselheiro}`);
  checar('relator e IGNORADO (= acervo)', porRelator === acervo, `relator=${porRelator} acervo=${acervo}`);
  checar('relator inventado tambem = acervo (prova de ignorado)', porRelatorInventado === acervo, `=${porRelatorInventado}`);

  console.log('\n== 7. macroTemaId filtra; valor inventado zera (sintoma visivel) ==');
  const mt3 = await total(nav, { macroTemaId: '3' });
  const mtX = await total(nav, { macroTemaId: '999' });
  checar('macroTemaId=3 filtra', mt3 > 0 && mt3 < acervo, `=${mt3}`);
  checar('macroTemaId inventado devolve 0', mtX === 0, `=${mtX}`);

  console.log('\n== 8. Datas: as DUAS pontas funcionam sozinhas e o no-op nao altera ==');
  const soIni = await total(nav, { dataInicio: '2025-01-01T03:00:00.000Z' });
  const soFim = await total(nav, { dataFim: '2025-12-31T03:00:00.000Z' });
  const noop = await total(nav, { dataInicio: '1900-01-01T03:00:00.000Z', dataFim: '2100-12-31T03:00:00.000Z' });
  checar('so dataInicio filtra (nao e ignorada)', soIni > 0 && soIni < acervo, `=${soIni}`);
  checar('so dataFim filtra (nao e ignorada)', soFim > 0 && soFim < acervo, `=${soFim}`);
  checar('janela no-op devolve o acervo inteiro', noop === acervo, `noop=${noop} acervo=${acervo}`);

  console.log('\n== 9. Paginacao: total exato, estavel, e sem teto de tamanhoPagina ==');
  const p1 = await nav.pesquisar({ texto: 'licitação' }, 2, 10);
  const p2 = await nav.pesquisar({ texto: 'licitação' }, 2, 10);
  const ids1 = p1.list.map((x) => x.jurisprudenciaId).join(',');
  const ids2 = p2.list.map((x) => x.jurisprudenciaId).join(',');
  checar('mesma pagina 2x devolve os mesmos ids (estavel)', ids1 === ids2, `${ids1} != ${ids2}`);
  const inteiro = await nav.pesquisar({}, 1, acervo);
  checar('o acervo inteiro cabe numa requisicao (sem teto)', (inteiro.list || []).length === acervo, `veio=${(inteiro.list || []).length}`);
  const alem = await nav.pesquisar({ texto: 'licitação' }, 999, 10);
  checar('pagina alem do fim devolve lista vazia, sem erro', (alem.list || []).length === 0, `veio=${(alem.list || []).length}`);

  console.log('\n== 10. ✅ Permalink publico: PDF de verdade, sem cookie ==');
  const amostra = (await nav.pesquisar({ texto: 'licitação' }, 1, 1)).list[0];
  const pdf = await nav.baixarPdf(amostra.numeroAcordao, amostra.anoAcordao);
  checar('PDF do acordao responde 200', pdf.ok && pdf.status === 200, `status=${pdf.status}`);
  checar('e PDF de verdade (%PDF) — aqui o magic number VALE', !!pdf.ehPdf, 'nao comeca com %PDF');
  checar('PDF tem tamanho plausivel (> 50 KB)', pdf.buffer && pdf.buffer.length > 50000, `bytes=${pdf.buffer ? pdf.buffer.length : 0}`);
  const inventado = await nav.baixarPdf('999999', '2026');
  checar('acordao inventado devolve 404 (sem casca de 200)', !inventado.ok && inventado.status === 404, `status=${inventado.status}`);

  console.log('\n== 11. A ementa ja vem na busca, integra, em 100% dos documentos ==');
  const lote = (await nav.pesquisar({}, 1, 50)).list;
  const comEmenta = lote.filter((x) => (x.dispositivoCompleto || '').trim()).length;
  checar('50/50 com dispositivoCompleto (ementa)', comEmenta === lote.length, `${comEmenta}/${lote.length}`);
  checar('dispositivoCompleto >= dispositivo (traz a verbetacao)',
    lote.every((x) => (x.dispositivoCompleto || '').length >= (x.dispositivo || '').length), '');

  console.log('\n== 12. Checker: recorte no cliente (nao ha filtro por numero na API) ==');
  const chk = new TCERJChecker({ log: mudo });
  const achado = await chk.consultarProcesso(amostra.numeroProcesso);
  checar('processo conhecido e encontrado', achado.encontrado, JSON.stringify(achado).slice(0, 160));
  const naoAchado = await chk.consultarProcesso('999.999-9/1999');
  checar('processo inventado NAO e encontrado', !naoAchado.encontrado, '');
  checar('a negativa vem com a ressalva da base curada', !!naoAchado.ressalva, '');

  console.log('\n== 13. Crawler: mapeamento e avisos ==');
  const crawler = new TCERJCrawler({ log: mudo, porPagina: 5 });
  const res = await crawler.search('licitação', {}, { maxPages: 1 });
  checar('crawler devolve resultados mapeados', res.length === 5, `len=${res.length}`);
  checar('todo resultado tem id, ementa e link de inteiro teor',
    res.every((r) => r.id && r.ementa && r.inteiroTeorLink), '');
  checar('totalResults exato bate com a API', res.totalResults === lic, `${res.totalResults} != ${lic}`);
  const c2 = new TCERJCrawler({ log: mudo });
  c2.checarQuery('licitação NÃO pessoal');
  checar('o crawler avisa que NAO nao exclui', c2._avisos.some((a) => /NAO exclui/.test(a)), JSON.stringify(c2._avisos));
  const c3 = new TCERJCrawler({ log: mudo });
  c3.checarQuery('licitação AND pessoal');
  checar('o crawler avisa que AND derruba com 500', c3._avisos.some((a) => /500/.test(a)), JSON.stringify(c3._avisos));
  const c4 = new TCERJCrawler({ log: mudo });
  c4.montarFiltro('x', { relator: 'Fulano' });
  checar('o crawler avisa para usar --conselheiro', c4._avisos.some((a) => /conselheiro/.test(a)), JSON.stringify(c4._avisos));

  console.log('\n== 14. Base CORRENTE (passo obrigatorio desde o TJAM) ==');
  const todos = (await nav.pesquisar({}, 1, acervo)).list;
  const datas = todos.map((x) => x.dataDoVoto).filter(Boolean).sort();
  const anoRecente = Number(datas[datas.length - 1].slice(0, 4));
  checar('ha documento de 2026 ou depois (base nao congelou)', anoRecente >= 2026, `mais recente=${datas[datas.length - 1]}`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${ok} ok, ${falhou} falhou`);
  if (falhou) console.log('Falhas: ' + falhas.join(' | '));
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('ERRO FATAL:', e.message);
  process.exit(1);
});
