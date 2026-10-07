// jur/servidor/juizados.js
const FalcaoTribunais = require('../src/FalcaoTribunais');

/**
 * Recorte de JUIZADOS / TURMAS RECURSAIS, tribunal a tribunal.
 *
 * O valor NAO e intercambiavel: o TRF4 chama de `--origem turmas-recursais`, o TRF1 de
 * `--fontes JEF1`, a maioria dos TJs de `--origem turmas`. Mandar o valor errado quase
 * nunca da erro — da zero, e zero se le como "os juizados nao julgaram isso". Por isso
 * o executor so monta a flag a partir daqui, e nunca a partir de texto do modelo.
 *
 * A FONTE DA VERDADE CONTINUA SENDO A CLI: tests/contrato-cli.test.js roda `--help` de
 * cada comando e reprova o mapa que divergir, nos dois sentidos.
 */
const sim = (args, nota = '') => ({ suportado: true, args, nota });
const nao = (nota) => ({ suportado: false, args: null, nota });

const SEM_RECORTE = 'Este tribunal nao separa Juizados de Justica Comum na busca.';
const INSTANCIA_UNICA = 'Tribunal de instancia unica: nao ha juizados.';

const MAPA = {
  trf4: sim(['--origem', 'turmas-recursais']),
  trf1: sim(['--fontes', 'JEF1']),
  trf2: sim(['--origem', 'turmas']),
  trf6: sim(['--origem', 'turmas']),
  tjms: sim(['--origem', 'turmas']),
  tjac: sim(['--origem', 'turmas']),
  tjam: sim(['--origem', 'turmas']),
  tjal: sim(['--origem', 'turmas']),
  tjba: sim(['--origem', 'turmas']),
  tjpe: sim(['--origem', 'turmas'], 'Recorte feito no cliente, pelo orgao julgador.'),
  tjpi: sim(['--origem', 'turmas'], 'Recorte feito no cliente, pelo orgao julgador.'),
  tjpa: sim(['--origem', 'turmas']),
  tjrs: sim(['--origem', 'turmas']),
  tjsc: sim(['--origem', 'turmas']),
  tjes: sim(['--origem', 'turmas'], 'So nos acervos do PJe de 2o grau.'),
  tjro: sim(['--origem', 'turmas']),
  tjto: sim(['--origem', 'turmas']),
  tjrr: sim(['--origem', 'turmas']),
  'tjrj-ejuris': sim(['--origem', 'turmas']),

  trf3: nao(SEM_RECORTE),
  trf5: nao(SEM_RECORTE),
  tjpr: nao(SEM_RECORTE),
  tjrj: nao(SEM_RECORTE),
  tjce: nao('A origem no TJCE separa PJe de SAJ, nao Juizados de Justica Comum.'),
  tjdft: nao(SEM_RECORTE),
  tjmg: nao(SEM_RECORTE),
  tjgo: nao(SEM_RECORTE),
  tjmt: nao(SEM_RECORTE),
  tjpb: nao(SEM_RECORTE),
  tjap: nao(SEM_RECORTE),
  tjma: nao('A busca por texto do TJMA esta bloqueada por captcha; nao ha recorte a oferecer.'),
  tjrn: nao('No TJRN nao existe busca por texto; nao ha recorte a oferecer.'),
  tjsp: nao(SEM_RECORTE),
  stf: nao(INSTANCIA_UNICA),
  stj: nao(INSTANCIA_UNICA),
  crps: nao('O CRPS nao tem busca (login Gov.br).'),
  tcu: nao('Tribunal de contas: nao ha juizados.'),
  carf: nao('Instancia administrativa: nao ha juizados.'),
};

for (const c of ['tcepr', 'tcesc', 'tcers', 'tcesp', 'tcerj', 'tceba', 'tcepe', 'tcdf', 'tcemg', 'tcees', 'tcepa', 'tcece', 'tcego']) {
  MAPA[c] = nao('Tribunal de contas: nao ha juizados.');
}

// Os 26 acervos do FALCAO: Justica do Trabalho nao tem juizados especiais.
for (const meta of Object.values(FalcaoTribunais.TRIBUNAIS)) {
  const comando = String(meta.comando || meta.sigla || '').toLowerCase();
  if (comando) MAPA[comando] = nao('Justica do Trabalho: nao ha juizados especiais.');
}

function obter(comando) {
  return MAPA[comando] || null;
}

function comandos() {
  return Object.keys(MAPA);
}

function explicarAusencia(comando, nome) {
  const info = obter(comando);
  return `O tribunal ${comando} (${nome}) NAO tem recorte de Juizados / Turmas Recursais na busca.\n`
    + `${info ? info.nota : SEM_RECORTE}\n`
    + 'A BUSCA NAO FOI FEITA: nao apresente uma busca sem o recorte como se fosse com ele. '
    + 'Diga isso ao usuario e pergunte se ele quer buscar sem o recorte.';
}

module.exports = { obter, comandos, explicarAusencia };
