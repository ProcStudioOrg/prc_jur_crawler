// jur/servidor/kaizen/agenda.js
// Agenda da sentinela dentro do próprio processo: um setTimeout encadeado, sem cron no host
// (o container é a unidade de deploy; cron fora dele não acompanha release nem rollback).
const FUSO = 'America/Sao_Paulo';
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

function partesSP(ms) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(ms))) p[type] = value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, minuto: +p.minute, segundo: +p.second, semana: DIAS[p.weekday] };
}

// Diferença entre o relógio de SP e o UTC naquele instante. Calculada, não fixa em -3: se o
// horário de verão voltar, a agenda continua às 04:00 de parede.
function deslocamento(ms) {
  const p = partesSP(ms);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(ms / 1000) * 1000;
}

/** Próximo instante (estritamente depois de `agoraMs`) em que SP marca `hora`:00. */
function proximaExecucao(agoraMs, hora = 4) {
  const hoje = partesSP(agoraMs);
  for (let d = 0; d < 3; d++) {
    const parede = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + d, hora);
    const alvo = parede - deslocamento(parede);
    if (alvo > agoraMs) return alvo;
  }
  throw new Error('proximaExecucao: sem horário nos próximos dias');
}

const diaDaSemanaSP = (ms) => partesSP(ms).semana;

/**
 * Remoto (TRF3/Falcão/STJ) custa dinheiro por sessão: só na segunda-feira e no primeiro boot de
 * uma versão nova. As rodadas são seriais; as que chegam com outra em curso viram UMA pendente
 * (fila sem teto acumularia rodadas atrasadas atrás de uma rodada lenta).
 */
function iniciarAgenda({ rodar, agora = Date.now, versaoNova = false, atrasoBootMs = 5 * 60e3, hora = 4, aoBoot }) {
  let parado = false;
  let rodando = false;
  let pendente = null;
  const timers = new Set();

  function esperar(ms, fn) {
    const t = setTimeout(() => { timers.delete(t); if (!parado) fn(); }, Math.max(0, ms));
    t.unref?.();
    timers.add(t);
  }

  async function executar(opcoes) {
    rodando = true;
    try {
      await rodar(opcoes);
    } catch (e) {
      console.error('[sentinela] rodada falhou:', e && e.message ? e.message : String(e));
    } finally {
      rodando = false;
      const proxima = pendente;
      pendente = null;
      if (proxima && !parado) executar(proxima);
    }
  }

  function disparar(opcoes) {
    if (!rodando) return executar(opcoes);
    pendente = { remotoPermitido: Boolean(pendente?.remotoPermitido || opcoes.remotoPermitido) };
  }

  // `desde`: o timer pode disparar uns ms antes do alvo (relógio monotônico x de parede); a
  // próxima conta a partir do alvo já atendido, senão a mesma 04:00 rodaria duas vezes.
  function agendarDiaria(desde = agora()) {
    const alvo = proximaExecucao(desde, hora);
    esperar(alvo - agora(), () => {
      agendarDiaria(Math.max(agora(), alvo));
      disparar({ remotoPermitido: diaDaSemanaSP(alvo) === 1 });
    });
  }

  if (versaoNova) {
    esperar(atrasoBootMs, () => {
      try { aoBoot?.(); } catch (e) { console.error('[sentinela] marcador de versão:', e?.message || e); }
      disparar({ remotoPermitido: true });
    });
  }
  agendarDiaria();

  return {
    parar() {
      parado = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      pendente = null;
    },
  };
}

module.exports = { proximaExecucao, diaDaSemanaSP, iniciarAgenda };
