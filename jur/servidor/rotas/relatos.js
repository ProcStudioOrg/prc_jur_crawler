// Botão "Relatar" da interface: card no Linear BRU (se configurado) e cópia no FFD (user-issues).
// O que o servidor afirma (usuário, equipe, versão, a busca e a conversa da própria conta) vale
// mais do que o `extra` do browser, que só serve para apontar qual busca/conversa está na tela.
const crypto = require('node:crypto');
const { json, lerCorpo } = require('../http');
const { buildMeta, submitIssue, SubmissionError, LinearError } = require('../issue-reporter/report');
const {
  configDoRelator, contextoDoServidor, historicoDaConversa, blocoDoCard, CHAVE_HISTORICO,
} = require('../issue-reporter/config');
const { revisaoDaImagem } = require('../aviso-deploy');

const FALHA_GERAL = 'Não conseguimos registrar agora. Tente de novo em alguns minutos.';
const MIN_TITULO = 4;
const LIMITE_RELATOS = 5;
const JANELA_MS = 10 * 60e3;
const ERRO_LIMITE = 'Muitos relatos em pouco tempo. Tente de novo em alguns minutos.';

// Por conta (emissor + usuário), em memória do processo: cada relato vira card no Linear e item no
// FFD, e o app de uma conta pode ser recriado — por isso o mapa vive no módulo, não no registrar.
const relatosPorConta = new Map();
function dentroDoLimite(principal, agora) {
  const chave = `${principal.issuer || ''}|${principal.userId || ''}`;
  const recentes = (relatosPorConta.get(chave) || []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length >= LIMITE_RELATOS) { relatosPorConta.set(chave, recentes); return false; }
  recentes.push(agora);
  relatosPorConta.set(chave, recentes);
  // Sem crescer para sempre: contas sem relato recente saem do mapa.
  if (relatosPorConta.size > 1000) {
    for (const [k, ts] of relatosPorConta) if (!ts.some((t) => agora - t < JANELA_MS)) relatosPorConta.delete(k);
  }
  return true;
}
function zerarLimiteDeRelatos() { relatosPorConta.clear(); respostasRecentes.clear(); }

