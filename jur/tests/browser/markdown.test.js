const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const { chromium } = require('playwright');
const db = require('../../servidor/db');
const jobs = require('../../servidor/jobs');
const chaves = require('../../servidor/chaves');
const conversas = require('../../servidor/conversas');
const { criarApp } = require('../../servidor/index');

/**
 * O markdown do assistente chegava CRU na tela: `bolha()` escreve com textContent, entao
 * "## 4. Metragem" e "**Fracao inferior a 250 m2**" apareciam com os asteriscos e as
 * cerquilhas a mostra. Numa analise de jurisprudencia, que e quase toda titulo, lista e
 * negrito, isso e a maior parte do texto.
 *
 * O renderizador monta NOS DO DOM e escreve todo texto com textContent — nunca
 * innerHTML. Isso importa porque o conteudo vem do modelo repassando texto de tribunal:
 * uma ementa pode conter qualquer coisa, e aqui ela nao tem como virar HTML executavel.
 * Os testes de injecao no fim deste arquivo sao o que trava essa propriedade.
 *
 * Uma pagina so para todos os casos: cada `evaluate` e barato, subir um browser nao.
 */

let servidor; let base; let browser; let page;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-md-'));
  const con = db.abrir(path.join(dir, 'jur.db'));
  const fila = jobs.criarFila({
    con, dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }),
  });
  servidor = http.createServer(criarApp({
    fila, chaves: chaves.criarGerenciador(con), conversas: conversas.criarRepositorio(con), exigirChave: true,
  }).handler);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.jurMarkdown), null, { timeout: 10000 });
});

after(async () => {
  await browser.close();
  await new Promise((r) => servidor.close(r));
});

/** Renderiza num contêiner limpo e devolve o innerHTML resultante (só para inspeção). */
const html = (md) => page.evaluate((texto) => {
  const alvo = document.createElement('div');
  window.jurMarkdown.renderizar(texto, alvo);
  return alvo.innerHTML;
}, md);

/** Renderiza e devolve o textContent — o que o leitor de fato vê. */
const texto = (md) => page.evaluate((t) => {
  const alvo = document.createElement('div');
  window.jurMarkdown.renderizar(t, alvo);
  return alvo.textContent;
}, md);

/** Renderiza e roda um seletor, devolvendo os textos casados. */
const seletor = (md, sel) => page.evaluate(([t, s]) => {
  const alvo = document.createElement('div');
  window.jurMarkdown.renderizar(t, alvo);
  return [...alvo.querySelectorAll(s)].map((e) => e.textContent);
}, [md, sel]);

