const assert = require('node:assert');
const http = require('node:http');
const { describe, it, before, after } = require('node:test');
const feedback = require('../servidor/feedback');
const { criarApp } = require('../servidor/index');

// Linear falso: responde as duas queries (vocabulario do time e criacao) sem rede, e
// registra tudo o que recebeu — inclusive a chave, para provar que ela nunca aparece
// em nada que o browser veja.
function linearFalso({ falhar = false } = {}) {
  const chamadas = [];
  let n = 0;
  const resposta = (corpo, status = 200) => ({ status, json: async () => corpo });
  const transport = async (url, init) => {
    const pedido = JSON.parse(init.body);
    chamadas.push({ url, authorization: init.headers.authorization, pedido });
    if (falhar) return resposta({ errors: [{ message: 'boom' }] }, 500);
    if (pedido.query.includes('TeamMeta')) {
      return resposta({ data: {
        team: { id: 'time-1', key: 'BRU', name: 'BrunoDev',
          states: { nodes: [{ id: 'st-backlog', name: 'Backlog', type: 'backlog', position: 0 }, { id: 'st-todo', name: 'Todo', type: 'unstarted', position: 1 }] } },
        issueLabels: { nodes: [
          { id: 'lb-mod', name: 'Módulo', isGroup: true, team: null, parent: null },
          { id: 'lb-chat', name: 'Chat', isGroup: false, team: null, parent: { id: 'lb-mod', name: 'Módulo' } },
          { id: 'lb-interna', name: 'Interna', isGroup: false, team: { id: 'outro-time' }, parent: null },
        ] },
      } });
    }
    n += 1;
    return resposta({ data: { issueCreate: { success: true, issue: { identifier: `BRU-${100 + n}`, url: `https://linear.app/x/issue/BRU-${100 + n}` } } } });
  };
  return { transport, chamadas, criadas: () => chamadas.filter((c) => c.pedido.query.includes('CreateIssue')) };
}

const ENV = { LINEAR_API_KEY: 'lin_api_SEGREDO_NAO_VAZA', LINEAR_TEAM_ID: 'time-1', LINEAR_MODULE_GROUP: 'Módulo' };
const PRINCIPAL = { issuer: 'https://procstudio.test', userId: 'u-1', teamId: 't-1', expiresAt: Date.now() + 3600000 };

function subir(deps) {
  const servidor = http.createServer(criarApp(deps).handler);
  return new Promise((r) => servidor.listen(0, () => r({ servidor, base: `http://127.0.0.1:${servidor.address().port}` })));
}

