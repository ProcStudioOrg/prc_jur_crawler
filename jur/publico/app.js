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

// Tamanho da ressalva antes de truncar (clique expande). O catalogo tem nota de
// ~2900 caracteres (stj) ate uma linha (tjsp) — sem truncar, a coluna de 320px
// vira uma parede de texto so daquele tribunal.
const LIMITE_RESSALVA = 90;

/**
 * Ressalva sempre visivel (sem hover), para qualquer estado != 'ok'. O title
 * na linha (abaixo) cobre desktop; isto cobre quem nunca passou o mouse e
 * quem esta em touch/mobile, onde title nao existe — e e exatamente esse
 * usuario que mais precisa saber, por exemplo, que o TRF1 tem a base
 * congelada desde 31/07/2025 antes de ler "0 resultados" como "nao ha
 * jurisprudencia".
 */
function criarRessalva(t) {
  const el = document.createElement('div');
  el.className = 'ressalva';
  el.dataset.e = t.estado;

  const precisaTruncar = t.nota.length > LIMITE_RESSALVA;
  let aberta = false;

  function render() {
    const corpo = aberta || !precisaTruncar ? t.nota : `${t.nota.slice(0, LIMITE_RESSALVA)}…`;
    el.textContent = `⚠️ ${corpo}`;                 // textContent: nunca HTML de fonte externa
    el.classList.toggle('aberta', aberta);
  }
  render();

  if (precisaTruncar) {
    el.classList.add('expansivel');
    el.title = 'clique para ver a ressalva inteira';
    el.addEventListener('click', () => { aberta = !aberta; render(); });
  }
  return el;
}

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
    const titulo = document.createElement('h2');
    titulo.textContent = `${rotulo} (${doGrupo.length})`;
    grupo.appendChild(titulo);

    for (const t of doGrupo) {
      const linha = document.createElement('div');
      linha.className = 'tribunal';
      linha.dataset.disponivel = String(t.disponivel);
      // A nota tambem vai no title: atalho de hover para quem tem mouse. Mas o
      // hover sozinho NAO cumpre o requisito (nao existe em touch, e fica
      // desconectado do "0 resultados" que aparece la na conversa) — por isso
      // a ressalva() abaixo tambem existe, sempre visivel.
      linha.title = t.nota ? `${t.estado} — ${t.nota}` : t.estado;

      // Monta os tres <span> por DOM (textContent), nao por template string em
      // innerHTML: t.comando e t.nome vem do catalogo (jur/cobertura/tribunais.json),
      // que hoje e estatico mas registra texto de portais de tribunal — a fonte
      // certa de nome "sujo" no futuro. innerHTML com string interpolada seria um
      // sink de XSS pronto para herdar assim que essa fonte deixar de ser estatica.
      const bolinha = document.createElement('span');
      bolinha.className = 'bolinha';
      bolinha.dataset.e = t.estado;

      const sigla = document.createElement('span');
      sigla.className = 'sigla';
      sigla.textContent = t.comando;

      const nome = document.createElement('span');
      nome.className = 'nome';
      nome.textContent = t.nome;

      linha.append(bolinha, sigla, nome);

      if (t.disponivel) {
        linha.addEventListener('click', () => {
          $('#entrada').value = `Busque no ${t.comando} sobre `;
          $('#entrada').focus();
        });
      }
      grupo.appendChild(linha);

      if (t.estado !== 'ok' && t.nota) {
        grupo.appendChild(criarRessalva(t));
      }
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

/**
 * Le um corpo SSE do fetch e chama aoEvento(nome, dados) por evento completo.
 * aoAtividade(), se dado, roda a cada pedaço de bytes recebido (inclusive o
 * ": ping" de keepalive do servidor) — serve para o chamador resetar um
 * timeout de inatividade sem depender de eventos nomeados.
 */
async function lerSSE(resposta, aoEvento, aoAtividade) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (aoAtividade) aoAtividade();
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

// 2x o ": ping" de 15s que o servidor manda em servidor/http.js — qualquer
// atividade real no stream (evento ou ping) reinicia o relogio. So dispara se
// nem o keepalive chegar, o que sinaliza queda de rede/proxy, nao lentidao do LLM.
const TIMEOUT_INATIVIDADE_MS = 30000;

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
  const controlador = new AbortController();
  let timeoutId = null;
  const reiniciarTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_INATIVIDADE_MS);
  };

  try {
    const cabecalhos = { 'content-type': 'application/json' };
    if (campoChave.value.trim()) cabecalhos['x-api-key'] = campoChave.value.trim();

    reiniciarTimeout();
    const r = await fetch('/api/v1/chat', {
      method: 'POST', headers: cabecalhos, body: JSON.stringify({ mensagens: historico }),
      signal: controlador.signal,
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
    }, reiniciarTimeout);
  } catch (erro) {
    if (erro.name === 'AbortError') {
      bolha('erro', `sem resposta do servidor por ${TIMEOUT_INATIVIDADE_MS / 1000}s — conexão interrompida`);
    } else {
      bolha('erro', erro.message);
    }
  } finally {
    clearTimeout(timeoutId);
    botao.disabled = false;
  }
});

carregarTribunais();
verificarSaude();
setInterval(verificarSaude, 30000);
