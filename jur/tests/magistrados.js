#!/usr/bin/env node
/**
 * Mapeamento de magistrados por tribunal (BRU-102): roda buscas genéricas pela CLI, extrai o
 * relator/magistrado e o órgão julgador de cada julgado devolvido, infere o grau e testa a
 * capacidade `magistrado` (flag `-r`) com até 5 nomes, do mesmo jeito que a sentinela mede
 * `filtro_ignorado:magistrado`. Grava `dados/magistrados/<tribunal>.json` e regenera o
 * `dados/magistrados/INDEX.md`. Só nome e cargo públicos saem; nenhum texto de julgado.
 *
 *   node tests/magistrados.js trf4 tjpr tjsc     # esses tribunais
 *   node tests/magistrados.js --proximos 3       # os próximos 3 ainda não mapeados, na ordem do catálogo
 *   node tests/magistrados.js --fila             # mostra mapeados, pendentes e fora do escopo e sai
 *   node tests/magistrados.js --indice           # só regenera o INDEX.md
 *   node tests/magistrados.js --refazer tjpr     # remapeia mesmo com arquivo existente
 *   node tests/magistrados.js --timeout 180      # segundos por busca (padrão 180)
 *   node tests/magistrados.js --paginas 2        # páginas por busca genérica (padrão 2)
 *   node tests/magistrados.js --json             # saída JSON
 *
 * Sequencial, uma busca por vez, com pausa entre elas; nada sai da máquina (sem FFD, sem
 * --enviar). Resultado bruto de cada busca (com ementa) fica fora do git, em
 * /mnt/dados/pesquisas/jurcrawler-magistrados/brutos (ou .local/magistrados/brutos sem o HD).
 * Exit 0 = rodou (mesmo com tribunal em erro); 3 = nada pendente (--proximos); 2 = uso errado.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const catalogo = require('../servidor/catalogo');
const relatorCap = require('../servidor/relator');
const juizadosCap = require('../servidor/juizados');
const FalcaoTribunais = require('../src/FalcaoTribunais');
const { conferir } = require('../servidor/kaizen/conferencia');
const { normalizarResultado } = require('../servidor/kaizen/normalizar');
const { SEM_FILTRO_DATA } = require('../servidor/capacidades');

const ROOT = path.resolve(__dirname, '..');
const JUR = path.join(ROOT, 'bin', 'jur');
const DADOS = path.join(ROOT, 'dados', 'magistrados');
const INDEX = path.join(DADOS, 'INDEX.md');
const VERSAO = require('../package.json').version;

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const flag = (nome, padrao) => {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : padrao;
};
const JSON_OUT = argv.includes('--json');
const REFAZER = argv.includes('--refazer');
const FILA = argv.includes('--fila');
const INDICE = argv.includes('--indice');
const PROXIMOS = argv.includes('--proximos') ? parseInt(flag('--proximos', '3'), 10) : 0;
const TIMEOUT_MS = parseInt(flag('--timeout', '180'), 10) * 1000;
const PAGINAS = parseInt(flag('--paginas', '2'), 10);
const MAX_TESTES = 5;
const PAUSA_MS = 3000;
const COM_VALOR = new Set(['--proximos', '--timeout', '--paginas']);
const pedidos = argv.filter((a, i) => !a.startsWith('--') && !COM_VALOR.has(argv[i - 1]));

const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hoje = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- consultas
// Termos amplos o bastante para trazer julgado em qualquer base; os TCs com base curada
// zeram com "dano moral" (ver tests/smoke.js).
const TERMOS = ['dano moral', 'aposentadoria', 'contrato'];
const TERMO_POR_COMANDO = { tcerj: ['licitação', 'contrato', 'aposentadoria'], tcemg: ['licitação', 'contrato', 'convênio'], tcepa: ['licitação', 'contrato', 'aposentadoria'] };

const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
function periodo() {
  const fim = new Date();
  const ini = new Date(fim);
  ini.setFullYear(ini.getFullYear() - 1);
  return { dataInicio: ddmmyyyy(ini), dataFim: ddmmyyyy(fim) };
}

/** Recortes de 1º grau fora do recorte de juizados do servidor (origens que a CLI aceita). */
const PRIMEIRO_GRAU = {
  trf4: { args: ['--orgaos', 'Varas Federais'], rotulo: 'Varas Federais (sentenças de 1º grau)' },
};
// Falcão: `-g 1` = sentenças das Varas do Trabalho. TST e CSJT não têm 1º grau (a CLI erra avisando).
for (const meta of Object.values(FalcaoTribunais.TRIBUNAIS)) {
  const c = String(meta.comando || meta.sigla || '').toLowerCase();
  if (c && c !== 'tst' && c !== 'csjt') PRIMEIRO_GRAU[c] = { args: ['-g', '1'], rotulo: 'Varas do Trabalho (sentenças, -g 1)' };
}

