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

/** O haiku rejeita nivel de esforco na API — some com o seletor nele. */
function sincronizarEsforco(modelo, esforco) {
  esforco.hidden = modelo.value === 'claude-haiku-4-5';
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

  if (!conversaAtual) {
    const c = await window.jurApi.pedir('/api/v1/conversas', { method: 'POST', body: '{}' });
    conversaAtual = c.id;
    historicoLocal.length = 0;
    $('#inicial').hidden = true;
    $('#conversa').hidden = false;
    $('#mensagens').innerHTML = '';
    montarCaixa($('#caixa-conversa'));
  }

  const botao = $('.enviar', caixaAtiva());
  botao.disabled = true;
  campo.value = ''; ajustarAltura(campo);
  bolha('user', texto);
  historicoLocal.push({ role: 'user', content: texto });

  let destino = null;
  const controle = new AbortController();
  let relogio = setTimeout(() => controle.abort(), 30000);
  const renovar = () => { clearTimeout(relogio); relogio = setTimeout(() => controle.abort(), 30000); };

  try {
    const cab = { 'content-type': 'application/json' };
    const chave = window.jurApi.chave();
    if (chave) cab['x-api-key'] = chave;

    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cab, signal: controle.signal,
      body: JSON.stringify({ mensagens: historicoLocal, modelo, esforco, conversaId: conversaAtual }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      bolha('erro', corpo.erro);
      return;
    }
    await lerSSE(r, (nome, dados) => {
      if (nome === 'texto') {
        if (!destino) destino = bolha('assistant', '');
        destino.textContent += dados.texto;
        $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
      } else if (nome === 'ferramenta') {
        bolha('ferramenta', `▸ ${dados.nome}(${JSON.stringify(dados.entrada)})`);
        destino = null;
      } else if (nome === 'fim') {
        historicoLocal.push({ role: 'assistant', content: dados.texto });
        carregarHistorico();
      } else if (nome === 'erro') {
        bolha('erro', dados.erro);
      }
    }, renovar);
  } catch (e) {
    bolha('erro', e.name === 'AbortError' ? 'A resposta demorou demais e foi interrompida.' : e.message);
  } finally {
    clearTimeout(relogio);
    botao.disabled = false;
  }
}

// ---------- início ----------
montarCaixa($('#caixa-inicial'));
carregarHistorico();
