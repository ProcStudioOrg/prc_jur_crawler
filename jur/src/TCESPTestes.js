/**
 * TCESPTestes — testes de integracao do TCE-SP contra o portal ao vivo.
 * Rode: node src/TCESPTestes.js
 *
 * Cada teste corresponde a uma ressalva MEDIDA em 15/08/2026. Se um deles
 * falhar, o portal mudou — use a skill `fixer` com os prints de
 * human-codegen/TCESP/01-jurisprudencia/.
 */

const TCESPNavigator = require('./TCESPNavigator');
const TCESPCrawler = require('./TCESPCrawler');
const TCESPChecker = require('./TCESPChecker');

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

(async () => {
  const nav = new TCESPNavigator();
  const crawler = new TCESPCrawler({ quiet: true });
  const checker = new TCESPChecker({ quiet: true });

  console.log('\n== 1. Busca basica (GET; POST daria 405) ==');
  const r1 = await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'] });
  checar('busca responde com contador', r1.encontrouContador, `total=${r1.total}`);
  checar('total plausivel (> 500)', r1.total > 500, `total=${r1.total}`);

  console.log('\n== 2. O modelo de QUATRO CAIXAS fecha a aritmetica ==');
  const a = (await nav.pesquisar({ termo: 'merenda' })).total;
  const b = (await nav.pesquisar({ termo: 'escolar' })).total;
  const and = (await nav.pesquisar({ termo: 'merenda escolar' })).total;
  const or = (await nav.pesquisar({ qualquer: 'merenda escolar' })).total;
  const not = (await nav.pesquisar({ termo: 'merenda', excluir: 'escolar' })).total;
  checar('A + B - AND = OR (exato)', a + b - and === or, `${a}+${b}-${and} != ${or}`);
  checar('A - AND = NOT (exato)', a - and === not, `${a}-${and} != ${not}`);
  const frase = (await nav.pesquisar({ frase: 'merenda escolar' })).total;
  checar('frase exata <= AND', frase <= and, `${frase} > ${and}`);

  console.log('\n== 3. Operador inline e armadilha (OU nao une) ==');
  const inlineOu = (await nav.pesquisar({ termo: 'merenda OU escolar' })).total;
  checar('OU inline NAO produz a uniao (continua AND)', inlineOu !== or, `inline=${inlineOu} uniao=${or}`);
  const avisos = [];
  const c2 = new TCESPCrawler({ quiet: true });
  c2.checarQuery('merenda OU escolar');
  checar('o crawler avisa sobre OU inline', c2.avisos.some((x) => /OU/.test(x)), JSON.stringify(c2.avisos));

  console.log('\n== 4. Acento e normalizado (nao avisar sobre acento) ==');
  const semAcento = (await nav.pesquisar({ termo: 'licitacao' })).total;
  const comAcento = (await nav.pesquisar({ termo: 'licitação' })).total;
  checar('licitacao == licitação', semAcento === comAcento, `${semAcento} != ${comAcento}`);

  console.log('\n== 5. Datas: as duas metades funcionam e a aritmetica fecha ==');
  const base = (await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'] })).total;
  const soIni = (await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], dataPubInicio: '01/01/2023' })).total;
  const soFim = (await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], dataPubFim: '31/12/2023' })).total;
  const janela = (await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], dataPubInicio: '01/01/2023', dataPubFim: '31/12/2023' })).total;
  checar('meia janela (so inicio) filtra', soIni > 0 && soIni < base, `${soIni} de ${base}`);
  checar('meia janela (so fim) filtra', soFim > 0 && soFim < base, `${soFim} de ${base}`);
  checar('soIni + soFim - janela = total', soIni + soFim - janela === base, `${soIni}+${soFim}-${janela} != ${base}`);
  const noop = (await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], dataPubInicio: '01/01/1900', dataPubFim: '31/12/2100' })).total;
  checar('janela no-op NAO altera a contagem', noop === base, `${noop} != ${base}`);

  console.log('\n== 6. Data ISO da HTTP 400 (erro honesto), e o Navigator converte ==');
  const isoConvertida = TCESPNavigator.normalizarData('2023-01-01');
  checar('normalizarData converte ISO -> BR', isoConvertida === '01/01/2023', isoConvertida);

  console.log('\n== 7. Filtros mudam a contagem; valor inventado zera ==');
  const comMateria = (await nav.pesquisar({ termo: 'merenda escolar', materia: 'ADITAMENTO' })).total;
  const materiaFake = (await nav.pesquisar({ termo: 'merenda escolar', materia: 'MATERIAXYZ9' })).total;
  checar('materia filtra', comMateria > 0 && comMateria < and, `${comMateria} de ${and}`);
  checar('materia inventada zera', materiaFake === 0, `${materiaFake}`);
  const rel = (await nav.pesquisar({ termo: 'merenda escolar', relator: 'RENATO MARTINS COSTA' })).total;
  checar('relator filtra', rel > 0 && rel < and, `${rel} de ${and}`);

  console.log('\n== 8. Paginacao: 10 fixos, estavel, total exato ==');
  const p0 = await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], offset: 0 });
  const d0 = crawler.extrair(p0.html);
  checar('pagina traz 10 documentos', d0.length === 10, `${d0.length}`);
  const p0b = await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], offset: 0 });
  checar(
    'paginacao estavel (mesma pagina 2x)',
    crawler.extrair(p0b.html).map((x) => x.processo).join() === d0.map((x) => x.processo).join(),
  );
  const ultimo = Math.floor((base - 1) / 10) * 10;
  const pUlt = await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], offset: ultimo });
  const dUlt = crawler.extrair(pUlt.html);
  checar('ultima pagina fecha o total (exato)', ultimo + dUlt.length === base, `${ultimo}+${dUlt.length} != ${base}`);
  const pAlem = await nav.pesquisar({ termo: 'merenda escolar', tipoDocumento: ['acordao'], offset: 99999 });
  checar('offset alem do total devolve 0 linhas sem erro', crawler.extrair(pAlem.html).length === 0);

  console.log('\n== 9. Um julgado decide varios processos (dedup) ==');
  const res = await crawler.search('merenda escolar', { tipoDocumento: ['acordao'] }, { maxPages: 5 });
  const pdfs = new Set(res.resultados.map((x) => x.id));
  checar('ha repeticao de documento entre processos', res.resultados.length < 50, `${res.resultados.length} de 50 linhas`);
  checar('o crawler publica totalDeduplicadoEstimado', res.totalDeduplicadoEstimado > 0, `${res.totalDeduplicadoEstimado}`);
  checar('avisa que o total conta pares processo x documento', res.avisos.some((x) => /varios processos/i.test(x)));

  console.log('\n== 10. O card e TRECHO, nao ementa ==');
  const comTexto = res.resultados.find((x) => x.trechos && x.trechos.length);
  checar('ha trechos extraidos (a <tr> IRMA foi lida)', !!comTexto, 'nenhum trecho');
  checar('todos marcados semEmenta', res.resultados.every((x) => x.semEmenta === true));
  checar('o crawler avisa que nao ha ementa', res.avisos.some((x) => /NAO TEM EMENTA/i.test(x)));

  console.log('\n== 11. Familia editorial: Sumula vem sem metadados ==');
  const su = await nav.pesquisar({ tipoDocumento: ['sumula'] });
  const dsu = crawler.extrair(su.html);
  checar('sumulas existem', su.total > 0, `${su.total}`);
  checar('sumula NAO tem processo (familia editorial)', dsu.length > 0 && !dsu[0].processo, JSON.stringify(dsu[0] || {}).slice(0, 120));
  checar('sumula marcada familia=editorial', dsu.length > 0 && dsu[0].familia === 'editorial');

  console.log('\n== 12. Inteiro teor: PDF publico, sem sessao, magic %PDF ==');
  const comPdf = res.resultados.find((x) => x.inteiroTeorLink);
  checar('ha link de PDF no card', !!comPdf, 'nenhum');
  if (comPdf) {
    const pdf = await nav.baixarPdf(comPdf.inteiroTeorLink);
    checar('PDF baixa em contexto limpo', pdf.ok, `status=${pdf.status} ehPdf=${pdf.ehPdf}`);
    checar('magic number e %PDF (nao PKCS#7 como o TCE-PR)', pdf.ehPdf);
    checar('PDF tem tamanho plausivel (> 20 KB)', pdf.buffer && pdf.buffer.length > 20000, `${pdf.buffer && pdf.buffer.length}`);
  }

  console.log('\n== 13. Consulta por numero exige mascara ==');
  checar('formatar() poe a mascara', TCESPChecker.formatar('168198920') === '1681/989/20', TCESPChecker.formatar('168198920'));
  const c = await checker.porNumero('1681/989/20');
  checar('processo conhecido e encontrado', c.encontrado, JSON.stringify(c).slice(0, 160));
  checar('o detalhe traz o RELATOR (que a busca nao tem)', !!c.relator, `relator=${c.relator}`);
  const cSem = await checker.porNumero('9999999999999');
  checar('numero inventado nao e encontrado', !cSem.encontrado);
  checar('e o zero silencioso vem com aviso', !!cSem.aviso);

  console.log('\n== 14. Zero silencioso: termo inventado nao quebra ==');
  const z = await nav.pesquisar({ termo: 'xkjqzwv9inventado' });
  checar('termo inventado devolve total 0 com HTTP 200', z.total === 0 && !z.encontrouContador);

  console.log(`\n──────── TCE-SP: ${ok} passaram, ${falhou} falharam ────────`);
  if (falhou) {
    console.log('Falhas:', falhas.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
