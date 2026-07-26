// src/TJMGTestes.js
// Suíte de testes do stack TJMG (Navigator, Crawler, Checker).
// Bate na API real — precisa de rede. Uso:
//   node src/TJMGTestes.js            # suíte completa
//   node src/TJMGTestes.js --rapido   # pula download em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJMGNavigator = require('./TJMGNavigator');
const TJMGCrawler = require('./TJMGCrawler');
const TJMGChecker = require('./TJMGChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

// Processo real, confirmado na base em 26/07/2026. Decisão de Turma Recursal,
// publicada e julgada em 14/09/2021 — serve de fixture para Checker e inteiro teor.
const PROCESSO_CONHECIDO = '5003998-10.2020.8.13.0079';

// Janela estreita o bastante para o contador NÃO saturar em 1000, o que é o que
// permite comparar contagens de verdade. Ver TETO_CONTADOR no Navigator.
const JANELA = { di: '01/01/2024', df: '31/03/2024' };

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    console.log(`PASS (${Date.now() - inicio}ms)`);
    resultados.push({ nome, ok: true });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log('='.repeat(60));
  console.log('TJMG — Testes de integração (API real da Consulta Unificada)');
  console.log('='.repeat(60));

  const navigator = new TJMGNavigator({ retries: 3 });
  // Os testes de ARMADILHA esperam HTTP 500. Com retry eles pagariam ~12s cada
  // reexecutando uma chamada que já sabemos que falha — este navigator não repete.
  const semRetry = new TJMGNavigator({ retries: 0 });
  const crawler = new TJMGCrawler({ navigator, log: () => {} });
  const checker = new TJMGChecker({ navigator });
  let julgadoBruto = null;

  await teste('API acessível: busca simples devolve o envelope esperado', async () => {
    const d = await navigator.buscar({ texto: 'usucapião', tipoTexto: 'INTEIRO_TEOR' }, { size: 3 });
    assert(typeof d.totalRecords === 'number', 'totalRecords ausente');
    assert(Array.isArray(d.jurisprudencias), 'jurisprudencias não é array');
    assert(d.jurisprudencias.length === 3, `esperava 3, veio ${d.jurisprudencias.length}`);
    julgadoBruto = d.jurisprudencias[0];
    for (const campo of ['id', 'documentoId', 'tipoDocumento', 'numeroProcessoCnj', 'publicacaoData']) {
      assert(julgadoBruto[campo] != null, `campo ausente no resultado: ${campo}`);
    }
  });

  await teste('/dominio: os 6 combos respondem e tiposDocumento tem exatamente 4', async () => {
    for (const campo of TJMGNavigator.DOMINIOS) {
      const d = await navigator.dominio(campo);
      assert(d.length > 0, `domínio ${campo} veio vazio`);
      assert(d[0].dominio && d[0].quantidade, `domínio ${campo} sem dominio/quantidade`);
    }
    const tipos = await navigator.dominio('tiposDocumento');
    assert(tipos.length === 4, `esperava 4 tipos de documento, vieram ${tipos.length}: ${tipos.map((t) => t.dominio).join(', ')}`);
    const nomes = tipos.map((t) => t.dominio).sort();
    const esperados = Object.values(TJMGNavigator.TIPOS_DOCUMENTO).sort();
    assert(JSON.stringify(nomes) === JSON.stringify(esperados),
      `nomes divergem — base: ${nomes.join(' | ')} / código: ${esperados.join(' | ')}`);
  });

  await teste('ARMADILHA 1: /dominio quebra se o corpo levar texto/tipoTexto', async () => {
    // Não é capricho de teste: foi este 500 que fez a primeira sondagem concluir
    // errado que o endpoint não existia. Se um dia a API aceitar, queremos saber.
    let quebrou = false;
    try {
      await semRetry._post('/dominio/tiposDocumento', {
        ...semRetry._filtroBase(), texto: '', tipoTexto: 'EMENTA',
      });
    } catch (e) { quebrou = /HTTP 5\d\d/.test(e.message); }
    assert(quebrou, 'a API passou a aceitar texto/tipoTexto em /dominio — reveja o Navigator e o doc');
  });

  await teste('DESAMBIGUAÇÃO: tipoDocumento muda a contagem de fato', async () => {
    const conta = async (tipo) => {
      const r = await crawler.search('usucapião', { tipo, escopo: 'inteiroTeor' }, { maxPages: 1 });
      return r.totalResults;
    };
    const turmas = await conta('turmas');
    const vice = await conta('vice');
    const todos = await conta('todos');
    // Turma Recursal (Juizado) e Vice-Presidência ficam abaixo do teto, logo são
    // contagens EXATAS — é isso que prova que o filtro é aplicado, e não só que
    // "a busca respondeu".
    assert(turmas > 0 && turmas < TJMGNavigator.TETO_CONTADOR, `turmas fora da faixa exata: ${turmas}`);
    assert(vice > 0 && vice < TJMGNavigator.TETO_CONTADOR, `vice fora da faixa exata: ${vice}`);
    assert(turmas !== vice, `turmas e vice deram o mesmo número (${turmas}) — filtro provavelmente ignorado`);
    assert(todos > turmas && todos > vice, `"todos" (${todos}) não é maior que os tipos isolados`);
  });

  await teste('ARMADILHA 2: só "Acórdão" tem ementa indexada (o zero calado)', async () => {
    // Se isto começar a falhar é BOA notícia — quer dizer que o TJMG indexou a
    // ementa dos outros tipos. Aí o aviso da CLI e o CLAUDE-TJMG.md ficam errados
    // e precisam ser reescritos. Por isso o teste afirma o estado atual.
    for (const tipo of ['turmas', 'vice', 'monocratica']) {
      const r = await crawler.search('usucapião', { tipo, escopo: 'ementa' }, { maxPages: 1 });
      assert(r.totalResults === 0,
        `${tipo} devolveu ${r.totalResults} em escopo ementa — a base mudou, reescreva SEM_EMENTA_INDEXADA`);
      assert(r.avisos.length > 0, `${tipo} em escopo ementa não emitiu aviso`);
    }
    const ac = await crawler.search('usucapião', { tipo: 'acordao', escopo: 'ementa' }, { maxPages: 1 });
    assert(ac.totalResults > 0, 'acórdão também zerou em ementa — a busca por ementa quebrou de vez');
  });

  await teste('Filtro de data restringe de fato (contagens abaixo do teto)', async () => {
    const q = 'usucapião extraordinária tabelionato';
    const sem = await crawler.search(q, { escopo: 'inteiroTeor' }, { maxPages: 1 });
    const com = await crawler.search(q, {
      escopo: 'inteiroTeor', dataJulgamentoInicio: '01/01/2024', dataJulgamentoFim: '31/12/2024',
    }, { maxPages: 1 });
    assert(sem.totalResultsExato, `contagem sem data saturou (${sem.totalResults}) — escolha termo mais raro`);
    assert(com.totalResults < sem.totalResults,
      `filtro de data não restringiu: ${sem.totalResults} -> ${com.totalResults}`);
    assert(com.totalResults > 0, 'filtro de data zerou tudo — janela errada ou filtro quebrado');
  });

  await teste('Data de julgamento e de publicação são filtros diferentes', async () => {
    const q = 'usucapião';
    const julg = await crawler.search(q, {
      escopo: 'ementa', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df,
    }, { maxPages: 1 });
    const publ = await crawler.search(q, {
      escopo: 'ementa', dataPublicacaoInicio: JANELA.di, dataPublicacaoFim: JANELA.df,
    }, { maxPages: 1 });
    assert(julg.totalResultsExato && publ.totalResultsExato, 'janela larga demais, contagens saturaram');
    assert(julg.totalResults !== publ.totalResults,
      `julgamento e publicação deram o mesmo número (${julg.totalResults}) — um dos dois é ignorado`);
  });

  await teste('Operadores: + | - "frase" funcionam; E/OU/NÃO em português NÃO', async () => {
    const n = async (texto) => {
      const r = await crawler.search(texto, {
        escopo: 'ementa', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df,
      }, { maxPages: 1 });
      return r.totalResults;
    };
    const a = await n('usucapião');
    const e = await n('usucapião extraordinária');
    const ou = await n('usucapião | extraordinária');
    const nao = await n('usucapião -extraordinária');
    assert(e < a, `E implícito não restringiu: ${a} -> ${e}`);
    assert(ou > a, `pipe (OU) não ampliou: ${a} -> ${ou}`);
    assert(nao === a - e, `menos (NÃO) não bateu: ${a} - ${e} = ${a - e}, veio ${nao}`);
    // e a contraprova: o operador em português é ignorado, não aplicado
    const ouPortugues = await n('usucapião OU extraordinária');
    assert(ouPortugues === e,
      `"OU" em português deixou de ser ignorado (${ouPortugues} vs E=${e}) — atualize CLAUDE-TJMG.md §operadores`);
  });

  await teste('Paginação anda além da página 1 e o crawler deduplica', async () => {
    // NÃO exigimos 60 itens: a API ordena sem campo de desempate, então às vezes
    // repete documentos entre páginas (medido: 14 repetidos em 60, em 1 rodada de
    // 3, ordenando por publicação). O contrato que o crawler garante é: a saída
    // não tem id repetido, e quando houve descarte isso aparece como aviso.
    const r = await crawler.search('usucapião', { escopo: 'inteiroTeor', ordenacao: 'recentes' }, { maxPages: 3 });
    assert(r.length > 20, `paginação não passou da página 1: ${r.length} resultados`);
    assert(new Set(r.map((x) => x.id)).size === r.length, 'saída do crawler tem id repetido — a dedupe falhou');
    assert(r.length + r.duplicatasDescartadas === 60,
      `contabilidade errada: ${r.length} + ${r.duplicatasDescartadas} != 60`);
    if (r.duplicatasDescartadas > 0) {
      assert(r.avisos.some((a) => /repetiu/.test(a)), 'descartou duplicatas sem avisar');
    }
  });

  await teste('Contador satura em 1000 e o crawler declara isso', async () => {
    const r = await crawler.search('recurso', { escopo: 'inteiroTeor' }, { maxPages: 1 });
    assert(r.totalResults === TJMGNavigator.TETO_CONTADOR,
      `esperava saturação em ${TJMGNavigator.TETO_CONTADOR}, veio ${r.totalResults}`);
    assert(r.totalResultsExato === false, 'saturou mas totalResultsExato não ficou false');
  });

  await teste('Checker: processo conhecido é encontrado e validado', async () => {
    const res = await checker.consultarProcesso(PROCESSO_CONHECIDO);
    assert(res.encontrado, `processo ${PROCESSO_CONHECIDO} não encontrado`);
    assert(res.numeroValido, 'DV CNJ não fechou para um processo que existe');
    assert(res.tjmg, 'não reconheceu como TJMG (J=8, TR=13)');
    assert(res.julgados.length > 0 && res.julgados[0].documentoId, 'julgado sem documentoId');
  });

  await teste('ARMADILHA 3: busca por número quebra se o corpo levar texto', async () => {
    let quebrou = false;
    try {
      await semRetry._post('/jurisprudencias/filter?size=5&page=0', {
        ...semRetry._filtroBase({ numerosProcessos: [PROCESSO_CONHECIDO.replace(/\D/g, '')] }),
        texto: '', tipoTexto: 'INTEIRO_TEOR',
      });
    } catch (e) { quebrou = /HTTP 5\d\d/.test(e.message); }
    assert(quebrou, 'a API passou a aceitar texto na busca por número — simplifique buscarPorProcesso()');
  });

  await teste('Checker: número inexistente não vira falso positivo', async () => {
    const res = await checker.consultarProcesso('9999999-99.2099.8.13.0000');
    assert(!res.encontrado, 'processo inventado foi dado como encontrado');
    assert(res.motivo, 'não explicou por que não achou');
  });

  await teste('Checker: DataJud (api_publica_tjmg) responde e distingue os graus', async () => {
    const dj = await checker.consultarDataJud(PROCESSO_CONHECIDO);
    assert(dj.encontrado, 'DataJud não achou um processo que existe na jurisprudência');
    assert(dj.processos[0].grau, 'DataJud não devolveu grau');
  });

  await teste('Auditoria: amostra de resultados confirma contra a base', async () => {
    const r = await crawler.search('usucapião extraordinária', { escopo: 'inteiroTeor' }, { maxPages: 1 });
    const v = await checker.verificarResultados(r, { amostra: 3 });
    assert(v.verificados === 3, `verificou ${v.verificados}, esperava 3`);
    assert(v.confirmados === 3, `só ${v.confirmados}/3 confirmados: ${JSON.stringify(v.detalhes)}`);
  });

  await teste('Mapeamento: campos do repo preenchidos e processo mascarado', async () => {
    const r = await crawler.search('usucapião', { escopo: 'inteiroTeor' }, { maxPages: 1 });
    const x = r[0];
    assert(/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(x.processo), `processo sem máscara CNJ: ${x.processo}`);
    assert(x.uf === 'MG', 'uf não é MG');
    assert(x.tipoDocumento && x.orgaoJulgador, 'tipoDocumento/orgaoJulgador vazios');
    assert(x.inteiroTeorLink.includes('documentoId='), 'inteiroTeorLink sem documentoId');
    assert(x.processoUrl.includes('consulta.tjmg.jus.br'), 'processoUrl não aponta para a consulta processual');
  });

  await teste('Ementa: acórdão traz ementa REAL; os outros tipos caem no trecho', async () => {
    // Esta assimetria já foi mapeada errado uma vez (concluída a partir de uma
    // amostra que era Turma Recursal): a API DEVOLVE ementa, mas só de acórdão.
    const ac = await crawler.search('dano moral', { tipo: 'acordao', escopo: 'inteiroTeor' }, { maxPages: 1 });
    assert(ac.every((x) => x.ementaEhTrecho === false),
      'algum acórdão veio sem ementa real — a API parou de devolver `ementa`?');
    assert(ac[0].ementa.length > 80, `ementa de acórdão curta demais: ${ac[0].ementa.length} chars`);
    assert(!ac[0].ementa.includes(' [...] '), 'ementa de acórdão parece ser trecho concatenado');

    for (const tipo of ['turmas', 'vice']) {
      const r = await crawler.search('dano moral', { tipo, escopo: 'inteiroTeor' }, { maxPages: 1 });
      assert(r.length > 0, `${tipo} não devolveu nada para calibrar o teste`);
      assert(r.every((x) => x.ementaEhTrecho === true),
        `${tipo} passou a trazer ementa real — atualize CLAUDE-TJMG.md §5.4`);
      assert(r[0].trechos.length > 0, `${tipo} sem trechos de destaque`);
    }
  });

  await teste('Relator: vazio em Turma Recursal, preenchido nos demais', async () => {
    const semMagistrado = await crawler.search('dano moral', { tipo: 'turmas', escopo: 'inteiroTeor' }, { maxPages: 1 });
    assert(semMagistrado.every((x) => !x.relator),
      'Turma Recursal passou a trazer magistrado — atualize a ressalva do CLAUDE-TJMG.md');
    for (const tipo of ['acordao', 'vice']) {
      const r = await crawler.search('dano moral', { tipo, escopo: 'inteiroTeor' }, { maxPages: 1 });
      assert(r.every((x) => x.relator), `${tipo} veio sem relator — o campo magistrado sumiu?`);
    }
  });

  await teste('Filtros de combo (comarca/órgão/classe) restringem de fato', async () => {
    const base = { escopo: 'inteiroTeor', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df };
    const semFiltro = await crawler.search('recurso', base, { maxPages: 1 });
    for (const [chave, campo] of [['comarcas', 'comarcas'], ['orgaos', 'orgaosJulgadores'], ['classes', 'classes']]) {
      const valores = await navigator.dominio(campo);
      // um valor do meio da lista: os das pontas costumam ser residuais
      const escolhido = valores[Math.floor(valores.length / 2)].dominio;
      const r = await crawler.search('recurso', { ...base, [chave]: [escolhido] }, { maxPages: 1 });
      assert(r.totalResults < semFiltro.totalResults,
        `${chave}="${escolhido}" não restringiu: ${semFiltro.totalResults} -> ${r.totalResults}`);
    }
  });

  await teste('validarFiltros barra nome inexistente e aceita nome COM vírgula', async () => {
    // 18 dos 575 órgãos julgadores têm vírgula no nome, e todos são de Turma
    // Recursal — separar por vírgula partiria o nome e devolveria 0 calado.
    const orgaos = await navigator.dominio('orgaosJulgadores');
    const comVirgula = orgaos.map((o) => o.dominio).find((n) => n.includes(','));
    assert(comVirgula, 'nenhum órgão com vírgula — a premissa do separador ";" mudou');
    await crawler.validarFiltros({ orgaos: [comVirgula] });

    let barrou = false;
    try {
      await crawler.validarFiltros({ orgaos: [comVirgula.split(',')[0]] });
    } catch (e) {
      barrou = true;
      assert(/Você quis dizer/.test(e.message), `erro sem sugestão: ${e.message}`);
    }
    assert(barrou, 'nome partido na vírgula passou pela validação — voltaria 0 em silêncio');
  });

  await teste('Escopo e ordenação inválidos falham localmente, sem ir à rede', async () => {
    for (const [filtro, esperado] of [
      [{ escopo: 'inteiroteor' }, /Escopo inválido/],
      [{ ordenacao: 'inventada' }, /Ordenação inválida/],
      [{ tipo: 'inventado' }, /Tipo inválido/],
    ]) {
      let erro = null;
      try { await crawler.search('x', filtro, { maxPages: 1 }); } catch (e) { erro = e; }
      assert(erro && esperado.test(erro.message), `esperava ${esperado}, veio: ${erro && erro.message}`);
    }
  });

  await teste('ARMADILHA 4: inteiro teor exige documentoId + data de publicação', async () => {
    assert(julgadoBruto, 'sem julgado de referência do primeiro teste');
    let quebrouSemData = false;
    try {
      await semRetry._post('/jurisprudencias/document', {
        ...semRetry._filtroBase(),
        documentoId: String(julgadoBruto.documentoId),
        texto: null, tipoTexto: null,
      });
    } catch (e) { quebrouSemData = /HTTP 5\d\d/.test(e.message); }
    assert(quebrouSemData, 'passou a aceitar documentoId sem data — simplifique inteiroTeor()');

    const html = await navigator.inteiroTeor(julgadoBruto.documentoId, julgadoBruto.publicacaoData);
    assert(html.length > 2000, `inteiro teor curto demais (${html.length} bytes)`);
    assert(/Minas Gerais/i.test(html), 'inteiro teor não parece do TJMG');
  });

  if (!rapido) {
    await teste('Download em disco: .txt + index.json', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjmg-'));
      try {
        const r = await crawler.search('usucapião', { escopo: 'inteiroTeor' }, { maxPages: 1, maxResults: 2 });
        const lote = await crawler.fetchInteiroTeorBatch(r, dir, { log: () => {} });
        assert(lote.every((x) => x.arquivo), `nem todos baixaram: ${JSON.stringify(lote.map((x) => x.downloadError))}`);
        for (const x of lote) {
          const size = fs.statSync(path.join(dir, x.arquivo)).size;
          assert(size > 500, `arquivo ${x.arquivo} muito pequeno (${size} bytes)`);
        }
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  console.log('='.repeat(60));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`${resultados.length - falhas.length}/${resultados.length} testes passaram`);
  if (falhas.length) {
    for (const f of falhas) console.log(`  FAIL: ${f.nome} — ${f.erro}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
