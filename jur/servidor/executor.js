// jur/servidor/executor.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLI_PADRAO = path.join(__dirname, '..', 'bin', 'jur');
const TIMEOUT_PADRAO = 10 * 60 * 1000;

/**
 * Allowlist fechada. Só o denominador comum verificado da CLI entra aqui.
 * `orgao` esta DELIBERADAMENTE fora: o mesmo nome significa orgao JULGADOR
 * nos tribunais judiciais e orgao FISCALIZADO nos TCEs, entao um mapeamento
 * unico buscaria no campo errado e devolveria zero — que se le como
 * "nao ha julgado". Ver o spec, secao 2.4.
 */
const PARAMS_ACEITOS = ['query', 'dataInicio', 'dataFim', 'maxPaginas', 'numero'];

const BANDEIRA = {
  query: '-q',
  dataInicio: '-di',
  dataFim: '-df',
  maxPaginas: '-m',
  numero: '-n',
};

function montarArgs(cliPath, comando, params, arquivoSaida) {
  const args = [cliPath, comando, '--json', '-o', arquivoSaida];
  for (const chave of PARAMS_ACEITOS) {
    const valor = params[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    args.push(BANDEIRA[chave], String(valor));
  }
  return args;
}

/** A CLI pode imprimir aviso antes do JSON: vale a ultima linha que parseia. */
function ultimoJson(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(linhas[i]);
    } catch {
      /* linha de log, segue procurando */
    }
  }
  return null;
}

/**
 * Sempre passamos -o, entao o arquivo e a fonte primaria — o que contorna a
 * heterogeneidade do payload (45 subcomandos devolvem inline, 5 so o caminho).
 * O envelope so e consultado como plano B.
 */
function extrairResultados(envelope, arquivo) {
  if (arquivo && fs.existsSync(arquivo)) {
    try {
      const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      if (Array.isArray(bruto)) return bruto;
      if (Array.isArray(bruto.results)) return bruto.results;
      if (Array.isArray(bruto.resultados)) return bruto.resultados;
    } catch {
      /* arquivo ilegivel: cai no envelope */
    }
  }
  if (envelope) {
    for (const [chave, valor] of Object.entries(envelope)) {
      if (chave !== 'success' && Array.isArray(valor)) return valor;
    }
  }
  return [];
}

async function executar(comando, params = {}, opcoes = {}) {
  const cliPath = opcoes.cliPath || CLI_PADRAO;
  const arquivoSaida = opcoes.arquivoSaida;
  const timeoutMs = opcoes.timeoutMs || TIMEOUT_PADRAO;
  const args = montarArgs(cliPath, comando, params, arquivoSaida);

  return new Promise((resolve) => {
    // detached: o crawler abre Chromium filho. Sem grupo proprio, matar o node
    // deixaria o browser orfao consumindo memoria dentro do container.
    const filho = spawn(process.execPath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let saida = '';
    let erroPadrao = '';
    let expirou = false;

    if (typeof opcoes.aoIniciar === 'function') opcoes.aoIniciar(filho.pid);

    const relogio = setTimeout(() => {
      expirou = true;
      matarGrupo(filho.pid);
    }, timeoutMs);

    filho.stdout.on('data', (d) => { saida += d.toString(); });
    filho.stderr.on('data', (d) => { erroPadrao += d.toString(); });

    filho.on('error', (e) => {
      clearTimeout(relogio);
      resolve({ ok: false, total: 0, resultados: [], arquivo: null, erro: e.message, codigoSaida: null, envelope: null });
    });

    filho.on('close', (codigo) => {
      clearTimeout(relogio);

      if (expirou) {
        return resolve({
          ok: false, total: 0, resultados: [], arquivo: null,
          erro: `timeout apos ${timeoutMs}ms`, codigoSaida: codigo, envelope: null,
        });
      }

      const envelope = ultimoJson(saida);
      if (!envelope || envelope.success !== true) {
        const erro = (envelope && envelope.error) || erroPadrao.trim() || `saida sem envelope (codigo ${codigo})`;
        return resolve({ ok: false, total: 0, resultados: [], arquivo: null, erro, codigoSaida: codigo, envelope });
      }

      const resultados = extrairResultados(envelope, arquivoSaida);
      resolve({
        ok: true,
        total: typeof envelope.count === 'number' ? envelope.count : resultados.length,
        resultados,
        arquivo: arquivoSaida,
        erro: null,
        codigoSaida: codigo,
        envelope,
      });
    });
  });
}

/** Mata o grupo inteiro (node + Chromium filhos), com SIGKILL de garantia. */
function matarGrupo(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ja morreu */ }
  }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* ja morreu */ }
  }, 5000).unref();
}

module.exports = { executar, matarGrupo, PARAMS_ACEITOS };
