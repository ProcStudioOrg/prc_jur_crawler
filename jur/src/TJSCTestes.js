// src/TJSCTestes.js
// Suíte de testes do stack TJSC (Navigator, Crawler, Checker).
// Bate no site real — precisa de rede e sobe um Chromium. Uso:
//   node src/TJSCTestes.js            # suíte completa
//   node src/TJSCTestes.js --rapido   # pula download de inteiro teor
//
// Todos os testes reaproveitam UMA sessão de browser: o portal do TJSC fica
// atrás de um desafio F5 e reabri-lo a cada teste triplicaria o tempo.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJSCNavigator = require('./TJSCNavigator');
const TJSCCrawler = require('./TJSCCrawler');
const TJSCChecker = require('./TJSCChecker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

async function teste(nome, fn) {
  process.stdout.write(`• ${nome} ... `);
  const inicio = Date.now();
  try {
    await fn();
    console.log(`PASS (${Date.now() - inicio}ms)`);
    resultados.push({ nome, ok: true, ms: Date.now() - inicio });
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
  console.log('TJSC — Testes de integração (site real, browser)');
  console.log('='.repeat(60));

  const navigator = new TJSCNavigator({ log: () => {} });
  const crawler = new TJSCCrawler({ navigator, log: () => {} });
  const checker = new TJSCChecker({ navigator });

  // Termo e período fixos. As contagens são comparadas ENTRE SI, nunca contra
  // valores absolutos — a base cresce todo dia.
  const TERMO = 'dano moral';
  const DI = '01/01/2026';
  const DF = '31/03/2026';

  const contagem = {};
  let primeiroResultado = null;

  try {
    await teste('Navigator: atravessa a verificação de segurança e abre a tela', async () => {
      await navigator.abrir();
      assert(await navigator.page.locator('#txtPesquisa').count(), '#txtPesquisa ausente');
      assert(await navigator.page.locator('#selOrigem').count(), '#selOrigem ausente');
    });

    await teste('Navigator: combo Origem traz TJSC E Turmas Recursais (a desambiguação)', async () => {
      const o = await navigator.opcoes('selOrigem');
      assert(o.length >= 4, `esperava >=4 origens, veio ${o.length}`);
      assert(o.some((x) => x.id === '1' && /TJSC/i.test(x.label)), 'origem TJSC ausente');
      assert(o.some((x) => x.id === '3' && /Turmas Recursais/i.test(x.label)), 'origem Turmas Recursais ausente');
    });

    await teste('Navigator: combos dependentes recarregam por origem', async () => {
      await navigator.definirOrigem([TJSCNavigator.ORIGENS.comum]);
      const tiposTJ = await navigator.opcoes('selTipoDocumento');
      const orgaosTJ = await navigator.opcoes('selOrgao');
      await navigator.definirOrigem([TJSCNavigator.ORIGENS.turmas]);
      const tiposTR = await navigator.opcoes('selTipoDocumento');
      const orgaosTR = await navigator.opcoes('selOrgao');

      assert(tiposTJ.some((t) => /Tribunal de Justi/i.test(t.label)), 'tipo de documento do TJ ausente');
      assert(tiposTR.some((t) => /Turmas Recursais/i.test(t.label)), 'tipo de documento das Turmas ausente');
      assert(tiposTJ[0].id !== tiposTR[0].id, 'os códigos de tipo de documento deveriam mudar com a origem');
      assert(orgaosTJ.length > 50, `esperava >50 órgãos no TJSC, veio ${orgaosTJ.length}`);
      assert(orgaosTR.length > 5 && orgaosTR.length < orgaosTJ.length,
        `órgãos das Turmas fora do esperado: ${orgaosTR.length}`);
      // o combo das Turmas traz um "NÃO INFORMADO" além das turmas propriamente ditas
      const foraDoPadrao = orgaosTR.filter((o) => !/Turma|N(Ã|A)O INFORMADO/i.test(o.label));
      assert(!foraDoPadrao.length, `órgão das Turmas fora do padrão: ${foraDoPadrao.map((o) => o.label).join(', ')}`);
    });

    await teste('Busca simples: devolve resultados com os campos-chave', async () => {
      const r = await crawler.search(TERMO, { origem: 'comum' }, { maxPages: 1 });
      assert(r.length > 0, '0 resultados');
      assert(r.totalResults > 0, 'totalResults nulo');
      contagem.semData = r.totalResults;
      primeiroResultado = r[0];
      for (const campo of ['id', 'numeroProcesso', 'tipoDocumento', 'dataJulgamento', 'orgaoJulgador', 'relator']) {
        assert(r[0][campo], `campo "${campo}" vazio no primeiro resultado`);
      }
      assert(/^\d{7}-\d{2}\.\d{4}\.8\.24\.\d{4}$/.test(r[0].numeroProcesso),
        `numeroProcesso fora do padrão CNJ do TJSC: ${r[0].numeroProcesso}`);
      assert(r[0].inteiroTeorLink, 'sem link de inteiro teor');
    });

    await teste('Filtro de data restringe de fato', async () => {
      const r = await crawler.search(TERMO, { origem: 'comum', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      contagem.comum = r.totalResults;
      assert(r.totalResults > 0, 'período devolveu 0 — termo ou período fora da base?');
      assert(r.totalResults < contagem.semData,
        `data não restringiu: ${r.totalResults} com filtro vs ${contagem.semData} sem`);
      const fora = r.filter((x) => {
        const [d, m, a] = (x.dataJulgamento || '').split('/').map(Number);
        return !(a === 2026 && m >= 1 && m <= 3);
      });
      assert(!fora.length, `resultados fora do período: ${fora.map((f) => f.dataJulgamento).join(', ')}`);
    });

    await teste('DESAMBIGUAÇÃO: Justiça Comum × Turmas Recursais são universos distintos', async () => {
      const tr = await crawler.search(TERMO, { origem: 'turmas', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      contagem.turmas = tr.totalResults;
      assert(contagem.turmas > 0, 'Turmas Recursais devolveu 0');
      assert(contagem.turmas !== contagem.comum,
        `MESMA contagem (${contagem.comum}) nas duas origens — o filtro NÃO está sendo aplicado`);
      assert(tr.every((x) => /Turma/i.test(x.orgaoJulgador)),
        `órgão fora de Turma Recursal: ${tr.map((x) => x.orgaoJulgador).join(' | ')}`);
      assert(tr.every((x) => /Turmas Recursais/i.test(x.tipoDocumento)),
        `tipo de documento fora das Turmas: ${tr.map((x) => x.tipoDocumento).join(' | ')}`);
    });

    await teste('DESAMBIGUAÇÃO: --origem todas = soma das origens', async () => {
      const u = await crawler.search(TERMO, { origem: 'uniformizacao', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      const c = await crawler.search(TERMO, { origem: 'conselho', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      const t = await crawler.search(TERMO, { origem: 'todas', dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      const soma = contagem.comum + contagem.turmas + u.totalResults + c.totalResults;
      assert(t.totalResults === soma,
        `todas (${t.totalResults}) != soma das origens (${soma})`);
    });

    await teste('Filtro de tipo de documento restringe dentro da origem', async () => {
      const ac = await crawler.search(TERMO, { origem: 'comum', tipos: ['acordao'], dataInicio: DI, dataFim: DF }, { maxPages: 1 });
      assert(ac.totalResults > 0 && ac.totalResults < contagem.comum,
        `tipo não restringiu: ${ac.totalResults} vs ${contagem.comum}`);
      assert(ac.every((x) => /Ac(ó|o)rd(ã|a)os/i.test(x.tipoDocumento)),
        `veio tipo diferente de acórdão: ${ac.map((x) => x.tipoDocumento).join(' | ')}`);
    });

    await teste('Tipo de documento inválido para a origem é recusado (não ignorado)', async () => {
      let erro = null;
      try {
        await crawler.search(TERMO, { origem: 'turmas', tipos: ['despacho'] }, { maxPages: 1 });
      } catch (e) { erro = e; }
      assert(erro, 'aceitou "despacho" em Turmas Recursais — deveria recusar');
      assert(/tipo inválido/i.test(erro.message), `mensagem inesperada: ${erro.message}`);
    });

    await teste('Paginação anda além da página 1', async () => {
      const r = await crawler.search(TERMO, { origem: 'comum', dataInicio: DI, dataFim: DF }, { maxPages: 2 });
      assert(r.length > 10, `esperava >10 resultados em 2 páginas, veio ${r.length}`);
      const ids = new Set(r.map((x) => x.id));
      assert(ids.size === r.length, 'ids repetidos entre páginas — a paginação não avançou');
    });

    await teste('Tamanho de página 100 é respeitado', async () => {
      const r = await crawler.search(TERMO, { origem: 'comum', dataInicio: DI, dataFim: DF },
        { maxPages: 1, tamanhoPagina: 100 });
      assert(r.length > 50, `esperava >50 resultados em 1 página de 100, veio ${r.length}`);
    });

    await teste('Checker: consulta por nº de processo encontra um julgado conhecido', async () => {
      assert(primeiroResultado, 'sem resultado de referência');
      const res = await checker.consultarProcesso(primeiroResultado.numeroProcesso);
      assert(res.encontrado, `processo ${primeiroResultado.numeroProcesso} não encontrado`);
      assert(res.formatoCNJ, 'não reconheceu formato CNJ');
      assert(res.tjsc, 'não reconheceu como TJSC (.8.24.)');
      assert(res.decisoes.some((d) => d.numeroProcesso === primeiroResultado.numeroProcesso),
        'nenhuma decisão com o número consultado');
    });

    await teste('Checker: processo inexistente devolve encontrado:false', async () => {
      const res = await checker.consultarProcesso('9999999-99.2099.8.24.9999');
      assert(!res.encontrado, 'inventou resultado para processo inexistente');
    });

    await teste('Checker: auditoria confirma a amostra da busca', async () => {
      const r = await crawler.search('usucapiao', { origem: 'comum' }, { maxPages: 1 });
      const audit = await checker.verificarResultados(r, { amostra: 3 });
      assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
      assert(audit.confirmados === 3,
        `divergências: ${JSON.stringify(audit.detalhes.filter((d) => !d.confirmado))}`);
    });

    if (!rapido) {
      await teste('Navigator: baixa o inteiro teor e grava em disco', async () => {
        assert(primeiroResultado?.inteiroTeorLink, 'sem link de inteiro teor');
        const { html, texto } = await navigator.baixarInteiroTeor(primeiroResultado.inteiroTeorLink);
        assert(html.length > 1000, `HTML muito curto: ${html.length}`);
        assert(texto.length > 500, `texto muito curto: ${texto.length}`);
        // a ressalva de encoding: mojibake aparece como U+FFFD
        assert(!texto.includes('�'), 'texto com mojibake — decodificação de charset quebrou');

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjsc-testes-'));
        try {
          const lote = await navigator.baixarLote([primeiroResultado], dir, { log: () => {}, formats: ['txt', 'html'] });
          assert(lote[0].arquivo, `baixarLote não gravou: ${lote[0].downloadError || ''}`);
          assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  } finally {
    await navigator.fechar();
  }

  console.log('='.repeat(60));
  console.log(`Contagens observadas: ${JSON.stringify(contagem)}`);
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
