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
 * Sempre passamos -o, entao o arquivo e a fonte primaria. Hoje TODO subcomando
 * da CLI devolve o envelope no formato {success, count, output} — nenhum
 * embute o array de resultados dentro do envelope (conferido em bin/jur
 * inteiro). O scan do envelope abaixo e rede de seguranca para um formato
 * futuro que ainda nao existe, nao o caminho normal de hoje.
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

/**
 * `Resultado.envelope` (o JSON cru que a CLI imprimiu em stdout) e
 * DIAGNOSTICO/TESTE APENAS — nao e parte do contrato deste modulo. Existe so
 * porque o teste `eco` precisa inspecionar os args que a CLI recebeu. Fila de
 * jobs, API, MCP e chat NAO PODEM ler `r.envelope.*` (ex.: `r.envelope.output`)
 * em vez de `r.arquivo`/`r.resultados` — isso reintroduziria o acoplamento com
 * o formato de saida da CLI que este arquivo existe para isolar.
 */
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
    let cancelarSigkill = null;

    if (typeof opcoes.aoIniciar === 'function') opcoes.aoIniciar(filho.pid);

    const relogio = setTimeout(() => {
      expirou = true;
      cancelarSigkill = matarGrupo(filho.pid);
    }, timeoutMs);

    filho.stdout.on('data', (d) => { saida += d.toString(); });
    filho.stderr.on('data', (d) => { erroPadrao += d.toString(); });

    filho.on('error', (e) => {
      clearTimeout(relogio);
      if (cancelarSigkill) cancelarSigkill();
      resolve({ ok: false, total: 0, resultados: [], arquivo: null, erro: e.message, codigoSaida: null, envelope: null });
    });

    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      // Se o grupo ja saiu (por SIGTERM ou sozinho) antes dos 5s, cancela o
      // SIGKILL de garantia — senao, se o SO reciclar o PID nessa janela, o
      // sinal atinge processo alheio em vez do grupo que morreu.
      if (cancelarSigkill) cancelarSigkill();

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

/**
 * Mata o grupo inteiro (node + Chromium filhos), com SIGKILL de garantia 5s
 * depois. Devolve uma funcao que cancela esse SIGKILL — o chamador usa isso
 * quando o `close` chega antes dos 5s, para nao arriscar atingir um PID
 * reciclado pelo SO depois que o grupo original ja morreu.
 */
function matarGrupo(pid) {
  if (!pid) return () => {};
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ja morreu */ }
  }
  const sigkill = setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* ja morreu */ }
  }, 5000);
  sigkill.unref();
  return () => clearTimeout(sigkill);
}

// `Resultado.envelope` e diagnostico/teste apenas, NAO contratual — ver o
// comentario acima de `executar`. Nenhum consumidor deste modulo pode
// depender dele; use `arquivo`/`resultados`/`total`/`ok`/`erro`.
module.exports = { executar, matarGrupo, PARAMS_ACEITOS };