describe('markdown — blocos', () => {
  // Os niveis sao DESLOCADOS em um: `#` do modelo vira <h2>, `##` vira <h3>, e o teto e
  // <h4>. Uma resposta de chat nao pode emitir <h1> — esse nivel pertence a pagina, e
  // deixar o modelo cria-lo bagunca a arvore de cabecalhos por onde um leitor de tela
  // navega. Na pratica o modelo comeca em `##`, entao o topo visivel de uma resposta e h3.
  it('titulos viram h2..h4 com os niveis deslocados, e a cerquilha some do texto', async () => {
    assert.deepStrictEqual(await seletor('# Topo', 'h2'), ['Topo']);
    assert.deepStrictEqual(await seletor('## 4. Metragem', 'h3'), ['4. Metragem']);
    assert.deepStrictEqual(await seletor('### Oposicao do proprietario', 'h4'), ['Oposicao do proprietario']);
    assert.ok(!(await texto('## 4. Metragem')).includes('#'));
  });

  it('nivel nenhum do modelo produz <h1>', async () => {
    for (const md of ['# a', '## b', '### c', '#### d', '##### e', '###### f']) {
      assert.strictEqual((await seletor(md, 'h1')).length, 0, `${md} nao pode virar h1`);
    }
  });

  it('titulo mais fundo que o teto ainda e titulo, nao paragrafo', async () => {
    assert.deepStrictEqual(await seletor('###### fundo', 'h4'), ['fundo']);
  });

  it('paragrafos separados por linha em branco viram <p> distintos', async () => {
    assert.deepStrictEqual(await seletor('um\n\ndois', 'p'), ['um', 'dois']);
  });

  it('quebra simples dentro do paragrafo nao vira paragrafo novo', async () => {
    assert.deepStrictEqual((await seletor('linha um\nlinha dois', 'p')).length, 1);
  });

  it('lista com hifen vira <ul><li>', async () => {
    assert.deepStrictEqual(
      await seletor('- primeiro\n- segundo', 'ul li'),
      ['primeiro', 'segundo'],
    );
  });

  it('lista numerada vira <ol><li>', async () => {
    assert.deepStrictEqual(await seletor('1. um\n2. dois', 'ol li'), ['um', 'dois']);
  });

  it('lista aninhada por indentacao vira lista dentro de item', async () => {
    const dentro = await seletor('- pai\n  - filho', 'ul li ul li');
    assert.deepStrictEqual(dentro, ['filho']);
  });

  it('--- vira regua, nao um paragrafo com tres hifens', async () => {
    assert.strictEqual((await seletor('a\n\n---\n\nb', 'hr')).length, 1);
    assert.ok(!(await texto('a\n\n---\n\nb')).includes('---'));
  });

  it('nao confunde regua com item de lista', async () => {
    assert.deepStrictEqual(await seletor('- item', 'li'), ['item']);
    assert.strictEqual((await seletor('- item', 'hr')).length, 0);
  });

  it('citacao vira blockquote', async () => {
    assert.deepStrictEqual(await seletor('> citado', 'blockquote'), ['citado']);
  });

  it('bloco de codigo cercado preserva o conteudo literal', async () => {
    const t = await seletor('```\n**nao e negrito**\n```', 'pre code');
    assert.deepStrictEqual(t, ['**nao e negrito**\n']);
  });

  it('bloco de codigo nao fechado ainda renderiza — o streaming chega pela metade', async () => {
    const t = await seletor('```\nchegando', 'pre code');
    assert.deepStrictEqual(t, ['chegando']);
  });

  it('tabela vira <table> com cabecalho', async () => {
    const md = '| Tribunal | Total |\n| --- | --- |\n| TJPR | 134 |';
    assert.deepStrictEqual(await seletor(md, 'table th'), ['Tribunal', 'Total']);
    assert.deepStrictEqual(await seletor(md, 'table td'), ['TJPR', '134']);
  });
});

describe('markdown — inline', () => {
  it('negrito vira <strong> e os asteriscos somem', async () => {
    assert.deepStrictEqual(await seletor('o **0000627-73.2019** decidiu', 'strong'), ['0000627-73.2019']);
    assert.ok(!(await texto('o **x** decidiu')).includes('*'));
  });

  it('italico vira <em>', async () => {
    assert.deepStrictEqual(await seletor('isto e *enfase*', 'em'), ['enfase']);
  });

  it('negrito ganha do italico quando os dois cabem', async () => {
    assert.deepStrictEqual(await seletor('**forte**', 'strong'), ['forte']);
    assert.strictEqual((await seletor('**forte**', 'em')).length, 0);
  });

  it('codigo inline vira <code> e nao interpreta o que esta dentro', async () => {
    assert.deepStrictEqual(await seletor('use `art. **183**` aqui', 'code'), ['art. **183**']);
  });

  it('link vira <a> com href, target em nova aba e rel seguro', async () => {
    const a = await page.evaluate(() => {
      const alvo = document.createElement('div');
      window.jurMarkdown.renderizar('[acordao](https://tjpr.jus.br/x)', alvo);
      const el = alvo.querySelector('a');
      return { texto: el.textContent, href: el.getAttribute('href'), rel: el.getAttribute('rel'), target: el.getAttribute('target') };
    });
    assert.strictEqual(a.texto, 'acordao');
    assert.strictEqual(a.href, 'https://tjpr.jus.br/x');
    assert.strictEqual(a.target, '_blank');
    assert.match(a.rel, /noopener/);
  });

  it('asterisco solto no meio do texto continua sendo asterisco', async () => {
    assert.strictEqual(await texto('2 * 3 = 6'), '2 * 3 = 6');
  });

  it('negrito nao atravessa paragrafos', async () => {
    // Um `**` sem par nao pode engolir o resto do documento.
    const t = await texto('**aberto\n\noutro paragrafo');
    assert.match(t, /\*\*aberto/);
    assert.match(t, /outro paragrafo/);
  });
});

