const crypto = require('node:crypto');

const TITULO_MAX = 60;

function criarRepositorio(con) {
  function criar(titulo = null) {
    const id = crypto.randomUUID();
    const agora = Date.now();
    con.prepare('INSERT INTO conversa (id, titulo, criado_em, atualizado_em) VALUES (?,?,?,?)')
      .run(id, titulo, agora, agora);
    return { id, titulo, criadoEm: agora };
  }

  function listar(limite = 100) {
    return con.prepare(`SELECT id, titulo, criado_em, atualizado_em FROM conversa
                        ORDER BY atualizado_em DESC LIMIT ?`).all(limite)
      .map((l) => ({ id: l.id, titulo: l.titulo, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em }));
  }

  /**
   * `conteudo` pode ser string (texto simples) ou array de blocos da Messages API.
   * Guardamos SEMPRE serializado com uma marca de forma, para os blocos tool_use e
   * tool_result voltarem intactos — sem eles o modelo perde os job_id no turno seguinte.
   */
  function acrescentar(conversaId, papel, conteudo, jobId = null) {
    const bruto = JSON.stringify({ forma: typeof conteudo === 'string' ? 'texto' : 'blocos', valor: conteudo });
    const agora = Date.now();
    con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, job_id, criado_em)
                 VALUES (?,?,?,?,?)`).run(conversaId, papel, bruto, jobId, agora);
    con.prepare('UPDATE conversa SET atualizado_em = ? WHERE id = ?').run(agora, conversaId);
  }

  function mensagens(id) {
    return con.prepare('SELECT papel, conteudo, job_id FROM mensagem WHERE conversa_id = ? ORDER BY id ASC')
      .all(id)
      .map((l) => {
        let conteudo;
        try {
          const envelope = JSON.parse(l.conteudo);
          conteudo = envelope && 'valor' in envelope ? envelope.valor : l.conteudo;
        } catch {
          conteudo = l.conteudo;
        }
        return { papel: l.papel, conteudo, jobId: l.job_id };
      });
  }

  function renomearSePrimeira(conversaId, texto) {
    const atual = con.prepare('SELECT titulo FROM conversa WHERE id = ?').get(conversaId);
    if (!atual || atual.titulo) return;
    const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return;
    const titulo = limpo.length > TITULO_MAX ? `${limpo.slice(0, TITULO_MAX - 1)}…` : limpo;
    con.prepare('UPDATE conversa SET titulo = ? WHERE id = ?').run(titulo, conversaId);
  }

  function apagar(id) {
    con.prepare('DELETE FROM mensagem WHERE conversa_id = ?').run(id);
    return con.prepare('DELETE FROM conversa WHERE id = ?').run(id).changes > 0;
  }

  return { criar, listar, mensagens, acrescentar, renomearSePrimeira, apagar };
}

module.exports = { criarRepositorio, TITULO_MAX };
