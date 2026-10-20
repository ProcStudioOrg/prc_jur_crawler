// jur/servidor/kaizen/sentinela.js
// Sentinela: uma busca conhecida por tribunal x capacidade, montada de resultado real, rodada
// de madrugada para achar a quebra antes do usuário. Só aqui zero resultado é falha
// (`vazio_suspeito`): o caso foi escolhido porque já devolveu julgado.
const fs = require('node:fs');
const path = require('node:path');
const { CHAVES } = require('../capacidades');
const remotos = require('../navegadores/remotos');
const { classificar, rotaDoNavegador } = require('./classificar');
const { conferir } = require('./conferencia');
const { dirFalha } = require('./captura');

const CASOS_PADRAO = path.join(__dirname, '..', '..', 'tests', 'sentinela-casos.json');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const logar = (e) => console.error('[sentinela]', e && e.message ? e.message : String(e));

/** O arquivo é `{ _pendentes, casos }` (ou só a lista); chaves com `_` são comentário. */
function carregarCasos(arquivo = CASOS_PADRAO) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const lista = Array.isArray(bruto) ? bruto : bruto.casos;
  if (!Array.isArray(lista)) throw new Error(`${arquivo}: sem lista de casos`);
  return lista.filter((c) => c && c.tribunal).map((c) => {
    if (!CHAVES.includes(c.capacidade)) throw new Error(`${arquivo}: capacidade ${c.capacidade} de ${c.tribunal} não existe`);
    return c;
  });
}

function selecionarCasos(casos, { pedidos = [], remotoPermitido = false } = {}) {
  return casos.filter((c) => (!pedidos.length || pedidos.includes(c.tribunal))
    && (remotoPermitido || !remotos.exigeRemoto(c.tribunal)));
}

function avaliarCaso(caso, r, { rota = null } = {}) {
  if (!r || r.ok === false) {
    return { status: 'falha', classe: classificar({ erro: r?.erro, rota }), conferencia: [] };
  }
  const resultados = Array.isArray(r.resultados) ? r.resultados : [];
  const espera = caso.espera || {};
  const minimo = espera.encontrado ? 1 : Number(espera.minimo || 0);
  if (resultados.length < minimo) return { status: 'falha', classe: 'vazio_suspeito', conferencia: [] };
  const conferencia = conferir(caso.params, resultados, { comando: caso.tribunal });
  const item = conferencia.find((x) => x.filtro === caso.capacidade);
  if (item?.veredito === 'ignorado') return { status: 'falha', classe: `filtro_ignorado:${caso.capacidade}`, conferencia };
  if (item?.veredito === 'nao_verificavel') return { status: 'nao_verificavel', classe: null, conferencia };
  return { status: 'ok', classe: null, conferencia };
}

/** Espera o servidor ficar sem busca de usuário; false se o teto estourar. */
async function esperarLivre(ocupado, esperaMs, tetoMs) {
  const limite = Date.now() + tetoMs;
  for (;;) {
    let ocup;
    try { ocup = ocupado(); } catch { ocup = false; }
    if (!ocup) return true;
    if (Date.now() >= limite) return false;
    await dormir(esperaMs);
  }
}

