// src/TJMTTestes.js
const TJMTCrawler = require('./TJMTCrawler');
const TJMTChecker = require('./TJMTChecker');
const TJMTNavigator = require('./TJMTNavigator');

/**
 * Suíte de integração do TJMT. Roda contra a API de verdade.
 *   node src/TJMTTestes.js            todos
 *   node src/TJMTTestes.js <n>        só o teste n
 *
 * Cada teste cobre uma linha do critério de aceite do CLAUDE-CODEGEN §7 e,
 * principalmente, as RESSALVAS: o que quebra em silêncio se a API mudar.
 *
 * ⚠️ Página pequena de propósito em quase todos: cada acórdão carrega o inteiro
 * teor com uma imagem base64, e uma página de 100 são 33,7 MB.
 */

const QUERY = 'usucapião';
const PROCESSO_CONHECIDO = '0001375-66.2014.8.11.0033';
const pausa = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); return true; };

teste('busca simples devolve resultados com ementa', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 5 });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1 });
  ok(r.length > 0, 'busca não devolveu resultados');
  ok(r.totalResults > 1000, `total suspeito: ${r.totalResults}`);
  ok(r[0].ementa.length > 200, `ementa curta demais: ${r[0].ementa.length} chars`);
  ok(r[0].numeroProcesso, 'resultado sem número de processo');
  return `${r.length} de ${r.totalResults}; ementa ${r[0].ementa.length} chars`;
});

teste('o inteiro teor JÁ VEM na busca e é MAIOR que a ementa', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 5, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1, maxResults: 5 });
  ok(r.every((x) => x.inteiroTeor && x.inteiroTeor.length > 1000), 'algum acórdão veio sem inteiro teor');
  ok(r[0].inteiroTeor.length > r[0].ementa.length,
    `inteiro teor (${r[0].inteiroTeor.length}) não é maior que a ementa (${r[0].ementa.length})`);
  return `inteiro teor ${r[0].inteiroTeor.length} vs ementa ${r[0].ementa.length} chars`;
});

teste('RESSALVA: a imagem base64 do brasão NÃO vaza para o texto', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 3, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 1, maxResults: 3 });
  const txt = r.map((x) => x.inteiroTeor).join('\n');
  ok(!/base64/i.test(txt), 'a imagem base64 embutida vazou para o texto limpo');
  ok(!/<[a-z][^>]*>/i.test(txt), 'sobrou tag HTML no texto');
  ok(/[áàâãéêíóôõúüç]/i.test(txt), 'nenhum acento no texto — o decodificador de entidade quebrou');
  return `${txt.length} chars limpos, sem base64 e com acento`;
});

teste('RESSALVA: monocrática NÃO tem ementa e o campo Documento não existe nela', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 5, includeFullText: true });
  const r = await c.search(QUERY, { tipo: 'monocratica' }, { maxPages: 1, maxResults: 5 });
  ok(r.length > 0, 'nenhuma monocrática devolvida');
  ok(r.every((x) => x.semEmenta === true && x.ementa === ''),
    'alguma monocrática veio marcada como tendo ementa — o schema mudou, revise mapDocumento');
  ok(r.every((x) => x.inteiroTeor && x.inteiroTeor.length > 1000),
    'monocrática sem texto — o Conteudo deveria trazer a decisão inteira');
  return `${r.length} monocráticas, todas sem ementa, texto ${r[0].inteiroTeor.length} chars`;
});