function consultasDe(cmd) {
  const termos = TERMO_POR_COMANDO[cmd] || TERMOS;
  const datas = SEM_FILTRO_DATA.has(cmd) ? {} : periodo();
  const lista = termos.map((query) => ({ query, ...datas, maxPaginas: PAGINAS, args: [], recorte: 'comum' }));
  const j = juizadosCap.obter(cmd);
  if (j && j.suportado) lista.push({ query: termos[0], ...datas, maxPaginas: 1, args: j.args, recorte: 'juizados' });
  const pg = PRIMEIRO_GRAU[cmd];
  if (pg) lista.push({ query: termos[0], ...datas, maxPaginas: 1, args: pg.args, recorte: 'primeiro_grau' });
  return lista;
}

// ---------------------------------------------------------------- brutos (fora do git)
function dirBrutos() {
  const hd = '/mnt/dados/pesquisas/jurcrawler-magistrados/brutos';
  const base = fs.existsSync('/mnt/dados/pesquisas') ? hd : path.join(ROOT, '.local', 'magistrados', 'brutos');
  const dir = path.join(base, hoje());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ---------------------------------------------------------------- CLI
/** A CLI pode imprimir log antes do JSON: vale a última linha que parseia. */
function ultimoJson(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i--) {
    try { return JSON.parse(linhas[i]); } catch { /* log */ }
  }
  return null;
}
function lerResultados(arquivo) {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (Array.isArray(bruto)) return bruto;
    if (Array.isArray(bruto.results)) return bruto.results;
    if (Array.isArray(bruto.resultados)) return bruto.resultados;
  } catch { /* sem arquivo */ }
  return [];
}
// eslint-disable-next-line no-control-regex
const semAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
// última linha com letras: a CLI fecha o stderr com separadores ("=====") que não dizem nada
const umaLinha = (s) => semAnsi(s).split('\n').map((l) => l.trim()).filter((l) => /[a-z]{3}/i.test(l)).pop()?.replace(/\s+/g, ' ').slice(0, 200) || '';

/** Roda `bin/jur <cmd> ...` com -o num arquivo bruto; devolve { ok, resultados, erro, ms, args }. */
function buscar(cmd, consulta, arquivo, relator) {
  const args = [cmd, '--json', '-o', arquivo, '-q', consulta.query, '-m', String(consulta.maxPaginas)];
  if (consulta.dataInicio) args.push('-di', consulta.dataInicio, '-df', consulta.dataFim);
  if (relator) args.push('-r', relator);
  args.push(...(consulta.args || []));
  return new Promise((resolve) => {
    const t0 = Date.now();
    let saida = '';
    let erroPadrao = '';
    let expirou = false;
    // grupo próprio: no estouro, mata o node e o que ele abriu
    const filho = spawn(process.execPath, [JUR, ...args], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const relogio = setTimeout(() => {
      expirou = true;
      try { process.kill(-filho.pid, 'SIGTERM'); } catch { /* já morreu */ }
      setTimeout(() => { try { process.kill(-filho.pid, 'SIGKILL'); } catch { /* ok */ } }, 5000).unref();
    }, TIMEOUT_MS);
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { erroPadrao += d; });
    filho.on('error', (e) => { clearTimeout(relogio); resolve({ ok: false, resultados: [], erro: e.message, ms: Date.now() - t0, args }); });
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      const ms = Date.now() - t0;
      if (expirou) return resolve({ ok: false, resultados: [], erro: `timeout após ${TIMEOUT_MS / 1000}s`, ms, args });
      const envelope = ultimoJson(saida);
      if (!envelope || envelope.success !== true) {
        const erro = (envelope && envelope.error) || umaLinha(erroPadrao) || `saída sem envelope (código ${codigo})`;
        return resolve({ ok: false, resultados: [], erro: umaLinha(erro), ms, args });
      }
      resolve({ ok: true, resultados: lerResultados(arquivo), erro: null, ms, args, total: envelope.totalResults ?? envelope.total ?? null });
    });
  });
}

