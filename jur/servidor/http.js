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

  let fechado = false;
  function fechar() {
    // Idempotente: 'close' pode disparar depois de um fechar() explicito (o proprio
    // res.end() dispara 'close'), e nada externo pode garantir que cada rota lembre
    // de chamar fechar() uma unica vez.
    if (fechado) return;
    fechado = true;
    clearInterval(batimento);
    if (!res.writableEnded && !res.destroyed) {
      try { res.end(); } catch { /* socket ja pode ter caido */ }
    }
  }

  // Autolimpeza: se o cliente cair sem ninguem chamar fechar() (queda de rede, aba
  // fechada), 'close' ainda dispara no res e limpa o setInterval sozinho — sem isso
  // cada cliente SSE que desconecta deixa um timer vivo para sempre.
  res.on('close', fechar);

  return {
    enviar(evento, dado) {
      if (fechado) return;
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`);
    },
    fechar,
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    let terminado = false;

    function pararDeOuvir() {
      req.off('data', aoDado);
      req.off('end', aoFim);
      req.off('error', aoErro);
    }

    function aoDado(d) {
      if (terminado) return;
      bruto += d;
      if (bruto.length > 1_000_000) {
        terminado = true;
        pararDeOuvir();
        // Sem isso o socket continua recebendo os bytes que faltam mesmo depois
        // do reject: o limite vira cosmetico e vira DoS de uma linha.
        req.destroy();
        reject(new Error('corpo grande demais'));
      }
    }

    function aoFim() {
      if (terminado) return;
      terminado = true;
      if (!bruto) return resolve({});
      try { resolve(JSON.parse(bruto)); } catch { reject(new Error('corpo nao e JSON valido')); }
    }

    function aoErro(e) {
      if (terminado) return;
      terminado = true;
      pararDeOuvir();
      reject(e);
    }

    req.on('data', aoDado);
    req.on('end', aoFim);
    req.on('error', aoErro);
  });
}

function caminhoDentroDoDiretorio(alvo, raiz) {
  // "alvo.startsWith(raiz)" sozinho, sem separador, deixaria um diretorio irmao cujo
  // nome comeca com o mesmo prefixo (ex.: raiz "/app/publico" e alvo
  // "/app/publico-secreto/x") passar pela checagem. Hoje, com o parser do URL
  // normalizando "../" antes do handler e sem decodeURIComponent no caminho estatico,
  // isso e inofensivo na pratica — mas a checagem em si precisa estar certa, porque um
  // decode futuro no caminho (p.ex. para suportar "%20" em nome de arquivo) fura essa
  // protecao em silencio se ela continuar frouxa.
  return alvo === raiz || alvo.startsWith(raiz + path.sep);
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
      try {
        // decodeURIComponent lanca URIError sincrono para "%" solto/sequencia invalida.
        // Precisa estar dentro do try: fora dele, dentro de uma async function, vira
        // promise rejeitada sem handler no http.createServer -> unhandledRejection ->
        // processo morre e derruba todas as conexoes.
        req.params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        return await r.handler(req, res);
      } catch (e) {
        if (res.headersSent) return res.end();
        if (e instanceof URIError) return json(res, 400, { erro: 'parametro malformado' });
        // Decisao consciente: expor e.message cru é aceitavel em rede local (sem
        // usuario externo batendo direto no servidor). Se este servico um dia sair
        // de localhost, isso precisa virar uma mensagem generica + log interno.
        return json(res, 500, { erro: e.message });
      }
    }

    for (const e of estaticos) {
      if (!caminho.startsWith(e.prefixo)) continue;
      const relativo = caminho.slice(e.prefixo.length) || 'index.html';
      // path.normalize + verificacao de prefixo impede subir de diretorio com ../
      const alvo = path.resolve(e.dir, relativo.replace(/^\/+/, ''));
      if (!caminhoDentroDoDiretorio(alvo, path.resolve(e.dir))) return json(res, 403, { erro: 'proibido' });
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

module.exports = { criarRoteador, json, sse, lerCorpo, caminhoDentroDoDiretorio };
