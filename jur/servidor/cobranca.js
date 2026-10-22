// jur/servidor/cobranca.js
// Cobrança da conexão ProcStudio, uma instância por conta (o `con` do jur.db do usuário).
// Caminho do dinheiro: falha fechada (sem `podeOperar` recente não há chamada ao provedor),
// nunca cobra duas vezes (o request_id é idempotente no Rails) e nunca perde recibo (o que
// não foi registrado vai para `cobranca_pendente` e o varredor reenvia).
const VALIDADE_CACHE_MS = 30_000;
const ESPERAS_MS = [1000, 3000]; // 3 tentativas ao todo
const INTERVALO_VARREDOR_MS = 60_000;
const PENDENCIA_VELHA_MS = 24 * 3600e3;
const TERMINAIS = new Set(['USER_GONE', 'INVALID_USAGE', 'SERVICE_AUTH', 'TEAM_REJECTED']);

const MSG_PENDENTE = 'Não foi possível registrar a cobrança desta resposta. Tente novamente em instantes.';
const MSG_RECUSADA = 'O ProcStudio recusou a cobrança desta resposta.';
const MSG_OPERADOR = 'A conexão ProcStudio está temporariamente indisponível. Use uma conexão própria ou tente mais tarde.';
const MSG_SALDO = 'Saldo de IA insuficiente para usar a conexão ProcStudio.';

const erroCom = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
// Só código ou mensagem, curtos: nada de corpo, cabeçalho ou credencial vai para log ou FFD.
const descrever = (e) => String((e && (e.code || e.message)) || 'erro').slice(0, 300);
const ehFalhaDoOperador = (e) => e?.code === 'PRICING_UNAVAILABLE' || Number(e?.status) >= 500;

