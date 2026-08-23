// jur/publico/app.js
const $ = (s, raiz = document) => raiz.querySelector(s);
const CHAVE_LLM = 'jur.chaveLlm';
const CHAVE_TEMA = 'jur.tema';
const CHAVE_MODELO = 'jur.modelo';
const CHAVE_ESFORCO = 'jur.esforco';

const guardado = {
  ler(k, padrao = '') { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } },
  escrever(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

// ---------- API ----------
window.jurApi = {
  chave: () => guardado.ler(CHAVE_LLM).trim(),
  async pedir(caminho, opcoes = {}) {
    const r = await fetch(caminho, {
      ...opcoes,
      headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) },
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      throw new Error(corpo.erro || `HTTP ${r.status}`);
    }
    return r.status === 204 ? null : r.json();
  },
};

// ---------- tema ----------
function aplicarTema(t) {
  if (t) document.documentElement.dataset.tema = t;
  else delete document.documentElement.dataset.tema;
}
aplicarTema(guardado.ler(CHAVE_TEMA, ''));
$('#tema').addEventListener('click', () => {
  const atual = document.documentElement.dataset.tema;
  const escuroAgora = atual ? atual === 'escuro'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const novo = escuroAgora ? 'claro' : 'escuro';
  aplicarTema(novo);
  guardado.escrever(CHAVE_TEMA, novo);
});

// ---------- lateral em tela estreita (I4) ----------
// Abaixo de 860px a lateral e uma gaveta. Sem isto ela simplesmente desaparecia, e com
// ela iam Nova conversa, o historico e Configuracoes — o unico lugar da interface onde se
// digita a chave da Anthropic. O chat pedia "informe na interface" e nao havia interface
// para obedecer. O CSS decide QUANDO a gaveta existe; aqui so ligamos o abre/fecha.
const botaoLateral = $('#abrir-lateral');
const fundoLateral = $('#fundo-lateral');

function lateralAberta() { return document.body.classList.contains('lateral-aberta'); }

function fecharLateral(devolverFoco = false) {
  if (!lateralAberta()) return;
  document.body.classList.remove('lateral-aberta');
  botaoLateral.setAttribute('aria-expanded', 'false');
  if (devolverFoco) botaoLateral.focus();
}

function abrirLateral() {
  document.body.classList.add('lateral-aberta');
  botaoLateral.setAttribute('aria-expanded', 'true');
  // Leva o foco para dentro da gaveta: sem isto quem navega por teclado abriria a gaveta
  // e continuaria com o foco no botao, tabulando por cima do conteudo de baixo.
  $('#nova-conversa').focus();
}

botaoLateral.addEventListener('click', () => (lateralAberta() ? fecharLateral(true) : abrirLateral()));
fundoLateral.addEventListener('click', () => fecharLateral());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharLateral(true); });
// Escolher qualquer coisa dentro da gaveta fecha a gaveta — menos o "×" de apagar, que
// deixa o usuario na lista para apagar mais de uma conversa.
$('#lateral').addEventListener('click', (e) => {
  if (e.target.closest('.apagar')) return;
  if (e.target.closest('#nova-conversa, .conversa-item, #abrir-config')) fecharLateral();
});

