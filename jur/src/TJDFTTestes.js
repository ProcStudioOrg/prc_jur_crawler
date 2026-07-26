// src/TJDFTTestes.js
// Suíte de integração do stack TJDFT (Navigator, Crawler, Checker).
// Bate na API real — precisa de rede. Uso:
//   node src/TJDFTTestes.js            # suíte completa
//   node src/TJDFTTestes.js --rapido   # pula download em disco
//
// ⚠️ A API limita a 60 requisições por janela. A suíte compartilha UM navigator
// (que também é o que fixa o nó, via cookie) e ele espaça sozinho ao chegar no
// limite. Não paralelize.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJDFTNavigator = require('./TJDFTNavigator');
const TJDFTCrawler = require('./TJDFTCrawler');
const TJDFTChecker = require('./TJDFTChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

// Processo real com 2 acórdãos, confirmado em 26/07/2026.
const PROCESSO_CONHECIDO = '0705891-74.2023.8.07.0004';
const JANELA = { di: '01/01/2024', df: '31/12/2024' };

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const t0 = Date.now();
  try {
    await fn();
    console.log(`PASS (${Date.now() - t0}ms)`);
    resultados.push({ nome, ok: true });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    resultados.push({ nome, ok: false, erro: err.message });
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  console.log('='.repeat(60));
  console.log('TJDFT — Testes de integração (JurisDF, API pública oficial)');
  console.log('='.repeat(60));

  const navigator = new TJDFTNavigator({ retries: 2 });
  const crawler = new TJDFTCrawler({ navigator, log: () => {} });
  const checker = new TJDFTChecker({ navigator });

  await teste('API acessível e envelope conforme a documentação oficial', async () => {
    const d = await navigator.buscar({ query: 'usucapião', tamanho: 3 });
    assert(d.hits && typeof d.hits.value === 'number', 'hits.value ausente');
    assert(Array.isArray(d.registros), 'registros não é array');
    assert(d.registros.length === 3, `esperava 3, veio ${d.registros.length}`);
    assert(d.paginacao && d.agregacoes, 'paginacao/agregacoes ausentes');
    for (const c of ['uuid', 'identificador', 'base', 'subbase', 'processo', 'dataPublicacao']) {
      assert(d.registros[0][c] != null, `campo ausente: ${c}`);
    }
  });

  await teste('DOC OFICIAL DESATUALIZADA: hits é objeto, não número', async () => {
    // O PDF oficial mostra "hits": 1234. A API devolve {"value": 1234}. Se um
    // dia voltar a ser número, o crawler quebra silenciosamente — por isso o
    // teste afirma o formato real.
    const d = await navigator.buscar({ query: 'usucapião', tamanho: 1 });
    assert(typeof d.hits === 'object' && d.hits.value !== undefined,
      `hits mudou de formato: ${JSON.stringify(d.hits)} — revise TJDFTCrawler.search`);
  });

  await teste('Cookie do balanceador fixa o nó (resposta estável)', async () => {
    // Sem cookie a API alterna entre dois índices dessincronizados. Como o
    // navigator já guardou o cookie no primeiro teste, aqui tudo deve bater.
    assert(navigator.cookie, 'navigator não guardou o cookie do balanceador');
    const vistos = new Set();
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await navigator.buscar({ query: 'usucapião', tamanho: 5 });
      vistos.add(`${d.hits.value}|${d.registros.map((r) => r.uuid).join(',')}`);
    }
    assert(vistos.size === 1,
      `4 chamadas idênticas deram ${vistos.size} respostas distintas — a fixação de nó parou de funcionar`);
  });

  await teste('DESAMBIGUAÇÃO: Turma Recursal é subbase, e as contagens fecham', async () => {
    const n = async (acervo) => {
      const r = await crawler.search('usucapião', { acervo, ...(acervo ? {} : {}) }, { maxPages: 1 });
      return r.totalResults;
    };
    const acordaos = await n('acordaos');
    const comum = await n('comum');
    const turmas = await n('turmas');
    assert(turmas > 0, `Turma Recursal veio vazia (${turmas})`);
    assert(comum > turmas, `comum (${comum}) não é maior que turmas (${turmas})`);
    assert(comum + turmas === acordaos,
      `as partes não somam o todo: comum ${comum} + turmas ${turmas} != acordaos ${acordaos}`);
  });

  await teste('ARMADILHA: base="acordaos-tr" devolve 0; só subbase filtra', async () => {
    const errado = await navigator.buscar({
      query: 'usucapião', tamanho: 1, termosAcessorios: [{ campo: 'base', valor: 'acordaos-tr' }],
    });
    const certo = await navigator.buscar({
      query: 'usucapião', tamanho: 1, termosAcessorios: [{ campo: 'subbase', valor: 'acordaos-tr' }],
    });
    assert(errado.hits.value === 0,
      `base="acordaos-tr" passou a funcionar (${errado.hits.value}) — simplifique _termosAcervo`);
    assert(certo.hits.value > 0, 'subbase="acordaos-tr" parou de funcionar — a base mudou');
  });

  await teste('ZERO CALADO: decisões não têm data de julgamento', async () => {
    // Se isto falhar é BOA notícia: o TJDFT passou a preencher dataJulgamento
    // nas decisões, e então o aviso do crawler e o doc estão errados.
    const semData = await crawler.search('usucapião', { acervo: 'monocraticas' }, { maxPages: 1 });
    const porJulg = await crawler.search('usucapião', {
      acervo: 'monocraticas', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df,
    }, { maxPages: 1 });
    const porPubl = await crawler.search('usucapião', {
      acervo: 'monocraticas', dataPublicacaoInicio: JANELA.di, dataPublicacaoFim: JANELA.df,
    }, { maxPages: 1 });
    assert(semData.totalResults > 0, 'monocráticas vazias sem filtro');
    assert(porJulg.totalResults === 0,
      `monocráticas passaram a responder a data de julgamento (${porJulg.totalResults}) — reescreva SEM_DATA_JULGAMENTO`);
    assert(porJulg.avisos.some((a) => /JULGAMENTO/.test(a)), 'não avisou sobre o zero calado');
    assert(porPubl.totalResults > 0, 'filtro por publicação também zerou — algo mais mudou');
    assert(semData.every((x) => !x.dataJulgamento), 'algum registro de decisão trouxe dataJulgamento');
  });

  await teste('Intervalo de data ("entre X e Y") restringe de fato', async () => {
    const sem = await crawler.search('usucapião', { acervo: 'acordaos' }, { maxPages: 1 });
    const com = await crawler.search('usucapião', {
      acervo: 'acordaos', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df,
    }, { maxPages: 1 });
    const outro = await crawler.search('usucapião', {
      acervo: 'acordaos', dataJulgamentoInicio: '01/01/2015', dataJulgamentoFim: '31/12/2015',
    }, { maxPages: 1 });
    assert(com.totalResults < sem.totalResults, `filtro não restringiu: ${sem.totalResults} -> ${com.totalResults}`);
    assert(com.totalResults > 0 && outro.totalResults > 0, 'alguma janela zerou');
    assert(com.totalResults !== outro.totalResults, 'janelas diferentes deram o mesmo número');
  });

  await teste('Intervalo aberto é recusado com mensagem útil', async () => {
    let erro = null;
    try {
      await crawler.search('usucapião', { dataJulgamentoInicio: JANELA.di }, { maxPages: 1 });
    } catch (e) { erro = e; }
    assert(erro && /intervalo FECHADO/.test(erro.message), `mensagem ruim: ${erro && erro.message}`);
  });

  await teste('Operadores E / OU / NÃO / "frase" funcionam e fecham a aritmética', async () => {
    const base = { acervo: 'acordaos', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df };
    const n = async (q) => (await crawler.search(q, base, { maxPages: 1 })).totalResults;
    const a = await n('usucapião');
    const b = await n('posse');
    const e = await n('usucapião E posse');
    const ou = await n('usucapião OU posse');
    const nao = await n('usucapião NÃO posse');
    assert(e < a && e < b, `E não restringiu: A=${a} B=${b} E=${e}`);
    assert(ou === a + b - e, `OU não fecha: ${a}+${b}-${e}=${a + b - e}, veio ${ou}`);
    assert(nao === a - e, `NÃO não fecha: ${a}-${e}=${a - e}, veio ${nao}`);
    const frase = await n('"usucapião extraordinária"');
    assert(frase > 0 && frase < a, `frase exata fora da faixa: ${frase} (A=${a})`);
  });

  await teste('ARMADILHA: PROX/ADJ só funcionam SEM parênteses', async () => {
    const base = { acervo: 'acordaos', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df };
    const comParens = await crawler.search('usucapião PROX(5) posse', base, { maxPages: 1 });
    const semParens = await crawler.search('usucapião PROX5 posse', base, { maxPages: 1 });
    assert(comParens.totalResults === 0,
      `PROX(5) passou a funcionar (${comParens.totalResults}) — atualize o aviso e o doc`);
    assert(comParens.avisos.some((a) => /parênteses/i.test(a)), 'não avisou sobre os parênteses');
    assert(semParens.totalResults > 0, 'PROX5 sem parênteses parou de funcionar');
  });

  await teste('Escopo espelho × inteiroTeor são somáveis, não excludentes', async () => {
    const base = { acervo: 'acordaos', dataJulgamentoInicio: JANELA.di, dataJulgamentoFim: JANELA.df };
    const esp = (await crawler.search('usucapião', { ...base, escopo: 'espelho' }, { maxPages: 1 })).totalResults;
    const it = (await crawler.search('usucapião', { ...base, escopo: 'inteiroTeor' }, { maxPages: 1 })).totalResults;
    const ambos = (await crawler.search('usucapião', { ...base, escopo: 'ambos' }, { maxPages: 1 })).totalResults;
    assert(it > esp, `inteiroTeor (${it}) devia achar mais que espelho (${esp})`);
    assert(ambos >= it, `ambos (${ambos}) menor que inteiroTeor (${it}) — não é união`);
  });

  await teste('Paginação anda além da página 1 sem repetir', async () => {
    const r = await crawler.search('usucapião', { acervo: 'acordaos' }, { maxPages: 3 });
    assert(r.length > 30, `paginação parou cedo: ${r.length}`);
    assert(new Set(r.map((x) => x.id)).size === r.length, 'houve id repetido entre páginas');
  });

  await teste('tamanho acima de 30 é recusado pela API (e o crawler limita)', async () => {
    let quebrou = false;
    try {
      await navigator._post({
        query: 'usucapião', termosAcessorios: [], pagina: 0, tamanho: 50,
        sinonimos: false, espelho: true, inteiroTeor: false, retornaInteiroTeor: false, retornaTotalizacao: true,
      });
    } catch (e) { quebrou = /HTTP 4\d\d/.test(e.message); }
    assert(quebrou, 'a API passou a aceitar tamanho>30 — revise TAMANHO_MAX');
    const c = new TJDFTCrawler({ navigator, pageSize: 500, log: () => {} });
    assert(c.pageSize === TJDFTNavigator.TAMANHO_MAX, 'crawler não limitou o pageSize');
  });

  await teste('Checker: processo conhecido é encontrado (COM máscara)', async () => {
    const res = await checker.consultarProcesso(PROCESSO_CONHECIDO);
    assert(res.encontrado, `${PROCESSO_CONHECIDO} não encontrado`);
    assert(res.numeroValido && res.tjdft, 'validação CNJ/segmento falhou');
    assert(res.julgados.length >= 2, `esperava >=2 julgados, veio ${res.julgados.length}`);
  });

  await teste('ARMADILHA: número SEM máscara devolve 0 na API', async () => {
    const semMascara = await navigator.buscar({
      query: '', tamanho: 5,
      termosAcessorios: [{ campo: 'processo', valor: PROCESSO_CONHECIDO.replace(/\D/g, '') }],
    });
    assert(semMascara.hits.value === 0,
      `a API passou a aceitar número sem máscara (${semMascara.hits.value}) — simplifique buscarPorProcesso`);
  });

  await teste('Checker: número inexistente não vira falso positivo', async () => {
    const res = await checker.consultarProcesso('9999999-99.2099.8.07.0000');
    assert(!res.encontrado, 'processo inventado foi dado como encontrado');
    assert(res.motivo, 'não explicou por que não achou');
  });

  await teste('Auditoria confirma a amostra contra a base', async () => {
    const r = await crawler.search('usucapião', { acervo: 'acordaos' }, { maxPages: 1 });
    const v = await checker.verificarResultados(r, { amostra: 3 });
    assert(v.confirmados === 3, `${v.confirmados}/3 confirmados: ${JSON.stringify(v.detalhes)}`);
  });

  await teste('Mapeamento: campos do repo, flag de Juizado e inteiro teor no payload', async () => {
    const r = await crawler.search('usucapião', { acervo: 'turmas', escopo: 'ambos' }, { maxPages: 1 });
    assert(r.length > 0, 'Turma Recursal não devolveu nada');
    assert(r.every((x) => x.juizado === true), 'algum resultado de Turma Recursal sem a flag juizado');
    assert(r.every((x) => x.uf === 'DF'), 'uf != DF');
    const comTexto = r.filter((x) => x.inteiroTeor && x.inteiroTeor.length > 200);
    assert(comTexto.length > 0, 'nenhum resultado trouxe inteiro teor no payload da busca');
  });

  if (!rapido) {
    await teste('Download em disco: .txt + index.json, sem request extra', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjdft-'));
      try {
        const r = await crawler.search('usucapião', { acervo: 'acordaos' }, { maxPages: 1, maxResults: 2 });
        const lote = await crawler.fetchInteiroTeorBatch(r, dir, { log: () => {} });
        assert(lote.every((x) => x.arquivo), `nem todos gravaram: ${JSON.stringify(lote.map((x) => x.downloadError))}`);
        for (const x of lote) {
          assert(fs.statSync(path.join(dir, x.arquivo)).size > 500, `arquivo ${x.arquivo} pequeno demais`);
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
})().catch((err) => { console.error('Erro fatal na suíte:', err); process.exit(1); });