// ---------------------------------------------------------------- nomes e grau
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
const chaveNome = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Títulos que o tribunal prefixa ao nome ("Des. Fulano", "JUIZ FEDERAL CONVOCADO", "Min.").
const RE_TITULO = /^(?:(?:des(?:embargador|embargadora|a)?|min(?:istro|istra)?|juiz|juiza|juíza|conselheiro|conselheira|auditor|auditora|cons|dr|dra|exmo|exma|sr|sra|rel|relator|relatora|substitut[oa]|convocad[oa])\b\.?(?:\s+(?:federal|de\s+direito|substitut[oa]|convocad[oa]|em\s+substitui[cç][aã]o|auxiliar|do\s+trabalho|titular|presidente|vice-?presidente))*[\s.:-]*)+/i;
// Campo relator que traz órgão, não pessoa ("Juiz 1 Turma Recursal Unificada", "Gabinete 3").
const RE_ORGAO_NO_RELATOR = /turma|camara|gabinete|vice-?presid|presid|secao|plenario|colegiado|unificada|\d/;

function separarTitulo(bruto) {
  const texto = String(bruto).replace(/\s+/g, ' ').trim();
  const m = RE_TITULO.exec(texto);
  const titulo = m ? m[0].replace(/[\s.:-]+$/, '') : '';
  let nome = m ? texto.slice(m[0].length) : texto;
  // "FULANO (convocado)" / "FULANO - Juiz Federal Convocado"
  nome = nome.replace(/\s*[(\-–]\s*(?:juiz|juíza|juiza|des|convocad|substitut|em substitui)[^)]*\)?\s*$/i, '').trim();
  return { nome, titulo };
}

function inferirGrau({ titulo, cargo, orgao, recorte, grauDoResultado }) {
  const o = semAcento(orgao).toLowerCase();
  const t = semAcento(`${titulo} ${cargo}`).toLowerCase();
  // Falcão devolve `grau` no próprio julgado: vale mais que qualquer heurística.
  if (grauDoResultado === '1' || grauDoResultado === '2') return grauDoResultado;
  if (recorte === 'primeiro_grau') return '1';
  if (/\bvara\b|juizado|turma recursal|turmas recursais|recursal|juizados especiais|uniformizac/.test(o)) return '1';
  if (/camara|\bturma\b|secao|grupo|orgao especial|pleno|plenario|corte especial|vice-?presid|presidencia|conselho da magistratura|tribunal pleno/.test(o)) return '2';
  // TRF5: o órgão é o gabinete com o cargo dentro ("GAB 6 - DES. PAULO CORDEIRO")
  if (/\bdes\b|desembargador|ministr/.test(o)) return '2';
  if (/desembargador|ministr|conselheir|\bdes\b|\bmin\b|\bcons\b/.test(t)) return '2';
  if (/\bjuiz/.test(t)) return recorte === 'juizados' ? '1' : 'desconhecido';
  if (recorte === 'juizados') return '1';
  return 'desconhecido';
}

