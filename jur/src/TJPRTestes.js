// src/TJPRTestes.js
/**
 * Suíte de integração do TJPR — bate no site de verdade.
 *
 *   node src/TJPRTestes.js            (tudo)
 *   node src/TJPRTestes.js --rapido   (pula o que é lento: paginação e inteiro teor)
 *
 * Cobre os cenários mapeados em human-codegen/TJPR/01-jurisprudencia/
 * 10-testes-exploratorios-e-pendencias.txt, com destaque para os dois que
 * escondem defeito silencioso neste tribunal:
 *   - charset ISO-8859-1 no corpo do POST (§1 das ressalvas)
 *   - separação Justiça Comum × Juizados pelo `--foro` (§3 do mapeamento)
 */
const TJPRNavigator = require('./TJPRNavigator');
const TJPRCrawler = require('./TJPRCrawler');
const TJPRChecker = require('./TJPRChecker');

const RAPIDO = process.argv.includes('--rapido');
const JANELA = { dataJulgamentoInicio: '01/01/2026', dataJulgamentoFim: '31/03/2026' };

let ok = 0, falhas = 0;
const testes = [];
const teste = (nome, fn, { lento = false } = {}) => testes.push({ nome, fn, lento });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert falhou');
}

// ---------------------------------------------------------------- 1. offline

teste('encodeLatin1 gera bytes ISO-8859-1 (não UTF-8)', () => {
  const e = TJPRNavigator.encodeLatin1('usucapião');
  assert(e === 'usucapi%E3o', `esperado usucapi%E3o, veio ${e}`);
  assert(!e.includes('%C3'), 'saiu UTF-8 (%C3) — o servidor leria torto');
  assert(TJPRNavigator.encodeLatin1('a b') === 'a+b', 'espaço deve virar +');
  return 'usucapião -> usucapi%E3o';
});

teste('montarFormulario manda os campos obrigatórios e omite os vazios', () => {
  const body = TJPRNavigator.montarFormulario({ query: 'dano moral', pagina: 3 });
  assert(body.includes('criterioPesquisa=dano+moral'), 'sem criterioPesquisa');
  assert(body.includes('idsTipoDecisaoSelecionados=-1'), 'sem tipo de decisão (loadSubmit exige)');
  assert(body.includes('segredoJustica=pesquisar+com'), 'sem segredoJustica');
  assert(body.includes('pageNumber=3'), 'sem pageNumber');
  assert(!body.includes('processo='), 'campo vazio não deveria ir');
  return body.slice(0, 90) + '...';
});

teste('classificação de foro por órgão julgador', () => {
  const casos = [
    ['3ª Turma Recursal', 'juizados'],
    ['5ª Turma Recursal dos Juizados Especiais', 'juizados'],
    ['Turma Recursal Única', 'juizados'],
    ['Turmas Recursais Reunidas', 'juizados'],
    ['1ª Turma de Uniformização de Jurisprudência', 'juizados'],
    ['Núcleo de Conciliação - Turmas Recursais', 'juizados'],
    ['1ª Câmara Cível', 'comum'],
    ['6ª Câmara Criminal', 'comum'],
    ['Órgão Especial', 'comum'],
    ['1ª Vice-Presidência', 'comum'],
    ['Quarta Câmara Cível (extinto TA)', 'comum'],
    ['', 'indefinido'],
  ];
  for (const [orgao, esperado] of casos) {
    const got = TJPRNavigator.foro(orgao);
    assert(got === esperado, `"${orgao}": esperado ${esperado}, veio ${got}`);
  }
  return `${casos.length} órgãos classificados`;
});

teste('lista de órgãos do mapeamento carregada e particionada', () => {
  const todos = TJPRNavigator.orgaos();
  assert(todos.length > 100, `só ${todos.length} órgãos — 06-orgaos.json não carregou?`);
  const j = TJPRNavigator.orgaosPorForo('juizados');
  const c = TJPRNavigator.orgaosPorForo('comum');
  assert(j.length + c.length === todos.length, 'partição não fecha');
  assert(j.length >= 15, `poucos órgãos de juizados: ${j.length}`);
  const ids = TJPRNavigator.idsDoForo('juizados').split(',');
  assert(ids.length === j.length, 'idsDoForo não bate com a lista');
  assert(TJPRNavigator.idsDoForo('todos') === '', '"todos" não deve filtrar órgão');
  return `${todos.length} órgãos (${c.length} comum / ${j.length} juizados)`;
});

