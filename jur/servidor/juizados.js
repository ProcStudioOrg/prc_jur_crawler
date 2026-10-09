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
// As notas vao para a ficha do tribunal (e para o modelo): texto de tela, acentuado.
const sim = (args, nota = '') => ({ suportado: true, args, nota });
const nao = (nota) => ({ suportado: false, args: null, nota });

const SEM_RECORTE = 'Este tribunal não separa Juizados da Justiça Comum na busca.';
const INSTANCIA_UNICA = 'Tribunal de instância única: não há juizados.';

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
  tjpe: sim(['--origem', 'turmas'], 'O portal não tem esse filtro: as decisões são separadas pelo órgão julgador de cada uma.'),
  tjpi: sim(['--origem', 'turmas'], 'O portal não tem esse filtro: as decisões são separadas pelo órgão julgador de cada uma.'),
  tjpa: sim(['--origem', 'turmas']),
  tjrs: sim(['--origem', 'turmas']),
  tjsc: sim(['--origem', 'turmas']),
  tjes: sim(['--origem', 'turmas'], 'Só nos acervos do PJe de 2º grau.'),
  tjro: sim(['--origem', 'turmas']),
  tjto: sim(['--origem', 'turmas']),
  tjrr: sim(['--origem', 'turmas']),
  'tjrj-ejuris': sim(['--origem', 'turmas']),

  trf3: nao(SEM_RECORTE),
  trf5: nao(SEM_RECORTE),
  tjpr: nao(SEM_RECORTE),
  tjrj: nao(SEM_RECORTE),
  tjce: nao('A busca do TJCE separa os sistemas PJe e SAJ, não Juizados da Justiça Comum.'),
  tjdft: nao(SEM_RECORTE),
  tjmg: nao(SEM_RECORTE),
  tjgo: nao(SEM_RECORTE),
  tjmt: nao(SEM_RECORTE),
  tjpb: nao(SEM_RECORTE),
  tjap: nao(SEM_RECORTE),
  tjma: nao('A busca por texto do TJMA está bloqueada por captcha; não há recorte a oferecer.'),
  tjrn: nao('No TJRN não existe busca por texto; não há recorte a oferecer.'),
  tjsp: nao(SEM_RECORTE),
  stf: nao(INSTANCIA_UNICA),
  stj: nao(INSTANCIA_UNICA),
  crps: nao('O CRPS não tem busca: o acesso exige login Gov.br.'),
  tcu: nao('Tribunal de contas: não há juizados.'),
  carf: nao('Instância administrativa: não há juizados.'),
};

for (const c of ['tcepr', 'tcesc', 'tcers', 'tcesp', 'tcerj', 'tceba', 'tcepe', 'tcdf', 'tcemg', 'tcees', 'tcepa', 'tcece', 'tcego']) {
  MAPA[c] = nao('Tribunal de contas: não há juizados.');
}

// Os 26 acervos do FALCAO: Justica do Trabalho nao tem juizados especiais.
for (const meta of Object.values(FalcaoTribunais.TRIBUNAIS)) {
  const comando = String(meta.comando || meta.sigla || '').toLowerCase();
  if (comando) MAPA[comando] = nao('Justiça do Trabalho: não há juizados especiais.');
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
