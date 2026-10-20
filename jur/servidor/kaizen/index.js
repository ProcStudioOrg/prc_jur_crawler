// jur/servidor/kaizen/index.js
// Fachada do Kaizen: o que jobs/sentinela/relato chamam. Nada aqui lança nem atrasa a busca —
// diagnóstico que derruba a busca que ele diagnostica é pior que diagnóstico nenhum.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { montarAssinatura } = require('./assinatura');
const { classificar, rotaDoNavegador } = require('./classificar');
const { conferir, avisoDoFiltro } = require('./conferencia');
const { dirFalha, lerCaptura, marcarAssinatura, limparCaptura } = require('./captura');
const { criarOutbox } = require('./outbox');
const P = require('./payload');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG = 10 * 1024 * 1024; // teto do PNG descompactado no FFD

const logar = (e) => console.error('[kaizen]', e && e.message ? e.message : String(e));

// O FFD recusa o item inteiro se a tela não for PNG; lê só o cabeçalho, sem descompactar nada.
async function telaEhPng(dir) {
  let fh;
  try {
    fh = await fs.promises.open(path.join(dir, 'tela.png'), 'r');
    const { size } = await fh.stat();
    if (size > MAX_PNG) return false;
    const buf = Buffer.alloc(PNG_MAGIC.length);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return bytesRead === buf.length && buf.equals(PNG_MAGIC);
  } catch { return false; } finally { await fh?.close().catch(() => {}); }
}

async function capturaParaEnvio(dir) {
  const captura = await lerCaptura(dir);
  if (captura && captura.tela_png_gzip_b64 && !(await telaEhPng(dir))) delete captura.tela_png_gzip_b64;
  return captura;
}

function abrirBanco(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, 'kaizen.db');
  // timeout: a sentinela e as buscas escrevem na mesma fila; sem ele, concorrência vira SQLITE_BUSY.
  const con = new DatabaseSync(arquivo, { timeout: 5000 });
  con.exec('PRAGMA journal_mode=WAL');
  // print/HTML de tribunal e hash de usuário: só o dono do processo lê.
  for (const f of [arquivo, `${arquivo}-wal`, `${arquivo}-shm`]) {
    try { fs.chmodSync(f, 0o600); } catch { /* -wal/-shm podem ainda não existir */ }
  }
  return con;
}

