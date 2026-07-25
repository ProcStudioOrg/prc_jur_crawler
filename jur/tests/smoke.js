#!/usr/bin/env node
/**
 * Smoke test recorrente: para cada tribunal 🟢 em cobertura/tribunais.json, roda uma busca
 * mínima e classifica o resultado. Serve para detectar, sem intervenção humana, quando um
 * tribunal muda o site, passa a bloquear, ou simplesmente cai.
 *
 *   node tests/smoke.js                 # todos os tribunais com status ok
 *   node tests/smoke.js tjgo tjpa       # só esses
 *   node tests/smoke.js --todos         # inclui instavel/sem-acesso (espera falha neles)
 *   node tests/smoke.js --json          # saída JSON, para CI/cron
 *   node tests/smoke.js --timeout 120   # segundos por tribunal (default 90)
 *
 * Exit code 0 = nenhuma regressão. 1 = algum tribunal que deveria funcionar falhou.
 *
 * O classificador distingue os casos que pedem consertos diferentes:
 *   ok / vazio / bloqueio / timeout / erro   -> ver skills/fixer/SKILL.md
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JUR = path.join(ROOT, 'bin', 'jur');
const COBERTURA = path.join(ROOT, 'cobertura', 'tribunais.json');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const TODOS = argv.includes('--todos');
const tIdx = argv.indexOf('--timeout');
const TIMEOUT = (tIdx >= 0 ? parseInt(argv[tIdx + 1], 10) : 90) * 1000;
// o `tIdx >= 0` não é decorativo: sem ele, tIdx = -1 faz o índice a descartar virar 0 e o
// primeiro tribunal pedido é comido — `smoke.js tjrs` rodava os 7 tribunais em silêncio
const pedidos = argv.filter((a, i) => !a.startsWith('--') && !(tIdx >= 0 && i === tIdx + 1));

/** Termo neutro e período recente: precisa devolver resultado em qualquer tribunal ativo. */
const CONSULTA = { termo: 'dano moral', meses: 12 };

const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function periodo() {
  const fim = new Date();
  const ini = new Date(fim);
  ini.setMonth(ini.getMonth() - CONSULTA.meses);
  return [ddmmyyyy(ini), ddmmyyyy(fim)];
}

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/** Padrões que denunciam bloqueio em vez de bug nosso. */
const BLOQUEIO = /cloudflare|turnstile|captcha|recaptcha|just a moment|verifica(ç|c)(ã|a)o de navegador|access denied|forbidden|403|blocked/i;

/** Mensagem de erro em uma linha — stack de Playwright estoura a tabela. */
const umaLinha = (s) => String(s).split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160);

function classificar({ code, stdout, stderr, timedOut }) {
  const saida = `${stdout}\n${stderr}`;
  if (timedOut) return { status: 'timeout', detalhe: `sem resposta em ${TIMEOUT / 1000}s` };
  if (BLOQUEIO.test(saida)) return { status: 'bloqueio', detalhe: (saida.match(BLOQUEIO) || [])[0] };

  let payload = null;
  const m = stdout.match(/\{[\s\S]*\}\s*$/);
  if (m) { try { payload = JSON.parse(m[0]); } catch { /* saída não-JSON */ } }

  if (payload && payload.success === false) return { status: 'erro', detalhe: umaLinha(payload.error || 'success:false') };
  if (payload && payload.success === true) {
    const n = payload.count ?? payload.totalResults ?? 0;
    if (!n) return { status: 'vazio', detalhe: 'success:true mas 0 resultados', payload };
    return { status: 'ok', detalhe: `${n} resultados`, payload };
  }
  if (code !== 0) return { status: 'erro', detalhe: umaLinha(stderr.trim() || `exit ${code}`) };
  return { status: 'erro', detalhe: 'não foi possível interpretar a saída' };
}

function rodar(cmd) {
  const [di, df] = periodo();
  const args = [cmd, '-q', CONSULTA.termo, '-di', di, '-df', df, '-m', '1', '--json'];
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(JUR, args, { cwd: ROOT });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, TIMEOUT);
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ...classificar({ code, stdout, stderr, timedOut }), ms: Date.now() - t0, args });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: 'erro', detalhe: umaLinha(e.message), ms: Date.now() - t0, args });
    });
  });
}

const ICONE = { ok: '🟢', vazio: '🟡', bloqueio: '🔴', timeout: '🔴', erro: '🔴' };

async function main() {
  if (!fs.existsSync(COBERTURA)) {
    console.error('cobertura/tribunais.json não existe — rode `node cobertura/build.js` primeiro.');
    process.exit(2);
  }
  const { tribunais } = JSON.parse(fs.readFileSync(COBERTURA, 'utf8'));

  let alvos = tribunais.filter((t) => t.jurisprudencia.comando);
  if (!TODOS) alvos = alvos.filter((t) => t.jurisprudencia.status === 'ok');
  if (pedidos.length) alvos = alvos.filter((t) => pedidos.includes(t.jurisprudencia.comando));

  if (!alvos.length) {
    console.error(`nenhum tribunal corresponde a: ${pedidos.join(', ') || '(todos)'}`);
    process.exit(2);
  }

  const [di, df] = periodo();
  log(`smoke: ${alvos.length} tribunais · termo "${CONSULTA.termo}" · ${di} a ${df} · timeout ${TIMEOUT / 1000}s\n`);

  // paralelo: cada crawler sobe o próprio processo
  const resultados = await Promise.all(
    alvos.map(async (t) => {
      const r = await rodar(t.jurisprudencia.comando);
      const esperado = t.jurisprudencia.status; // ok | instavel | sem-acesso
      const regressao = esperado === 'ok' && r.status !== 'ok';
      log(`${ICONE[r.status]} ${t.codigo.padEnd(6)} ${String(r.status).padEnd(9)} ${String(Math.round(r.ms / 1000) + 's').padStart(5)}  ${r.detalhe}${regressao ? '   ← REGRESSÃO' : ''}`);
      return {
        tribunal: t.codigo,
        comando: t.jurisprudencia.comando,
        esperado,
        status: r.status,
        detalhe: r.detalhe,
        ms: r.ms,
        regressao,
      };
    }),
  );

  const regressoes = resultados.filter((r) => r.regressao);
  const relatorio = {
    consulta: { ...CONSULTA, di, df },
    total: resultados.length,
    ok: resultados.filter((r) => r.status === 'ok').length,
    regressoes: regressoes.length,
    resultados,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(relatorio, null, 2));
  } else {
    log(`\n${relatorio.ok}/${relatorio.total} ok · ${regressoes.length} regressões`);
    if (regressoes.length) {
      log('\nTribunais que deveriam funcionar e falharam:');
      for (const r of regressoes) log(`  ${r.tribunal} (${r.status}): ${r.detalhe}`);
      log('\nDiagnóstico: skills/fixer/SKILL.md — classifique layout × bloqueio antes de editar código.');
    }
  }

  const dir = path.join(ROOT, 'resultados');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const arq = path.join(dir, `smoke-${stamp}.json`);
  fs.writeFileSync(arq, JSON.stringify(relatorio, null, 2) + '\n');
  log(`\nrelatório: ${path.relative(ROOT, arq)}`);

  process.exit(regressoes.length ? 1 : 0);
}

main();