teste('acharOrgao resolve por nome sem acento e por id', () => {
  const a = TJPRNavigator.acharOrgao('3a Turma Recursal') || TJPRNavigator.acharOrgao('Turma Recursal');
  assert(a, 'não achou por nome');
  const b = TJPRNavigator.acharOrgao('249');
  assert(b && b.id === 249, 'não achou por id');
  return `id 249 = ${b.nome}`;
});

// ------------------------------------------------------------- 2. busca (rede)

teste('busca simples devolve julgados e separa o total da Corte IDH', async () => {
  const nav = new TJPRNavigator();
  const r = await nav.buscar({ query: 'dano moral', ...JANELA });
  assert(r.resultados.length > 0, 'zero resultados');
  assert(r.totais.tj > 0, 'total do TJPR zerado');
  assert(r.totais.geral >= r.totais.tj, 'geral menor que o do TJPR');
  assert(r.resultados.every((x) => !/Corte IDH|^Caso:/.test(x.tipoDocumento + x.numeroProcesso)),
    'linha da Corte IDH vazou para os resultados');
  assert(r.resultados.every((x) => x.uf === 'PR'), 'uf errada');
  return `${r.resultados.length} julgados · tj=${r.totais.tj} cidh=${r.totais.cidh} páginas=${r.paginas}`;
});

teste('CHARSET: termo acentuado em latin1 acha o mesmo que sem acento', async () => {
  const nav = new TJPRNavigator();
  const comAcento = await nav.buscar({ query: 'usucapião', ...JANELA });
  const semAcento = await nav.buscar({ query: 'usucapiao', ...JANELA });
  assert(comAcento.totais.tj > 0, 'termo acentuado devolveu ZERO — corpo do POST não está em ISO-8859-1');
  assert(comAcento.totais.tj === semAcento.totais.tj,
    `acentuado ${comAcento.totais.tj} != sem acento ${semAcento.totais.tj}`);
  return `usucapião = usucapiao = ${comAcento.totais.tj}`;
});

teste('DESAMBIGUAÇÃO: comum + juizados = todos, e sem sobreposição', async () => {
  const crawler = new TJPRCrawler({ log: () => {} });
  const pega = async (foro) => {
    const res = await crawler.search('dano moral', { foro, ...JANELA }, { maxPages: 1 });
    return { res, total: crawler.ultimaBusca.totalTJPR, foras: crawler.ultimaBusca.forasDoForo };
  };
  const comum = await pega('comum');
  const juiz = await pega('juizados');
  const todos = await pega('todos');

  assert(comum.total > 0 && juiz.total > 0, 'uma das pontas voltou vazia');
  assert(comum.total + juiz.total === todos.total,
    `partição não fecha: ${comum.total} + ${juiz.total} != ${todos.total}`);
  assert(comum.foras === 0, `${comum.foras} julgados fora do foro comum`);
  assert(juiz.foras === 0, `${juiz.foras} julgados fora do foro juizados`);
  assert(comum.res.every((x) => x.foro === 'comum'), 'resultado de comum com foro errado');
  assert(juiz.res.every((x) => x.foro === 'juizados'), 'resultado de juizados com foro errado');

  const idsComum = new Set(comum.res.map((x) => x.id));
  const inter = juiz.res.filter((x) => idsComum.has(x.id));
  assert(inter.length === 0, `${inter.length} ids em comum entre os dois foros`);
  return `comum ${comum.total} + juizados ${juiz.total} = ${todos.total}`;
});

teste('filtro de data restringe de fato', async () => {
  const nav = new TJPRNavigator();
  const amplo = await nav.buscar({ query: 'usucapião extraordinária' });
  const estreito = await nav.buscar({ query: 'usucapião extraordinária', ...JANELA });
  assert(estreito.totais.tj > 0, 'janela devolveu zero');
  assert(estreito.totais.tj < amplo.totais.tj,
    `data não restringiu: ${amplo.totais.tj} -> ${estreito.totais.tj}`);
  return `sem data ${amplo.totais.tj} -> com data ${estreito.totais.tj}`;
});

teste('escopo ementa != inteiro teor', async () => {
  const nav = new TJPRNavigator();
  const em = await nav.buscar({ query: 'usucapião', escopo: TJPRNavigator.ESCOPOS.ementa, ...JANELA });
  const it = await nav.buscar({ query: 'usucapião', escopo: TJPRNavigator.ESCOPOS.inteiroTeor, ...JANELA });
  assert(em.totais.tj !== it.totais.tj, `mesmo total nos dois escopos (${em.totais.tj}) — filtro ignorado?`);
  return `ementa ${em.totais.tj} · inteiro teor ${it.totais.tj}`;
});

