// src/STJTestes.js
// Suíte de integração do stack STJ (Navigator, Crawler, Checker).
// Bate no site real — precisa de rede e sobe UM Chromium HEADFUL. Uso:
//   node src/STJTestes.js            # suíte completa
//   node src/STJTestes.js --rapido   # pula inteiro teor e o módulo de temas
//
// Todos os testes reaproveitam UMA sessão: o SCON fica atrás de um desafio
// Cloudflare que só cai em modo headful, e reabri-lo por teste custaria minutos.
//
// As contagens são sempre comparadas ENTRE SI, nunca contra valores absolutos:
// a base do STJ cresce todo dia.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const STJNavigator = require('./STJNavigator');
const STJCrawler = require('./STJCrawler');
const STJChecker = require('./STJChecker');

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

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log('='.repeat(60));
  console.log('STJ — Testes de integração (SCON real, browser headful)');
  console.log('='.repeat(60));

  const navigator = new STJNavigator({ log: () => {} });
  const crawler = new STJCrawler({ navigator, log: () => {} });
  const checker = new STJChecker({ navigator });

  const TERMO = 'dano moral';
  const DI = '01/01/2025';
  const DF = '31/12/2025';

  const contagem = {};
  let primeiro = null;

  try {
    await teste('Navigator: atravessa o Cloudflare e abre o SCON', async () => {
      await navigator.abrir();
      assert(await navigator.page.locator('#pesquisaLivre').count(), '#pesquisaLivre ausente');
      assert(await navigator.page.locator('#idMostrarPesquisaAvancada').count(), 'botão de pesquisa avançada ausente');
    });

    await teste('encLatin1: querystring em ISO-8859-1 (não UTF-8)', async () => {
      assert(STJNavigator.encLatin1('usucapião') === 'usucapi%E3o',
        `esperava usucapi%E3o, veio ${STJNavigator.encLatin1('usucapião')}`);
      assert(STJNavigator.encLatin1('dano moral') === 'dano+moral', 'espaço deve virar +');
    });

    await teste('montarData: o filtro real é o campo `data`', async () => {
      const d = STJNavigator.montarData({ dataInicio: '01/01/2025', dataFim: '31/12/2025' });
      assert(d === '@DTDE >= "20250101" AND @DTDE <= "20251231"', `veio: ${d}`);
      const p = STJNavigator.montarData({ dataPubInicio: '01/01/2025' });
      assert(p === '@DTPB >= "20250101"', `veio: ${p}`);
    });

    await teste('Busca simples devolve total e documentos', async () => {
      const r = await navigator.buscar({ query: TERMO });
      assert(typeof r.total === 'number' && r.total > 1000, `total inesperado: ${r.total}`);
      contagem.semFiltro = r.total;
      const docs = await navigator.extrair(r.html);
      assert(docs.length === 10, `esperava 10 documentos na página, veio ${docs.length}`);
    });

    await teste('ENCODING: termo acentuado não zera a busca', async () => {
      const comAcento = await navigator.buscar({ query: 'usucapião' });
      const semAcento = await navigator.buscar({ query: 'usucapiao' });
      assert(comAcento.total > 0, 'termo acentuado devolveu 0 — encoding quebrado (o sintoma clássico)');
      assert(comAcento.total === semAcento.total,
        `acento mudou a contagem (${comAcento.total} × ${semAcento.total}) — o índice deveria ser insensível`);
      contagem.usucapiao = comAcento.total;
    });

    await teste('FILTRO DE DATA restringe de fato', async () => {
      const ano = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF });
      const semestre = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: '30/06/2025' });
      contagem.ano2025 = ano.total;
      contagem.sem1_2025 = semestre.total;
      assert(ano.total < contagem.semFiltro, `data não restringiu: ${ano.total} vs ${contagem.semFiltro}`);
      assert(semestre.total < ano.total, `semestre não restringiu: ${semestre.total} vs ${ano.total}`);
    });

    await teste('Data de JULGAMENTO e de PUBLICAÇÃO são filtros diferentes', async () => {
      const julg = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF });
      const publ = await navigator.buscar({ query: TERMO, dataPubInicio: DI, dataPubFim: DF });
      contagem.publ2025 = publ.total;
      assert(publ.total !== julg.total,
        `julgamento e publicação deram o MESMO total (${julg.total}) — um dos dois não está sendo aplicado`);
    });

    await teste('DESAMBIGUAÇÃO por ÓRGÃO: cada órgão muda a contagem e a soma fecha', async () => {
      const codigos = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'S1', 'S2', 'S3', 'CE', 'PS', 'VP'];
      const porOrgao = {};
      let soma = 0;
      for (const c of codigos) {
        const r = await navigator.buscar({ query: TERMO, orgaos: [c] });
        porOrgao[c] = r.total;
        soma += r.total;
      }
      contagem.porOrgao = porOrgao;
      contagem.somaOrgaos = soma;
      assert(porOrgao.T3 > 0 && porOrgao.T4 > 0, 'Terceira/Quarta Turma sem resultados');
      assert(porOrgao.T3 !== porOrgao.T4, 'T3 e T4 com a mesma contagem — filtro suspeito');
      assert(soma === contagem.semFiltro,
        `a soma dos 12 órgãos (${soma}) deveria fechar com o total sem filtro (${contagem.semFiltro})`);
    });

    await teste('Órgãos combinados somam os individuais', async () => {
      const juntos = await navigator.buscar({ query: TERMO, orgaos: ['T3', 'T4'] });
      const esperado = contagem.porOrgao.T3 + contagem.porOrgao.T4;
      assert(juntos.total === esperado, `T3,T4 = ${juntos.total}, esperado ${esperado}`);
    });

    await teste('DESAMBIGUAÇÃO por BASE: acórdãos × monocráticas são acervos distintos', async () => {
      const acor = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, base: 'acordao' });
      const dtxt = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, base: 'monocratica' });
      contagem.acordaos2025 = acor.total;
      contagem.monocraticas2025 = dtxt.total;
      assert(typeof dtxt.total === 'number', `base de monocráticas não respondeu: ${dtxt.total}`);
      assert(dtxt.total !== acor.total, 'ACOR e DTXT com a mesma contagem — a base não está sendo trocada');
    });

    await teste('OPERADORES: cada um muda o resultado (não vira palavra literal)', async () => {
      const q = async (livre) => (await navigator.buscar({ query: livre })).total;
      const ops = {
        implicito: await q('usucapião extraordinária'),
        e: await q('usucapião e extraordinária'),
        ou: await q('usucapião ou extraordinária'),
        nao: await q('usucapião não extraordinária'),
        adj: await q('usucapião adj extraordinária'),
        prox10: await q('usucapião prox10 extraordinária'),
        radical: await q('usucapi$'),
        semRadical: await q('usucapião'),
      };
      contagem.operadores = ops;
      assert(ops.ou > ops.e, `OU (${ops.ou}) deveria ampliar sobre E (${ops.e})`);
      assert(ops.nao > 0 && ops.nao < ops.semRadical, `NÃO não excluiu nada: ${ops.nao}`);
      assert(ops.adj < ops.e, `ADJ (${ops.adj}) deveria restringir sobre E (${ops.e})`);
      assert(ops.radical > ops.semRadical, `$ (${ops.radical}) deveria ampliar sobre o termo cru (${ops.semRadical})`);
    });

    await teste('NOTA "repetitivos" isola os precedentes qualificados', async () => {
      const semNota = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF });
      const comNota = await navigator.buscar({
        query: TERMO, dataInicio: DI, dataFim: DF, nota: STJNavigator.NOTAS.repetitivos,
      });
      contagem.repetitivos2025 = comNota.total;
      assert(comNota.total > 0, 'nota repetitivos devolveu 0');
      assert(comNota.total < semNota.total, `nota não restringiu: ${comNota.total} vs ${semNota.total}`);
    });

    await teste('Crawler: mapeia os campos do espelho do acórdão', async () => {
      const res = await crawler.search(TERMO, { dataInicio: DI, dataFim: DF }, { maxPages: 1, keepOpen: true });
      assert(res.length === 10, `esperava 10 resultados, veio ${res.length}`);
      primeiro = res[0];
      assert(primeiro.processo && /^[A-Za-z]+\s+\d+/.test(primeiro.processo),
        `processo mal extraído: "${primeiro.processo}"`);
      assert(/^[A-Z]{2}$/.test(primeiro.uf), `UF mal extraída: "${primeiro.uf}" (o <br> do espelho gruda os campos)`);
      assert(/^\d{12}$/.test(primeiro.registro || ''), `registro mal extraído: "${primeiro.registro}"`);
      assert(primeiro.orgaoJulgador.includes('-'), `órgão mal extraído: "${primeiro.orgaoJulgador}"`);
      assert(/^\d{2}\/\d{2}\/\d{4}$/.test(primeiro.dataJulgamento), `data mal extraída: "${primeiro.dataJulgamento}"`);
      assert(primeiro.ementa.length > 200, `ementa curta demais: ${primeiro.ementa.length}`);
      assert(!primeiro.ementa.includes('�'), 'mojibake na ementa — decodificação latin-1 quebrou');
      assert(primeiro.inteiroTeorLink, 'sem link de inteiro teor');
    });

    await teste('PAGINAÇÃO anda além da página 1', async () => {
      const p1 = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, inicio: 1 });
      const p2 = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, inicio: 11 });
      const d1 = await navigator.extrair(p1.html);
      const d2 = await navigator.extrair(p2.html);
      assert(d2.length > 0, 'página 2 vazia');
      assert(d1[0].id !== d2[0].id, `página 2 repetiu a 1 (id ${d1[0].id})`);
      const idsP1 = new Set(d1.map((d) => d.id));
      assert(!d2.some((d) => idsP1.has(d.id)), 'páginas 1 e 2 têm documentos em comum');
    });

    await teste('porPagina=50 traz 50 documentos numa requisição', async () => {
      const r = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, porPagina: 50 });
      const docs = await navigator.extrair(r.html);
      assert(docs.length === 50, `esperava 50, veio ${docs.length}`);
    });

    await teste('ORDENAÇÃO por data muda a primeira página', async () => {
      const rec = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, ordenacao: STJNavigator.ORDENACOES.recentes });
      const ant = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, ordenacao: STJNavigator.ORDENACOES.antigos });
      const a = (await navigator.extrair(rec.html))[0];
      const b = (await navigator.extrair(ant.html))[0];
      assert(a.id !== b.id, 'recentes e antigos devolveram o mesmo primeiro documento');
    });

    await teste('Paginação PROFUNDA falha de forma detectável (ORA-01013)', async () => {
      const fundo = await navigator.buscar({ query: TERMO, dataInicio: DI, dataFim: DF, inicio: 1301 });
      assert(fundo.total === 'timeout' || typeof fundo.total === 'number',
        `estado de paginação profunda não reconhecido: ${fundo.total}`);
      contagem.paginacaoProfunda = fundo.total === 'timeout' ? 'ORA-01013 (esperado)' : 'respondeu';
    });

    await teste('Checker: classifica os dois formatos de numeração do STJ', async () => {
      assert(STJChecker.classificar('REsp 1809043').tipo === 'recurso', 'REsp não classificado');
      assert(STJChecker.classificar('2019/0116080-0').tipo === 'registro', 'registro não classificado');
      assert(STJChecker.classificar('201901160800').tipo === 'registro', 'registro cru não classificado');
      assert(STJChecker.classificar('0000538-97.2015.4.05.8500').tipo === 'cnj', 'CNJ não classificado');
    });

    await teste('Checker: encontra um julgado conhecido pelo nº do recurso', async () => {
      const res = await checker.consultarProcesso('REsp 1809043');
      assert(res.encontrado, 'REsp 1809043 não encontrado');
      assert(res.fonte === 'scon', `fonte inesperada: ${res.fonte}`);
      assert(res.julgados.some((j) => j.registro === '201901160800'),
        `registro 201901160800 ausente entre ${res.julgados.map((j) => j.registro).join(', ')}`);
    });

    await teste('Checker: encontra o mesmo julgado pelo nº de REGISTRO', async () => {
      const res = await checker.consultarProcesso('2019/0116080-0');
      assert(res.encontrado, 'registro 2019/0116080-0 não encontrado');
      assert(res.julgados[0].processo.includes('1809043'), `julgado inesperado: ${res.julgados[0].processo}`);
    });

    await teste('Checker: número inexistente devolve não-encontrado', async () => {
      const res = await checker.consultarProcesso('REsp 99999999');
      assert(!res.encontrado, 'número inventado foi dado como encontrado');
    });

    await teste('Checker: número CNJ cai no DataJud, com ressalva explícita', async () => {
      const res = await checker.consultarProcesso('0000538-97.2015.4.05.8500');
      assert(res.fonte === 'datajud', `esperava fallback para o DataJud, veio ${res.fonte}`);
      assert(/DataJud/.test(res.ressalva), 'ressalva do DataJud ausente');
    });

    await teste('Auditoria (--verificar) confirma a amostra', async () => {
      const res = await crawler.search(TERMO, { dataInicio: DI, dataFim: DF }, { maxPages: 1, keepOpen: true });
      const auditor = new STJChecker({ navigator });
      const audit = await auditor.verificarResultados(res, { amostra: 3 });
      contagem.auditoria = `${audit.confirmados}/${audit.verificados}`;
      assert(audit.verificados === 3, `esperava 3 verificados, veio ${audit.verificados}`);
      assert(audit.confirmados === 3,
        `divergências: ${JSON.stringify(audit.detalhes.filter((d) => !d.confirmado))}`);
    });

    if (!rapido) {
      await teste('Navigator: baixa o inteiro teor e grava em disco', async () => {
        assert(primeiro?.inteiroTeorLink, 'sem link de inteiro teor');
        const { html, texto } = await navigator.baixarInteiroTeor(primeiro.inteiroTeorLink);
        assert(html.length > 5000, `HTML muito curto: ${html.length}`);
        assert(texto.length > 1000, `texto muito curto: ${texto.length}`);
        assert(!texto.includes('�'), 'mojibake — decodificação de charset quebrou');

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stj-testes-'));
        try {
          const lote = await navigator.baixarLote([primeiro], dir, { log: () => {}, formats: ['txt'] });
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

  // O módulo de precedentes qualificados vive em OUTRO host, sem Cloudflare, e
  // sobe o seu próprio browser headless — por isso vem depois de fechar o SCON
  // (um Chromium por vez).
  if (!rapido) {
    await teste('Precedentes qualificados: temas repetitivos por termo', async () => {
      const c = new STJCrawler({ log: () => {} });
      const temas = await c.buscarTemas('usucapião', { tipo: 'repetitivo' }, { porPagina: 10 });
      contagem.temasUsucapiao = temas.totalResults;
      assert(temas.totalResults > 0, 'nenhum tema repetitivo para "usucapião"');
      assert(temas.length > 0, 'nenhum tema extraído');
      assert(temas.some((t) => t.teseFirmada), 'nenhum tema com Tese Firmada');
      assert(temas[0].tema, `tema sem número: ${JSON.stringify(temas[0]).slice(0, 200)}`);
    });
  }

  console.log('='.repeat(60));
  console.log(`Contagens observadas: ${JSON.stringify(contagem, null, 2)}`);
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
