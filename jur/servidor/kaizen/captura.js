// jur/servidor/kaizen/captura.js
// Lê o que o preload (src/navegadorPreload.js) deixou em <job>.falha/ quando o crawler falhou.
// Nada aqui lança: captura é diagnóstico, nunca motivo para uma busca virar erro.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');

const gzip = promisify(zlib.gzip);
const LIMITE_HTML = 4 * 1024 * 1024;

/** `/r/<id>.json` → `/r/<id>.falha`: a captura mora ao lado do arquivo de resultados do job. */
function dirFalha(arquivoSaida) {
  return String(arquivoSaida).replace(/\.json$/i, '') + '.falha';
}

const lerOuNulo = (arquivo) => fs.promises.readFile(arquivo).catch(() => null);

/**
 * HTML acima de 4 MB vai cortado com um aviso no fim: página gigante não pode encher o outbox,
 * e quem lê o relato precisa saber que o corte foi nosso, não do tribunal.
 * O corte é por bytes e o texto é redecodificado, para o sha bater com o que foi enviado.
 */
function htmlParaEnvio(bruto) {
  if (bruto.length <= LIMITE_HTML) return bruto;
  const cortado = bruto.subarray(0, LIMITE_HTML).toString('utf8');
  return Buffer.from(`${cortado}\n<!-- kaizen: HTML truncado em 4 MB de ${bruto.length} bytes -->`);
}

async function lerCaptura(dir) {
  try {
    const bruto = await lerOuNulo(path.join(dir, 'meta.json'));
    if (!bruto) return null;
    const meta = JSON.parse(bruto.toString('utf8'));
    const captura = { meta };
    const tela = await lerOuNulo(path.join(dir, 'tela.png'));
    if (tela && tela.length) captura.tela_png_gzip_b64 = (await gzip(tela)).toString('base64');
    const html = await lerOuNulo(path.join(dir, 'pagina.html'));
    if (html) {
      const enviado = htmlParaEnvio(html);
      captura.html_gzip_b64 = (await gzip(enviado)).toString('base64');
      captura.html_sha256 = createHash('sha256').update(enviado).digest('hex');
    }
    return captura;
  } catch {
    return null;
  }
}

function lerMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
}

/** Só marca captura que existe: sem meta.json não houve falha capturada para o relato apontar. */
function marcarAssinatura(dir, assinatura) {
  const meta = lerMeta(dir);
  if (!meta) return;
  // tmp + rename: quem lê o meta.json ao mesmo tempo (relato, envio) nunca vê arquivo pela metade.
  const tmp = path.join(dir, `meta.json.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...meta, assinatura }));
    fs.renameSync(tmp, path.join(dir, 'meta.json'));
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nada a limpar */ }
  }
}

function assinaturaDaCaptura(dir) {
  const meta = lerMeta(dir);
  return meta && typeof meta.assinatura === 'string' ? meta.assinatura : null;
}

/** Print e HTML saem depois de enviados; o meta.json fica para o relato saber que houve falha. */
function limparCaptura(dir) {
  for (const nome of ['tela.png', 'pagina.html']) {
    try { fs.unlinkSync(path.join(dir, nome)); } catch { /* já não existe */ }
  }
}

module.exports = { dirFalha, lerCaptura, marcarAssinatura, assinaturaDaCaptura, limparCaptura, LIMITE_HTML };
