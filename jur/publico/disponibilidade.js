// jur/publico/disponibilidade.js
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);

  const PROMPTS = [
    { titulo: 'Tese firmada',
      texto: 'Qual a tese firmada pelo STJ sobre ' },
    { titulo: 'Comparar tribunais',
      texto: 'Compare o entendimento do TRF4 e do TRF3 sobre ' },
    { titulo: 'Verificar julgado',
      texto: 'Verifique se existe mesmo o julgado ' },
    { titulo: 'Precedentes por período',
      texto: 'Levante acórdãos do TJPR entre 01/01/2024 e 31/12/2024 sobre ' },
  ];

  const ROTULO = {
    ok: 'funcionando',
    instavel: 'com ressalva',
    'sem-acesso': 'bloqueado',
    'exige-sessao': 'exige sua sessão',
  };

  function montarPrompts() {
    const alvo = $('#prompts');
    alvo.innerHTML = '<p class="titulo-bloco">Comece por aqui</p>';
    const grade = document.createElement('div');
    grade.className = 'grade-prompts';
    for (const p of PROMPTS) {
      const b = document.createElement('button');
      b.className = 'cartao-prompt';
      b.type = 'button';
      b.textContent = p.titulo;
      b.addEventListener('click', () => window.jurUI.preencherEntrada(p.texto));
      grade.appendChild(b);
    }
    alvo.appendChild(grade);
  }

  function montarManual() {
    const alvo = $('#manual');
    alvo.innerHTML = `
      <details class="manual">
        <summary>Como usar</summary>
        <div class="manual-corpo"></div>
      </details>`;
    const corpo = $('.manual-corpo', alvo);
    const paragrafos = [
      ['O que é', 'Busca de jurisprudência em 75 acervos de tribunais brasileiros. Você pergunta em português; o assistente escolhe o tribunal, executa a busca na base oficial e resume o que encontrou.'],
      ['Como pedir', 'Diga o tribunal, o tema e, se importar, o período. "Acórdãos do TRF4 sobre auxílio-acidente em 2024" funciona melhor que "previdenciário".'],
      ['Nada é citado sem verificação', 'Todo julgado citado veio de uma consulta à base oficial do tribunal, não da memória do modelo.'],
      ['Zero resultado não é ausência', 'Vários acervos têm recorte de período ou de matéria. Quando uma busca volta vazia, a ressalva do tribunal vem junto — leia antes de concluir que não existe jurisprudência sobre o tema.'],
      ['Busca que falha é diferente de busca vazia', 'Se o crawler não completar, o assistente diz isso explicitamente em vez de reportar "não encontrei nada".'],
    ];
    for (const [titulo, texto] of paragrafos) {
      const h = document.createElement('h3'); h.textContent = titulo;
      const p = document.createElement('p'); p.textContent = texto;
      corpo.appendChild(h); corpo.appendChild(p);
    }
    const estados = document.createElement('h3'); estados.textContent = 'Os quatro estados';
    corpo.appendChild(estados);
    const ul = document.createElement('ul');
    for (const [estado, rotulo] of Object.entries(ROTULO)) {
      const li = document.createElement('li');
      const ponto = document.createElement('span');
      ponto.className = 'ponto'; ponto.dataset.e = estado;
      li.appendChild(ponto);
      li.appendChild(document.createTextNode(` ${estado} — ${rotulo}`));
      ul.appendChild(li);
    }
    corpo.appendChild(ul);
  }

  function abrirRessalva(t) {
    const caixa = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = `${t.comando} — ${t.nome}`;
    const estado = document.createElement('p');
    estado.className = 'estado-linha';
    const ponto = document.createElement('span');
    ponto.className = 'ponto'; ponto.dataset.e = t.estado;
    estado.appendChild(ponto);
    estado.appendChild(document.createTextNode(` ${t.estado} — ${ROTULO[t.estado] || t.estado}`));
    const nota = document.createElement('p');
    nota.className = 'nota';
    nota.textContent = t.nota || 'Sem ressalva registrada para este tribunal.';
    caixa.appendChild(h); caixa.appendChild(estado); caixa.appendChild(nota);
    window.jurUI.abrirPainel($('#painel-ressalva'), '');
    $('.painel-caixa', $('#painel-ressalva')).appendChild(caixa);
  }

  async function montarDisponibilidade() {
    const alvo = $('#disponibilidade');
    let tribunais = [];
    try {
      tribunais = (await window.jurApi.pedir('/api/v1/tribunais')).tribunais;
    } catch (e) {
      alvo.innerHTML = '<p class="titulo-bloco">Disponibilidade</p>';
      const erro = document.createElement('p');
      erro.className = 'vazio';
      erro.textContent = `Não foi possível carregar a lista de tribunais: ${e.message}`;
      alvo.appendChild(erro);
      return;
    }

    const conta = (e) => tribunais.filter((t) => t.estado === e).length;
    alvo.innerHTML = '<p class="titulo-bloco">Disponibilidade</p>';

    const placar = document.createElement('div');
    placar.className = 'placar';
    for (const estado of ['ok', 'instavel', 'sem-acesso', 'exige-sessao']) {
      const item = document.createElement('span');
      const ponto = document.createElement('span');
      ponto.className = 'ponto'; ponto.dataset.e = estado;
      item.appendChild(ponto);
      item.appendChild(document.createTextNode(` ${conta(estado)} ${ROTULO[estado]}`));
      placar.appendChild(item);
    }
    alvo.appendChild(placar);

    const grade = document.createElement('div');
    grade.className = 'grade-tribunais';
    for (const t of tribunais) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sigla';
      b.dataset.e = t.estado;
      b.textContent = t.comando;
      b.title = `${t.nome} — clique para ver detalhes`;
      b.addEventListener('click', () => abrirRessalva(t));
      grade.appendChild(b);
    }
    alvo.appendChild(grade);

    const dica = document.createElement('p');
    dica.className = 'vazio';
    dica.textContent = 'Clique numa sigla para ver o nome do tribunal e a ressalva registrada.';
    alvo.appendChild(dica);
  }

  montarPrompts();
  montarDisponibilidade();
  montarManual();
}());
