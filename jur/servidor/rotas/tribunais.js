const catalogo = require('../catalogo');
const capacidades = require('../capacidades');
const { json } = require('../http');

function registrar(roteador, deps = {}) {
  roteador.rota('GET', '/api/v1/saude', (req, res) => {
    json(res, 200, { ok: true, versao: require('../../package.json').version });
  });

  roteador.rota('GET', '/api/v1/tribunais', (req, res) => {
    const { segmento, uf, estado } = req.query;
    json(res, 200, { tribunais: catalogo.listar({ segmento, uf, estado }).map((t) => {
      const assistido = Boolean(deps.fila?.permitirAssistido?.(t.comando));
      const base = assistido
        ? { ...t, disponivel: true, assistido: true, nota: t.nota + ' Tentativa assistida habilitada: você pode preencher o captcha na tela do navegador. Acesso não garantido.' }
        : t;
      // `resumo` e `capacidades` sao o que a FICHA mostra; `nota` continua no payload
      // para o modelo e para clientes antigos, mas a interface deixa de renderiza-la.
      const cap = capacidades.obter(t.comando, { disponivel: base.disponivel });
      return { ...base, resumo: cap.resumo, capacidades: cap.funcionalidades };
    }) });
  });
}

module.exports = { registrar };
