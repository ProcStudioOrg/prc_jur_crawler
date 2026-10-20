const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { criarKaizen, kaizenNulo } = require('../servidor/kaizen/index');
const { payloadRelato, payloadFalha, payloadResumo, filtrosDe, hashUsuario } = require('../servidor/kaizen/payload');
const { dirFalha, assinaturaDaCaptura } = require('../servidor/kaizen/captura');

const FX = path.join(__dirname, 'fixtures', 'kaizen', 'resultados');
const fx = (nome) => JSON.parse(fs.readFileSync(path.join(FX, `${nome}.json`), 'utf8'));
// O FFD recusa tela que não começa com a assinatura PNG (e 4xx é descartado pela outbox).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const ENV = { KAIZEN_WEBHOOK_URL: 'https://ffd.example/api/webhooks', KAIZEN_WEBHOOK_TOKEN: 'tok', KAIZEN_SALT: 'sal' };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jur-kaizen-'));
let enviados;
let kaizen;
const fetchFn = async (url, init) => { enviados.push({ url, corpo: JSON.parse(init.body) }); return new Response('{}'); };
const corpos = (source) => enviados.filter((e) => e.url.endsWith(`/${source}`)).map((e) => e.corpo);
const novo = (env = ENV) => criarKaizen({ dir: tmp(), env, fetchFn, versao: '1.1.0', revisao: 'abc1234' });

function jobFalso(extra) {
  return { id: 'job-1', comando: 'trf4', params: {}, status: 'erro', navegador: null, ...extra };
}
/** Arquivo de saída de um job com `<job>.falha/` como o preload deixa. */
function falhaPronta({ meta, html, png }) {
  const arquivo = path.join(tmp(), 'job-1.json');
  const dir = dirFalha(arquivo);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  if (html !== undefined) fs.writeFileSync(path.join(dir, 'pagina.html'), html);
  if (png !== undefined) fs.writeFileSync(path.join(dir, 'tela.png'), png);
  return arquivo;
}
const semCaptura = () => path.join(tmp(), 'job-1.json');

beforeEach(() => { enviados = []; kaizen = novo(); });
afterEach(() => kaizen.fechar());

test('falha de busca: contrato jur-diagnostico exato, com captura e sem e-mail', async () => {
  const arquivo = falhaPronta({ meta: { url: 'https://a.br/p', titulo: 'T', passo: 'pagina:a.br/p' }, html: '<p/>', png: PNG });
  await kaizen.registrarErro(jobFalso({ comando: 'trf4', navegador: 'Servidor ProcStudio', params: { query: 'x', dataInicio: '01/01/2024' } }),
    { ok: false, erro: "locator.click: Timeout 30000ms exceeded.\n  - waiting for locator('#r')" }, { usuarioId: 'u1', arquivo });
  await kaizen.outbox.drenar();
  const [c] = corpos('jur-diagnostico');
  assert.deepEqual(Object.keys(c).sort(), ['assinatura', 'classe', 'em', 'erro', 'filtros', 'html_gzip_b64', 'html_sha256', 'job_id', 'origem', 'passo', 'revisao', 'rota', 'servico', 'tela_png_gzip_b64', 'tipo', 'titulo', 'tribunal', 'url', 'usuario_hash', 'versao'].sort());
  assert.deepEqual([c.servico, c.versao, c.revisao, c.origem, c.tipo, c.tribunal, c.classe, c.passo, c.rota], ['jurcrawler', '1.1.0', 'abc1234', 'busca', 'falha', 'trf4', 'seletor', 'pagina:a.br/p', 'local']);
  assert.equal(c.usuario_hash, createHash('sha256').update('u1sal').digest('hex'));
  assert.equal(c.job_id, 'job-1');
  assert.ok(!JSON.stringify(c).includes('@'), 'nunca e-mail');
  assert.deepEqual(c.filtros, { query: 'x', dataInicio: '01/01/2024', dataFim: null, dataPubInicio: null, dataPubFim: null, relator: null, juizados: null, numero: null });
  assert.ok(c.tela_png_gzip_b64 && c.html_gzip_b64 && c.html_sha256);
  assert.ok(!Number.isNaN(Date.parse(c.em)));
  assert.ok(!fs.existsSync(path.join(dirFalha(arquivo), 'tela.png')), 'limpa o print depois de enfileirar');
  assert.equal(assinaturaDaCaptura(dirFalha(arquivo)), c.assinatura);
});

