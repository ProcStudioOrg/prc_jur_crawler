const fs = require('node:fs');
const path = require('node:path');
const { obterPonte } = require('./navegadorAssistido');
const { sanitizar } = require('../servidor/kaizen/assinatura');

const ERRO_CDP = 'Não foi possível conectar ao navegador remoto.';
const PRAZO_CAPTURA_MS = 8000;

// Registra toda página de todo contexto uma vez só, na ponte e na captura de falha.
function criarRegistro(ponte, aoPagina) {
  const contextos = new WeakSet();
  const paginas = new WeakSet();
  const anexarPagina = (page) => {
    if (paginas.has(page)) return;
    paginas.add(page);
    ponte.anexarPagina(page);
    if (aoPagina) { try { aoPagina(page); } catch { /* captura nunca derruba a busca */ } }
  };
  const anexarContexto = (context) => {
    if (!context || contextos.has(context)) return;
    contextos.add(context);
    context.on('page', anexarPagina);
    for (const page of context.pages()) anexarPagina(page);
  };
  return (browser) => {
    for (const context of browser.contexts()) anexarContexto(context);
    // browser.newPage() também passa por aqui (o Playwright chama this.newContext).
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...opcoes) => {
      const context = await newContext(...opcoes);
      anexarContexto(context);
      return context;
    };
  };
}

// Durante a captura de saída nenhum navegador novo começa: a promise fica pendente até o exit.
const NUNCA = () => new Promise(() => {});

function instrumentarChromium(chromium, ponte, { cdp, exclusivo = Boolean(cdp), aoPagina, encerrando = () => false } = {}) {
  const launch = chromium.launch.bind(chromium);
  const connectOverCDP = chromium.connectOverCDP.bind(chromium);
  const instrumentar = criarRegistro(ponte, aoPagina);
  let ocupado = false;
  chromium.launch = async (...args) => {
    if (encerrando()) return NUNCA();
    // A trava existe pela ponte/CDP (uma sessão por execução). Sem elas, crawler que abre
    // dois navegadores (STJ) segue como sempre.
    if (exclusivo && ocupado) throw new Error('Esta execução já possui um navegador em uso.');
    if (exclusivo) ocupado = true;
    try {
      // A URL vem somente da sessão provisionada pelo pai; nunca é enviada à UI.
      const browser = cdp ? await connectOverCDP(cdp) : await launch(...args);
      instrumentar(browser);
      if (exclusivo) browser.once('disconnected', () => { ocupado = false; ponte.encerrar(); });
      return browser;
    } catch (erro) {
      if (exclusivo) ocupado = false;
      // Erros de CDP podem conter o token do provedor na URL.
      if (cdp) throw new Error(ERRO_CDP);
      throw erro;
    }
  };
  // O FalcaoNavigator conecta direto; sem trava aqui, só registro das páginas.
  chromium.connectOverCDP = async (...args) => {
    if (encerrando()) return NUNCA();
    let browser;
    try { browser = await connectOverCDP(...args); } catch (erro) {
      if (cdp) throw new Error(ERRO_CDP);
      throw erro;
    }
    instrumentar(browser);
    return browser;
  };
}

function urlSemQuery(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname;
  } catch { return ''; }
}

