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
 *   node tests/smoke.js --familia-completa  # não colapsa famílias (ver abaixo)
 *
 * FAMÍLIAS DE HOST ÚNICO: os 26 comandos da Justiça do Trabalho (tst, trt1..trt24,
 * csjt) são o MESMO código batendo no MESMO host (o Falcão). Rodá-los em paralelo
 * rende HTTP 429 e reporta a Justiça do Trabalho inteira como bloqueada — falso
 * positivo. Por isso o smoke roda só o CANÁRIO da família (o TRT9); os outros 25 são
 * pulados, porque não acrescentam sinal. `--familia-completa` roda todos, mas
 * SERIALIZADOS e espaçados, e ainda assim pode bater no limite de taxa.
 *
 * Exit code 0 = nenhuma regressão. 1 = algum tribunal que deveria funcionar falhou.
 *
 * O classificador distingue os casos que pedem consertos diferentes:
 *   ok / vazio / bloqueio / timeout / erro   -> ver skills/fixer/SKILL.md
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const catalogo = require('../servidor/catalogo');

const ROOT = path.resolve(__dirname, '..');
const JUR = path.join(ROOT, 'bin', 'jur');
const COBERTURA = path.join(ROOT, 'cobertura', 'tribunais.json');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const TODOS = argv.includes('--todos');
const FAMILIA_COMPLETA = argv.includes('--familia-completa');
const tIdx = argv.indexOf('--timeout');
const TIMEOUT = (tIdx >= 0 ? parseInt(argv[tIdx + 1], 10) : 90) * 1000;
// o `tIdx >= 0` não é decorativo: sem ele, tIdx = -1 faz o índice a descartar virar 0 e o
// primeiro tribunal pedido é comido — `smoke.js tjrs` rodava os 7 tribunais em silêncio
const pedidos = argv.filter((a, i) => !a.startsWith('--') && !(tIdx >= 0 && i === tIdx + 1));

/** Termo neutro e período recente: precisa devolver resultado em qualquer tribunal ativo. */
const CONSULTA = { termo: 'dano moral', meses: 12 };

/**
 * Termo alternativo por comando — para bases em que "dano moral" é ZERO LEGÍTIMO.
 *
 * "dano moral" não é neutro fora do Judiciário. Medido no TCE-RJ em 16/08/2026:
 * `moral` = 0 e `dano moral` = 0 em toda a base, enquanto `dano` = 85 e
 * `licitação` = 267 — a base de controle externo simplesmente não tem essa
 * matéria. Sem este override o smoke marcaria REGRESSÃO num crawler saudável,
 * que é o pior defeito possível num teste de fumaça: ensinar a ignorá-lo.
 *
 * ⚠️ Só entre aqui com o zero PROVADO (contagem do termo alternativo > 0 e do
 * termo padrão = 0 na base inteira, sem janela de data). Zero por filtro,
 * encoding ou captcha continua sendo regressão — não o esconda aqui.
 * TCE-PR e TCE-SP passam com o termo padrão e por isso NÃO estão nesta lista.
 */
const TERMO_POR_COMANDO = {
  tcerj: 'licitação', // base curada de 1.089 docs; ver CLAUDE-TCERJ.md
  // TCE-MG: base de excertos de CONSULTA (controle externo), 9 a 98 docs/ano.
  // Zero PROVADO na mesma janela do smoke (20/08/2025–20/08/2026):
  //   "dano moral" = 0 · '"dano moral"' entre aspas = 0 · `dano E moral` = 0
  //   `dano` = 3 · `moral` = 2 · `licitação` = 12
  // Ou seja: os dois termos existem separados e a INTERSECAO e vazia — nao e
  // filtro, encoding nem captcha. (Aqui o espaco tambem nao e conectivo, entao
  // "dano moral" seria zero de sintaxe de qualquer jeito.) Ver CLAUDE-TCEMG.md.
  tcemg: 'licitação',
  // TCE-PA: controle externo do Estado do Pará (Pesquisa Integrada).
  // ⚠️ AQUI O ZERO É DA JANELA, NÃO DA BASE — e por isso a medição vai inteira,
  // em vez de encaixar o caso na regra acima. Medido em 21/08/2026:
  //   `dano moral` na BASE inteira      =    22   (existe, mas é raro e antigo)
  //   `dano moral` na janela do smoke   =     0   (21/08/2025–21/08/2026)
  //   `dano`  na base = 5.414 · `moral` na base = 34
  //   `licitação` NA MESMA JANELA       =   109   ← prova que a janela não zera
  // Ou seja: a janela funciona (109 com outro termo), o termo funciona (22 na
  // base), e a interseção dos dois é que é vazia. Não é filtro, não é encoding
  // e não é captcha — se fosse WAF, o crawler teria abortado com erro explícito
  // em vez de devolver success:true. Ver CLAUDE-TCEPA.md.
  tcepa: 'licitação',
};

