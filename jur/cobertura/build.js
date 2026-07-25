#!/usr/bin/env node
/**
 * Gera `cobertura/tribunais.json` (fonte da verdade) e `cobertura/CLAUDE-COBERTURA.md`
 * a partir de tres fontes:
 *
 *   1. cobertura/base/*.csv                     -> sistema processual por instancia (planilha Digesto)
 *   2. cobertura/base/tribunais-brasileiros/    -> URLs de consulta processual + screenshots (repo brpl20)
 *   3. este arquivo (JURISPRUDENCIA / REPO)     -> o que o crawler `jur` de fato cobre
 *
 * Rode: node cobertura/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(__dirname, 'base');
const TB = path.join(BASE, 'tribunais-brasileiros');

// ---------------------------------------------------------------- referencia

const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

/** "Acre" -> "AC". A planilha Digesto usa nome por extenso; o repo de URLs usa sigla. */
const NOME_UF = Object.fromEntries(Object.entries(UF_NOME).map(([sigla, nome]) => [nome.toLowerCase(), sigla]));
NOME_UF['distrito federal e territórios'] = 'DF';
NOME_UF['pará e amapá'] = 'PA';
NOME_UF['rondônia e acre'] = 'RO';
NOME_UF['amazonas e roraima'] = 'AM';
NOME_UF['distrito federal e tocantins'] = 'DF';
NOME_UF['são paulo (campinas - interior)'] = 'SP';

const siglaUf = (v) => NOME_UF[v.trim().toLowerCase()] || (/^[A-Z]{2}$/.test(v.trim()) ? v.trim() : null);

const NOME_TRIBUNAL = {
  TJDFT: 'Tribunal de Justiça do Distrito Federal e dos Territórios',
  TRF1: 'Tribunal Regional Federal da 1ª Região',
  TRF2: 'Tribunal Regional Federal da 2ª Região',
  TRF3: 'Tribunal Regional Federal da 3ª Região',
  TRF4: 'Tribunal Regional Federal da 4ª Região',
  TRF5: 'Tribunal Regional Federal da 5ª Região',
  TRF6: 'Tribunal Regional Federal da 6ª Região',
  STF: 'Supremo Tribunal Federal',
  STJ: 'Superior Tribunal de Justiça',
  TST: 'Tribunal Superior do Trabalho',
  TCU: 'Tribunal de Contas da União',
};

/**
 * Jurisprudencia: SO entra aqui URL que foi efetivamente verificada (crawler rodando
 * ou mapeamento humano em human-codegen/). Tribunal ausente = `nao-mapeado`.
 * Nao inventar URL: `jur codegen` existe justamente para descobrir.
 */