teste('🔴 RESSALVA CRÍTICA: a data vai em MM/DD/YYYY e o dia > 12 funciona', async () => {
  ok(TJMTNavigator.paraDataApi('31/07/2026') === '07/31/2026',
    'paraDataApi não está invertendo dia e mês');
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.termoDeBusca': QUERY, 'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const sem = await nav.contar(base);
  // Convertida (o que o crawler manda): tem de RESTRINGIR.
  const conv = await nav.contar({
    ...base,
    'filtro.periodoDataDe': TJMTNavigator.paraDataApi('01/07/2026'),
    'filtro.periodoDataAte': TJMTNavigator.paraDataApi('31/07/2026'),
  });
  // Crua (o defeito): o dia 31 no slot do mês faz o servidor DESCARTAR o
  // limite em silêncio e devolver a base inteira.
  const crua = await nav.contar({
    ...base, 'filtro.periodoDataDe': '01/07/2026', 'filtro.periodoDataAte': '31/07/2026',
  });
  ok(conv.total > 0 && conv.total < sem.total,
    `a janela convertida não restringiu (${conv.total} de ${sem.total})`);
  ok(crua.total > conv.total,
    `a data CRUA deixou de ser mais permissiva que a convertida (${crua.total} x ${conv.total}) — ` +
    'se a API foi corrigida para DD/MM, o contorno do paraDataApi precisa SAIR');
  return `sem=${sem.total} convertida=${conv.total} crua=${crua.total}`;
});

teste('🔴 RESSALVA: a janela de data filtra PUBLICAÇÃO, não julgamento', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 8 });
  const r = await c.search('', { tipo: 'acordao', dataPubInicio: '03/08/2026', dataPubFim: '03/08/2026' },
    { maxPages: 1, maxResults: 8 });
  ok(r.length > 0, 'a janela de um dia não devolveu nada');
  ok(r.every((x) => x.dataPublicacao === '03/08/2026'),
    'algum documento veio fora da janela de PUBLICAÇÃO pedida');
  ok(r.some((x) => x.dataJulgamento !== '03/08/2026'),
    'todas as datas de julgamento coincidem com a janela — se a API passou a filtrar ' +
    'julgamento, a ressalva e o nome das flags (-dpi/-dpf) precisam mudar');
  return `${r.length} docs, todos pub=03/08/2026, julgamentos: ${[...new Set(r.map((x) => x.dataJulgamento))].join(', ')}`;
});

teste('🔴 RESSALVA: OU e NÃO são ignorados e a busca vira AND', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const conta = async (q) => (await nav.contar({ ...base, 'filtro.termoDeBusca': q })).totalAcordao;
  const espaco = await conta('usucapião posse');
  const comOu = await conta('usucapião OU posse');
  const comNao = await conta('usucapião NÃO posse');
  ok(espaco > 0, 'a busca com espaço zerou — a API mudou');
  ok(comOu === espaco,
    `"OU" deixou de ser ignorado (${comOu} x ${espaco} do espaço) — revise a ressalva e o aviso`);
  ok(comNao === espaco,
    `"NÃO" deixou de ser ignorado (${comNao} x ${espaco} do espaço) — revise a ressalva`);
  return `espaço=${espaco} OU=${comOu} NÃO=${comNao} (os três iguais = os dois operadores viram AND)`;
});

teste('🔴 RESSALVA: os operadores INGLESES inflam (viram OR)', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const conta = async (q) => (await nav.contar({ ...base, 'filtro.termoDeBusca': q })).totalAcordao;
  const espaco = await conta('usucapião posse');
  const comAnd = await conta('usucapião AND posse');
  ok(comAnd > espaco * 5,
    `"AND" deixou de inflar (${comAnd} x ${espaco}) — revise a ressalva e o aviso do crawler`);
  return `espaço=${espaco} AND=${comAnd} (AND infla ~${(comAnd / espaco).toFixed(0)}x)`;
});

teste('RESSALVA: PROX e ADJ ZERAM; PROXIMO é que funciona', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const conta = async (q) => (await nav.contar({ ...base, 'filtro.termoDeBusca': q })).totalAcordao;
  const prox = await conta('usucapião PROX posse');
  const adj = await conta('usucapião ADJ posse');
  const proximo = await conta('usucapião PROXIMO posse');
  ok(prox === 0 && adj === 0, `PROX (${prox}) ou ADJ (${adj}) deixaram de zerar — revise a ressalva`);
  ok(proximo > 0, `PROXIMO zerou (${proximo}) — o operador de proximidade mudou`);
  return `PROX=${prox} ADJ=${adj} PROXIMO=${proximo}`;
});