test('sem KAIZEN_SALT: usuario_hash null', async () => {
  kaizen.fechar();
  kaizen = novo({ ...ENV, KAIZEN_SALT: undefined });
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'x' }, { usuarioId: 'u1', arquivo: semCaptura() });
  await kaizen.outbox.drenar();
  const [c] = corpos('jur-diagnostico');
  assert.equal(c.usuario_hash, null);
  assert.equal(c.passo, 'desconhecido');
  assert.ok(!('tela_png_gzip_b64' in c), 'sem captura, sem as chaves da captura');
});

test('filtro ignorado: falha com conferencia e exemplos e aviso para o usuario', async () => {
  const { avisos } = kaizen.registrarConcluido(jobFalso({ comando: 'trf4', params: { dataInicio: '01/01/2001', dataFim: '31/12/2001' } }), { ok: true, resultados: fx('trf4').itens }, { usuarioId: 'u1' });
  assert.match(avisos[0], /^o tribunal parece ter ignorado o filtro de data/);
  await kaizen.outbox.drenar(); const [c] = corpos('jur-diagnostico');
  assert.deepEqual([c.classe, c.passo], ['filtro_ignorado:periodoJulgamento', 'conferencia']);
  assert.ok(Array.isArray(c.conferencia) && c.exemplos.length <= 5);
  assert.ok(Buffer.byteLength(JSON.stringify(c.exemplos)) <= 8 * 1024);
});

test('busca saudavel nao gera nada', async () => {
  assert.deepEqual(kaizen.registrarConcluido(jobFalso({ params: { query: 'x' } }), { ok: true, resultados: fx('trf4').itens }, {}).avisos, []);
  assert.equal(kaizen.outbox.pendentes(), 0);
});

test('resgates: reserva e captcha manual, sem captura', async () => {
  kaizen.registrarConcluido(jobFalso({ navegador: 'Steel (reserva)', navegadorFalhas: ['Kernel: HTTP 500'] }), { ok: true, resultados: [] }, {});
  kaizen.registrarConcluido(jobFalso({ comando: 'stj', navegador: 'Steel', resolvidoPeloUsuario: true }), { ok: true, resultados: [] }, {});
  await kaizen.outbox.drenar();
  const cs = corpos('jur-diagnostico');
  assert.deepEqual(cs.map((c) => [c.tipo, c.classe, c.erro]), [['resgate', 'resgate:reserva', 'Kernel: HTTP 500'], ['resgate', 'resgate:captcha_manual', null]]);
  assert.ok(cs.every((c) => !('tela_png_gzip_b64' in c) && !('conferencia' in c)));
});

test('segredo no erro nao chega ao corpo (Review Focus 4)', async () => {
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'wss://connect.steel.dev?apiKey=SEGREDO' }, { usuarioId: 'u', arquivo: semCaptura() });
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'Authorization: Bearer SEGREDO2' }, { usuarioId: 'u', arquivo: semCaptura() });
  await kaizen.outbox.drenar(); assert.doesNotMatch(JSON.stringify(corpos('jur-diagnostico')), /SEGREDO/);
});

test('resumo e relato no contrato', async () => {
  kaizen.enviarResumo({ rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 });
  assert.equal(kaizen.enviarRelato(payloadRelato({ titulo: 't', descricao: 'd'.repeat(3000), autorEmail: null, autorNome: 'usuário 7', equipe: '9', rota: '/', versao: '1.1.0', linear: null, contexto: {}, em: 'x' })), true);
  await kaizen.outbox.drenar();
  const [r] = corpos('jur-diagnostico');
  assert.deepEqual(r.resumo, { rodados: 3, ok: 2, falhas: 1, nao_verificaveis: 0 });
  assert.deepEqual([r.origem, r.tipo, r.classe, r.assinatura, r.tribunal, r.job_id], ['sentinela', 'resumo', 'resumo', 'sentinela|resumo', null, null]);
  const [u] = corpos('user-issues');
  assert.equal(u.descricao.length, 2000);
  assert.equal(u.linear, null);
  assert.ok('linear' in u && u.autor_email === null);
  assert.ok(!Number.isNaN(Date.parse(u.em)), 'em invalido vira agora');
});