/** Agrega os julgados por magistrado: nome, rótulo original, grau, órgão, ocorrências, exemplos. */
function extrair(fontes) {
  const mapa = new Map();
  fontes.forEach((fonte, idx) => {
    for (const bruto of fonte.resultados || []) {
      const norm = normalizarResultado(bruto);
      if (!norm.relator) continue;
      // crawlers com lista de relatores juntam com "; " (normalizar.texto)
      for (const parte of String(norm.relator).split(';').map((s) => s.trim()).filter(Boolean)) {
        const { nome, titulo } = separarTitulo(parte);
        if (!nome || nome.length < 5) continue;
        if (RE_ORGAO_NO_RELATOR.test(semAcento(nome).toLowerCase())) continue;
        const chave = chaveNome(nome);
        if (!chave) continue;
        const cargo = typeof bruto.cargoRelator === 'string' ? bruto.cargoRelator.trim() : '';
        const orgao = norm.orgaoJulgador || '';
        const numero = norm.numeroProcesso || bruto.id || null;
        let m = mapa.get(chave);
        if (!m) {
          m = { nome, formas: new Map(), rotulo_original: parte, titulo, cargo, orgaos: new Map(), graus: new Map(), ocorrencias: 0, julgados_exemplo: [], fontes: new Map() };
          mapa.set(chave, m);
        }
        m.ocorrencias++;
        m.formas.set(nome, (m.formas.get(nome) || 0) + 1);
        if (orgao) m.orgaos.set(orgao, (m.orgaos.get(orgao) || 0) + 1);
        const grau = inferirGrau({ titulo, cargo, orgao, recorte: fonte.recorte, grauDoResultado: String(bruto.grau ?? '') });
        m.graus.set(grau, (m.graus.get(grau) || 0) + 1);
        if (!m.cargo && cargo) m.cargo = cargo;
        if (!m.titulo && titulo) m.titulo = titulo;
        m.fontes.set(idx, (m.fontes.get(idx) || 0) + 1);
        if (numero && m.julgados_exemplo.length < 5 && !m.julgados_exemplo.includes(String(numero))) m.julgados_exemplo.push(String(numero));
      }
    }
  });
  const maior = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return [...mapa.values()].map((m) => ({
    nome: maior(m.formas),
    rotulo_original: m.rotulo_original,
    cargo: m.cargo || m.titulo || null,
    grau: maior(m.graus) || 'desconhecido',
    orgao: maior(m.orgaos) || null,
    orgaos: [...m.orgaos.keys()].slice(0, 5),
    ocorrencias: m.ocorrencias,
    julgados_exemplo: m.julgados_exemplo,
    fonte: maior(m.fontes),
  })).sort((a, b) => b.ocorrencias - a.ocorrencias || a.nome.localeCompare(b.nome));
}

/** Até 5 para testar: os mais frequentes, garantindo um de 1º grau quando houver. */
function escolherParaTeste(magistrados) {
  const lista = magistrados.slice(0, MAX_TESTES);
  const primeiro = magistrados.find((m) => m.grau === '1');
  if (primeiro && !lista.includes(primeiro)) lista[lista.length - 1] = primeiro;
  return lista;
}

// ---------------------------------------------------------------- teste da capacidade
async function testarBusca(cmd, magistrado, consulta, brutos, i) {
  const arquivo = path.join(brutos, `${cmd}-teste-${i}.json`);
  const r = await buscar(cmd, { ...consulta, maxPaginas: 1 }, arquivo, magistrado.nome);
  if (!r.ok) return { consultados: 0, batem: 0, status: 'erro', detalhe: r.erro, ms: r.ms };
  const item = conferir({ relator: magistrado.nome }, r.resultados, { comando: cmd }).find((x) => x.filtro === 'magistrado');
  const status = !item ? 'nao_verificavel' : item.veredito === 'ignorado' ? 'filtro_ignorado' : item.veredito;
  return {
    consultados: r.resultados.length, batem: item ? item.comCampo - item.violam : 0,
    status, detalhe: r.resultados.length ? (item?.detalhe || '') : '0 resultados com o filtro', ms: r.ms,
  };
}

