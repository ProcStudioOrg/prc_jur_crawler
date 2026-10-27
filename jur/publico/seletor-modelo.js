(function () {
  const mounts = new Map();
  const ehProcstudio = (c) => c?.provider === 'procstudio';
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
      // A conexao ProcStudio (quando o servidor a oferece) vem primeiro, com um botao so: o
      // modelo e o do operador, nao ha o que buscar. As conexoes proprias ficam abaixo do
      // separador "Avancado", como eram antes.
      container.innerHTML =
        '<button type="button" class="modelo-abrir" aria-expanded="false">Configurar IA</button><input class="modelo" type="hidden"><div class="modelo-popover" hidden><div class="modelo-gerenciada" hidden><div class="modelo-gerenciada-topo"><strong>ProcStudio</strong><span class="selo">recomendada</span></div><small class="modelo-gerenciada-desc">Usa o saldo de IA do seu time no ProcStudio.</small><small class="modelo-preco" hidden></small><button type="button" class="botao-acento usar-procstudio"></button></div><p class="modelo-separador" hidden>Avançado — usar minha própria chave</p><div class="modelo-proprias"><label>Conexão<select class="campo conexao-select" aria-label="Conexão de IA"></select></label><label>Buscar modelo<input class="campo modelo-busca" type="search" placeholder="Nome ou ID do modelo"></label><div class="modelo-opcoes" role="group" aria-label="Modelos disponíveis"></div><p class="modelo-status" role="status"></p><button type="button" class="botao-secundario usar-modelo">Usar ID informado</button></div><button type="button" class="botao-secundario modelo-adicionar" hidden>Configurar uma conexão própria</button></div>';
      const $ = (s) => container.querySelector(s);
      const trigger = $('.modelo-abrir'),
        popover = $('.modelo-popover'),
        gerenciadaBloco = $('.modelo-gerenciada'),
        preco = $('.modelo-preco'),
        usarProcstudio = $('.usar-procstudio'),
        separador = $('.modelo-separador'),
        proprias = $('.modelo-proprias'),
        adicionar = $('.modelo-adicionar'),
        select = $('.conexao-select'),
        search = $('.modelo-busca'),
        items = $('.modelo-opcoes'),
        status = $('.modelo-status');
      let models = [],
        generation = 0,
        carregado = false;
      function refresh() {
        const state = window.jurConexoes;
        const chosen = state.lista.find(
          (c) => c.id === state.selected?.conexaoId,
        );
        $('.modelo').value = state.selected?.modelo || '';
        trigger.textContent = chosen
          ? `${state.names[chosen.provider]} · ${ehProcstudio(chosen) ? chosen.rotulo : state.selected.modelo}`
          : 'Configurar IA';
      }
      function precoTexto() {
        const m = window.jurSaldo?.dados?.modelo;
        if (!m || m.entradaPor1MBrl == null || m.saidaPor1MBrl == null) return '';
        const brl = window.jurSaldo.formatarBrl;
        return `${brl(m.entradaPor1MBrl)} / 1M entrada · ${brl(m.saidaPor1MBrl)} / 1M saída`;
      }
      function desenharPreco() {
        preco.textContent = precoTexto();
        preco.hidden = !preco.textContent;
      }
      function close() {
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
      async function choose(conexaoId, model) {
        try {
          await window.jurConexoes.selecionar(conexaoId, model);
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
          b.addEventListener('click', () => choose(select.value, m.id));
          items.append(b);
        }
      }
      async function load() {
        const g = ++generation;
        carregado = true;
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
        const state = window.jurConexoes;
        if (!state.lista.length) {
          document.querySelector('#abrir-config').click();
          return;
        }
        if (!popover.hidden) {
          close();
          return;
        }
        const gerenciada = state.lista.find(ehProcstudio);
        const outras = state.lista.filter((c) => !ehProcstudio(c));
        gerenciadaBloco.hidden = !gerenciada;
        separador.hidden = !gerenciada;
        if (gerenciada) {
          usarProcstudio.textContent = `Usar ${gerenciada.rotulo}`;
          gerenciadaBloco.classList.toggle(
            'selecionada',
            state.selected?.conexaoId === gerenciada.id,
          );
          desenharPreco();
        }
        proprias.hidden = !outras.length;
        adicionar.hidden = !(gerenciada && !outras.length);
        select.replaceChildren();
        for (const c of outras) {
          select.add(new Option(c.name + ' · ' + state.names[c.provider], c.id));
        }
        const propriaEscolhida = outras.some(
          (c) => c.id === state.selected?.conexaoId,
        );
        if (outras.length)
          select.value = propriaEscolhida
            ? state.selected.conexaoId
            : select.options[0].value;
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        // Com a ProcStudio escolhida o catalogo da conexao propria so e buscado quando o
        // usuario for ate ela: abrir o seletor nao chama o provedor dele a toa.
        carregado = false;
        models = [];
        status.textContent = '';
        render();
        if (propriaEscolhida || !gerenciada) {
          if (outras.length) load();
          search.focus();
        } else {
          usarProcstudio.focus();
        }
      });
      usarProcstudio.addEventListener('click', () => {
        const gerenciada = window.jurConexoes.lista.find(ehProcstudio);
        if (gerenciada) choose(gerenciada.id, gerenciada.model);
      });
      adicionar.addEventListener('click', () => {
        close();
        window.jurConfig.abrir({ avancado: true });
      });
      select.addEventListener('change', load);
      search.addEventListener('focus', () => {
        if (!carregado && !proprias.hidden) load();
      });
      search.addEventListener('input', render);
      $('.usar-modelo').addEventListener('click', () =>
        choose(select.value, search.value.trim()),
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
      document.addEventListener('jur:saldo', desenharPreco, options);
      refresh();
    },
  };
})();
