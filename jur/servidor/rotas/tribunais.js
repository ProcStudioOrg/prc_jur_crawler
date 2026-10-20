const catalogo = require('../catalogo');
const capacidades = require('../capacidades');
const { json } = require('../http');
const { assistidoSempre } = require('../navegadores/remotos');

function registrar(roteador, deps = {}) {
  roteador.rota('GET', '/api/v1/saude', (req, res) => {
    json(res, 200, { ok: true, versao: require('../../package.json').version });
  });

  // Um tribunal do catalogo na forma que a API devolve: estado assistido aplicado,
  // `resumo` e `capacidades` (o que a ficha mostra) calculados. `nota` e a ressalva
  // tecnica longa do catalogo — vai inteira no DETALHE e fica fora da LISTAGEM.
  function projetar(t) {
    const assistido = Boolean(deps.fila?.permitirAssistido?.(t.comando));
    const base = assistido
      ? { ...t, disponivel: true, assistido: true, nota: t.nota + (assistidoSempre(t.comando)
        ? ' Busca pelo navegador remoto: a verificação é resolvida automaticamente (1 a 2 minutos) e, se falhar, você resolve na tela do navegador, que abre sozinha. Acesso não garantido.'
        : ' Tentativa assistida habilitada: você pode preencher o captcha na tela do navegador. Acesso não garantido.') }
      : t;
    const cap = capacidades.obter(t.comando, { disponivel: base.disponivel });
    return { ...base, resumo: cap.resumo, capacidades: cap.funcionalidades };
  }

  // BRU-75: a listagem pesava ~316 KB para 77 tribunais, e ~288 KB eram `nota` — a
  // ressalva tecnica que a interface nunca renderiza (ela le `resumo`) e que o modelo
  // recebe por outro caminho (ferramentas.js le o catalogo direto, nao esta rota). A
  // listagem devolve tudo MENOS `nota`; quem precisa dela pede o detalhe por comando.
  roteador.rota('GET', '/api/v1/tribunais', (req, res) => {
    const { segmento, uf, estado } = req.query;
    json(res, 200, { tribunais: catalogo.listar({ segmento, uf, estado }).map((t) => {
      const { nota, ...enxuto } = projetar(t);
      return enxuto;
    }) });
  });

  roteador.rota('GET', '/api/v1/tribunais/:comando', (req, res) => {
    const t = catalogo.obter(req.params.comando);
    if (!t) return json(res, 404, { erro: `tribunal desconhecido: ${req.params.comando}` });
    json(res, 200, projetar(t));
  });
}

module.exports = { registrar };
