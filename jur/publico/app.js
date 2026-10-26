// jur/publico/app.js
const $ = (s, raiz = document) => raiz.querySelector(s);
const CHAVE_TEMA = 'jur.tema';

const guardado = {
  ler(k, padrao = '') { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } },
  escrever(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

// ---------- API ----------
window.jurApi = {
  async requisitar(caminho, opcoes = {}) {
    const headers = new Headers(opcoes.headers || {});
    if (opcoes.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

    const resposta = await fetch(caminho, { ...opcoes, headers });
    if (resposta.status === 401
        && resposta.headers.get('www-authenticate')?.startsWith('Session')) {
      document.dispatchEvent(new CustomEvent('jur:autenticacao-negada'));
    }
    return resposta;
  },
  async pedir(caminho, opcoes = {}) {
    const r = await window.jurApi.requisitar(caminho, opcoes);
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      const erro = new Error(corpo.erro || `HTTP ${r.status}`);
      erro.status = r.status;
      throw erro;
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
  window.jurSeletor.montar($('.seletor-modelo', destino));
  window.jurEscopo.montarBarra($('.barra-escopo', destino));
  campo.addEventListener('input', () => ajustarAltura(campo));
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(campo, window.jurConexoes.selected?.modelo, null); });
  return destino;
}

function ajustarAltura(campo) {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 200)}px`;
}

const caixaAtiva = () => ($('#conversa').hidden ? $('#caixa-inicial') : $('#caixa-conversa'));

// ---------- histórico ----------
let conversaAtual = null;
// O botão Relatar (relatar.js, módulo) manda o id da conversa na tela; o servidor confere a dona.
window.jurConversa = { get id() { return conversaAtual; } };
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

// BRU-76: conversa que nasceu neste envio e cujo primeiro turno o servidor recusou.
// Apaga no servidor, volta para a tela inicial com o texto preservado e mostra o
// erro na propria caixa — sem bolha numa conversa que deixou de existir.
async function descartarConversaVazia(id, texto, corpo) {
  try {
    await window.jurApi.pedir(`/api/v1/conversas/${id}`, { method: 'DELETE' });
  } catch { /* se o servidor nao apagou, a conversa aparece no historico — pior caso e o antigo */ }
  historicoLocal.length = 0;
  if (conversaAtual === id) {
    irParaInicial();
    const campo = $('#caixa-inicial .entrada');
    if (campo) { campo.value = texto; ajustarAltura(campo); campo.focus(); }
    mostrarErro({ ...corpo, erro: corpo.erro || 'Não foi possível iniciar a conversa.' }, texto);
  }
}

function irParaInicial() {
  encerrarReanexo();
  // As buscas da conversa anterior nao podem continuar na tela como se fossem desta.
  if (window.jurDecisoes) window.jurDecisoes.sincronizar(null);
  conversaAtual = null;
  definirCustoConversa(null, null);
  $('#conversa').hidden = true;
  $('#inicial').hidden = false;
  $('#mensagens').innerHTML = '';
  carregarHistorico();
}

async function abrirConversa(id) {
  encerrarReanexo();
  const dados = await window.jurApi.pedir(`/api/v1/conversas/${id}`);
  conversaAtual = id;
  definirCustoConversa(id, dados.custoTotalBrl);
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
  if (window.jurDecisoes) window.jurDecisoes.sincronizar(id);
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
  const linhaCusto = acompanharCusto(id, false);
  try {
    const r = await window.jurApi.requisitar(`/api/v1/conversas/${id}/stream`, { signal: controle.signal });
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
      } else if (nome === 'progresso') {
        bolha('ferramenta', `↳ ${dados.texto}`);
        destino = null;
      } else if (nome === 'busca') {
        if (window.jurDecisoes) window.jurDecisoes.sincronizar(id);
      } else if (nome === 'custo') {
        // O total da conversa nao soma aqui: o reanexo reproduz rodadas que o GET da
        // conversa ja contou. Ele e relido do servidor no `fim`.
        linhaCusto(dados);
      } else if (nome === 'fim') {
        recarregarCustoConversa(id);
        // O historico local precisa receber o turno inteiro (com os blocos de
        // ferramenta): e ele que volta ao modelo na proxima pergunta, e sem os blocos
        // vao junto o job_id das buscas e a ressalva do zero.
        const novas = Array.isArray(dados.mensagens) && dados.mensagens.length
          ? dados.mensagens
          : [{ role: 'assistant', content: dados.texto }];
        for (const m of novas) historicoLocal.push({ role: m.role, content: m.content });
        carregarHistorico();
      } else if (nome === 'erro') {
        // O turno foi aberto em outra aba ou antes de recarregar: a pergunta a reenviar e a
        // ultima do historico, se ela for texto do usuario.
        // So oferece o reenvio se a ultima bolha na tela for essa pergunta: sem ela nao ha o
        // que reaproveitar, e redesenhar duplicaria a pergunta.
        const ultima = historicoLocal[historicoLocal.length - 1];
        const perguntas = $('#mensagens').querySelectorAll('.msg.user');
        const bolhaUltima = perguntas[perguntas.length - 1];
        const texto = ultima?.role === 'user' && typeof ultima.content === 'string'
          && bolhaUltima?.textContent === ultima.content ? ultima.content : null;
        mostrarErro(dados, texto, texto ? bolhaUltima : null);
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

/**
 * Erro antes de existir conversa: a bolha iria para #mensagens, que fica oculto na tela
 * inicial, e o usuario nao veria nada. Na conversa aberta e uma bolha comum.
 */
function avisarNaCaixa(texto, classe = 'erro') {
  if (!$('#conversa').hidden) return bolha(classe, texto);
  const caixa = caixaAtiva();
  $('.aviso-caixa', caixa)?.remove();
  const div = document.createElement('div');
  div.className = `msg ${classe} aviso-caixa`;
  div.setAttribute('role', 'alert');
  div.textContent = texto;
  caixa.prepend(div);
  return div;
}

// ---------- erros com tipo, bloqueio por saldo e custo ----------
const centavos = (brl) => Math.round(brl * 100);

/**
 * Erro do chat com o `tipo` que o servidor manda (no JSON da recusa ou no evento `erro`).
 * `texto` e a pergunta recusada: e ela que "Tentar de novo" reenvia.
 */
function mostrarErro(dados, texto, bolhaGravada = null) {
  if (dados.tipo === 'saldo_insuficiente') { cartaoBloqueio(dados, texto, bolhaGravada); return; }
  const div = avisarNaCaixa(dados.erro);
  if (dados.tipo === 'procstudio_indisponivel') {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-erro';
    link.textContent = 'Configurar uma conexão própria';
    link.addEventListener('click', () => window.jurConfig.abrir({ avancado: true }));
    div.append(' ', link);
  }
}

/**
 * Cartao de saldo esgotado, igual no 402 antes do turno e no `erro` no meio dele. O link de
 * recarga e o `topupUrl` do servidor; sem ele o botao nao aparece (nao inventamos endereco).
 */
function cartaoBloqueio(dados, texto, bolhaGravada) {
  $('#mensagens .bloqueio')?.remove();
  const cartao = avisarNaCaixa('', 'bloqueio bolha');
  cartao.setAttribute('role', 'alert');
  const mensagem = document.createElement('p');
  mensagem.textContent = dados.erro;
  const acoes = document.createElement('div');
  acoes.className = 'bloqueio-acoes';
  if (dados.topupUrl) {
    const recarga = document.createElement('a');
    recarga.className = 'botao-acento';
    recarga.textContent = 'Adicionar créditos';
    recarga.href = dados.topupUrl;
    recarga.target = '_blank';
    recarga.rel = 'noopener';
    acoes.append(recarga);
  }
  const estado = document.createElement('p');
  estado.className = 'bloqueio-estado';
  estado.setAttribute('role', 'status');
  if (texto) {
    const tentar = document.createElement('button');
    tentar.type = 'button';
    tentar.className = 'botao-secundario';
    tentar.textContent = 'Tentar de novo';
    tentar.addEventListener('click', async () => {
      tentar.disabled = true;
      estado.textContent = '';
      const s = await window.jurSaldo.carregar(true);
      if (!s?.disponivel || s.erro || !s.podeOperar) {
        estado.textContent = s?.erro || s?.mensagem || 'O saldo ainda não permite continuar.';
        tentar.disabled = false;
        return;
      }
      cartao.remove();
      const campo = $('.entrada', caixaAtiva());
      if (bolhaGravada) {
        // Bloqueio no meio do turno: a pergunta ja esta gravada e na tela.
        enviar(campo, window.jurConexoes.selected?.modelo, null, { texto, bolha: bolhaGravada });
        return;
      }
      campo.value = texto;
      enviar(campo, window.jurConexoes.selected?.modelo, null);
    });
    acoes.append(tentar);
  }
  cartao.append(mensagem, acoes, estado);
  window.jurSaldo.carregar(true);
}

/**
 * 409 `reenvio_invalido`: depois da pergunta o servidor ja gravou rodadas cobradas do turno
 * interrompido (tool_use/tool_result), entao ela nao e mais a ultima mensagem. O historico
 * local nao tem essas rodadas: e refeito a partir da conversa gravada (que tambem as mostra
 * na tela), a pergunta volta para a caixa e a mensagem do servidor fica visivel.
 */
async function realinharAposReenvioInvalido(id, texto, corpo) {
  if (conversaAtual !== id) return;
  try {
    await abrirConversa(id);
  } catch {
    // Sem a conversa gravada nao ha como alinhar: ao menos tira a pergunta velha do fim do
    // historico, para o proximo envio nao leva-la duas vezes.
    const ultima = historicoLocal[historicoLocal.length - 1];
    if (ultima?.role === 'user' && ultima.content === texto) historicoLocal.pop();
  }
  if (conversaAtual !== id) return;
  mostrarErro(corpo, texto);
  const campo = $('.entrada', caixaAtiva());
  campo.value = texto;
  ajustarAltura(campo);
  campo.focus();
}

/** "850 tokens", "19,1 mil tokens", "1,2 mi tokens". */
function formatarTokens(n) {
  const umaCasa = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (n < 1000) return `${n} tokens`;
  if (n < 1e6) return `${umaCasa(n / 1000)} mil tokens`;
  return `${umaCasa(n / 1e6)} mi tokens`;
}

/** Total da conversa aberta: o que o servidor ja somou mais os turnos desta sessao. */
const custoConversa = { id: null, centavos: 0, cobrado: false };
function definirCustoConversa(id, totalBrl) {
  custoConversa.id = id;
  custoConversa.cobrado = typeof totalBrl === 'number';
  custoConversa.centavos = custoConversa.cobrado ? centavos(totalBrl) : 0;
  desenharCustoConversa();
}
function desenharCustoConversa() {
  const alvo = $('#custo-conversa');
  const visivel = custoConversa.cobrado && custoConversa.id === conversaAtual;
  alvo.hidden = !visivel;
  alvo.textContent = visivel ? `Esta conversa: ${window.jurSaldo.formatarBrl(custoConversa.centavos / 100)}` : '';
}
async function recarregarCustoConversa(id) {
  try {
    const dados = await window.jurApi.pedir(`/api/v1/conversas/${id}`);
    if (conversaAtual === id) definirCustoConversa(id, dados.custoTotalBrl);
  } catch { /* o total fica como estava; a proxima abertura relê */ }
}

/**
 * Linha de custo da resposta em curso: soma as rodadas do turno a cada evento `custo` e fica
 * sob a ultima bolha do assistente. Em BYOK nao ha `cobradoBrl`, so tokens. `somarNaConversa`
 * e falso no reanexo, que reproduz rodadas ja contadas pelo GET da conversa.
 */
function acompanharCusto(conversaId, somarNaConversa) {
  let linha = null;
  let cobradoCents = 0;
  let cobrado = false;
  let tokens = 0;
  return (dados) => {
    window.jurSaldo.atualizarDe(dados);
    const rodadaCents = typeof dados.cobradoBrl === 'number' ? centavos(dados.cobradoBrl) : null;
    if (rodadaCents !== null) { cobrado = true; cobradoCents += rodadaCents; }
    tokens += (dados.tokensEntrada || 0) + (dados.tokensSaida || 0);
    if (somarNaConversa && rodadaCents !== null && custoConversa.id === conversaId) {
      custoConversa.cobrado = true;
      custoConversa.centavos += rodadaCents;
    }
    if (conversaAtual !== conversaId) return;
    desenharCustoConversa();
    if (!linha) {
      linha = document.createElement('small');
      linha.className = 'custo-resposta';
    }
    linha.textContent = [
      cobrado ? window.jurSaldo.formatarBrl(cobradoCents / 100) : null,
      formatarTokens(tokens),
      dados.modelo,
    ].filter(Boolean).join(' · ');
    // Sempre depois do que ja chegou: a rodada seguinte pode ter aberto bolhas novas.
    $('#mensagens').appendChild(linha);
    $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  };
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

/**
 * `reenvio` ({ texto, bolha }): "Tentar de novo" depois de um bloqueio no MEIO do turno. A
 * pergunta ja esta gravada na conversa, na tela (`bolha`) e no fim do historico local; o POST
 * vai com `reenvio: true` e o servidor responde a ela sem grava-la de novo.
 */
async function enviar(campo, modelo, esforco, reenvio = null) {
  if (!window.jurSessao?.principal) { location.assign('/auth/login'); return; }
  if (!window.jurConexoes.selected) {
    $('#abrir-config').click();
    return;
  }
  const texto = reenvio ? reenvio.texto : campo.value.trim();
  if (!texto) return;

  // Sem catalogo nao ha escopo: `escopo()` devolveria [] e o servidor leria "nenhum
  // tribunal ligado" — ou pior, um cliente mais tolerante cairia no "sem escopo". Nao
  // envia, avisa e pede o catalogo de novo; o texto digitado fica na caixa.
  if (!window.jurEscopo.tribunais().length) {
    avisarNaCaixa('A lista de tribunais ainda não carregou; tente de novo em instantes.');
    window.jurEscopo.recarregar();
    return;
  }
  $('.aviso-caixa', caixaAtiva())?.remove();

  // Trava sincrona, ANTES de qualquer await: dois Enter (ou dois cliques) quase
  // simultaneos na mesma caixa chamam `enviar` duas vezes antes do primeiro `await`
  // devolver. Sem desabilitar AQUI — e nao so depois de criar a conversa, como antes —
  // o segundo passa pelo `if (!conversaAtual)` antes do primeiro POST
  // /api/v1/conversas responder, e cria duas conversas para o mesmo envio.
  const botaoNoInicio = $('.enviar', caixaAtiva());
  if (botaoNoInicio.disabled) return;
  botaoNoInicio.disabled = true;

  // BRU-76: a conversa e criada ANTES de o servidor aceitar o turno. Se o POST /chat
  // falhar (sem conexao de IA, chave invalida, validacao), sobrava uma conversa "Sem
  // titulo" vazia no historico a cada tentativa. Marcamos que ELA nasceu neste envio
  // para, nesse caso, apaga-la e devolver o texto a caixa inicial.
  let conversaCriadaAgora = false;
  if (!conversaAtual) {
    let c;
    try {
      c = await window.jurApi.pedir('/api/v1/conversas', { method: 'POST', body: '{}' });
    } catch (e) {
      botaoNoInicio.disabled = false;
      bolha('erro', e.message);
      return;
    }
    conversaCriadaAgora = true;
    conversaAtual = c.id;
    definirCustoConversa(c.id, null);
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
  let bolhaPergunta;
  if (reenvio) {
    // Reaproveita a bolha e a entrada do historico que ja existem: desenhar de novo
    // mostraria a mesma pergunta duas vezes.
    bolhaPergunta = reenvio.bolha;
  } else {
    campo.value = ''; ajustarAltura(campo);
    bolhaPergunta = bolha('user', texto);
    historicoLocal.push({ role: 'user', content: texto });
  }

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
  const linhaCusto = acompanharCusto(conversaDoEnvio, true);
  // Liga a sondagem da lateral ANTES do POST: a partir daqui existe um turno deste
  // cliente, e e isso que faz o indicador aparecer sem esperar um F5.
  enviosLocais.add(conversaDoEnvio);
  carregarHistorico();
  const controle = new AbortController();
  let relogio = setTimeout(() => controle.abort(), 30000);
  const renovar = () => { clearTimeout(relogio); relogio = setTimeout(() => controle.abort(), 30000); };

  try {
    const cab = { 'content-type': 'application/json' };


    const r = await window.jurApi.requisitar('/api/v1/chat', {
      method: 'POST', headers: cab, signal: controle.signal,
      body: JSON.stringify({
        mensagens: historicoLocal, modelo, conexaoId: window.jurConexoes.selected?.conexaoId, conversaId: conversaAtual,
        ...(reenvio ? { reenvio: true } : {}),
        // Tribunais que o usuario deixou ligados na Disponibilidade. Vai sempre que o
        // painel ja carregou: e com isto que o servidor recorta o catalogo no prompt, e
        // e dai que vem a economia de chamada de listar_tribunais.
        // Sempre uma lista: a selecao, ou todos os disponiveis. `undefined` faria o
        // servidor cair no modo "sem escopo", que e justamente o que a tela nao promete.
        tribunais: window.jurEscopo.escopo(),
      }),
    });
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      if (conversaCriadaAgora) {
        await descartarConversaVazia(conversaDoEnvio, texto, corpo);
        return;
      }
      if (conversaAtual === conversaDoEnvio) {
        if (reenvio && corpo.tipo === 'reenvio_invalido') {
          await realinharAposReenvioInvalido(conversaDoEnvio, texto, corpo);
        } else if (reenvio) {
          // A pergunta continua gravada: um novo bloqueio oferece reenvia-la de novo.
          mostrarErro(corpo, texto, bolhaPergunta);
        } else {
          if (corpo.tipo === 'saldo_insuficiente') {
            // Recusado antes do turno: o servidor nao gravou a pergunta. Sai da tela e do
            // historico local, e "Tentar de novo" a envia como nova.
            bolhaPergunta.remove();
            if (historicoLocal[historicoLocal.length - 1]?.content === texto) historicoLocal.pop();
          }
          mostrarErro(corpo, texto);
        }
      }
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
      } else if (nome === 'progresso') {
        if (!aindaNaMesmaConversa) return;
        bolha('ferramenta', `↳ ${dados.texto}`);
        destino = null;
      } else if (nome === 'busca') {
        // Uma busca acabou de ser vinculada a conversa: o painel de decisoes ja pode
        // mostra-la, mesmo antes de o turno terminar.
        if (aindaNaMesmaConversa && window.jurDecisoes) window.jurDecisoes.sincronizar(conversaDoEnvio);
      } else if (nome === 'custo') {
        linhaCusto(dados);
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
        // No meio do turno a pergunta ja foi gravada: o reenvio reaproveita a bolha dela.
        if (aindaNaMesmaConversa) mostrarErro(dados, texto, bolhaPergunta);
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
// escopo.js carrega depois deste arquivo e define window.jurEscopo; a caixa inicial so
// pode ser montada quando ele existir.
document.addEventListener('DOMContentLoaded', () => montarCaixa($('#caixa-inicial')));
document.addEventListener('jur:sessao', carregarHistorico);
document.addEventListener('jur:sair', () => {
  encerrarReanexo(); clearTimeout(relogioHistorico); conversaAtual = null; historicoLocal.length = 0;
  definirCustoConversa(null, null);
  $('#historico').replaceChildren(); $('#mensagens').replaceChildren();
  $('#conversa').hidden = true; $('#inicial').hidden = false;
  $('#painel-config').hidden = true; if (window.jurDecisoes) window.jurDecisoes.fechar?.();
});
