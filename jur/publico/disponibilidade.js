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

  // Como o valor precisa vir, por forma. O que importa aqui e a assimetria: nos
  // tribunais de nome-exato e codigo, o valor aproximado NAO da erro — da zero, e zero
  // se le como "esse magistrado nao julgou nada sobre o tema".
  const FORMA_MAGISTRADO = {
    'nome-exato': 'sim — exige o NOME EXATO do combo do tribunal (nome parcial devolve zero, não erro)',
    trecho: 'sim — basta um trecho do nome',
    nome: 'sim — pelo nome do magistrado',
    codigo: 'sim — mas por CÓDIGO/matrícula, não pelo nome',
  };

  /**
   * Diz, na ficha do tribunal, se a busca por magistrado existe ali. Um usuario tentou
   * buscar por magistrado no TJPR e nao conseguiu: o portal do TJPR nao tem esse filtro,
   * e nada na tela dizia isso. Silencio vira "quebrado" na cabeca de quem tenta.
   */
  function linhaMagistrado(t) {
    const r = t.relator || { suportado: false };
    const p = document.createElement('p');
    p.className = 'nota magistrado';
    const rotulo = document.createElement('strong');
    rotulo.textContent = 'Busca por magistrado: ';
    p.appendChild(rotulo);
    p.appendChild(document.createTextNode(
      r.suportado ? (FORMA_MAGISTRADO[r.forma] || 'sim') : 'não — este portal não tem esse filtro',
    ));
    if (r.nota) {
      const detalhe = document.createElement('small');
      detalhe.textContent = r.nota;
      p.appendChild(document.createElement('br'));
      p.appendChild(detalhe);
    }
    return p;
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
    caixa.appendChild(linhaMagistrado(t));
    window.jurUI.abrirPainel($('#painel-ressalva'), '');
    $('.painel-caixa', $('#painel-ressalva')).appendChild(caixa);
  }

  // ---------- escopo: quais tribunais o usuario deixou ligados ----------
  //
  // Guarda os DESLIGADOS, nao os ligados. Assim um tribunal novo numa versao futura
  // nasce ligado; guardando os ligados, ele nasceria invisivel para todo mundo que ja
  // tem a chave no localStorage — um tribunal que existe e ninguem consegue usar, sem
  // sintoma nenhum.
  const CHAVE_DESLIGADOS = 'jur.tribunaisDesligados';

  function lerDesligados() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE_DESLIGADOS) || '[]');
      return new Set(Array.isArray(bruto) ? bruto : []);
    } catch { return new Set(); }
  }

  function gravarDesligados(conjunto) {
    try { localStorage.setItem(CHAVE_DESLIGADOS, JSON.stringify([...conjunto])); }
    catch { /* modo privado */ }
  }

  let tribunais = [];
  let desligados = lerDesligados();
  const filtros = { area: new Set(), uf: new Set() };

  /** Tribunal indisponivel nunca conta como ligado: mostra-lo assim seria mentira, e
   *  manda-lo no escopo so gastaria uma recusa do outro lado. */
  const podeLigar = (t) => t.disponivel;
  const estaLigado = (t) => podeLigar(t) && !desligados.has(t.comando);

  /**
   * Os tribunais que vao no corpo do POST /api/v1/chat. app.js consome isto — e a unica
   * porta entre o painel e a busca.
   */
  window.jurEscopo = {
    ligados() {
      return tribunais.filter(estaLigado).map((t) => t.comando);
    },
  };

  // ---------- filtros ----------

  const ROTULO_AREA = {
    superior: 'Superiores',
    federal: 'Justiça Federal',
    estadual: 'Justiça Estadual',
    trabalhista: 'Justiça do Trabalho',
    contas: 'Tribunais de Contas',
    // O catalogo tem seis segmentos, nao cinco: CARF, CRPS e CSJT sao instancias
    // ADMINISTRATIVAS, nao Judiciario. Sem este rotulo o chip mostrava a chave crua.
    administrativo: 'Administrativos',
  };

  /** Filtro e SO apresentacao: esconder da tela nao tira ninguem do escopo da busca. */
  function passaNoFiltro(t) {
    if (filtros.area.size && !filtros.area.has(t.segmento)) return false;
    if (filtros.uf.size && !t.uf.some((u) => filtros.uf.has(u))) return false;
    return true;
  }

  function chipFiltro(classe, valor, rotulo, contagem, aoTrocar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip-filtro ${classe}`;
    b.dataset.valor = valor;
    const nome = document.createElement('span');
    nome.textContent = rotulo;
    b.appendChild(nome);
    const n = document.createElement('span');
    n.className = 'chip-conta';
    n.textContent = String(contagem);
    b.appendChild(n);
    b.addEventListener('click', aoTrocar);
    return b;
  }

  function alternar(conjunto, valor) {
    if (conjunto.has(valor)) conjunto.delete(valor); else conjunto.add(valor);
    redesenhar();
  }

  // ---------- desenho ----------

  let elBarraFiltros; let elGrade; let elPlacar; let elLimpar;

  function redesenhar() {
    // Filtros ativos ficam com aria-pressed; a grade so esconde o que nao passa (os
    // elementos continuam no DOM, com o mesmo estado de ligado/desligado).
    for (const b of elBarraFiltros.querySelectorAll('.chip-filtro')) {
      const conjunto = b.classList.contains('filtro-area') ? filtros.area : filtros.uf;
      b.setAttribute('aria-pressed', String(conjunto.has(b.dataset.valor)));
    }
    for (const chip of elGrade.querySelectorAll('.chip-tribunal')) {
      const t = tribunais.find((x) => x.comando === chip.dataset.comando);
      chip.hidden = !passaNoFiltro(t);
      const liga = chip.querySelector('.liga');
      liga.setAttribute('aria-pressed', String(estaLigado(t)));
    }
    elLimpar.hidden = !(filtros.area.size || filtros.uf.size);
    desenharPlacar();
  }

  function desenharPlacar() {
    elPlacar.innerHTML = '';
    const conta = (e) => tribunais.filter((t) => t.estado === e).length;
    for (const estado of ['ok', 'instavel', 'sem-acesso', 'exige-sessao']) {
      const item = document.createElement('span');
      const ponto = document.createElement('span');
      ponto.className = 'ponto'; ponto.dataset.e = estado;
      item.appendChild(ponto);
      item.appendChild(document.createTextNode(` ${conta(estado)} ${ROTULO[estado]}`));
      elPlacar.appendChild(item);
    }
    const ligados = document.createElement('strong');
    ligados.className = 'placar-ligados';
    ligados.textContent = `${window.jurEscopo.ligados().length} ligados para busca`;
    elPlacar.appendChild(ligados);
  }

  function montarChipTribunal(t) {
    const chip = document.createElement('span');
    chip.className = 'chip-tribunal';
    chip.dataset.comando = t.comando;
    // A barra da esquerda e o estado REAL (o servidor decide); a bolinha da direita e o
    // liga/desliga (o usuario decide). Sao dois fatos diferentes sobre o mesmo tribunal
    // e nao podem compartilhar o mesmo sinal visual.
    chip.dataset.e = t.estado;

    const sigla = document.createElement('button');
    sigla.type = 'button';
    sigla.className = 'sigla';
    sigla.textContent = t.comando;   // o CSS deixa maiusculo; o DADO segue minusculo
    sigla.title = `${t.nome} — clique para ver detalhes`;
    sigla.addEventListener('click', () => abrirRessalva(t));

    const liga = document.createElement('button');
    liga.type = 'button';
    liga.className = 'liga';
    liga.setAttribute('aria-pressed', String(estaLigado(t)));
    liga.addEventListener('click', () => {
      if (!podeLigar(t)) {
        // Nao faz nada em silencio: abre a ressalva, que e onde esta o motivo de o
        // tribunal nao poder ser usado.
        abrirRessalva(t);
        return;
      }
      if (desligados.has(t.comando)) desligados.delete(t.comando);
      else desligados.add(t.comando);
      gravarDesligados(desligados);
      redesenhar();
    });

    chip.appendChild(sigla);
    chip.appendChild(liga);
    rotularLiga(liga, t);
    return chip;
  }

  function rotularLiga(liga, t) {
    if (!podeLigar(t)) {
      liga.setAttribute('aria-label', `${t.comando} indisponível (${t.estado}) — não pode ser ligado`);
      liga.title = `Indisponível (${ROTULO[t.estado] || t.estado}) — clique para ver o motivo`;
      return;
    }
    // O rotulo descreve o ESTADO, nao a acao: `aria-pressed` ja diz o que o clique faz,
    // e um rotulo que muda entre "Ligar" e "Desligar" faz o leitor de tela anunciar duas
    // coisas contraditorias.
    liga.setAttribute('aria-label', `${t.comando} incluído nas buscas`);
    liga.title = 'Incluir/excluir este tribunal das buscas';
  }

  async function montarDisponibilidade() {
    const alvo = $('#disponibilidade');
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

    alvo.innerHTML = '<p class="titulo-bloco">Disponibilidade</p>';

    elPlacar = document.createElement('div');
    elPlacar.className = 'placar';
    alvo.appendChild(elPlacar);

    // --- barra de filtros ---
    elBarraFiltros = document.createElement('div');
    elBarraFiltros.className = 'barra-filtros';

    const linhaArea = document.createElement('div');
    linhaArea.className = 'linha-filtro';
    const rotuloArea = document.createElement('span');
    rotuloArea.className = 'rotulo-filtro';
    rotuloArea.textContent = 'Área:';
    linhaArea.appendChild(rotuloArea);
    const areas = [...new Set(tribunais.map((t) => t.segmento).filter(Boolean))]
      .sort((a, b) => (ROTULO_AREA[a] || a).localeCompare(ROTULO_AREA[b] || b, 'pt-BR'));
    for (const area of areas) {
      linhaArea.appendChild(chipFiltro(
        'filtro-area', area, ROTULO_AREA[area] || area,
        tribunais.filter((t) => t.segmento === area).length,
        () => alternar(filtros.area, area),
      ));
    }
    elBarraFiltros.appendChild(linhaArea);

    const linhaUf = document.createElement('div');
    linhaUf.className = 'linha-filtro';
    const rotuloUf = document.createElement('span');
    rotuloUf.className = 'rotulo-filtro';
    rotuloUf.textContent = 'UF:';
    linhaUf.appendChild(rotuloUf);
    const ufs = [...new Set(tribunais.flatMap((t) => t.uf))].sort();
    for (const uf of ufs) {
      linhaUf.appendChild(chipFiltro(
        'filtro-uf', uf, uf,
        tribunais.filter((t) => t.uf.includes(uf)).length,
        () => alternar(filtros.uf, uf),
      ));
    }
    // 27 UFs ocupam a tela inteira sem ninguem ter pedido; colapsa como o painel de
    // intimacoes do ProcStudio faz, com o "+N" abrindo o resto.
    linhaUf.classList.add('colapsado');
    const maisUf = document.createElement('button');
    maisUf.type = 'button';
    maisUf.className = 'chip-filtro mais';
    maisUf.textContent = 'todas as UFs';
    maisUf.addEventListener('click', () => {
      const aberto = linhaUf.classList.toggle('colapsado');
      maisUf.textContent = aberto ? 'todas as UFs' : 'menos UFs';
    });
    linhaUf.appendChild(maisUf);
    elBarraFiltros.appendChild(linhaUf);

    const acoes = document.createElement('div');
    acoes.className = 'linha-filtro acoes-escopo';
    elLimpar = document.createElement('button');
    elLimpar.type = 'button';
    elLimpar.id = 'limpar-filtros';
    elLimpar.className = 'ligacao';
    elLimpar.textContent = 'Limpar filtros';
    elLimpar.addEventListener('click', () => { filtros.area.clear(); filtros.uf.clear(); redesenhar(); });
    const ligarTodos = document.createElement('button');
    ligarTodos.type = 'button';
    ligarTodos.id = 'ligar-todos';
    ligarTodos.className = 'ligacao';
    ligarTodos.textContent = 'Ligar todos';
    ligarTodos.addEventListener('click', () => { desligados.clear(); gravarDesligados(desligados); redesenhar(); });
    const desligarTodos = document.createElement('button');
    desligarTodos.type = 'button';
    desligarTodos.id = 'desligar-todos';
    desligarTodos.className = 'ligacao';
    desligarTodos.textContent = 'Desligar todos';
    desligarTodos.addEventListener('click', () => {
      desligados = new Set(tribunais.filter(podeLigar).map((t) => t.comando));
      gravarDesligados(desligados);
      redesenhar();
    });
    acoes.appendChild(ligarTodos); acoes.appendChild(desligarTodos); acoes.appendChild(elLimpar);
    elBarraFiltros.appendChild(acoes);
    alvo.appendChild(elBarraFiltros);

    // --- grade ---
    elGrade = document.createElement('div');
    elGrade.className = 'grade-tribunais';
    for (const t of tribunais) elGrade.appendChild(montarChipTribunal(t));
    alvo.appendChild(elGrade);

    const dica = document.createElement('p');
    dica.className = 'vazio';
    dica.textContent = 'Clique na sigla para ver a ressalva do tribunal; na bolinha, para incluir ou tirar das buscas.';
    alvo.appendChild(dica);

    redesenhar();
  }

  montarPrompts();
  montarDisponibilidade();
  montarManual();
}());