// ---------- painéis ----------
window.jurUI = {
  abrirPainel(painel, html) {
    painel.innerHTML = `<div class="painel-caixa"><button class="fechar" aria-label="Fechar">×</button>${html}</div>`;
    painel.hidden = false;
    const fechar = () => { painel.hidden = true; };
    $('.fechar', painel).addEventListener('click', fechar);
    painel.addEventListener('click', (e) => { if (e.target === painel) fechar(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
    });
    return painel;
  },
  preencherEntrada(texto) {
    const campo = $('.entrada', caixaAtiva());
    campo.value = texto;
    campo.focus();
    ajustarAltura(campo);
  },
};

// ---------- caixa de entrada ----------
function montarCaixa(destino) {
  destino.innerHTML = '';
  destino.appendChild($('#tpl-entrada').content.cloneNode(true));
  const form = $('.formulario', destino);
  const campo = $('.entrada', destino);
  const modelo = $('.modelo', destino);
  const esforco = $('.esforco', destino);

  modelo.value = guardado.ler(CHAVE_MODELO, 'claude-opus-5');
  esforco.value = guardado.ler(CHAVE_ESFORCO, 'high');
  sincronizarEsforco(modelo, esforco);

  modelo.addEventListener('change', () => {
    guardado.escrever(CHAVE_MODELO, modelo.value);
    sincronizarEsforco(modelo, esforco);
  });
  esforco.addEventListener('change', () => guardado.escrever(CHAVE_ESFORCO, esforco.value));

  campo.addEventListener('input', () => ajustarAltura(campo));
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(campo, modelo.value, esforco.value); });
  return destino;
}

/**
 * Modelos que REJEITAM o campo esforco na API (o SDK devolve 400 se ele for
 * mandado). Fonte unica: tanto `sincronizarEsforco` (esconder o <select>, que e so
 * apresentacao) quanto `enviar` (o que de fato vai no corpo do POST) consultam esta
 * mesma lista — revisao encontrou que o codigo anterior so escondia o <select> mas
 * `enviar` continuava lendo `esforco.value` mesmo escondido, e mandava "high" junto
 * com claude-haiku-4-5, quebrando o chat com 400 assim que alguem trocava de modelo.
 */
const MODELOS_SEM_ESFORCO = new Set(['claude-haiku-4-5']);
function aceitaEsforco(modelo) { return !MODELOS_SEM_ESFORCO.has(modelo); }

/** O haiku rejeita nivel de esforco na API — some com o seletor nele. */
function sincronizarEsforco(modelo, esforco) {
  esforco.hidden = !aceitaEsforco(modelo.value);
}