test('registrarConcluido nunca lanca nem com resultados lixo', () => {
  assert.deepEqual(kaizen.registrarConcluido({ params: null }, { ok: true, resultados: 'lixo' }, {}), { avisos: [] });
  assert.deepEqual(kaizen.registrarConcluido(null, null, null), { avisos: [] });
});

test('sem KAIZEN_WEBHOOK_URL: nao envia, mas limpa o print e o html', async () => {
  kaizen.fechar();
  kaizen = novo({});
  const arquivo = falhaPronta({ meta: { passo: 'x' }, html: '<p/>', png: PNG });
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'x' }, { usuarioId: 'u', arquivo });
  assert.ok(!fs.existsSync(path.join(dirFalha(arquivo), 'tela.png')));
  assert.ok(!fs.existsSync(path.join(dirFalha(arquivo), 'pagina.html')));
  assert.equal(kaizen.linkFalha('a|b'), null);
  assert.equal(kaizen.enviarRelato(payloadRelato({ titulo: 't', descricao: 'd' })), false, 'sem FFD, relato nao chega');
  await kaizen.outbox.drenar();
  assert.equal(enviados.length, 0);
});

test('job cancelado nao vira falha e a captura some', async () => {
  const arquivo = falhaPronta({ meta: { passo: 'x' }, html: '<p/>', png: PNG });
  await kaizen.registrarErro(jobFalso({ status: 'cancelado' }), { ok: false, erro: 'SIGTERM' }, { usuarioId: 'u', arquivo });
  const outro = falhaPronta({ meta: { passo: 'x' } });
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'x' }, { usuarioId: 'u', arquivo: outro, cancelado: true });
  await kaizen.outbox.drenar();
  assert.equal(enviados.length, 0);
  assert.ok(!fs.existsSync(dirFalha(arquivo)) && !fs.existsSync(dirFalha(outro)));
});

test('tela que nao e PNG nao vai (o FFD recusaria o item inteiro)', async () => {
  const arquivo = falhaPronta({ meta: { passo: 'x', url: 'file:///etc/passwd' }, html: '<p/>', png: Buffer.from([1]) });
  await kaizen.registrarErro(jobFalso({}), { ok: false, erro: 'x' }, { usuarioId: 'u', arquivo });
  await kaizen.outbox.drenar();
  const [c] = corpos('jur-diagnostico');
  assert.equal(c.tela_png_gzip_b64, null);
  assert.ok(c.html_gzip_b64);
  assert.equal(c.url, null, 'url nao http vira null');
});

test('sentinela: origem sentinela, sem job e sem usuario; classe da avaliacao', async () => {
  const arquivo = falhaPronta({ meta: { passo: 'pagina:x' } });
  await kaizen.registrarSentinela({ caso: { tribunal: 'tjsp', capacidade: 'periodoJulgamento', params: { query: 'a' } }, avaliacao: { status: 'falha', classe: 'vazio_suspeito' }, r: { ok: true, resultados: [] }, arquivo });
  await kaizen.outbox.drenar();
  const [c] = corpos('jur-diagnostico');
  assert.deepEqual([c.origem, c.tipo, c.tribunal, c.classe, c.job_id, c.usuario_hash, c.passo], ['sentinela', 'falha', 'tjsp', 'vazio_suspeito', null, null, 'pagina:x']);
  assert.deepEqual(c.filtros.query, 'a');
});