const umaLinha = (s) => String(s ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * Serial e educada: um caso por vez, espaçados, sempre cedendo a vez às buscas dos usuários.
 * Roda fora do pool (não ocupa vaga), por isso espera `ocupado()` ficar falso antes de cada caso.
 * Nunca lança.
 */
async function rodarSentinela({
  casos, executarFn, kaizen, ocupado = () => false, maxRemoto = 6, esperaEntreMs = 5000,
  esperaOcupadoMs = 5000, tetoOcupadoMs = 30 * 60e3, timeoutMs = 180e3, home, enviar = true, aoCaso,
}) {
  const totais = { rodados: 0, ok: 0, falhas: 0, nao_verificaveis: 0, pulados: 0 };
  const itens = [];
  const dirResultados = path.join(home, 'resultados');
  try { fs.mkdirSync(dirResultados, { recursive: true, mode: 0o700 }); } catch (e) { logar(e); }
  let remotosRodados = 0;
  let algumRodou = false;

  const registrar = (item) => {
    itens.push(item);
    try { aoCaso?.(item); } catch { /* exibição não interrompe a rodada */ }
  };

  for (const caso of casos || []) {
    const base = { tribunal: caso.tribunal, capacidade: caso.capacidade };
    const remoto = remotos.exigeRemoto(caso.tribunal);
    // remoto é pago por sessão: o teto vale por rodada
    if (remoto && remotosRodados >= maxRemoto) {
      totais.pulados++;
      registrar({ ...base, status: 'pulado', classe: null, detalhe: `teto de ${maxRemoto} casos remotos` });
      continue;
    }
    // espaçamento antes de checar `ocupado`, para a checagem valer no momento de rodar
    if (algumRodou && esperaEntreMs > 0) await dormir(esperaEntreMs);
    if (!(await esperarLivre(ocupado, esperaOcupadoMs, tetoOcupadoMs))) {
      totais.pulados++;
      registrar({ ...base, status: 'pulado', classe: null, detalhe: 'servidor ocupado com buscas de usuários' });
      continue;
    }
    algumRodou = true;
    if (remoto) remotosRodados++;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const arquivo = path.join(dirResultados, `sentinela-${ts}-${caso.tribunal}-${caso.capacidade}.json`);
    let navegador = null;
    const t0 = Date.now();
    let r;
    try {
      r = await executarFn(caso.tribunal, caso.params, {
        arquivoSaida: arquivo, timeoutMs, aoNavegador: (info) => { navegador = info?.nome || null; },
      });
    } catch (e) {
      r = { ok: false, total: 0, resultados: [], erro: e && e.message ? e.message : String(e) };
    }
    const ms = Date.now() - t0;
    let avaliacao;
    try {
      avaliacao = avaliarCaso(caso, r, { rota: rotaDoNavegador(navegador) });
    } catch (e) {
      logar(e);
      avaliacao = { status: 'nao_verificavel', classe: null, conferencia: [] };
    }
    totais.rodados++;
    if (avaliacao.status === 'ok') totais.ok++;
    else if (avaliacao.status === 'nao_verificavel') totais.nao_verificaveis++;
    else {
      totais.falhas++;
      try { await kaizen.registrarSentinela({ caso, avaliacao, r, arquivo }); } catch (e) { logar(e); }
    }
    // Ninguém lê o resultado da sentinela depois: sem isto, ~90 arquivos por dia acumulam.
    for (const alvo of [arquivo, dirFalha(arquivo)]) {
      try { fs.rmSync(alvo, { recursive: true, force: true }); } catch { /* já não existe */ }
    }
    const detalhe = avaliacao.status === 'falha' && r?.ok === false ? umaLinha(r.erro)
      : (avaliacao.conferencia.find((x) => x.filtro === caso.capacidade)?.detalhe || `${(r?.resultados || []).length} resultado(s)`);
    registrar({
      ...base, status: avaliacao.status, classe: avaliacao.classe, total: Array.isArray(r?.resultados) ? r.resultados.length : 0,
      ms, navegador, detalhe,
    });
  }

  const resumo = { rodados: totais.rodados, ok: totais.ok, falhas: totais.falhas, nao_verificaveis: totais.nao_verificaveis };
  if (enviar) { try { kaizen.enviarResumo(resumo); } catch (e) { logar(e); } }
  return { ...totais, itens };
}

/**
 * Liga a agenda no servidor quando JUR_SENTINELA=1. Usa a MESMA instância do Kaizen da aplicação
 * (uma conexão com kaizen.db) e a mesma rota de navegador das buscas, numa home própria.
 */
function ligarSentinela({ app, dir, versaoNova = false, env = process.env, agenda = require('./agenda') }) {
  if (env.JUR_SENTINELA !== '1') return null;
  const executor = require('../executor');
  const { executarNaRota } = require('../escopo');
  const home = path.join(dir, 'sentinela');
  try {
    for (const parte of ['tmp', 'sessoes', 'resultados']) fs.mkdirSync(path.join(home, parte), { recursive: true, mode: 0o700 });
  } catch (e) {
    // disco/permissão: sem sentinela, mas o servidor sobe
    logar(e);
    return null;
  }
  const maxRemoto = Number(env.JUR_SENTINELA_MAX_REMOTO || 6);
  return agenda.iniciarAgenda({
    versaoNova,
    rodar: async ({ remotoPermitido }) => {
      // Lido a cada rodada: corrigir um caso não exige restart. Sem fornecedor remoto, o
      // TRF3/Falcão rodaria do IP bloqueado e viraria falso bloqueio_ip.
      const casos = selecionarCasos(carregarCasos(), { remotoPermitido: remotoPermitido && remotos.configurados().length > 0 });
      const r = await rodarSentinela({
        casos, kaizen: app.kaizen, ocupado: app.ocupado, maxRemoto, home,
        executarFn: (c, p, e) => executarNaRota(executor.executar, c, p, e, home),
      });
      console.log(`[sentinela] ${r.rodados} rodados · ${r.ok} ok · ${r.falhas} falhas · ${r.nao_verificaveis} não verificáveis · ${r.pulados} pulados`);
    },
  });
}

module.exports = { carregarCasos, selecionarCasos, avaliarCaso, rodarSentinela, ligarSentinela, CASOS_PADRAO };
