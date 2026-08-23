const { json, lerCorpo, sse } = require('../http');

function registrar(roteador, deps) {
  const repo = deps.conversas;
  if (!repo) return;

  roteador.rota('POST', '/api/v1/conversas', async (req, res) => {
    try { await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    json(res, 201, repo.criar());
  });

  roteador.rota('GET', '/api/v1/conversas', (req, res) => {
    // `emAndamento` e o que acende o icone de "respondendo" na lateral. Sem ele, uma
    // conversa cujo turno continua rodando (agora que ele sobrevive ao cliente ir
    // embora) e indistinguivel de uma conversa parada: o usuario reabre, ve a propria
    // pergunta e conclui que morreu.
    const lista = repo.listar(Number(req.query.limite) || 100).map((c) => ({
      ...c,
      emAndamento: Boolean(deps.turnos && deps.turnos.emAndamento(c.id)),
    }));
    json(res, 200, { conversas: lista });
  });

  /**
   * Reconecta ao turno em andamento de uma conversa. Reproduz o que ja chegou e segue
   * ao vivo — e o que faz reabrir a conversa no meio mostrar a resposta se formando em
   * vez de uma tela parada ate o fim.
   *
   * Turno ja encerrado nao reproduz nada: manda `encerrado` e fecha. As mensagens dele
   * estao no banco, e reproduzir o buffer por cima do que o cliente carregou de
   * GET /conversas/:id mostraria o mesmo turno duas vezes.
   */
  roteador.rota('GET', '/api/v1/conversas/:id/stream', (req, res) => {
    if (!repo.obter(req.params.id)) return json(res, 404, { erro: 'conversa nao encontrada' });

    const canal = sse(res);
    const desanexar = deps.turnos && deps.turnos.anexar(
      req.params.id,
      (nome, dados) => canal.enviar(nome, dados),
      () => canal.fechar(),
    );
    if (!desanexar) {
      // Sem este aviso o cliente fica com a conexao aberta esperando um turno que nao
      // existe (ou que acabou de terminar) ate o timeout do browser.
      canal.enviar('encerrado', { motivo: 'nao ha turno em andamento nesta conversa' });
      return canal.fechar();
    }
    res.on('close', desanexar);
    return undefined;
  });

  roteador.rota('GET', '/api/v1/conversas/:id', (req, res) => {
    // obter() busca direto por PK — nao varre nem fica cego para uma conversa fora
    // das N mais recentes, ao contrario de listar(N).find(...).
    const conversa = repo.obter(req.params.id);
    if (!conversa) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { ...conversa, mensagens: repo.mensagens(req.params.id) });
  });

  roteador.rota('DELETE', '/api/v1/conversas/:id', (req, res) => {
    if (!repo.apagar(req.params.id)) return json(res, 404, { erro: 'conversa nao encontrada' });
    json(res, 200, { id: req.params.id, apagada: true });
  });
}

module.exports = { registrar };
