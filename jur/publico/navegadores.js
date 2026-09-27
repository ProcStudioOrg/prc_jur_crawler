(function () {
  const painel = document.querySelector('#navegadores');
  const el = (nome) => painel.querySelector('#navegadores-' + nome);
  const requisicoes = new Set();
  let autenticado = false;
  let geracao = 0;
  let dados = null;
  let selecionada = '';
  let preferencias = { acompanhar: false, captcha: false, provedor: 'local' };
  let revisaoPreferencias = 0;
  let salvandoPreferencias = false;
  let pedidoEstado = null;
  let pedidoTela = null;
  let pedidoAcao = null;
  let timerEstado;
  let timerTela;
  let versaoTela = 0;
  let sessaoDaTela = '';

  const aberta = () => !el('corpo').hidden;
  const atual = () => dados?.sessoes.find((s) => s.id === selecionada);
  const podeVer = () => autenticado && aberta() && !document.hidden
    && atual()?.acompanhar && ['rodando', 'aguardando_usuario'].includes(atual()?.status);
  const podeControlar = () => podeVer() && atual()?.status === 'aguardando_usuario';

  function texto(no, valor) {
    if (no.textContent !== valor) no.textContent = valor;
  }
  function aviso(nome, mensagem = '') {
    texto(el(nome), mensagem);
    el(nome).hidden = !mensagem;
  }
  function pedir(caminho, opcoes = {}) {
    const controller = new AbortController();
    requisicoes.add(controller);
    const promise = window.jurApi.pedir(caminho, { ...opcoes, signal: controller.signal })
      .finally(() => requisicoes.delete(controller));
    return { controller, promise };
  }
  function limparTela() {
    versaoTela++;
    clearTimeout(timerTela);
    timerTela = null;
    pedidoTela?.controller.abort();
    pedidoTela = null;
    sessaoDaTela = '';
    el('imagem').hidden = true;
    el('imagem').removeAttribute('src');
    el('imagem').removeAttribute('width');
    el('imagem').removeAttribute('height');
    el('tela').disabled = true;
    aviso('tela-espera', 'Carregando tela…');
  }
  function opcoes(select, itens) {
    const assinatura = JSON.stringify(itens);
    if (select.dataset.opcoes === assinatura) return;
    select.replaceChildren(...itens.map(([valor, rotulo, desabilitado]) => {
      const opcao = new Option(rotulo, valor);
      opcao.disabled = !!desabilitado;
      return opcao;
    }));
    select.dataset.opcoes = assinatura;
  }
  function estadoSessao(s) {
    if (s.status === 'enfileirado') return s.posicao ? `Na fila · posição ${s.posicao}` : 'Na fila';
    if (s.status === 'aguardando_usuario') return 'Aguardando sua intervenção';
    return 'Pesquisando';
  }
  function renderPreferencias() {
    el('acompanhar').checked = preferencias.acompanhar;
    el('captcha').checked = preferencias.captcha;
    const provedores = dados?.provedores || ['local'];
    const disponivel = provedores.includes(preferencias.provedor);
    const lista = provedores.map((p) => [p, p === 'local' ? 'Servidor ProcStudio' : 'Browserbase']);
    if (!disponivel) lista.push([preferencias.provedor, 'Browserbase (indisponível)', true]);
    opcoes(el('provedor'), lista);
    el('provedor').value = preferencias.provedor;
    el('provedor-campo').hidden = provedores.length < 2 && disponivel;
    for (const nome of ['acompanhar', 'captcha', 'provedor']) el(nome).disabled = !dados || salvandoPreferencias;
  }
  function renderControles() {
    el('controles').hidden = !podeControlar();
    el('tela').disabled = !podeControlar() || !!pedidoAcao || el('imagem').hidden;
    el('cancelar').disabled = !!pedidoAcao?.cancelar;
    for (const campo of el('controles').querySelectorAll('input, select, button')) {
      campo.disabled = !podeControlar() || !!pedidoAcao;
    }
  }
  function render() {
    renderPreferencias();
    if (!dados) return;
    const { total, ocupados, disponiveis, sessoes, naFila } = dados;
    texto(el('capacidade'), disponiveis > 0
      ? `${disponiveis} de ${total} navegadores disponíveis`
      : `${ocupados} de ${total} navegadores ocupados`);
    const espera = sessoes.filter((s) => s.status === 'enfileirado' && s.posicao)
      .sort((a, b) => a.posicao - b.posicao)[0];
    const pausada = sessoes.some((s) => s.status === 'aguardando_usuario');
    texto(el('fila'), pausada ? 'Intervenção pendente'
      : espera ? `Sua posição na fila: ${espera.posicao}` : naFila ? `${naFila} na fila` : '');
    el('fila').dataset.pausa = String(pausada);
    if (!atual()) selecionada = sessoes.find((s) => s.status === 'aguardando_usuario')?.id || sessoes[0]?.id || '';
    opcoes(el('sessao'), sessoes.map((s) => [s.id, `${s.comando.toUpperCase()} · ${estadoSessao(s)} · ${s.id.slice(0, 6)}`]));
    el('sessao').value = selecionada;
    el('sessoes').hidden = !sessoes.length;
    el('vazio').hidden = !!sessoes.length;
    const s = atual();
    let mensagem = '';
    if (s?.status === 'enfileirado') mensagem = `${estadoSessao(s)}. A pesquisa começa quando um navegador ficar disponível.`;
    else if (s?.status === 'aguardando_usuario') mensagem = s.mensagem || 'O tribunal solicitou uma verificação. A pesquisa aguarda sua intervenção por até 2 minutos.';
    else if (s) mensagem = s.acompanhar ? 'Pesquisa em andamento. Você pode acompanhar a tela abaixo.' : 'Pesquisa em andamento. O acompanhamento estava desativado ao iniciar.';
    texto(el('estado'), mensagem);
    el('visualizacao').hidden = !s?.acompanhar || !['rodando', 'aguardando_usuario'].includes(s?.status);
    if (!podeVer() || (sessaoDaTela && sessaoDaTela !== selecionada)) limparTela();
    renderControles();
    if (podeVer() && !pedidoTela && !timerTela) atualizarTela();
  }

  async function atualizarEstado() {
    clearTimeout(timerEstado);
    if (!autenticado || document.hidden || pedidoEstado) return;
    const ciclo = geracao;
    const revisao = revisaoPreferencias;
    const pedido = pedir('/api/v1/navegadores');
    pedidoEstado = pedido;
    try {
      const resposta = await pedido.promise;
      if (!autenticado || ciclo !== geracao) return;
      dados = resposta;
      if (!salvandoPreferencias && revisao === revisaoPreferencias) preferencias = resposta.preferencias;
      aviso('conexao-erro');
      render();
    } catch (erro) {
      if (ciclo !== geracao || erro.name === 'AbortError') return;
      texto(el('capacidade'), 'Disponibilidade indisponível no momento');
      aviso('conexao-erro', 'Não foi possível atualizar os navegadores. Tentaremos novamente em instantes.');
    } finally {
      if (pedidoEstado === pedido) {
        pedidoEstado = null;
        if (autenticado && !document.hidden) timerEstado = setTimeout(atualizarEstado, 3000);
      }
    }
  }
  async function atualizarTela() {
    clearTimeout(timerTela);
    timerTela = null;
    if (!podeVer() || pedidoTela || pedidoAcao) return;
    const ciclo = geracao;
    const versao = versaoTela;
    const id = selecionada;
    const pedido = pedir(`/api/v1/navegadores/${encodeURIComponent(id)}/tela`);
    pedidoTela = pedido;
    try {
      const tela = await pedido.promise;
      if (ciclo !== geracao || versao !== versaoTela || id !== selecionada || !podeVer()) return;
      sessaoDaTela = id;
      el('imagem').width = tela.largura;
      el('imagem').height = tela.altura;
      el('imagem').src = 'data:image/jpeg;base64,' + tela.imagem;
      el('imagem').hidden = false;
      aviso('tela-espera');
      renderControles();
    } catch (erro) {
      if (ciclo !== geracao || versao !== versaoTela || erro.name === 'AbortError') return;
      el('imagem').hidden = true;
      el('imagem').removeAttribute('src');
      aviso('tela-espera', erro.status === 409
        ? 'A tela ainda não está disponível. Aguardando o navegador…'
        : 'Não foi possível carregar a tela. Tentaremos novamente em instantes.');
      renderControles();
    } finally {
      if (pedidoTela === pedido) {
        pedidoTela = null;
        if (podeVer() && !pedidoAcao) timerTela = setTimeout(atualizarTela, 1500);
      }
    }
  }
  async function salvarPreferencias(evento) {
    if (!autenticado || !dados || salvandoPreferencias) return;
    const anteriores = preferencias;
    const novas = { acompanhar: el('acompanhar').checked, captcha: el('captcha').checked, provedor: el('provedor').value };
    if (evento.target === el('acompanhar') && !novas.acompanhar) novas.captcha = false;
    if (novas.captcha) novas.acompanhar = true;
    preferencias = novas;
    salvandoPreferencias = true;
    revisaoPreferencias++;
    const ciclo = geracao;
    renderPreferencias();
    aviso('preferencias-erro');
    try {
      const resposta = await pedir('/api/v1/navegadores/preferencias', { method: 'POST', body: JSON.stringify(novas) }).promise;
      if (ciclo !== geracao) return;
      preferencias = resposta;
      document.dispatchEvent(new Event('jur:navegadores-preferencias'));
    } catch (erro) {
      if (ciclo !== geracao || erro.name === 'AbortError') return;
      preferencias = anteriores;
      aviso('preferencias-erro', erro.message || 'Não foi possível salvar as opções.');
    } finally {
      if (ciclo === geracao) {
        salvandoPreferencias = false;
        revisaoPreferencias++;
        renderPreferencias();
      }
    }
  }
  async function enviarAcao(acao, cancelar = false) {
    if (!autenticado || !atual() || pedidoAcao?.cancelar || (!cancelar && (pedidoAcao || !podeControlar()))) return false;
    const ciclo = geracao;
    const id = selecionada;
    const operacao = { cancelar };
    pedidoAcao = operacao;
    aviso('acao-erro');
    renderControles();
    try {
      // A sessão aceita um pedido por vez. Abortar o fetch não interrompe a
      // captura no servidor: aguardamos sua resposta antes de enviar o comando.
      if (!cancelar) {
        await pedidoTela?.promise.catch(() => {});
        if (ciclo !== geracao || selecionada !== id || pedidoAcao !== operacao || !podeControlar()) return false;
      }
      const pedido = cancelar
        ? pedir(`/api/v1/buscas/${encodeURIComponent(id)}`, { method: 'DELETE' })
        : pedir(`/api/v1/navegadores/${encodeURIComponent(id)}/acao`, { method: 'POST', body: JSON.stringify(acao) });
      await pedido.promise;
      if (ciclo !== geracao || selecionada !== id || pedidoAcao !== operacao) return false;
      if (cancelar) {
        dados.sessoes = dados.sessoes.filter((s) => s.id !== id);
        limparTela();
        render();
      }
      atualizarEstado();
      return true;
    } catch (erro) {
      if (ciclo === geracao && selecionada === id && pedidoAcao === operacao && erro.name !== 'AbortError') aviso('acao-erro', erro.message);
      return false;
    } finally {
      if (pedidoAcao === operacao) {
        pedidoAcao = null;
        renderControles();
        atualizarTela();
      }
    }
  }

  el('abrir').addEventListener('click', () => {
    el('corpo').hidden = aberta();
    el('abrir').setAttribute('aria-expanded', String(aberta()));
    if (!aberta()) limparTela();
    render();
    if (aberta()) atualizarEstado();
  });
  for (const nome of ['acompanhar', 'captcha', 'provedor']) el(nome).addEventListener('change', salvarPreferencias);
  el('sessao').addEventListener('change', () => {
    selecionada = el('sessao').value;
    limparTela();
    el('texto').value = '';
    aviso('acao-erro');
    render();
  });
  el('cancelar').addEventListener('click', () => enviarAcao(null, true));
  el('tela').addEventListener('click', (evento) => {
    if (!podeControlar() || el('imagem').hidden || evento.detail === 0) return;
    const caixa = el('imagem').getBoundingClientRect();
    enviarAcao({ tipo: 'clicar', x: Math.max(0, Math.min(1, (evento.clientX - caixa.left) / caixa.width)), y: Math.max(0, Math.min(1, (evento.clientY - caixa.top) / caixa.height)) });
  });
  el('texto-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const textoEnviado = el('texto').value;
    if (textoEnviado && await enviarAcao({ tipo: 'texto', texto: textoEnviado })) el('texto').value = '';
  });
  el('enviar-tecla').addEventListener('click', () => enviarAcao({ tipo: 'tecla', tecla: el('tecla').value }));
  el('rolar-cima').addEventListener('click', () => enviarAcao({ tipo: 'rolar', deltaY: -400 }));
  el('rolar-baixo').addEventListener('click', () => enviarAcao({ tipo: 'rolar', deltaY: 400 }));
  el('continuar').addEventListener('click', () => enviarAcao({ tipo: 'continuar' }));

  function encerrar() {
    autenticado = false;
    geracao++;
    clearTimeout(timerEstado);
    limparTela();
    for (const controller of requisicoes) controller.abort();
    requisicoes.clear();
    pedidoEstado = pedidoAcao = null;
    dados = null;
    selecionada = '';
    salvandoPreferencias = false;
    preferencias = { acompanhar: false, captcha: false, provedor: 'local' };
    painel.hidden = true;
    el('corpo').hidden = true;
    el('abrir').setAttribute('aria-expanded', 'false');
    el('sessao').replaceChildren();
    delete el('sessao').dataset.opcoes;
    el('texto').value = '';
    texto(el('capacidade'), 'Consultando disponibilidade…');
    texto(el('fila'), '');
    texto(el('estado'), '');
    el('sessoes').hidden = true;
    el('controles').hidden = true;
    el('visualizacao').hidden = true;
    el('vazio').hidden = false;
    for (const nome of ['preferencias-erro', 'conexao-erro', 'acao-erro']) aviso(nome);
    renderPreferencias();
  }
  document.addEventListener('jur:sair', encerrar);
  document.addEventListener('jur:sessao', () => {
    encerrar();
    autenticado = true;
    painel.hidden = false;
    atualizarEstado();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timerEstado);
      limparTela();
    } else if (autenticado) {
      atualizarEstado();
      atualizarTela();
    }
  });
})();