teste('RESSALVA: tipoProcesso exige o RÓTULO ACENTUADO; sem acento zera', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.termoDeBusca': QUERY, 'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const todas = await nav.contar(base);
  const civel = await nav.contar({ ...base, 'filtro.tipoProcesso': 'Cível' });
  const criminal = await nav.contar({ ...base, 'filtro.tipoProcesso': 'Criminal' });
  const semAcento = await nav.contar({ ...base, 'filtro.tipoProcesso': 'Civel' });
  ok(semAcento.totalAcordao === 0,
    `"Civel" sem acento devolveu ${semAcento.totalAcordao} — a API passou a normalizar, revise a ressalva`);
  ok(civel.totalAcordao + criminal.totalAcordao === todas.totalAcordao,
    `a partição Cível+Criminal não fecha: ${civel.totalAcordao}+${criminal.totalAcordao} != ${todas.totalAcordao}`);
  return `todas=${todas.totalAcordao} cível=${civel.totalAcordao} criminal=${criminal.totalAcordao} sem-acento=${semAcento.totalAcordao}`;
});

teste('RESSALVA: --escopo (tipoBusca) só afeta ACÓRDÃO', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.termoDeBusca': QUERY, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const ementa = await nav.contar({ ...base, 'filtro.tipoBusca': 1 });
  const inteiro = await nav.contar({ ...base, 'filtro.tipoBusca': 2 });
  ok(inteiro.totalAcordao > ementa.totalAcordao,
    `o escopo inteiro teor (${inteiro.totalAcordao}) não é maior que ementa (${ementa.totalAcordao})`);
  ok(inteiro.totalMonocratica === ementa.totalMonocratica,
    `a monocrática mudou de contagem (${ementa.totalMonocratica} -> ${inteiro.totalMonocratica}) — ` +
    'o escopo passou a afetá-la, revise a ressalva');
  return `acórdão ${ementa.totalAcordao} -> ${inteiro.totalAcordao}; monocrática travada em ${ementa.totalMonocratica}`;
});

teste('🔴 RESSALVA: NÃO existe Turma Recursal nesta base', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  // Consumo é onde a Turma Recursal deveria dominar em qualquer outro TJ.
  const r = await nav.contar({ ...base, 'filtro.termoDeBusca': 'dano moral' });
  ok(r.totalAcordao > 10000, `a busca de controle devolveu pouco: ${r.totalAcordao}`);
  ok(r.totalRecursal === 0,
    `CountRecursalEletronico deixou de ser 0 (${r.totalRecursal}) — o acervo de Turma Recursal ` +
    'entrou na base: revise CLAUDE-TJMT.md, o roteamento e o aviso do crawler');
  return `"dano moral": acórdão=${r.totalAcordao} recursal=${r.totalRecursal}`;
});

teste('🔴 RESSALVA: thesaurus INFLA ~10x', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.termoDeBusca': QUERY, 'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente',
  };
  const sem = await nav.contar({ ...base, 'filtro.thesaurus': 'false' });
  const com = await nav.contar({ ...base, 'filtro.thesaurus': 'true' });
  ok(com.total > sem.total * 3,
    `thesaurus deixou de inflar (${com.total} x ${sem.total}) — revise o aviso do crawler`);
  return `sem=${sem.total} com=${com.total} (${(com.total / sem.total).toFixed(1)}x)`;
});

teste('paginação anda além da página 1 e o crawler deduplica', async () => {
  const c = new TJMTCrawler({ log: () => {}, pageSize: 10 });
  const r = await c.search(QUERY, { tipo: 'acordao' }, { maxPages: 3 });
  const ids = r.map((x) => x.id);
  ok(r.length > 10, `não passou da primeira página: ${r.length} resultados`);
  ok(new Set(ids).size === ids.length,
    `saíram ids repetidos (${ids.length - new Set(ids).size}) — a deduplicação por Id quebrou`);
  return `${r.length} documentos únicos em 3 páginas (${c.ultimaBusca.repetidosDescartados} repetidos descartados pelo servidor)`;
});

