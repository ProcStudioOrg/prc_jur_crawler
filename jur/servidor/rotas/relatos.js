// Botão "Relatar" da interface: card no Linear BRU (se configurado) e cópia no FFD (user-issues).
// O que o servidor afirma (usuário, equipe, versão, a busca e a conversa da própria conta) vale
// mais do que o `extra` do browser, que só serve para apontar qual busca/conversa está na tela.
const { json, lerCorpo } = require('../http');
const { buildMeta, submitIssue, SubmissionError, LinearError } = require('../issue-reporter/report');
const {
  configDoRelator, contextoDoServidor, historicoDaConversa, blocoDoCard, CHAVE_HISTORICO,
} = require('../issue-reporter/config');
const { revisaoDaImagem } = require('../aviso-deploy');

const FALHA_GERAL = 'Não conseguimos registrar agora. Tente de novo em alguns minutos.';
const MIN_TITULO = 4;

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

function registrar(roteador, deps) {
  const principal = deps.conta;
  if (!principal) return;
  const env = deps.env || process.env;
  const versao = deps.versao || require('../../package.json').version;
  const revisao = deps.revisao !== undefined ? deps.revisao : revisaoDaImagem(env.JUR_IMAGE);

  roteador.rota('GET', '/api/v1/relatos/meta', async (req, res) => {
    json(res, 200, await buildMeta(configDoRelator({ env, principal, versao, revisao })));
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
    try {
      linear = await submitIssue(config, body);
    } catch (e) {
      if (e instanceof SubmissionError && e.status !== 503) return json(res, e.status, { error: e.message });
      // 503 = Linear desligado, nada a logar. A mensagem do LinearError é texto do cliente GraphQL,
      // nunca a chave; ela fica no log e não vai ao usuário.
      if (!(e instanceof SubmissionError)) console.error('[relatos] card no Linear falhou:', e instanceof LinearError ? e.message : e?.name || 'erro');
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

    if (linear) return json(res, 200, { ok: true, identifier: linear.identifier, url: linear.url });
    // Como o ProcStudio: o card ficou devendo, mas o relato chegou ao FFD — para quem relatou, "Recebido".
    if (noFfd) return json(res, 200, { ok: true, identifier: null, url: null });
    return json(res, 502, { error: FALHA_GERAL });
  });
}

module.exports = { registrar };
