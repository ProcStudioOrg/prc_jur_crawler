const fs = require('node:fs');
const path = require('node:path');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, codigo, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(texto);
}

function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const batimento = setInterval(() => res.write(': ping\n\n'), 15000);
  return {
    enviar(evento, dado) {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`);
    },
    fechar() {
      clearInterval(batimento);
      res.end();
    },
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    req.on('data', (d) => {
      bruto += d;
      if (bruto.length > 1_000_000) reject(new Error('corpo grande demais'));
    });
    req.on('end', () => {
      if (!bruto) return resolve({});
      try { resolve(JSON.parse(bruto)); } catch { reject(new Error('corpo nao e JSON valido')); }
    });
    req.on('error', reject);
  });
}

function compilar(padrao) {
  const nomes = [];
  const fonte = padrao.replace(/:([a-zA-Z]+)/g, (_, nome) => { nomes.push(nome); return '([^/]+)'; });
  return { re: new RegExp(`^${fonte}$`), nomes };
}

function criarRoteador() {
  const rotas = [];
  const estaticos = [];

  function rota(metodo, padrao, handler) {
    rotas.push({ metodo, ...compilar(padrao), handler });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const caminho = url.pathname;
    req.query = Object.fromEntries(url.searchParams);

    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = caminho.match(r.re);
      if (!m) continue;
      req.params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      try {
        return await r.handler(req, res);
      } catch (e) {
        if (!res.headersSent) return json(res, 500, { erro: e.message });
        return res.end();
      }
    }

    for (const e of estaticos) {
      if (!caminho.startsWith(e.prefixo)) continue;
      const relativo = caminho.slice(e.prefixo.length) || 'index.html';
      // path.normalize + verificacao de prefixo impede subir de diretorio com ../
      const alvo = path.resolve(e.dir, relativo.replace(/^\/+/, ''));
      if (!alvo.startsWith(path.resolve(e.dir))) return json(res, 403, { erro: 'proibido' });
      if (fs.existsSync(alvo) && fs.statSync(alvo).isFile()) {
        res.writeHead(200, { 'content-type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
        return fs.createReadStream(alvo).pipe(res);
      }
    }

    return json(res, 404, { erro: 'rota nao encontrada' });
  }

  return {
    rota,
    estaticos: (dir, prefixo = '/') => estaticos.push({ dir, prefixo }),
    handler,
  };
}

module.exports = { criarRoteador, json, sse, lerCorpo };
