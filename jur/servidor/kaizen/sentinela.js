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

// Na dúvida, não falha: zero ou timeout podem ser o tribunal lento naquele minuto.
const RETENTAR = new Set(['vazio_suspeito', 'timeout']);
const ehRemoto = (info) => rotaDoNavegador(info?.nome) === 'remoto';
const limpar = (arquivo) => {
  for (const alvo of [arquivo, dirFalha(arquivo)]) {
    try { fs.rmSync(alvo, { recursive: true, force: true }); } catch { /* já não existe */ }
  }
};

/**
 * Serial e educada: um caso por vez, espaçados, sempre cedendo a vez às buscas dos usuários.
 * Roda fora do pool (não ocupa vaga), por isso espera `ocupado()` ficar falso antes de cada caso.
 * Tem prazo total: rodada que invade o horário comercial atrapalha mais do que ajuda. Nunca lança.
 */
async function rodarSentinela({
  casos, executarFn, kaizen, ocupado = () => false, maxRemoto = 6, esperaEntreMs = 5000,
  esperaOcupadoMs = 5000, tetoOcupadoMs = 30 * 60e3, timeoutMs = 180e3, prazoMs = 180 * 60e3,
  esperaRetentativaMs = 120e3, home, enviar = true, aoCaso,
}) {
  const totais = { rodados: 0, ok: 0, falhas: 0, nao_verificaveis: 0, pulados: 0 };
  const itens = [];
  const dirResultados = path.join(home, 'resultados');
  try { fs.mkdirSync(dirResultados, { recursive: true, mode: 0o700 }); } catch (e) { logar(e); }
  const fim = Date.now() + prazoMs;
  // remoto é pago por sessão aberta (Kernel e a Steel de reserva contam as duas), não por caso
  let sessoesRemotas = 0;
  let algumRodou = false;
  let desistiu = null; // motivo para pular o resto da rodada
  const duvidasSeguidas = new Map(); // tribunal -> timeouts/vazios seguidos

  const registrar = (item) => {
    itens.push(item);
    try { aoCaso?.(item); } catch { /* exibição não interrompe a rodada */ }
  };
  const pular = (base, detalhe) => { totais.pulados++; registrar({ ...base, status: 'pulado', classe: null, detalhe }); };
  const podeRemoto = (caso) => !remotos.exigeRemoto(caso.tribunal) || sessoesRemotas < maxRemoto;

  async function tentar(caso) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const arquivo = path.join(dirResultados, `sentinela-${ts}-${caso.tribunal}-${caso.capacidade}.json`);
    let navegador = null;
    const t0 = Date.now();
    let r;
    try {
      r = await executarFn(caso.tribunal, caso.params, {
        arquivoSaida: arquivo, timeoutMs,
        aoNavegador: (info) => { navegador = info?.nome || null; if (ehRemoto(info)) sessoesRemotas++; },
      });
    } catch (e) {
      r = { ok: false, total: 0, resultados: [], erro: e && e.message ? e.message : String(e) };
    }
    let avaliacao;
    try {
      avaliacao = avaliarCaso(caso, r, { rota: rotaDoNavegador(navegador) });
    } catch (e) {
      logar(e);
      avaliacao = { status: 'nao_verificavel', classe: null, conferencia: [] };
    }
    return { r, avaliacao, arquivo, navegador, ms: Date.now() - t0 };
  }

  for (const caso of casos || []) {
    const base = { tribunal: caso.tribunal, capacidade: caso.capacidade };
    if (!desistiu && Date.now() >= fim) desistiu = 'prazo da rodada esgotado';
    if (desistiu) { pular(base, desistiu); continue; }
    if ((duvidasSeguidas.get(caso.tribunal) || 0) >= 2) { pular(base, 'tribunal com duas falhas seguidas nesta rodada'); continue; }
    if (!podeRemoto(caso)) { pular(base, `teto de ${maxRemoto} sessões remotas`); continue; }
    // espaçamento antes de checar `ocupado`, para a checagem valer no momento de rodar
    if (algumRodou && esperaEntreMs > 0) await dormir(esperaEntreMs);
    if (!(await esperarLivre(ocupado, esperaOcupadoMs, tetoOcupadoMs))) {
      // servidor ocupado por meia hora: não insiste caso a caso, devolve a máquina aos usuários
      desistiu = 'servidor ocupado com buscas de usuários';
      pular(base, desistiu);
      continue;
    }
    algumRodou = true;

    let t = await tentar(caso);
    if (t.avaliacao.status === 'falha' && RETENTAR.has(t.avaliacao.classe) && Date.now() + esperaRetentativaMs < fim) {
      if (esperaRetentativaMs > 0) await dormir(esperaRetentativaMs);
      // A primeira tentativa só some depois que a segunda existe: se a nova não rodar, o card
      // sai com o print e o HTML da primeira.
      if (podeRemoto(caso) && (await esperarLivre(ocupado, esperaOcupadoMs, tetoOcupadoMs))) {
        const primeira = t;
        t = await tentar(caso);
        limpar(primeira.arquivo);
      }
    }
    // Disjuntor: duas dúvidas seguidas no mesmo tribunal = ele está fora agora; insistir nos
    // outros casos dele só gasta a rodada (e sessão remota) para repetir o mesmo card.
    const duvida = t.avaliacao.status === 'falha' && RETENTAR.has(t.avaliacao.classe);
    duvidasSeguidas.set(caso.tribunal, duvida ? (duvidasSeguidas.get(caso.tribunal) || 0) + 1 : 0);
    const { r, avaliacao, arquivo, navegador, ms } = t;
    totais.rodados++;
    if (avaliacao.status === 'ok') totais.ok++;
    else if (avaliacao.status === 'nao_verificavel') totais.nao_verificaveis++;
    else {
      totais.falhas++;
      try { await kaizen.registrarSentinela({ caso, avaliacao, r, arquivo }); } catch (e) { logar(e); }
    }
    // Ninguém lê o resultado da sentinela depois: sem isto, ~90 arquivos por dia acumulam.
    limpar(arquivo);
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

/** Opções da rodada vindas do ambiente, iguais no servidor e na CLI. */
const opcoesDoAmbiente = (env = process.env) => ({
  maxRemoto: Number(env.JUR_SENTINELA_MAX_REMOTO || 6),
  prazoMs: Number(env.JUR_SENTINELA_PRAZO_MIN || 180) * 60e3,
});

/** Remoto só com fornecedor: sem ele o TRF3/Falcão rodaria do IP bloqueado (falso bloqueio_ip). */
const remotoDisponivel = (pedido) => Boolean(pedido) && remotos.configurados().length > 0;

const MARCADOR_VERSAO = '.versao-verificada';

/**
 * Liga a agenda no servidor quando JUR_SENTINELA=1. Usa a MESMA instância do Kaizen da aplicação
 * (uma conexão com kaizen.db) e a mesma rota de navegador das buscas, numa home própria.
 */
function ligarSentinela({ app, dir, versao, revisao = '', env = process.env, agenda = require('./agenda') }) {
  if (env.JUR_SENTINELA !== '1') return null;
  const executor = require('../executor');
  const { executarNaRota } = require('../escopo');
  const { chaveDeploy } = require('../aviso-deploy');
  const home = path.join(dir, 'sentinela');
  try {
    for (const parte of ['tmp', 'sessoes', 'resultados']) fs.mkdirSync(path.join(home, parte), { recursive: true, mode: 0o700 });
  } catch (e) {
    // disco/permissão: sem sentinela, mas o servidor sobe
    logar(e);
    return null;
  }
  // Marcador próprio, gravado quando a rodada de boot começa: restart da mesma versão (OOM,
  // reboot) não repete a rodada remota, com ou sem FFD respondendo ao aviso de deploy.
  const marcador = path.join(home, MARCADOR_VERSAO);
  const chave = chaveDeploy(versao || require('../../package.json').version, revisao);
  let atual = null;
  try { atual = fs.readFileSync(marcador, 'utf8').trim(); } catch { /* nunca verificada */ }
  const opcoes = opcoesDoAmbiente(env);
  return agenda.iniciarAgenda({
    versaoNova: atual !== chave,
    aoBoot: () => { try { fs.writeFileSync(marcador, chave + '\n', { mode: 0o600 }); } catch (e) { logar(e); } },
    rodar: async ({ remotoPermitido }) => {
      // Lido a cada rodada: corrigir um caso não exige restart.
      const casos = selecionarCasos(carregarCasos(), { remotoPermitido: remotoDisponivel(remotoPermitido) });
      const r = await rodarSentinela({
        casos, kaizen: app.kaizen, ocupado: app.ocupado, home, ...opcoes,
        executarFn: (c, p, e) => executarNaRota(executor.executar, c, p, e, home),
      });
      console.log(`[sentinela] ${r.rodados} rodados · ${r.ok} ok · ${r.falhas} falhas · ${r.nao_verificaveis} não verificáveis · ${r.pulados} pulados`);
    },
  });
}

module.exports = {
  carregarCasos, selecionarCasos, avaliarCaso, rodarSentinela, ligarSentinela, opcoesDoAmbiente, remotoDisponivel, CASOS_PADRAO,
};
