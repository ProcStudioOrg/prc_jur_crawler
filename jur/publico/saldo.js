// jur/publico/saldo.js
// Saldo de IA do time no ProcStudio, que paga a conexão ProcStudio do chat. A pílula do topo
// mostra o que o servidor devolveu em GET /api/v1/saldo e nada além: `disponivel: false`
// (sem conexão gerenciada) a esconde, e uma falha vira "indisponível" — nunca um saldo inventado.
(function () {
  const RECARGA_MS = 2 * 60 * 1000;
  const SALDO_BAIXO_BRL = 1;
  let dados = null;
  let geracao = 0;
  let relogio = null;
  let pilula = null;

  /** "R$ 1.234,56" / "R$ −0,52" (sinal de menos tipográfico, como no ProcStudio e no servidor). */
  function formatarBrl(valor) {
    const absoluto = Math.abs(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R$ ${valor < 0 ? '−' : ''}${absoluto}`;
  }

  /** A página de uso de IA do ProcStudio, no mesmo endereço que o servidor deu para a recarga. */
  function urlUso(topupUrl) {
    return topupUrl ? new URL('/ia-uso', topupUrl).href : null;
  }

  function desenhar() {
    if (!pilula) return;
    pilula.className = '';
    if (!dados || !dados.disponivel) {
      pilula.hidden = true;
      pilula.replaceChildren();
      return;
    }
    let texto;
    let titulo;
    if (dados.erro) {
      texto = 'Saldo IA indisponível';
      titulo = dados.erro;
      pilula.classList.add('saldo-erro');
    } else if (!dados.podeOperar) {
      texto = 'Sem saldo';
      titulo = `${dados.mensagem || 'Saldo de IA do time esgotado.'} (${formatarBrl(dados.saldoBrl)})`;
      pilula.classList.add('saldo-zerado');
    } else {
      texto = `Saldo IA · ${formatarBrl(dados.saldoBrl)}`;
      titulo = 'Saldo de IA do seu time no ProcStudio';
      if (dados.saldoBrl < SALDO_BAIXO_BRL) pilula.classList.add('saldo-baixo');
    }
    const destino = urlUso(dados.topupUrl);
    const alvo = document.createElement(destino ? 'a' : 'span');
    alvo.textContent = texto;
    alvo.title = titulo;
    if (destino) {
      alvo.href = destino;
      alvo.target = '_blank';
      alvo.rel = 'noopener';
    }
    pilula.replaceChildren(alvo);
    pilula.hidden = false;
  }

  function avisar() {
    desenhar();
    document.dispatchEvent(new Event('jur:saldo'));
  }

  /**
   * Busca o saldo e devolve o que a tela passou a mostrar. `forcar` pula o cache de 30 s do
   * servidor — é o que "Tentar de novo" usa logo depois de o time recarregar.
   */
  async function carregar(forcar = false) {
    if (!window.jurSessao?.principal) return null;
    const g = ++geracao;
    let novo;
    try {
      const r = await window.jurApi.requisitar(`/api/v1/saldo${forcar ? '?forcar=1' : ''}`);
      const corpo = await r.json().catch(() => null);
      // 401 do saldo = a conta não vale mais no ProcStudio (ou a sessão acabou): nunca a pílula
      // "indisponível", e sim o login. O 401 com `www-authenticate: Session` já levou ao login em
      // jurApi.requisitar; sem ele, o aviso parte daqui.
      if (r.status === 401) {
        if (!r.headers.get('www-authenticate')?.startsWith('Session'))
          document.dispatchEvent(new CustomEvent('jur:autenticacao-negada', { detail: { tipo: 'sessao_invalida' } }));
        novo = null;
      } else if (r.ok && corpo) novo = corpo;
      // 503 com `disponivel`: a conexão existe, mas o ProcStudio não respondeu o saldo.
      else if (corpo?.disponivel) novo = { disponivel: true, erro: corpo.erro || `HTTP ${r.status}` };
      else novo = null;
    } catch {
      novo = null;
    }
    if (g !== geracao) return dados;
    dados = novo;
    avisar();
    return dados;
  }

  /** Evento `custo` do chat: a rodada cobrada já traz o saldo depois dela. BYOK não traz saldo. */
  function atualizarDe(custo) {
    if (!dados?.disponivel || dados.erro || typeof custo?.saldoBrl !== 'number') return;
    dados = { ...dados, saldoBrl: custo.saldoBrl };
    avisar();
  }

  function parar() {
    clearInterval(relogio);
    relogio = null;
    geracao++;
    dados = null;
    avisar();
  }

  function montar() {
    pilula = document.querySelector('#saldo-ia');
    document.addEventListener('jur:ia', () => carregar());
    document.addEventListener('jur:sair', parar);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') carregar();
    });
    document.addEventListener('jur:sessao', () => {
      clearInterval(relogio);
      relogio = setInterval(() => carregar(), RECARGA_MS);
    });
  }

  window.jurSaldo = {
    carregar, atualizarDe, montar, formatarBrl,
    get dados() { return dados; },
  };
  montar();
})();
