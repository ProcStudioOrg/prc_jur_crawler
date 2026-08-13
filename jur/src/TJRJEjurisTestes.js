// src/TJRJEjurisTestes.js
//
// Testes de integração do eJURIS do TJRJ, contra o site real.
//   node src/TJRJEjurisTestes.js
//
// Cada teste é uma medição registrada em CLAUDE-TJRJ-EJURIS.md. Quando um deles
// cair, o que quebrou foi o portal — compare com human-codegen/TJRJ/01-ejuris/.

const TJRJEjurisNavigator = require('./TJRJEjurisNavigator');
const TJRJEjurisCrawler = require('./TJRJEjurisCrawler');
const TJRJEjurisChecker = require('./TJRJEjurisChecker');

const mudo = () => {};
const novoCrawler = () => new TJRJEjurisCrawler({ log: mudo });

let ok = 0;
let falhou = 0;
async function teste(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  🟢 ${nome}`);
  } catch (e) {
    falhou += 1;
    console.log(`  🔴 ${nome}\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log('TJRJ eJURIS — testes de integração (site real)\n');

  await teste('busca básica devolve documentos com ementa', async () => {
    const docs = await novoCrawler().search('dano moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    assert(docs.length === 10, `esperava 10 documentos, veio ${docs.length}`);
    assert(docs.every((d) => d.id), 'documento sem id (CodDoc)');
    assert(docs.some((d) => d.ementa && d.ementa.length > 300), 'nenhuma ementa com texto útil');
  });

  await teste('o filtro de ANO restringe de fato na origem comum', async () => {
    const c1 = novoCrawler();
    await c1.search('dano moral', { anoInicio: 1975, anoFim: 2026 }, { maxPages: 1 });
    const c2 = novoCrawler();
    await c2.search('dano moral', { anoInicio: 2020, anoFim: 2020 }, { maxPages: 1 });
    assert(c1.total > c2.total * 5, `ano não restringiu: ${c1.total} vs ${c2.total}`);
  });

  await teste('ano é IGNORADO na Turma Recursal (ressalva 2)', async () => {
    const a = novoCrawler();
    await a.search('dano moral', { origem: 'turmas', anoInicio: 2026, anoFim: 2026 }, { maxPages: 1 });
    const b = novoCrawler();
    await b.search('dano moral', { origem: 'turmas', anoInicio: 1990, anoFim: 1990 }, { maxPages: 1 });
    assert(a.total === b.total, `esperava contagem idêntica (filtro ignorado), veio ${a.total} vs ${b.total}`);
    assert(a.avisos.length > 0, 'o crawler não avisou que o filtro é ignorado');
  });

  await teste('a desambiguação Justiça Comum × Turma Recursal muda a contagem', async () => {
    const comum = novoCrawler();
    await comum.search('dano moral', { origem: 'comum', anoInicio: 1975, anoFim: 2026 }, { maxPages: 1 });
    const turmas = novoCrawler();
    await turmas.search('dano moral', { origem: 'turmas' }, { maxPages: 1 });
    assert(comum.total > turmas.total * 100, `partição suspeita: ${comum.total} vs ${turmas.total}`);
  });

  await teste('competência cível × criminal particiona na origem comum', async () => {
    const civel = novoCrawler();
    await civel.search('dano moral', { competencia: 'civel', anoInicio: 1975, anoFim: 2026 }, { maxPages: 1 });
    const crim = novoCrawler();
    await crim.search('dano moral', { competencia: 'criminal', anoInicio: 1975, anoFim: 2026 }, { maxPages: 1 });
    assert(civel.total !== crim.total, `competência ignorada: ${civel.total} = ${crim.total}`);
  });

  await teste('-oj/--ramo/--magistrado restringem de fato (ressalva 11)', async () => {
    // Regressão: o <select> sozinho é IGNORADO; quem filtra é o hidden
    // hfCodOrgs/hfCodRamos/hfCodMags. Se alguém "simplificar" isso, este
    // teste volta a bater a contagem sem filtro.
    const base = novoCrawler();
    await base.search('dano moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    for (const [rotulo, filtro] of [
      ['-oj', { orgao: 'PRIMEIRA CAMARA CIVEL' }],
      ['--ramo', { ramo: 'DIREITO CIVIL' }],
      ['--magistrado', { magistrado: 'MARIANNA FUX' }],
    ]) {
      const c = novoCrawler();
      await c.search('dano moral', { anoInicio: 2024, anoFim: 2024, ...filtro }, { maxPages: 1 });
      assert(c.total < base.total, `${rotulo} foi IGNORADO: ${c.total} = ${base.total}`);
    }
  });

  await teste('-oj multi-valor compõe exato (48 + 23 = 71)', async () => {
    const conta = async (orgao) => {
      const c = novoCrawler();
      await c.search('dano moral', { anoInicio: 2024, anoFim: 2024, orgao }, { maxPages: 1 });
      return c.total;
    };
    const a = await conta('PRIMEIRA CAMARA CIVEL');
    const b = await conta('SEGUNDA CAMARA CIVEL');
    const ab = await conta('PRIMEIRA CAMARA CIVEL,SEGUNDA CAMARA CIVEL');
    assert(a + b === ab, `a particao nao fecha: ${a} + ${b} = ${a + b} contra ${ab}`);
  });

  await teste('escopo inteiroTeor acha MAIS que a ementa (ressalva 6)', async () => {
    const em = novoCrawler();
    await em.search('dano moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    const it = novoCrawler();
    await it.search('dano moral', { anoInicio: 2024, anoFim: 2024, escopo: 'inteiroTeor' }, { maxPages: 1 });
    assert(it.total > em.total, `esperava inteiroTeor > ementa, veio ${it.total} vs ${em.total}`);
  });

  await teste('paginação anda além da página 1 e não repete ids', async () => {
    const docs = await novoCrawler().search('usucapiao', { anoInicio: 2020, anoFim: 2020 }, { maxPages: 3 });
    assert(docs.length === 30, `esperava 30 documentos em 3 páginas, veio ${docs.length}`);
    assert(new Set(docs.map((d) => d.id)).size === docs.length, 'a paginação repetiu documentos');
  });

  await teste('paginação é estável (mesma página duas vezes)', async () => {
    const um = await novoCrawler().search('usucapiao', { anoInicio: 2020, anoFim: 2020 }, { maxPages: 1 });
    const dois = await novoCrawler().search('usucapiao', { anoInicio: 2020, anoFim: 2020 }, { maxPages: 1 });
    assert(
      um.map((d) => d.id).join() === dois.map((d) => d.id).join(),
      'a mesma página devolveu documentos diferentes'
    );
  });

  await teste('o total é EXATO, não saturado', async () => {
    const c = novoCrawler();
    await c.search('criptomoeda', { origem: 'turmas' }, { maxPages: 1 });
    assert(c.total < 100, `esperava contagem pequena e exata, veio ${c.total}`);
  });

  await teste('operador inglês derruba a busca com mensagem útil (ressalva 5)', async () => {
    let erro = null;
    try {
      await novoCrawler().search('dano AND moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    } catch (e) {
      erro = e;
    }
    assert(erro, 'esperava erro em AND/OR/NOT');
    assert(/AND\/OR\/NOT/.test(erro.message), `mensagem sem a causa medida: ${erro.message}`);
  });

  await teste('acento é normalizado pelo índice (não avisar sobre isso)', async () => {
    const sem = novoCrawler();
    await sem.search('usucapiao', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    const com = novoCrawler();
    await com.search('usucapião', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    assert(sem.total === com.total, `acento mudou a contagem: ${sem.total} vs ${com.total}`);
  });

  await teste('consulta por número acha o processo nas três formas', async () => {
    const docs = await novoCrawler().search('dano moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    const alvo = docs.find((d) => d.processo && d.numeroAntigo);
    assert(alvo, 'nenhum documento com número para testar');
    const checker = new TJRJEjurisChecker({ log: mudo });
    const r = await checker.consultarProcesso(alvo.processo);
    assert(r.encontrado, `não achou ${alvo.processo}`);
    assert(r.documentos.some((d) => String(d.id) === String(alvo.id)), 'voltou outro documento');
  });

  await teste('inteiro teor é PDF público, sem sessão e sem captcha (ressalva 8)', async () => {
    const docs = await novoCrawler().search('dano moral', { anoInicio: 2024, anoFim: 2024 }, { maxPages: 1 });
    const alvo = docs.find((d) => d.arqGed);
    assert(alvo, 'nenhum documento com ArqGed');
    const pdf = await new TJRJEjurisNavigator().baixarInteiroTeor(alvo.arqGed);
    assert(pdf.slice(0, 4).toString('latin1') === '%PDF', 'o GED não devolveu um PDF');
    assert(pdf.length > 10000, `PDF pequeno demais: ${pdf.length} bytes`);
  });

  await teste('os combos vêm do HTML estático, sem AJAX', async () => {
    const l = await new TJRJEjurisNavigator().listas();
    assert(l.origens.length === 5, `esperava 5 origens, veio ${l.origens.length}`);
    assert(l.magistrados.length > 700, `esperava ~804 magistrados, veio ${l.magistrados.length}`);
    assert(l.orgaos.length > 70, `esperava ~77 órgãos, veio ${l.orgaos.length}`);
  });

  await teste('a auditoria confirma a amostra', async () => {
    const docs = await novoCrawler().search('usucapiao', { anoInicio: 2020, anoFim: 2020 }, { maxPages: 1 });
    const r = await new TJRJEjurisChecker({ log: mudo }).verificarLote(docs, 3);
    assert(r.confirmados === r.amostra, `${r.divergentes} divergentes de ${r.amostra}`);
  });

  console.log(`\n${ok} ok · ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
