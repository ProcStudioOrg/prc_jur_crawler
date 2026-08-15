/**
 * TCERSTestes — integracao do TCE-RS. `node src/TCERSTestes.js`
 *
 * Cada teste corresponde a uma ressalva MEDIDA em 15/08/2026. Se um deles falhar,
 * o portal mudou de comportamento — leia a mensagem antes de editar codigo.
 */

const TCERSNavigator = require('./TCERSNavigator');
const TCERSCrawler = require('./TCERSCrawler');
const TCERSChecker = require('./TCERSChecker');

const nav = new TCERSNavigator();
let ok = 0;
let falhou = 0;

async function teste(nome, fn) {
  try {
    await fn();
    console.log(`✅ ${nome}`);
    ok++;
  } catch (e) {
    console.log(`❌ ${nome}\n   ${e.message}`);
    falhou++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('TCE-RS — testes de integracao\n');

  await teste('busca responde sem browser, sem token e sem captcha', async () => {
    const r = await nav.pesquisar({ termo: 'nepotismo', porPagina: 5 });
    assert(r.total > 0, 'total zerado');
    assert(r.resultados.length === 5, `esperava 5 resultados, veio ${r.resultados.length}`);
  });

  await teste('o total se autodeclara EXATO ou SATURADO (relacao)', async () => {
    const raro = await nav.pesquisar({ termo: 'nepotismo', porPagina: 1 });
    assert(!raro.saturado, 'termo raro deveria ter total exato');
    await dorme(800);
    const comum = await nav.pesquisar({ termo: 'licitação', porPagina: 1 });
    assert(comum.saturado, 'termo comum deveria saturar no teto de 10.000');
    assert(comum.total === 10000, `teto esperado 10.000, veio ${comum.total}`);
  });

  await teste('o ESPACO e OR e o AND e a intersecao (aritmetica exata)', async () => {
    const a = (await nav.pesquisar({ termo: 'merenda', porPagina: 1 })).total;
    await dorme(600);
    const b = (await nav.pesquisar({ termo: 'escolar', porPagina: 1 })).total;
    await dorme(600);
    const uniao = (await nav.pesquisar({ termo: 'merenda escolar', porPagina: 1 })).total;
    await dorme(600);
    const inter = (await nav.pesquisar({ termo: 'merenda AND escolar', porPagina: 1 })).total;
    assert(a + b - uniao === inter, `aritmetica quebrou: ${a} + ${b} - ${uniao} != ${inter}`);
  });

  await teste('os operadores em portugues que a config anuncia INFLAM ate o teto', async () => {
    const r = await nav.pesquisar({ termo: 'merenda E escolar', porPagina: 1 });
    assert(r.saturado, '`E` deveria inflar ate saturar — se parou de inflar, remeca os avisos do crawler');
  });

  await teste('a janela de data usa inicio/fim; o array `valores` e IGNORADO', async () => {
    const semFiltro = (await nav.pesquisar({ termo: 'nepotismo', porPagina: 1 })).total;
    await dorme(600);
    const certo = await nav.pesquisar({
      termo: 'nepotismo',
      porPagina: 1,
      filtros: [{ campo: 'dt_sessao', tipo: 'data', inicio: '2024-01-01', fim: '2024-12-31' }],
    });
    assert(certo.total < semFiltro, `janela nao restringiu: ${certo.total} de ${semFiltro}`);
    await dorme(600);
    const ignorado = await nav.pesquisar({
      termo: 'nepotismo',
      porPagina: 1,
      filtros: [{ campo: 'dt_sessao', tipo: 'data', valores: ['2024-01-01', '2024-12-31'] }],
    });
    assert(ignorado.total === semFiltro, 'o array `valores` deixou de ser ignorado — reveja montarFiltros()');
  });

  await teste('as DUAS pontas da janela funcionam sozinhas', async () => {
    const so1 = await nav.pesquisar({
      termo: 'nepotismo', porPagina: 1, filtros: [{ campo: 'dt_sessao', tipo: 'data', inicio: '2024-01-01' }],
    });
    await dorme(600);
    const so2 = await nav.pesquisar({
      termo: 'nepotismo', porPagina: 1, filtros: [{ campo: 'dt_sessao', tipo: 'data', fim: '2024-12-31' }],
    });
    const total = 106;
    assert(so1.total > 0 && so1.total < total, `so-inicio deveria restringir, veio ${so1.total}`);
    assert(so2.total > 0 && so2.total < total, `so-fim deveria restringir, veio ${so2.total}`);
  });

  await teste('numero COM MASCARA derruba com HTTP 500 (nao devolve zero)', async () => {
    let status = null;
    try {
      await nav.pesquisar({ termo: '013714-0200/25-3', porPagina: 1 });
    } catch (e) {
      status = e.status;
    }
    assert(status === 500, `esperava HTTP 500 para numero mascarado, veio ${status}`);
  });

  await teste('o Checker normaliza a mascara e acha o processo', async () => {
    const r = await new TCERSChecker({ quiet: true }).consultarProcesso('013714-0200/25-3');
    assert(r.encontrado, 'nao encontrou o processo conhecido');
    assert(r.documentos[0].processo === '013714-0200/25-3', `processo errado: ${r.documentos[0].processo}`);
  });

  await teste('o inteiro teor JA VEM no payload da busca (campo relatorio)', async () => {
    const r = await nav.pesquisar({ termo: 'nepotismo', porPagina: 10 });
    const com = r.resultados.filter((x) => x.campos.relatorio && x.campos.relatorio.length > 2000).length;
    assert(com >= 8, `esperava relatorio integral na maioria, veio ${com}/10`);
  });

  await teste('os autos sao publicos e o PDF comeca com %PDF (chave composta)', async () => {
    const pecas = await nav.indicePecas('1765341');
    assert(pecas.length > 10, `indice raso: ${pecas.length} pecas`);
    assert(pecas.some((p) => p.publico === false), 'esperava pecas nao-publicas no indice');
    const decisao = pecas.find((p) => /^Decis/i.test(p.tipo || ''));
    assert(decisao, 'peca de Decisao nao encontrada');
    const pdf = await nav.baixarPeca('1765341', decisao.idObjetoArquivo);
    assert(pdf.ok, `download falhou: HTTP ${pdf.status}`);
    assert(pdf.ehPdf, 'o arquivo nao comeca com %PDF');
  });

  await teste('a ordem dos segmentos da URL do PDF importa (a invertida da 404)', async () => {
    const r = await nav.baixarPeca('10012142950', '1765341'); // invertido de proposito
    assert(!r.ok, 'a URL invertida deveria falhar — se passou, o contrato mudou');
  });

  await teste('paginacao estavel e sem sobreposicao', async () => {
    const p1a = (await nav.pesquisar({ termo: 'nepotismo', porPagina: 5, pagina: 1 })).resultados.map((x) => x.id);
    await dorme(600);
    const p1b = (await nav.pesquisar({ termo: 'nepotismo', porPagina: 5, pagina: 1 })).resultados.map((x) => x.id);
    await dorme(600);
    const p2 = (await nav.pesquisar({ termo: 'nepotismo', porPagina: 5, pagina: 2 })).resultados.map((x) => x.id);
    assert(p1a.join() === p1b.join(), 'a mesma pagina devolveu ids diferentes');
    assert(p1a.filter((x) => p2.includes(x)).length === 0, 'pg1 e pg2 se sobrepoem');
  });

  await teste('a ementa desaparece a partir de 2020', async () => {
    const antes = await nav.pesquisar({
      termo: 'licitação', porPagina: 20, filtros: [{ campo: 'dt_sessao', tipo: 'data-ano', valores: ['2019'] }],
    });
    await dorme(800);
    const depois = await nav.pesquisar({
      termo: 'licitação', porPagina: 20, filtros: [{ campo: 'dt_sessao', tipo: 'data-ano', valores: ['2022'] }],
    });
    const cAntes = antes.resultados.filter((x) => x.campos.texto_ementa).length;
    const cDepois = depois.resultados.filter((x) => x.campos.texto_ementa).length;
    assert(cAntes > 15, `2019 deveria ter ementa na maioria, veio ${cAntes}/20`);
    assert(cDepois === 0, `2022 deveria vir SEM ementa, veio ${cDepois}/20 — se voltou, atualize a ressalva`);
  });

  await teste('o crawler converte data brasileira para ISO', async () => {
    assert(TCERSCrawler._iso('31/12/2019') === '2019-12-31', 'conversao BR->ISO errada');
    assert(TCERSCrawler._iso('2019-12-31') === '2019-12-31', 'ISO deveria passar direto');
  });

  await teste('o crawler nunca chama `texto` de ementa e marca o degenerado', async () => {
    const c = new TCERSCrawler({ quiet: true });
    const m = c.mapear({ id: 'X', campos: { texto: 'Multa', texto_ementa: null, relatorio: 'abc' } });
    assert(m.ementa === null, 'ementa deveria ser null');
    assert(m.semEmenta === true, 'deveria marcar semEmenta');
    assert(m.dispositivoDegenerado === true, 'deveria marcar dispositivoDegenerado para "Multa"');
  });

  await teste('os combos vem de graca pelo servidor', async () => {
    const tipos = await nav.lista('decisoes-tipos-processos');
    assert(tipos.length > 30, `esperava >30 tipos, veio ${tipos.length}`);
  });

  console.log(`\n${ok} ok · ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})();
