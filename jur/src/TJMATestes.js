// src/TJMATestes.js
// Suíte de testes do stack TJMA (Navigator, Crawler, Checker).
// Bate nas APIs reais — precisa de rede. Uso:
//   node src/TJMATestes.js            # suíte completa
//   node src/TJMATestes.js --rapido   # só as rotas abertas (sem DataJud)
//
// ⚠️ Estes testes NÃO provam que a busca de jurisprudência funciona — ela não
// funciona (captcha). Eles provam três coisas diferentes e igualmente úteis:
//   1. que as rotas abertas do JurisConsult continuam de pé e com a mesma
//      forma (é o que o `jur-fixer` compara quando algo muda);
//   2. que o bloqueio de captcha CONTINUA existindo e é reportado com o erro
//      certo — se um dia este teste falhar, é boa notícia: o TJMA abriu;
//   3. que o Checker (DataJud) confirma processos reais do TJMA.
const TJMANavigator = require('./TJMANavigator');
const TJMACrawler = require('./TJMACrawler');
const TJMAChecker = require('./TJMAChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    const ms = Date.now() - inicio;
    console.log(`PASS (${ms}ms)`);
    resultados.push({ nome, ok: true, ms });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log('='.repeat(64));
  console.log('TJMA — Testes de integração (JurisConsult + DataJud)');
  console.log('='.repeat(64));

  const navigator = new TJMANavigator({ retries: 3 });
  const crawler = new TJMACrawler({ navigator, log: () => {} });
  const checker = new TJMAChecker();

  // -------------------------------------------------------------------
  // 1. Rotas abertas do JurisConsult
  // -------------------------------------------------------------------

  await teste('API no ar: lista_relatorios devolve os 7 relatórios', async () => {
    const rels = await navigator.listaRelatorios();
    assert(rels.length === 7, `esperava 7 relatórios, veio ${rels.length}`);
    const ids = rels.map((r) => Number(r.id)).sort((a, b) => a - b);
    assert(ids.join(',') === '1,2,3,4,5,6,7', `ids inesperados: ${ids.join(',')}`);
    const acordaos = rels.find((r) => Number(r.id) === 1);
    assert(acordaos.url === '/sg/jurisprudencias/processos',
      `rota de Acórdãos mudou: ${acordaos.url}`);
  });

  await teste('Rotas do mapa batem com lista_relatorios (o fixer depende disso)', async () => {
    const rels = await navigator.listaRelatorios();
    for (const [chave, r] of Object.entries(TJMANavigator.RELATORIOS)) {
      const vivo = rels.find((x) => Number(x.id) === r.id);
      assert(vivo, `relatório ${chave} (id ${r.id}) sumiu da API`);
      assert(vivo.url === r.rota, `rota de ${chave} mudou: ${vivo.url} ≠ ${r.rota}`);
    }
  });

  await teste('Combos populados: Acórdãos tem 6 tipos de pesquisa e ~34 órgãos', async () => {
    const tipos = await navigator.listaTiposPesquisa(1);
    assert(tipos.length === 6, `esperava 6 tipos, veio ${tipos.length}`);
    assert(tipos.some((t) => t.opcao === 'Ementa'), 'sumiu a busca por Ementa');
    const camaras = await navigator.listaCamaras(1);
    assert(camaras.length > 25, `poucos órgãos julgadores: ${camaras.length}`);
    const magistrados = await navigator.listaMagistrados(1);
    assert(magistrados.length > 200, `poucos magistrados: ${magistrados.length}`);
  });

  await teste('Desambiguação é real: órgãos de Justiça Comum × Turma Recursal são disjuntos', async () => {
    // Não dá para provar por contagem de busca (captcha). Prova-se pelos
    // conjuntos de opções, que vêm de rotas abertas.
    const comum = await navigator.listaCamaras(1);      // Acórdãos
    const tr = await navigator.listaCamaras(6);         // Acórdãos - Turma Recursal
    const nome = (x) => (x.txdescricao || x.camara || '').toUpperCase().trim();
    const setComum = new Set(comum.map(nome));
    const intersecao = tr.map(nome).filter((n) => setComum.has(n));
    assert(comum.length > 25, `Justiça Comum com poucos órgãos: ${comum.length}`);
    assert(tr.length > 5 && tr.length < 25, `Turma Recursal com contagem estranha: ${tr.length}`);
    assert(intersecao.length <= 2,
      `conjuntos deveriam ser disjuntos, interseção = ${intersecao.length}: ${intersecao.join(', ')}`);
    assert(tr.some((c) => /TURMA RECURSAL/i.test(nome(c))), 'nenhuma Turma Recursal no relatório 6');
    assert(!comum.some((c) => /TURMA RECURSAL/i.test(nome(c))), 'Turma Recursal vazou para a Justiça Comum');
  });

  await teste('Desambiguação 1º grau: comarcas de Justiça Comum × Juizado são disjuntas', async () => {
    const comum = await navigator.listaComarcas(4);     // Sentenças de 1º Grau
    const je = await navigator.listaComarcas(7);        // Sentenças - Juizado Especial
    const nome = (x) => (x.comarca || '').toUpperCase().trim();
    const setComum = new Set(comum.map(nome));
    const intersecao = je.map(nome).filter((n) => setComum.has(n));
    assert(comum.length > 90, `poucas comarcas na Justiça Comum: ${comum.length}`);
    assert(je.length > 5, `poucas comarcas no Juizado: ${je.length}`);
    assert(intersecao.length === 0, `interseção deveria ser 0, veio ${intersecao.length}`);
  });

  await teste('Súmulas e Precedentes: rota aberta devolve os links do portal', async () => {
    const links = await navigator.linksPesquisaSumulas();
    assert(links.length >= 3, `esperava >= 3 links, veio ${links.length}`);
    assert(links.every((l) => l.url?.startsWith('https://')), 'link sem URL válida');
  });

  await teste('Captcha de imagem é servido (mas NÃO é resolvido por este repo)', async () => {
    const cap = await navigator.gerarCaptcha();
    assert(typeof cap.token === 'string' && cap.token.length > 20, 'token de captcha ausente');
    const jpeg = Buffer.from(cap.imagemBase64, 'base64');
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8, 'a imagem do captcha não é um JPEG');
  });

  // -------------------------------------------------------------------
  // 2. O bloqueio continua existindo?
  // -------------------------------------------------------------------

  await teste('reCAPTCHA continua LIGADO no servidor (se falhar, o TJMA abriu)', async () => {
    const r = await navigator.recaptchaHabilitado();
    assert(r.siteKey, 'site key do reCAPTCHA não veio');
    assert(r.habilitado === true,
      'reCAPTCHA DESLIGADO — revalide o crawler contra um payload real e atualize CLAUDE-TJMA.md');
  });

  await teste('Busca falha com CaptchaBloqueadoError, não com erro genérico', async () => {
    try {
      await crawler.search('dano moral', { foro: 'comum' }, { maxPages: 1 });
      throw new Error('a busca retornou resultados — o bloqueio caiu? revalide tudo');
    } catch (err) {
      assert(err.name === 'CaptchaBloqueadoError',
        `esperava CaptchaBloqueadoError, veio ${err.name}: ${err.message}`);
      assert(err.bloqueio === 'captcha', 'erro sem marcador de bloqueio');
      assert(/captcha/i.test(err.message), 'mensagem não explica o bloqueio');
    }
  });

  await teste('A API confirma o bloqueio nas 4 rotas de busca', async () => {
    const rotas = ['acordaos', 'acordaos-tr', 'sentencas', 'sentencas-je'];
    for (const chave of rotas) {
      const rel = TJMANavigator.RELATORIOS[chave];
      try {
        await navigator.buscar(rel.rota, {
          chave: 'dano moral', tipoPesquisa: rel.tipoPesquisaPadrao,
          checkForm: 0, inicioPagina: 1, fimPagina: 5,
        }, {});
        throw new Error(`${chave}: a busca passou sem captcha — o bloqueio caiu?`);
      } catch (err) {
        assert(err.name === 'CaptchaBloqueadoError',
          `${chave}: esperava CaptchaBloqueadoError, veio ${err.name}: ${err.message}`);
      }
    }
  });

  await teste('Diagnóstico do fixer roda sem captcha e reporta o bloqueio', async () => {
    const d = await crawler.diagnosticar();
    assert(d.apiNoAr === true, 'diagnóstico não viu a API no ar');
    assert(d.relatorios === 7, `diagnóstico viu ${d.relatorios} relatórios`);
    assert(d.bloqueado === true, 'diagnóstico diz que não está bloqueado');
    assert(typeof d.resumo === 'string' && d.resumo.length > 10, 'resumo vazio');
  });

  // -------------------------------------------------------------------
  // 3. Resolução de relatório (a desambiguação, no código)
  // -------------------------------------------------------------------

  await teste('resolverRelatorio mapeia foro/tipo para o relatório certo', async () => {
    const casos = [
      [{}, 'acordaos', 1],
      [{ foro: 'comum', tipo: 'acordao' }, 'acordaos', 1],
      [{ foro: 'comum', tipo: 'monocratica' }, 'monocraticas', 2],
      [{ foro: 'comum', tipo: 'sentenca' }, 'sentencas', 4],
      [{ foro: 'turmas', tipo: 'acordao' }, 'acordaos-tr', 6],
      [{ foro: 'turmas', tipo: 'monocratica' }, 'monocraticas-tr', 5],
      [{ foro: 'juizados' }, 'sentencas-je', 7],
    ];
    for (const [filtros, chaveEsperada, idEsperado] of casos) {
      const r = crawler.resolverRelatorio(filtros);
      assert(r.chave === chaveEsperada,
        `${JSON.stringify(filtros)} → ${r.chave}, esperava ${chaveEsperada}`);
      assert(r.id === idEsperado, `${chaveEsperada} deveria ser id ${idEsperado}, veio ${r.id}`);
    }
    // foro inválido não pode virar Justiça Comum silenciosamente
    let errou = false;
    try { crawler.resolverRelatorio({ relatorio: 'inexistente' }); } catch { errou = true; }
    assert(errou, 'relatório inexistente deveria lançar erro');
  });

  await teste('Nomes de chave por rota estão corretos (pkmatricula × matricula_id)', async () => {
    const R = TJMANavigator.RELATORIOS;
    assert(R.acordaos.chaves.relator === 'pkmatricula', 'Acórdãos deveria usar pkmatricula');
    assert(R['acordaos-tr'].chaves.relator === 'matricula_id', 'Acórdãos-TR deveria usar matricula_id');
    assert(R.acordaos.chaves.classe === 'id_classe', 'Acórdãos deveria usar id_classe');
    assert(R.sentencas.chaves.classe === 'classe_id', 'Sentenças deveria usar classe_id');
    assert(R.sentencas.chaves.comarca === 'comarca_id', 'Sentenças deveria ter comarca_id');
    assert(!R.acordaos.chaves.comarca, 'Acórdãos não tem comarca');
  });

  // -------------------------------------------------------------------
  // 4. Checker (DataJud) — a parte que realmente funciona
  // -------------------------------------------------------------------

  if (!rapido) {
    let numeroConhecido = null;

    await teste('DataJud: índice api_publica_tjma responde e cobre G1/G2', async () => {
      // pega um processo real do TJMA para usar nos testes seguintes
      const res = await checker._post({
        size: 5,
        _source: ['numeroProcesso', 'grau', 'tribunal'],
        query: { match: { grau: 'G2' } },
      });
      const hits = res.hits?.hits ?? [];
      assert(hits.length > 0, 'DataJud não devolveu nenhum processo do TJMA');
      assert(hits.every((h) => h._source.tribunal === 'TJMA'), 'veio processo de outro tribunal');
      numeroConhecido = hits[0]._source.numeroProcesso;
    });

    await teste('Checker encontra um processo conhecido do TJMA', async () => {
      assert(numeroConhecido, 'sem número conhecido do teste anterior');
      const res = await checker.consultarProcesso(numeroConhecido);
      assert(res.encontrado === true, `processo ${numeroConhecido} não encontrado`);
      assert(res.tjma === true, 'checker não reconheceu o número como TJMA');
      assert(res.processos[0].tribunal === 'TJMA', 'tribunal errado no resultado');
      assert(res.ressalva.includes('ementa'), 'a ressalva sobre metadados sumiu');
    });

    await teste('Checker rejeita número inexistente e número de outro tribunal', async () => {
      const inexistente = await checker.consultarProcesso('00000000000000000000');
      assert(inexistente.encontrado === false, 'processo inexistente foi "encontrado"');
      // TJPR = J 8, TR 16
      assert(checker.ehProcessoTJMA('0000001-02.2020.8.16.0001') === false,
        'número do TJPR passou como TJMA');
      assert(checker.ehProcessoTJMA('0000001-02.2020.8.10.0001') === true,
        'número do TJMA não foi reconhecido');
    });

    await teste('Auditoria (--verificar) confirma uma amostra contra o DataJud', async () => {
      const res = await checker._post({
        size: 3, _source: ['numeroProcesso'], query: { match: { grau: 'G2' } },
      });
      const amostra = res.hits.hits.map((h) => ({ processo: h._source.numeroProcesso }));
      const v = await checker.verificarResultados(amostra, { amostra: 3 });
      assert(v.verificados === 3, `verificou ${v.verificados}, esperava 3`);
      assert(v.confirmados === 3, `confirmou ${v.confirmados}/3`);
      assert(v.fonte === 'datajud', 'fonte da auditoria não declarada');
    });
  }

  // -------------------------------------------------------------------
  console.log('='.repeat(64));
  const ok = resultados.filter((r) => r.ok).length;
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`${ok}/${resultados.length} testes passaram`);
  if (falhas.length) {
    console.log('\nFalhas:');
    for (const f of falhas) console.log(`  ✗ ${f.nome}\n    ${f.erro}`);
  }
  console.log('='.repeat(64));
  process.exit(falhas.length ? 1 : 0);
})();
