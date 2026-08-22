const { json } = require('../http');
const openapi = require('../openapi');

// Pagina autocontida de proposito (achado do brief da Task 5: ambiente fechado, sem
// CDN nem Swagger UI externo — precisa renderizar sem internet). O CSS e o JS vivem
// INLINE neste HTML, e o unico fetch que a pagina faz e para /api/v1/openapi.json,
// que e a mesma origem — nunca sai da maquina.
const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jur — documentação da API</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 2rem 1.5rem 4rem; max-width: 960px; margin-inline: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
    }
    header { margin-bottom: 2rem; }
    h1 { margin: 0 0 .25rem; font-size: 1.75rem; }
    .versao { color: #888; font-size: .9rem; }
    .info-descricao { white-space: pre-line; margin-top: 1rem; }
    .info-descricao code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: .25em; }
    #busca {
      width: 100%; padding: .6rem .8rem; font-size: 1rem; margin: 1rem 0 2rem;
      border: 1px solid #8888; border-radius: .5rem; background: transparent; color: inherit;
    }
    h2 { border-bottom: 1px solid #8884; padding-bottom: .35rem; margin-top: 2.5rem; }
    .rota { border: 1px solid #8884; border-radius: .5rem; padding: 1rem 1.25rem; margin: 1rem 0; }
    .rota-cabecalho { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; }
    .metodo {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700;
      font-size: .8rem; padding: .15rem .5rem; border-radius: .3rem; color: #fff;
    }
    .metodo-get { background: #2563eb; }
    .metodo-post { background: #16a34a; }
    .metodo-delete { background: #dc2626; }
    .caminho { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem; }
    .resumo { font-weight: 600; }
    .descricao { margin: .6rem 0; white-space: pre-line; color: #ccc; }
    .descricao code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: .25em; }
    .parametros, .codigos { margin-top: .6rem; font-size: .9rem; }
    .parametros table, .codigos table { border-collapse: collapse; width: 100%; }
    .parametros th, .parametros td, .codigos th, .codigos td {
      text-align: left; padding: .25rem .5rem .25rem 0; vertical-align: top;
    }
    .codigo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .semlista { color: #888; font-style: italic; }
    footer { margin-top: 3rem; color: #888; font-size: .85rem; }
    a { color: inherit; }
  </style>
</head>
<body>
  <header>
    <h1>jur — documentação da API</h1>
    <div class="versao" id="versao">carregando…</div>
    <div class="info-descricao" id="info-descricao"></div>
  </header>

  <input id="busca" type="search" placeholder="filtrar por método, caminho ou palavra…">

  <div id="conteudo">carregando /api/v1/openapi.json…</div>

  <footer>
    Documento completo em <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1).
  </footer>

  <script>
    // Sem dependencia externa: so DOM e fetch, os dois nativos do browser. O fetch e
    // para /api/v1/openapi.json, mesma origem desta pagina — nunca sai da maquina.
    function escapar(texto) {
      const d = document.createElement('div');
      d.textContent = String(texto == null ? '' : texto);
      return d.innerHTML;
    }

    function agrupar(paths) {
      // Agrupa por recurso: primeiro segmento fixo do caminho (ignora {id} e afins).
      const grupos = new Map();
      for (const [caminho, metodos] of Object.entries(paths)) {
        const segmentos = caminho.split('/').filter(Boolean);
        let recurso = '/';
        for (const s of segmentos) {
          if (s.startsWith('{')) break;
          recurso += (recurso === '/' ? '' : '/') + s;
        }
        if (!grupos.has(recurso)) grupos.set(recurso, []);
        for (const [metodo, operacao] of Object.entries(metodos)) {
          grupos.get(recurso).push({ caminho, metodo: metodo.toUpperCase(), operacao });
        }
      }
      return grupos;
    }

    function linhaParametros(parametros) {
      if (!parametros || !parametros.length) return '';
      const linhas = parametros.map((p) => {
        const tipo = (p.schema && (p.schema.type || (p.schema.$ref && p.schema.$ref.split('/').pop()))) || '';
        return '<tr><td><code>' + escapar(p.name) + '</code></td><td>' + escapar(p.in) + '</td>'
          + '<td>' + escapar(tipo) + (p.required ? ' · obrigatório' : '') + '</td>'
          + '<td>' + escapar(p.description || '') + '</td></tr>';
      }).join('');
      return '<div class="parametros"><table><thead><tr><th>parâmetro</th><th>em</th><th>tipo</th><th>descrição</th></tr></thead>'
        + '<tbody>' + linhas + '</tbody></table></div>';
    }

    function linhaCodigos(respostas) {
      if (!respostas) return '<p class="semlista">sem respostas documentadas</p>';
      const linhas = Object.entries(respostas).map(([codigo, r]) =>
        '<tr><td class="codigo">' + escapar(codigo) + '</td><td>' + escapar(r.description || '') + '</td></tr>'
      ).join('');
      return '<div class="codigos"><table><tbody>' + linhas + '</tbody></table></div>';
    }

    function renderizarRota({ caminho, metodo, operacao }) {
      const classeMetodo = 'metodo metodo-' + metodo.toLowerCase();
      return '<div class="rota" data-texto="' + escapar((metodo + ' ' + caminho + ' ' + (operacao.summary || '') + ' ' + (operacao.description || '')).toLowerCase()) + '">'
        + '<div class="rota-cabecalho">'
        + '<span class="' + classeMetodo + '">' + escapar(metodo) + '</span>'
        + '<span class="caminho">' + escapar(caminho) + '</span>'
        + '<span class="resumo">' + escapar(operacao.summary || '') + '</span>'
        + '</div>'
        + (operacao.description ? '<div class="descricao">' + escapar(operacao.description) + '</div>' : '')
        + linhaParametros(operacao.parameters)
        + linhaCodigos(operacao.responses)
        + '</div>';
    }

    function renderizar(doc) {
      document.getElementById('versao').textContent = doc.info.title + ' · v' + doc.info.version;
      document.getElementById('info-descricao').innerHTML = escapar(doc.info.description || '').replace(/\\n/g, '<br>');

      const grupos = agrupar(doc.paths);
      const recursos = [...grupos.keys()].sort();
      const conteudo = document.getElementById('conteudo');
      conteudo.innerHTML = recursos.map((recurso) => {
        const rotas = grupos.get(recurso).sort((a, b) => a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo));
        return '<section><h2>' + escapar(recurso) + '</h2>' + rotas.map(renderizarRota).join('') + '</section>';
      }).join('');

      document.getElementById('busca').addEventListener('input', (ev) => {
        const termo = ev.target.value.trim().toLowerCase();
        for (const el of document.querySelectorAll('.rota')) {
          el.style.display = !termo || el.dataset.texto.includes(termo) ? '' : 'none';
        }
      });
    }

    fetch('/api/v1/openapi.json')
      .then((r) => r.json())
      .then(renderizar)
      .catch((e) => {
        document.getElementById('conteudo').textContent = 'Falha ao carregar /api/v1/openapi.json: ' + e.message;
      });
  </script>
</body>
</html>
`;

function registrar(roteador) {
  roteador.rota('GET', '/api/v1/openapi.json', (req, res) => {
    json(res, 200, openapi.documento());
  });

  roteador.rota('GET', '/docs', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
}

module.exports = { registrar };