// O FFD só aceita passo em [a-z0-9_:./#-] com até 80 caracteres; o resto vira '_'.
function normalizarPasso(texto) {
  return String(texto).toLowerCase().replace(/[^a-z0-9_:./#-]/g, '_').slice(0, 80);
}

function derivarPasso(url, _titulo) {
  if (globalThis.__jurPasso) return normalizarPasso(globalThis.__jurPasso);
  const limpa = sanitizar(urlSemQuery(url));
  if (!limpa) return 'desconhecido';
  return normalizarPasso(`pagina:${limpa.replace(/^https?:\/\//i, '')}`.replace(/\d+/g, '#'));
}

// Crawler real fecha o browser no `finally` e só depois o catch chama exit(1): na saída não há
// mais página aberta. Mas ~60 crawlers também ENGOLEM rejeições esperadas (networkidle, fallbacks)
// em buscas que dão certo, então fotografar a cada rejeição custaria I/O em busca bem-sucedida.
// Por isso é preguiçoso: a rejeição só MARCA a página como pendente (sem I/O); sucesso de outro
// método da mesma página desmarca; e a foto sai só no close() de página/contexto/browser que ainda
// encontre página pendente — a evidência da falha real, tirada com a página ainda viva.
const METODOS_PAGE = ['goto', 'waitForSelector', 'waitForURL', 'waitForLoadState', 'click', 'fill', 'type',
  'press', 'selectOption', 'check', 'waitForFunction', 'evaluate'];
const METODOS_LOCATOR = ['click', 'fill', 'waitFor'];
// Leituras: só o sucesso conta (desmarca a página). Fim de paginação e checagens opcionais são
// leituras com `.catch(() => null)`; se a última chamada de uma busca bem-sucedida fosse uma
// delas, o close pagaria uma foto à toa. Leitura que falha não marca: quem falha de verdade é
// a espera/ação que vem depois.
const LEITURAS_PAGE = ['content', 'title', '$eval', '$$eval', 'isVisible', 'isHidden', 'textContent',
  'innerText', 'getAttribute'];
const LEITURAS_LOCATOR = ['count', 'all', 'isVisible', 'isHidden', 'allTextContents', 'allInnerTexts',
  'evaluate', 'evaluateAll', 'textContent', 'innerText', 'getAttribute', 'inputValue'];
const ENVOLVIDO = Symbol.for('jur.kaizen.envolvido');
// Teto da foto tirada no close (CDP remoto incluso): pago só quando há falha pendente. A captura
// da saída com página aberta segue com PRAZO_CAPTURA_MS.
const PRAZO_FOTO_MS = 1500;

// Envolve os métodos que existem em `proto`. `antes` roda (e é aguardado) antes do original;
// `aoSucesso`/`aoFalhar` recebem o `this`. Nenhum hook lança, e o erro do crawler volta o MESMO.
function envolverMetodos(proto, nomes, { aoFalhar, aoSucesso, antes } = {}) {
  if (!proto) return;
  for (const nome of nomes) {
    const original = proto[nome];
    if (typeof original !== 'function' || original[ENVOLVIDO]) continue;
    const executar = function (self, args) {
      const promessa = original.apply(self, args);
      if (!promessa || typeof promessa.then !== 'function') return promessa;
      return promessa.then(
        (valor) => { try { aoSucesso?.(self); } catch { /* hook nunca lança */ } return valor; },
        (erro) => { try { aoFalhar?.(self); } catch { /* hook nunca lança */ } throw erro; },
      );
    };
    const envolvido = antes
      ? async function (...args) { try { await antes(this); } catch { /* foto nunca atrapalha */ } return executar(this, args); }
      : function (...args) { return executar(this, args); };
    envolvido[ENVOLVIDO] = true;
    try { proto[nome] = envolvido; } catch { /* protótipo congelado */ }
  }
}

// Lê print, HTML, URL e título correndo contra um único prazo: página travada não segura ninguém.
async function lerPagina(page, prazoMs) {
  const limite = Date.now() + prazoMs;
  const obter = (fn) => {
    const restante = limite - Date.now();
    if (restante <= 0) return Promise.resolve(null);
    let timer;
    const operacao = Promise.resolve().then(fn).catch(() => null);
    const prazo = new Promise((r) => { timer = setTimeout(() => r(null), restante); });
    return Promise.race([operacao, prazo]).finally(() => clearTimeout(timer));
  };
  const tela = await obter(() => page.screenshot({ type: 'png', fullPage: false }));
  const html = await obter(() => page.content());
  const url = (await obter(() => page.url())) || '';
  const titulo = (await obter(() => page.title())) || '';
  return { tela, html, url, titulo };
}

function criarCaptura({ dir, tribunal, rota, prazoMs = PRAZO_CAPTURA_MS, prazoFotoMs = PRAZO_FOTO_MS }) {
  const paginas = [];
  let promessa = null;
  let relogio = 0;
  const pendentes = new Map(); // página -> ordem da rejeição ainda sem sucesso depois
  let ultima = null; // { foto, seq }: foto de uma página pendente, tirada no close
  let fotografando = false;
  let lendo = 0; // leituras da própria captura (content/title) não mexem em pendente

  const marcar = (page) => { if (page && !lendo) pendentes.set(page, ++relogio); };
  const sucesso = (page) => {
    if (lendo) return;
    const seq = ++relogio;
    if (page) pendentes.delete(page);
    // Foto mais velha que um sucesso não é mais a causa de nada: outra falha não pode herdá-la.
    if (ultima && ultima.seq < seq) ultima = null;
  };

  async function fotografarPendente() {
    if (fotografando || !pendentes.size) return;
    let alvo = null;
    for (const [page, seq] of pendentes) {
      try { if (page.isClosed()) { pendentes.delete(page); continue; } } catch { pendentes.delete(page); continue; }
      if (!alvo || seq > alvo.seq) alvo = { page, seq };
    }
    if (!alvo) return;
    fotografando = true; // a própria leitura passa por métodos da página
    try {
      lendo++;
      let foto;
      try { foto = await lerPagina(alvo.page, prazoFotoMs); } finally { lendo--; }
      if (foto.tela || foto.html) ultima = { foto, seq: alvo.seq };
    } catch { /* swallow */ } finally { fotografando = false; }
  }

  // Uma vez só por protótipo: o Playwright compartilha Page, Locator, Context e Browser.
  function instalarFoto(page) {
    try {
      envolverMetodos(Object.getPrototypeOf(page), METODOS_PAGE, { aoFalhar: marcar, aoSucesso: sucesso });
      envolverMetodos(Object.getPrototypeOf(page), LEITURAS_PAGE, { aoSucesso: sucesso });
      envolverMetodos(Object.getPrototypeOf(page), ['close'], { antes: fotografarPendente });
      if (typeof page.locator === 'function') {
        // Locator não carrega a página no `this`: ela vem de `locator.page()`.
        const protoLocator = Object.getPrototypeOf(page.locator('html'));
        envolverMetodos(protoLocator, METODOS_LOCATOR,
          { aoFalhar: (loc) => marcar(loc.page()), aoSucesso: (loc) => sucesso(loc.page()) });
        envolverMetodos(protoLocator, LEITURAS_LOCATOR, { aoSucesso: (loc) => sucesso(loc.page()) });
      }
      const contexto = typeof page.context === 'function' ? page.context() : null;
      if (contexto) {
        envolverMetodos(Object.getPrototypeOf(contexto), ['close'], { antes: fotografarPendente });
        const browser = typeof contexto.browser === 'function' ? contexto.browser() : null;
        if (browser) envolverMetodos(Object.getPrototypeOf(browser), ['close'], { antes: fotografarPendente });
      }
    } catch { /* captura nunca derruba a busca */ }
  }

  function anexarPagina(page) {
    if (paginas.includes(page)) return;
    paginas.push(page);
    instalarFoto(page);
    try {
      page.once?.('close', () => { const i = paginas.indexOf(page); if (i >= 0) paginas.splice(i, 1); });
    } catch { /* página falsa ou já fechada */ }
  }

  function paginaAtual() {
    for (let i = paginas.length - 1; i >= 0; i--) {
      try { if (!paginas[i].isClosed()) return paginas[i]; } catch { /* segue para a anterior */ }
    }
    return null;
  }

  async function executar() {
    const page = paginaAtual();
    let foto = { tela: null, html: null, url: '', titulo: '' };
    if (page) { lendo++; try { foto = await lerPagina(page, prazoMs); } finally { lendo--; } }
    // Sem página aberta (o crawler fechou o browser no finally): vale a foto tirada na falha.
    else if (ultima) foto = ultima.foto;
    const { tela, html, url, titulo } = foto;
    const meta = {
      url: sanitizar(urlSemQuery(url)),
      titulo: sanitizar(titulo).slice(0, 300),
      passo: derivarPasso(url, titulo),
      tribunal: tribunal || null,
      rota: rota || null,
      erro: null, // preenchido pelo servidor, que tem o stderr
      em: new Date().toISOString(),
    };
    try { await fs.promises.mkdir(dir, { recursive: true }); } catch { /* o write abaixo decide */ }
    const gravar = async (nome, conteudo) => {
      try { await fs.promises.writeFile(path.join(dir, nome), conteudo); } catch { /* nunca lança */ }
    };
    if (Buffer.isBuffer(tela) && tela.length) await gravar('tela.png', tela);
    if (typeof html === 'string') await gravar('pagina.html', html);
    await gravar('meta.json', JSON.stringify(meta));
  }

  function capturar() {
    if (!promessa) promessa = executar().catch(() => {});
    return promessa;
  }

  return { anexarPagina, capturar };
}

// Consulta direta e listagens saem com 1 como resultado esperado ("não encontrado"), não como
// falha: nelas o exit segue o caminho original, sem captura nem atraso.
const FLAGS_CONSULTA = new Set(['-n', '--numero', '--decisao', '--acordao', '--teses', '--status', '-h', '--help']);
function modoConsulta(argv = []) {
  return argv.slice(2).some((a) => {
    const flag = String(a).split('=')[0];
    return FLAGS_CONSULTA.has(flag) || flag.startsWith('--listar');
  });
}

// Pelo servidor, JUR_CAPTURA decide: só ele sabe se `-n` é consulta pura ou filtro de uma busca
// com -q (trf1/trf3/trf5), ou se --decisao/--teses é busca (tcepa/tcemg). O argv é o palpite da
// CLI usada direto, sem o servidor.
function capturaLigada(env = process.env, argv = process.argv) {
  if (env.JUR_CAPTURA) return env.JUR_CAPTURA !== '0';
  return !modoConsulta(argv);
}

const silenciar = (stream) => {
  if (!stream || typeof stream.write !== 'function') return;
  stream.write = (_chunk, codificacao, cb) => {
    const fim = typeof codificacao === 'function' ? codificacao : cb;
    if (typeof fim === 'function') process.nextTick(fim);
    return true;
  };
};

// Devolve { encerrando() } para o chromium instrumentado recusar trabalho novo durante a captura.
function instalarSaida(captura, processo = process, { tetoMs = PRAZO_CAPTURA_MS + 1000 } = {}) {
  const sair = processo.exit.bind(processo);
  let saindo = false;
  // Cancelamento do usuario chega como SIGTERM no grupo: o handler do Playwright fecha o browser,
  // o await do crawler rejeita e ele chama exit(1). Isso nao e falha — sai na hora, sem captura.
  let cancelado = false;
  const capturarESair = (codigo) => {
    saindo = true;
    // O envelope JSON já foi escrito: quem chamou exit(1) continua rodando (o exit interceptado
    // retorna), e nada do que ele escrever depois pode virar a "última linha" lida pelo executor.
    silenciar(processo.stdout);
    silenciar(processo.stderr);
    // Se o loop esvaziar antes, o processo ainda sai com o código certo.
    processo.exitCode = codigo;
    // Teto absoluto além do prazo da captura: a CLI nunca fica pendurada aqui.
    let timer;
    const teto = new Promise((r) => { timer = setTimeout(r, tetoMs); });
    Promise.race([Promise.resolve().then(() => captura.capturar()).catch(() => {}), teto])
      .finally(() => { clearTimeout(timer); sair(codigo); });
  };
  processo.exit = (codigo) => {
    if (cancelado && !saindo) return sair(codigo);
    // Depois do primeiro código ≠ 0 tudo é ignorado, inclusive um exit(0) de um fluxo que seguiu.
    if (saindo) return;
    const efetivo = codigo ?? processo.exitCode ?? 0;
    if (Number(efetivo) === 0) return sair(codigo);
    capturarESair(efetivo);
  };
  // Com listener próprio o Node não imprime nem sai sozinho: refazemos as duas coisas, com captura.
  const fatal = (erro) => {
    if (saindo) return;
    try { processo.stderr?.write(`${erro?.stack || erro}\n`); } catch { /* stderr fechado */ }
    if (cancelado) return sair(1);
    processo.exit(1);
  };
  try {
    processo.on('uncaughtException', fatal);
    processo.on('unhandledRejection', fatal);
  } catch { /* processo falso sem eventos */ }
  // O executor manda SIGUSR2 no estouro de tempo para dar à captura uma janela antes do kill.
  try { processo.on('SIGUSR2', () => { if (!saindo && !cancelado) capturarESair(1); }); } catch { /* plataforma sem o sinal */ }
  // `on`, nunca substituir: o handler do Playwright continua fechando o browser. E so enquanto
  // houver outro listener de SIGTERM (o do Playwright, posto no launch): listener proprio anula a
  // acao padrao do sinal, e sem browser aberto — ou com o loop travado — o node tem de morrer no
  // SIGTERM como morreria sem o preload.
  let vigiando = false;
  const aoSigterm = () => {
    cancelado = true;
    if (processo.listenerCount('SIGTERM') > 1) return;
    // Sozinho no sinal (nao deveria acontecer): devolve o SIGTERM ao Node.
    try { processo.off('SIGTERM', aoSigterm); processo.kill(processo.pid, 'SIGTERM'); } catch { sair(143); }
  };
  const vigiar = () => { if (!vigiando) { vigiando = true; processo.on('SIGTERM', aoSigterm); } };
  try {
    if (processo.listenerCount('SIGTERM') > 0) vigiar();
    processo.on('newListener', (evento, fn) => { if (evento === 'SIGTERM' && fn !== aoSigterm) vigiar(); });
    processo.on('removeListener', (evento, fn) => {
      if (evento !== 'SIGTERM' || fn === aoSigterm || !vigiando) return;
      if (processo.listenerCount('SIGTERM') === 1) { vigiando = false; processo.off('SIGTERM', aoSigterm); }
    });
  } catch { /* processo falso sem eventos */ }
  return { encerrando: () => saindo };
}

{
  const ponte = obterPonte();
  const cdp = process.env.JUR_BROWSER_CDP;
  let captura = null;
  let saida = null;
  if (process.env.JUR_FALHA_DIR && capturaLigada()) {
    captura = criarCaptura({ dir: process.env.JUR_FALHA_DIR, tribunal: process.argv[2], rota: cdp ? 'remoto' : 'local' });
    saida = instalarSaida(captura);
  }
  instrumentarChromium(require('playwright').chromium, ponte || { anexarPagina() {}, encerrar() {} }, {
    cdp, exclusivo: Boolean(ponte || cdp), aoPagina: captura?.anexarPagina, encerrando: saida?.encerrando,
  });
}

module.exports = { envolverMetodos, instrumentarChromium, criarCaptura, derivarPasso, urlSemQuery, instalarSaida, modoConsulta, capturaLigada };
