// jur/publico/app.js
const $ = (s) => document.querySelector(s);
const CHAVE_LOCAL = 'jur.chave';

let tribunais = [];
const historico = [];

// ---------- chave: fica no browser, nunca no servidor ----------
const campoChave = $('#chave');
try { campoChave.value = localStorage.getItem(CHAVE_LOCAL) || ''; } catch { /* modo privado */ }
campoChave.addEventListener('change', () => {
  try { localStorage.setItem(CHAVE_LOCAL, campoChave.value.trim()); } catch { /* ignora */ }
});

// ---------- catalogo ----------
const SEGMENTOS = [
  ['superior', 'Superiores'], ['federal', 'Federais'], ['estadual', 'Estaduais'],
  ['trabalhista', 'Trabalhista'], ['contas', 'Contas'],
];

function pintarTribunais() {
  const termo = $('#filtro').value.trim().toLowerCase();
  const visiveis = tribunais.filter((t) =>
    !termo || t.comando.includes(termo) || t.nome.toLowerCase().includes(termo)
    || t.uf.some((u) => u.toLowerCase() === termo));

  const alvo = $('#tribunais');
  alvo.innerHTML = '';

  const ordem = [...SEGMENTOS.map(([k]) => k), null];
  for (const chave of ordem) {
    const doGrupo = visiveis.filter((t) => (chave === null ? !SEGMENTOS.some(([k]) => k === t.segmento) : t.segmento === chave));
    if (!doGrupo.length) continue;

    const grupo = document.createElement('div');
    grupo.className = 'grupo';
    const rotulo = (SEGMENTOS.find(([k]) => k === chave) || [null, 'Outros'])[1];
    grupo.innerHTML = `<h2>${rotulo} (${doGrupo.length})</h2>`;

    for (const t of doGrupo) {
      const linha = document.createElement('div');
      linha.className = 'tribunal';
      linha.dataset.disponivel = String(t.disponivel);
      // A nota vai no title: e o que impede ler "cinza" como "nao existe".
      linha.title = t.nota ? `${t.estado} — ${t.nota}` : t.estado;
      linha.innerHTML = `<span class="bolinha" data-e="${t.estado}"></span>`
        + `<span class="sigla">${t.comando}</span><span class="nome">${t.nome}</span>`;
      if (t.disponivel) {
        linha.addEventListener('click', () => {
          $('#entrada').value = `Busque no ${t.comando} sobre `;
          $('#entrada').focus();
        });
      }
      grupo.appendChild(linha);
    }
    alvo.appendChild(grupo);
  }
}

async function carregarTribunais() {
  const r = await fetch('/api/v1/tribunais');
  tribunais = (await r.json()).tribunais;
  const conta = (e) => tribunais.filter((t) => t.estado === e).length;
  $('#placar').textContent =
    `${tribunais.length} tribunais · ${conta('ok')} ok · ${conta('instavel')} instáveis · `
    + `${conta('sem-acesso')} bloqueados · ${conta('exige-sessao')} exigem sessão`;
  pintarTribunais();
}

$('#filtro').addEventListener('input', pintarTribunais);

// ---------- saude ----------
async function verificarSaude() {
  try {
    const r = await fetch('/api/v1/saude');
    $('#saude').textContent = r.ok ? 'online' : 'com problema';
  } catch {
    $('#saude').textContent = 'offline';
  }
}

// ---------- chat ----------
function bolha(classe, texto) {
  const div = document.createElement('div');
  div.className = `msg ${classe}`;
  div.textContent = texto;
  $('#mensagens').appendChild(div);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  return div;
}

/** Le um corpo SSE do fetch e chama aoEvento(nome, dados) por evento completo. */
async function lerSSE(resposta, aoEvento) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    const partes = buffer.split('\n\n');
    buffer = partes.pop();
    for (const parte of partes) {
      const nome = (parte.match(/^event: (.+)$/m) || [])[1];
      const dado = (parte.match(/^data: (.+)$/m) || [])[1];
      if (!nome || !dado) continue;          // linha de ping
      try { aoEvento(nome, JSON.parse(dado)); } catch { /* ignora fragmento */ }
    }
  }
}

$('#formulario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#entrada').value.trim();
  if (!texto) return;

  const botao = $('#formulario button');
  botao.disabled = true;
  $('#entrada').value = '';
  bolha('user', texto);
  historico.push({ role: 'user', content: texto });

  let destino = null;
  try {
    const cabecalhos = { 'content-type': 'application/json' };
    if (campoChave.value.trim()) cabecalhos['x-api-key'] = campoChave.value.trim();

    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cabecalhos, body: JSON.stringify({ mensagens: historico }),
    });

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
      bolha('erro', corpo.erro);
      return;
    }

    await lerSSE(r, (nome, dados) => {
      if (nome === 'texto') {
        if (!destino) destino = bolha('assistant', '');
        destino.textContent += dados.texto;
        $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
      } else if (nome === 'ferramenta') {
        bolha('ferramenta', `▸ ${dados.nome}(${JSON.stringify(dados.entrada)})`);
        destino = null;
      } else if (nome === 'fim') {
        historico.push({ role: 'assistant', content: dados.texto });
      } else if (nome === 'erro') {
        bolha('erro', dados.erro);
      }
    });
  } catch (erro) {
    bolha('erro', erro.message);
  } finally {
    botao.disabled = false;
  }
});

carregarTribunais();
verificarSaude();
setInterval(verificarSaude, 30000);