const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function periodo() {
  const fim = new Date();
  const ini = new Date(fim);
  ini.setMonth(ini.getMonth() - CONSULTA.meses);
  return [ddmmyyyy(ini), ddmmyyyy(fim)];
}

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/**
 * Padrões que denunciam bloqueio em vez de bug nosso.
 *
 * ATENÇÃO: WAF devolve **HTTP 200** com a página de desafio. Status e tamanho da resposta
 * não provam sucesso — só o conteúdo prova. Os padrões do F5/Shape (TJSC) foram acrescentados
 * depois de eu mesmo interpretar `200 + 76 KB` como "portal aberto" quando era o challenge.
 */
const BLOQUEIO = new RegExp([
  'cloudflare', 'turnstile', 'captcha', 'recaptcha', 'just a moment',
  'access denied', 'forbidden', '\\b403\\b', 'blocked',
  // 429 é bloqueio, não bug: a ação é ESPERAR, não depurar seletor.
  // Aparece quando se roda o aceite/testes em rajada contra o mesmo host (Falcão/TRT).
  '\\b429\\b', 'too many requests', 'rate limit',
  // F5 / Shape — o desafio do TJSC e de vários portais .jus.br
  'bobcmn', 'your support id is', 'enable javascript to view the page',
  // texto em português dos portais institucionais
  'verifica(ç|c)(ã|a)o de (navegador|seguran(ç|c)a)',
  'acesso foi bloqueado', 'digite o c(ó|o)digo exibido',
].join('|'), 'i');

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
  const termo = TERMO_POR_COMANDO[cmd] || CONSULTA.termo;
  const args = [cmd, '-q', termo, '-di', di, '-df', df, '-m', '1', '--json'];
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

  // Reconciliação catalogo x CLI, primeiro de tudo: falha cedo e barata, antes
  // de qualquer acesso de rede — ver tests/reconciliacao.test.js.
  {
    const FORA_DE_BUSCA = new Set(['crps']);
    const noCatalogo = new Set(catalogo.listar().map((t) => t.comando));
    const faltando = catalogo.comandosDaCli()
      .filter((c) => !FORA_DE_BUSCA.has(c) && !noCatalogo.has(c));
    if (faltando.length) {
      console.error(`FALHA: comandos da CLI ausentes do catalogo: ${faltando.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('OK  reconciliacao catalogo x CLI');
    }
  }

  const { tribunais } = JSON.parse(fs.readFileSync(COBERTURA, 'utf8'));

  let alvos = tribunais.filter((t) => t.jurisprudencia.comando);
  if (!TODOS) alvos = alvos.filter((t) => t.jurisprudencia.status === 'ok');
  if (pedidos.length) alvos = alvos.filter((t) => pedidos.includes(t.jurisprudencia.comando));

  // Família de host único: sem pedido explícito, roda só o canário (ver cabeçalho).
  let colapsados = [];
  if (!pedidos.length && !FAMILIA_COMPLETA) {
    const antes = alvos.length;
    alvos = alvos.filter((t) => !t.jurisprudencia.familia || t.jurisprudencia.canario);
    colapsados = [];
    if (alvos.length !== antes) {
      const familias = [...new Set(tribunais
        .filter((t) => t.jurisprudencia.familia && !t.jurisprudencia.canario)
        .map((t) => t.jurisprudencia.familia))];
      colapsados = familias;
      log(`famílias de host único colapsadas no canário: ${familias.join(', ')} `
        + `(${antes - alvos.length} comandos pulados — mesmo código, mesmo host; `
        + `use --familia-completa para rodar todos)\n`);
    }
  }

  if (!alvos.length) {
    console.error(`nenhum tribunal corresponde a: ${pedidos.join(', ') || '(todos)'}`);
    process.exit(2);
  }

  const [di, df] = periodo();
  log(`smoke: ${alvos.length} tribunais · termo "${CONSULTA.termo}" · ${di} a ${df} · timeout ${TIMEOUT / 1000}s\n`);

  const executar = async (t) => {
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
  };

  // Tribunais independentes vão em paralelo (cada crawler sobe o próprio processo).
  // Os de uma FAMÍLIA compartilham host: dentro da família é serial e espaçado, senão
  // o próprio smoke provoca o 429 que ele deveria estar detectando.
  const independentes = alvos.filter((t) => !t.jurisprudencia.familia);
  const porFamilia = new Map();
  for (const t of alvos.filter((x) => x.jurisprudencia.familia)) {
    const f = t.jurisprudencia.familia;
    if (!porFamilia.has(f)) porFamilia.set(f, []);
    porFamilia.get(f).push(t);
  }

  const serial = async (lista) => {
    const out = [];
    for (const t of lista) {
      out.push(await executar(t));
      if (t !== lista[lista.length - 1]) await new Promise((r) => setTimeout(r, 3000));
    }
    return out;
  };

  const resultados = (await Promise.all([
    ...independentes.map((t) => executar(t).then((r) => [r])),
    ...[...porFamilia.values()].map((lista) => serial(lista)),
  ])).flat();

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
