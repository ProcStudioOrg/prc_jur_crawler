(function () {
  const section = document.createElement('section');
  section.id = 'local-validacao';
  section.hidden = true;
  section.setAttribute('aria-label', 'Validação local');
  section.innerHTML = `
    <div class="local-titulo"><h2>Ambiente local</h2><span>Sem login ProcStudio</span></div>
    <p>Faça uma pesquisa real sem IA. Para ver a tela ou intervir em CAPTCHA, ative as opções em <b>Navegadores</b> antes de pesquisar.</p>
    <form id="local-form">
      <label>Tribunal<select id="local-tribunal"><option value="tjsp">TJSP</option><option value="stj">STJ · tentativa assistida</option><option value="tcu">TCU</option></select></label>
      <label class="local-consulta">Consulta direta<input id="local-query" required maxlength="500" value="dano moral"></label>
      <button id="local-buscar" class="botao-acento" type="submit">Iniciar pesquisa real</button>
    </form>
    <p class="local-ajuda">Uma página por pesquisa. Abra mais de uma pesquisa para acompanhar a fila. Para usar o chat, configure sua chave em Configurações → IA.</p>
    <p id="local-feedback" role="status"></p>
    <ul id="local-resultados" aria-label="Pesquisas locais"></ul>`;
  document.querySelector('#centro').prepend(section);
  let timer;
  let generation = 0;
  let updating = false;
  let previous = '';
  const $ = selector => section.querySelector(selector);
  const states = { enfileirado: 'Na fila', rodando: 'Em execução', concluido: 'Concluída', erro: 'Erro', cancelado: 'Cancelada' };
  async function atualizar() {
    if (!window.jurSessao?.principal || document.hidden || updating) return;
    const current = generation;
    updating = true;
    try {
      const data = await window.jurApi.pedir('/api/v1/buscas?limite=8');
      if (current !== generation || !window.jurSessao?.principal) return;
      const serialized = JSON.stringify(data.buscas);
      if (previous === serialized) return;
      previous = serialized;
      const list = $('#local-resultados'); list.replaceChildren();
      for (const job of data.buscas) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = `${job.comando.toUpperCase()} · ${job.params.query}`;
        const state = document.createElement('span'); state.textContent = states[job.status] || job.status;
        const details = document.createElement('p');
        details.textContent = job.erro || (job.status === 'concluido' ? `${job.total} resultados. ${(job.avisos || []).join(' ')}` : '');
        item.append(title, state, details);
        if (['enfileirado', 'rodando'].includes(job.status)) {
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'botao-secundario'; cancel.textContent = 'Cancelar';
          cancel.addEventListener('click', async () => {
            cancel.disabled = true;
            try { await window.jurApi.pedir(`/api/v1/buscas/${encodeURIComponent(job.id)}`, { method: 'DELETE' }); await atualizar(); }
            catch (e) { $('#local-feedback').textContent = e.message; cancel.disabled = false; }
          });
          item.append(cancel);
        } else {
          const link = document.createElement('a'); link.href = `/api/v1/buscas/${encodeURIComponent(job.id)}/resultados`;
          link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Abrir resultados JSON'; item.append(link);
        }
        list.append(item);
      }
    } catch (e) { if (current === generation) $('#local-feedback').textContent = e.message; }
    finally { updating = false; }
  }
  $('#local-form').addEventListener('submit', async e => {
    e.preventDefault();
    const current = generation;
    $('#local-buscar').disabled = true;
    $('#local-feedback').textContent = 'Enviando pesquisa…';
    try {
      const query = $('#local-query').value.trim();
      if (!query) throw new Error('Digite uma consulta.');
      await window.jurApi.pedir('/api/v1/buscas', { method: 'POST', body: JSON.stringify({ tribunal: $('#local-tribunal').value, query, maxPaginas: 1 }) });
      if (current !== generation) return;
      $('#local-feedback').textContent = 'Pesquisa adicionada. Acompanhe a execução no painel Navegadores.';
      const open = document.querySelector('#navegadores-abrir');
      if (open.getAttribute('aria-expanded') === 'false') open.click();
      await atualizar();
    } catch (error) { if (current === generation) $('#local-feedback').textContent = error.message; }
    finally { $('#local-buscar').disabled = false; }
  });
  function entrar() {
    section.hidden = false;
    document.querySelector('#conta-nome').textContent = 'Conta local · desenvolvimento';
    clearInterval(timer); timer = setInterval(atualizar, 2000); atualizar();
  }
  document.addEventListener('jur:sessao', entrar);
  document.addEventListener('jur:sair', () => {
    generation++; clearInterval(timer); section.hidden = true; previous = '';
    $('#local-resultados').replaceChildren(); $('#local-feedback').textContent = '';
  });
  if (window.jurSessao?.principal) entrar();
})();
