#!/usr/bin/env node
/**
 * Sentinela à mão: roda os casos de tests/sentinela-casos.json (busca conhecida por tribunal x
 * capacidade) pelo mesmo caminho do servidor — executor, rota de navegador, conferência.
 *
 *   node tests/sentinela.js                 # todos os casos locais
 *   node tests/sentinela.js trf4 tjpr       # só esses tribunais
 *   node tests/sentinela.js --remoto        # inclui TRF3/Falcão/STJ (navegador remoto, pago; exige fornecedor)
 *   node tests/sentinela.js --json          # saída JSON
 *   node tests/sentinela.js --timeout 120   # segundos por caso (padrão 180)
 *   node tests/sentinela.js --enviar        # manda falhas e resumo ao FFD (KAIZEN_WEBHOOK_*)
 *
 * Sem --enviar nada sai da máquina. Exit 1 = algum caso falhou.
 */
const path = require('node:path');
const fs = require('node:fs');
const executor = require('../servidor/executor');
const { executarNaRota } = require('../servidor/escopo');
const { criarKaizen, kaizenNulo } = require('../servidor/kaizen');
const { carregarCasos, selecionarCasos, rodarSentinela, opcoesDoAmbiente, remotoDisponivel } = require('../servidor/kaizen/sentinela');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const ENVIAR = argv.includes('--enviar');
const REMOTO = argv.includes('--remoto');
const tIdx = argv.indexOf('--timeout');
const TIMEOUT = (tIdx >= 0 ? parseInt(argv[tIdx + 1], 10) : 180) * 1000;
const pedidos = argv.filter((a, i) => !a.startsWith('--') && !(tIdx >= 0 && i === tIdx + 1));

const ICONE = { ok: 'ok   ', falha: 'FALHA', nao_verificavel: 'n/v  ', pulado: 'pulou' };
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

async function main() {
  const todos = carregarCasos();
  if (REMOTO && !remotoDisponivel(true)) console.error('--remoto ignorado: nenhum navegador remoto configurado (KERNEL_API_KEY/STEEL_API_KEY)');
  const casos = selecionarCasos(todos, { pedidos, remotoPermitido: remotoDisponivel(REMOTO) });
  const fora = selecionarCasos(todos, { pedidos, remotoPermitido: true }).length - casos.length;
  if (!casos.length) {
    console.error(`nenhum caso para: ${pedidos.join(', ') || '(todos)'}${fora ? ' (remotos exigem --remoto)' : ''}`);
    process.exit(2);
  }
  const dir = path.resolve(ROOT, process.env.JUR_DADOS || '.local/jur');
  const home = path.join(dir, 'sentinela');
  for (const parte of ['tmp', 'sessoes', 'resultados']) fs.mkdirSync(path.join(home, parte), { recursive: true, mode: 0o700 });
  const kaizen = ENVIAR ? criarKaizen({ dir }) : kaizenNulo();

  log(`sentinela: ${casos.length} casos${fora ? ` · ${fora} remotos fora (use --remoto)` : ''} · timeout ${TIMEOUT / 1000}s${ENVIAR ? ' · enviando ao FFD' : ''}\n`);
  const r = await rodarSentinela({
    casos, kaizen, home, timeoutMs: TIMEOUT, enviar: ENVIAR, ...opcoesDoAmbiente(),
    executarFn: (c, p, e) => executarNaRota(executor.executar, c, p, e, home),
    aoCaso: (it) => log(`${ICONE[it.status] || it.status} ${it.tribunal.padEnd(12)} ${it.capacidade.padEnd(18)} `
      + `${String(it.ms === undefined ? '' : Math.round(it.ms / 1000) + 's').padStart(5)}  ${it.classe ? `${it.classe}: ` : ''}${it.detalhe || ''}`),
  });
  if (ENVIAR) {
    await kaizen.outbox.drenar();
    kaizen.fechar();
  }
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else log(`\n${r.rodados} rodados · ${r.ok} ok · ${r.falhas} falhas · ${r.nao_verificaveis} não verificáveis · ${r.pulados} pulados`);
  process.exitCode = r.falhas ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