function criarCobranca({
  con, procstudio, principal, kaizen,
  agora = Date.now,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  logar = console.error,
}) {
  // Último ai_balance conhecido desta conta, com podeOperar/saldo atualizados pelos ai_usage.
  let cache = null;
  let cacheEm = -Infinity;
  let drenando = null;
  let varredorLigado = false;
  let timer = null;

  const registrarLog = (evento, dados) => {
    try { logar(JSON.stringify({ event: evento, ...dados })); } catch { /* log nunca derruba a cobrança */ }
  };

  function avisarOperador(e) {
    const status = Number.isFinite(e?.status) ? e.status : null;
    const erro = descrever(e);
    registrarLog('procstudio_llm_operator_failure', { origem: 'cobranca', status, erro });
    try {
      if (kaizen?.outbox?.ligado) kaizen.outbox.enfileirar('jur-diagnostico', { origem: 'cobranca', classe: 'operador', erro, status });
    } catch { /* outbox nunca derruba a cobrança */ }
  }

  // Toda ida ao Rails passa aqui: falha do operador vira log + diagnóstico, e o erro segue.
  async function chamarRails(fn) {
    try {
      return await fn();
    } catch (e) {
      if (ehFalhaDoOperador(e)) avisarOperador(e);
      throw e;
    }
  }

  const cacheValido = () => cache && agora() - cacheEm < VALIDADE_CACHE_MS;

  // Erro ou conta inativa apagam o cache: senão um ok antigo seguiria valendo até 30 s.
  async function buscarSaldo() {
    let b;
    try {
      b = await chamarRails(() => procstudio.saldo(principal));
    } catch (e) {
      cache = null;
      throw e;
    }
    if (b?.ativo === true) {
      cache = b;
      cacheEm = agora();
    } else {
      cache = null;
    }
    return b;
  }

  // Recibo em voo é o do turno que ainda está tentando: não bloqueia as outras conversas da conta
  // nem entra na drenagem (seria enviado duas vezes ao mesmo tempo).
  function pendentes() {
    return con.prepare('SELECT COUNT(*) AS n FROM cobranca_pendente WHERE em_voo = 0').get().n;
  }

  // Depois de uma queda do processo nenhum registro está de fato em voo: o que ficou marcado
  // volta para a fila do varredor.
  function recuperarVoos() {
    con.prepare('UPDATE cobranca_pendente SET em_voo = 0 WHERE em_voo = 1').run();
  }

  async function podeOperar() {
    if (pendentes() > 0) return { ok: false, motivo: 'pendente' };
    let b = cacheValido() ? cache : null;
    if (!b) {
      try {
        b = await buscarSaldo();
      } catch {
        return { ok: false, motivo: 'indisponivel' };
      }
      if (b?.ativo !== true) return { ok: false, motivo: 'indisponivel' };
    }
    if (b.podeOperar === true) return { ok: true };
    return { ok: false, motivo: 'saldo', saldoBrl: b.saldoBrl, mensagem: b.mensagem || MSG_SALDO, topupPath: b.topupPath };
  }

  async function saldo({ forcar = false } = {}) {
    if (!forcar && cacheValido()) return cache;
    return buscarSaldo();
  }

  function atualizarCache(r) {
    cache = { ...(cache || { ativo: true }), podeOperar: r.podeOperar, saldoCents: r.saldoCents, saldoBrl: r.saldoBrl };
    cacheEm = agora();
  }

  function descartar(requestId, e) {
    registrarLog('billing_receipt_dropped', { requestId, motivo: e.code, status: e.status ?? null });
  }

  // O recibo é gravado ANTES da 1ª ida ao Rails (em_voo = 1): se o processo cair no meio das
  // retentativas, o varredor do próximo boot o encontra. Sucesso ou código terminal apagam.
  async function registrar(uso) {
    const recibo = { principal: { issuer: principal.issuer, userId: principal.userId, teamId: principal.teamId }, uso };
    const requestId = String(uso.requestId);
    const apagar = () => con.prepare('DELETE FROM cobranca_pendente WHERE request_id = ?').run(requestId);
    con.prepare(`INSERT INTO cobranca_pendente (request_id, payload, tentativas, criado_em, em_voo)
                 VALUES (?, ?, 0, ?, 1)
                 ON CONFLICT (request_id) DO UPDATE SET em_voo = 1`)
      .run(requestId, JSON.stringify(recibo), agora());
    let ultimo;
    for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa++) {
      if (tentativa > 0) await esperar(ESPERAS_MS[tentativa - 1]);
      try {
        const r = await chamarRails(() => procstudio.registrarUso(recibo.principal, uso));
        apagar();
        atualizarCache(r);
        return { cobradoBrl: r.cobradoBrl, saldoBrl: r.saldoBrl, podeOperar: r.podeOperar, duplicado: r.duplicado };
      } catch (e) {
        if (TERMINAIS.has(e?.code)) {
          apagar();
          descartar(uso.requestId, e);
          throw erroCom('COBRANCA_RECUSADA', MSG_RECUSADA, { status: e.status });
        }
        ultimo = e;
      }
    }
    con.prepare(`UPDATE cobranca_pendente SET em_voo = 0, tentativas = tentativas + ?, ultimo_erro = ?
                 WHERE request_id = ?`)
      .run(ESPERAS_MS.length + 1, descrever(ultimo), requestId);
    agendar();
    throw erroCom('COBRANCA_PENDENTE', MSG_PENDENTE);
  }

  async function drenarAgora() {
    const resultado = { enviados: 0, descartados: 0, adiados: 0 };
    const linhas = con.prepare('SELECT request_id, payload, criado_em FROM cobranca_pendente WHERE em_voo = 0 ORDER BY criado_em').all();
    for (const linha of linhas) {
      let p, uso;
      try {
        ({ principal: p, uso } = JSON.parse(linha.payload));
      } catch {
        // Linha ilegível nunca seria aceita e bloquearia a conta para sempre: sai da fila e vai ao log.
        con.prepare('DELETE FROM cobranca_pendente WHERE request_id = ?').run(linha.request_id);
        registrarLog('billing_receipt_corrupt', { requestId: linha.request_id });
        resultado.descartados++;
        continue;
      }
      try {
        const r = await chamarRails(() => procstudio.registrarUso(p, uso));
        con.prepare('DELETE FROM cobranca_pendente WHERE request_id = ?').run(linha.request_id);
        atualizarCache(r);
        resultado.enviados++;
      } catch (e) {
        if (TERMINAIS.has(e?.code)) {
          con.prepare('DELETE FROM cobranca_pendente WHERE request_id = ?').run(linha.request_id);
          descartar(linha.request_id, e);
          resultado.descartados++;
          continue;
        }
        con.prepare('UPDATE cobranca_pendente SET tentativas = tentativas + 1, ultimo_erro = ? WHERE request_id = ?')
          .run(descrever(e), linha.request_id);
        resultado.adiados++;
        if (agora() - linha.criado_em > PENDENCIA_VELHA_MS)
          registrarLog('billing_pending_stale', { requestId: linha.request_id, criadoEm: linha.criado_em });
      }
    }
    return resultado;
  }

  // Uma drenagem por vez: o varredor e o boot podem coincidir.
  function drenar() {
    if (!drenando) drenando = drenarAgora().finally(() => { drenando = null; });
    return drenando;
  }

  function agendar() {
    if (!varredorLigado || timer || pendentes() === 0) return;
    timer = setTimeout(async () => {
      try { await drenar(); } catch (e) { registrarLog('billing_sweep_failure', { erro: descrever(e) }); }
      timer = null;
      agendar();
    }, INTERVALO_VARREDOR_MS);
    timer.unref?.();
  }

  // Chamado ao abrir o escopo da conta (boot): ainda não há turno em andamento, então todo
  // recibo marcado em voo é de um processo que caiu.
  function iniciarVarredor() {
    recuperarVoos();
    varredorLigado = true;
    agendar();
  }

  function pararVarredor() {
    varredorLigado = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function falhaDoOperador(erro) {
    avisarOperador(erro);
    return erroCom('PROCSTUDIO_LLM_INDISPONIVEL', MSG_OPERADOR, { status: 503 });
  }

  return { podeOperar, registrar, falhaDoOperador, pendentes, drenar, recuperarVoos, iniciarVarredor, pararVarredor, saldo };
}

module.exports = { criarCobranca };
