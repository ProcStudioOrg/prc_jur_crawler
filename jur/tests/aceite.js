#!/usr/bin/env node
/**
 * Verifica mecanicamente o critério de aceite do CLAUDE-CODEGEN §7 para um tribunal.
 * Não lê relatório de agente: mede.
 *
 *   node tests/aceite.js TJRS
 *   node tests/aceite.js TJSC --origens comum,turmas          # --origem é o default
 *   node tests/aceite.js TJPR --flag --foro --origens comum,juizados
 *   node tests/aceite.js TRT9 --flag -g --origens 1,2
 *   node tests/aceite.js TRT9 --sem-desambiguacao      # quando não se aplica
 *   node tests/aceite.js TJRS --rapido                 # pula o que usa rede
 *
 * Exit 0 = todos os itens obrigatórios passaram.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.JUR_ROOT || path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const CODE = (argv.find((a) => !a.startsWith('--')) || '').toUpperCase();
const RAPIDO = argv.includes('--rapido');
const oIdx = argv.indexOf('--origens');
const ORIGENS = oIdx >= 0 ? argv[oIdx + 1].split(',') : ['comum', 'turmas'];
// a flag varia por tribunal: --origem (TJRS/TJSC), --foro (TJPR), -g (TRT9)
const fIdx = argv.indexOf('--flag');
const FLAG = fIdx >= 0 ? argv[fIdx + 1] : '--origem';
const SEM_DESAMB = argv.includes('--sem-desambiguacao');

if (!CODE) { console.error('uso: node tests/aceite.js <CODIGO> [--origens a,b] [--sem-desambiguacao] [--rapido]'); process.exit(2); }

const itens = [];
const check = (obrig, nome, fn) => {
  let ok = false, detalhe = '';
  try { const r = fn(); ok = !!(r && r.ok); detalhe = (r && r.detalhe) || ''; }
  catch (e) { detalhe = String(e.message || e).split('\n')[0].slice(0, 160); }
  itens.push({ obrig, nome, ok, detalhe });
  console.log(`${ok ? '✅' : obrig ? '❌' : '⚠️ '} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const cob = JSON.parse(fs.readFileSync(path.join(ROOT, 'cobertura', 'tribunais.json'), 'utf8'));
const trib = cob.tribunais.find((t) => t.codigo === CODE);
const cmd = trib && trib.jurisprudencia.comando;

function jur(args, { esperaFalha = false } = {}) {
  try {
    const out = execFileSync(path.join(ROOT, 'bin', 'jur'), args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    return { code: 0, out };
  } catch (e) {
    if (!esperaFalha && !e.stdout) throw e;
    return { code: e.status, out: e.stdout || '' };
  }
}
const ultimoJson = (s) => { const m = String(s).trim().split('\n').filter(Boolean).pop(); return JSON.parse(m); };
const busca = (extra = []) => ultimoJson(jur([cmd, '-q', 'dano moral', '-m', '1', '--json', ...extra]).out);
const total = (p) => p.totalResults ?? p.count ?? 0;

console.log(`\n=== ACEITE ${CODE} ${cmd ? `(jur ${cmd})` : ''} ===\n`);

// ---------- Registro (estático)
check(true, 'Registrado em cobertura/tribunais.json', () =>
  ({ ok: !!trib && !!cmd, detalhe: trib ? `status=${trib.jurisprudencia.status} acesso=${trib.jurisprudencia.acesso}` : 'ausente' }));

check(true, `CLAUDE-${CODE}.md existe`, () => {
  const p = path.join(ROOT, `CLAUDE-${CODE}.md`);
  if (!fs.existsSync(p)) return { ok: false, detalhe: 'não existe' };
  const s = fs.readFileSync(p, 'utf8');
  return { ok: /ressalva/i.test(s), detalhe: /ressalva/i.test(s) ? `${s.length} chars, tem §Ressalvas` : 'sem seção de ressalvas' };
});

check(true, 'Roteamento no CLAUDE.md', () =>
  ({ ok: new RegExp(`\\b${cmd}\\b`, 'i').test(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')) }));

check(true, 'Roteamento em skills/browser/SKILL.md', () =>
  ({ ok: new RegExp(`\\b${cmd}\\b`, 'i').test(fs.readFileSync(path.join(ROOT, 'skills', 'browser', 'SKILL.md'), 'utf8')),
     detalhe: 'sem isso a skill de busca nunca roteia para o tribunal' }));

// ---------- Mapeamento
const hc = path.join(ROOT, 'human-codegen', CODE);
check(true, 'human-codegen/ com prints', () => {
  if (!fs.existsSync(hc)) return { ok: false, detalhe: 'diretório não existe' };
  const todos = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? w(path.join(d, e.name)) : todos.push(e.name); })(hc);
  const png = todos.filter((f) => /\.(png|jpe?g)$/i.test(f)).length;
  return { ok: png > 0, detalhe: `${png} prints, ${todos.filter((f) => f.endsWith('.txt')).length} txt, ${todos.filter((f) => f.endsWith('.json')).length} json` };
});

check(true, 'INDEX.md sem pendências', () => {
  const p = path.join(hc, 'INDEX.md');
  if (!fs.existsSync(p)) return { ok: false, detalhe: 'INDEX.md não existe (rode node human-codegen/index.js)' };
  const s = fs.readFileSync(p, 'utf8');
  const pend = (s.match(/seções sem [^\n]+/g) || []);
  return { ok: pend.length === 0, detalhe: pend.length ? pend.join(' | ') : 'zero' };
});

check(false, 'Nomenclatura §3', () => {
  const maus = [];
  (function w(d, rel = '') { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) w(path.join(d, e.name), r);
    else if (e.name !== 'INDEX.md' && !/^\d{2}(\.\d{2})?-[a-z0-9-]+\.(png|jpe?g|txt|json|html)$/.test(e.name)) maus.push(r);
  } })(hc);
  return { ok: maus.length === 0, detalhe: maus.length ? `${maus.length} fora do padrão: ${maus.slice(0, 3).join(', ')}` : 'todos aderentes' };
});

// ---------- Funcionamento (rede)
if (!RAPIDO && cmd) {
  let base = null;
  check(true, 'Busca simples retorna resultados', () => {
    base = busca();
    return { ok: base.success === true && (base.count || 0) > 0, detalhe: `count=${base.count} total=${total(base)}` };
  });

  check(true, 'Filtro de data restringe de fato', () => {
    const amplo = total(base);
    const estreito = total(busca(['-di', '01/06/2026', '-df', '30/06/2026']));
    return { ok: estreito > 0 && estreito < amplo, detalhe: `sem data ${amplo} → com data ${estreito}` };
  });

  check(true, 'Paginação anda além da página 1', () => {
    const f = path.join(ROOT, 'resultados', `_aceite-${CODE}.json`);
    jur([cmd, '-q', 'dano moral', '-m', '3', '-o', f, '--json']);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const r = Array.isArray(d) ? d : d.results || d.resultados || [];
    const ids = new Set(r.map((x) => x.id || x.processo || x.numeroProcesso));
    fs.unlinkSync(f);
    return { ok: ids.size > 10, detalhe: `${ids.size} ids únicos em 3 páginas` };
  });

  if (!SEM_DESAMB) {
    // A prova é DISJUNÇÃO DE IDS, não diferença de contagem: quando as duas pontas batem no
    // teto técnico da base (TRT9 devolve 10.000 nos dois graus) as contagens ficam iguais e um
    // teste por contagem acusa "filtro ignorado" num filtro que funciona. Falso negativo.
    check(true, `Desambiguação ${FLAG} ${ORIGENS.join(' × ')} devolve conjuntos disjuntos`, () => {
      const idsDe = (valor) => {
        const f = path.join(ROOT, 'resultados', `_aceite-desamb-${CODE}-${valor}.json`);
        const r = jur([cmd, '-q', 'dano moral', FLAG, valor, '-m', '1', '-o', f, '--json']);
        const arr0 = JSON.parse(fs.readFileSync(f, 'utf8'));
        fs.unlinkSync(f);
        const arr = Array.isArray(arr0) ? arr0 : arr0.results || arr0.resultados || [];
        return { ids: new Set(arr.map((x) => String(x.id || x.processo || x.numeroProcesso))), total: total(ultimoJson(r.out)) };
      };
      const a = idsDe(ORIGENS[0]);
      const b = idsDe(ORIGENS[1]);
      const inter = [...a.ids].filter((x) => b.ids.has(x));
      const base = `${ORIGENS[0]}=${a.ids.size}ids/${a.total} · ${ORIGENS[1]}=${b.ids.size}ids/${b.total} · interseção=${inter.length}`;
      if (!a.ids.size || !b.ids.size) return { ok: false, detalhe: `${base} — uma das pontas voltou vazia` };
      if (inter.length) return { ok: false, detalhe: `${base} — NÃO disjunto, filtro não está sendo aplicado` };
      const teto = a.total === b.total;
      return { ok: true, detalhe: `${base}${teto ? ' (contagens iguais = teto técnico; disjunção prova o filtro)' : ''}` };
    });
  }

  check(true, 'Checker: nº real encontra, nº falso não', () => {
    const r = (base.results || base.resultados || [])[0];
    const f = path.join(ROOT, 'resultados', `_aceite2-${CODE}.json`);
    jur([cmd, '-q', 'dano moral', '-m', '1', '-o', f, '--json']);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const arr = Array.isArray(d) ? d : d.results || d.resultados || [];
    fs.unlinkSync(f);
    const num = (arr[0] || {}).processo || (arr[0] || {}).numeroProcesso;
    if (!num) return { ok: false, detalhe: 'não consegui extrair um nº de processo do resultado' };
    const real = jur([cmd, '-n', String(num), '--json'], { esperaFalha: true });
    const falso = jur([cmd, '-n', '9999999-99.2099.8.99.9999', '--json'], { esperaFalha: true });
    return { ok: real.code === 0 && falso.code === 1, detalhe: `real(${num}) exit=${real.code} · falso exit=${falso.code}` };
  });
}

// ---------- Resumo
const obrig = itens.filter((i) => i.obrig);
const falhas = obrig.filter((i) => !i.ok);
console.log(`\n${obrig.length - falhas.length}/${obrig.length} obrigatórios · ${falhas.length} falha(s)`);
if (falhas.length) { console.log('\nFalhou:'); for (const f of falhas) console.log(`  ❌ ${f.nome}${f.detalhe ? ` — ${f.detalhe}` : ''}`); }
process.exit(falhas.length ? 1 : 0);
