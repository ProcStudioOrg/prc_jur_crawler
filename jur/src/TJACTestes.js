// src/TJACTestes.js
// Suíte de testes do stack TJAC (Navigator, Crawler, Checker) — e-SAJ cjsg.
// Bate no site real — precisa de rede. Uso:
//   node src/TJACTestes.js            # suíte completa
//   node src/TJACTestes.js --rapido   # pula a gravação em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const TJACNavigator = require('./TJACNavigator');
const TJACCrawler = require('./TJACCrawler');
const TJACChecker = require('./TJACChecker');

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

/** O cjsg responde por mais de um nó (`.cjsg1`, `.cjsg2`). Tolerância pequena. */
const proximos = (a, b, tolerancia = 0.01) =>
  Math.abs(a - b) <= Math.max(5, Math.max(a, b) * tolerancia);

(async () => {
  console.log('='.repeat(60));
  console.log('TJAC — Testes de integração (site real, e-SAJ cjsg)');
  console.log('='.repeat(60));

  const navigator = new TJACNavigator();
  const checker = new TJACChecker({ navigator });
  let julgadoBase = null;
  let totalComum = 0;

  await teste('busca simples devolve resultados e total exato', async () => {
    const r = await navigator.buscar({ query: 'dano moral' });
    assert(r.total > 1000, `total baixo demais: ${r.total}`);
    assert(r.resultados.length === TJACNavigator.POR_PAGINA,
      `esperava ${TJACNavigator.POR_PAGINA} cards, veio ${r.resultados.length}`);
    assert(!r.formularioDeVolta, 'o cjsg devolveu o formulário em vez do resultado');
    totalComum = r.total;
    julgadoBase = r.resultados[0];
  });

  await teste('o card traz ementa ÍNTEGRA, não trecho', async () => {
    assert(julgadoBase, 'sem julgado base');
    assert(julgadoBase.ementa.length > 500,
      `ementa curta demais (${julgadoBase.ementa.length} chars) — pode ser highlight, não a íntegra`);
    assert(!/<em>|<b>/i.test(julgadoBase.ementa), 'a ementa veio com marcação de highlight');
    assert(julgadoBase.citacao.startsWith('TJAC.'), `citação não separada: "${julgadoBase.citacao}"`);
    assert(!julgadoBase.ementa.includes('Data de registro'),
      'o rodapé de citação vazou para dentro da ementa');
  });

  await teste('metadados do card estão preenchidos', async () => {
    for (const campo of ['processo', 'classe', 'relator', 'comarca', 'orgaoJulgador',
      'dataJulgamento', 'dataPublicacao', 'cdAcordao']) {
      assert(julgadoBase[campo], `campo vazio: ${campo}`);
    }
    assert(julgadoBase.uf === 'AC' && julgadoBase.tribunal === 'TJAC', 'uf/tribunal errados');
  });

  await teste('NÃO existe permalink — inteiroTeorLink é null de propósito', async () => {
    assert(julgadoBase.inteiroTeorLink === null,
      'inteiroTeorLink deveria ser null: o getArquivo.do do TJAC exige reCAPTCHA e não é permalink');
    assert(julgadoBase.processoUrl === null, 'processoUrl deveria ser null');
    assert(String(julgadoBase.inteiroTeorUrlBloqueada).includes('getArquivo.do'),
      'faltou a URL bloqueada para diagnóstico');
  });

  await teste('desambiguação origem: turmas MUDA a contagem (e é maior)', async () => {
    const turmas = await navigator.buscar({ query: 'dano moral', origens: ['R'] });
    assert(!proximos(turmas.total, totalComum),
      `contagem igual com e sem o filtro (${totalComum} × ${turmas.total}) — filtro ignorado`);
    assert(turmas.total > totalComum,
      `no TJAC as Turmas Recursais têm MAIS acervo que o 2º grau; veio ${turmas.total} × ${totalComum}`);
  });

  await teste('tipo monocrática é aba própria e residual', async () => {
    const d = await navigator.buscar({ query: 'dano moral', tipos: ['D'] });
    assert(d.totais.D !== undefined, 'a aba D não respondeu');
    assert(d.totais.D > 0 && d.totais.D < totalComum / 10,
      `monocrática deveria ser acervo residual; veio ${d.totais.D}`);
  });

  await teste('filtro de data restringe de fato', async () => {
    const r = await navigator.buscar({
      query: 'dano moral', dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '31/03/2025',
    });
    assert(r.total > 0, 'o recorte de data devolveu zero');
    assert(r.total < totalComum / 5, `data não restringiu: ${r.total} de ${totalComum}`);
  });

  await teste('intervalo acima de 1 ano é RECUSA, não zero', async () => {
    const r = await navigator.buscar({
      query: 'dano moral', dataJulgamentoInicio: '01/01/2025', dataJulgamentoFim: '01/01/2026',
    });
    assert(r.formularioDeVolta, 'o estouro de 1 ano deveria devolver o formulário (totais vazio)');
    assert(r.avisoIntervalo, 'faltou o aviso "no máximo 1 ano" na página');
    // e o zero genuíno tem que ser distinguível dele
    const z = await navigator.buscar({ query: 'termoquenaoexiste0987654321' });
    assert(!z.formularioDeVolta, 'zero genuíno foi confundido com recusa');
    assert(z.totais.A === 0, `zero genuíno deveria expor totalResultadoAba-A=0, veio ${JSON.stringify(z.totais)}`);
  });

  await teste('paginação anda além da página 1 e é estável', async () => {
    // Navigator próprio: o trocaDePagina.do pagina a ÚLTIMA busca da sessão, e
    // reusar o navigator compartilhado pagina o que os testes anteriores deixaram.
    const nav2 = new TJACNavigator();
    const p1 = await nav2.buscar({ query: 'dano moral' });
    const idsP1 = new Set(p1.resultados.map((r) => r.id));
    const a = (await nav2.paginar(2, 'A')).resultados.map((r) => r.id);
    assert(a.length === TJACNavigator.POR_PAGINA, `página 2 veio com ${a.length} cards`);
    assert(![...idsP1].some((id) => a.includes(id)), 'página 2 repetiu documentos da página 1');
    // mesma página duas vezes: sem campo de desempate isto oscilaria
    const b = (await nav2.paginar(2, 'A')).resultados.map((r) => r.id);
    assert(a.join(',') === b.join(','),
      'a mesma página devolveu documentos diferentes entre requisições');
  });

  await teste('paginação ÓRFÃ vira erro (trocaDePagina segue a última busca)', async () => {
    const nav3 = new TJACNavigator();
    const assinatura = TJACNavigator.corpo({ query: 'dano moral' });
    await nav3.buscar({ query: 'dano moral' });
    await nav3.buscar({ query: 'usucapião' });          // outra busca na mesma sessão
    let lancou = false;
    try {
      await nav3.paginar(2, 'A', assinatura);
    } catch (err) {
      lancou = /última busca|ÚLTIMA busca/i.test(err.message);
    }
    assert(lancou, 'paginar() deveria recusar assinatura de outra busca em vez de ' +
      'devolver as páginas da busca errada com HTTP 200');
  });

  await teste('operadores: ADJ/PROX/$ zeram e o crawler avisa', async () => {
    const r = await navigator.buscar({ query: 'dano ADJ2 moral' });
    assert(r.total === 0, `ADJ deveria zerar neste portal, veio ${r.total}`);
    assert(TJACCrawler.avisarOperadores('dano ADJ2 moral').length > 0, 'faltou o aviso de ADJ');
    assert(TJACCrawler.avisarOperadores('usucapi$').length > 0, 'faltou o aviso de $');
    assert(TJACCrawler.avisarOperadores('dano NÃO moral').length > 0, 'faltou o aviso de NÃO acentuado');
    assert(TJACCrawler.avisarOperadores('dano moral').length === 0, 'aviso falso-positivo numa query boa');
  });

  await teste('acento NÃO muda a busca (o oposto do TJMS)', async () => {
    const sem = await navigator.buscar({ query: 'usucapiao' });
    const com = await navigator.buscar({ query: 'usucapião' });
    assert(proximos(sem.total, com.total),
      `o índice do TJAC normaliza acento; veio ${sem.total} × ${com.total}. ` +
      'Se isto falhar, o portal mudou e o CLAUDE-TJAC.md precisa da ressalva de acento.');
  });

  await teste('consulta por número encontra processo conhecido', async () => {
    const res = await checker.consultarProcesso(julgadoBase.numeroProcesso);
    assert(res.encontrado, `processo ${julgadoBase.numeroProcesso} não encontrado`);
    assert(res.formatoCNJ && res.tjac, 'o número não foi reconhecido como CNJ do TJAC');
    assert(res.decisoes.some((d) => d.cdAcordao === julgadoBase.cdAcordao),
      'o cdAcordao do julgado não voltou na reconsulta');
  });

  await teste('consulta por número aceita com e sem máscara', async () => {
    const semMascara = julgadoBase.numeroProcesso.replace(/\D/g, '');
    const res = await checker.consultarProcesso(semMascara);
    assert(res.encontrado, 'a consulta sem máscara falhou');
  });

  await teste('fatiamento de intervalo longo em janelas de 364 dias', async () => {
    const j = TJACCrawler.janelas('01/01/2024', '04/08/2026');
    assert(j && j.length === 3, `esperava 3 janelas, veio ${j ? j.length : 'null'}`);
    assert(TJACCrawler.janelas('01/01/2025', '31/12/2025') === null,
      'intervalo que já cabe não deveria ser fatiado');
  });

  await teste('--verificar confirma a amostra', async () => {
    const crawler = new TJACCrawler({ navigator: new TJACNavigator() });
    const lote = await crawler.search('usucapião', {}, { maxPages: 1 });
    assert(lote.length > 0, 'a busca de apoio não devolveu nada');
    const v = await checker.verificarResultados(lote, { amostra: 3 });
    assert(v.confirmados === v.verificados,
      `${v.confirmados}/${v.verificados} confirmados — divergência na auditoria`);
  });

  await teste('inteiro teor: o bloqueio por reCAPTCHA é detectado, não mascarado', async () => {
    try {
      const doc = await navigator.inteiroTeor(julgadoBase.cdAcordao, julgadoBase.cdForo);
      // se chegou aqui, o bloqueio caiu — não é falha do teste, é notícia
      console.log('\n    🎉 O getArquivo.do devolveu PDF ' +
        `(${doc.bytes} bytes): o reCAPTCHA do TJAC PODE TER CAÍDO. ` +
        'Reveja CLAUDE-TJAC.md, o Navigator e a cobertura.');
      assert(doc.ehPdf, 'veio algo que não é PDF sem disparar o erro de captcha');
    } catch (err) {
      assert(/reCAPTCHA/i.test(err.message),
        `o erro deveria identificar o reCAPTCHA, veio: ${err.message}`);
    }
  });

  if (!rapido) {
    await teste('--fetch-inteiro-teor grava a ementa e DIZ que o PDF não veio', async () => {
      const crawler = new TJACCrawler({ navigator: new TJACNavigator(), log: () => {} });
      const lote = (await crawler.search('usucapião', {}, { maxPages: 1 })).slice(0, 2);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjac-it-'));
      try {
        const saida = await crawler.fetchInteiroTeorBatch(lote, dir, { log: () => {} });
        assert(saida.length === lote.length, 'nem todo julgado gerou arquivo');
        assert(fs.existsSync(path.join(dir, 'index.json')), 'index.json ausente');
        const txt = fs.readFileSync(path.join(dir, saida[0].arquivo), 'utf-8');
        assert(txt.includes('=== EMENTA (íntegra, vinda da própria busca) ==='), 'seção de ementa ausente');
        assert(txt.split('=== EMENTA (íntegra, vinda da própria busca) ===')[1].trim().length > 500,
          'a ementa gravada está vazia ou curta demais');
        assert(txt.includes('NÃO DISPONÍVEL'),
          'o arquivo precisa dizer explicitamente que o inteiro teor não veio');
        assert(txt.includes('Permalink: NÃO EXISTE'),
          'o arquivo precisa registrar que o TJAC não tem permalink');
        assert(!/%PDF-/.test(txt), 'HTML/PDF cru vazou para dentro do .txt');
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
