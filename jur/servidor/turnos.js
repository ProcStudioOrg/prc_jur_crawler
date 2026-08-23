// jur/servidor/turnos.js

/**
 * Registro dos turnos de chat VIVOS, por conversa.
 *
 * Por que existe: um turno de chat estava amarrado a conexao HTTP que o pediu. O
 * `res.on('close')` de rotas/chat.js abortava a chamada da Anthropic e cancelava as
 * buscas daquela conversa, entao fechar o navegador (ou so trocar de aba por tempo
 * demais) matava a conversa no meio — e o usuario voltava para uma conversa que tinha
 * so a propria pergunta gravada, sem nem um sinal de que algo tinha sido interrompido.
 * Buscas de jurisprudencia levam minutos; e o caso NORMAL o usuario ir fazer outra
 * coisa enquanto rodam.
 *
 * O que este modulo faz: guarda os eventos do turno enquanto ele roda, deixa N clientes
 * anexarem e desanexarem sem afetar o turno, e diz quais conversas estao em andamento
 * (e o que acende o icone na lateral).
 *
 * CUSTO EXPLICITO: o turno agora continua gastando a chave da Anthropic depois que o
 * cliente foi embora. E uma troca deliberada — a chave e do proprio usuario, e perder o
 * trabalho de uma busca de minutos custa mais que terminar a chamada. Um turno tem teto
 * de passos (MAX_ITERACOES em llm.js), entao nao roda indefinidamente.
 *
 * SO MEMORIA, de proposito: reiniciar o servidor mata o turno, como a fila de jobs ja
 * faz ('interrompido por reinicio do servidor'). Retomar uma chamada da Anthropic pela
 * metade nao e possivel; persistir o estado do turno mudaria a mensagem, nao o desfecho.
 */
function criarRegistro() {
  const vivos = new Map(); // conversaId -> turno

  function emAndamento(conversaId) {
    return vivos.has(conversaId);
  }

  function conversasEmAndamento() {
    return [...vivos.keys()];
  }

  /**
   * Roda `tarefa(emitir)` como o turno da conversa. Rejeita se ja houver um turno vivo
   * ali: dois turnos concorrentes na mesma conversa gravariam mensagens intercaladas, e
   * o historico que volta para o modelo no turno seguinte sairia fora de ordem.
   */
  function executar(conversaId, tarefa) {
    if (vivos.has(conversaId)) {
      return Promise.reject(new Error(`ja ha um turno em andamento nesta conversa (${conversaId})`));
    }

    const turno = { eventos: [], ouvintes: new Set(), iniciadoEm: Date.now() };
    vivos.set(conversaId, turno);

    function emitir(nome, dados) {
      turno.eventos.push({ nome, dados });
      for (const o of [...turno.ouvintes]) {
        // Um SSE que caiu no meio da escrita nao pode derrubar o turno nem os outros
        // ouvintes: e justamente o cliente que foi embora que este modulo existe para
        // tolerar.
        try { o.aoEvento(nome, dados); } catch { /* ouvinte quebrado */ }
      }
    }

    // async imediata para o `finally` valer tanto para o retorno quanto para o throw,
    // e para o registro sair de `vivos` ANTES de a promise resolver — quem esperar por
    // ela ja ve `emAndamento() === false`.
    return (async () => {
      try {
        return await tarefa(emitir);
      } finally {
        vivos.delete(conversaId);
        for (const o of [...turno.ouvintes]) {
          try { if (o.aoFim) o.aoFim(); } catch { /* ouvinte quebrado */ }
        }
        turno.ouvintes.clear();
      }
    })();
  }

  /**
   * Anexa um ouvinte ao turno vivo de uma conversa. Reproduz na hora tudo o que ja
   * passou (senao quem reabre a conversa no meio ve a resposta comecando do nada) e
   * devolve a funcao de desanexar.
   *
   * Devolve `null` quando NAO ha turno vivo — inclusive para um turno que acabou de
   * terminar. Isso e deliberado: as mensagens do turno encerrado ja estao no banco, e
   * reproduzir o buffer por cima do que o cliente carregou de GET /conversas/:id
   * mostraria o mesmo turno duas vezes.
   */
  function anexar(conversaId, aoEvento, aoFim) {
    const turno = vivos.get(conversaId);
    if (!turno) return null;
    for (const e of turno.eventos) aoEvento(e.nome, e.dados);
    const ouvinte = { aoEvento, aoFim };
    turno.ouvintes.add(ouvinte);
    return () => turno.ouvintes.delete(ouvinte);
  }

  return { emAndamento, conversasEmAndamento, executar, anexar };
}

module.exports = { criarRegistro };