// ---------------------------------------------------------------- um tribunal
async function mapear(cmd, brutos) {
  const t = catalogo.obter(cmd);
  const cap = relatorCap.obter(cmd);
  const jz = juizadosCap.obter(cmd);
  const consultas = consultasDe(cmd);
  const fontes = [];
  log(`\n== ${cmd} (${t?.nome || '?'}) · magistrado: ${cap?.suportado ? cap.forma : 'sem capacidade'} · juizados: ${jz?.suportado ? 'sim' : 'não'}`);
  let i = 0;
  for (const c of consultas) {
    const arquivo = path.join(brutos, `${cmd}-${c.recorte}-${i++}.json`);
    const r = await buscar(cmd, c, arquivo);
    fontes.push({ ...c, resultados: r.resultados, ok: r.ok, erro: r.erro, total_no_portal: r.total ?? null, ms: r.ms });
    log(`  ${r.ok ? 'ok   ' : 'ERRO '} ${c.recorte.padEnd(14)} "${c.query}" ${String(Math.round(r.ms / 1000) + 's').padStart(5)}  ${r.ok ? `${r.resultados.length} resultado(s)` : r.erro}`);
    await dormir(PAUSA_MS);
  }
  const magistrados = extrair(fontes);
  const semCapacidade = !cap || !cap.suportado ? 'tribunal sem filtro de magistrado'
    : cap.forma === 'codigo' ? 'filtro por código, não por nome' : null;
  for (const m of magistrados) m.teste_busca = { consultados: 0, batem: 0, status: 'nao_testado', detalhe: '' };
  if (semCapacidade) {
    for (const m of magistrados) m.teste_busca = { consultados: 0, batem: 0, status: 'sem_capacidade', detalhe: semCapacidade };
  } else {
    let n = 0;
    for (const m of escolherParaTeste(magistrados)) {
      const fonte = fontes[m.fonte] || fontes[0];
      m.teste_busca = await testarBusca(cmd, m, fonte, brutos, n++);
      log(`  teste ${m.teste_busca.status.padEnd(16)} ${m.nome} (grau ${m.grau}) ${String(Math.round(m.teste_busca.ms / 1000) + 's').padStart(5)}  ${m.teste_busca.batem}/${m.teste_busca.consultados} ${m.teste_busca.detalhe}`);
      await dormir(PAUSA_MS);
    }
  }
  const contar = (chave, lista) => lista.reduce((acc, m) => { const v = m[chave]; acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  const saida = {
    tribunal: cmd,
    nome: t?.nome || null,
    coletado_em: new Date().toISOString(),
    versao_jur: VERSAO,
    capacidade: {
      magistrado: cap ? { suportado: cap.suportado, forma: cap.forma } : { suportado: false, forma: null },
      juizados: Boolean(jz && jz.suportado),
      primeiro_grau: PRIMEIRO_GRAU[cmd]?.rotulo || null,
    },
    fonte: fontes.map((f) => ({ query: f.query, dataInicio: f.dataInicio || null, dataFim: f.dataFim || null, maxPaginas: f.maxPaginas, args: f.args, recorte: f.recorte, ok: f.ok, resultados: f.resultados.length, total_no_portal: f.total_no_portal, erro: f.erro })),
    resumo: {
      magistrados: magistrados.length,
      por_grau: contar('grau', magistrados),
      teste_busca: contar('status', magistrados.map((m) => m.teste_busca)),
      buscas_com_erro: fontes.filter((f) => !f.ok).length,
    },
    magistrados: magistrados.map(({ fonte, ...m }) => ({ ...m, fonte_query: fontes[fonte]?.query || null, fonte_recorte: fontes[fonte]?.recorte || null })),
  };
  if (!magistrados.length) saida.erro = fontes.every((f) => !f.ok) ? `todas as buscas falharam: ${fontes[0]?.erro || '?'}` : 'buscas sem relator legível no resultado';
  fs.mkdirSync(DADOS, { recursive: true });
  fs.writeFileSync(path.join(DADOS, `${cmd}.json`), `${JSON.stringify(saida, null, 2)}\n`);
  return saida;
}

// ---------------------------------------------------------------- fila e índice
function mapeados() {
  if (!fs.existsSync(DADOS)) return new Set();
  return new Set(fs.readdirSync(DADOS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
}

/**
 * Ordem do catálogo. Fora do escopo: tribunal sem acesso ou que exige sessão. TRF3 e Falcão
 * exigem navegador remoto só no servidor H2 (IP bloqueado); desta máquina respondem direto
 * (medido em 24/10/2026), por isso entram na fila.
 */
function fila() {
  const feitos = mapeados();
  const itens = catalogo.listar().map((t) => {
    const motivo = !t.disponivel ? `estado ${t.estado}` : null;
    return { comando: t.comando, nome: t.nome, motivo, mapeado: feitos.has(t.comando) };
  });
  return {
    mapeados: itens.filter((i) => i.mapeado),
    pendentes: itens.filter((i) => !i.mapeado && !i.motivo),
    fora: itens.filter((i) => !i.mapeado && i.motivo),
  };
}

function gerarIndex() {
  const feitos = [...mapeados()].sort();
  const linhas = [];
  linhas.push('# Magistrados mapeados por tribunal', '');
  linhas.push('Gerado por `node tests/magistrados.js` (ver `docs/magistrados.md`). Um JSON por tribunal nesta pasta;',
    'só nome e cargo públicos, sem texto de julgado. Grau inferido pelo órgão julgador e pelo cargo:',
    '`1` = vara, juizado ou turma recursal; `2` = câmara, turma, seção ou órgão especial; `desconhecido` = sem pista.', '');
  linhas.push('| Tribunal | Magistrados | 1º grau | 2º grau | desc. | Teste da busca por magistrado | Coletado em |');
  linhas.push('|---|---|---|---|---|---|---|');
  for (const cmd of feitos) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(DADOS, `${cmd}.json`), 'utf8')); } catch { continue; }
    const g = d.resumo?.por_grau || {};
    const tb = d.resumo?.teste_busca || {};
    const teste = !d.capacidade?.magistrado?.suportado ? 'sem capacidade'
      : d.capacidade.magistrado.forma === 'codigo' ? 'sem capacidade (filtro por código)'
        : ['ok', 'filtro_ignorado', 'nao_verificavel', 'erro'].filter((k) => tb[k]).map((k) => `${k} ${tb[k]}`).join(' · ') || (d.erro ? `erro: ${d.erro}` : 'sem nome para testar');
    linhas.push(`| ${cmd} | ${d.resumo?.magistrados ?? 0} | ${g['1'] || 0} | ${g['2'] || 0} | ${g.desconhecido || 0} | ${teste} | ${String(d.coletado_em || '').slice(0, 10)} |`);
  }
  const f = fila();
  linhas.push('', `## Fila (${f.pendentes.length} pendentes, ordem do catálogo)`, '');
  linhas.push(f.pendentes.length ? f.pendentes.map((i) => `\`${i.comando}\``).join(', ') : 'todos mapeados');
  linhas.push('', `## Fora do escopo do cron (${f.fora.length})`, '');
  for (const i of f.fora) linhas.push(`- \`${i.comando}\`: ${i.motivo}`);
  linhas.push('');
  fs.mkdirSync(DADOS, { recursive: true });
  fs.writeFileSync(INDEX, `${linhas.join('\n')}`);
}

