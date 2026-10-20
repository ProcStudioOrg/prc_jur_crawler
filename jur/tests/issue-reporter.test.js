// Espelha tests/issue-reporter.test.ts do FFD (mesmos casos, mesmas asserções).
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const linear = require('../servidor/issue-reporter/linear');
const {
  buildMeta, clearReporterCache, composeDescription, composeTitle, submitIssue, SubmissionError,
} = require('../servidor/issue-reporter/report');

const TEAM_META = {
  id: 'team-1',
  key: 'PRC',
  name: 'ProcStudioDevs',
  labels: [
    { id: 'g1', name: 'Módulo', isGroup: true, teamId: 'team-1', parentName: null },
    { id: 'm1', name: 'Works', isGroup: false, teamId: 'team-1', parentName: 'Módulo' },
    { id: 'm2', name: 'Infra', isGroup: false, teamId: 'team-1', parentName: 'Módulo' },
    { id: 'g2', name: 'Tipo', isGroup: true, teamId: 'team-1', parentName: null },
    { id: 't1', name: 'Bug', isGroup: false, teamId: null, parentName: 'Tipo' },
    { id: 'x1', name: 'Interna', isGroup: false, teamId: 'team-1', parentName: null },
  ],
  states: [
    { id: 's-backlog', name: 'Backlog', type: 'backlog', position: 0 },
    { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
  ],
};

function config(over = {}) {
  return {
    enabled: true,
    apiKey: 'lin_api_test',
    teamId: 'team-1',
    author: 'Bruno',
    titleTemplate: '{module} -> {title} ({author})',
    moduleGroup: 'Módulo',
    typeGroup: 'Tipo',
    alwaysLabels: [],
    initialStateName: 'Todo',
    app: { name: 'FullFucker Dashboard', version: '0.1.0', commit: 'abc1234', env: 'production' },
    requireContact: false,
    qaChecklist: true,
    moduleByPath: { '/servers': 'Infra' },
    ...over,
  };
}

function submission(over = {}) {
  return {
    title: 'Cache de labels não invalida',
    body: 'Trocar de team mantém as labels antigas.',
    module: 'Works',
    type: 'Bug',
    priority: 2,
    context: {
      url: 'https://ffd.local/servers/nas',
      path: '/servers/nas',
      screen: 'Servidores',
      viewport: '1440×900',
      userAgent: 'Mozilla/5.0',
      language: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      at: '2026-09-03T20:00:00.000Z',
      console: [{ level: 'error', message: 'boom', at: '2026-09-03T19:59:00.000Z' }],
      network: [{ method: 'GET', url: '/api/servers', status: 500, at: '2026-09-03T19:59:30.000Z' }],
      extra: { rota: '/servers/nas' },
    },
    ...over,
  };
}

// As funções são trocadas no objeto do módulo: report.js as chama por `linear.x`.
const original = { createIssue: linear.createIssue, getTeamMeta: linear.getTeamMeta };
let chamadas;
let metaCalls;
let getTeamMetaImpl;

beforeEach(() => {
  clearReporterCache();
  chamadas = [];
  metaCalls = 0;
  getTeamMetaImpl = async () => TEAM_META;
  linear.getTeamMeta = async (...a) => { metaCalls += 1; return getTeamMetaImpl(...a); };
  linear.createIssue = async (...a) => {
    chamadas.push(a);
    return { identifier: 'PRC-601', url: 'https://linear.app/x' };
  };
});

require('node:test').after(() => Object.assign(linear, original));

describe('composeTitle', () => {
  it('aplica o template completo', () => {
    assert.equal(composeTitle(config(), 'Sumiu o botão', 'Works'), 'Works -> Sumiu o botão (Bruno)');
  });

  it('some com o prefixo quando não há módulo', () => {
    assert.equal(composeTitle(config(), 'Sumiu o botão', null), 'Sumiu o botão (Bruno)');
  });

  it('some com o sufixo quando não há autor', () => {
    assert.equal(composeTitle(config({ author: '' }), 'Sumiu o botão', 'Works'), 'Works -> Sumiu o botão');
  });

  it('aceita template de outro repositório', () => {
    const c = config({ titleTemplate: '[WAO] {title}', author: '' });
    assert.equal(composeTitle(c, 'Upload trava em 90%', null), '[WAO] Upload trava em 90%');
  });

  it('aplica o template do JurCrawler', () => {
    assert.equal(
      composeTitle({ ...config(), titleTemplate: '[jur] {title} ({author})' }, 'Busca travou', null),
      '[jur] Busca travou (Bruno)'
    );
  });
});

describe('composeDescription', () => {
  const desc = () => composeDescription(config(), submission());

  it('carrega a proveniência: versão, commit, tela e URL', () => {
    const out = desc();
    for (const t of ['FullFucker Dashboard', 'v0.1.0', 'abc1234', '/servers/nas', 'Servidores']) {
      assert.ok(out.includes(t), t);
    }
  });

  it('inclui console e requisições que falharam', () => {
    const out = desc();
    for (const t of ['### Console (1)', 'boom', 'Requisições que falharam (1)', '/api/servers']) {
      assert.ok(out.includes(t), t);
    }
  });

  it('inclui o bloco de QA quando ligado, e só quando ligado', () => {
    assert.ok(desc().includes('## Critério de QA'));
    assert.ok(!composeDescription(config({ qaChecklist: false }), submission()).includes('## Critério de QA'));
  });

  it('separa o que o servidor afirma do que o browser diz', () => {
    // `extra` vem do browser (afirmação do cliente); `serverContext`, do servidor (fato).
    // O do servidor vem por último: quando falam da mesma coisa, ele tem a palavra final.
    const out = composeDescription(
      config({ serverContext: { Time: 'Acme Advogados', Plano: 'pro' } }),
      submission()
    );
    assert.ok(out.includes('| Time | Acme Advogados |'));
    assert.ok(out.indexOf('| Time |') > out.indexOf('| rota |'));
  });

  it('escapa pipe para não quebrar a tabela markdown', () => {
    const out = composeDescription(
      config(),
      submission({ context: { ...submission().context, screen: 'a | b' } })
    );
    assert.ok(out.includes('a \\| b'));
  });
});

describe('submitIssue', () => {
  it('cria a issue com labels resolvidas e estado inicial', async () => {
    const result = await submitIssue(config({ alwaysLabels: ['Interna'] }), submission());

    assert.deepEqual(result, { ok: true, identifier: 'PRC-601', url: 'https://linear.app/x' });
    const [, input] = chamadas[0];
    assert.equal(input.teamId, 'team-1');
    assert.equal(input.title, 'Works -> Cache de labels não invalida (Bruno)');
    assert.deepEqual(input.labelIds, ['x1', 'm1', 't1']);
    assert.equal(input.stateId, 's-todo');
    assert.equal(input.priority, 2);
  });

  it('ignora label que não pertence ao grupo configurado', async () => {
    // "Interna" existe no workspace mas não é filha de `Módulo`: um POST forjado não escolhe label.
    await submitIssue(config(), submission({ module: 'Interna' }));
    const [, input] = chamadas[0];
    assert.deepEqual(input.labelIds, ['t1']);
    assert.equal(input.title, 'Cache de labels não invalida (Bruno)');
  });

  it('ignora prioridade fora da escala do Linear', async () => {
    await submitIssue(config(), submission({ priority: 99 }));
    assert.equal(chamadas[0][1].priority, null);
  });

  it('recusa título curto e corpo vazio', async () => {
    await assert.rejects(submitIssue(config(), submission({ title: 'ab' })), SubmissionError);
    await assert.rejects(submitIssue(config(), submission({ body: '   ' })), SubmissionError);
  });

  it('recusa envio quando não há key configurada', async () => {
    await assert.rejects(submitIssue(config({ apiKey: null }), submission()), { status: 503 });
  });

  it('em app público exige e-mail válido', async () => {
    const publico = config({ requireContact: true });
    await assert.rejects(submitIssue(publico, submission()), /e-mail/i);
    await assert.rejects(
      submitIssue(publico, submission({ reporter: { name: 'X', email: 'nao-e-email' } })),
      /inválido/i
    );

    await submitIssue(publico, submission({ reporter: { name: 'X', email: 'x@y.com' } }));
    assert.ok(chamadas[0][1].description.includes('x@y.com'));
  });

  it('trunca o que vem do browser', async () => {
    const huge = 'x'.repeat(9000);
    await submitIssue(
      config(),
      submission({
        body: huge,
        context: {
          ...submission().context,
          console: Array.from({ length: 50 }, (_, i) => ({
            level: 'error',
            message: `erro ${i}`,
            at: '2026-09-03T20:00:00.000Z',
          })),
        },
      })
    );
    const desc = chamadas[0][1].description;
    assert.ok(desc.includes('### Console (20)'));
    assert.ok(desc.length < 12000);
  });

  it('cacheia o vocabulário do time entre envios', async () => {
    await submitIssue(config(), submission());
    await submitIssue(config(), submission());
    assert.equal(metaCalls, 1);
  });
});

describe('buildMeta', () => {
  it('desligado não vaza vocabulário nenhum', async () => {
    const meta = await buildMeta(config({ enabled: false }));
    assert.equal(meta.enabled, false);
    assert.deepEqual(meta.modules, []);
    assert.equal(metaCalls, 0);
  });

  it('expõe só as filhas dos grupos configurados', async () => {
    const meta = await buildMeta(config());
    assert.equal(meta.enabled, true);
    assert.deepEqual(meta.team, { key: 'PRC', name: 'ProcStudioDevs' });
    assert.deepEqual(meta.modules.map((m) => m.value), ['Infra', 'Works']);
    assert.deepEqual(meta.types.map((t) => t.value), ['Bug']);
    // `Interna` não é filha de grupo nenhum e por isso não aparece.
    assert.ok(!meta.modules.concat(meta.types).map((o) => o.value).includes('Interna'));
  });

  it('Linear fora do ar vira enabled:false com motivo, não exceção', async () => {
    getTeamMetaImpl = async () => { throw new Error('timeout'); };
    const meta = await buildMeta(config());
    assert.equal(meta.enabled, false);
    assert.ok(meta.error.includes('timeout'));
  });
});
