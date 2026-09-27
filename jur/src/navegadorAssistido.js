// IPC restrito à sessão da CLI. Importar este módulo não ativa acompanhamento.
const TECLAS = new Set([
  'Enter', 'Tab', 'Shift+Tab', 'Space', 'Backspace', 'Delete', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
]);
const PRAZO_PADRAO = 120000;
class ErroAssistido extends Error {}

function validarAcao(acao) {
  if (!acao || typeof acao !== 'object' || Array.isArray(acao)) throw new ErroAssistido('Ação inválida.');
  switch (acao.tipo) {
    case 'clicar':
      if (![acao.x, acao.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
        throw new ErroAssistido('Coordenadas inválidas.');
      }
      return { tipo: 'clicar', x: acao.x, y: acao.y };
    case 'texto':
      if (typeof acao.texto !== 'string' || acao.texto.length > 1000) throw new ErroAssistido('Texto inválido; limite de 1000 caracteres.');
      return { tipo: 'texto', texto: acao.texto };
    case 'tecla':
      if (!TECLAS.has(acao.tecla)) throw new ErroAssistido('Tecla não permitida.');
      return { tipo: 'tecla', tecla: acao.tecla };
    case 'rolar':
      if (!Number.isFinite(acao.deltaY)) throw new ErroAssistido('Rolagem inválida.');
      return { tipo: 'rolar', deltaY: Math.max(-1200, Math.min(1200, acao.deltaY)) };
    case 'continuar': return { tipo: 'continuar' };
    default: throw new ErroAssistido('Ação não permitida.');
  }
}

function prazoValido(valor) {
  const prazo = Number(valor);
  return Number.isFinite(prazo) && prazo > 0 && prazo <= 2147483647 ? prazo : PRAZO_PADRAO;
}

function criarPonte({ enviar = () => {}, captcha = false, timeoutMs = PRAZO_PADRAO } = {}) {
  const paginas = new Set();
  let pausa = null;
  let fila = Promise.resolve();
  let captura = null;
  let pendentes = 0;
  const emitir = (dados) => enviar({ jurNavegador: true, ...dados });
  const estado = (valor, mensagem) => emitir({ tipo: 'estado', estado: valor, mensagem });
  const paginaAtual = () => [...paginas].reverse().find((p) => !p.isClosed());

  function finalizarPausa(atual, erro) {
    if (pausa !== atual) return;
    clearTimeout(atual.timer);
    pausa = null;
    if (erro) atual.rejeitar(erro);
    else {
      estado('rodando', 'Verificação concluída. A busca continua.');
      atual.resolver(true);
    }
  }

  function anexarPagina(page) {
    if (paginas.has(page) || page.isClosed()) return;
    paginas.add(page);
    page.once('close', () => {
      paginas.delete(page);
      if (pausa?.page === page) finalizarPausa(pausa, new ErroAssistido('O navegador foi fechado durante a intervenção.'));
    });
    if (!pausa) estado('rodando', 'Navegador em execução.');
  }

  function aguardarIntervencao(page, { verificar, mensagem = 'Resolva a verificação e selecione Continuar.', timeoutMs: prazo } = {}) {
    if (!captcha) return Promise.resolve(false);
    if (pausa) return Promise.reject(new ErroAssistido('Já existe uma intervenção aguardando nesta execução.'));
    if (!page || page.isClosed() || typeof verificar !== 'function') return Promise.reject(new ErroAssistido('Navegador indisponível para intervenção.'));
    anexarPagina(page);
    return new Promise((resolver, rejeitar) => {
      const atual = { page, verificar, resolver, rejeitar, retomando: false };
      pausa = atual;
      atual.timer = setTimeout(() => finalizarPausa(atual, new ErroAssistido('O prazo para resolver o CAPTCHA expirou. Inicie uma nova busca.')), prazoValido(prazo ?? timeoutMs));
      estado('aguardando_usuario', mensagem);
    });
  }

  async function dimensoes(page) {
    const tamanho = page.viewportSize() || await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (!(tamanho.width > 0 && tamanho.height > 0)) throw new ErroAssistido('A tela do navegador está indisponível.');
    return tamanho;
  }

  async function capturarTela() {
    if (captura) return captura;
    const page = paginaAtual();
    if (!page) throw new ErroAssistido('O navegador ainda não disponibilizou uma tela.');
    captura = (async () => {
      try {
        const { width, height } = await dimensoes(page);
        const imagem = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false, scale: 'css', timeout: 8000 });
        return { imagem: imagem.toString('base64'), largura: width, altura: height };
      } catch {
        throw new ErroAssistido('Não foi possível capturar a tela do navegador.');
      }
    })();
    try { return await captura; } finally { captura = null; }
  }

  async function executarAcao(entrada) {
    const acao = validarAcao(entrada);
    const atual = pausa;
    if (!atual || atual.retomando) throw new ErroAssistido('Controle disponível apenas durante a pausa para intervenção.');
    if (pendentes >= 32) throw new ErroAssistido('Aguarde as ações anteriores terminarem.');
    if (acao.tipo === 'continuar') atual.retomando = true;
    pendentes++;
    const executar = async () => {
      if (pausa !== atual) throw new ErroAssistido('A pausa para intervenção já foi encerrada.');
      const page = paginaAtual();
      if (!page) throw new ErroAssistido('O navegador foi fechado.');
      try {
        switch (acao.tipo) {
          case 'clicar': {
            const { width, height } = await dimensoes(page);
            await page.mouse.click(Math.min(width - 1, acao.x * width), Math.min(height - 1, acao.y * height));
            break;
          }
          case 'texto': await page.keyboard.insertText(acao.texto); break;
          case 'tecla': await page.keyboard.press(acao.tecla); break;
          case 'rolar': await page.mouse.wheel(0, acao.deltaY); break;
          case 'continuar': {
            // A fila garante que nenhum clique/texto anterior esteja em andamento.
            let concluido = false;
            try { concluido = await atual.verificar(); } catch { /* Navegação ou desafio ainda ativos. */ }
            if (pausa !== atual) throw new ErroAssistido('A pausa para intervenção já foi encerrada.');
            if (concluido !== true) {
              estado('aguardando_usuario', 'A verificação ainda não foi concluída. Resolva o desafio e tente Continuar novamente.');
              throw new ErroAssistido('A verificação ainda não foi concluída.');
            }
            finalizarPausa(atual);
            break;
          }
        }
        return { ok: true };
      } catch (erro) {
        if (erro instanceof ErroAssistido) throw erro;
        throw new ErroAssistido('Não foi possível aplicar a ação no navegador.');
      } finally {
        if (acao.tipo === 'continuar' && pausa === atual) atual.retomando = false;
      }
    };
    const resultado = fila.then(executar);
    fila = resultado.catch(() => {});
    try { return await resultado; } finally { pendentes--; }
  }

  async function tratarMensagem(msg) {
    if (msg?.jurNavegador !== true || typeof msg.requestId !== 'string' || !msg.requestId || msg.requestId.length > 128) return;
    try {
      let dados;
      if (msg.tipo === 'tela') dados = await capturarTela();
      else if (msg.tipo === 'acao') dados = await executarAcao(msg.acao);
      else throw new ErroAssistido('Solicitação não permitida.');
      emitir({ requestId: msg.requestId, dados });
    } catch (erro) {
      emitir({ requestId: msg.requestId, erro: erro instanceof ErroAssistido ? erro.message : 'Não foi possível atender à solicitação.' });
    }
  }

  function encerrar() {
    if (pausa) finalizarPausa(pausa, new ErroAssistido('A sessão do navegador foi encerrada.'));
    paginas.clear();
  }

  return { anexarPagina, aguardarIntervencao, executarAcao, capturarTela, tratarMensagem, encerrar };
}

let ponteProcesso;
function obterPonte() {
  if (process.env.JUR_ACOMPANHAR !== '1' && process.env.JUR_CAPTCHA !== '1') return null;
  if (!ponteProcesso) {
    ponteProcesso = criarPonte({
      captcha: process.env.JUR_CAPTCHA === '1',
      timeoutMs: prazoValido(process.env.JUR_CAPTCHA_TIMEOUT_MS),
      enviar: (msg) => {
        if (process.connected && typeof process.send === 'function') {
          try { process.send(msg, () => {}); } catch { /* O pai pode já ter cancelado. */ }
        }
      },
    });
    process.on('message', (msg) => { void ponteProcesso.tratarMensagem(msg); });
    process.once('disconnect', () => ponteProcesso.encerrar());
    // A ponte não deve manter uma CLI sem navegador viva depois do resultado.
    process.channel?.unref();
  }
  return ponteProcesso;
}

function aguardarIntervencao(page, opcoes) {
  if (process.env.JUR_CAPTCHA !== '1') return Promise.resolve(false);
  return obterPonte().aguardarIntervencao(page, opcoes);
}

module.exports = { validarAcao, criarPonte, obterPonte, aguardarIntervencao };
