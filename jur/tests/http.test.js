const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { describe, it, before, after } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const { criarApp } = require('../servidor/index');
const { criarRoteador, json, sse, lerCorpo, caminhoDentroDoDiretorio } = require('../servidor/http');

let servidor;
let base;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-http-'));
  const fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 1, resultados: [{ processo: '1' }], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({ fila }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

describe('http', () => {
  it('GET /api/v1/saude responde ok', async () => {
    const r = await fetch(`${base}/api/v1/saude`);
    assert.strictEqual(r.status, 200);
    const corpo = await r.json();
    assert.strictEqual(corpo.ok, true);
  });

  it('GET /api/v1/tribunais lista com estado e disponivel', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais`)).json();
    assert.ok(corpo.tribunais.length > 60);
    const stf = corpo.tribunais.find((t) => t.comando === 'stf');
    assert.strictEqual(stf.disponivel, true);
    assert.ok('estado' in stf && 'nota' in stf);
  });

  it('GET /api/v1/tribunais?segmento=superior filtra', async () => {
    const corpo = await (await fetch(`${base}/api/v1/tribunais?segmento=superior`)).json();
    assert.ok(corpo.tribunais.every((t) => t.segmento === 'superior'));
  });

  it('rota inexistente devolve 404 em JSON', async () => {
    const r = await fetch(`${base}/api/v1/nao-existe`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).erro, 'rota nao encontrada');
  });
});

describe('roteador - parametro malformado nao derruba o processo (Critical 1)', () => {
  let srv2;
  let base2;

  before(async () => {
    const r = criarRoteador();
    r.rota('GET', '/api/v1/buscas/:id', (req, res) => {
      json(res, 200, { id: req.params.id });
    });
    srv2 = http.createServer(r.handler);
    await new Promise((resolve) => srv2.listen(0, resolve));
    base2 = `http://127.0.0.1:${srv2.address().port}`;
  });

  after(() => srv2.close());

  it('GET /api/v1/buscas/% devolve 400, nao 500, e o processo continua vivo', async () => {
    const r = await fetch(`${base2}/api/v1/buscas/%`);
    assert.strictEqual(r.status, 400);
    const corpo = await r.json();
    assert.ok(corpo.erro);

    // prova que o processo nao morreu: uma requisicao normal em seguida ainda funciona
    const r2 = await fetch(`${base2}/api/v1/buscas/abc`);
    assert.strictEqual(r2.status, 200);
    assert.strictEqual((await r2.json()).id, 'abc');
  });
});

describe('lerCorpo - limite de tamanho corta a conexao (Critical 2)', () => {
  let srv3;
  let porta3;
  let bytesAceitosPeloServidor;

  before(async () => {
    const r = criarRoteador();
    r.rota('POST', '/corpo', async (req, res) => {
      try {
        await lerCorpo(req);
        json(res, 200, { ok: true });
      } catch {
        // esperado: o corpo estoura o limite e a promessa rejeita
      }
    });
    srv3 = http.createServer(r.handler);
    bytesAceitosPeloServidor = 0;
    srv3.on('connection', (socket) => {
      socket.on('data', (d) => { bytesAceitosPeloServidor += d.length; });
    });
    await new Promise((resolve) => srv3.listen(0, resolve));
    porta3 = srv3.address().port;
  });

  after(() => srv3.close());

  it('manda 20MB e o servidor para de aceitar bytes bem antes disso', async () => {
    const total = 20 * 1024 * 1024;
    await new Promise((resolve) => {
      const socket = net.connect(porta3, '127.0.0.1', () => {
        socket.write(
          `POST /corpo HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${total}\r\nConnection: close\r\n\r\n`
        );
        const chunk = Buffer.alloc(64 * 1024, 'a');
        let enviado = 0;
        function enviarMais() {
          if (socket.destroyed || enviado >= total) return resolve();
          const podeContinuar = socket.write(chunk);
          enviado += chunk.length;
          if (podeContinuar) setImmediate(enviarMais);
          else socket.once('drain', enviarMais);
        }
        enviarMais();
      });
      socket.on('error', () => resolve()); // ECONNRESET e o esperado apos o req.destroy()
      socket.on('close', () => resolve());
      setTimeout(resolve, 8000);
    });

    assert.ok(
      bytesAceitosPeloServidor < 5 * 1024 * 1024,
      `esperava bem menos que 20MB aceitos pelo servidor, recebeu ${bytesAceitosPeloServidor} bytes`
    );
  });
});