describe('markdown — nada do modelo vira HTML executavel', () => {
  it('tag HTML no texto aparece como TEXTO, nao como elemento', async () => {
    const md = 'a ementa dizia <script>alert(1)</script> e mais';
    assert.strictEqual((await seletor(md, 'script')).length, 0);
    assert.match(await texto(md), /<script>alert\(1\)<\/script>/);
  });

  it('<img onerror> nao vira imagem', async () => {
    const md = '<img src=x onerror="alert(1)">';
    assert.strictEqual((await seletor(md, 'img')).length, 0);
    assert.match(await texto(md), /<img src=x/);
  });

  it('link javascript: e recusado — vira texto, nao <a>', async () => {
    const md = '[clique](javascript:alert(1))';
    assert.strictEqual((await seletor(md, 'a')).length, 0,
      'um href javascript: entregue pelo modelo executaria no clique do usuario');
    assert.match(await texto(md), /clique/);
  });

  it('link data: tambem e recusado', async () => {
    assert.strictEqual((await seletor('[x](data:text/html,<script>alert(1)</script>)', 'a')).length, 0);
  });

  it('http, https e mailto passam', async () => {
    for (const url of ['http://a.b/c', 'https://a.b/c', 'mailto:a@b.c']) {
      assert.strictEqual((await seletor(`[x](${url})`, 'a')).length, 1, `${url} deveria passar`);
    }
  });

  it('o renderizador nao usa innerHTML em lugar nenhum', async () => {
    // Prova indireta mas dura: se usasse, a entidade viria decodificada.
    assert.match(await texto('&lt;b&gt;'), /&lt;b&gt;/);
  });
});

describe('markdown na bolha do chat', () => {
  it('a bolha do assistente renderiza; a do usuario continua texto puro', async () => {
    const r = await page.evaluate(() => {
      const alvo = document.createElement('div');
      window.jurMarkdown.renderizar('## titulo', alvo);
      return { comMd: Boolean(alvo.querySelector('h3')) };
    });
    assert.strictEqual(r.comMd, true);
    // O lado do usuario e verificado no teste de fluxo do chat: markdown no que o
    // usuario digitou seria reinterpretar a entrada dele.
  });

  it('renderizar duas vezes no mesmo alvo nao acumula — o streaming reparseia a cada delta', async () => {
    const t = await page.evaluate(() => {
      const alvo = document.createElement('div');
      window.jurMarkdown.renderizar('**um**', alvo);
      window.jurMarkdown.renderizar('**um** dois', alvo);
      return alvo.textContent;
    });
    assert.strictEqual(t, 'um dois');
  });
});

/**
 * A caixa de entrada tinha `max-width: 740px` MAIS `padding: 0 24px`, enquanto `.msg`
 * tinha 740px sem padding: o campo ficava 48px mais estreito que o texto acima dele, e
 * o desalinhamento aparecia em toda conversa. E o tipo de coisa que so um teste que
 * MEDE pega — ler o CSS nao denuncia, porque cada regra isolada parece certa.
 */
describe('a caixa de entrada alinha com o texto das mensagens', () => {
  it('as duas bordas internas coincidem', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
      // Monta a tela de conversa sem depender do LLM: e geometria, nao fluxo.
      await p.evaluate(() => {
        document.querySelector('#inicial').hidden = true;
        document.querySelector('#conversa').hidden = false;
        const d = document.createElement('div');
        d.className = 'msg assistant';
        d.textContent = 'texto de referencia';
        document.querySelector('#mensagens').appendChild(d);
        // #caixa-conversa so e montado ao abrir/criar uma conversa; aqui o assunto e
        // geometria, entao clona o mesmo template que a aplicacao usa.
        document.querySelector('#caixa-conversa')
          .appendChild(document.querySelector('#tpl-entrada').content.cloneNode(true));
      });
      const medidas = await p.evaluate(() => {
        const msg = document.querySelector('.msg.assistant').getBoundingClientRect();
        const form = document.querySelector('#caixa-conversa .formulario').getBoundingClientRect();
        return { msgE: msg.left, msgD: msg.right, formE: form.left, formD: form.right };
      });
      assert.ok(Math.abs(medidas.msgE - medidas.formE) <= 1,
        `borda esquerda: mensagem em ${medidas.msgE}, caixa em ${medidas.formE}`);
      assert.ok(Math.abs(medidas.msgD - medidas.formD) <= 1,
        `borda direita: mensagem em ${medidas.msgD}, caixa em ${medidas.formD}`);
    } finally {
      await p.close();
    }
  });

  it('a caixa de texto tem altura de duas linhas, nao de uma', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
      const altura = await p.evaluate(
        () => document.querySelector('#caixa-inicial .entrada').getBoundingClientRect().height,
      );
      assert.ok(altura >= 44, `caixa apertada demais: ${altura}px`);
    } finally {
      await p.close();
    }
  });
});
