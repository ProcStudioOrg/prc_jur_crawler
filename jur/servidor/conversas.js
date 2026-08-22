const crypto = require('node:crypto');

const TITULO_MAX = 60;

/**
 * Corta por CODE POINT, nao por unidade UTF-16. `String.prototype.slice` corta por
 * unidade UTF-16 — para qualquer caractere fora do BMP (a maioria dos emoji, entre
 * outros) isso pode partir um par substituto ao meio, e o resultado grava um
 * U+FFFD (replacement character) no banco: corrupcao de dado, nao so de exibicao.
 * `Array.from` itera por code point (usa o iterador de string do JS), entao cortar
 * o array resultante nunca parte um par.
 */
function truncarPorCodePoint(texto, max) {
  const pontos = Array.from(texto);
  if (pontos.length <= max) return texto;
  return `${pontos.slice(0, max - 1).join('')}…`;
}

function criarRepositorio(con) {
  function criar(titulo = null) {
    const id = crypto.randomUUID();
    const agora = Date.now();
    con.prepare('INSERT INTO conversa (id, titulo, criado_em, atualizado_em) VALUES (?,?,?,?)')
      .run(id, titulo, agora, agora);
    return { id, titulo, criadoEm: agora };
  }

  function linhaParaConversa(l) {
    return { id: l.id, titulo: l.titulo, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em };
  }

  function listar(limite = 100) {
    return con.prepare(`SELECT id, titulo, criado_em, atualizado_em FROM conversa
                        ORDER BY atualizado_em DESC LIMIT ?`).all(limite)
      .map(linhaParaConversa);
  }

  /**
   * Busca direta por chave primaria — ao contrario de `listar(...).find(...)`, nao
   * varre N linhas nem fica cega para uma conversa fora do topo N mais recente.
   * Usada tanto pela rota GET /api/v1/conversas/:id quanto por chat.js, para
   * confirmar que a conversa existe ANTES de gravar uma mensagem nela (a FK barraria
   * a escrita de qualquer forma, mas so depois de um INSERT que falha com erro cru
   * do SQLite).
   */
  function obter(id) {
    const l = con.prepare('SELECT id, titulo, criado_em, atualizado_em FROM conversa WHERE id = ?').get(id);
    return l ? linhaParaConversa(l) : null;
  }

  /**
   * `conteudo` pode ser string (texto simples) ou array de blocos da Messages API.
   * Guardamos SEMPRE serializado com uma marca de forma, para os blocos tool_use e
   * tool_result voltarem intactos — sem eles o modelo perde os job_id no turno seguinte.
   *
   * `job_id` (coluna de `mensagem`) fica sempre NULL aqui, de proposito: popular o
   * valor real exigiria fazer o `tool_use.id` de cada chamada atravessar
   * `ferramentas.executar`, cujo contrato hoje devolve SO uma string e nunca lanca
   * (documentado assim em servidor/ferramentas.js) — mudar isso e cirurgia em
   * ferramentas.js/llm.js, fora do escopo de persistencia de conversa. O job_id de
   * cada busca ja aparece no TEXTO do tool_result ("job <id>: N resultados"), que e
   * onde o modelo le hoje; a coluna fica reservada para quando essa plumbing existir.
   */
  function acrescentar(conversaId, papel, conteudo) {
    const bruto = JSON.stringify({ forma: typeof conteudo === 'string' ? 'texto' : 'blocos', valor: conteudo });
    const agora = Date.now();
    con.prepare(`INSERT INTO mensagem (conversa_id, papel, conteudo, job_id, criado_em)
                 VALUES (?,?,?,?,?)`).run(conversaId, papel, bruto, null, agora);
    con.prepare('UPDATE conversa SET atualizado_em = ? WHERE id = ?').run(agora, conversaId);
  }

  function mensagens(id) {
    return con.prepare('SELECT papel, conteudo FROM mensagem WHERE conversa_id = ? ORDER BY id ASC')
      .all(id)
      .map((l) => {
        let conteudo;
        try {
          const envelope = JSON.parse(l.conteudo);
          conteudo = envelope && 'valor' in envelope ? envelope.valor : l.conteudo;
        } catch {
          conteudo = l.conteudo;
        }
        return { papel: l.papel, conteudo };
      });
  }

  function renomearSePrimeira(conversaId, texto) {
    const atual = con.prepare('SELECT titulo FROM conversa WHERE id = ?').get(conversaId);
    if (!atual || atual.titulo) return;
    const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return;
    const titulo = truncarPorCodePoint(limpo, TITULO_MAX);
    con.prepare('UPDATE conversa SET titulo = ? WHERE id = ?').run(titulo, conversaId);
  }

  function apagar(id) {
    con.prepare('DELETE FROM mensagem WHERE conversa_id = ?').run(id);
    return con.prepare('DELETE FROM conversa WHERE id = ?').run(id).changes > 0;
  }

  return { criar, listar, obter, mensagens, acrescentar, renomearSePrimeira, apagar };
}

module.exports = { criarRepositorio, TITULO_MAX, truncarPorCodePoint };
