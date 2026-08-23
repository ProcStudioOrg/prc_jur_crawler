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

/**
 * Enquanto houver ALGUMA conversa respondendo, a lista se recarrega sozinha. O turno
 * agora sobrevive ao navegador fechar (servidor/turnos.js), e sem esta sondagem o
 * indicador ficaria aceso para sempre numa conversa que ja terminou — ou, pior, nunca
 * acenderia numa aberta em outra aba.
 */
let relogioHistorico = null;
/**
 * Conversas cujo turno ESTE cliente esta transmitindo agora (o stream do proprio POST
 * /api/v1/chat). Serve a duas coisas:
 *
 *  1. Decidir se vale sondar a lista. No instante em que o envio comeca o servidor ainda
 *     nao registrou o turno, entao `emAndamento` volta false e a sondagem nunca seria
 *     agendada — o indicador so apareceria depois de um F5.
 *  2. Impedir o reanexo de virar um SEGUNDO consumidor do mesmo turno. Reabrir a
 *     conversa que este cliente ja esta transmitindo somava o stream do envio com o
 *     stream de reanexo, e cada pedaco de texto aparecia DUAS vezes na tela.
 */
const enviosLocais = new Set();
function agendarRecargaHistorico(precisa) {
  if (!precisa) {
    if (relogioHistorico) { clearTimeout(relogioHistorico); relogioHistorico = null; }
    return;
  }
  if (relogioHistorico) return;
  relogioHistorico = setTimeout(() => { relogioHistorico = null; carregarHistorico(); }, 5000);
}

