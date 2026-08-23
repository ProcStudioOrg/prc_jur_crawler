const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const catalogo = require('../servidor/catalogo');
const { AVISO_ZERO_SEM_NOTA } = require('../servidor/enriquecer');
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

  // O nome deste teste sempre prometeu "o aviso e a PROPRIA nota", mas a assercao so
  // dizia `avisos.length > 0` — trocar a nota do catalogo pelo texto generico passava
  // batido, e com ele some a unica informacao que explica POR QUE aquele zero pode nao
  // ser ausencia de jurisprudencia (recorte de acervo, base congelada). Agora a
  // comparacao e com o texto do catalogo, e o generico e recusado explicitamente.
  it('tribunal com nota no catalogo: o aviso e a propria nota', async () => {
    const notaDoStf = catalogo.obter('stf').nota;
    assert.ok(notaDoStf.length > 80, 'fixture invalida: o stf precisa ter nota no catalogo');

    const { id } = await (await criarZero({ tribunal: 'stf', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.strictEqual(job.avisos.length, 1, `esperava exatamente a nota do catalogo: ${JSON.stringify(job.avisos)}`);
    assert.strictEqual(job.avisos[0], notaDoStf, 'o aviso precisa ser a PROPRIA nota do catalogo do stf');
    // Trecho literal, para que trocar a nota por qualquer outro texto plausivel falhe.
    assert.match(job.avisos[0], /Instancia unica|Inst.ncia .nica|acordaos 368\.511/,
      'o aviso nao carrega o conteudo real da nota do stf');
    assert.notStrictEqual(job.avisos[0], AVISO_ZERO_SEM_NOTA,
      'tribunal COM nota nao pode receber o aviso generico');
    assert.strictEqual(job.estadoTribunal, catalogo.obter('stf').estado,
      'estadoTribunal precisa ser o estado do catalogo, nao null');
  });

  it('tribunal sem nota no catalogo (tcu): ainda assim recebe um aviso generico honesto', async () => {
    const { id } = await (await criarZero({ tribunal: 'tcu', query: 'termo-sem-resultado' })).json();
    await filaZero.aguardar(id);
    const job = await (await fetch(`${baseZero}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.total, 0);
    assert.strictEqual(job.avisos.length, 1, JSON.stringify(job.avisos));
    assert.strictEqual(job.avisos[0], AVISO_ZERO_SEM_NOTA,
      'sem nota no catalogo o aviso precisa ser exatamente o generico honesto');
    assert.match(job.avisos[0], /nao comprova/i);
    assert.strictEqual(job.estadoTribunal, catalogo.obter('tcu').estado);
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

  // Mata a mutacao "remover a guarda status === concluido": `total` nasce 0 no banco
  // (db.js: DEFAULT 0), entao sem a guarda TODO job enfileirado/rodando ja sairia com a
  // ressalva do zero — o usuario leria "nao ha jurisprudencia" sobre uma busca que ainda
  // nem rodou, e o aviso viraria ruido que se aprende a ignorar. Fica nesta suite porque
  // aqui o executarFn so termina quando o teste manda, o que da uma janela estavel com o
  // job em 'rodando'.
  it('job que ainda NAO concluiu nao carrega aviso de zero, mesmo com total 0', async () => {
    const id = await criarERodar();
    const job = await (await fetch(`${b}/api/v1/buscas/${id}`)).json();
    assert.strictEqual(job.status, 'rodando');
    assert.strictEqual(job.total, 0, 'o job nasce com total 0 — e por isso que a guarda importa');
    assert.deepStrictEqual(job.avisos, [],
      `job nao-concluido com total 0 nao pode carregar a ressalva do zero: ${JSON.stringify(job.avisos)}`);
    assert.strictEqual(job.estadoTribunal, catalogo.obter('stf').estado,
      'estadoTribunal precisa ser o do catalogo, nao null');
    liberar();
    await filaZero.aguardar(id);
  });

  it('SSE: estado inicial E evento terminal carregam avisos e estadoTribunal', async () => {
    const id = await criarERodar();
    const resp = await fetch(`${b}/api/v1/buscas/${id}/eventos`);
    const corpo = resp.text(); // resolve quando o stream fecha, no evento terminal
    liberar();
    const eventos = analisarSSE(await corpo);

    const estado = eventos.find((e) => e.evento === 'estado');
    assert.ok(estado, 'o SSE precisa mandar o estado inicial');
    // `'estadoTribunal' in dado` passava com o campo valendo null, e `Array.isArray` passava
    // com o array vazio — as duas assercoes sobreviviam a trocar este enriquecimento por
    // `{...job, avisos: [], estadoTribunal: null}`. Agora o valor e comparado.
    assert.deepStrictEqual(estado.dado.avisos, [],
      'o job ainda esta rodando: aviso de zero aqui seria ruido, nao ressalva');
    assert.strictEqual(estado.dado.estadoTribunal, catalogo.obter('stf').estado,
      'o estado inicial do SSE precisa levar o estadoTribunal de verdade, nao null');

    const concluido = eventos.find((e) => e.evento === 'concluido');
    assert.ok(concluido, 'o SSE precisa mandar o evento terminal');
    assert.strictEqual(concluido.dado.total, 0);
    assert.deepStrictEqual(concluido.dado.avisos, [catalogo.obter('stf').nota],
      'total 0 no SSE precisa levar a PROPRIA nota do stf — e ela que explica o zero');
    assert.strictEqual(concluido.dado.estadoTribunal, catalogo.obter('stf').estado);
  });

  // O evento `estado` inicial e o unico que quem conecta DEPOIS do fim recebe: o handler
  // manda o estado e fecha na hora. Se ele viajar sem a ressalva, o zero chega cru a quem
  // seguiu o fluxo POST -> 202 -> stream e demorou um segundo a mais para conectar.
  it('SSE: conectar num job JA concluido com total 0 recebe a ressalva no evento inicial', async () => {
    const id = await criarERodar();
    liberar();
    await filaZero.aguardar(id);

    const eventos = analisarSSE(await (await fetch(`${b}/api/v1/buscas/${id}/eventos`)).text());
    const estado = eventos.find((e) => e.evento === 'estado');
    assert.ok(estado, 'o SSE precisa mandar o estado inicial mesmo com o job ja terminado');
    assert.strictEqual(estado.dado.status, 'concluido');
    assert.strictEqual(estado.dado.total, 0);
    assert.deepStrictEqual(estado.dado.avisos, [catalogo.obter('stf').nota],
      'zero num job ja concluido nao pode viajar sem a nota do tribunal');
    assert.strictEqual(estado.dado.estadoTribunal, catalogo.obter('stf').estado);
  });

  it('GET /buscas (lista) carrega avisos e estadoTribunal em cada item', async () => {
    const { buscas } = await (await fetch(`${b}/api/v1/buscas`)).json();
    assert.ok(buscas.length > 0);
    for (const j of buscas) {
      assert.ok(Array.isArray(j.avisos), 'todo item da lista precisa de avisos[]');
      assert.strictEqual(j.estadoTribunal, catalogo.obter(j.comando).estado,
        'estadoTribunal na lista precisa ser o do catalogo, nao null');
      if (j.status === 'concluido' && j.total === 0) {
        assert.deepStrictEqual(j.avisos, [catalogo.obter(j.comando).nota]);
      } else {
        assert.deepStrictEqual(j.avisos, [], 'so job concluido com total 0 carrega a ressalva do zero');
      }
    }
  });

  it('GET /buscas/:id/resultados carrega avisos, estadoTribunal e status', async () => {
    const id = await criarERodar();
    liberar();
    await filaZero.aguardar(id);
    const pagina = await (await fetch(`${b}/api/v1/buscas/${id}/resultados`)).json();
    assert.strictEqual(pagina.total, 0);
    assert.strictEqual(pagina.status, 'concluido');
    assert.deepStrictEqual(pagina.avisos, [catalogo.obter('stf').nota],
      'zero resultados na rota de resultados tambem precisa da nota do tribunal');
    assert.strictEqual(pagina.estadoTribunal, catalogo.obter('stf').estado);
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
