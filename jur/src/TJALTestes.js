// src/TJALTestes.js
// Suíte de testes do stack TJAL (Navigator, Crawler, Checker) — e-SAJ cjsg.
// Bate no site real — precisa de rede. Uso:
//   node src/TJALTestes.js            # suíte completa
//   node src/TJALTestes.js --rapido   # pula a gravação em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJALNavigator = require('./TJALNavigator');
const TJALCrawler = require('./TJALCrawler');
const TJALChecker = require('./TJALChecker');

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

/** O cjsg responde por mais de um nó (`.cjsg1`/`.cjsg2`). Tolerância pequena. */
const proximos = (a, b, tolerancia = 0.01) =>
  Math.abs(a - b) <= Math.max(5, Math.max(a, b) * tolerancia);

(async () => {
  console.log('='.repeat(60));
  console.log('TJAL — Testes de integração (site real, e-SAJ cjsg)');
  console.log('='.repeat(60));

  const navigator = new TJALNavigator();
  const checker = new TJALChecker({ navigator });
  let julgadoBase = null;
  let totalComum = 0;

  await teste('busca simples devolve resultados e total exato', async () => {
    const r = await navigator.buscar({ query: 'dano moral' });
    assert(r.total > 1000, `total baixo demais: ${r.total}`);
    assert(r.resultados.length === TJALNavigator.POR_PAGINA,
      `esperava ${TJALNavigator.POR_PAGINA} cards, veio ${r.resultados.length}`);
    assert(!r.formularioDeVolta, 'o cjsg devolveu o formulário em vez do resultado');
    totalComum = r.total;
    julgadoBase = r.resultados[0];
  });

  await teste('a página é de 20 — não 10 (TJAM) nem 100 (TJMS)', async () => {
    assert(TJALNavigator.POR_PAGINA === 20, `POR_PAGINA=${TJALNavigator.POR_PAGINA}`);
  });

  await teste('o card traz ementa íntegra, citação e os metadados', async () => {
    assert(julgadoBase, 'sem julgado da busca anterior');
    for (const campo of ['cdAcordao', 'processo', 'relator', 'orgaoJulgador', 'dataJulgamento', 'dataPublicacao']) {
      assert(julgadoBase[campo], `campo vazio: ${campo}`);
    }
    assert(julgadoBase.ementa.length > 500,
      `ementa curta demais (${julgadoBase.ementa.length}) — no TJAL a média em acórdão é 4.746`);
    assert(!/Data de registro/i.test(julgadoBase.ementa),
      'o rodapé de citação vazou para dentro da ementa');
    assert(/Número do Processo:/i.test(julgadoBase.citacao),
      `a citação do TJAL abre por "Número do Processo:" — veio: ${julgadoBase.citacao.slice(0, 80)}`);
  });

  await teste('a desambiguação origem muda a contagem e SOMA exato', async () => {
    const t = await navigator.buscar({ query: 'dano moral', origens: ['T'] });
    const r = await navigator.buscar({ query: 'dano moral', origens: ['R'] });
    const tr = await navigator.buscar({ query: 'dano moral', origens: ['T', 'R'] });
    assert(t.total !== r.total, 'T e R devolveram o mesmo total — o filtro está sendo ignorado');
    assert(proximos(t.total + r.total, tr.total),
      `T+R (${t.total}+${r.total}) não bate com a busca conjunta (${tr.total})`);
  });

  await teste('🔴 SENTINELA: em Alagoas a Justiça Comum é MAIOR que o Juizado', async () => {
    const t = await navigator.buscar({ query: 'dano moral', origens: ['T'] });
    const r = await navigator.buscar({ query: 'dano moral', origens: ['R'] });
    // Medido em 05/08/2026: 103.280 × 31.474 (3,3× a favor do 2º grau) — o
    // OPOSTO do TJAC (2,8×) e do TJAM (7,7×) a favor do Juizado. Se isto virar,
    // o CLAUDE-TJAL.md e o roteamento da skill browser precisam mudar junto.
    assert(t.total > r.total,
      `A relação inverteu: 2º grau=${t.total}, Colégios Recursais=${r.total}. ` +
      'Atualize CLAUDE-TJAL.md e skills/browser/SKILL.md em vez de "consertar" o teste.');
  });

  await teste('🔴 SENTINELA: a base do TJAL continua CORRENTE', async () => {
    // A lição do TJAM: o crawler fica verde e a base está morta. Aqui a base
    // estava viva em 05/08/2026 (jul/2026 = 981 publicações para `dano moral`).
    // Este teste falha se ela congelar — que é exatamente o que se quer saber.
    const ano = new Date().getFullYear();
    const r = await navigator.buscar({
      query: 'dano moral',
      dataPublicacaoInicio: `01/01/${ano}`,
      dataPublicacaoFim: `31/12/${ano}`,
    });
    assert(!r.formularioDeVolta, 'busca recusada — não dá para concluir nada sobre a base');
    assert(r.total > 100,
      `a base do TJAL parece ter PARADO: ${ano} devolveu só ${r.total} publicações ` +
      '(em 05/08/2026, jan–jul/2026 tinha 11.483). Meça a distribuição por ano e ' +
      'atualize CLAUDE-TJAL.md com o alerta de base congelada, como no TJAM.');
  });

  await teste('acento NÃO importa (ao contrário do TJMS)', async () => {
    const sem = await navigator.buscar({ query: 'usucapiao' });
    const com = await navigator.buscar({ query: 'usucapião' });
    assert(proximos(sem.total, com.total),
      `o índice deixou de normalizar acento: usucapiao=${sem.total}, usucapião=${com.total}. ` +
      'Se isso persistir, o TJAL passou a se comportar como o TJMS — atualize as ressalvas.');
  });

  await teste('`NAO` é operador e `NÃO` acentuado não é (prova aritmética)', async () => {
    const dano = await navigator.buscar({ query: 'dano' });
    const danoMoral = await navigator.buscar({ query: 'dano moral' });
    const excl = await navigator.buscar({ query: 'dano NAO moral' });
    assert(proximos(danoMoral.total + excl.total, dano.total),
      `"dano moral" (${danoMoral.total}) + "dano NAO moral" (${excl.total}) ` +
      `deveria dar "dano" (${dano.total})`);
    const acentuado = await navigator.buscar({ query: 'dano NÃO moral' });
    assert(!proximos(acentuado.total, excl.total),
      '`NÃO` acentuado passou a funcionar como operador — atualize a ressalva 5');
  });

  await teste('`ADJ`/`PROX` zeram a busca sem erro', async () => {
    for (const q of ['dano ADJ2 moral', 'dano PROX5 moral']) {
      const r = await navigator.buscar({ query: q });
      assert(r.total === 0, `"${q}" devolveu ${r.total} — o operador passou a existir?`);
    }
  });

  await teste('`$` degenera (não zera) — 2 resultados, não 114 mil', async () => {
    const r = await navigator.buscar({ query: 'dan$' });
    assert(r.total < 100,
      `"dan$" devolveu ${r.total} — se o radical passou a funcionar, atualize a ressalva`);
  });

  await teste('o aviso de operador dispara para ADJ/PROX, $ e NÃO', async () => {
    assert(TJALCrawler.avisarOperadores('dano ADJ2 moral').length === 1, 'ADJ não avisou');
    assert(TJALCrawler.avisarOperadores('dan$').length === 1, '$ não avisou');
    assert(TJALCrawler.avisarOperadores('dano NÃO moral').length === 1, 'NÃO acentuado não avisou');
    assert(TJALCrawler.avisarOperadores('dano moral').length === 0, 'avisou numa query limpa');
  });

  await teste('intervalo acima de 1 ano é RECUSA, não zero', async () => {
    const r = await navigator.buscar({
      query: 'dano moral', dataPublicacaoInicio: '01/01/2023', dataPublicacaoFim: '31/12/2024',
    });
    assert(r.formularioDeVolta, 'esperava o formulário de volta (recusa)');
    assert(r.avisoIntervalo, 'a tela devia trazer o aviso de faixa de 1 ano');
  });

  await teste('o teto de data é de CALENDÁRIO, não de dias corridos', async () => {
    // dois intervalos de 366 dias com respostas opostas provam a regra
    const aceita = await navigator.buscar({
      query: 'dano moral', dataPublicacaoInicio: '01/03/2023', dataPublicacaoFim: '29/02/2024',
    });
    const recusa = await navigator.buscar({
      query: 'dano moral', dataPublicacaoInicio: '15/06/2023', dataPublicacaoFim: '15/06/2024',
    });
    assert(!aceita.formularioDeVolta, '01/03/2023→29/02/2024 (366 dias) devia ser aceito');
    assert(recusa.formularioDeVolta, '15/06/2023→15/06/2024 (366 dias) devia ser recusado');
  });

  await teste('o fatiador de janelas respeita a data-aniversário', async () => {
    assert(TJALCrawler.janelas('01/01/2025', '31/12/2025') === null, 'fatiou um ano que cabia');
    const j = TJALCrawler.janelas('01/01/2024', '31/12/2025');
    assert(j && j.length === 2, `esperava 2 janelas, veio ${j && j.length}`);
    assert(j[0][1] === '31/12/2024', `1ª janela termina em ${j[0][1]}`);
    // 29/02 tratado pelo setFullYear, sem estourar
    const bi = TJALCrawler.janelas('29/02/2024', '31/12/2025');
    assert(bi && bi[0][1] === '28/02/2025', `ano bissexto: ${bi && bi[0][1]}`);
  });

  await teste('filtro de data restringe de fato', async () => {
    const r = await navigator.buscar({
      query: 'dano moral', dataPublicacaoInicio: '01/07/2026', dataPublicacaoFim: '31/07/2026',
    });
    assert(r.total > 0 && r.total < totalComum,
      `filtro de julho/2026 deu ${r.total} contra ${totalComum} sem filtro`);
  });

  await teste('paginação anda e é estável na mesma sessão', async () => {
    const r = await navigator.buscar({
      query: 'dano moral', dataPublicacaoInicio: '01/07/2026', dataPublicacaoFim: '31/07/2026',
    });
    const assinatura = TJALNavigator.corpo({
      query: 'dano moral', dataPublicacaoInicio: '01/07/2026', dataPublicacaoFim: '31/07/2026',
    });
    const p2a = await navigator.paginar(2, 'A', assinatura);
    assert(p2a.resultados.length > 0, 'página 2 veio vazia');
    const idsP1 = new Set(r.resultados.map((x) => x.id));
    assert(!p2a.resultados.some((x) => idsP1.has(x.id)), 'a página 2 repetiu itens da 1');
    const p2b = await navigator.paginar(2, 'A', assinatura);
    assert(p2a.resultados.map((x) => x.id).join(',') === p2b.resultados.map((x) => x.id).join(','),
      'a mesma página devolveu documentos diferentes — ordenação sem desempate');
  });

  await teste('paginar sem sessão falha alto (HTTP 404), não devolve vazio', async () => {
    const virgem = new TJALNavigator();
    let erro = null;
    try { await virgem.paginar(2, 'A'); } catch (e) { erro = e; }
    assert(erro, 'paginar() sem sessão deveria lançar');
  });

  await teste('paginação órfã (outra busca na sessão) vira erro', async () => {
    const n = new TJALNavigator();
    const assinatura = TJALNavigator.corpo({ query: 'dano moral' });
    await n.buscar({ query: 'dano moral' });
    await n.buscar({ query: 'usucapião' });   // intercala outra busca
    let erro = null;
    try { await n.paginar(2, 'A', assinatura); } catch (e) { erro = e; }
    assert(erro && /ÚLTIMA busca/.test(erro.message),
      'paginar() aceitou uma paginação órfã — devolveria a busca errada com HTTP 200');
  });

  await teste('a aba D (monocrática) responde MESMO sem checkbox na tela', async () => {
    const r = await navigator.buscar({ query: 'dano moral', tipos: ['D'] });
    assert(r.totais.D !== undefined, 'a aba D nem respondeu');
    assert(r.resultados.length > 0,
      'a aba D devolveu total mas nenhum card — checkbox ausente virou aba inexistente?');
    assert(r.resultados[0].cdAcordao, 'card de monocrática sem cdAcordao');
  });

  await teste('a aba H devolve 0 (zero AMBÍGUO, documentado)', async () => {
    const r = await navigator.buscar({ query: 'dano moral', tipos: ['H'] });
    assert((r.totais.H ?? 0) === 0,
      `a aba H passou a devolver ${r.totais.H} — o zero deixou de ser ambíguo, meça e documente`);
  });

  await teste('--sem-sinonimos não muda a contagem (medido)', async () => {
    const com = await navigator.buscar({ query: 'dano moral' });
    const sem = await navigator.buscar({ query: 'dano moral', sinonimos: false });
    assert(proximos(com.total, sem.total),
      `sinônimos passou a mudar a contagem: ${com.total} × ${sem.total}. ` +
      'Isso é informação nova — documente em CLAUDE-TJAL.md.');
  });

  await teste('escopo inteiroTeor alarga a busca', async () => {
    const e = await navigator.buscar({ query: 'dano moral', escopo: 'ementa' });
    const i = await navigator.buscar({ query: 'dano moral', escopo: 'inteiroTeor' });
    assert(i.total > e.total, `inteiroTeor (${i.total}) devia ser maior que ementa (${e.total})`);
  });

  await teste('consulta por número acha o processo (com e sem máscara)', async () => {
    assert(julgadoBase, 'sem julgado da busca anterior');
    const num = julgadoBase.processo;
    const comMascara = await checker.consultarProcesso(num);
    assert(comMascara.encontrado, `não achou ${num}`);
    assert(comMascara.tjal, 'o CNJ não foi reconhecido como do TJAL (8.02)');
    const semMascara = await checker.consultarProcesso(num.replace(/\D/g, ''));
    assert(semMascara.encontrado, 'não achou sem máscara');
  });

  await teste('número inexistente não é encontrado', async () => {
    const r = await checker.consultarProcesso('0000000-00.0000.8.02.0000');
    assert(!r.encontrado, 'um número inventado foi "encontrado"');
  });

  await teste('🔴 SENTINELA: o inteiro teor continua atrás de reCAPTCHA', async () => {
    assert(julgadoBase, 'sem julgado da busca anterior');
    let erro = null;
    try { await navigator.inteiroTeor(julgadoBase.cdAcordao, julgadoBase.cdForo); } catch (e) { erro = e; }
    assert(erro && /reCAPTCHA/.test(erro.message),
      'O getArquivo.do do TJAL devolveu algo que não é o captcha — o BLOQUEIO PODE TER CAÍDO. ' +
      'Reteste e atualize CLAUDE-TJAL.md em vez de "consertar" o teste.');
  });

  await teste('🔴 SENTINELA: continua sem permalink (resultado em sessão limpa)', async () => {
    // sem cookie nenhum, o resultadoCompleta.do não devolve card algum
    const res = await fetch(`${TJALNavigator.BASE}/resultadoCompleta.do`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const cards = (html.match(/class="fundocinza1"/g) || []).length;
    assert(cards === 0,
      `o resultadoCompleta.do devolveu ${cards} cards sem sessão — pode ter virado permalink. ` +
      'Se confirmar, atualize CLAUDE-TJAL.md: hoje ele diz que não existe permalink.');
  });

  await teste('crawler integra busca + paginação e não repete documento', async () => {
    const crawler = new TJALCrawler({ log: () => {} });
    const r = await crawler.search('dano moral', {
      dataPublicacaoInicio: '01/07/2026', dataPublicacaoFim: '31/07/2026',
    }, { maxPages: 2 });
    assert(r.length === 40, `esperava 40 (2 × 20), veio ${r.length}`);
    assert(new Set(r.map((x) => x.id)).size === r.length, 'o crawler repetiu documentos');
    assert(crawler.ultimaBusca.totalTJAL > 0, 'ultimaBusca sem total');
  });

  if (!rapido) {
    await teste('--fetch-inteiro-teor grava a ementa e diz que o PDF não veio', async () => {
      const crawler = new TJALCrawler({ log: () => {} });
      const r = await crawler.search('usucapião', {}, { maxPages: 1 });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjal-'));
      const saida = await crawler.fetchInteiroTeorBatch(r.slice(0, 3), dir, { log: () => {} });
      assert(saida.length === 3, `gravou ${saida.length} de 3`);
      const txt = fs.readFileSync(path.join(dir, saida[0].arquivo), 'utf-8');
      assert(txt.includes('=== EMENTA'), 'o arquivo não tem a seção de ementa');
      assert(/NÃO DISPONÍVEL/.test(txt), 'o arquivo não avisa que o inteiro teor não veio');
      assert(/NÃO EXISTE no TJAL/.test(txt), 'o arquivo não avisa que não há permalink');
      assert(saida[0].charsEmenta > 300, `ementa gravada muito curta: ${saida[0].charsEmenta}`);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  console.log('='.repeat(60));
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`${ok}/${resultados.length} testes passaram`);
  for (const r of resultados.filter((x) => !x.ok)) console.log(`  FAIL: ${r.nome} — ${r.erro}`);
  process.exit(ok === resultados.length ? 0 : 1);
})();
