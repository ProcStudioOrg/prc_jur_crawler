// jur/publico/config.js
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);
  const CHAVE_LLM = 'jur.chaveLlm';

  const guardado = {
    ler(k, padrao = '') { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } },
    escrever(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  };

  function quando(ms) {
    if (!ms) return 'nunca';
    return new Date(ms).toLocaleString('pt-BR');
  }

  async function listarChaves(alvo) {
    alvo.innerHTML = '';
    let chaves = [];
    try {
      chaves = (await window.jurApi.pedir('/api/v1/chaves')).chaves;
    } catch (e) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = `Não foi possível listar: ${e.message}`;
      alvo.appendChild(p);
      return;
    }
    const vivas = chaves.filter((c) => !c.revogadoEm);
    if (!vivas.length) {
      const p = document.createElement('p');
      p.className = 'vazio';
      p.textContent = 'Nenhuma chave de conexão ativa.';
      alvo.appendChild(p);
      return;
    }
    for (const c of vivas) {
      const linha = document.createElement('div');
      linha.className = 'chave-linha';
      const info = document.createElement('div');
      const nome = document.createElement('strong');
      nome.textContent = c.nome;
      const detalhe = document.createElement('small');
      detalhe.textContent = `${c.prefixo}… · criada ${quando(c.criadoEm)} · último uso ${quando(c.ultimoUsoEm)}`;
      info.appendChild(nome); info.appendChild(document.createElement('br')); info.appendChild(detalhe);
      const revogar = document.createElement('button');
      revogar.className = 'revogar';
      revogar.textContent = 'Revogar';
      revogar.addEventListener('click', async () => {
        await window.jurApi.pedir(`/api/v1/chaves/${c.id}`, { method: 'DELETE' });
        listarChaves(alvo);
      });
      linha.appendChild(info); linha.appendChild(revogar);
      alvo.appendChild(linha);
    }
  }

  function abrir() {
    const painel = window.jurUI.abrirPainel($('#painel-config'), '');
    const caixa = $('.painel-caixa', painel);

    const h = document.createElement('h2');
    h.textContent = 'Configurações';
    caixa.appendChild(h);

    // --- chave da LLM ---
    const s1 = document.createElement('section');
    s1.className = 'secao-config';
    const t1 = document.createElement('h3');
    t1.textContent = 'Chave da LLM';
    const d1 = document.createElement('p');
    d1.className = 'vazio';
    d1.textContent = 'A sua chave da Anthropic, que o jur usa para conversar. Fica só neste browser e nunca é guardada no servidor.';
    const campo = document.createElement('input');
    campo.type = 'password';
    campo.className = 'campo';
    campo.placeholder = 'sk-ant-…';
    campo.value = guardado.ler(CHAVE_LLM);
    campo.addEventListener('change', () => guardado.escrever(CHAVE_LLM, campo.value.trim()));
    s1.appendChild(t1); s1.appendChild(d1); s1.appendChild(campo);
    caixa.appendChild(s1);

    // --- chaves de conexão ---
    const s2 = document.createElement('section');
    s2.className = 'secao-config';
    const t2 = document.createElement('h3');
    t2.textContent = 'Chaves de conexão';
    const d2 = document.createElement('p');
    d2.className = 'vazio';
    d2.textContent = 'Emitidas pelo jur, para outro programa (Claude Code, cliente MCP, script) falar com esta API. O valor aparece uma única vez.';
    s2.appendChild(t2); s2.appendChild(d2);

    const form = document.createElement('form');
    form.className = 'form-chave';
    const nome = document.createElement('input');
    nome.className = 'campo';
    nome.placeholder = 'Para que serve esta chave? (ex.: claude code)';
    const gerar = document.createElement('button');
    gerar.type = 'submit';
    gerar.className = 'botao-acento';
    gerar.textContent = 'Gerar chave';
    form.appendChild(nome); form.appendChild(gerar);

    const lista = document.createElement('div');
    lista.className = 'lista-chaves';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      gerar.disabled = true;
      try {
        const nova = await window.jurApi.pedir('/api/v1/chaves', {
          method: 'POST', body: JSON.stringify({ nome: nome.value.trim() }),
        });
        nome.value = '';
        const aviso = document.createElement('div');
        aviso.className = 'chave-nova';
        const p = document.createElement('p');
        p.textContent = 'Copie agora — este valor não será exibido de novo:';
        const codigo = document.createElement('code');
        codigo.textContent = nova.valor;
        const copiar = document.createElement('button');
        copiar.className = 'botao-acento';
        copiar.textContent = 'Copiar';
        copiar.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(nova.valor); copiar.textContent = 'Copiado'; }
          catch { copiar.textContent = 'Copie manualmente'; }
        });
        aviso.appendChild(p); aviso.appendChild(codigo); aviso.appendChild(copiar);
        s2.insertBefore(aviso, lista);
        listarChaves(lista);
      } catch (err) {
        const erro = document.createElement('p');
        erro.className = 'vazio';
        erro.textContent = err.message;
        s2.insertBefore(erro, lista);
      } finally {
        gerar.disabled = false;
      }
    });

    s2.appendChild(form);
    s2.appendChild(lista);
    caixa.appendChild(s2);

    // --- como conectar ---
    const s3 = document.createElement('section');
    s3.className = 'secao-config';
    const t3 = document.createElement('h3');
    t3.textContent = 'Como conectar';
    const pre = document.createElement('pre');
    pre.className = 'exemplo';
    pre.textContent = [
      '# MCP no Claude Code',
      'claude mcp add --transport http jur http://localhost:3000/mcp \\',
      '  --header "Authorization: Bearer SUA_CHAVE"',
      '',
      '# REST',
      'curl -X POST localhost:3000/api/v1/buscas \\',
      '  -H "Authorization: Bearer SUA_CHAVE" \\',
      '  -H "content-type: application/json" \\',
      '  -d \'{"tribunal":"trf4","query":"auxilio-acidente"}\'',
      '',
      '# Documentação completa: http://localhost:3000/docs',
    ].join('\n');
    s3.appendChild(t3); s3.appendChild(pre);
    caixa.appendChild(s3);

    listarChaves(lista);
  }

  $('#abrir-config').addEventListener('click', abrir);
}());