const JURISPRUDENCIA = {
  TRF1: { url: 'https://jurisprudencia.cjf.jus.br/trf1/index.xhtml', comando: 'trf1', acesso: 'browser', status: 'instavel', nota: 'Host do CJF resolve mas não responde (verificado 24/07/2026, também fora via curl) — pode ser queda temporária; reteste com tests/smoke.js' },
  TRF2: { url: 'https://juris.trf2.jus.br/consulta.php', comando: 'trf2', acesso: 'browser', status: 'quebrado', nota: 'juris.trf2.jus.br → NXDOMAIN. O TRF2 migrou a jurisprudência para o módulo do e-Proc: https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar (mesma família do TRF4). Crawler precisa ser reescrito a partir do TRF4Crawler.' },
  TRF3: { url: 'https://web.trf3.jus.br/jurisprudencia/', comando: 'trf3', acesso: 'browser', status: 'instavel', nota: 'Verificação de navegador falha em headless; fallback Python (DrissionPage)' },
  TRF4: { url: 'https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php', comando: 'trf4', acesso: 'browser', status: 'ok' },
  TRF5: { url: 'https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa', comando: 'trf5', acesso: 'browser', status: 'ok' },
  TJGO: { url: 'https://projudi.tjgo.jus.br/ConsultaJurisprudencia', comando: 'tjgo', acesso: 'http', status: 'ok', nota: 'POST direto ISO-8859-1; Turnstile só no download do original' },
  TJPA: { url: 'https://jurisprudencia.tjpa.jus.br/bff/api/decisoes', comando: 'tjpa', acesso: 'api', status: 'ok', nota: 'API JSON aberta; ementa + inteiro teor no mesmo payload' },
  TJPR: { url: 'https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do', comando: 'tjpr', acesso: 'http', status: 'ok', nota: 'Struts próprio (POST em pesquisa.do), sem browser e sem bloqueio. CORPO DO POST EM ISO-8859-1 — em UTF-8 devolve 0 resultados em silêncio. Só 2º grau. Justiça Comum × Juizados pela lista de ids em idOrgaoJulgador (flag --foro): o combo do site (ambito) NÃO separa — ambito=6 "TRIBUNAL DE JUSTIÇA" contém a 6ª Turma Recursal. Toda busca vem somada com decisões da Corte IDH; use o contador "da Jurisprudência do Tribunal de Justiça". Inteiro teor já vem no HTML da ficha (div#texto<id>). PROX não funciona.' },
  TJRS: { url: 'https://www.tjrs.jus.br/buscas/jurisprudencia/ajax.php', comando: 'tjrs', acesso: 'http', status: 'ok', nota: 'Solr atrás de proxy PHP (POST action=consultas_solr_ajax); sem bloqueio nem sessão; inteiro teor embutido em base64 (ISO-8859-1); só 2º grau; Justiça Comum × Turmas Recursais pelo cod_tribunal' },
  TJSC: { url: 'https://eprocwebcon.tjsc.jus.br/consulta1g/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar', comando: 'tjsc', acesso: 'browser', status: 'ok', nota: 'Módulo eproc-jur, mesma família do TRF4. Browser obrigatório: host atrás de verificação de segurança F5/Shape (JS challenge) — e o UA padrão do Playwright headless é barrado, precisa de UA de Chrome comum. Justiça Comum × Turmas Recursais pelo combo Origem (#selOrigem: 1=TJSC, 3=Turmas Recursais, 4=Turmas de Uniformização, 5=Conselho da Magistratura). ATENÇÃO: o portal antigo https://busca.tjsc.jus.br/jurisprudencia/ (HTTP puro) é base histórica CONGELADA desde 08/10/2025 — 15 resultados contra 8.315 do portal novo no mesmo recorte.' },
  TJSP: { url: 'https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do', comando: 'tjsp', acesso: 'browser', status: 'sem-acesso', nota: 'Bloqueio de acesso — não rodar' },
  TCU: { url: 'https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo', comando: 'tcu', acesso: 'browser', status: 'ok' },
  TJMA: { url: null, comando: null, acesso: null, status: 'mapeado', nota: 'human-codegen completo (JurisConsult/Themis/PJe), crawler ainda não escrito' },
  TJRJ: { url: null, comando: null, acesso: null, status: 'mapeado', nota: 'human-codegen completo (EJURIS/eproc), crawler ainda não escrito' },
  TRT9: { url: 'https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa', comando: 'trt9', acesso: 'api', status: 'ok', nota: 'FALCÃO — base NACIONAL da JT (TST + 24 TRTs + CSJT), desenvolvida pelo próprio TRT9; API JSON sem auth, filtro tribunais=TRT9. Instância separada por `colecao` (sentencas=1º grau, acordaos=2º grau, decisoesmonocraticas, recursorevista). Ressalvas: UA de navegador obrigatório (CloudFront 403), sessionId `_`+7 alfanuméricos, teto de 200 resultados/consulta para usuário anônimo. O crawler é o mesmo para os outros 23 TRTs: src/Falcao*.js' },
};

