// src/CRPSNavigator.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

/**
 * Navigator do CRPS — Conselho de Recursos da Previdência Social.
 * Portal: https://jurisprudenciacrps.dataprev.gov.br/jurisprudencia
 *
 * POR QUE ESTE CRAWLER É DIFERENTE DE TODOS OS OUTROS DO REPO
 * ----------------------------------------------------------
 * Todo tribunal coberto até aqui tem busca pública. O CRPS não: o portal é um
 * **ServiceNow** (Service Portal + AngularJS) atrás de **login Gov.br**, e o gate
 * está na PORTA, não em parte do fluxo. Medido em 31/07/2026:
 *
 *   GET /jurisprudencia                  → 200 text/html (170 KB)  ← ARMADILHA
 *        ...mas o HTML é a TELA DE LOGIN. No Playwright headless a página tem
 *        ZERO inputs, ZERO selects, e um único botão: "Entrar com gov.br".
 *   GET /api/now/table/<qualquer>        → 401 "User is not authenticated"
 *   GET /api/now/sp/page?id=index&...    → 200, mas só descreve o widget de login
 *
 * O 200 do primeiro probe (27/07/2026) foi lido como "portal aberto" e não era.
 * Esta é a invariante do repo em forma nova: **HTTP 200 não é prova de acesso** —
 * prova de acesso é achar o campo de busca.
 *
 * CONSEQUÊNCIA DE DESENHO: não dá para autenticar sem humano (Gov.br pode exigir
 * 2FA e nível de conta prata/ouro). Então o crawler NÃO tenta logar sozinho. Ele:
 *   1. `--login`     abre um Chrome REAL, você autentica, e o perfil guarda a sessão;
 *   2. `--capturar`  enquanto a sessão está viva, grava TUDO que só existe logado
 *                    (prints, selects já populados, HTML, e o XHR de cada busca) —
 *                    é o material da Fase 3 da skill `codegen`, que sem login é
 *                    impossível de obter;
 *   3. `--status`    mede se a sessão ainda vive, e registra a medição em disco.
 *
 * POR QUE `--capturar` EXISTE E É O PASSO MAIS IMPORTANTE
 * A sessão Gov.br é o recurso escasso: pode durar minutos. Não dá para "voltar
 * depois e olhar com calma". Então no primeiro login a gente extrai o mapa inteiro
 * de uma vez, e o crawler de busca nasce depois, a partir do capturado — offline.
 *
 * PERFIL PERSISTENTE, NÃO O SEU CHROME
 * `launchPersistentContext` trava o diretório de perfil: se apontar para o seu
 * Chrome pessoal com ele aberto, falha. Por isso o default é um perfil dedicado
 * em ~/.config/jur-crps-profile. Ele guarda cookies de sessão Gov.br —
 * trate como credencial: fora do git, chmod 700.
 *
 * O QUE AINDA NÃO SE SABE (e por isso não está codado)
 *   - o TTL da sessão Gov.br neste portal → é o que `--status` mede;
 *   - o contrato de busca (endpoint, payload, paginação) → é o que `--capturar` extrai;
 *   - se o inteiro teor vem no payload ou exige request extra.
 * Nada disso está presumido aqui. Quando a captura existir, o CRPSCrawler nasce.
 */

const BASE_URL = 'https://jurisprudenciacrps.dataprev.gov.br';
const JUR_URL = `${BASE_URL}/jurisprudencia`;

/** Perfil dedicado. NUNCA aponte para o Chrome pessoal: o diretório tem lock. */
const DEFAULT_PROFILE = path.join(os.homedir(), '.config', 'jur-crps-profile');

/** Onde a captura da sessão logada é gravada (material da skill `codegen`). */
const DEFAULT_CAPTURE_DIR = path.join(__dirname, '..', 'human-codegen', 'CRPS');

/** Log de medições de sessão — alimenta a curva de TTL. */
const SESSION_LOG = path.join(__dirname, '..', 'human-codegen', 'CRPS', 'sessao-ttl.log');

class CRPSNavigator {
  constructor({ profileDir = DEFAULT_PROFILE, captureDir = DEFAULT_CAPTURE_DIR, log = console.log } = {}) {
    this.profileDir = profileDir;
    this.captureDir = captureDir;
    this.log = log;
  }

