const fs = require('node:fs');
const path = require('node:path');

// Avisa o dashboard (FFD) de que uma release nova subiu, no mesmo formato do WAO e do
// Signer: {service, event:'deploy', version}. A versão vem do package.json; a revisão,
// do JUR_IMAGE (jur:<sha>) que cada release grava no seu infra/.env.
//
// Um aviso por versão+revisão: o marcador em JUR_DADOS evita que restart do container
// (OOM, reboot do host) apareça no FFD como deploy. Só grava o marcador depois de 2xx,
// então um FFD fora do ar recebe o aviso no próximo boot. Nunca lança: falha aqui não
// pode derrubar a aplicação.
const SERVICO = 'jurcrawler';
const MARCADOR = '.ultimo-deploy-avisado';

function revisaoDaImagem(imagem) {
  const tag = String(imagem || '').split(':').pop();
  return /^[0-9a-f]{7,40}$/.test(tag) ? tag : '';
}

async function avisarDeploy({ url, dir, versao, revisao = '', fetchFn = fetch, timeoutMs = 10000 }) {
  if (!url) return 'desligado';
  const chave = `${versao}+${revisao}`;
  const marcador = path.join(dir, MARCADOR);
  try {
    if (fs.readFileSync(marcador, 'utf8').trim() === chave) return 'repetido';
  } catch { /* primeiro boot desta instalação */ }
  try {
    const corpo = { service: SERVICO, event: 'deploy', version: versao };
    if (revisao) corpo.revision = revisao;
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return 'falhou';
    fs.writeFileSync(marcador, chave + '\n', { mode: 0o600 });
    return 'enviado';
  } catch {
    return 'falhou';
  }
}

module.exports = { avisarDeploy, revisaoDaImagem, SERVICO };