/** Estado do repositorio, por tribunal. */
const REPO = {
  TRF1: { crawler: 'src/TRF1Crawler.js', codegen: 'texto', tests: false, skills: [] },
  TRF2: { crawler: 'src/TRF2Crawler.js', codegen: 'texto', tests: false, skills: [] },
  TRF3: { crawler: 'src/TRF3Crawler.js', codegen: 'texto', tests: false, skills: [], extra: 'src/trf3_drission.py' },
  TRF4: { crawler: 'src/TRF4Crawler.js', codegen: 'texto', tests: false, skills: ['improve-user-prompt'] },
  TRF5: { crawler: 'src/TRF5Crawler.js', codegen: 'texto', tests: false, skills: [] },
  TCU: { crawler: 'src/TCUCrawler.js', codegen: 'texto', tests: false, skills: [] },
  TJGO: { crawler: 'src/TJGOCrawler.js', codegen: 'completo', tests: 'src/TJGOTestes.js', skills: ['verificador/tjgo'], extra: 'TJGONavigator.js + TJGOChecker.js' },
  TJPA: { crawler: 'src/TJPACrawler.js', codegen: 'completo', tests: 'src/TJPATestes.js', skills: ['verificador/tjpa'], extra: 'TJPANavigator.js + TJPAChecker.js' },
  TJPR: { crawler: 'src/TJPRCrawler.js', codegen: 'completo', tests: 'src/TJPRTestes.js', skills: ['verificador/tjpr'], extra: 'TJPRNavigator.js + TJPRChecker.js' },
  TJRS: { crawler: 'src/TJRSCrawler.js', codegen: 'completo', tests: 'src/TJRSTestes.js', skills: ['verificador/tjrs'], extra: 'TJRSNavigator.js + TJRSChecker.js' },
  TJSC: { crawler: 'src/TJSCCrawler.js', codegen: 'completo', tests: 'src/TJSCTestes.js', skills: ['verificador/tjsc'], extra: 'TJSCNavigator.js + TJSCChecker.js' },
  TJSP: { crawler: 'src/TJSPCrawler.js', codegen: 'completo', tests: false, skills: [] },
  TJMA: { crawler: null, codegen: 'completo', tests: false, skills: [] },
  TJRJ: { crawler: null, codegen: 'completo', tests: false, skills: [] },
  TRT9: { crawler: 'src/TRT9Crawler.js', codegen: 'completo', tests: 'src/TRT9Testes.js', skills: ['verificador/trt9'], extra: 'TRT9Navigator.js + TRT9Checker.js sobre a camada de família src/Falcao{Navigator,Crawler,Checker}.js (reaproveitável por TST + os 24 TRTs)' },
};

// ---------------------------------------------------------------- utilitarios

function parseCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (quoted) {
      if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function countScreenshots(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countScreenshots(path.join(dir, e.name));
    else if (/\.(png|jpe?g)$/i.test(e.name)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- montagem

function build() {
  const estadual = parseCsv(path.join(BASE, 'estadual.csv'));
  const federal = parseCsv(path.join(BASE, 'federal.csv'));
  const trabalhista = parseCsv(path.join(BASE, 'trabalhista.csv'));

  const consultaTj = readJson(path.join(TB, 'tj.json'));
  const consultaTrf = readJson(path.join(TB, 'trf.json'));
  const consultaTrt = readJson(path.join(TB, 'trt.json'));
  const superiores = readJson(path.join(TB, 'superior_courts.json'));

  const porCodigo = new Map();

  const upsert = (codigo, segmento) => {
    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        nome: NOME_TRIBUNAL[codigo] || null,
        segmento,
        uf: [],
        sistemas_processuais: [],
        consulta_processual: [],
        jurisprudencia: JURISPRUDENCIA[codigo] || { url: null, comando: null, acesso: null, status: 'nao-mapeado' },
        repo: null,
      });
    }
    return porCodigo.get(codigo);
  };

  // 1. planilha Digesto -> sistema processual por instancia
  const addCsv = (rows, segmento) => {
    for (const r of rows) {
      const t = upsert(r.Tribunal, segmento);
      const ufs = (r['Estado(s)'] || '')
        .split(/,| e /)
        .map((s) => siglaUf(s))
        .filter(Boolean);
      for (const u of ufs) if (!t.uf.includes(u)) t.uf.push(u);
      const par = { sistema: r.Sistema, instancia: r['Instância'] };
      if (!t.sistemas_processuais.some((s) => s.sistema === par.sistema && s.instancia === par.instancia)) {
        t.sistemas_processuais.push(par);
      }
      if (r.Info) t.portal = r.Info;
    }
  };
  addCsv(estadual, 'estadual');
  addCsv(federal, 'federal');
  addCsv(trabalhista, 'trabalhista');

  // 2. tribunais_brasileiros -> URLs de consulta processual
  const addConsulta = (rows, segmento, keyTribunal) => {
    for (const r of rows) {
      const codigo = r[keyTribunal] || r.code.replace(/_(1G|2G|PR_1G|SC_1G|RS_1G|1G_BASE|2G_BASE)$/, '');
      const t = upsert(codigo, segmento);
      t.consulta_processual.push({
        code: r.code,
        instancia: r.instance || null,
        sistema: r.system,
        url: r.url,
        ok: r.success,
        nota: r.note || r.error || null,
        screenshot: `screenshots/${r.code}.png`,
      });
    }
  };
  addConsulta(consultaTj, 'estadual', null);
  addConsulta(consultaTrf, 'federal', 'tribunal');
  for (const r of consultaTrt) {
    const t = upsert(r.code, 'trabalhista');
    t.nome = r.name;
    for (const u of r.states) if (!t.uf.includes(u)) t.uf.push(u);
    t.consulta_processual.push({ code: r.code, instancia: null, sistema: r.system, url: r.url, ok: r.success, nota: r.redirect ? `redirect: ${r.redirect}` : null, screenshot: `screenshots/${r.code}.png` });
  }
  for (const r of superiores) {
    const t = upsert(r.code, 'superior');
    t.nome = r.name;
    t.consulta_processual.push({ code: r.code, instancia: null, sistema: r.system, url: r.urls.portal, ok: r.success, nota: r.description, screenshot: `screenshots/${r.code}.png` });
  }

  // TCU nao esta em nenhuma das fontes externas (nao e Judiciario)
  upsert('TCU', 'contas');

  // 3. estado do repo
  for (const t of porCodigo.values()) {
    const hc = path.join(ROOT, 'human-codegen', t.codigo);
    const repo = REPO[t.codigo] || { crawler: null, codegen: 'nao', tests: false, skills: [] };
    t.repo = {
      crawler: repo.crawler,
      extra: repo.extra || null,
      codegen: fs.existsSync(hc) ? repo.codegen : 'nao',
      screenshots: countScreenshots(hc),
      tests: repo.tests || false,
      skills: repo.skills,
      working: t.jurisprudencia.status === 'ok',
    };
    if (!t.nome && /^TJ/.test(t.codigo) && t.uf.length === 1) {
      // "de Goiás", "do Acre", "da Bahia", "das Alagoas"? -> tabela explícita evita concordância errada
      const ART = { AC: 'do', AL: 'de', AP: 'do', AM: 'do', BA: 'da', CE: 'do', DF: 'do', ES: 'do', GO: 'de', MA: 'do', MT: 'de', MS: 'de', MG: 'de', PA: 'do', PB: 'da', PR: 'do', PE: 'de', PI: 'do', RJ: 'do', RN: 'do', RS: 'do', RO: 'de', RR: 'de', SC: 'de', SP: 'de', SE: 'de', TO: 'do' };
      t.nome = `Tribunal de Justiça ${ART[t.uf[0]]} ${UF_NOME[t.uf[0]]}`;
    }
  }

  const ordem = { superior: 0, federal: 1, estadual: 2, trabalhista: 3, contas: 4 };
  const tribunais = [...porCodigo.values()].sort(
    (a, b) => ordem[a.segmento] - ordem[b.segmento] || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }),
  );

  return {
    fontes: {
      planilha_digesto: 'cobertura/base/{estadual,federal,trabalhista}.csv',
      tribunais_brasileiros: 'https://github.com/brpl20/tribunais_brasileiros (vendorizado em cobertura/base/tribunais-brasileiros/)',
      repo: 'src/*Crawler.js, human-codegen/, skills/, tests/',
    },
    aviso:
      'consulta_processual sao URLs de CONSULTA DE PROCESSO (login/CPF), nao de jurisprudencia. ' +
      'O campo `jurisprudencia` e a base que o crawler `jur` usa e so contem URL verificada.',
    tribunais,
  };
}

// ---------------------------------------------------------------- render MD

