(function () {
  const mounts = new Map();
  window.jurSeletor = {
    montar(container) {
      for (const [node, controller] of mounts) {
        if (node === container || !node.isConnected) {
          controller.abort();
          mounts.delete(node);
        }
      }
      const controller = new AbortController();
      mounts.set(container, controller);
      const options = { signal: controller.signal };
      container.innerHTML =
        '<button type="button" class="modelo-abrir" aria-expanded="false">Configurar IA</button><input class="modelo" type="hidden"><div class="modelo-popover" hidden><label>Conexão<select class="campo conexao-select" aria-label="Conexão de IA"></select></label><label>Buscar modelo<input class="campo modelo-busca" type="search" placeholder="Nome ou ID do modelo"></label><div class="modelo-opcoes" role="group" aria-label="Modelos disponíveis"></div><p class="modelo-status" role="status"></p><button type="button" class="botao-secundario usar-modelo">Usar ID informado</button></div>';
      const $ = (s) => container.querySelector(s);
      const trigger = $('.modelo-abrir'),
        popover = $('.modelo-popover'),
        select = $('.conexao-select'),
        search = $('.modelo-busca'),
        items = $('.modelo-opcoes'),
        status = $('.modelo-status');
      let models = [],
        generation = 0;
      function refresh() {
        const state = window.jurConexoes;
        const chosen = state.lista.find(
          (c) => c.id === state.selected?.conexaoId,
        );
        $('.modelo').value = state.selected?.modelo || '';
        trigger.textContent = chosen
          ? `${state.names[chosen.provider]} · ${state.selected.modelo}`
          : 'Configurar IA';
      }
      function close() {
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
      async function choose(model) {
        try {
          await window.jurConexoes.selecionar(select.value, model);
          close();
          trigger.focus();
        } catch (e) {
          status.textContent = e.message;
        }
      }
      function render() {
        items.replaceChildren();
        const q = search.value.toLowerCase();
        for (const m of models
          .filter((m) => (m.name + ' ' + m.id).toLowerCase().includes(q))
          .slice(0, 80)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'modelo-opcao';
          b.disabled = m.tools === false;
          const name = document.createElement('strong');
          name.textContent = m.name;
          const id = document.createElement('small');
          id.textContent =
            m.id + (m.tools === false ? ' · sem ferramentas' : '');
          b.append(name, id);
          b.addEventListener('click', () => choose(m.id));
          items.append(b);
        }
      }
      async function load() {
        const g = ++generation;
        models = [];
        render();
        status.textContent = 'Carregando modelos…';
        try {
          const fetched = await window.jurConexoes.modelos(select.value);
          if (g !== generation) return;
          models = fetched;
          status.textContent = '';
          render();
        } catch (e) {
          if (g === generation)
            status.textContent = e.message + ' Você também pode informar o ID.';
        }
      }
      trigger.addEventListener('click', () => {
        if (!window.jurConexoes.lista.length) {
          document.querySelector('#abrir-config').click();
          return;
        }
        if (!popover.hidden) {
          close();
          return;
        }
        select.replaceChildren();
        for (const c of window.jurConexoes.lista) {
          const o = new Option(
            c.name + ' · ' + window.jurConexoes.names[c.provider],
            c.id,
          );
          select.add(o);
        }
        select.value =
          window.jurConexoes.selected?.conexaoId || select.options[0].value;
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        search.focus();
        load();
      });
      select.addEventListener('change', load);
      search.addEventListener('input', render);
      $('.usar-modelo').addEventListener('click', () =>
        choose(search.value.trim()),
      );
      container.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          close();
          trigger.focus();
        }
      });
      document.addEventListener(
        'click',
        (e) => {
          if (!container.contains(e.target)) close();
        },
        options,
      );
      document.addEventListener('jur:ia', refresh, options);
      refresh();
    },
  };
})();