  /** Sobe o contexto persistente. headless=false para o login humano. */
  async _context({ headless }) {
    const { chromium } = require('playwright');
    fs.mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });

    // channel:'chrome' usa o Chrome instalado — o Gov.br é menos hostil com ele
    // do que com o Chromium do Playwright. Cai para o chromium se não houver.
    const opts = {
      headless,
      viewport: { width: 1440, height: 1100 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    };
    try {
      return await chromium.launchPersistentContext(this.profileDir, { ...opts, channel: 'chrome' });
    } catch (e) {
      this.log(`[aviso] Chrome não disponível (${e.message.split('\n')[0]}); usando Chromium do Playwright`);
      return await chromium.launchPersistentContext(this.profileDir, opts);
    }
  }

  /**
   * Autenticado ou não? A prova NÃO é o HTTP 200 — é a ausência do botão de login
   * e a presença de campo de busca. Foi exatamente aqui que o probe de 27/07 errou.
   */
  async _estaAutenticado(page) {
    const txt = (await page.locator('body').innerText().catch(() => '')) || '';
    const temBotaoLogin = /entrar com gov\.br/i.test(txt);
    const nCampos = await page.locator('input:visible, select:visible, textarea:visible').count();
    return { autenticado: !temBotaoLogin && nCampos > 0, temBotaoLogin, nCampos, trecho: txt.slice(0, 200) };
  }

  /**
   * `--status`: sobe headless com o perfil salvo e responde se a sessão vive.
   * Registra a medição em sessao-ttl.log para montar a curva de expiração.
   */
  async status({ quiet = false } = {}) {
    const ctx = await this._context({ headless: true });
    try {
      const page = await ctx.newPage();
      const resp = await page.goto(JUR_URL, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => null);
      const st = await this._estaAutenticado(page);
      const medicao = {
        quando: new Date().toISOString(),
        http: resp ? resp.status() : null,
        url: page.url(),
        ...st,
      };

      fs.mkdirSync(path.dirname(SESSION_LOG), { recursive: true });
      fs.appendFileSync(
        SESSION_LOG,
        `${medicao.quando}\tautenticado=${medicao.autenticado}\thttp=${medicao.http}\tcampos=${medicao.nCampos}\n`,
      );

      if (!quiet) {
        this.log(medicao.autenticado
          ? `✅ sessão VIVA (${medicao.nCampos} campos visíveis) — medição gravada em ${SESSION_LOG}`
          : `❌ sessão MORTA/ausente — o portal mostra o login. Rode: jur crps --login`);
      }
      return medicao;
    } finally {
      await ctx.close();
    }
  }

  /**
   * `--login`: abre o Chrome real, espera VOCÊ autenticar no Gov.br e confirma.
   * Não automatiza credencial nem 2FA de propósito — é a sua identidade Gov.br.
   */
  async login({ timeoutMin = 10 } = {}) {
    const ctx = await this._context({ headless: false });
    const page = ctx.pages()[0] || (await ctx.newPage());

    this.log('='.repeat(64));
    this.log('CRPS — login Gov.br (uma vez; a sessão fica no perfil dedicado)');
    this.log('='.repeat(64));
    this.log(`Perfil: ${this.profileDir}`);
    this.log('Abrindo o portal. Clique em "Entrar com gov.br" e conclua o login.');
    this.log(`Aguardo até ${timeoutMin} min. NÃO feche a janela — eu detecto sozinho.`);

    await page.goto(JUR_URL, { waitUntil: 'networkidle', timeout: 90000 });

    const limite = Date.now() + timeoutMin * 60_000;
    let st = await this._estaAutenticado(page);
    while (!st.autenticado && Date.now() < limite) {
      await page.waitForTimeout(3000);
      st = await this._estaAutenticado(page).catch(() => ({ autenticado: false, nCampos: 0 }));
    }

    if (!st.autenticado) {
      this.log('❌ tempo esgotado sem autenticação. Nada foi salvo além do perfil vazio.');
      await ctx.close();
      return { autenticado: false };
    }

    this.log(`✅ autenticado — ${st.nCampos} campos visíveis. Sessão guardada no perfil.`);
    await this.status({ quiet: true }).catch(() => {});
    return { autenticado: true, ctx, page };
  }

  /**
   * `--capturar`: com a sessão viva, extrai o mapa inteiro da área logada.
   * Grava prints, HTML, todos os selects JÁ POPULADOS (AJAX) e o XHR de cada
   * ação sua — inclusive o da BUSCA, que é o contrato que o crawler vai copiar.
   *
   * Fica aberto gravando até você apertar ENTER no terminal. Faça neste meio
   * tempo: uma busca simples, abrir um resultado, e paginar. É isso que vira
   * o CRPSCrawler depois, offline.
   */
  async capturar({ ctx, page, interativo = true } = {}) {
    let proprio = false;
    if (!ctx) {
      ctx = await this._context({ headless: false });
      page = ctx.pages()[0] || (await ctx.newPage());
      await page.goto(JUR_URL, { waitUntil: 'networkidle', timeout: 90000 });
      proprio = true;
    }

    const st = await this._estaAutenticado(page);
    if (!st.autenticado) {
      this.log('❌ sessão não autenticada — rode `jur crps --login` primeiro.');
      if (proprio) await ctx.close();
      return { ok: false };
    }

    fs.mkdirSync(this.captureDir, { recursive: true });
    const xhr = [];
    const registrar = (r) => {
      if (!['xhr', 'fetch'].includes(r.resourceType())) return;
      xhr.push({ quando: new Date().toISOString(), metodo: r.method(), url: r.url(), post: (r.postData() || '').slice(0, 4000) });
    };
    ctx.on('request', registrar);
    ctx.on('response', async (r) => {
      if (!['xhr', 'fetch'].includes(r.request().resourceType())) return;
      const e = xhr.find((x) => x.url === r.url() && x.status === undefined);
      if (!e) return;
      e.status = r.status();
      e.contentType = r.headers()['content-type'];
      try {
        const body = await r.body();
        e.tamanho = body.length;
        // amostra do corpo: é onde se descobre se a ementa/inteiro teor já vem na busca
        if (/json|text/.test(e.contentType || '')) e.amostra = body.toString('utf8').slice(0, 4000);
      } catch { /* corpo indisponível — normal em redirect */ }
    });

    const dump = async (tag) => {
      const slug = String(tag).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await page.screenshot({ path: path.join(this.captureDir, `${slug}.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(this.captureDir, `${slug}.html`), await page.content().catch(() => ''));

      const campos = [];
      for (const el of await page.locator('input, select, textarea').all()) {
        const tipo = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '?');
        const info = {
          tag: tipo,
          name: await el.getAttribute('name').catch(() => null),
          id: await el.getAttribute('id').catch(() => null),
          type: await el.getAttribute('type').catch(() => null),
          placeholder: await el.getAttribute('placeholder').catch(() => null),
          ngModel: await el.getAttribute('ng-model').catch(() => null),
          label: await el.getAttribute('aria-label').catch(() => null),
        };
        // selects: enumerar TODAS as options (é AJAX; o HTML estático vem vazio)
        if (tipo === 'select') {
          info.options = await el.locator('option')
            .evaluateAll((os) => os.map((o) => ({ value: o.value, texto: o.textContent.trim() })))
            .catch(() => []);
        }
        campos.push(info);
      }
      fs.writeFileSync(path.join(this.captureDir, `${slug}-campos.json`), JSON.stringify(campos, null, 2));
      this.log(`  📸 ${slug}: ${campos.length} campos (${campos.filter((c) => c.tag === 'select').length} selects)`);
    };

    this.log('');
    this.log('='.repeat(64));
    this.log('CAPTURA ATIVA — gravando prints, campos e todo XHR');
    this.log('='.repeat(64));
    await dump('01-area-logada');

    if (interativo) {
      this.log('');
      this.log('AGORA, na janela do Chrome, faça nesta ordem:');
      this.log('  1. uma busca simples (um termo, sem filtro)');
      this.log('  2. abra um resultado e vá até o inteiro teor');
      this.log('  3. volte e avance uma página de resultados');
      this.log('  4. abra os combos de filtro (órgão, tipo, data)');
      this.log('');
      this.log('>>> Terminou? Aperte ENTER aqui para fechar e gravar tudo. <<<');
      await new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('', () => { rl.close(); resolve(); });
      });
      await dump('02-estado-final');
    }

    const arqXhr = path.join(this.captureDir, 'xhr-sessao.json');
    fs.writeFileSync(arqXhr, JSON.stringify(xhr, null, 2));

    // o que interessa para o crawler: chamadas com corpo, fora de asset
    const candidatos = xhr.filter((x) => x.status === 200 && /json/.test(x.contentType || '') && (x.tamanho || 0) > 500);
    this.log('');
    this.log(`✅ capturado em ${this.captureDir}`);
    this.log(`   ${xhr.length} chamadas XHR gravadas em ${path.basename(arqXhr)}`);
    this.log(`   ${candidatos.length} candidatas a endpoint de dados:`);
    for (const c of candidatos.slice(0, 15)) {
      this.log(`     ${c.metodo} ${c.url.replace(BASE_URL, '')} (${c.tamanho} bytes)`);
    }

    if (proprio) await ctx.close();
    return { ok: true, xhr: xhr.length, candidatos: candidatos.length, dir: this.captureDir };
  }
}

module.exports = CRPSNavigator;
module.exports.BASE_URL = BASE_URL;
module.exports.JUR_URL = JUR_URL;
module.exports.DEFAULT_PROFILE = DEFAULT_PROFILE;