teste('RESSALVA: quantidadePagina acima de 100 devolve HTTP 500', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  let barrado = false;
  try {
    await nav.buscar({ 'filtro.termoDeBusca': QUERY }, 1, 200);
  } catch (e) {
    barrado = /maxima do TJMT/.test(e.message);
  }
  ok(barrado, 'o Navigator deixou passar size=200, que a API responde com HTTP 500');
  return 'size > 100 barrado antes de sair do cliente';
});

teste('consulta por número encontra um julgado conhecido', async () => {
  const r = await new TJMTChecker({ log: () => {} }).consultarProcesso(PROCESSO_CONHECIDO);
  ok(r.valido, 'o número de controle deixou de validar no CNJ');
  ok(r.encontrado, `${PROCESSO_CONHECIDO} não foi encontrado na base`);
  ok(r.documentos[0].citacao.includes('N.U'),
    'a citação oficial (campo Observacao) não veio pronta — revise a ressalva');
  return `${r.total} documento(s); citação: ${r.documentos[0].citacao.slice(0, 60)}...`;
});

teste('🔴 RESSALVA: numeroProtocolo NÃO é o número do processo', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const base = {
    'filtro.tipoBusca': 1, 'filtro.area': 'Judiciaria',
    'filtro.ordenacao.ordenarPor': 'DataDecrescente', 'filtro.thesaurus': 'false',
  };
  const sem = await nav.contar(base);
  const comMascara = await nav.contar({ ...base, 'filtro.numeroProtocolo': PROCESSO_CONHECIDO });
  const comDigitos = await nav.contar({
    ...base, 'filtro.numeroProtocolo': PROCESSO_CONHECIDO.replace(/\D/g, ''),
  });
  ok(comMascara.total === sem.total,
    `numeroProtocolo com máscara passou a filtrar (${comMascara.total} x ${sem.total}) — ` +
    'se virou consulta por processo, o Checker pode usá-lo em vez da busca livre');
  ok(comDigitos.total === 0,
    `numeroProtocolo com 20 dígitos devolveu ${comDigitos.total} — revise a ressalva do Checker`);
  return `sem=${sem.total} máscara=${comMascara.total} (ignorado) 20-dígitos=${comDigitos.total} (zero silencioso)`;
});

teste('a base está CORRENTE (a lição do TJAM)', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const u = await nav.ultimaAtualizacao();
  const quando = u.acordao && u.acordao.DataAtualizacao;
  ok(quando, 'o endpoint de última atualização não respondeu');
  const dias = (Date.now() - new Date(quando).getTime()) / 86400000;
  ok(dias < 30, `a base do TJMT não é indexada há ${dias.toFixed(0)} dias — pode ter congelado`);
  return `indexada em ${u.acordao.DataAtualizacaoFormatada} (${dias.toFixed(1)} dias atrás)`;
});

teste('os combos da tela respondem e estão populados', async () => {
  const nav = new TJMTNavigator({ log: () => {} });
  const [camaras, classes, relatores] = await Promise.all([
    nav.camaras(), nav.classes(), nav.relatores(),
  ]);
  ok(camaras.length > 10, `poucas câmaras: ${camaras.length}`);
  ok(classes.length > 100, `poucas classes: ${classes.length}`);
  ok(relatores.length > 100, `poucos relatores: ${relatores.length}`);
  return `${camaras.length} câmaras, ${classes.length} classes, ${relatores.length} relatores`;
});

(async () => {
  const so = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < testes.length; i++) {
    if (so !== null && so !== i + 1) continue;
    const t = testes[i];
    process.stdout.write(`${String(i + 1).padStart(2)}. ${t.nome}\n`);
    try {
      const detalhe = await t.fn();
      console.log(`    OK — ${detalhe}`);
      pass++;
    } catch (err) {
      console.log(`    FALHOU — ${err.message}`);
      fail++;
    }
    await pausa(1500);
  }
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