const SEG_TITULO = {
  superior: 'Tribunais Superiores',
  federal: 'Justiça Federal (TRFs)',
  estadual: 'Justiça Estadual (TJs)',
  trabalhista: 'Justiça do Trabalho (TRTs)',
  contas: 'Controle Externo',
};

const ICONE = { ok: '🟢', instavel: '🟡', quebrado: '🟠', 'sem-acesso': '🔴', mapeado: '🔵', 'nao-mapeado': '⚪' };

function render(data) {
  const L = [];
  const g = (seg) => data.tribunais.filter((t) => t.segmento === seg);
  const total = data.tribunais.length;
  const ok = data.tribunais.filter((t) => t.jurisprudencia.status === 'ok').length;
  const mapeado = data.tribunais.filter((t) => ['mapeado', 'instavel', 'quebrado', 'sem-acesso'].includes(t.jurisprudencia.status)).length;

  L.push('# CLAUDE-COBERTURA — cobertura de jurisprudência por tribunal');
  L.push('');
  L.push('> **Gerado por `node cobertura/build.js`. Não editar à mão.**');
  L.push('> Fonte da verdade legível por máquina: [`cobertura/tribunais.json`](tribunais.json).');
  L.push('> Para editar: mexa em `cobertura/build.js` (constantes `JURISPRUDENCIA` e `REPO`) e rode o build.');
  L.push('');
  L.push('## Placar');
  L.push('');
  L.push(`| | Tribunais |`);
  L.push('|---|---|');
  L.push(`| Catalogados | **${total}** |`);
  L.push(`| 🟢 Busca funcionando (\`jur <cmd>\`) | **${ok}** |`);
  L.push(`| 🟡🟠🔴🔵 Instáveis / quebrados / bloqueados / mapeados | **${mapeado}** |`);
  L.push(`| ⚪ Não mapeados | **${total - ok - mapeado}** |`);
  L.push('');
  L.push('Legenda de status: 🟢 `ok` funcionando · 🟡 `instavel` funciona com ressalva ·');
  L.push('🟠 `quebrado` crawler existe mas o site mudou/saiu do ar · 🔴 `sem-acesso` bloqueado ·');
  L.push('🔵 `mapeado` human-codegen pronto, falta crawler · ⚪ `nao-mapeado` nada feito ainda.');
  L.push('');
  L.push('Colunas da matriz:');
  L.push('');
  L.push('| Coluna | Significado |');
  L.push('|---|---|');
  L.push('| **CodeGen** | Descrição humana da navegação em `human-codegen/<TRIBUNAL>/`. `completo` = txt + prints; `texto` = só txt; `não` = ausente |');
  L.push('| **Shots** | Nº de prints de jurisprudência em `human-codegen/<TRIBUNAL>/` (os prints do repo `tribunais_brasileiros` são de consulta processual, não contam aqui) |');
  L.push('| **Tests** | Suíte de integração dedicada |');
  L.push('| **Skills** | Skill específica além das genéricas `browser`/`verificador`/`fixer` |');
  L.push('| **Working** | A busca de jurisprudência roda hoje |');
  L.push('');

  for (const seg of ['superior', 'federal', 'estadual', 'trabalhista', 'contas']) {
    const rows = g(seg);
    if (!rows.length) continue;
    L.push(`## ${SEG_TITULO[seg]}`);
    L.push('');
    L.push('| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const t of rows) {
      const sistemas = [...new Set(t.sistemas_processuais.map((s) => s.sistema))].join(', ') ||
        [...new Set(t.consulta_processual.map((c) => c.sistema))].join(', ') || '—';
      const j = t.jurisprudencia;
      const r = t.repo;
      L.push(
        `| **${t.codigo}** | ${t.uf.join(', ') || '—'} | ${sistemas} | ${ICONE[j.status]} ${j.status} | ` +
          `${j.comando ? `\`jur ${j.comando}\`` : '—'} | ${r.codegen} | ${r.screenshots || '—'} | ` +
          `${r.tests ? '✅' : '—'} | ${r.skills.length ? r.skills.join(', ') : '—'} | ${r.working ? '✅' : '—'} |`,
      );
    }
    L.push('');
  }

  L.push('## Tribunais operacionais — detalhe');
  L.push('');
  L.push('| Tribunal | URL de jurisprudência | Acesso | Doc | Observação |');
  L.push('|---|---|---|---|---|');
  for (const t of data.tribunais.filter((x) => x.jurisprudencia.url)) {
    const j = t.jurisprudencia;
    L.push(`| **${t.codigo}** | \`${j.url}\` | ${j.acesso} | [\`CLAUDE-${t.codigo}.md\`](../CLAUDE-${t.codigo}.md) | ${j.nota || '—'} |`);
  }
  L.push('');
  L.push('`acesso`: **browser** = Playwright · **http** = POST/GET direto sem browser · **api** = API JSON documentada.');
  L.push('Sempre prefira `api` > `http` > `browser` ao mapear um tribunal novo — ver `CLAUDE-CODEGEN.md`.');
  L.push('');

  L.push('## Sistemas processuais — por que isso importa');
  L.push('');
  L.push('Tribunais que compartilham a **mesma base** (PJe, e-Proc, ESAJ, Projudi) tendem a compartilhar o');
  L.push('frontend de busca. Mapear um bem barateia todos os outros. Contagem por sistema:');
  L.push('');
  const contagem = new Map();
  for (const t of data.tribunais) {
    for (const s of new Set(t.sistemas_processuais.map((x) => x.sistema))) {
      if (!contagem.has(s)) contagem.set(s, []);
      contagem.get(s).push(t.codigo);
    }
  }
  L.push('| Sistema | Nº | Tribunais |');
  L.push('|---|---|---|');
  for (const [s, ts] of [...contagem.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`| ${s} | ${ts.length} | ${ts.join(', ')} |`);
  }
  L.push('');
  L.push('> ⚠️ **Ressalva importante.** Essa tabela é do sistema de *tramitação processual*.');
  L.push('> O portal de **jurisprudência** costuma ser um sistema à parte, e nem sempre segue a mesma base:');
  L.push('> o TJGO tramita em Projudi e a jurisprudência também vive no Projudi, mas o TJPA tramita em PJe');
  L.push('> e a jurisprudência é uma SPA Angular própria. Use isto como pista, não como garantia.');
  L.push('');

  L.push('## Consulta processual (repo `tribunais_brasileiros`)');
  L.push('');
  L.push('URLs de **consulta de processo por número/CPF** — não são busca de jurisprudência, mas servem');
  L.push('ao `verificador` (confirmar que um processo citado existe). Dados e screenshots vendorizados em');
  L.push('[`cobertura/base/tribunais-brasileiros/`](base/tribunais-brasileiros/); método de descoberta de URL em');
  L.push('[`method_court_discovery.md`](base/tribunais-brasileiros/method_court_discovery.md).');
  L.push('');
  const falhas = data.tribunais.flatMap((t) => t.consulta_processual.filter((c) => c.ok === false).map((c) => ({ t, c })));
  const naoTestados = data.tribunais.flatMap((t) => t.consulta_processual.filter((c) => c.ok === null).map((c) => ({ t, c })));
  const nEndpoints = data.tribunais.reduce((n, t) => n + t.consulta_processual.length, 0);
  L.push(`Endpoints catalogados: **${nEndpoints}** · falhando: **${falhas.length}** · não testados: **${naoTestados.length}**.`);
  L.push('');
  if (falhas.length) {
    L.push('| Endpoint | URL | Erro |');
    L.push('|---|---|---|');
    for (const { c } of falhas) L.push(`| ${c.code} | \`${c.url}\` | ${c.nota || '—'} |`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('Próximo tribunal a mapear: rode `/jur-codegen <TRIBUNAL>` — o processo está em [`../CLAUDE-CODEGEN.md`](../CLAUDE-CODEGEN.md).');
  L.push('');
  return L.join('\n');
}

const data = build();
fs.writeFileSync(path.join(__dirname, 'tribunais.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'CLAUDE-COBERTURA.md'), render(data));
console.log(`ok: ${data.tribunais.length} tribunais -> cobertura/tribunais.json + cobertura/CLAUDE-COBERTURA.md`);
