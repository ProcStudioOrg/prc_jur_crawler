const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');

let servidor; let base; let fila;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-buscas-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A' }, { processo: 'B' }, { processo: 'C' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 3, resultados: [], arquivo, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const criar = (corpo) => fetch(`${base}/api/v1/buscas`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

describe('rotas de busca', () => {
  it('cria busca e devolve 202 com id', async () => {
    const r = await criar({ tribunal: 'stf', query: 'aposentadoria' });
    assert.strictEqual(r.status, 202);
    const corpo = await r.json();
    assert.ok(corpo.id);
    assert.strictEqual(corpo.status, 'enfileirado');
  });

  it('recusa busca sem tribunal e sem query', async () => {
    assert.strictEqual((await criar({ query: 'x' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf' })).status, 400);
  });

  it('recusa tribunal indisponivel com 409 e explica', async () => {
    const r = await criar({ tribunal: 'stj', query: 'x' });
    assert.strictEqual(r.status, 409);
    const corpo = await r.json();
    assert.match(corpo.erro, /indispon/i);
    assert.ok(corpo.nota && corpo.nota.length > 0, 'o usuario precisa saber POR QUE');
  });

  it('acompanha ate concluido e pagina resultados', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    const job = await (await fetch(`${base}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.status, 'concluido');
    assert.strictEqual(job.total, 3);
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?offset=1&limite=1`)).json();
    assert.strictEqual(pagina.itens.length, 1);
    assert.strictEqual(pagina.itens[0].processo, 'B');
  });

  it('404 para busca inexistente', async () => {
    assert.strictEqual((await fetch(`${base}/api/v1/buscas/nao-existe`)).status, 404);
  });

  it('DELETE cancela', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    const r = await fetch(`${base}/api/v1/buscas/${id}`, { method: 'DELETE' });
    assert.ok([200, 409].includes(r.status)); // 409 se ja terminou antes do DELETE
  });

  it('recusa maxPaginas invalido (nao-numerico, negativo, acima do teto) com 400', async () => {
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 'abc' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: -5 })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 99999 })).status, 400);
  });

  it('aceita maxPaginas ausente ou dentro do teto', async () => {
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x' })).status, 202);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', maxPaginas: 5 })).status, 202);
  });

  // C1 (revisao final): `Number.isInteger(Number(valor))` coagia ANTES de validar —
  // Number(true)===1, Number([5])===5, Number('0x10')===16 — e os tres passavam. Viravam
  // `-m true` / `-m 0x10` na CLI, onde parseInt(x,10) da NaN/0, o laco de paginas nunca
  // roda e o job termina concluido com total 0. A regra do zero entao dizia ao usuario
  // que "pode ser limitacao do acervo": uma busca que NUNCA ACONTECEU virava
  // "nao encontrei nada". Reproduzido ao vivo pelo revisor com maxPaginas:true -> 202.
  it('recusa maxPaginas que so passa por coacao de tipo (true, [5], "0x10", "1e3") com 400', async () => {
    for (const maxPaginas of [true, false, [5], '0x10', '1e3', '0b11', {}, 1.5, ' ']) {
      const r = await criar({ tribunal: 'stf', query: 'x', maxPaginas });
      assert.strictEqual(r.status, 400, `maxPaginas=${JSON.stringify(maxPaginas)} devia ser 400, veio ${r.status}`);
      assert.match((await r.json()).erro, /maxPaginas invalido/i);
    }
  });

  // I4 (revisao final): nada validava datas — dataInicio/dataFim viajavam direto para
  // -di/-df. ISO e o erro mais provavel (o front usa <input type="date">, o modelo emite
  // ISO a partir de "desde 2024"), e o crawler filtrava errado ou nao filtrava: total 0
  // com a regra do zero culpando o acervo por um filtro que ninguem escreveu.
  it('recusa data fora de DD/MM/AAAA com 400 e ensina o formato', async () => {
    const iso = await criar({ tribunal: 'stf', query: 'x', dataInicio: '2024-01-01' });
    assert.strictEqual(iso.status, 400);
    const corpoIso = await iso.json();
    assert.match(corpoIso.erro, /DD\/MM\/AAAA/);
    assert.match(corpoIso.erro, /01\/01\/2024/, 'a mensagem precisa mostrar a data ja convertida');

    for (const dataFim of ['ontem', '31/02/2024', '1/1/2024', 20240101]) {
      const r = await criar({ tribunal: 'stf', query: 'x', dataFim });
      assert.strictEqual(r.status, 400, `dataFim=${JSON.stringify(dataFim)} devia ser 400`);
      assert.match((await r.json()).erro, /dataFim/);
    }
  });

  it('aceita datas em DD/MM/AAAA e datas ausentes', async () => {
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x', dataInicio: '01/01/2024', dataFim: '31/12/2024' })).status, 202);
    assert.strictEqual((await criar({ tribunal: 'stf', query: 'x' })).status, 202);
  });

  it('offset negativo nao usa semantica de indice negativo do slice — clampa em 0', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    // Numa lista de 3 itens (A,B,C), offset=-1&limite=1 discrimina os dois
    // comportamentos: SEM clamp, Array.slice(-1, 0) usa indice negativo (conta a
    // partir do fim) e devolve [] (o "fim menos 1" fica DEPOIS do "inicio 0",
    // entao o slice fecha vazio) — o bug que o clamp existe para evitar. COM
    // clamp em 0, slice(0, 1) devolve [A], que e o que uma API de paginacao deve
    // fazer com offset negativo.
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?offset=-1&limite=1`)).json();
    assert.strictEqual(pagina.offset, 0, 'offset negativo devia ser clampado em 0 na resposta');
    assert.deepStrictEqual(pagina.itens.map((i) => i.processo), ['A']);
  });

  it('limite invalido (negativo ou nao-numerico) cai no default em vez de quebrar a pagina', async () => {
    const { id } = await (await criar({ tribunal: 'stf', query: 'x' })).json();
    await fila.aguardar(id);
    const pagina = await (await fetch(`${base}/api/v1/buscas/${id}/resultados?limite=-5`)).json();
    assert.strictEqual(pagina.limite, 20, 'limite invalido devia cair no default (20)');
    assert.strictEqual(pagina.itens.length, 3); // so ha 3 itens na fixture
  });
});

describe('avisos no zero resultados (Important 3)', () => {
  // Fila separada, com executarFn que sempre devolve total:0 — para provar que a
  // garantia "total 0 nunca viaja sem aviso" vale tanto para um tribunal com nota
  // no catalogo (stf) quanto para um sem nota (tcu, disponivel:true e nota:'').
  let servidorZero; let baseZero; let filaZero;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-buscas-zero-'));
    const arquivo = path.join(dir, 'saida-vazia.json');
    fs.writeFileSync(arquivo, JSON.stringify([]));
    filaZero = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo, erro: null }),
    });
    servidorZero = http.createServer(criarApp({ fila: filaZero }).handler);
    await new Promise((r) => servidorZero.listen(0, r));
    baseZero = `http://127.0.0.1:${servidorZero.address().port}`;
  });

  after(() => servidorZero.close());

  const criarZero = (corpo) => fetch(`${baseZero}/api/v1/buscas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });

  it('tribunal com nota no catalogo: o aviso e a propria nota', async () => {
    const { id } = await (await criarZero({ tribunal: 'stf', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.ok(job.avisos.length > 0, 'total 0 nunca pode viajar com avisos vazio');
    assert.ok(job.avisos[0].length > 0);
  });

  it('tribunal sem nota no catalogo (tcu): ainda assim recebe um aviso generico honesto', async () => {
    const { id } = await (await criarZero({ tribunal: 'tcu', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.ok(job.avisos.length > 0, 'total 0 nunca pode viajar com avisos vazio, mesmo sem nota no catalogo');
    assert.match(job.avisos[0], /nao comprova/i);
  });
});

/** Le um corpo SSE completo (`event: X\ndata: Y\n\n`) e devolve a lista de eventos. */
function analisarSSE(texto) {
  return texto.split('\n\n').filter(Boolean).map((bloco) => {
    const linhas = bloco.split('\n');
    const linhaEvento = linhas.find((l) => l.startsWith('event: '));
    const linhaDado = linhas.find((l) => l.startsWith('data: '));
    if (!linhaEvento) return null;
    return { evento: linhaEvento.slice(7), dado: linhaDado ? JSON.parse(linhaDado.slice(6)) : undefined };
  }).filter(Boolean);
}

// I1 (revisao final): a regra do zero (spec §4.3/§5) existia SO em GET /buscas/:id e
// faltava no SSE, na lista e nos resultados. O SSE e o pior dos tres: e o canal que o
// spec desenhou para o fluxo POST -> 202 -> stream, entao quem segue o fluxo recomendado
// recebia o zero cru e nao tinha motivo nenhum para consultar a rota de status.
describe('regra do zero em TODAS as superficies de leitura (I1)', () => {
  let srv; let b; let filaZero; let liberar;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-i1-'));
    const arquivo = path.join(dir, 'vazio.json');
    fs.writeFileSync(arquivo, JSON.stringify([]));
    filaZero = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      // So termina quando o teste mandar: permite conectar no SSE com o job ainda
      // rodando e observar TAMBEM o evento terminal, nao so o 'estado' inicial.
      executarFn: () => new Promise((r) => {
        liberar = () => r({ ok: true, total: 0, resultados: [], arquivo, erro: null });
      }),
    });
    srv = http.createServer(criarApp({ fila: filaZero }).handler);
    await new Promise((r) => srv.listen(0, r));
    b = `http://127.0.0.1:${srv.address().port}`;
  });

  after(() => srv.close());

  async function criarERodar() {
    const { id } = await (await fetch(`${b}/api/v1/buscas`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tribunal: 'stf', query: 'termo-sem-resultado' }),
    })).json();
    for (let i = 0; i < 200 && filaZero.obter(id).status !== 'rodando'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return id;
  }

  it('SSE: estado inicial E evento terminal carregam avisos e estadoTribunal', async () => {
    const id = await criarERodar();
    const resp = await fetch(`${b}/api/v1/buscas/${id}/eventos`);
    const corpo = resp.text(); // resolve quando o stream fecha, no evento terminal
    liberar();
    const eventos = analisarSSE(await corpo);

    const estado = eventos.find((e) => e.evento === 'estado');
    assert.ok(estado, 'o SSE precisa mandar o estado inicial');
    assert.ok(Array.isArray(estado.dado.avisos), 'o estado inicial precisa carregar avisos[] (spec §5)');
    assert.ok('estadoTribunal' in estado.dado);

    const concluido = eventos.find((e) => e.evento === 'concluido');
    assert.ok(concluido, 'o SSE precisa mandar o evento terminal');
    assert.strictEqual(concluido.dado.total, 0);
    assert.ok(concluido.dado.avisos.length > 0,
      'total 0 no SSE sem aviso e exatamente o zero que se le como "nao ha jurisprudencia"');
    assert.ok('estadoTribunal' in concluido.dado);
  });

  it('GET /buscas (lista) carrega avisos e estadoTribunal em cada item', async () => {
    const { buscas } = await (await fetch(`${b}/api/v1/buscas`)).json();
    assert.ok(buscas.length > 0);
    for (const j of buscas) {
      assert.ok(Array.isArray(j.avisos), 'todo item da lista precisa de avisos[]');
      assert.ok('estadoTribunal' in j);
      if (j.status === 'concluido' && j.total === 0) assert.ok(j.avisos.length > 0);
    }
  });

  it('GET /buscas/:id/resultados carrega avisos, estadoTribunal e status', async () => {
    const id = await criarERodar();
    liberar();
    await filaZero.aguardar(id);
    const pagina = await (await fetch(`${b}/api/v1/buscas/${id}/resultados`)).json();
    assert.strictEqual(pagina.total, 0);
    assert.strictEqual(pagina.status, 'concluido');
    assert.ok(pagina.avisos.length > 0, 'zero resultados na rota de resultados tambem precisa do aviso');
    assert.ok('estadoTribunal' in pagina);
  });
});