describe('feedback: nucleo', () => {
  it('meta nao vaza a chave e so expoe time, prioridades e modulos', async () => {
    const linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport, versao: '9.9.9', revisao: 'abc1234' });
    const m = await f.meta();
    assert.strictEqual(m.enabled, true);
    assert.deepStrictEqual(m.team, { key: 'BRU', name: 'BrunoDev' });
    assert.deepStrictEqual(m.modules, [{ value: 'Chat', label: 'Chat' }]);
    assert.deepStrictEqual(m.types, []);
    assert.strictEqual(m.requireContact, false);
    assert.strictEqual(m.app.version, '9.9.9');
    assert.ok(!JSON.stringify(m).includes('SEGREDO'), 'a chave nao pode sair em /meta');
    assert.strictEqual(linear.chamadas[0].authorization, ENV.LINEAR_API_KEY, 'a chave vai so para o Linear');
  });

  it('sem configuracao: meta diz enabled=false e enviar da 503', async () => {
    const f = feedback.criarFeedback({ env: {}, transport: async () => { throw new Error('nao deveria chamar'); } });
    assert.strictEqual((await f.meta()).enabled, false);
    await assert.rejects(f.enviar(PRINCIPAL, { title: 'Titulo', body: 'x' }), (e) => e instanceof feedback.ErroEnvio && e.status === 503);
  });

  it('cria o card com prefixo [jurCrawler], estado Todo, contexto do servidor e checklist de QA', async () => {
    const linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport, versao: '1.2.3', revisao: 'f64f33b' });
    const r = await f.enviar(PRINCIPAL, {
      title: 'Busca trava no TJPR', body: 'Esperava resultados, veio tela branca.', module: 'Chat', type: 'Interna', priority: 2,
      context: { path: '/', screen: 'jur', url: 'https://jurcrawler.com.br/?token=abc', viewport: '1280×720', language: 'pt-BR', timezone: 'America/Sao_Paulo', userAgent: 'UA',
        console: [{ level: 'error', message: 'TypeError: x', at: '2026-10-19T10:00:00Z' }],
        network: [{ method: 'POST', url: '/api/v1/buscas', status: 500, at: '2026-10-19T10:00:01Z' }],
        extra: { tela: 'conversa' } },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.identifier, 'BRU-101');
    const input = linear.criadas()[0].pedido.variables.input;
    assert.strictEqual(input.teamId, 'time-1');
    assert.strictEqual(input.title, '[jurCrawler] Chat -> Busca trava no TJPR');
    assert.strictEqual(input.stateId, 'st-todo');
    assert.strictEqual(input.priority, 2);
    assert.deepStrictEqual(input.labelIds, ['lb-chat'], 'label de outro time ("Interna") nao entra');
    for (const trecho of ['## Contexto (capturado pelo sistema)', '| Usuário | u-1 |', '| Equipe | t-1 |', 'v1.2.3', '`f64f33b`',
      '### Console (1)', 'TypeError: x', '### Requisições que falharam (1)', '| `500` | POST | /api/v1/buscas |',
      '## Critério de QA', '- [ ] Passo reproduzível:', '- [ ] Resultado esperado:', '- [ ] Evidência:', '| tela | conversa |']) {
      assert.ok(input.description.includes(trecho), `faltou no corpo: ${trecho}`);
    }
    assert.ok(!input.description.includes('SEGREDO'));
  });

  it('duplo clique: mesmo principal, mesmo titulo e corpo devolvem o MESMO card', async () => {
    const linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport });
    const corpo = { title: 'Mesmo relato', body: 'Mesmo corpo' };
    const [a, b] = await Promise.all([f.enviar(PRINCIPAL, corpo), f.enviar(PRINCIPAL, corpo)].map((p) => p.catch((e) => e)));
    // O segundo pode ter corrido antes de o primeiro gravar; por isso o terceiro, serial.
    const c = await f.enviar(PRINCIPAL, corpo);
    const ids = new Set([a.identifier, b.identifier, c.identifier].filter(Boolean));
    assert.ok(c.repetido === true || ids.size === 1, `repeticao criou cards distintos: ${[...ids]}`);
    assert.ok(linear.criadas().length <= 2, 'retentativa serial nao pode criar card novo');
    // Outro usuario com o mesmo texto e outro card.
    const d = await f.enviar({ ...PRINCIPAL, userId: 'u-2' }, corpo);
    assert.notStrictEqual(d.identifier, c.identifier);
  });

  it('rate limit: o 6o envio distinto na mesma hora da 429 com retryAfter; passada a hora, libera', async () => {
    let t = 1_000_000;
    const linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport, agora: () => t });
    for (let i = 0; i < feedback.TETO_POR_JANELA; i++) {
      await f.enviar(PRINCIPAL, { title: `Relato ${i}`, body: 'corpo' });
      t += 1000;
    }
    await assert.rejects(f.enviar(PRINCIPAL, { title: 'Relato extra', body: 'corpo' }),
      (e) => e instanceof feedback.ErroEnvio && e.status === 429 && e.retryAfter > 0);
    // Repetir um ja enviado nao conta nem bloqueia.
    const rep = await f.enviar(PRINCIPAL, { title: 'Relato 0', body: 'corpo' });
    assert.strictEqual(rep.repetido, true);
    t += feedback.JANELA_TAXA_MS + 1;
    const ok = await f.enviar(PRINCIPAL, { title: 'Relato extra', body: 'corpo' });
    assert.strictEqual(ok.ok, true);
  });

  it('valida titulo e corpo; trunca o que vem grande demais', async () => {
    const linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport });
    await assert.rejects(f.enviar(PRINCIPAL, { title: 'abc', body: 'x' }), (e) => e.status === 400);
    await assert.rejects(f.enviar(PRINCIPAL, { title: 'Titulo', body: '   ' }), (e) => e.status === 400);
    await f.enviar(PRINCIPAL, { title: 'T'.repeat(500), body: 'B'.repeat(10000) });
    const input = linear.criadas()[0].pedido.variables.input;
    assert.ok(input.title.length <= 180);
    assert.ok(!input.description.includes('B'.repeat(6002)));
  });

  it('Linear fora: ErroLinear (vira 502), e nada e contado como envio', async () => {
    const linear = linearFalso({ falhar: true });
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport });
    await assert.rejects(f.enviar(PRINCIPAL, { title: 'Titulo', body: 'x' }), (e) => e instanceof feedback.ErroLinear);
    // Linear fora: o widget nem aparece (enabled=false) e a causa fica no log, nao no browser.
    const m = await f.meta();
    assert.strictEqual(m.enabled, false);
    assert.ok(m.error && !m.error.includes('boom'), 'erro do Linear vira mensagem generica');
  });

  it('principal ausente nao cria card', async () => {
    const f = feedback.criarFeedback({ env: ENV, transport: linearFalso().transport });
    await assert.rejects(f.enviar(null, { title: 'Titulo', body: 'x' }), (e) => e.status === 401);
  });
});

