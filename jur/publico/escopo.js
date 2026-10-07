// jur/publico/escopo.js
//
// Onde o usuario quer buscar. Um conjunto de tribunais SELECIONADOS; vazio significa
// "todos os disponiveis". Nao existe mais liga/desliga: o usuario clicou no CRPS (que
// exige login Gov.br e por isso nao ligava), o painel seguiu com os 75 e o modelo
// buscou nos TRFs — o painel nao representava o que ele quis dizer.
//
// Este modulo e dono do catalogo carregado e da selecao; disponibilidade.js desenha a
// grade e a ficha em cima dele, e app.js le `escopo()` na hora do POST.
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);
  let tribunais = [];
  let selecionados = [];

  function chave() {
    const p = window.jurSessao?.principal;
    return p ? 'jur.tribunaisSelecionados.' + JSON.stringify([p.issuer, p.userId, p.teamId]) : null;
  }
  function ler() {
    try {
      const bruto = JSON.parse(localStorage.getItem(chave()) || '[]');
      return Array.isArray(bruto) ? bruto.filter((c) => typeof c === 'string') : [];
    } catch { return []; }
  }
  function gravar() {
    try { localStorage.setItem(chave(), JSON.stringify(selecionados)); } catch { /* modo privado */ }
  }
  function avisar() {
    gravar();
    document.dispatchEvent(new Event('jur:escopo'));
  }

  const porComando = (c) => tribunais.find((t) => t.comando === c);
  const podeSelecionar = (c) => Boolean(porComando(c)?.disponivel);
  const disponiveis = () => tribunais.filter((t) => t.disponivel).map((t) => t.comando);

  window.jurEscopo = {
    tribunais: () => tribunais,
    selecionados: () => [...selecionados],
    podeSelecionar,
    /** O que vai no POST: a selecao, ou todos os disponiveis quando ela esta vazia. */
    escopo() {
      const validos = selecionados.filter(podeSelecionar);
      return validos.length ? validos : disponiveis();
    },
    selecionar(c) { if (podeSelecionar(c) && !selecionados.includes(c)) { selecionados.push(c); avisar(); } },
    tirar(c) { const i = selecionados.indexOf(c); if (i >= 0) { selecionados.splice(i, 1); avisar(); } },
    alternar(c) { if (selecionados.includes(c)) this.tirar(c); else this.selecionar(c); },
    selecionarVarios(lista) {
      for (const c of lista) if (podeSelecionar(c) && !selecionados.includes(c)) selecionados.push(c);
      avisar();
    },
    limpar() { selecionados = []; avisar(); },
    montarBarra,
  };

  async function carregar() {
    selecionados = ler();
    try {
      tribunais = (await window.jurApi.pedir('/api/v1/tribunais')).tribunais;
    } catch (e) {
      tribunais = [];
      document.dispatchEvent(new CustomEvent('jur:tribunais', { detail: { erro: e.message } }));
      return;
    }
    // Tribunal que deixou de estar disponivel sai da selecao em silencio? NAO: fica
    // guardado (pode voltar), mas `escopo()` o ignora. So a barra o mostra em vermelho.
    document.dispatchEvent(new Event('jur:tribunais'));
    document.dispatchEvent(new Event('jur:escopo'));
  }

  // ---------- barra "Buscar em" ----------
  // Ouvintes de `document` por montagem: montarCaixa remonta a barra a cada conversa,
  // e sem isso as barras soltas do DOM continuariam redesenhando e fechando popovers.
  const montagens = new Map();
  function montarBarra(container) {
    for (const [no, controlador] of montagens) {
      if (no === container || !no.isConnected) {
        controlador.abort();
        montagens.delete(no);
      }
    }
    const controlador = new AbortController();
    montagens.set(container, controlador);
    const opcoes = { signal: controlador.signal };
    container.innerHTML = '';
    const rotulo = document.createElement('span');
    rotulo.className = 'escopo-rotulo';
    rotulo.textContent = 'Buscar em';
    const chips = document.createElement('span');
    chips.className = 'escopo-chips';
    const adicionar = document.createElement('button');
    adicionar.type = 'button';
    adicionar.className = 'ligacao escopo-adicionar';
    adicionar.textContent = '+ adicionar';
    adicionar.setAttribute('aria-expanded', 'false');
    const todos = document.createElement('button');
    todos.type = 'button';
    todos.className = 'ligacao escopo-todos';
    todos.textContent = 'Todos os disponíveis';
    const popover = document.createElement('div');
    popover.className = 'escopo-popover';
    popover.hidden = true;
    popover.innerHTML = '<input class="campo escopo-busca" type="search" placeholder="Sigla ou nome do tribunal" aria-label="Buscar tribunal"><div class="escopo-opcoes" role="listbox"></div>';
    container.append(rotulo, chips, adicionar, todos, popover);

    function desenhar() {
      chips.replaceChildren();
      const lista = window.jurEscopo.selecionados();
      if (!lista.length) {
        const p = document.createElement('span');
        p.className = 'pill pill-todos';
        p.textContent = `Todos os disponíveis (${disponiveis().length})`;
        chips.appendChild(p);
      }
      for (const c of lista) {
        const p = document.createElement('span');
        p.className = 'pill';
        p.dataset.comando = c;
        if (!podeSelecionar(c)) p.classList.add('pill-indisponivel');
        const b = document.createElement('b');
        b.textContent = c;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tirar';
        x.textContent = '×';
        x.setAttribute('aria-label', `Tirar ${c.toUpperCase()} da busca`);
        x.addEventListener('click', () => window.jurEscopo.tirar(c));
        p.append(b, x);
        chips.appendChild(p);
      }
      todos.hidden = !lista.length;
    }

    function desenharOpcoes() {
      const alvo = $('.escopo-opcoes', popover);
      alvo.replaceChildren();
      const q = $('.escopo-busca', popover).value.trim().toLowerCase();
      const ja = new Set(window.jurEscopo.selecionados());
      const opcoes = tribunais
        .filter((t) => t.disponivel && !ja.has(t.comando))
        .filter((t) => !q || t.comando.includes(q) || t.nome.toLowerCase().includes(q))
        .slice(0, 40);
      for (const t of opcoes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'escopo-opcao';
        b.dataset.comando = t.comando;
        b.setAttribute('role', 'option');
        b.innerHTML = `<b></b> <small></small>`;
        $('b', b).textContent = t.comando;
        $('small', b).textContent = t.nome;
        b.addEventListener('click', () => { window.jurEscopo.selecionar(t.comando); fechar(); });
        alvo.appendChild(b);
      }
      if (!opcoes.length) {
        const p = document.createElement('p');
        p.className = 'vazio';
        p.textContent = q ? 'Nenhum tribunal disponível com esse nome.' : 'Todos os disponíveis já estão selecionados.';
        alvo.appendChild(p);
      }
    }
    function abrir() {
      popover.hidden = false;
      adicionar.setAttribute('aria-expanded', 'true');
      $('.escopo-busca', popover).value = '';
      desenharOpcoes();
      $('.escopo-busca', popover).focus();
    }
    function fechar() { popover.hidden = true; adicionar.setAttribute('aria-expanded', 'false'); }

    adicionar.addEventListener('click', () => (popover.hidden ? abrir() : fechar()));
    todos.addEventListener('click', () => window.jurEscopo.limpar());
    $('.escopo-busca', popover).addEventListener('input', desenharOpcoes);
    container.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fechar(); adicionar.focus(); } });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) fechar(); }, opcoes);
    document.addEventListener('jur:escopo', desenhar, opcoes);
    document.addEventListener('jur:tribunais', desenhar, opcoes);
    desenhar();
  }

  document.addEventListener('jur:sessao', carregar);
  // A tentativa assistida (captcha manual no STJ) muda `disponivel` em tempo de execucao.
  document.addEventListener('jur:navegadores-preferencias', carregar);
  document.addEventListener('jur:sair', () => {
    tribunais = []; selecionados = [];
    // Ao sair, nenhuma barra montada deve continuar ouvindo.
    for (const controlador of montagens.values()) controlador.abort();
    montagens.clear();
  });
}());