// C3 (revisao final): falha de leitura precisa ser DISTINGUIVEL de busca vazia nas tres
// superficies. Medido pelo revisor com job concluido e total 42: REST devolvia
// {"total":42,"itens":[]}, a tool devolvia "Sem itens em offset 0 (total 42)" com
// ok:true, e GET /buscas/:id devolvia avisos: [].
describe('falha de leitura propagada as superficies (C3)', () => {
  let srv; let b; let filaFalha; let arquivo;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-c3-'));
    arquivo = path.join(dir, 'some.json');
    fs.writeFileSync(arquivo, JSON.stringify(Array.from({ length: 42 }, (_, i) => ({ processo: `P${i}` }))));
    filaFalha = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 42, resultados: [], arquivo, erro: null }),
    });
    srv = http.createServer(criarApp({ fila: filaFalha }).handler);
    await new Promise((r) => srv.listen(0, r));
    b = `http://127.0.0.1:${srv.address().port}`;
  });

  after(() => srv.close());

  it('REST devolve 500 com erro explicito em vez de 200 com total 42 e itens []', async () => {
    const { id } = await (await fetch(`${b}/api/v1/buscas`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tribunal: 'stf', query: 'x' }),
    })).json();
    await filaFalha.aguardar(id);

    const antes = await (await fetch(`${b}/api/v1/buscas/${id}/resultados`)).json();
    assert.strictEqual(antes.itens.length, 20, 'antes de sumir, a pagina vem normal');

    fs.unlinkSync(arquivo);

    const r = await fetch(`${b}/api/v1/buscas/${id}/resultados`);
    assert.strictEqual(r.status, 500, 'falha de leitura nao pode voltar 200 com lista vazia');
    const corpo = await r.json();
    assert.match(corpo.erro, /falha ao ler/i);
    assert.strictEqual(corpo.total, 42);
    assert.deepStrictEqual(corpo.itens, []);
    assert.ok(corpo.avisos.some((a) => /FALHA AO LER/.test(a)));

    // E o status, que antes devolvia avisos: [] com total 42, agora sinaliza.
    const status = await (await fetch(`${b}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(status.status, 'concluido');
    assert.strictEqual(status.total, 42);
    assert.ok(status.avisos.length > 0, 'total 42 com resultados ilegiveis nao pode ter avisos vazio');
    assert.match(status.erroResultados, /ausente/i);
  });
});
