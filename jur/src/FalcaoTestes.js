// src/FalcaoTestes.js
// Suíte de integração da FAMÍLIA FALCÃO — vale para qualquer um dos 26 acervos
// (TST + TRT1..TRT24 + CSJT). Bate na API real; precisa de rede.
//
//   node src/FalcaoTestes.js TRT2         # um acervo
//   node src/FalcaoTestes.js TST TRT15    # vários
//   node src/FalcaoTestes.js --todos      # os 26 (demorado: ~26 × 20s)
//   node src/FalcaoTestes.js --amostra    # TST, TRT2, TRT15, TRT9, CSJT (default)
//
// Diferença para `src/TRT9Testes.js`: lá as fixtures são FIXAS (processo conhecido,
// período com contagem conferida à mão), o que testa o TRT9 a fundo. Aqui as
// fixtures são DESCOBERTAS em tempo de execução, porque um número de processo
// fixo por acervo seria 26 fixtures para manter. Os dois se complementam: o do
// TRT9 é o teste de profundidade, este é o de cobertura.
const FalcaoNavigator = require('./FalcaoNavigator');
const { classes, SIGLAS, metadados } = require('./FalcaoTribunais');

const AMOSTRA_PADRAO = ['TST', 'TRT2', 'TRT15', 'TRT9', 'CSJT'];
const TERMO = 'horas extras';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Roda a suíte inteira contra UM acervo. @returns {Array} resultados */
async function suite(sigla, registrar) {
  const meta = metadados(sigla);
  const { Navigator, Crawler, Checker } = classes(sigla);
  const navigator = new Navigator({ retries: 3 });
  const crawler = new Crawler({ navigator, log: () => {} });
  const checker = new Checker({ navigator });

  const teste = async (nome, fn) => {
    process.stdout.write(`  • ${nome} ... `);
    const t0 = Date.now();
    try {
      await fn();
      console.log(`PASS (${Date.now() - t0}ms)`);
      registrar({ sigla, nome, ok: true });
    } catch (err) {
      console.log(`FAIL — ${err.message}`);
      registrar({ sigla, nome, ok: false, erro: err.message });
    }
  };

  // Fixture descoberta: um acórdão real deste acervo.
  let amostra = null;
  await teste('busca básica devolve documentos', async () => {
    const r = await crawler.search(TERMO, { colecoes: ['acordaos'] }, { maxPages: 1 });
    assert(r.length > 0, 'nenhum resultado');
    assert(r.totalResults > 0, 'quantidadeTotal zerada');
    amostra = r;
  });

  await teste('ISOLAMENTO: todo documento vem marcado com o tribunal pedido', async () => {
    assert(amostra, 'sem amostra da busca básica');
    const vazados = [...new Set(amostra.map((r) => r.tribunal))].filter((t) => t && t !== sigla);
    assert(vazados.length === 0, `acervo vazou ${vazados.join(', ')} em uma busca de ${sigla}`);
    assert(amostra.every((r) => r.uf === meta.uf), `uf divergente de ${meta.uf}`);
  });

  await teste('ISOLAMENTO: somar dois acervos bate com a soma das partes', async () => {
    const outro = sigla === 'TRT2' ? 'TRT9' : 'TRT2';
    const base = { texto: TERMO, colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' };
    const a = await navigator.pesquisar({ ...base, tribunais: sigla });
    const b = await navigator.pesquisar({ ...base, tribunais: outro });
    const ambos = await navigator.pesquisar({ ...base, tribunais: `${sigla},${outro}` });
    // acima de 10.000 a contagem satura e a soma deixa de fechar — só compara abaixo do teto
    const teto = FalcaoNavigator.LIMITES.tetoContagem;
    if (a.quantidadeTotal >= teto || b.quantidadeTotal >= teto || ambos.quantidadeTotal >= teto) {
      assert(ambos.quantidadeTotal >= Math.max(a.quantidadeTotal, b.quantidadeTotal), 'união menor que a parte');
      return;
    }
    assert(ambos.quantidadeTotal === a.quantidadeTotal + b.quantidadeTotal,
      `${sigla}=${a.quantidadeTotal} + ${outro}=${b.quantidadeTotal} != ${ambos.quantidadeTotal}`);
  });

  await teste('DESAMBIGUAÇÃO: coleções com acervo devolvem contagens distintas', async () => {
    const totais = {};
    for (const c of FalcaoNavigator.COLECOES_TRIBUNAL) {
      const r = await navigator.pesquisar({ texto: TERMO, colecao: c, size: 5 });
      totais[c] = r.quantidadeTotal;
    }
    // Zero aqui pode ser um FATO estrutural (o TST não tem 1º grau nem
    // admissibilidade de RR; o CSJT não julga reclamação) — comparar só o que
    // tem acervo, e conferir que os zeros são exatamente os declarados.
    // `precedentes` é base nacional (BNP), não acervo de tribunal: fica fora de
    // COLECOES_TRIBUNAL e portanto fora desta medição. Compara só o que foi medido.
    const zeradas = Object.entries(totais).filter(([, v]) => v === 0).map(([c]) => c).sort();
    const declaradasAqui = meta.colecoesVazias
      .filter((c) => FalcaoNavigator.COLECOES_TRIBUNAL.includes(c)).sort();
    assert(JSON.stringify(zeradas) === JSON.stringify(declaradasAqui),
      `coleções zeradas ${JSON.stringify(zeradas)} != declaradas ${JSON.stringify(declaradasAqui)} — atualize COLECOES_VAZIAS em FalcaoTribunais.js`);

    // ⚠️ LIMITE CONHECIDO desta asserção: com termo amplo, acervo grande satura em
    // 10.000 nas quatro coleções e `comparaveis` fica VAZIO — ou seja, em TST e TRT2
    // esta checagem passa sem provar nada. Quem prova a aplicação do filtro nesses
    // acervos é a asserção de `grau` logo abaixo e a de isolamento acima. A prova por
    // contagem só morde onde os números não saturam: acervo pequeno (CSJT) ou janela
    // estreita (ver a medição do TRT9 em CLAUDE-TRT9.md: 5693/8794/34/1437 num
    // trimestre). Não "conserte" estreitando a janela aqui: acervo pequeno passaria a
    // devolver 0 em coleção que EXISTE, e o teste acusaria falso positivo.
    const comparaveis = Object.entries(totais)
      .filter(([c, v]) => v > 0 && v < FalcaoNavigator.LIMITES.tetoContagem && !meta.colecoesVazias.includes(c))
      .map(([, v]) => v);
    assert(new Set(comparaveis).size === comparaveis.length,
      `contagens repetidas => filtro de coleção ignorado: ${JSON.stringify(totais)}`);
    assert(totais.acordaos > 0, `acordaos zerado: ${JSON.stringify(totais)}`);
  });

  await teste('DESAMBIGUAÇÃO: grau vem preenchido e coerente com a coleção', async () => {
    const a = await crawler.search(TERMO, { colecoes: ['acordaos'] }, { maxPages: 1 });
    assert(a.length > 0 && a.every((r) => r.grau === '2'), 'acórdão sem grau=2');
    const s = await crawler.search(TERMO, { colecoes: ['sentencas'] }, { maxPages: 1 });
    // CSJT é órgão administrativo: pode não ter acervo de 1º grau, e isso é correto
    if (s.length > 0) assert(s.every((r) => r.grau === '1'), 'sentença sem grau=1');
  });

  await teste('filtro de data restringe de fato', async () => {
    const F = { texto: TERMO, colecao: 'acordaos', size: 5 };
    const largo = await navigator.pesquisar({ ...F, dataInicio: '2024-01-01', dataFim: '2025-12-31' });
    const estreito = await navigator.pesquisar({ ...F, dataInicio: '2025-01-01', dataFim: '2025-01-31' });
    assert(estreito.quantidadeTotal <= largo.quantidadeTotal, 'janela menor devolveu mais');
    assert(largo.quantidadeTotal > estreito.quantidadeTotal || largo.quantidadeTotal >= FalcaoNavigator.LIMITES.tetoContagem,
      'filtro de data não restringiu');
  });

  await teste('paginação anda além da página 1 sem repetir ids', async () => {
    const r = await crawler.search(TERMO, { colecoes: ['acordaos'] }, { maxPages: 3 });
    if (r.length <= 10) return; // acervo pequeno (CSJT) — nada a paginar
    assert(new Set(r.map((x) => x.id)).size === r.length, 'ids repetidos entre páginas');
  });

  await teste('resultado mapeado tem os campos-chave do repo', async () => {
    assert(amostra, 'sem amostra');
    const d = amostra[0];
    for (const campo of ['id', 'colecao', 'grau', 'tribunal', 'uf', 'processo', 'orgaoJulgador', 'dataJulgamento']) {
      assert(d[campo] !== undefined && d[campo] !== '', `campo vazio/ausente: ${campo}`);
    }
    assert(d.tribunal === sigla, `tribunal errado: ${d.tribunal}`);
  });

  await teste('CHECKER: processo colhido do próprio acervo é confirmado', async () => {
    assert(amostra, 'sem amostra');
    const numero = amostra[0].numeroProcesso;
    assert(numero, 'amostra sem número de processo');
    const res = await checker.consultarProcesso(numero);
    assert(res.encontrado, `${numero} não encontrado no próprio acervo`);
    assert(res.justicaDoTrabalho, 'não reconhecido como Justiça do Trabalho');
    assert(res.doTribunal, `doTribunal=false para ${numero} (codigoCNJ de ${sigla} = ${meta.codigoCNJ})`);
    assert(res.documentos.filter((d) => !d.erro).every((d) => d.numeroProcesso === numero),
      'checker deixou passar processo de número diferente');
  });

  await teste('CHECKER: processo inexistente NÃO é confirmado', async () => {
    const res = await checker.consultarProcesso('9999999-99.2099.5.02.0001');
    assert(!res.encontrado, 'processo inventado foi dado como encontrado');
  });

  await teste('CHECKER: número sem máscara é normalizado antes da consulta', async () => {
    assert(amostra, 'sem amostra');
    const numero = amostra[0].numeroProcesso;
    const res = await checker.consultarProcesso(numero.replace(/\D/g, ''));
    assert(res.numero === numero, `normalização falhou: ${res.numero} != ${numero}`);
  });
}

(async () => {
  const args = process.argv.slice(2);
  let alvos;
  if (args.includes('--todos')) alvos = SIGLAS;
  else if (args.length && !args[0].startsWith('--')) alvos = args.map((a) => metadados(a).sigla);
  else alvos = AMOSTRA_PADRAO;

  console.log('='.repeat(64));
  console.log(`FALCÃO — testes de integração de família (API real): ${alvos.join(', ')}`);
  console.log('='.repeat(64));

  const resultados = [];
  for (const sigla of alvos) {
    const m = metadados(sigla);
    console.log(`\n[${sigla}] ${m.nome}`);
    await suite(sigla, (r) => resultados.push(r));
  }

  console.log('\n' + '='.repeat(64));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`${resultados.length - falhas.length}/${resultados.length} testes passaram em ${alvos.length} acervo(s)`);
  if (falhas.length) {
    for (const f of falhas) console.log(`  FAIL [${f.sigla}] ${f.nome} — ${f.erro}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