test('payloadFalha: valido por construcao (tribunal, classe, passo, filtros, cortes)', () => {
  const c = payloadFalha({
    versao: '1.1.0', revisao: 'abc', origem: 'busca', tribunal: 'TJ SP!', classe: 'Coisa Estranha', passo: 'Passo Com Espaço',
    assinatura: 'a', erro: 'e'.repeat(5000), rota: 'local', params: { query: 'q'.repeat(10000), relator: 'r'.repeat(5000) },
    jobId: 'x'.repeat(100), usuarioHash: 'nao-hex', em: 0,
    captura: { meta: { url: 'https://a.br/p?token=1#x', titulo: 't'.repeat(900) } },
  });
  assert.match(c.tribunal, /^[a-z0-9_-]{2,40}$/);
  assert.match(c.classe, /^[a-z_]+(:[A-Za-z0-9_]+)?$/);
  assert.match(c.passo, /^[a-z0-9_:./#-]{1,80}$/);
  assert.equal(c.erro.length, 2000);
  assert.ok(Buffer.byteLength(JSON.stringify(c.filtros)) <= 4 * 1024);
  assert.equal(c.job_id, null);
  assert.equal(c.usuario_hash, null);
  assert.equal(c.url, 'https://a.br/p');
  assert.equal(c.titulo.length, 500);
  assert.equal(c.em, new Date(0).toISOString());
});

test('hashUsuario e filtrosDe', () => {
  assert.equal(hashUsuario('u', undefined), null);
  assert.equal(hashUsuario(null, 's'), null);
  assert.equal(hashUsuario('u', 's'), createHash('sha256').update('us').digest('hex'));
  assert.deepEqual(filtrosDe(null), { query: null, dataInicio: null, dataFim: null, dataPubInicio: null, dataPubFim: null, relator: null, juizados: null, numero: null });
  assert.equal(filtrosDe({ juizados: true }).juizados, true);
});

test('payloadRelato: titulo e descricao nunca vazios, linear invalido vira null, contexto <= 8 KB', () => {
  const r = payloadRelato({ titulo: '  ', descricao: '', autorEmail: 'sem-arroba', linear: { identifier: 'x', url: 'http://a' }, contexto: { grande: 'x'.repeat(20000) } });
  assert.ok(r.titulo.trim() && r.descricao.trim());
  assert.equal(r.autor_email, null);
  assert.equal(r.linear, null);
  assert.ok(Buffer.byteLength(JSON.stringify(r.contexto)) <= 8 * 1024);
  assert.deepEqual(payloadRelato({ titulo: 't', descricao: 'd', linear: { identifier: 'BRU-12', url: 'https://linear.app/x/BRU-12' } }).linear, { identifier: 'BRU-12', url: 'https://linear.app/x/BRU-12' });
});

test('linkFalha aponta para a origem do FFD', () => {
  assert.equal(kaizen.linkFalha('trf4|seletor|a b'), 'https://ffd.example/jur-falhas?assinatura=trf4%7Cseletor%7Ca%20b');
  assert.equal(kaizen.linkFalha(null), null);
});

test('kaizenNulo: mesma forma, tudo no-op', async () => {
  const n = kaizenNulo();
  assert.equal(await n.registrarErro(), undefined);
  assert.deepEqual(n.registrarConcluido(), { avisos: [] });
  assert.equal(await n.registrarSentinela(), undefined);
  assert.equal(n.enviarResumo(), undefined);
  assert.equal(n.enviarRelato(), false);
  assert.equal(n.linkFalha('a'), null);
  assert.equal(n.outbox.pendentes(), 0);
  assert.deepEqual(await n.outbox.drenar(), { enviados: 0, adiados: 0, descartados: 0 });
  n.fechar();
});

test('kaizen.db em WAL e so do dono', () => {
  const dir = tmp();
  const k = criarKaizen({ dir, env: {}, fetchFn });
  k.fechar();
  assert.equal(fs.statSync(path.join(dir, 'kaizen.db')).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(path.join(dir, 'kaizen.db')));
});

test('filtros: controle, surrogate solto e objeto nunca passam de 4 KB (fix 1)', () => {
  const ctrl = '\u0001'.repeat(100);
  const f = filtrosDe({ query: 'q', dataInicio: ctrl, dataFim: ctrl, dataPubInicio: ctrl, dataPubFim: ctrl, relator: ctrl, juizados: ctrl, numero: ctrl });
  assert.ok(Buffer.byteLength(JSON.stringify(f)) <= 4096);
  assert.ok(!/[\u0000-\u001f]/.test(JSON.stringify(Object.values(f))));
  const g = filtrosDe({ query: '\uD800'.repeat(5000), relator: '\uDC00'.repeat(500), numero: { a: 'x'.repeat(5000) }, juizados: Infinity });
  assert.ok(Buffer.byteLength(JSON.stringify(g)) <= 4096);
  assert.equal(g.juizados, null);
  const h = filtrosDe({ query: 'ação'.repeat(2000), relator: '中'.repeat(100), dataInicio: '中'.repeat(100), dataFim: '中'.repeat(100), dataPubInicio: '中'.repeat(100), dataPubFim: '中'.repeat(100), numero: '中'.repeat(100) });
  assert.ok(Buffer.byteLength(JSON.stringify(h)) <= 4096);
});

test('sentinela filtro_ignorado limpa a captura mesmo se o envio lancar (fix 2)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const arquivo = falhaPronta({ meta: { passo: 'x' }, html: '<p/>', png: PNG });
  const original = kaizen.outbox.enfileirar;
  kaizen.outbox.enfileirar = () => { throw new Error('boom'); };
  try {
    await kaizen.registrarSentinela({ caso: { tribunal: 'trf4', params: {} }, avaliacao: { classe: 'filtro_ignorado:periodoJulgamento', conferencia: [] }, r: { ok: true }, arquivo });
  } finally { kaizen.outbox.enfileirar = original; }
  assert.ok(!fs.existsSync(path.join(dirFalha(arquivo), 'tela.png')));
});

test('detalhe da conferencia e contexto do relato saem sanitizados; relato cru passa por payloadRelato (fix 3)', async () => {
  const c = payloadFalha({ tribunal: 'trf4', classe: 'filtro_ignorado:magistrado', passo: 'conferencia', assinatura: 'a', conferencia: [{ filtro: 'magistrado', detalhe: 'token=SEGREDO \u0001' }] });
  assert.doesNotMatch(JSON.stringify(c.conferencia), /SEGREDO|\\u0001/);
  const r = payloadRelato({ titulo: 't', descricao: 'd', contexto: { Erro: 'Bearer SEGREDO', n: 1 } });
  assert.doesNotMatch(JSON.stringify(r.contexto), /SEGREDO/);
  assert.equal(r.contexto.n, 1);
  assert.equal(kaizen.enviarRelato({ titulo: '', descricao: 'x', autor_email: 'a@b.c', em: 'lixo', linear: { identifier: 'nao', url: 'x' } }), true);
  await kaizen.outbox.drenar();
  const [u] = corpos('user-issues');
  assert.ok(u.titulo && u.servico === 'jurcrawler' && u.linear === null && u.autor_email === 'a@b.c' && !Number.isNaN(Date.parse(u.em)));
});

test('resumo com Infinity, NaN e negativo vira 0 (fix 4)', () => {
  const { resumo } = payloadResumo({ resumo: { rodados: Infinity, ok: NaN, falhas: -3, nao_verificaveis: '2' } });
  assert.deepEqual(resumo, { rodados: 0, ok: 0, falhas: 0, nao_verificaveis: 2 });
});

test('url sem ;jsessionid e em no futuro vira agora', () => {
  const c = payloadFalha({ tribunal: 'trf4', classe: 'seletor', passo: 'x', assinatura: 'a', em: Date.now() + 3 * 86400e3, captura: { meta: { url: 'https://a.br/p;jsessionid=ABC/q' } } });
  assert.equal(c.url, 'https://a.br/p/q');
  assert.ok(Date.parse(c.em) <= Date.now() + 1000);
});

test('conferencia so roda para filtro que o tribunal tem (tjdft nao tem juizados)', () => {
  const comuns = Array.from({ length: 5 }, (_, i) => ({ numeroProcesso: `0000${i}`, orgaoJulgador: '3ª Câmara Cível' }));
  const pedir = (comando) => kaizen.registrarConcluido(jobFalso({ comando, params: { query: 'x', juizados: true } }), { ok: true, resultados: comuns }, {}).avisos;
  assert.match(pedir('trf4')[0] || '', /filtro de juizados/, 'controle: trf4 tem juizados e confere');
  assert.deepEqual(pedir('tjdft'), []);
});