function ajustarAltura(campo) {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 200)}px`;
}

const caixaAtiva = () => ($('#conversa').hidden ? $('#caixa-inicial') : $('#caixa-conversa'));

// ---------- histórico ----------
let conversaAtual = null;
/** O que vai para a API a cada turno. Reconstruido ao abrir conversa existente. */
const historicoLocal = [];

async function carregarHistorico() {
  const alvo = $('#historico');
  let lista = [];
  try { lista = (await window.jurApi.pedir('/api/v1/conversas')).conversas; } catch { /* segue vazio */ }
  if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma conversa ainda.</p>'; return; }
  alvo.innerHTML = '<h2>Conversas</h2>';
  for (const c of lista) {
    const item = document.createElement('div');
    item.className = 'conversa-item';
    item.setAttribute('aria-current', String(c.id === conversaAtual));
    const titulo = document.createElement('span');
    titulo.textContent = c.titulo || 'Sem título';
    item.appendChild(titulo);
    const apagar = document.createElement('button');
    apagar.className = 'apagar'; apagar.textContent = '×';
    apagar.title = 'Apagar conversa';
    // I5: o botao e visivel sempre (ver estilo.css); o rotulo acessivel importa porque
    // "×" sozinho nao diz nada a quem chega nele por teclado ou leitor de tela.
    apagar.setAttribute('aria-label', `Apagar conversa: ${c.titulo || 'Sem título'}`);
    apagar.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.jurApi.pedir(`/api/v1/conversas/${c.id}`, { method: 'DELETE' });
      if (c.id === conversaAtual) irParaInicial();
      carregarHistorico();
    });
    item.appendChild(apagar);
    item.addEventListener('click', () => abrirConversa(c.id));
    alvo.appendChild(item);
  }
}

function irParaInicial() {
  conversaAtual = null;
  $('#conversa').hidden = true;
  $('#inicial').hidden = false;
  $('#mensagens').innerHTML = '';
  carregarHistorico();
}

async function abrirConversa(id) {
  const dados = await window.jurApi.pedir(`/api/v1/conversas/${id}`);
  conversaAtual = id;
  $('#inicial').hidden = true;
  $('#conversa').hidden = false;
  montarCaixa($('#caixa-conversa'));

  const alvo = $('#mensagens');
  alvo.innerHTML = '';

  // O historico enviado ao modelo precisa voltar INTEIRO, com os blocos de ferramenta —
  // sem eles o modelo perde os job_id das buscas que ele mesmo fez nesta conversa.
  historicoLocal.length = 0;
  for (const m of dados.mensagens) {
    historicoLocal.push({ role: m.papel, content: m.conteudo });
    const texto = typeof m.conteudo === 'string'
      ? m.conteudo
      : m.conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (texto) bolha(m.papel === 'user' ? 'user' : 'assistant', texto);
  }
  carregarHistorico();
}

$('#nova-conversa').addEventListener('click', irParaInicial);

// ---------- mensagens ----------
function bolha(classe, texto) {
  const div = document.createElement('div');
  div.className = `msg ${classe}`;
  div.textContent = texto;
  $('#mensagens').appendChild(div);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  return div;
}

async function lerSSE(resposta, aoEvento, aoAtividade) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (aoAtividade) aoAtividade();
    buffer += dec.decode(value, { stream: true });
    const partes = buffer.split('\n\n');
    buffer = partes.pop();
    for (const parte of partes) {
      const nome = (parte.match(/^event: (.+)$/m) || [])[1];
      const dado = (parte.match(/^data: (.+)$/m) || [])[1];
      if (!nome || !dado) continue;
      try { aoEvento(nome, JSON.parse(dado)); } catch { /* fragmento */ }
    }
  }
}

async function enviar(campo, modelo, esforco) {
  const texto = campo.value.trim();
  if (!texto) return;

  // Trava sincrona, ANTES de qualquer await: dois Enter (ou dois cliques) quase
  // simultaneos na mesma caixa chamam `enviar` duas vezes antes do primeiro `await`
  // devolver. Sem desabilitar AQUI — e nao so depois de criar a conversa, como antes —
  // o segundo passa pelo `if (!conversaAtual)` antes do primeiro POST
  // /api/v1/conversas responder, e cria duas conversas para o mesmo envio.
  const botaoNoInicio = $('.enviar', caixaAtiva());
  if (botaoNoInicio.disabled) return;
  botaoNoInicio.disabled = true;

  if (!conversaAtual) {
    let c;
    try {
      c = await window.jurApi.pedir('/api/v1/conversas', { method: 'POST', body: '{}' });
    } catch (e) {
      botaoNoInicio.disabled = false;
      bolha('erro', e.message);
      return;
    }
    conversaAtual = c.id;
    historicoLocal.length = 0;
    $('#inicial').hidden = true;
    $('#conversa').hidden = false;
    $('#mensagens').innerHTML = '';
    montarCaixa($('#caixa-conversa'));
  }

  // O botao que fica desabilitado durante o streaming: se a conversa acabou de ser
  // criada, `montarCaixa` trocou o DOM e este e um botao NOVO; se a conversa ja
  // existia, e o mesmo `botaoNoInicio` travado acima.
  const botao = $('.enviar', caixaAtiva());
  botao.disabled = true;

  campo.value = ''; ajustarAltura(campo);
  bolha('user', texto);
  historicoLocal.push({ role: 'user', content: texto });

  // Amarra esta resposta a conversa que a originou. Se o usuario trocar de conversa
  // enquanto o streaming ainda esta rodando, os deltas que chegarem depois nao podem
  // renderizar na tela nem entrar no `historicoLocal` da conversa que estiver ativa
  // NAQUELE momento — ela pertence a outra conversa. O servidor ja persiste a
  // resposta inteira no banco pelo `conversaId` que mandamos no corpo do POST
  // (ver servidor/rotas/chat.js), entao deixamos o stream terminar sozinho (o `signal`
  // so aborta por timeout de inatividade, nao por troca de tela) — a conversa orfa
  // fica gravada e aparece certinha da proxima vez que o usuario abri-la.
  const conversaDoEnvio = conversaAtual;

  let destino = null;
  const controle = new AbortController();
  let relogio = setTimeout(() => controle.abort(), 30000);
  const renovar = () => { clearTimeout(relogio); relogio = setTimeout(() => controle.abort(), 30000); };

  try {
    const cab = { 'content-type': 'application/json' };
    const chave = window.jurApi.chave();
    if (chave) cab['x-api-key'] = chave;

    // O que vai no corpo depende do MODELO, nao de o <select> de esforco estar
    // visivel — esconder e so apresentacao (sincronizarEsforco). Mandar "esforco"
    // com claude-haiku-4-5 e 400 na API.
    const esforcoParaEnviar = aceitaEsforco(modelo) ? esforco : undefined;

    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cab, signal: controle.signal,
      body: JSON.stringify({
        mensagens: historicoLocal, modelo, esforco: esforcoParaEnviar, conversaId: conversaAtual,
      }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      if (conversaAtual === conversaDoEnvio) bolha('erro', corpo.erro);
      return;
    }
    await lerSSE(r, (nome, dados) => {
      const aindaNaMesmaConversa = conversaAtual === conversaDoEnvio;
      if (nome === 'texto') {
        if (!aindaNaMesmaConversa) return;
        if (!destino) destino = bolha('assistant', '');
        destino.textContent += dados.texto;
        $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
      } else if (nome === 'ferramenta') {
        if (!aindaNaMesmaConversa) return;
        bolha('ferramenta', `▸ ${dados.nome}(${JSON.stringify(dados.entrada)})`);
        destino = null;
      } else if (nome === 'fim') {
        if (aindaNaMesmaConversa) {
          // C1: o turno inteiro, com os blocos `tool_use`/`tool_result` como vieram do
          // servidor — NAO `{role:'assistant', content: dados.texto}`. Achatar aqui era o
          // caminho paralelo ao de `abrirConversa` (que reidrata do banco integro) e
          // valia durante a MESMA sessao, sem recarregar: como o servidor usa o
          // `mensagens` que ESTE cliente manda, o turno 2 saia sem ferramenta nenhuma
          // mesmo com o banco tendo tudo. O usuario perdia o `job_id` (pedia "mostra os 5
          // primeiros" e o modelo refazia o crawl) e — pior — a ressalva do zero, que
          // mora dentro do `tool_result`: fora do contexto, nada impede o modelo de
          // afirmar "nao ha jurisprudencia".
          const novas = Array.isArray(dados.mensagens) && dados.mensagens.length
            ? dados.mensagens
            : [{ role: 'assistant', content: dados.texto }];
          for (const m of novas) historicoLocal.push({ role: m.role, content: m.content });
          carregarHistorico();
        }
        // Orfa: nada a fazer aqui — o servidor ja gravou a resposta inteira no banco,
        // associada a conversaDoEnvio.
      } else if (nome === 'erro') {
        if (aindaNaMesmaConversa) bolha('erro', dados.erro);
      }
    }, renovar);
  } catch (e) {
    if (conversaAtual === conversaDoEnvio) {
      bolha('erro', e.name === 'AbortError' ? 'A resposta demorou demais e foi interrompida.' : e.message);
    }
  } finally {
    clearTimeout(relogio);
    botao.disabled = false;
    // Reabilita tambem o botao ORIGINAL da caixa inicial: quando este envio criou a
    // conversa, `botao` (acima) e um elemento NOVO em #caixa-conversa — o antigo em
    // #caixa-inicial, que travamos no topo da funcao, e persistente no DOM (so e
    // montado uma vez, no carregamento) e ficava desabilitado pra sempre depois do
    // primeiro envio se nao fosse reabilitado aqui tambem.
    botaoNoInicio.disabled = false;
  }
}

// ---------- início ----------
montarCaixa($('#caixa-inicial'));
carregarHistorico();