// Idempotência (herdada do BRU-91): o mesmo relato (conta + título + descrição) em 10 min devolve a
// MESMA resposta, sem card novo, sem item novo no FFD e sem gastar o limite. Duplo clique e
// retentativa do widget não duplicam. Só respostas 200 entram aqui.
const JANELA_REPETIDO_MS = 10 * 60e3;
const respostasRecentes = new Map();
function assinaturaDoRelato(principal, body) {
  const hash = crypto.createHash('sha256').update(`${texto(body.title)}\n${texto(body.body)}`).digest('hex');
  return `${principal.issuer || ''}|${principal.userId || ''}|${hash}`;
}
function respostaRepetida(assinatura, agora) {
  for (const [k, v] of respostasRecentes) if (agora - v.em >= JANELA_REPETIDO_MS) respostasRecentes.delete(k);
  return respostasRecentes.get(assinatura)?.resposta || null;
}
function lembrarResposta(assinatura, agora, resposta) {
  respostasRecentes.set(assinatura, { em: agora, resposta });
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

function registrar(roteador, deps) {
  const principal = deps.conta;
  if (!principal) return;
  const env = deps.env || process.env;
  const versao = deps.versao || require('../../package.json').version;
  const revisao = deps.revisao !== undefined ? deps.revisao : revisaoDaImagem(env.JUR_IMAGE);

  const agora = deps.agora || Date.now;
  const ffdLigado = () => Boolean(deps.kaizen?.outbox?.ligado);

  // O botão aparece se o relato chega a algum lugar: Linear configurado OU outbox do FFD ligada.
  roteador.rota('GET', '/api/v1/relatos/meta', async (req, res) => {
    const meta = await buildMeta(configDoRelator({ env, principal, versao, revisao }));
    json(res, 200, !meta.enabled && ffdLigado() ? { ...meta, enabled: true } : meta);
  });

  roteador.rota('POST', '/api/v1/relatos', async (req, res) => {
    // Chave pessoal é de integração (REST/MCP): relato é de pessoa olhando a tela.
    if (req.headers.authorization) return json(res, 403, { erro: 'Relato só pela interface.' });
    let body;
    try { body = (await lerCorpo(req)) || {}; } catch (e) { return json(res, 400, { error: e.message }); }

    // Mesma validação do núcleo, antes dele: com o Linear desligado ele responde 503 sem validar,
    // e o FFD receberia relato sem título.
    if (texto(body.title).length < MIN_TITULO) return json(res, 400, { error: 'Dê um título com pelo menos 4 caracteres.' });
    if (!texto(body.body)) return json(res, 400, { error: 'Descreva o que aconteceu.' });
    // Antes do limite: a retentativa do mesmo envio não conta como relato novo nem cai no 429 por
    // causa do próprio duplo clique.
    const assinaturaRelato = assinaturaDoRelato(principal, body);
    const repetida = respostaRepetida(assinaturaRelato, agora());
    if (repetida) return json(res, 200, { ...repetida, repetido: true });
    if (!dentroDoLimite(principal, agora())) return json(res, 429, { erro: ERRO_LIMITE });

    const extra = body.context && typeof body.context.extra === 'object' && body.context.extra ? body.context.extra : {};
    const jobId = texto(extra.jobId);
    const conversaId = texto(extra.conversaId);
    // A fila e as conversas são da conta: id de outra conta simplesmente não existe aqui.
    const job = jobId && deps.fila ? deps.fila.obter(jobId) : null;
    const captura = job && deps.fila.capturaDoJob ? deps.fila.capturaDoJob(job.id) : null;
    const assinatura = captura?.assinatura || null;
    const serverContext = contextoDoServidor({
      principal, versao, revisao, job, captura: Boolean(captura), assinatura,
      linkFalha: assinatura && deps.kaizen?.linkFalha ? deps.kaizen.linkFalha(assinatura) : null,
    });
    const conversa = conversaId && deps.conversas?.obter(conversaId) ? deps.conversas.mensagens(conversaId) : null;
    const historico = conversa ? historicoDaConversa(conversa, serverContext) : [];

    const config = configDoRelator({ env, principal, versao, revisao, serverContext, appendix: blocoDoCard(historico) });
    let linear = null;
    // Sem Linear configurado o relato vai só ao FFD (resposta igual à do Linear fora do ar).
    if (config.enabled) {
      try {
        linear = await submitIssue(config, body);
      } catch (e) {
        if (e instanceof SubmissionError && e.status !== 503) return json(res, e.status, { error: e.message });
        // A mensagem do LinearError é texto do cliente GraphQL, nunca a chave; ela fica no log e
        // não vai ao usuário.
        if (!(e instanceof SubmissionError)) console.error('[relatos] card no Linear falhou:', e instanceof LinearError ? e.message : e?.name || 'erro');
      }
    }

    const contexto = historico.length ? { ...serverContext, [CHAVE_HISTORICO]: historico.join('\n') } : serverContext;
    let noFfd = false;
    try {
      noFfd = Boolean(deps.kaizen?.enviarRelato?.({
        titulo: texto(body.title),
        descricao: texto(body.body),
        autorEmail: null,
        autorNome: `usuário ${principal.userId} / equipe ${principal.teamId}`,
        equipe: principal.teamId,
        rota: body.context?.path,
        versao,
        linear: linear ? { identifier: linear.identifier, url: linear.url } : null,
        contexto,
        em: new Date().toISOString(),
      }));
    } catch (e) { console.error('[relatos]', e?.message || e); }

    const responder = (resposta) => { lembrarResposta(assinaturaRelato, agora(), resposta); return json(res, 200, resposta); };
    if (linear) return responder({ ok: true, identifier: linear.identifier, url: linear.url });
    // Como o ProcStudio: o card ficou devendo, mas o relato chegou ao FFD — para quem relatou, "Recebido".
    if (noFfd) return responder({ ok: true, identifier: null, url: null });
    return json(res, 502, { error: FALHA_GERAL });
  });
}

module.exports = { registrar, zerarLimiteDeRelatos };