function criarKaizen({ dir, env = process.env, fetchFn, agora = Date.now, versao, revisao } = {}) {
  const versaoAtual = versao || require('../../package.json').version;
  const revisaoAtual = revisao || null;
  const url = env.KAIZEN_WEBHOOK_URL;
  const salt = env.KAIZEN_SALT;
  let con;
  try {
    con = abrirBanco(dir);
  } catch (e) {
    // Banco indisponível (disco cheio, permissão) não pode impedir o servidor de subir.
    logar(e);
    return kaizenNulo();
  }
  const outbox = criarOutbox({ con, url, token: env.KAIZEN_WEBHOOK_TOKEN, ...(fetchFn ? { fetchFn } : {}), agora });
  if (outbox.ligado) outbox.iniciar();

  const em = () => new Date(agora()).toISOString();
  const comum = () => ({ versao: versaoAtual, revisao: revisaoAtual, em: em() });

  /** Falha com captura: assinatura gravada no meta.json, envio e limpeza do print/HTML. */
  async function registrarFalhaCapturada({ origem, tribunal, classe, erro, rota, params, jobId, usuarioHash, arquivo, passoPadrao }) {
    const dir = arquivo ? dirFalha(arquivo) : null;
    try {
      const captura = dir ? await capturaParaEnvio(dir) : null;
      const t = P.tribunalValido(tribunal);
      const c = P.classeValida(classe);
      const passo = P.passoValido(captura?.meta?.passo || passoPadrao);
      const assinatura = montarAssinatura({ tribunal: t, classe: c, passo, erro }).trim();
      if (dir) marcarAssinatura(dir, assinatura);
      outbox.enfileirar('jur-diagnostico', P.payloadFalha({
        ...comum(), origem, tribunal: t, classe: c, passo, assinatura, erro, rota, params, jobId, usuarioHash, captura,
      }));
    } catch (e) {
      logar(e);
    } finally {
      // Sempre, com ou sem FFD configurado: senão `.falha/` acumula print e HTML para sempre.
      if (dir) limparCaptura(dir);
    }
  }

  async function registrarErro(job, r, opts) {
    try {
      const { usuarioId, arquivo, origem = 'busca', cancelado = false } = opts || {};
      // Cancelamento pelo usuário não é falha: some com a captura e não manda nada.
      if (cancelado || job?.status === 'cancelado') {
        if (arquivo) await fs.promises.rm(dirFalha(arquivo), { recursive: true, force: true }).catch(() => {});
        return;
      }
      const rota = rotaDoNavegador(job?.navegador);
      await registrarFalhaCapturada({
        origem, tribunal: job?.comando, classe: classificar({ erro: r?.erro, rota }), erro: r?.erro, rota,
        params: job?.params, jobId: job?.id, usuarioHash: P.hashUsuario(usuarioId, salt), arquivo, passoPadrao: 'desconhecido',
      });
    } catch (e) { logar(e); }
  }

  function enfileirarResgate(tipo, erro, base) {
    const assinatura = montarAssinatura({
      tribunal: base.tribunal, classe: `resgate:${tipo}`, passo: 'resgate', erro: Array.isArray(erro) ? erro.join('; ') : erro,
    }).trim();
    outbox.enfileirar('jur-diagnostico', P.payloadResgate({ ...comum(), ...base, tipo, assinatura, erro }));
  }

  // Síncrono e barato: roda no caminho de conclusão do job, antes de gravar os avisos.
  function registrarConcluido(job, r, opts) {
    const avisos = [];
    try {
      const { usuarioId, origem = 'busca' } = opts || {};
      const tribunal = P.tribunalValido(job?.comando);
      const rota = rotaDoNavegador(job?.navegador);
      const base = { origem, tribunal, rota, params: job?.params, jobId: job?.id, usuarioHash: P.hashUsuario(usuarioId, salt) };
      const resultados = Array.isArray(r?.resultados) ? r.resultados : [];
      const conferencia = conferir(job?.params, resultados, { comando: job?.comando });
      for (const it of conferencia.filter((x) => x.veredito === 'ignorado')) {
        const classe = P.classeValida(`filtro_ignorado:${it.filtro}`);
        const assinatura = montarAssinatura({ tribunal, classe, passo: 'conferencia', erro: it.detalhe }).trim();
        outbox.enfileirar('jur-diagnostico', P.payloadFalha({
          ...comum(), ...base, classe, passo: 'conferencia', assinatura, erro: it.detalhe, conferencia, exemplos: it.exemplos,
        }));
        avisos.push(avisoDoFiltro(it));
      }
      if (/\(reserva\)/i.test(String(job?.navegador || ''))) enfileirarResgate('reserva', job.navegadorFalhas, base);
      if (job?.resolvidoPeloUsuario) enfileirarResgate('captcha_manual', null, base);
      return { avisos };
    } catch (e) {
      logar(e);
      return { avisos: [] };
    }
  }

  async function registrarSentinela(dados) {
    const arquivo = dados?.arquivo;
    let limparNoFim = false;
    try {
      const { caso, avaliacao, r } = dados || {};
      const classe = avaliacao?.classe;
      const filtro = /^filtro_ignorado:/.test(String(classe || ''));
      if (filtro) {
        limparNoFim = true;
        // Conferência não tem captura (a busca terminou bem); o print, se houver, sai igual.
        const lista = Array.isArray(avaliacao?.conferencia) ? avaliacao.conferencia : [];
        const it = lista.find((x) => `filtro_ignorado:${x?.filtro}` === classe) || {};
        const tribunal = P.tribunalValido(caso?.tribunal);
        const assinatura = montarAssinatura({ tribunal, classe: P.classeValida(classe), passo: 'conferencia', erro: it.detalhe }).trim();
        outbox.enfileirar('jur-diagnostico', P.payloadFalha({
          ...comum(), origem: 'sentinela', tribunal, classe, passo: 'conferencia', assinatura, erro: it.detalhe ?? null,
          rota: null, params: caso?.params, jobId: null, usuarioHash: null, conferencia: lista, exemplos: it.exemplos,
        }));
        return;
      }
      await registrarFalhaCapturada({
        origem: 'sentinela', tribunal: caso?.tribunal, classe, erro: r?.erro ?? null, rota: null,
        params: caso?.params, jobId: null, usuarioHash: null, arquivo, passoPadrao: 'desconhecido',
      });
    } catch (e) {
      logar(e);
    } finally {
      // o ramo de captura limpa sozinho; o da conferência limpa aqui, mesmo se o envio lançar
      if (limparNoFim && arquivo) { try { limparCaptura(dirFalha(arquivo)); } catch { /* nunca lança */ } }
    }
  }

  function enviarResumo(resumo) {
    try { outbox.enfileirar('jur-diagnostico', P.payloadResumo({ ...comum(), resumo })); } catch (e) { logar(e); }
  }

  // true só quando o relato vai de fato ao FFD: sem webhook configurado ele não chegaria a ninguém.
  // Passa sempre por payloadRelato (idempotente): objeto cru nunca vai direto ao FFD.
  function enviarRelato(relato) {
    try {
      if (!outbox.ligado || !relato) return false;
      return outbox.enfileirar('user-issues', P.payloadRelato(relato)) === true;
    } catch (e) { logar(e); return false; }
  }

  function linkFalha(assinatura) {
    if (!url || !assinatura) return null;
    try { return `${new URL(url).origin}/jur-falhas?assinatura=${encodeURIComponent(assinatura)}`; } catch { return null; }
  }

  function fechar() {
    try { outbox.fechar(); } catch { /* já parada */ }
    try { con.close(); } catch { /* já fechado */ }
  }

  return { registrarErro, registrarConcluido, registrarSentinela, enviarResumo, enviarRelato, linkFalha, outbox, fechar };
}

function kaizenNulo() {
  const outbox = {
    ligado: false,
    enfileirar: () => false,
    drenar: async () => ({ enviados: 0, adiados: 0, descartados: 0 }),
    iniciar() {},
    parar() {},
    fechar() {},
    pendentes: () => 0,
  };
  return {
    registrarErro: async () => {},
    registrarConcluido: () => ({ avisos: [] }),
    registrarSentinela: async () => {},
    enviarResumo() {},
    enviarRelato: () => false,
    linkFalha: () => null,
    outbox,
    fechar() {},
  };
}

module.exports = { criarKaizen, kaizenNulo };
