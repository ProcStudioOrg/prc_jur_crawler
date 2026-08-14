/**
 * Testes de integracao do TCE-SC — `node src/TCESCTestes.js`.
 * Cada teste corresponde a uma medicao do mapeamento; se um quebrar, a
 * ressalva correspondente do CLAUDE-TCESC.md deixou de valer.
 */

const TCESCCrawler = require('./TCESCCrawler');
const TCESCChecker = require('./TCESCChecker');
const TCESCNavigator = require('./TCESCNavigator');
const TCESCCojur = require('./TCESCCojur');

const nulo = () => {};
let ok = 0; let fail = 0;

async function t(nome, fn) {
  try {
    const r = await fn();
    if (r === true) { console.log(`  ✅ ${nome}`); ok++; }
    else { console.log(`  ❌ ${nome} — ${r}`); fail++; }
  } catch (e) {
    console.log(`  ❌ ${nome} — EXCECAO: ${e.message}`);
    fail++;
  }
}

(async () => {
  console.log('='.repeat(66));
  console.log('TCE-SC — testes de integracao (GraphQL publico, sem captcha)');
  console.log('='.repeat(66));

  const nav = new TCESCNavigator({ log: nulo });

  await t('busca simples devolve resultados e total', async () => {
    const c = new TCESCCrawler({ log: nulo, porPagina: 5 });
    const r = await c.search('licitação', {}, { maxPages: 1 });
    return (r.length > 0 && r.totalResults > 1000) || `len=${r.length} total=${r.totalResults}`;
  });

  await t('acento e NORMALIZADO (licitacao == licitação)', async () => {
    const a = await nav.pesquisar({ textoBusca: 'licitacao', tamanhoPagina: 1 });
    const b = await nav.pesquisar({ textoBusca: 'licitação', tamanhoPagina: 1 });
    return a.totalResultados === b.totalResultados || `${a.totalResultados} != ${b.totalResultados}`;
  });

  await t('ESPACO e OR (uniao), nao AND', async () => {
    const m = await nav.pesquisar({ textoBusca: 'merenda', tamanhoPagina: 1 });
    const e = await nav.pesquisar({ textoBusca: 'escolar', tamanhoPagina: 1 });
    const u = await nav.pesquisar({ textoBusca: 'merenda escolar', tamanhoPagina: 1 });
    // uniao: max(a,b) <= total <= a+b   (AND daria <= min(a,b))
    const maior = Math.max(m.totalResultados, e.totalResultados);
    return (u.totalResultados >= maior && u.totalResultados <= m.totalResultados + e.totalResultados)
      || `merenda=${m.totalResultados} escolar=${e.totalResultados} uniao=${u.totalResultados}`;
  });

  await t('frase exata entre aspas RESTRINGE de verdade', async () => {
    const semAspas = await nav.pesquisar({ textoBusca: 'merenda escolar', tamanhoPagina: 1 });
    const comAspas = await nav.pesquisar({ textoBusca: '"merenda escolar"', tamanhoPagina: 1 });
    return comAspas.totalResultados < semAspas.totalResultados
      || `aspas=${comAspas.totalResultados} sem=${semAspas.totalResultados}`;
  });

  await t('curinga NAO existe (licita* == licita)', async () => {
    const a = await nav.pesquisar({ textoBusca: 'licita', tamanhoPagina: 1 });
    const b = await nav.pesquisar({ textoBusca: 'licita*', tamanhoPagina: 1 });
    return a.totalResultados === b.totalResultados || `licita=${a.totalResultados} licita*=${b.totalResultados}`;
  });

  await t('termo <3 chars e IGNORADO e devolve o acervo inteiro', async () => {
    const base = await nav.pesquisar({ tamanhoPagina: 1 });
    const curto = await nav.pesquisar({ textoBusca: 'ab', tamanhoPagina: 1 });
    return curto.totalResultados === base.totalResultados
      || `base=${base.totalResultados} 'ab'=${curto.totalResultados}`;
  });

  await t('termo inventado devolve ZERO de verdade', async () => {
    const r = await nav.pesquisar({ textoBusca: 'zzqx9plimwrt', tamanhoPagina: 1 });
    return r.totalResultados === 0 || `total=${r.totalResultados}`;
  });

  await t('filtro de data de AUTUACAO restringe (e cobre 100%)', async () => {
    const semF = await nav.pesquisar({ textoBusca: 'licitação', tamanhoPagina: 1 });
    const comF = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoInicio: '2024-01-01', dataAutuacaoFim: '2024-12-31', tamanhoPagina: 1 });
    const ini = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoInicio: '2024-01-01', tamanhoPagina: 1 });
    const fim = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoFim: '2024-12-31', tamanhoPagina: 1 });
    if (!(comF.totalResultados > 0 && comF.totalResultados < semF.totalResultados)) {
      return `sem=${semF.totalResultados} com=${comF.totalResultados}`;
    }
    // autuacao e a unica data presente em 100%: inicio + fim - intersecao == total
    const soma = ini.totalResultados + fim.totalResultados - comF.totalResultados;
    return soma === semF.totalResultados || `aritmetica: ${soma} != ${semF.totalResultados}`;
  });

  await t('as DUAS pontas da data funcionam sozinhas', async () => {
    const semF = await nav.pesquisar({ textoBusca: 'licitação', tamanhoPagina: 1 });
    const ini = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoInicio: '2024-01-01', tamanhoPagina: 1 });
    const fim = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoFim: '2024-12-31', tamanhoPagina: 1 });
    return (ini.totalResultados > 0 && ini.totalResultados < semF.totalResultados
         && fim.totalResultados > 0 && fim.totalResultados < semF.totalResultados)
      || `ini=${ini.totalResultados} fim=${fim.totalResultados} base=${semF.totalResultados}`;
  });

  await t('data de SESSAO cobre bem MENOS que autuacao (ressalva do doc)', async () => {
    const aut = await nav.pesquisar({ textoBusca: 'licitação', dataAutuacaoInicio: '1900-01-01', dataAutuacaoFim: '2100-01-01', tamanhoPagina: 1 });
    const ses = await nav.pesquisar({ textoBusca: 'licitação', dataSessaoInicio: '1900-01-01', dataSessaoFim: '2100-01-01', tamanhoPagina: 1 });
    return ses.totalResultados < aut.totalResultados
      || `sessao=${ses.totalResultados} autuacao=${aut.totalResultados}`;
  });

  await t('decisaoSingular NAO particiona (true+false < total)', async () => {
    const base = await nav.pesquisar({ tamanhoPagina: 1 });
    const vt = await nav.pesquisar({ decisaoSingular: true, tamanhoPagina: 1 });
    const vf = await nav.pesquisar({ decisaoSingular: false, tamanhoPagina: 1 });
    return vt.totalResultados + vf.totalResultados < base.totalResultados
      || `true=${vt.totalResultados} false=${vf.totalResultados} base=${base.totalResultados}`;
  });

  await t('abrangencia EMENTA restringe frente a INTEIRO_TEOR', async () => {
    const it = await nav.pesquisar({ textoBusca: 'licitação', abrangencia: 'INTEIRO_TEOR', tamanhoPagina: 1 });
    const em = await nav.pesquisar({ textoBusca: 'licitação', abrangencia: 'EMENTA', tamanhoPagina: 1 });
    return em.totalResultados < it.totalResultados || `ementa=${em.totalResultados} it=${it.totalResultados}`;
  });

  await t('paginacao anda e e ESTAVEL (mesma pagina 2x = mesmos ids)', async () => {
    const f = { textoBusca: 'licitação', ordenacao: 'MAIS_RECENTES', tamanhoPagina: 5 };
    const p0 = await nav.pesquisar({ ...f, pagina: 0 });
    const p1a = await nav.pesquisar({ ...f, pagina: 1 });
    const p1b = await nav.pesquisar({ ...f, pagina: 1 });
    const ids = (r) => r.resultados.map((x) => x.numeroProcesso).join(',');
    if (ids(p1a) !== ids(p1b)) return 'paginacao INSTAVEL entre duas leituras da pagina 2';
    if (ids(p0) === ids(p1a)) return 'pagina 2 repetiu a pagina 1';
    return true;
  });

  await t('consulta por numero encontra processo conhecido', async () => {
    const c = new TCESCChecker({ log: nulo });
    const r = await c.consultarProcesso('2600137305');
    return r.encontrado === true || JSON.stringify(r).slice(0, 160);
  });

  await t('consulta por numero aceita o formato do CARD (REP 26/00137305)', async () => {
    const c = new TCESCChecker({ log: nulo });
    const r = await c.consultarProcesso('REP 26/00137305');
    return r.encontrado === true || JSON.stringify(r).slice(0, 160);
  });

  await t('numero inventado NAO e encontrado', async () => {
    const c = new TCESCChecker({ log: nulo });
    const r = await c.consultarProcesso('9999999999');
    return r.encontrado === false || 'numero inventado foi dado como encontrado';
  });

  await t('linkPublico e PDF de verdade em requisicao LIMPA', async () => {
    const r = await nav.pesquisar({ textoBusca: 'licitação', ordenacao: 'MAIS_RECENTES', tamanhoPagina: 3 });
    const doc = r.resultados.map((x) => x.documentos && x.documentos[0]).find((d) => d && d.linkPublico);
    if (!doc) return 'nenhum resultado trouxe linkPublico';
    const pdf = await nav.baixarPdf(doc.linkPublico);
    return (pdf.ok && pdf.ehPdf && pdf.buffer.length > 5000)
      || `status=${pdf.status} ehPdf=${pdf.ehPdf} bytes=${pdf.buffer ? pdf.buffer.length : 0}`;
  });

  await t('crawler marca semEmenta quando ementa vem null', async () => {
    const c = new TCESCCrawler({ log: nulo, porPagina: 5 });
    const r = await c.search('licitação', { ordenacao: 'recentes' }, { maxPages: 1 });
    return r.some((x) => x.semEmenta && x.trechoMatch)
      || 'nenhum documento com semEmenta+trechoMatch — a ressalva mudou?';
  });

  await t('combos (tipos de processo e relatores) vem do servidor', async () => {
    const d = await nav.combos();
    return (d.processosTipos.tiposProcesso.length > 10 && d.relator.usuarios.length > 5)
      || `tipos=${d.processosTipos.tiposProcesso.length} relatores=${d.relator.usuarios.length}`;
  });

  await t('base CORRENTE (documento dos ultimos 120 dias)', async () => {
    const r = await nav.pesquisar({ ordenacao: 'MAIS_RECENTES', tamanhoPagina: 5 });
    const datas = r.resultados.map((x) => x.dataDecisao).filter(Boolean);
    if (!datas.length) return 'nenhuma dataDecisao no topo de MAIS_RECENTES';
    const [d, m, y] = datas[0].split('/').map(Number);
    const dias = (Date.now() - new Date(y, m - 1, d).getTime()) / 86400000;
    return dias < 120 || `documento mais recente tem ${Math.round(dias)} dias (${datas[0]})`;
  });

  // ── as tres bases fora do GraphQL (src/TCESCCojur.js) ──────────────────────
  await t('enunciados de consulta (prejulgado) respondem e filtram', async () => {
    const c = new TCESCCojur({ log: nulo });
    const base = await c.enunciados('', { size: 1 });
    const comTermo = await c.enunciados('licitação', { size: 1 });
    return (base.total > 1000 && comTermo.total > 0 && comTermo.total < base.total)
      || `base=${base.total} licitacao=${comTermo.total}`;
  });

  await t('enunciado traz texto normativo e marca vigencia', async () => {
    const c = new TCESCCojur({ log: nulo });
    const r = await c.enunciados('licitação', { size: 3 });
    const x = r.resultados[0];
    return !!(x.ementa && x.ementa.length > 200 && typeof x.vigente === 'boolean')
      || `ementa=${x.ementa && x.ementa.length} vigente=${x.vigente}`;
  });

  await t('enunciados: termo inventado devolve zero', async () => {
    const c = new TCESCCojur({ log: nulo });
    const r = await c.enunciados('zzqx9plimwrt', { size: 1 });
    return r.total === 0 || `total=${r.total}`;
  });

  await t('enunciados APLICAM termo de 2 chars (oposto do GraphQL)', async () => {
    const c = new TCESCCojur({ log: nulo });
    const base = await c.enunciados('', { size: 1 });
    const curto = await c.enunciados('ab', { size: 1 });
    return (curto.total > 0 && curto.total < base.total)
      || `base=${base.total} 'ab'=${curto.total} — a regra dos 3 chars mudou de comportamento`;
  });

  await t('informativos de jurisprudencia respondem e filtram', async () => {
    const c = new TCESCCojur({ log: nulo });
    const base = await c.informativos('', { perPage: 1 });
    const comTermo = await c.informativos('servidor', { perPage: 1 });
    return (base.total > 500 && comTermo.total > 0 && comTermo.total < base.total)
      || `base=${base.total} servidor=${comTermo.total}`;
  });

  await t('informativo traz conteudo e a categoria', async () => {
    const c = new TCESCCojur({ log: nulo });
    const r = await c.informativos('servidor', { perPage: 2 });
    const x = r.resultados[0];
    return !!(x.ementa && x.ementa.length > 100 && x.titulo && x.categoria)
      || `ementa=${x.ementa && x.ementa.length} titulo=${x.titulo} cat=${x.categoria}`;
  });

  await t('sumulas: base de 4 registros, 3 distintas, com PDF', async () => {
    const c = new TCESCCojur({ log: nulo });
    const r = c.sumulas('');
    return (r.totalBase === 4 && r.distintas === 3 && r.resultados.every((s) => s.inteiroTeorLink))
      || `totalBase=${r.totalBase} distintas=${r.distintas}`;
  });

  await t('sumulas: filtro em memoria funciona', async () => {
    const c = new TCESCCojur({ log: nulo });
    const nada = c.sumulas('licitação');
    const acha = c.sumulas('recurso');
    return (nada.total === 0 && acha.total > 0) || `licitacao=${nada.total} recurso=${acha.total}`;
  });

  await t('NAO existe endpoint de sumula no cojur (404)', async () => {
    const r = await fetch('https://servicos.tcesc.tc.br/cojur/sumula/?size=1');
    return r.status === 404 || `HTTP ${r.status} — apareceu endpoint de sumula?`;
  });

  await t('categorias dos informativos vem do servidor', async () => {
    const c = new TCESCCojur({ log: nulo });
    const cat = await c.categorias();
    return cat.length >= 5 || `categorias=${cat.length}`;
  });

  console.log('='.repeat(66));
  console.log(`RESULTADO: ${ok} passou, ${fail} falhou`);
  console.log('='.repeat(66));
  process.exit(fail ? 1 : 0);
})();
