// API fixa no servidor; nunca aceitar endpoint, credencial ou connectUrl do cliente.
async function comBrowserbase(executar, {
  apiKey = process.env.BROWSERBASE_API_KEY,
  projectId = process.env.BROWSERBASE_PROJECT_ID,
  fetchFn = fetch,
  sinal,
} = {}) {
  if (!apiKey || !projectId) throw new Error('Browserbase não configurado. Selecione o navegador local.');
  const headers = { 'Content-Type': 'application/json', 'X-BB-API-Key': apiKey };
  async function pedir(rota, body) {
    let r;
    try {
      r = await fetchFn(`https://api.browserbase.com/v1/sessions${rota}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
    } catch { throw new Error('Não foi possível contatar o Browserbase.'); }
    if (!r.ok) throw new Error(`Browserbase indisponível (HTTP ${r.status}).`);
    try { return await r.json(); } catch { throw new Error('Resposta inválida do Browserbase.'); }
  }
  sinal?.throwIfAborted();
  const session = await pedir('', { projectId, timeout: 600, keepAlive: false,
    browserSettings: { solveCaptchas: false, recordSession: false, logSession: false,
      viewport: { width: 1440, height: 1100 } },
  });
  try {
    sinal?.throwIfAborted();
    let url;
    try { url = new URL(session.connectUrl); } catch { throw new Error('Browserbase não retornou um navegador válido.'); }
    if (!session.id || url.protocol !== 'wss:' || !(url.hostname === 'browserbase.com' || url.hostname.endsWith('.browserbase.com')))
      throw new Error('Browserbase não retornou um navegador válido.');
    return await executar(session.connectUrl);
  } finally {
    if (session.id) {
      const rota = '/' + encodeURIComponent(session.id);
      try { await pedir(rota, { status: 'REQUEST_RELEASE' }); }
      catch {
        try { await pedir(rota, { status: 'REQUEST_RELEASE' }); }
        catch { console.error('[navegadores] Browserbase não confirmou encerramento; sessão expira em até 600s.'); }
      }
    }
  }
}
module.exports = { comBrowserbase };
