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

function criarCaptura({ dir, tribunal, rota, prazoMs = PRAZO_CAPTURA_MS }) {
  const paginas = [];
  let promessa = null;

  function anexarPagina(page) {
    if (paginas.includes(page)) return;
    paginas.push(page);
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
    const limite = Date.now() + prazoMs;
    // Cada leitura corre contra o prazo restante: página travada não segura a saída.
    const obter = (fn) => {
      const restante = limite - Date.now();
      if (restante <= 0) return Promise.resolve(null);
      let timer;
      const operacao = Promise.resolve().then(fn).catch(() => null);
      const prazo = new Promise((r) => { timer = setTimeout(() => r(null), restante); });
      return Promise.race([operacao, prazo]).finally(() => clearTimeout(timer));
    };
    const page = paginaAtual();
    let tela = null; let html = null; let url = ''; let titulo = '';
    if (page) {
      tela = await obter(() => page.screenshot({ type: 'png', fullPage: false }));
      html = await obter(() => page.content());
      url = (await obter(() => page.url())) || '';
      titulo = (await obter(() => page.title())) || '';
    }
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

module.exports = { instrumentarChromium, criarCaptura, derivarPasso, urlSemQuery, instalarSaida, modoConsulta, capturaLigada };