async function carregarHistorico() {
  const alvo = $('#historico');
  let lista = [];
  try { lista = (await window.jurApi.pedir('/api/v1/conversas')).conversas; } catch { /* segue vazio */ }
  agendarRecargaHistorico(enviosLocais.size > 0 || lista.some((c) => c.emAndamento));
  if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma conversa ainda.</p>'; return; }
  alvo.innerHTML = '<h2>Conversas</h2>';
  for (const c of lista) {
    const item = document.createElement('div');
    item.className = 'conversa-item';
    item.setAttribute('aria-current', String(c.id === conversaAtual));
    const titulo = document.createElement('span');
    titulo.textContent = c.titulo || 'Sem título';
    item.appendChild(titulo);
    if (c.emAndamento) {
      // O rotulo importa tanto quanto o desenho: um circulo girando nao diz nada a quem
      // usa leitor de tela, e e justamente quem nao ve a animacao que mais precisa saber
      // que a conversa nao morreu.
      const girando = document.createElement('span');
      girando.className = 'em-andamento';
      girando.setAttribute('role', 'img');
      girando.setAttribute('aria-label', 'respondendo agora');
      girando.title = 'Respondendo — continua mesmo se você fechar esta aba';
      item.appendChild(girando);
    }
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
  encerrarReanexo();
  conversaAtual = null;
  $('#conversa').hidden = true;
  $('#inicial').hidden = false;
  $('#mensagens').innerHTML = '';
  carregarHistorico();
}

async function abrirConversa(id) {
  encerrarReanexo();
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
  reanexar(id);
}

// ---------- reanexar a um turno em andamento ----------
// Uma unica reconexao viva por vez: trocar de conversa fecha a anterior.
let reanexado = null;

function encerrarReanexo() {
  if (reanexado) { reanexado.abort(); reanexado = null; }
}

/**
 * Reconecta ao turno que continua rodando no servidor. Sem isto, abrir uma conversa em
 * andamento mostrava so as mensagens ja gravadas e uma tela parada ate o fim — o
 * usuario nao tinha como saber se ainda vinha resposta.
 *
 * Se nao houver turno vivo, o servidor manda `encerrado` e fecha; nada acontece na tela.
 */
async function reanexar(id) {
  encerrarReanexo();
  // Ja ha um stream deste cliente para esta conversa (o do proprio envio). Abrir outro
  // duplicaria cada delta na tela: os dois consumidores renderizam o mesmo turno.
  if (enviosLocais.has(id)) return;
  const controle = new AbortController();
  reanexado = controle;
  let destino = null;
  try {
    const r = await fetch(`/api/v1/conversas/${id}/stream`, { signal: controle.signal });
    if (!r.ok) return;
    await lerSSE(r, (nome, dados) => {
      // Trocou de conversa no meio: o abort ja veio, mas um chunk em voo ainda pode
      // cair aqui. Nao pode escrever na conversa que estiver aberta AGORA.
      if (conversaAtual !== id) return;
      if (nome === 'texto') {
        if (!destino) destino = bolha('assistant', '');
        acrescentarAssistente(destino, dados.texto);
        $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
      } else if (nome === 'ferramenta') {
        bolha('ferramenta', `▸ ${dados.nome}(${JSON.stringify(dados.entrada)})`);
        destino = null;
      } else if (nome === 'fim') {
        // O historico local precisa receber o turno inteiro (com os blocos de
        // ferramenta): e ele que volta ao modelo na proxima pergunta, e sem os blocos
        // vao junto o job_id das buscas e a ressalva do zero.
        const novas = Array.isArray(dados.mensagens) && dados.mensagens.length
          ? dados.mensagens
          : [{ role: 'assistant', content: dados.texto }];
        for (const m of novas) historicoLocal.push({ role: m.role, content: m.content });
        carregarHistorico();
      } else if (nome === 'erro') {
        bolha('erro', dados.erro);
      }
    });
  } catch { /* abortado ou rede caiu: a conversa continua gravada no servidor */ }
  finally {
    if (reanexado === controle) reanexado = null;
  }
}

$('#nova-conversa').addEventListener('click', irParaInicial);

// ---------- mensagens ----------
/**
 * A bolha do ASSISTENTE guarda o texto cru em `data-bruto` e reparseia o markdown
 * inteiro a cada pedaco que chega. Renderizar so o delta nao funcionaria: no meio do
 * streaming o markdown esta sempre pela metade (`**` sem fechar, lista sem o proximo
 * item), e o significado de um pedaco depende do que veio antes. Reparsear alguns KB
 * alguns milhares de vezes e irrelevante nesta escala, e evita o texto pular de cru para
 * renderizado quando a resposta termina.
 */
function escreverAssistente(div, bruto) {
  div.dataset.bruto = bruto;
  window.jurMarkdown.renderizar(bruto, div);
}

function acrescentarAssistente(div, pedaco) {
  escreverAssistente(div, (div.dataset.bruto || '') + pedaco);
}

function bolha(classe, texto) {
  const div = document.createElement('div');
  div.className = `msg ${classe}`;
  // So o assistente. O que o USUARIO digitou vai como texto puro: renderizar markdown
  // ali seria reinterpretar a entrada dele — quem escreve `**` quer ver `**`. Erro
  // tambem e texto puro, pelo mesmo motivo.
  if (classe === 'assistant') escreverAssistente(div, texto);
  else div.textContent = texto;
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

  // Este envio JA e o stream do turno: um reanexo por cima duplicaria cada delta.
  encerrarReanexo();
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
  // Liga a sondagem da lateral ANTES do POST: a partir daqui existe um turno deste
  // cliente, e e isso que faz o indicador aparecer sem esperar um F5.
  enviosLocais.add(conversaDoEnvio);
  carregarHistorico();
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
        // Tribunais que o usuario deixou ligados na Disponibilidade. Vai sempre que o
        // painel ja carregou: e com isto que o servidor recorta o catalogo no prompt, e
        // e dai que vem a economia de chamada de listar_tribunais.
        tribunais: window.jurEscopo ? window.jurEscopo.ligados() : undefined,
      }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      if (conversaAtual === conversaDoEnvio) bolha('erro', corpo.erro);
      return;
    }
    // O stream abriu: o servidor ja registrou o turno. Recarrega agora para o indicador
    // aparecer de imediato, em vez de esperar a proxima sondagem.
    carregarHistorico();
    await lerSSE(r, (nome, dados) => {
      const aindaNaMesmaConversa = conversaAtual === conversaDoEnvio;
      if (nome === 'texto') {
        if (!aindaNaMesmaConversa) return;
        if (!destino) destino = bolha('assistant', '');
        acrescentarAssistente(destino, dados.texto);
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
    enviosLocais.delete(conversaDoEnvio);
    // Aqui o stream ja fechou, e o servidor so fecha depois de tirar o turno do registro
    // — entao esta leitura e a que apaga o indicador na hora certa, sem esperar a
    // proxima sondagem.
    carregarHistorico();
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
