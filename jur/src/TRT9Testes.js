// src/TRT9Testes.js
// Suíte de integração do stack TRT9 / FALCÃO (Navigator, Crawler, Checker).
// Bate na API real — precisa de rede. Uso:
//   node src/TRT9Testes.js            # suíte completa
//   node src/TRT9Testes.js --rapido   # pula gravação em disco
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const FalcaoNavigator = require('./FalcaoNavigator');
const TRT9Navigator = require('./TRT9Navigator');
const TRT9Crawler = require('./TRT9Crawler');
const TRT9Checker = require('./TRT9Checker');

const rapido = process.argv.includes('--rapido');
const resultados = [];

// Processo real do TRT9, confirmado na base em 24/07/2026:
// acórdão da 5ª Turma (rel. Ilse Marcelina Bernardi Lora, julgado 26/02/2025)
// + sentença da Vara do Trabalho de Laranjeiras do Sul.
const PROCESSO_CONHECIDO = '0000065-19.2024.5.09.0053';
const PERIODO = { dataInicio: '01/01/2025', dataFim: '31/03/2025' };

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
  console.log('TRT9 / FALCÃO — Testes de integração (API real)');
  console.log('='.repeat(60));

  const navigator = new TRT9Navigator({ retries: 3 });
  const crawler = new TRT9Crawler({ navigator });
  const checker = new TRT9Checker({ navigator });

  await teste('sessionId gerado tem o formato exigido (_ + 7 alfanuméricos)', async () => {
    for (let i = 0; i < 20; i++) {
      const s = FalcaoNavigator.novoSessionId();
      assert(/^_[a-z0-9]{7}$/.test(s), `sessionId fora do formato: ${s}`);
    }
  });

  await teste('sessionId inválido é recusado pelo servidor', async () => {
    const nav = new TRT9Navigator({ sessionId: '_x1', retries: 0 });
    let erro = null;
    try { await nav.pesquisar({ texto: 'teste', colecao: 'acordaos' }); } catch (e) { erro = e; }
    assert(erro && /Tentativa inválida/.test(erro.message),
      `esperava recusa por sessionId; veio: ${erro ? erro.message : 'sem erro'}`);
  });

  await teste('API acessível: /pesquisa/filtros lista as 5 coleções', async () => {
    const cols = await navigator.listarColecoes();
    assert(cols.length === 5, `esperava 5 coleções, veio ${cols.length}`);
    for (const c of ['acordaos', 'sentencas', 'decisoesmonocraticas', 'recursorevista', 'precedentes']) {
      assert(cols.some((x) => x.valor === c), `coleção ausente: ${c}`);
    }
  });

  await teste('Falcão cobre os 26 acervos da JT (TST + 24 TRTs + CSJT)', async () => {
    const tribs = await navigator.listarTribunais();
    assert(tribs.length === 26, `esperava 26 acervos (TST + 24 TRTs + CSJT), veio ${tribs.length}`);
    for (const t of ['TST', 'TRT1', 'TRT9', 'TRT24']) {
      assert(tribs.some((x) => x.valor === t), `acervo ausente: ${t}`);
    }
  });

  // ---- A DESAMBIGUAÇÃO DE INSTÂNCIA: o teste mais importante ----
  let totais = {};
  await teste('DESAMBIGUAÇÃO: cada coleção devolve contagem DIFERENTE (filtro aplicado de fato)', async () => {
    for (const c of FalcaoNavigator.COLECOES_TRIBUNAL) {
      const r = await navigator.pesquisar({
        texto: 'adicional de insalubridade', colecao: c, size: 5,
        dataInicio: '2025-01-01', dataFim: '2025-03-31',
      });
      totais[c] = r.quantidadeTotal;
    }
    const vals = Object.values(totais);
    assert(new Set(vals).size === vals.length,
      `contagens repetidas entre coleções => filtro ignorado: ${JSON.stringify(totais)}`);
    assert(totais.sentencas > 0 && totais.acordaos > 0, `contagens zeradas: ${JSON.stringify(totais)}`);
  });

  await teste('DESAMBIGUAÇÃO: 1º grau só traz Varas; 2º grau só traz Turmas/Seções', async () => {
    const s = await crawler.search('adicional de insalubridade', { colecoes: ['sentencas'], ...PERIODO }, { maxPages: 1 });
    const a = await crawler.search('adicional de insalubridade', { colecoes: ['acordaos'], ...PERIODO }, { maxPages: 1 });
    assert(s.length > 0 && a.length > 0, 'alguma das buscas voltou vazia');
    assert(s.every((r) => r.grau === '1'), 'resultado de sentenças sem grau=1');
    assert(a.every((r) => r.grau === '2'), 'resultado de acórdãos sem grau=2');
    assert(s.every((r) => /VARA DO TRABALHO|JUSTIÇA 4\.0|CEJUSC/i.test(r.orgaoJulgador)),
      `órgão de 1º grau inesperado: ${[...new Set(s.map((r) => r.orgaoJulgador))].join(', ')}`);
    assert(a.every((r) => /Turma|Seção|Órgão Especial|Pleno|Uniformiza/i.test(r.orgaoJulgador)),
      `órgão de 2º grau inesperado: ${[...new Set(a.map((r) => r.orgaoJulgador))].join(', ')}`);
  });

  await teste('Filtro de data restringe de fato (contagens decrescentes)', async () => {
    const semData = await navigator.pesquisar({ texto: 'adicional de insalubridade', colecao: 'acordaos', size: 5 });
    const trimestre = await navigator.pesquisar({ texto: 'adicional de insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' });
    const mes = await navigator.pesquisar({ texto: 'adicional de insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-01-31' });
    assert(semData.quantidadeTotal > trimestre.quantidadeTotal, 'trimestre não restringiu');
    assert(trimestre.quantidadeTotal > mes.quantidadeTotal, 'mês não restringiu');
    assert(mes.quantidadeTotal > 0, 'mês zerou');
  });

  await teste('Filtro de órgão julgador restringe de fato', async () => {
    const todos = await navigator.pesquisar({ texto: 'insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' });
    const turma = await navigator.pesquisar({ texto: 'insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31', orgaoJulgador: '1ª Turma' });
    assert(turma.quantidadeTotal > 0, '1ª Turma zerou');
    assert(turma.quantidadeTotal < todos.quantidadeTotal, 'órgão julgador não restringiu');
  });

  await teste('Filtro de tribunal isola o acervo (TRT9 + TRT4 = soma exata)', async () => {
    const base = { texto: 'insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' };
    const t9 = await navigator.pesquisar({ ...base, tribunais: 'TRT9' });
    const t4 = await navigator.pesquisar({ ...base, tribunais: 'TRT4' });
    const ambos = await navigator.pesquisar({ ...base, tribunais: 'TRT9,TRT4' });
    assert(ambos.quantidadeTotal === t9.quantidadeTotal + t4.quantidadeTotal,
      `${t9.quantidadeTotal} + ${t4.quantidadeTotal} != ${ambos.quantidadeTotal}`);
  });

  await teste('Operadores: "frase exata" e -exclusão restringem; E/OU/AND/OR NÃO funcionam', async () => {
    const F = { colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' };
    const q = async (t) => (await navigator.pesquisar({ ...F, texto: t })).quantidadeTotal;
    const base = await q('insalubridade');
    const duas = await q('insalubridade periculosidade');
    assert(duas > base, 'termos soltos deveriam ser OU implícito (ampliar), e não ampliaram');
    assert(await q('"adicional de insalubridade"') < base, 'frase exata não restringiu');
    assert(await q('insalubridade -periculosidade') < base, 'exclusão com - não restringiu');
    assert(await q('insalubridade E periculosidade') === duas, 'operador E deixou de ser palavra literal — revisar o doc');
  });

  await teste('Escopo: pesquisaSomenteNasEmentas restringe', async () => {
    const F = { texto: 'insalubridade', colecao: 'acordaos', size: 5, dataInicio: '2025-01-01', dataFim: '2025-03-31' };
    const inteiro = await navigator.pesquisar(F);
    const soEmenta = await navigator.pesquisar({ ...F, pesquisaSomenteNasEmentas: true });
    assert(soEmenta.quantidadeTotal < inteiro.quantidadeTotal, 'escopo ementa não restringiu');
  });

  await teste('Limites do usuário anônimo são respeitados pelo cliente', async () => {
    let e1 = null, e2 = null;
    try { await navigator.pesquisar({ texto: 'a', colecao: 'acordaos', size: 20 }); } catch (e) { e1 = e; }
    try { await navigator.pesquisar({ texto: 'a', colecao: 'acordaos', page: 25 }); } catch (e) { e2 = e; }
    assert(e1 && /size=20/.test(e1.message), 'size fora da lista deveria falhar no cliente');
    assert(e2 && /page=25/.test(e2.message), 'page acima do teto deveria falhar no cliente');
  });

  await teste('Paginação anda além da página 1 (sem repetir ids)', async () => {
    const r = await crawler.search('adicional de insalubridade', { colecoes: ['acordaos'], ...PERIODO }, { maxPages: 3 });
    assert(r.length === 30, `esperava 30 resultados, veio ${r.length}`);
    assert(new Set(r.map((x) => x.id)).size === 30, 'ids repetidos entre páginas');
  });

  await teste('Resultado mapeado tem os campos-chave do repo', async () => {
    const r = await crawler.search('adicional de insalubridade', { colecoes: ['acordaos'], ...PERIODO }, { maxPages: 1 });
    const d = r[0];
    for (const campo of ['id', 'colecao', 'grau', 'tribunal', 'uf', 'processo', 'classe', 'orgaoJulgador', 'relator', 'dataJulgamento']) {
      assert(d[campo] !== undefined && d[campo] !== '', `campo vazio/ausente: ${campo}`);
    }
    assert(d.tribunal === 'TRT9' && d.uf === 'PR', `tribunal/uf errados: ${d.tribunal}/${d.uf}`);
    assert(r.some((x) => x.possuiEmenta && x.ementa.length > 100), 'nenhuma ementa útil no lote');
    assert(!/</.test(r.find((x) => x.possuiEmenta).ementa.slice(0, 500)), 'ementa ainda vem com HTML');
  });

  await teste('CHECKER: processo conhecido é confirmado na base', async () => {
    const res = await checker.consultarProcesso(PROCESSO_CONHECIDO);
    assert(res.encontrado, `${PROCESSO_CONHECIDO} não encontrado`);
    assert(res.numeroValido, 'DV CNJ deveria fechar');
    assert(res.justicaDoTrabalho && res.doTribunal, 'não reconhecido como processo do TRT9');
    assert(res.documentos.every((d) => d.numeroProcesso === PROCESSO_CONHECIDO),
      'checker deixou passar processo de número diferente');
    assert(res.graus.includes('2'), `esperava documento de 2º grau; veio ${JSON.stringify(res.graus)}`);
  });

  await teste('CHECKER: processo inexistente NÃO é confirmado', async () => {
    const res = await checker.consultarProcesso('9999999-99.2099.5.09.0099');
    assert(!res.encontrado, 'processo inexistente foi dado como encontrado');
    assert(res.documentos.length === 0, 'documentos deveria estar vazio');
  });

  await teste('CHECKER: processo de OUTRO tribunal não passa como TRT9', async () => {
    const res = await checker.consultarProcesso('0020044-12.2024.5.04.0471'); // TRT4
    assert(!res.doTribunal, 'número do TRT4 foi aceito como TRT9');
    assert(!res.encontrado, 'documento de outro tribunal apareceu na consulta restrita ao TRT9');
  });

  await teste('CHECKER: número sem máscara é normalizado antes da consulta', async () => {
    const res = await checker.consultarProcesso('00000651920245090053');
    assert(res.numero === PROCESSO_CONHECIDO, `normalização falhou: ${res.numero}`);
    assert(res.encontrado, 'número sem máscara não foi encontrado após normalização');
  });

  await teste('CHECKER: auditoria de uma amostra confirma os resultados', async () => {
    const r = await crawler.search('adicional de insalubridade', { colecoes: ['acordaos'], ...PERIODO }, { maxPages: 1 });
    const v = await checker.verificarResultados(r, { amostra: 3 });
    assert(v.verificados === 3, `verificou ${v.verificados}`);
    assert(v.confirmados === 3, `só ${v.confirmados}/3 confirmados: ${JSON.stringify(v.detalhes)}`);
  });

  if (!rapido) {
    await teste('Inteiro teor é gravado em .txt sem novo acesso à rede', async () => {
      const r = await crawler.search('adicional de insalubridade', { colecoes: ['acordaos'], ...PERIODO }, { maxPages: 1 });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trt9-testes-'));
      try {
        const lote = await crawler.fetchInteiroTeorBatch(r.slice(0, 3), dir, { log: () => {} });
        assert(lote.filter((x) => x.arquivo).length === 3, 'nem todos os arquivos foram gravados');
        for (const x of lote) {
          const size = fs.statSync(x.arquivo).size;
          assert(size > 2000, `arquivo pequeno demais (${size} bytes): ${x.arquivo}`);
          const txt = fs.readFileSync(x.arquivo, 'utf-8');
          assert(/TRIBUNAL REGIONAL DO TRABALHO/i.test(txt), 'texto não parece um documento do TRT');
          assert(!/base64/i.test(txt.slice(0, 2000)), 'base64 do brasão vazou para o .txt');
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  console.log('='.repeat(60));
  if (Object.keys(totais).length) console.log('Contagens por coleção (a desambiguação):', JSON.stringify(totais));
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