describe('lerCorpo - corpo grande demais responde 400 limpo (Minor 4)', () => {
  // Diferente do bloco anterior: aqui o handler ESCREVE a resposta no catch (como
  // toda rota real faz), para provar que o reject() antes do destroy() (ver
  // comentario em http.js) da tempo do 400 sair antes do socket cair — pelo menos
  // no caso realista de uma requisicao normal via fetch, com o corpo mandado de
  // uma vez. Isso NAO e garantido sob flood continuo (medido ~80% em raw socket
  // saturando a conexao); o teste aqui cobre o caso comum, nao o pior caso.
  let srv4;
  let base4;

  before(async () => {
    const r = criarRoteador();
    r.rota('POST', '/corpo', async (req, res) => {
      try {
        await lerCorpo(req);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { erro: e.message });
      }
    });
    srv4 = http.createServer(r.handler);
    await new Promise((resolve) => srv4.listen(0, resolve));
    base4 = `http://127.0.0.1:${srv4.address().port}`;
  });

  after(() => srv4.close());

  it('corpo de 1.5MB mandado de uma vez recebe 400 com mensagem, nao ECONNRESET', async () => {
    const corpo = 'a'.repeat(1_500_000);
    const r = await fetch(`${base4}/corpo`, { method: 'POST', body: corpo });
    assert.strictEqual(r.status, 400);
    const j = await r.json();
    assert.match(j.erro, /grande demais/);
  });
});

describe('sse() - autolimpeza e idempotencia (Important 1)', () => {
  it('limpa o timer sozinho quando o socket fecha, mesmo sem fechar() explicito', () => {
    // Roda em processo filho: se o setInterval de ping nao for limpo, o processo nunca
    // sai sozinho e execFileSync estoura por timeout, derrubando o teste.
    const modulo = path.join(__dirname, '..', 'servidor', 'http.js');
    const script = `
      const { EventEmitter } = require('node:events');
      const { sse } = require(${JSON.stringify(modulo)});
      const res = new EventEmitter();
      res.writeHead = () => {};
      res.write = () => {};
      res.end = () => {};
      res.writableEnded = false;
      res.destroyed = false;
      sse(res);
      res.emit('close'); // simula o cliente derrubando a conexao sem chamar fechar()
      console.log('saiu-sozinho');
    `;
    const saida = execFileSync(process.execPath, ['-e', script], { timeout: 3000, encoding: 'utf8' });
    assert.strictEqual(saida.trim(), 'saiu-sozinho');
  });

  it('fechar() chamado duas vezes e seguro (idempotente)', () => {
    const { EventEmitter } = require('node:events');
    const resFalso = new EventEmitter();
    let endChamado = 0;
    resFalso.writeHead = () => {};
    resFalso.write = () => {};
    resFalso.end = () => { endChamado++; resFalso.writableEnded = true; };
    resFalso.writableEnded = false;
    resFalso.destroyed = false;

    const canal = sse(resFalso);
    canal.fechar();
    assert.doesNotThrow(() => canal.fechar());
    resFalso.emit('close'); // o proprio end() dispara 'close' na vida real
    assert.strictEqual(endChamado, 1);
  });
});

describe('caminhoDentroDoDiretorio - colisao de prefixo (Important 2)', () => {
  it('nao deixa um diretorio irmao com o mesmo prefixo passar pela checagem', () => {
    const raiz = '/app/publico';
    const vizinho = '/app/publico-secreto/x.txt';
    assert.strictEqual(caminhoDentroDoDiretorio(vizinho, raiz), false);
  });

  it('aceita a propria raiz e qualquer caminho dentro dela', () => {
    const raiz = '/app/publico';
    assert.strictEqual(caminhoDentroDoDiretorio(raiz, raiz), true);
    assert.strictEqual(caminhoDentroDoDiretorio('/app/publico/index.html', raiz), true);
    assert.strictEqual(caminhoDentroDoDiretorio('/app/publico/sub/dir/a.js', raiz), true);
  });
});
