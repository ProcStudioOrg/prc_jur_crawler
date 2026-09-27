// Um pool por aplicação: buscas e listagens de todas as contas disputam as mesmas vagas.
function criarPool(capacidade = Number(process.env.JUR_CONCORRENCIA || 3)) {
  if (!Number.isSafeInteger(capacidade) || capacidade < 1) throw new Error('JUR_CONCORRENCIA deve ser um inteiro positivo.');
  const ativos = new Set();
  const espera = [];
  function bombear() {
    while (ativos.size < capacidade && espera.length) {
      const item = espera.shift();
      item.signal?.removeEventListener('abort', item.abortar);
      ativos.add(item.id);
      let liberado = false;
      item.resolve(() => {
        if (liberado) return;
        liberado = true;
        ativos.delete(item.id);
        bombear();
      });
    }
  }
  function adquirir(id, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Busca cancelada.', 'AbortError'));
    if (ativos.has(id) || espera.some((v) => v.id === id)) return Promise.reject(new Error('Reserva duplicada.'));
    return new Promise((resolve, reject) => {
      const item = { id, resolve, signal, abortar: () => {
        const i = espera.indexOf(item);
        if (i >= 0) espera.splice(i, 1);
        reject(new DOMException('Busca cancelada.', 'AbortError'));
      } };
      signal?.addEventListener('abort', item.abortar, { once: true });
      espera.push(item);
      bombear();
    });
  }
  return {
    adquirir,
    posicao: (id) => { const i = espera.findIndex((v) => v.id === id); return i < 0 ? null : i + 1; },
    estado: () => ({ total: capacidade, ocupados: ativos.size, disponiveis: capacidade - ativos.size, naFila: espera.length }),
  };
}
module.exports = { criarPool };
