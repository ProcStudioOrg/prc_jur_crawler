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

      // Ler `envelope.error` AQUI, dentro do executor, e legitimo — e a
      // superfície de erro que a CLI declarou, nao extracao de resultado.
      // O que e proibido e um consumidor ACIMA deste modulo depender de
      // qualquer campo do envelope (ver o comentario acima de `executar`).
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
 * depois — INCONDICIONAL, de proposito. O Chromium e NETO do processo que
 * spawnamos (filho do node do `bin/jur`), nao filho direto: o evento `close`
 * do executor dispara quando o node do crawler sai, o que costuma ser quase
 * imediato apos o SIGTERM (acao default, sem handler proprio em jur/ alem
 * deste arquivo) — MESMO que o Chromium, que recebeu o mesmo SIGTERM via
 * broadcast do grupo, ainda esteja de pe ignorando ou demorando a sair. Uma
 * versao anterior cancelava este SIGKILL quando `close` chegava antes dos 5s,
 * o que evitava atingir um PID reciclado pelo SO — mas trocava um risco
 * pequeno e raro (PID reciclado numa janela de 5s) por um risco maior e mais
 * frequente (Chromium orfao vazando memoria dentro do container,
 * exatamente no caminho de timeout, que e onde um browser travado e mais
 * provavel). Reprovado em revisao; revertido para SIGKILL sempre disparar.
 */
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

// `Resultado.envelope` e diagnostico/teste apenas, NAO contratual — ver o
// comentario acima de `executar`. Nenhum consumidor deste modulo pode
// depender dele; use `arquivo`/`resultados`/`total`/`ok`/`erro`.
module.exports = { executar, matarGrupo, PARAMS_ACEITOS };
