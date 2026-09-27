const { randomUUID } = require('node:crypto');
const erro = (mensagem, status = 409) => Object.assign(new Error(mensagem), { status });

function criarRegistro(con, { browserbase = false } = {}) {
  con.exec('CREATE TABLE IF NOT EXISTS navegador_preferencias (id INTEGER PRIMARY KEY CHECK(id=1), valor TEXT NOT NULL)');
  const sessoes = new Map();
  const provedores = browserbase ? ['local', 'browserbase'] : ['local'];
  function preferencias() {
    const row = con.prepare('SELECT valor FROM navegador_preferencias WHERE id=1').get();
    return row ? JSON.parse(row.valor) : { acompanhar: false, captcha: false, provedor: 'local' };
  }
  function salvar(valor) {
    if (!valor || typeof valor.acompanhar !== 'boolean' || typeof valor.captcha !== 'boolean'
      || !provedores.includes(valor.provedor || 'local')) throw erro('Preferências de navegador inválidas.', 400);
    const p = { acompanhar: valor.acompanhar || valor.captcha, captcha: valor.captcha, provedor: valor.provedor || 'local' };
    con.prepare('INSERT INTO navegador_preferencias VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET valor=excluded.valor').run(JSON.stringify(p));
    return p;
  }
  function registrar(id, comando) {
    const p = preferencias();
    if (!provedores.includes(p.provedor)) throw erro('Provedor de navegador não configurado. Selecione o navegador local.');
    sessoes.set(id, { id, comando, ...p, status: 'enfileirado', pendentes: new Map() });
  }
  function anexar(id, child) {
    const s = sessoes.get(id);
    if (!s) return;
    s.child = child;
    s.status = 'rodando';
    s.ouvir = (m) => {
      if (!m?.jurNavegador) return;
      if (m.requestId) {
        const p = s.pendentes.get(m.requestId);
        if (!p) return;
        clearTimeout(p.timer); s.pendentes.delete(m.requestId);
        if (m.erro) p.reject(erro(String(m.erro).slice(0, 300)));
        else p.resolve(m.dados);
      } else if (m.tipo === 'estado' && ['rodando', 'aguardando_usuario'].includes(m.estado)) {
        s.status = m.estado;
        s.mensagem = typeof m.mensagem === 'string' ? m.mensagem.slice(0, 300) : '';
      }
    };
    child.on('message', s.ouvir);
  }
  function remover(id) {
    const s = sessoes.get(id);
    if (!s) return;
    s.child?.off('message', s.ouvir);
    for (const p of s.pendentes.values()) { clearTimeout(p.timer); p.reject(erro('Navegador encerrado.')); }
    sessoes.delete(id);
  }
  function requisitar(id, tipo, acao) {
    const s = sessoes.get(id);
    if (!s) throw erro('Sessão não encontrada.', 404);
    if (!s.acompanhar) throw erro('Ative o acompanhamento antes de iniciar uma nova busca.');
    if (!s.child?.connected) throw erro('Navegador ainda não disponível.');
    if (tipo === 'acao' && (!s.captcha || s.status !== 'aguardando_usuario')) throw erro('O navegador não está pausado para intervenção.');
    if (s.pendentes.size) throw erro('Aguarde a operação em andamento.', 429);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { s.pendentes.delete(requestId); reject(erro('O navegador não respondeu. Tente novamente.', 504)); }, 10000);
      s.pendentes.set(requestId, { resolve, reject, timer });
      const falhar = () => {
        clearTimeout(timer); s.pendentes.delete(requestId); reject(erro('Navegador desconectado.'));
      };
      try { s.child.send({ jurNavegador: true, requestId, tipo, acao }, (e) => { if (e) falhar(); }); }
      catch { falhar(); }
    });
  }
  return {
    preferencias, salvar, registrar, anexar, remover, requisitar, provedores,
    assistido: (comando) => comando === 'stj' && preferencias().captcha,
    opcoes: (id) => { const s = sessoes.get(id); return s && { acompanhar: s.acompanhar, captcha: s.captcha, provedor: s.provedor }; },
    listar: (pool) => [...sessoes.values()].map((s) => ({
      id: s.id, comando: s.comando, status: s.status, acompanhar: s.acompanhar,
      posicao: pool.posicao(s.id), mensagem: s.mensagem || '',
    })),
    iniciar: (id) => { const s = sessoes.get(id); if (s) s.status = 'rodando'; },
    fechar: () => { for (const id of sessoes.keys()) remover(id); },
  };
}
module.exports = { criarRegistro };
