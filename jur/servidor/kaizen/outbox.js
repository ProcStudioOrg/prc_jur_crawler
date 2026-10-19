// jur/servidor/kaizen/outbox.js
// Fila durável (SQLite global) dos envios ao FFD. O FFD pode ficar horas fora do ar: por isso
// a fila tem teto, um POST por vez e nada aqui lança nem segura quem enfileirou.
const BACKOFF_MS = [60e3, 300e3, 900e3, 3600e3]; // depois disso, de hora em hora
const VALIDADE_MS = 48 * 3600e3;

function criarOutbox({
  con, url, token, fetchFn = fetch, agora = Date.now, intervaloMs = 60000,
  maxItens = 5000, maxBytes = 200 * 1024 * 1024, timeoutMs = 20000,
}) {
  const ligado = Boolean(url && token);
  const base = ligado ? String(url).replace(/\/$/, '') : '';
  let rodando = null;
  let timer = null;

  try {
    con.exec(`CREATE TABLE IF NOT EXISTS kaizen_envio (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, corpo_json TEXT NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0, proxima_em INTEGER NOT NULL, criado_em INTEGER NOT NULL)`);
    con.exec('CREATE INDEX IF NOT EXISTS kaizen_envio_proxima ON kaizen_envio (proxima_em)');
  } catch (e) {
    console.error('[kaizen] outbox indisponivel:', e && e.code ? e.code : 'erro');
  }

  function pendentes() {
    try { return con.prepare('SELECT COUNT(*) AS n FROM kaizen_envio').get().n; } catch { return 0; }
  }

  // Descarta os mais velhos até caber nos dois tetos.
  function aplicarTeto() {
    con.prepare('DELETE FROM kaizen_envio WHERE id IN (SELECT id FROM kaizen_envio ORDER BY id DESC LIMIT -1 OFFSET ?)').run(maxItens);
    const bytes = () => con.prepare('SELECT COALESCE(SUM(length(corpo_json)), 0) AS b FROM kaizen_envio').get().b;
    while (bytes() > maxBytes && con.prepare('DELETE FROM kaizen_envio WHERE id = (SELECT MIN(id) FROM kaizen_envio)').run().changes > 0);
  }

  function enfileirar(source, corpo) {
    try {
      const t = agora();
      con.prepare('INSERT INTO kaizen_envio (source, corpo_json, proxima_em, criado_em) VALUES (?, ?, ?, ?)')
        .run(String(source), JSON.stringify(corpo), t, t);
      aplicarTeto();
      setImmediate(() => { drenar(); });
    } catch (e) {
      console.error('[kaizen] falha ao enfileirar:', e && e.code ? e.code : 'erro');
    }
  }

  async function enviar(item) {
    try {
      const r = await fetchFn(`${base}/${item.source}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-token': token },
        body: item.corpo_json,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.status;
    } catch {
      return 0; // rede/timeout: tratado como transitório
    }
  }

  async function drenarTudo() {
    const res = { enviados: 0, adiados: 0, descartados: 0 };
    try {
      res.descartados += con.prepare('DELETE FROM kaizen_envio WHERE criado_em < ?').run(agora() - VALIDADE_MS).changes;
      if (!ligado) return res;
      for (;;) {
        const item = con.prepare('SELECT * FROM kaizen_envio WHERE proxima_em <= ? ORDER BY id LIMIT 1').get(agora());
        if (!item) break;
        const status = await enviar(item);
        if (status >= 200 && status < 300) {
          con.prepare('DELETE FROM kaizen_envio WHERE id = ?').run(item.id);
          res.enviados++;
        } else if (status === 0 || status === 408 || status === 429 || status >= 500) {
          const espera = BACKOFF_MS[Math.min(item.tentativas, BACKOFF_MS.length - 1)];
          con.prepare('UPDATE kaizen_envio SET tentativas = tentativas + 1, proxima_em = ? WHERE id = ?').run(agora() + espera, item.id);
          res.adiados++;
        } else {
          con.prepare('DELETE FROM kaizen_envio WHERE id = ?').run(item.id);
          res.descartados++;
          console.error(`[kaizen] descartado ${item.source} HTTP ${status}`);
        }
      }
    } catch (e) {
      console.error('[kaizen] falha ao drenar:', e && e.code ? e.code : 'erro');
    }
    return res;
  }

  // Uma drenagem por vez; chamadas concorrentes pegam carona na que está rodando.
  function drenar() {
    if (!rodando) rodando = drenarTudo().finally(() => { rodando = null; });
    return rodando;
  }

  function iniciar() {
    if (timer) return;
    timer = setInterval(() => { drenar(); }, intervaloMs);
    timer.unref();
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }

  return { ligado, enfileirar, drenar, iniciar, parar, pendentes };
}

module.exports = { criarOutbox, BACKOFF_MS, VALIDADE_MS };