teste('paginação anda além da página 1, sem repetir julgado', async () => {
  const crawler = new TJPRCrawler({ log: () => {} });
  const res = await crawler.search('dano moral', { ...JANELA }, { maxPages: 3 });
  const ids = new Set(res.map((x) => x.id));
  assert(res.length > 60, `só ${res.length} julgados em 3 páginas`);
  assert(ids.size === res.length, `${res.length - ids.size} julgados repetidos`);
  return `${res.length} julgados, ${ids.size} ids únicos`;
}, { lento: true });

// ----------------------------------------------------------- 3. checker (rede)

teste('CHECKER: processo real da Justiça Comum é encontrado', async () => {
  const res = await new TJPRChecker().consultarProcesso('0003249-43.2020.8.16.0193');
  assert(res.encontrado, 'processo real não encontrado');
  assert(res.formatoCNJ && res.numeroValido, 'DV do número deveria fechar');
  assert(res.tjpr, 'não reconhecido como TJPR (.8.16.)');
  assert(res.decisoes[0].foro === 'comum', `foro errado: ${res.decisoes[0].foro}`);
  return `${res.total} documento(s), ${res.decisoes[0].orgaoJulgador}`;
});

teste('CHECKER: processo real de Turma Recursal é encontrado como juizados', async () => {
  const res = await new TJPRChecker().consultarProcesso('0001992-51.2025.8.16.0146');
  assert(res.encontrado, 'processo real não encontrado');
  assert(res.foros.includes('juizados'), `foros: ${res.foros.join(',')}`);
  return `${res.total} documento(s), ${res.decisoes.map((d) => d.orgaoJulgador).join(' / ')}`;
});

teste('CHECKER: número inventado NÃO é encontrado', async () => {
  const checker = new TJPRChecker();
  for (const falso of ['1234567-89.2020.8.16.0001', '9999999-99.2099.8.99.9999']) {
    const res = await checker.consultarProcesso(falso);
    assert(!res.encontrado, `número inventado ${falso} voltou como encontrado`);
    assert(res.total === 0, `total deveria ser 0, veio ${res.total}`);
  }
  return '2 números falsos rejeitados';
});

teste('CHECKER: auditoria de lote confirma a amostra', async () => {
  const crawler = new TJPRCrawler({ log: () => {} });
  const res = await crawler.search('juros', { foro: 'juizados', dataJulgamentoInicio: '01/03/2026', dataJulgamentoFim: '31/03/2026' }, { maxPages: 1 });
  assert(res.length > 0, 'busca base vazia');
  const aud = await new TJPRChecker().verificarResultados(res, { amostra: 3 });
  assert(aud.verificados === 3, `verificou ${aud.verificados}`);
  assert(aud.confirmados === aud.verificados,
    `${aud.divergentes} divergente(s): ${aud.detalhes.filter((d) => !d.confirmado).map((d) => d.motivo).join(' | ')}`);
  return `${aud.confirmados}/${aud.verificados} confirmados`;
});

// -------------------------------------------------------- 4. documento (rede)

teste('ficha do julgado traz inteiro teor, comarca e citação — sem browser', async () => {
  const doc = await new TJPRNavigator().documento('4100000034230691');
  assert(doc.numeroProcesso === '0003249-43.2020.8.16.0193', `processo: ${doc.numeroProcesso}`);
  assert(!/\(/.test(doc.numeroProcesso), 'número do processo veio com o tipo colado');
  assert(doc.orgaoJulgador && doc.foro === 'comum', `órgão/foro: ${doc.orgaoJulgador}/${doc.foro}`);
  assert(/^\d{2}\/\d{2}\/\d{4}$/.test(doc.dataJulgamento), `data não convertida: ${doc.dataJulgamento}`);
  assert(doc.ementa.length > 200, 'ementa curta demais');
  assert(doc.temInteiroTeor && doc.inteiroTeor.length > 1000, `inteiro teor com ${doc.inteiroTeor.length} chars`);
  assert(doc.citacao.startsWith('(TJPR'), `citação: ${doc.citacao.slice(0, 40)}`);
  return `${doc.inteiroTeor.length} chars de inteiro teor · ${doc.comarca || 'sem comarca'}`;
}, { lento: true });

// -------------------------------------------------------------------- runner

(async () => {
  console.log(`\n=== TJPR — testes de integração ${RAPIDO ? '(rápido)' : ''} ===\n`);
  for (const t of testes) {
    if (RAPIDO && t.lento) { console.log(`SKIP  ${t.nome}`); continue; }
    try {
      const detalhe = await t.fn();
      ok++;
      console.log(`OK    ${t.nome}${detalhe ? ` — ${detalhe}` : ''}`);
    } catch (err) {
      falhas++;
      console.log(`FALHA ${t.nome} — ${err.message}`);
    }
  }
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