// ---------------------------------------------------------------- main
async function main() {
  const f = fila();
  if (FILA) {
    if (JSON_OUT) console.log(JSON.stringify(f, null, 2));
    else {
      console.log(`mapeados (${f.mapeados.length}): ${f.mapeados.map((i) => i.comando).join(', ') || '-'}`);
      console.log(`pendentes (${f.pendentes.length}): ${f.pendentes.map((i) => i.comando).join(', ') || '-'}`);
      console.log(`fora do escopo (${f.fora.length}): ${f.fora.map((i) => `${i.comando} (${i.motivo})`).join(', ')}`);
    }
    return;
  }
  if (INDICE) { gerarIndex(); log(`índice regenerado: ${INDEX}`); return; }
  let alvos = pedidos;
  if (PROXIMOS > 0) {
    alvos = f.pendentes.slice(0, PROXIMOS).map((i) => i.comando);
    if (!alvos.length) { console.log('todos mapeados'); gerarIndex(); process.exitCode = 3; return; }
  }
  if (!alvos.length) { console.error('uso: node tests/magistrados.js <tribunal...> | --proximos N | --fila'); process.exit(2); }
  const invalidos = alvos.filter((c) => !catalogo.obter(c));
  if (invalidos.length) { console.error(`tribunal fora do catálogo: ${invalidos.join(', ')}`); process.exit(2); }
  const feitos = mapeados();
  const brutos = dirBrutos();
  log(`magistrados: ${alvos.join(', ')} · timeout ${TIMEOUT_MS / 1000}s · ${PAGINAS} página(s) · brutos em ${brutos}`);
  const saidas = [];
  for (const cmd of alvos) {
    if (feitos.has(cmd) && !REFAZER && !PROXIMOS) { log(`\n== ${cmd}: já mapeado (use --refazer)`); continue; }
    try {
      saidas.push(await mapear(cmd, brutos));
    } catch (e) {
      console.error(`[magistrados] ${cmd}: ${e && e.message ? e.message : e}`);
      saidas.push({ tribunal: cmd, erro: String(e && e.message ? e.message : e) });
    }
  }
  gerarIndex();
  if (JSON_OUT) console.log(JSON.stringify(saidas.map((s) => ({ tribunal: s.tribunal, resumo: s.resumo, erro: s.erro || null })), null, 2));
  else {
    log('');
    for (const s of saidas) {
      const g = s.resumo?.por_grau || {};
      const tb = s.resumo?.teste_busca || {};
      log(`${s.tribunal.padEnd(12)} ${String(s.resumo?.magistrados ?? 0).padStart(3)} magistrados · 1º ${g['1'] || 0} · 2º ${g['2'] || 0} · ? ${g.desconhecido || 0} · teste: ${Object.entries(tb).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}${s.erro ? ` · ${s.erro}` : ''}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
