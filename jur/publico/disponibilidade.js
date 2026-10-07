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
    for (const [estado, rotulo] of [['ok', 'funcionando'], ['instavel', 'com ressalva'], ['sem-acesso', 'indisponível'], ['exige-sessao', 'indisponível, exige sua sessão']]) {
      const li = document.createElement('li');
      const ponto = document.createElement('span');
      ponto.className = 'ponto ' + COR[estado];
      li.appendChild(ponto);
      li.appendChild(document.createTextNode(` ${estado} — ${rotulo}`));
      ul.appendChild(li);
    }
    corpo.appendChild(ul);
  }

  // O estado e do servidor; a cor do ponto vem daqui. Dois estados vermelhos: ambos
  // significam "nao da para buscar agora", so o motivo muda (a ficha explica).
  const ROTULO_BADGE = { ok: 'Funcionando', instavel: 'Com ressalva', 'sem-acesso': 'Indisponível', 'exige-sessao': 'Indisponível', assistido: 'Com CAPTCHA manual' };
  const COR = { ok: 'ok', instavel: 'ressalva', 'sem-acesso': 'erro', 'exige-sessao': 'erro', assistido: 'ressalva' };

  // Estado apenas visual. O servidor decide a disponibilidade em tempo de execucao:
  // com "Resolver CAPTCHA manualmente" ligado, o STJ continua 'sem-acesso' no catalogo
  // mas vem disponivel e assistido. A cor tem de seguir o que o usuario realmente
  // consegue fazer (vermelho = nao selecionavel), entao esse caso vira 'assistido'.
  function estadoVisual(t) { return t.assistido ? 'assistido' : t.estado; }

  const ROTULO_AREA = {
    superior: 'Superiores', federal: 'Justiça Federal', estadual: 'Justiça Estadual',
    trabalhista: 'Justiça do Trabalho', contas: 'Tribunais de Contas', administrativo: 'Administrativos',
  };

  // Filtro e SO apresentacao: esconder da tela nao mexe no escopo da busca.
  const filtros = { area: new Set(), uf: new Set() };
  const tribunais = () => window.jurEscopo.tribunais();
  const selecionado = (c) => window.jurEscopo.selecionados().includes(c);

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
    const nome = document.createElement('span'); nome.textContent = rotulo;
    const n = document.createElement('span'); n.className = 'chip-conta'; n.textContent = String(contagem);
    b.append(nome, n);
    b.addEventListener('click', aoTrocar);
    return b;
  }
  function alternarFiltro(conjunto, valor) {
    if (conjunto.has(valor)) conjunto.delete(valor); else conjunto.add(valor);
    redesenhar();
  }

  let elBarraFiltros; let elGrade; let elPlacar; let elLimpar;

  function redesenhar() {
    if (!elGrade) return;
    for (const b of elBarraFiltros.querySelectorAll('.chip-filtro[data-valor]')) {
      const conjunto = b.classList.contains('filtro-area') ? filtros.area : filtros.uf;
      b.setAttribute('aria-pressed', String(conjunto.has(b.dataset.valor)));
    }
    for (const chip of elGrade.querySelectorAll('.chip-tribunal')) {
      const t = tribunais().find((x) => x.comando === chip.dataset.comando);
      chip.hidden = !passaNoFiltro(t);
      const sel = selecionado(t.comando);
      chip.classList.toggle('selecionado', sel);
      chip.querySelector('.sel').setAttribute('aria-pressed', String(sel));
    }
    elLimpar.hidden = !(filtros.area.size || filtros.uf.size);
    desenharPlacar();
  }

  function desenharPlacar() {
    elPlacar.replaceChildren();
    const conta = (estados) => tribunais().filter((t) => estados.includes(estadoVisual(t))).length;
    for (const [estados, rotulo, cor] of [[['ok'], 'funcionando', 'ok'], [['instavel', 'assistido'], 'com ressalva', 'ressalva'], [['sem-acesso', 'exige-sessao'], 'indisponíveis', 'erro']]) {
      const item = document.createElement('span');
      const ponto = document.createElement('span'); ponto.className = `ponto ${cor}`;
      item.append(ponto, document.createTextNode(` ${conta(estados)} ${rotulo}`));
      elPlacar.appendChild(item);
    }
    const n = window.jurEscopo.selecionados().length;
    const sel = document.createElement('strong');
    sel.className = 'placar-selecionados';
    sel.textContent = n ? `${n} selecionado${n > 1 ? 's' : ''}` : 'todos os disponíveis';
    elPlacar.appendChild(sel);
  }

  function montarChipTribunal(t) {
    const chip = document.createElement('span');
    chip.className = 'chip-tribunal';
    chip.dataset.comando = t.comando;
    chip.dataset.e = estadoVisual(t);

    const barra = document.createElement('i');
    barra.className = 'marca-estado';

    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'sel';
    const caixa = document.createElement('span'); caixa.className = 'cx';
    sel.append(caixa, document.createTextNode(t.comando));
    sel.setAttribute('aria-pressed', 'false');
    if (!t.disponivel) {
      sel.setAttribute('aria-disabled', 'true');
      sel.title = `${t.nome}: indisponível. Clique para ver o motivo.`;
      sel.setAttribute('aria-label', `${t.comando} indisponível — ver motivo`);
      sel.addEventListener('click', () => window.jurFicha.abrir(t.comando));
    } else {
      sel.title = t.assistido
        ? `${t.nome}: busca com CAPTCHA manual. Incluir ou tirar da busca`
        : `${t.nome}: incluir ou tirar da busca`;
      sel.setAttribute('aria-label', `${t.comando} na busca`);
      sel.addEventListener('click', () => window.jurEscopo.alternar(t.comando));
    }

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'info';
    info.textContent = 'ⓘ';
    info.title = 'Ficha do tribunal';
    info.setAttribute('aria-label', `Ficha de ${t.comando}`);
    info.addEventListener('click', () => window.jurFicha.abrir(t.comando));

    chip.append(barra, sel, info);
    return chip;
  }

  function montarDisponibilidade(evento) {
    const alvo = $('#disponibilidade');
    if (evento?.detail?.erro) {
      alvo.innerHTML = '<p class="titulo-bloco">Tribunais</p>';
      const erro = document.createElement('p'); erro.className = 'vazio';
      erro.textContent = `Não foi possível carregar a lista de tribunais: ${evento.detail.erro}`;
      alvo.appendChild(erro);
      return;
    }
    const lista = tribunais();
    alvo.innerHTML = '<p class="titulo-bloco">Tribunais</p>';

    elPlacar = document.createElement('div'); elPlacar.className = 'placar';
    alvo.appendChild(elPlacar);

    elBarraFiltros = document.createElement('div'); elBarraFiltros.className = 'barra-filtros';
    const linhaArea = document.createElement('div'); linhaArea.className = 'linha-filtro';
    const rotuloArea = document.createElement('span'); rotuloArea.className = 'rotulo-filtro'; rotuloArea.textContent = 'Área:';
    linhaArea.appendChild(rotuloArea);
    const areas = [...new Set(lista.map((t) => t.segmento).filter(Boolean))]
      .sort((a, b) => (ROTULO_AREA[a] || a).localeCompare(ROTULO_AREA[b] || b, 'pt-BR'));
    for (const area of areas) {
      linhaArea.appendChild(chipFiltro('filtro-area', area, ROTULO_AREA[area] || area,
        lista.filter((t) => t.segmento === area).length, () => alternarFiltro(filtros.area, area)));
    }
    elBarraFiltros.appendChild(linhaArea);

    const linhaUf = document.createElement('div'); linhaUf.className = 'linha-filtro';
    const rotuloUf = document.createElement('span'); rotuloUf.className = 'rotulo-filtro'; rotuloUf.textContent = 'UF:';
    linhaUf.appendChild(rotuloUf);
    const chipsUf = document.createElement('div'); chipsUf.className = 'chips-uf colapsado';
    const ufs = [...new Set(lista.flatMap((t) => t.uf))].sort();
    for (const uf of ufs) {
      chipsUf.appendChild(chipFiltro('filtro-uf', uf, uf, lista.filter((t) => t.uf.includes(uf)).length,
        () => alternarFiltro(filtros.uf, uf)));
    }
    linhaUf.appendChild(chipsUf);
    const maisUf = document.createElement('button');
    maisUf.type = 'button'; maisUf.className = 'chip-filtro mais';
    maisUf.textContent = `todas as ${ufs.length} UFs`;
    maisUf.setAttribute('aria-expanded', 'false');
    maisUf.addEventListener('click', () => {
      const colapsado = chipsUf.classList.toggle('colapsado');
      maisUf.textContent = colapsado ? `todas as ${ufs.length} UFs` : 'menos UFs';
      maisUf.setAttribute('aria-expanded', String(!colapsado));
    });
    linhaUf.appendChild(maisUf);
    elBarraFiltros.appendChild(linhaUf);

    const acoes = document.createElement('div'); acoes.className = 'linha-filtro acoes-escopo';
    const selecionarVisiveis = document.createElement('button');
    selecionarVisiveis.type = 'button'; selecionarVisiveis.id = 'selecionar-visiveis'; selecionarVisiveis.className = 'ligacao';
    selecionarVisiveis.textContent = 'Selecionar os visíveis';
    selecionarVisiveis.addEventListener('click', () => window.jurEscopo.selecionarVarios(lista.filter((t) => t.disponivel && passaNoFiltro(t)).map((t) => t.comando)));
    const limparSelecao = document.createElement('button');
    limparSelecao.type = 'button'; limparSelecao.id = 'limpar-selecao'; limparSelecao.className = 'ligacao';
    limparSelecao.textContent = 'Limpar seleção';
    limparSelecao.addEventListener('click', () => window.jurEscopo.limpar());
    elLimpar = document.createElement('button');
    elLimpar.type = 'button'; elLimpar.id = 'limpar-filtros'; elLimpar.className = 'ligacao';
    elLimpar.textContent = 'Limpar filtros';
    elLimpar.addEventListener('click', () => { filtros.area.clear(); filtros.uf.clear(); redesenhar(); });
    acoes.append(selecionarVisiveis, limparSelecao, elLimpar);
    elBarraFiltros.appendChild(acoes);
    alvo.appendChild(elBarraFiltros);

    elGrade = document.createElement('div'); elGrade.className = 'grade-tribunais';
    for (const t of lista) elGrade.appendChild(montarChipTribunal(t));
    alvo.appendChild(elGrade);

    const dica = document.createElement('p'); dica.className = 'vazio';
    dica.textContent = 'Clique na sigla para incluir ou tirar da busca. O ⓘ abre a ficha com o que funciona em cada tribunal. Filtros só mudam o que aparece aqui; o escopo é o que está em "Buscar em".';
    alvo.appendChild(dica);

    redesenhar();
  }

  montarPrompts();
  document.addEventListener('jur:tribunais', montarDisponibilidade);
  document.addEventListener('jur:escopo', redesenhar);
  montarManual();

  // A ficha nunca mostra a nota tecnica do catalogo (t.nota): o usuario le o resumo em
  // portugues e a nota POR FUNCIONALIDADE, que e escrita para ele.
  const ROTULO_FUNC = {
    termo: 'Busca por termo',
    periodoJulgamento: 'Período de julgamento',
    periodoPublicacao: 'Período de publicação',
    magistrado: 'Magistrado',
    juizados: 'Juizados / Turmas Recursais',
    inteiroTeor: 'Inteiro teor',
    numero: 'Consulta por número',
  };
  const CHAVES_FUNC = Object.keys(ROTULO_FUNC);
  const BADGE = {
    funciona: ['✓', 'Funciona', 'ok'],
    ressalva: ['!', 'Com ressalva', 'ressalva'],
    'nao-funciona': ['✕', 'Não funciona', 'erro'],
    'nao-existe': ['—', 'Não existe neste tribunal', 'neutro'],
  };

  function badge(estado, classeExtra = '') {
    const [sinal, rotulo, cor] = BADGE[estado] || BADGE['nao-existe'];
    const s = document.createElement('span');
    s.className = `badge ${cor} ${classeExtra}`.trim();
    s.dataset.estado = estado;
    s.textContent = `${sinal} ${rotulo}`;
    return s;
  }

  window.jurFicha = {
    abrir(comando) {
      const t = tribunais().find((x) => x.comando === comando);
      if (!t) return;
      const painel = $('#painel-ficha');
      window.jurUI.abrirPainel(painel, '');
      const caixa = $('.painel-caixa', painel);
      caixa.classList.add('ficha');

      const h = document.createElement('h2');
      const code = document.createElement('code'); code.textContent = t.comando;
      const estado = document.createElement('span');
      estado.className = `badge badge-estado ${COR[estadoVisual(t)] || 'neutro'}`;
      estado.textContent = `● ${ROTULO_BADGE[estadoVisual(t)] || t.estado}`;
      h.append(code, estado);
      const nome = document.createElement('p');
      nome.className = 'ficha-nome';
      nome.textContent = `${t.nome}${t.uf?.length ? ` · ${t.uf.join(', ')}` : ' · nacional'}`;
      const resumo = document.createElement('p');
      resumo.className = `ficha-resumo ${COR[estadoVisual(t)] || 'neutro'}`;
      resumo.textContent = t.resumo || '';

      const tabela = document.createElement('table');
      tabela.className = 'tab-cap';
      tabela.innerHTML = '<thead><tr><th>Funcionalidade</th><th>Estado</th></tr></thead><tbody></tbody>';
      const corpo = $('tbody', tabela);
      for (const chave of CHAVES_FUNC) {
        const f = (t.capacidades && t.capacidades[chave]) || { estado: 'nao-existe', nota: '' };
        const tr = document.createElement('tr');
        tr.dataset.chave = chave;
        const td1 = document.createElement('td');
        td1.textContent = ROTULO_FUNC[chave];
        if (f.nota) { const small = document.createElement('small'); small.textContent = f.nota; td1.appendChild(small); }
        const td2 = document.createElement('td');
        td2.appendChild(badge(f.estado));
        tr.append(td1, td2);
        corpo.appendChild(tr);
      }

      const acoes = document.createElement('div');
      acoes.className = 'ficha-acoes';
      const incluir = document.createElement('button');
      incluir.type = 'button'; incluir.className = 'botao-acento ficha-incluir';
      incluir.textContent = selecionado(t.comando) ? 'Já está na busca' : 'Incluir na busca';
      incluir.disabled = !t.disponivel || selecionado(t.comando);
      incluir.addEventListener('click', () => { window.jurEscopo.selecionar(t.comando); painel.hidden = true; });
      const fechar = document.createElement('button');
      fechar.type = 'button'; fechar.className = 'botao-secundario ficha-fechar';
      fechar.textContent = 'Fechar';
      fechar.addEventListener('click', () => { painel.hidden = true; });
      acoes.append(incluir, fechar);
      // So o STJ tem tentativa assistida (servidor/navegadores/registro.js). O botao leva ao
      // painel Navegadores, onde a opcao de captcha manual mora.
      if (t.comando === 'stj' && !t.assistido) {
        const captcha = document.createElement('button');
        captcha.type = 'button'; captcha.className = 'botao-secundario ficha-captcha';
        captcha.textContent = 'Tentar com CAPTCHA manual';
        captcha.addEventListener('click', () => {
          painel.hidden = true;
          const abrir = $('#navegadores-abrir');
          if (abrir && abrir.getAttribute('aria-expanded') !== 'true') abrir.click();
          $('#navegadores-captcha')?.focus();
        });
        acoes.appendChild(captcha);
      }

      caixa.append(h, nome, resumo, tabela, acoes);
    },
  };
}());
