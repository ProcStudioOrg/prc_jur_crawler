// Navegadores remotos: o Chromium roda no fornecedor e o crawler conecta por CDP.
// API fixa no servidor; nunca aceitar endpoint, credencial ou URL de conexão do cliente.
//
// Por que existem: o IP do servidor (Hostinger) é bloqueado pelo CloudFront do Falcão
// e pela Akamai do TRF3; pelo egresso dos fornecedores os dois respondem (medido em
// 13/10/2026). A ordem padrão é por custo: Kernel US$0,06/h cobrado por segundo,
// Steel US$0,10/h cobrado por minuto. O segundo só entra se o primeiro falhar.

// Falhas que dependem do fornecedor e não do tribunal: o CDP não conectou
// (navegadorPreload/FalcaoNavigator) ou o site recusou o IP de saída sorteado para a
// sessão (CloudFront 403, Akamai derrubando a conexão). O IP muda a cada sessão, então o
// próximo fornecedor tem boa chance; medido: Kernel pegou 403 do Falcão 1 vez em ~10.
const FALHA_DO_FORNECEDOR = /navegador remoto|HTTP 403|ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_(REFUSED|RESET|CLOSED)/i;

const hostDe = (url, ...sufixos) => {
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' && sufixos.some((s) => u.hostname === s || u.hostname.endsWith('.' + s));
  } catch { return false; }
};

const FORNECEDORES = {
  kernel: {
    nome: 'Kernel',
    chave: () => process.env.KERNEL_API_KEY,
    async abrir(chave, pedir) {
      const headers = { authorization: `Bearer ${chave}` };
      // stealth desligado de propósito: ele sai por proxy residencial que o CloudFront
      // do Falcão recusa (403) e liga o resolvedor de captcha, que este repo não usa.
      const s = await pedir('https://api.onkernel.com/browsers', {
        method: 'POST', headers, body: { stealth: false, headless: true, timeout_seconds: 300 },
      });
      if (!s?.session_id || !hostDe(s.cdp_ws_url, 'kernel.sh', 'onkernel.com')) throw new Error('resposta inválida');
      const id = encodeURIComponent(s.session_id);
      return { cdp: s.cdp_ws_url, fechar: () => pedir(`https://api.onkernel.com/browsers/${id}`, { method: 'DELETE', headers }) };
    },
  },
  steel: {
    nome: 'Steel',
    chave: () => process.env.STEEL_API_KEY,
    async abrir(chave, pedir) {
      const headers = { 'steel-api-key': chave };
      // Plano Launch encerra a sessão em 15 min; sem proxy pago e sem resolvedor de captcha.
      const s = await pedir('https://api.steel.dev/v1/sessions', {
        method: 'POST', headers, body: { useProxy: false, solveCaptcha: false, sessionTimeout: 900000 },
      });
      if (!s?.id || !/^[\w-]+$/.test(s.id)) throw new Error('resposta inválida');
      const cdp = `wss://connect.steel.dev?apiKey=${encodeURIComponent(chave)}&sessionId=${s.id}`;
      return { cdp, fechar: () => pedir(`https://api.steel.dev/v1/sessions/${s.id}/release`, { method: 'POST', headers }) };
    },
  },
};

function configurados(ordem = process.env.JUR_NAVEGADOR_REMOTO || 'kernel,steel') {
  return String(ordem).split(',').map((s) => s.trim().toLowerCase())
    .filter((n, i, a) => FORNECEDORES[n] && FORNECEDORES[n].chave() && a.indexOf(n) === i);
}

function criarPedido(fetchFn) {
  return async function pedir(url, { method, headers, body }) {
    let r;
    try {
      r = await fetchFn(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('sem resposta'); }
    // Só o status: corpo de erro do fornecedor pode ecoar credencial ou URL de conexão.
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const texto = await r.text();
    if (!texto) return {};
    try { return JSON.parse(texto); } catch { throw new Error('resposta inválida'); }
  };
}

/**
 * Abre um navegador no primeiro fornecedor configurado que responder e entrega a URL
 * CDP a `executar`. Passa para o seguinte quando a sessão não abre, quando o crawler
 * não conecta nela ou quando o tribunal recusa o IP de saída. Erro do crawler em si
 * (seletor, zero resultados) não troca de fornecedor: o resultado volta como veio.
 */
async function comNavegadorRemoto(executar, { ordem, fetchFn = fetch, sinal, aoFornecedor = () => {} } = {}) {
  const lista = configurados(ordem);
  if (!lista.length) throw new Error('Navegador remoto não configurado. Selecione o navegador local.');
  const pedir = criarPedido(fetchFn);
  const falhas = [];
  for (const [i, id] of lista.entries()) {
    sinal?.throwIfAborted();
    const f = FORNECEDORES[id];
    let sessao;
    try { sessao = await f.abrir(f.chave(), pedir); }
    catch (e) { falhas.push(`${f.nome}: ${e.message}`); continue; }
    try { aoFornecedor({ fornecedor: id, nome: f.nome, reserva: i > 0, falhas: [...falhas] }); } catch { /* aviso não derruba a busca */ }
    let r;
    try {
      sinal?.throwIfAborted();
      r = await executar(sessao.cdp);
    } finally {
      try { await sessao.fechar(); }
      catch {
        try { await sessao.fechar(); }
        catch { console.error(`[navegadores] ${f.nome} não confirmou encerramento; a sessão expira sozinha por inatividade.`); }
      }
    }
    if (r && r.ok === false && FALHA_DO_FORNECEDOR.test(r.erro || '') && i < lista.length - 1) {
      falhas.push(`${f.nome}: ${/navegador remoto/i.test(r.erro) ? 'conexão recusada' : 'IP de saída bloqueado pelo tribunal'}`);
      continue;
    }
    return r;
  }
  throw new Error(`Nenhum navegador remoto disponível (${falhas.join('; ')}).`);
}

const nomes = (ordem) => configurados(ordem).map((id) => FORNECEDORES[id].nome);

// Rótulo exibido ao usuário: "Kernel", ou "Steel (reserva)" quando o primeiro falhou.
const rotulo = (info) => (info.reserva ? `${info.nome} (reserva)` : info.nome);

// Hosts que recusam o IP do servidor (403 do CloudFront no Falcão, conexão recusada
// pela Akamai no TRF3). Medido em 13/10/2026; rode o teste antes de ampliar a lista.
const EGRESSO_BLOQUEADO = new Set(['trf3', ...Object.values(require('../../src/FalcaoTribunais').TRIBUNAIS).map((t) => t.comando)]);
const exigeRemoto = (comando) => EGRESSO_BLOQUEADO.has(comando);

module.exports = { comNavegadorRemoto, configurados, nomes, rotulo, exigeRemoto };