describe('feedback: rotas', () => {
  let servidor; let base; let linear;
  before(async () => {
    linear = linearFalso();
    const f = feedback.criarFeedback({ env: ENV, transport: linear.transport });
    ({ servidor, base } = await subir({ feedback: f, conta: PRINCIPAL }));
  });
  after(() => servidor.close());

  const post = (corpo) => fetch(`${base}/api/v1/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

  it('GET /api/v1/feedback/meta responde no-store e sem a chave', async () => {
    const r = await fetch(`${base}/api/v1/feedback/meta`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('cache-control'), 'no-store');
    const texto = await r.text();
    assert.ok(!texto.includes('SEGREDO'));
    assert.strictEqual(JSON.parse(texto).enabled, true);
  });

  it('POST cria e devolve identifier + url; repetido devolve o mesmo', async () => {
    const a = await (await post({ title: 'Pela rota', body: 'corpo' })).json();
    assert.strictEqual(a.ok, true);
    assert.match(a.identifier, /^BRU-\d+$/);
    const b = await (await post({ title: 'Pela rota', body: 'corpo' })).json();
    assert.strictEqual(b.identifier, a.identifier);
    assert.strictEqual(b.repetido, true);
  });

  it('POST invalido da 400 com `error` (widget) e `erro` (API)', async () => {
    const r = await post({ title: 'ab', body: 'x' });
    assert.strictEqual(r.status, 400);
    const j = await r.json();
    assert.ok(j.error && j.erro);
  });

  it('POST alem do teto da 429 com Retry-After', async () => {
    for (let i = 0; i < 6; i++) await post({ title: `Rajada ${i}`, body: 'x' });
    const r = await post({ title: 'Rajada final', body: 'x' });
    assert.strictEqual(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  });

  it('Linear fora da 502 com mensagem generica', async () => {
    const quebrado = linearFalso({ falhar: true });
    const { servidor: s2, base: b2 } = await subir({ feedback: feedback.criarFeedback({ env: ENV, transport: quebrado.transport }), conta: PRINCIPAL });
    try {
      const r = await fetch(`${b2}/api/v1/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Titulo', body: 'x' }) });
      assert.strictEqual(r.status, 502);
      const j = await r.json();
      assert.ok(!j.error.includes('boom'));
    } finally { s2.close(); }
  });

  it('sem configuracao: meta enabled=false e POST 503', async () => {
    const { servidor: s3, base: b3 } = await subir({ feedback: feedback.criarFeedback({ env: {} }), conta: PRINCIPAL });
    try {
      assert.strictEqual((await (await fetch(`${b3}/api/v1/feedback/meta`)).json()).enabled, false);
      const r = await fetch(`${b3}/api/v1/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Titulo', body: 'x' }) });
      assert.strictEqual(r.status, 503);
    } finally { s3.close(); }
  });

  it('sem principal (roteador sem conta) o POST da 401', async () => {
    const { servidor: s4, base: b4 } = await subir({ feedback: feedback.criarFeedback({ env: ENV, transport: linear.transport }) });
    try {
      const r = await fetch(`${b4}/api/v1/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Titulo', body: 'x' }) });
      assert.strictEqual(r.status, 401);
    } finally { s4.close(); }
  });
});
