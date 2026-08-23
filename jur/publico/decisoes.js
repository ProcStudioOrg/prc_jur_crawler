// jur/publico/decisoes.js
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);

  /**
   * Painel das decisoes que a conversa leu de verdade.
   *
   * Antes, os julgados so existiam dentro da resposta do modelo — resumidos, e sem
   * como conferir o que ficou de fora do resumo. Aqui estao as buscas que a conversa
   * disparou e, dentro de cada uma, os julgados como vieram do tribunal.
   *
   * A fonte e GET /api/v1/conversas/{id}/buscas (o vinculo, gravado assim que a busca e
   * despachada) + GET /api/v1/buscas/{jobId}/resultados (os julgados, que ja existia).
   */

  const POR_PAGINA = 20;

  const painel = $('#decisoes');
  const fundo = $('#fundo-decisoes');
  const botao = $('#abrir-decisoes');

  let conversa = null;   // conversa aberta agora
  let buscas = [];       // as buscas dela
  let aberta = null;     // a busca escolhida dentro do painel

  const ROTULO_STATUS = {
    enfileirado: 'na fila',
    rodando: 'buscando…',
    concluido: 'concluída',
    erro: 'falhou',
    cancelado: 'cancelada',
    expirado: 'expirou',
  };

  // ---------- estado do painel ----------

  function fechar() {
    painel.hidden = true;
    fundo.hidden = true;
    document.body.classList.remove('com-decisoes');
    botao.setAttribute('aria-expanded', 'false');
  }

  function abrir() {
    painel.hidden = false;
    fundo.hidden = false;
    // A classe no body e o que empurra o centro em tela larga; em tela estreita o CSS
    // ignora e o painel sobrepoe.
    document.body.classList.add('com-decisoes');
    botao.setAttribute('aria-expanded', 'true');
    aberta = null;
    desenhar();
  }

  botao.addEventListener('click', () => (painel.hidden ? abrir() : fechar()));
  fundo.addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !painel.hidden) fechar(); });

  // ---------- carregar ----------

  /**
   * app.js chama isto ao abrir/trocar/atualizar uma conversa. `conversaId` null (tela
   * inicial) esconde o botao e fecha o painel: as buscas da conversa anterior nao podem
   * continuar na tela como se fossem desta.
   */
  async function sincronizar(conversaId) {
    if (conversa !== conversaId) { aberta = null; fechar(); }
    conversa = conversaId;
    if (!conversaId) { buscas = []; botao.hidden = true; return; }
    try {
      buscas = (await window.jurApi.pedir(`/api/v1/conversas/${conversaId}/buscas`)).buscas;
    } catch { buscas = []; }
    // Botao so quando ha o que ver: um botao que abre painel vazio ensina o usuario a
    // ignora-lo.
    botao.hidden = !buscas.length;
    botao.textContent = `Decisões · ${buscas.length}`;
    botao.title = 'Ver os julgados que esta conversa consultou';
    if (!painel.hidden) desenhar();
  }

  // ---------- desenho ----------

  function cabecalho(titulo, comVoltar) {
    const topo = document.createElement('header');
    topo.className = 'decisoes-topo';
    if (comVoltar) {
      const voltar = document.createElement('button');
      voltar.type = 'button';
      voltar.id = 'decisoes-voltar';
      voltar.className = 'icone';
      voltar.textContent = '←';
      voltar.setAttribute('aria-label', 'Voltar para a lista de buscas');
      voltar.addEventListener('click', () => { aberta = null; desenhar(); });
      topo.appendChild(voltar);
    }
    const h = document.createElement('h2');
    h.textContent = titulo;
    topo.appendChild(h);
    const fecharBtn = document.createElement('button');
    fecharBtn.type = 'button';
    fecharBtn.className = 'fechar';
    fecharBtn.textContent = '×';
    fecharBtn.setAttribute('aria-label', 'Fechar');
    fecharBtn.addEventListener('click', fechar);
    topo.appendChild(fecharBtn);
    return topo;
  }

  function desenhar() {
    painel.innerHTML = '';
    if (aberta) return desenharJulgados(aberta);
    return desenharBuscas();
  }

  function desenharBuscas() {
    painel.appendChild(cabecalho('Decisões consultadas', false));
    const corpo = document.createElement('div');
    corpo.className = 'decisoes-corpo';

    if (!buscas.length) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = 'Esta conversa ainda não consultou nenhum tribunal.';
      corpo.appendChild(p);
      painel.appendChild(corpo);
      return;
    }

    for (const b of buscas) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'busca-item';
      item.dataset.status = b.status;

      const linha = document.createElement('div');
      linha.className = 'busca-linha';
      const sigla = document.createElement('strong');
      sigla.className = 'busca-sigla';
      sigla.textContent = b.comando;
      linha.appendChild(sigla);
      const total = document.createElement('span');
      total.className = 'busca-total';
      // Status antes de total: um job que ainda roda tem total 0, e mostrar "0" sozinho
      // ali seria a mesma confusao que o repo inteiro evita — parece busca vazia.
      total.textContent = b.status === 'concluido'
        ? `${b.total} ${b.total === 1 ? 'julgado' : 'julgados'}`
        : (ROTULO_STATUS[b.status] || b.status);
      linha.appendChild(total);
      item.appendChild(linha);

      const query = document.createElement('span');
      query.className = 'busca-query';
      query.textContent = (b.params && b.params.query) || '(sem termo)';
      item.appendChild(query);

      if (b.erroLeitura) {
        const aviso = document.createElement('span');
        aviso.className = 'busca-aviso';
        aviso.textContent = `Resultados ilegíveis: ${b.erroLeitura}`;
        item.appendChild(aviso);
      }

      item.addEventListener('click', () => { aberta = b; desenhar(); });
      corpo.appendChild(item);
    }
    painel.appendChild(corpo);
  }

  async function desenharJulgados(b) {
    painel.appendChild(cabecalho(`${b.comando} · ${(b.params && b.params.query) || ''}`, true));
    const corpo = document.createElement('div');
    corpo.className = 'decisoes-corpo';
    painel.appendChild(corpo);

    if (b.status !== 'concluido') {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = `Esta busca está "${ROTULO_STATUS[b.status] || b.status}". `
        + (b.erro ? `Motivo: ${b.erro}` : 'Ainda não há julgados para mostrar.');
      corpo.appendChild(p);
      return;
    }

    const carregando = document.createElement('p');
    carregando.className = 'vazio';
    carregando.textContent = 'Carregando julgados…';
    corpo.appendChild(carregando);

    let dados;
    try {
      dados = await window.jurApi.pedir(`/api/v1/buscas/${b.id}/resultados?offset=0&limite=${POR_PAGINA}`);
    } catch (e) {
      carregando.textContent = `Não foi possível ler os resultados: ${e.message}`;
      return;
    }
    // Trocou de tela enquanto carregava.
    if (aberta !== b || painel.hidden) return;
    corpo.removeChild(carregando);

    if (dados.erro) {
      const p = document.createElement('p');
      p.className = 'decisoes-erro';
      p.textContent = `FALHA AO LER os resultados: ${dados.erro}. `
        + 'Isto NÃO é uma busca vazia — os julgados existiram e não estão mais legíveis no disco.';
      corpo.appendChild(p);
      return;
    }

    if (!dados.itens.length) {
      // O invariante do repo, nesta tela: zero NAO e "nao existe jurisprudencia". Um
      // painel que so dissesse "nenhum julgado" seria mais uma superficie afirmando o
      // que o resto do sistema recusa afirmar.
      const p = document.createElement('div');
      p.className = 'decisoes-vazio';
      const t = document.createElement('p');
      t.textContent = `Esta busca voltou com 0 resultados em ${b.comando}.`;
      const r = document.createElement('p');
      r.textContent = 'Zero aqui não significa que não existe jurisprudência sobre o tema: '
        + 'pode ser recorte do acervo, limitação do motor de busca do tribunal ou os termos usados. '
        + 'Abra a ressalva do tribunal na Disponibilidade antes de concluir qualquer coisa.';
      p.appendChild(t); p.appendChild(r);
      corpo.appendChild(p);
      return;
    }

    const contagem = document.createElement('p');
    contagem.className = 'vazio';
    contagem.textContent = `Mostrando ${dados.itens.length} de ${dados.total}.`;
    corpo.appendChild(contagem);

    let mostrados = dados.itens.length;
    for (const item of dados.itens) corpo.appendChild(montarJulgado(item));

    if (mostrados < dados.total) {
      const mais = document.createElement('button');
      mais.type = 'button';
      mais.className = 'ligacao decisoes-mais';
      mais.textContent = `Carregar mais ${Math.min(POR_PAGINA, dados.total - mostrados)}`;
      mais.addEventListener('click', async () => {
        mais.disabled = true;
        try {
          const proxima = await window.jurApi.pedir(
            `/api/v1/buscas/${b.id}/resultados?offset=${mostrados}&limite=${POR_PAGINA}`,
          );
          if (aberta !== b) return;
          for (const item of proxima.itens) corpo.insertBefore(montarJulgado(item), mais);
          mostrados += proxima.itens.length;
          contagem.textContent = `Mostrando ${mostrados} de ${proxima.total}.`;
          if (mostrados >= proxima.total) mais.remove();
          else mais.textContent = `Carregar mais ${Math.min(POR_PAGINA, proxima.total - mostrados)}`;
        } catch (e) {
          mais.textContent = `Falhou: ${e.message}`;
        } finally {
          mais.disabled = false;
        }
      });
      corpo.appendChild(mais);
    }
  }

  /**
   * Os campos variam MUITO por tribunal (cada crawler devolve o que o portal dá), entao
   * o cartao mostra os que reconhece e joga o resto num <details>. Escolher um formato
   * fixo esconderia justamente o campo que so aquele tribunal tem.
   */
  const CAMPOS_CABECALHO = ['processo', 'numeroProcesso', 'numero'];
  const CAMPOS_META = ['relator', 'orgaoJulgador', 'dataJulgamento', 'dataPublicacao', 'classe', 'tipoDocumento'];
  const CAMPOS_TEXTO = ['ementa', 'texto', 'inteiroTeor', 'trechoMatch'];
  const CAMPOS_LINK = ['inteiroTeorLink', 'processoUrl', 'permalink', 'url'];

  function montarJulgado(item) {
    const cartao = document.createElement('article');
    cartao.className = 'julgado';

    const numero = CAMPOS_CABECALHO.map((c) => item[c]).find(Boolean);
    if (numero) {
      const h = document.createElement('h3');
      h.textContent = String(numero);
      cartao.appendChild(h);
    }

    const meta = CAMPOS_META.filter((c) => item[c]).map((c) => `${item[c]}`);
    if (meta.length) {
      const p = document.createElement('p');
      p.className = 'julgado-meta';
      p.textContent = meta.join(' · ');
      cartao.appendChild(p);
    }

    const texto = CAMPOS_TEXTO.map((c) => item[c]).find(Boolean);
    if (texto) {
      const p = document.createElement('p');
      p.className = 'julgado-texto';
      p.textContent = String(texto);
      cartao.appendChild(p);
    }

    for (const campo of CAMPOS_LINK) {
      const href = window.jurMarkdown && window.jurMarkdown.urlSegura(item[campo]);
      if (!href) continue;
      const a = document.createElement('a');
      a.className = 'julgado-link';
      a.textContent = 'Abrir no tribunal';
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      cartao.appendChild(a);
      break;
    }

    // O julgado cru, para quem precisa do campo que este cartao nao conhece.
    const bruto = document.createElement('details');
    bruto.className = 'julgado-bruto';
    const resumo = document.createElement('summary');
    resumo.textContent = 'Campos completos';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(item, null, 2);
    bruto.appendChild(resumo); bruto.appendChild(pre);
    cartao.appendChild(bruto);

    return cartao;
  }

  window.jurDecisoes = { sincronizar };
}());
