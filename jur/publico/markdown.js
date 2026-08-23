// jur/publico/markdown.js
(function () {
  /**
   * Markdown -> DOM, para a resposta do assistente.
   *
   * O que a interface fazia antes: `bolha()` escrevia com textContent, entao "## 4.
   * Metragem" e "**Fracao inferior a 250 m2**" apareciam com cerquilha e asterisco a
   * mostra. Numa analise de jurisprudencia — que e quase toda titulo, lista e negrito —
   * isso e a maior parte do texto na tela.
   *
   * REGRA INEGOCIAVEL DESTE ARQUIVO: nada aqui usa innerHTML, insertAdjacentHTML nem
   * atribui `srcdoc`/`on*`. Todo texto entra por `textContent` e todo elemento nasce de
   * `createElement`. O conteudo vem do modelo repassando texto de tribunal — uma ementa
   * pode conter literalmente qualquer coisa —, e esta forma de escrever torna impossivel
   * que ela vire HTML executavel. Nao e uma sanitizacao que pode estar mal configurada:
   * e a ausencia de qualquer caminho de HTML. Se um dia alguem precisar de innerHTML
   * aqui, o certo e nao precisar.
   *
   * Escopo: o que o modelo de fato emite. Titulos, negrito, italico, codigo (inline e em
   * bloco), listas (inclusive aninhadas), citacao, regua, links e tabelas. Nao e
   * CommonMark completo, e nao pretende ser.
   */

  const ESQUEMAS_PERMITIDOS = ['http:', 'https:', 'mailto:'];

  /**
   * So deixa passar http/https/mailto. Um `[clique](javascript:...)` vindo do modelo
   * executaria no clique do usuario; aqui ele nao vira <a>, vira texto.
   */
  function urlSegura(bruta) {
    const valor = String(bruta || '').trim();
    if (!valor) return null;
    let u;
    try { u = new URL(valor, window.location.origin); } catch { return null; }
    // Compara o esquema resolvido, nao o prefixo da string: "JaVaScRiPt:" e
    // " javascript:" passariam por uma checagem textual ingenua.
    return ESQUEMAS_PERMITIDOS.includes(u.protocol) ? valor : null;
  }

  // ---------- inline ----------

  // Ordem importa: codigo primeiro (o que esta dentro dele e literal), depois link,
  // depois negrito, depois italico. Todos ancorados numa unica linha logica — um `**`
  // sem par nao pode engolir o resto do documento.
  const REGRAS_INLINE = [
    { re: /`([^`\n]+)`/, monta: (d, m) => { const e = d.createElement('code'); e.textContent = m[1]; return e; } },
    {
      re: /\[([^\]\n]*)\]\(([^)\s]+)\)/,
      monta: (d, m) => {
        const href = urlSegura(m[2]);
        // Sem esquema permitido nao vira link: devolve null e o trecho segue como texto.
        if (!href) return null;
        const a = d.createElement('a');
        a.textContent = m[1];
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        return a;
      },
    },
    { re: /\*\*([^\n]+?)\*\*/, monta: (d, m) => envolver(d, 'strong', m[1]) },
    { re: /__([^\n]+?)__/, monta: (d, m) => envolver(d, 'strong', m[1]) },
    { re: /(?<![*\w])\*([^*\n]+?)\*(?!\*)/, monta: (d, m) => envolver(d, 'em', m[1]) },
    { re: /(?<![_\w])_([^_\n]+?)_(?![_\w])/, monta: (d, m) => envolver(d, 'em', m[1]) },
  ];

  function envolver(d, tag, conteudo) {
    const e = d.createElement(tag);
    aplicarInline(e, conteudo);
    return e;
  }

  /**
   * Preenche `pai` com o texto `linha` ja processado. Recursivo: o conteudo de um
   * negrito passa por aqui de novo, entao `**a *b* c**` funciona.
   */
  function aplicarInline(pai, linha) {
    const d = pai.ownerDocument || document;
    let resto = String(linha);

    while (resto) {
      // Acha a regra que casa MAIS CEDO — nao a primeira da lista que casa em qualquer
      // posicao, senao um `**negrito**` no comeco perderia para um `código` no fim.
      let melhor = null;
      for (const regra of REGRAS_INLINE) {
        const m = regra.re.exec(resto);
        if (!m) continue;
        if (!melhor || m.index < melhor.m.index) melhor = { regra, m };
      }
      if (!melhor) break;

      const { regra, m } = melhor;
      const no = regra.monta(d, m);
      if (!no) {
        // A regra casou mas recusou (link com esquema proibido). Emite o trecho como
        // texto e segue DEPOIS dele, senao o laco reencontraria o mesmo casamento para
        // sempre.
        pai.appendChild(d.createTextNode(resto.slice(0, m.index + m[0].length)));
        resto = resto.slice(m.index + m[0].length);
        continue;
      }
      if (m.index) pai.appendChild(d.createTextNode(resto.slice(0, m.index)));
      pai.appendChild(no);
      resto = resto.slice(m.index + m[0].length);
    }

    if (resto) pai.appendChild(d.createTextNode(resto));
  }

  // ---------- blocos ----------

  const RE_TITULO = /^(#{1,6})\s+(.*)$/;
  const RE_REGUA = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  const RE_CERCA = /^\s*```/;
  const RE_CITACAO = /^\s*>\s?(.*)$/;
  const RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const RE_SEPARADOR_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  const ehTabela = (linhas, i) =>
    linhas[i].includes('|') && i + 1 < linhas.length && RE_SEPARADOR_TABELA.test(linhas[i + 1]);

  const celulas = (linha) => linha.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  /**
   * Consome os itens de lista a partir de `i` que estejam no nivel `indente` ou mais
   * fundo, monta a <ul>/<ol> e devolve onde parou. A recursao e o que faz o aninhamento
   * por indentacao funcionar.
   */
  function lerLista(d, linhas, i, indente) {
    const primeiro = RE_ITEM.exec(linhas[i]);
    const ordenada = /\d/.test(primeiro[2]);
    const lista = d.createElement(ordenada ? 'ol' : 'ul');

    while (i < linhas.length) {
      const m = RE_ITEM.exec(linhas[i]);
      if (!m || m[1].length < indente) break;
      if (m[1].length > indente) {
        // Mais fundo: pertence ao ULTIMO item, nao a esta lista.
        const alvo = lista.lastElementChild;
        if (!alvo) break;
        const [sub, prox] = lerLista(d, linhas, i, m[1].length);
        alvo.appendChild(sub);
        i = prox;
        continue;
      }
      const li = d.createElement('li');
      aplicarInline(li, m[3]);
      lista.appendChild(li);
      i += 1;
    }
    return [lista, i];
  }

  function renderizar(texto, alvo) {
    // Limpa antes: durante o streaming o mesmo alvo e reparseado a cada delta.
    alvo.textContent = '';
    const d = alvo.ownerDocument || document;
    const linhas = String(texto == null ? '' : texto).split('\n');
    let i = 0;

    while (i < linhas.length) {
      const linha = linhas[i];

      if (!linha.trim()) { i += 1; continue; }

      if (RE_CERCA.test(linha)) {
        const pre = d.createElement('pre');
        const code = d.createElement('code');
        i += 1;
        const corpo = [];
        // Cerca sem fechamento acontece o tempo todo no streaming: o bloco chega pela
        // metade. Renderiza o que veio em vez de sumir com o resto da resposta.
        while (i < linhas.length && !RE_CERCA.test(linhas[i])) { corpo.push(linhas[i]); i += 1; }
        if (i < linhas.length) { corpo.push(''); i += 1; }
        code.textContent = corpo.join('\n');
        pre.appendChild(code);
        alvo.appendChild(pre);
        continue;
      }

      // Regua antes de lista: "---" tambem casa com "- --" para um leitor desatento, e
      // RE_ITEM exige espaco depois do marcador, entao os dois nao colidem de verdade —
      // a ordem aqui e so para deixar isso explicito.
      if (RE_REGUA.test(linha)) { alvo.appendChild(d.createElement('hr')); i += 1; continue; }

      const titulo = RE_TITULO.exec(linha);
      if (titulo) {
        // h1 do modelo vira h2: o <h1> da pagina e o titulo da aplicacao, e uma resposta
        // de chat nao pode competir com ele na arvore de cabecalhos. Teto em h4 para nao
        // gerar nivel que o CSS nao trata.
        const nivel = Math.min(4, Math.max(2, titulo[1].length + 1));
        const h = d.createElement(`h${nivel}`);
        aplicarInline(h, titulo[2]);
        alvo.appendChild(h);
        i += 1;
        continue;
      }

      if (RE_CITACAO.test(linha)) {
        const bq = d.createElement('blockquote');
        const partes = [];
        while (i < linhas.length && RE_CITACAO.test(linhas[i])) {
          partes.push(RE_CITACAO.exec(linhas[i])[1]);
          i += 1;
        }
        aplicarInline(bq, partes.join(' '));
        alvo.appendChild(bq);
        continue;
      }

      if (ehTabela(linhas, i)) {
        const tabela = d.createElement('table');
        const thead = d.createElement('thead');
        const trCabecalho = d.createElement('tr');
        for (const c of celulas(linha)) {
          const th = d.createElement('th');
          aplicarInline(th, c);
          trCabecalho.appendChild(th);
        }
        thead.appendChild(trCabecalho);
        tabela.appendChild(thead);
        i += 2; // pula o separador
        const tbody = d.createElement('tbody');
        while (i < linhas.length && linhas[i].includes('|') && linhas[i].trim()) {
          const tr = d.createElement('tr');
          for (const c of celulas(linhas[i])) {
            const td = d.createElement('td');
            aplicarInline(td, c);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
          i += 1;
        }
        tabela.appendChild(tbody);
        // Tabela larga rola dentro da propria caixa: sem isto ela empurra a coluna de
        // mensagens e a pagina inteira ganha rolagem horizontal.
        const rolagem = d.createElement('div');
        rolagem.className = 'md-tabela';
        rolagem.appendChild(tabela);
        alvo.appendChild(rolagem);
        continue;
      }

      if (RE_ITEM.test(linha)) {
        const [lista, prox] = lerLista(d, linhas, i, RE_ITEM.exec(linha)[1].length);
        alvo.appendChild(lista);
        i = prox;
        continue;
      }

      // Paragrafo: junta as linhas ate a proxima em branco ou o proximo bloco.
      const partes = [];
      while (i < linhas.length && linhas[i].trim()
             && !RE_TITULO.test(linhas[i]) && !RE_REGUA.test(linhas[i])
             && !RE_CERCA.test(linhas[i]) && !RE_CITACAO.test(linhas[i])
             && !RE_ITEM.test(linhas[i]) && !ehTabela(linhas, i)) {
        partes.push(linhas[i]);
        i += 1;
      }
      const p = d.createElement('p');
      aplicarInline(p, partes.join('\n'));
      alvo.appendChild(p);
    }

    return alvo;
  }

  window.jurMarkdown = { renderizar, urlSegura };
}());
