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
        // reject() primeiro, destroy() depois — nessa ordem, de proposito. O
        // 'await lerCorpo(req)' do chamador retoma como microtask assim que
        // reject() roda, e microtasks sempre drenam antes do proximo macrotask
        // do event loop; o req.destroy() abaixo esta agendado num setImmediate
        // (macrotask, fase "check"), entao o catch do chamador tem a janela
        // inteira entre poll e check para escrever e despachar o 400 antes do
        // socket cair. Sem essa ordem (destroy sincrono, como antes) o cliente
        // via ECONNRESET em vez de resposta, porque destruir o socket mata o
        // res que o compartilha com o req antes do handler conseguir responder.
        //
        // O destroy em si continua obrigatorio e nao pode sumir: sem ele o
        // socket segue recebendo os bytes que faltam mesmo depois do reject, e
        // o limite de 1MB vira cosmetico — o DoS de memoria que ele existe pra
        // evitar. So adiamos o QUANDO, nao removemos o accept.
        //
        // MEDIDO, nao garantido: com uma requisicao normal (corpo grande demais
        // enviado de uma vez, ex. via fetch) a resposta 400 chega limpa 30/30
        // vezes. Sob um upload continuo em alta velocidade (o proprio cenario de
        // flood que o limite existe para conter) cai para ~80% (12/15) — o resto
        // ainda ve ECONNRESET, porque destruir um socket com bytes ainda
        // chegando no lado de leitura pode fazer o SO mandar RST em vez de FIN,
        // e um RST pode descartar bytes de resposta ja escritos mas nao
        // confirmados pelo peer. Nao ha como fechar essa lacuna sem parar de
        // ler o socket de forma graciosa (pause em vez de destroy), o que
        // trocaria um risco de memoria conhecido e mitigado por um vazamento de
        // conexao sem timeout — pior. Aceito: o cliente que manda corpo grande
        // demais pode ver 400 OU ECONNRESET; nunca ve o processo cair nem o
        // corpo aceito.
        reject(new Error('corpo grande demais'));
        setImmediate(() => { if (!req.destroyed) req.destroy(); });
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

/**
 * Verificacao de Origin para as superficies que um site hostil poderia dirigir a
 * partir do browser da vitima (achado C2 da revisao final).
 *
 * O problema medido: `POST /mcp` com `Origin: https://evil.example` e
 * `content-type: text/plain` e uma "requisicao simples" no modelo do CORS — o browser
 * NAO faz preflight, entao a ausencia de cabecalhos CORS na resposta nao impede o
 * envio, so impede o site de LER a resposta. Para o MCP isso ja basta: o pedido chega
 * e EXECUTA (tools/call enfileira busca; tools/list vaza o catalogo de ferramentas).
 * O mesmo vale para POST /api/v1/chat, que gasta a chave da Anthropic do operador.
 * O spec do MCP exige validar Origin em transporte HTTP exatamente por isso.
 *
 * Politica:
 * - Sem cabecalho Origin: PERMITE. Cliente nao-browser (curl, cliente MCP nativo,
 *   SDK) nao manda Origin; exigi-lo quebraria todo consumidor legitimo sem fechar
 *   nada — o ataque que isto barra so existe quando ha um browser, e browser sempre
 *   manda Origin em requisicao cross-site.
 * - Origin de loopback (localhost, 127.x, ::1): PERMITE — e o frontend do proprio jur.
 * - Origin igual ao Host da requisicao: PERMITE. E o caso de quem expos o servico de
 *   proposito (JUR_BIND) e abre a UI pelo IP da LAN: o front e servido pela mesma
 *   origem, entao continua funcionando sem afrouxar nada para terceiros.
 * - Qualquer outra coisa (inclusive "null", a origem opaca de iframe sandbox e
 *   file://, que nem parseia como URL): RECUSA.
 */
function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return true;

  let u;
  try { u = new URL(origem); } catch { return false; }

  const h = u.hostname;
  // Ancorado nas duas pontas de proposito: /^127\./ sozinho aceitaria o hostname
  // "127.0.0.1.evil.example", que e um dominio de terceiro, nao loopback. (Pego pelo
  // proprio teste desta correcao.)
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  const host = req.headers.host;
  if (host && u.host === host) return true;

  return false;
}

/**
 * Aplica origemPermitida e ja responde 403 quando recusa. Devolve true quando a
 * requisicao foi BLOQUEADA (o chamador deve retornar imediatamente).
 */
function bloquearOrigemHostil(req, res) {
  if (origemPermitida(req)) return false;
  json(res, 403, {
    erro: 'origem nao permitida',
    detalhe: 'esta superficie so aceita requisicoes locais ou da mesma origem; '
      + `Origin recebida: ${req.headers.origin}`,
  });
  return true;
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

module.exports = { criarRoteador, json, sse, lerCorpo, caminhoDentroDoDiretorio, origemPermitida, bloquearOrigemHostil };
