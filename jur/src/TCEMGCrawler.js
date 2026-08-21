// src/TCEMGCrawler.js
const TCEMGNavigator = require('./TCEMGNavigator');

/**
 * TCEMGCrawler — MapJuris do TCE-MG, secao "Textual / Dados do Processo".
 *
 * ✅ OS CONECTORES OFICIAIS EXISTEM E FORAM CONFERIDOS POR CONJUNTO DE IDs, nao
 * so por contagem (janela 2025; licitação = 21, pregão = 7):
 *   licitação E pregão      =  7  ✅ e o conjunto BATE com A∩B calculado
 *   licitação AND pregão    =  7  ✅ o ingles tambem funciona
 *   licitação OU pregão     = 21  ✅ e o conjunto BATE com A∪B
 *   licitação OR pregão     = 21  ✅
 *   "pregão eletrônico"     =  1  ✅ frase exata
 *   licita%                 = 25  ✅ truncamento (> licitação = 21)
 *   contrat%                = 34  ✅
 *
 * 🔴 `NÃO` RESPONDE, RESTRINGE, E MESMO ASSIM ESTA ERRADO — ELE PERDE RESULTADO.
 *   licitação NÃO pregão    =  6, quando A\B calculado da 14.
 * Os 6 sao TODOS legitimos (⊆ A\B, conferido id a id), mas 8 documentos que
 * contem "licitação" e nao contem "pregão" ficam de fora. Nao e "o operador nao
 * funciona" (isso zeraria); e um operador que responde numero plausivel e MENOR
 * do que devia. Quem escrever `A NÃO B` recebe silenciosamente 43% do recorte.
 * Este crawler avisa e nao reescreve a query.
 *
 * 🔴 `NAO` SEM TIL NAO E OPERADOR — E ZERA. `licitação NAO pregão` = 0, contra 6
 * do acentuado. E o espaco tambem nao e conectivo: `licitação pregão` = 0.
 * Ou seja, aqui o zero por sintaxe e indistinguivel do zero por ausencia.
 * (Espelho do TJAC, onde era o `NÃO` ACENTUADO que nao valia.)
 * ⚠️ `*` e `$` NAO sao curinga (`licita*` = 0, `licitação$` = 0) — o curinga e `%`.
 * ⚠️ `licita` (radical cru, sem `%`) = 0: nao ha casamento por prefixo implicito.
 *
 * 🔴 A BASE E DE EXCERTOS DE **CONSULTA**, NAO DO ACERVO INTEIRO DO TCE-MG.
 * Medido de duas formas independentes: (1) as 21 ementas de licitação/2025
 * comecam TODAS com "CONSULTA."; (2) `natureza=17` (CONSULTA) devolve os mesmos
 * 21 do sem-filtro. Sao os excertos que a Coordenadoria de Jurisprudencia
 * seleciona — o equivalente ao "Jurisprudencia Selecionada" do TCDF, so que aqui
 * NAO existe a base larga por tras. Contas julgadas, denuncias e representacoes
 * NAO estao aqui.
 *
 * ✅ E ISSO FECHA A RESSALVA DO BLOCO 5 POR MEDICAO: MG nao tem TCM, e as
 * consultas municipais estao mesmo no TCE — as ementas de 2025 trazem
 * "MUNICIPIO", "CAMARA MUNICIPAL", "PREFEITURA", "INSTITUTO DE PREVIDENCIA
 * [municipal]". Nao e a ausencia de um combo de municipio que prova; e o acervo.
 *
 * ⚠️ ACERVO PEQUENO E COM PICO NO PASSADO (termo vazio, por ano da sessao):
 *   2026 13 · 2025 49 · 2024 72 · 2023 43 · 2022 46 · 2021 46 · 2020 45
 *   2019 30 · 2018  9 · 2017 14 · 2016 25 · 2015 21 · 2014 43 · 2013 84
 *   2012 98 · 2011 77 · 2010 71 · 2009 74 · 2008 84
 * ✅ Base CORRENTE (documento de 10/06/2026 na amostra) — nao congelou como a do
 * TJAM. Mas 2018 com 9 contra 2012 com 98 nao e queda de producao do tribunal, e
 * ritmo de CURADORIA: nao leia a serie como atividade do TCE-MG.
 */
class TCEMGCrawler {
  /** `0` = TODOS. Nao ha teto de pagina: 0, 100 e 1000 devolvem os mesmos 34/34. */
  static QUANTIDADE_TODOS = 0;

  /**
   * 🔴 O RECORTE DE DATA E OBRIGATORIO NA PRATICA. Medido: `licitação` sem janela
   * foi ABORTADO em 240 s sem resposta; o mesmo termo com um mes responde em
   * 1,7 s e com um ano em ~13 s. Nao e bloqueio, e custo — e a busca que "trava"
   * no navegador e so isso. Quando o usuario nao da -di/-df, o crawler fatia
   * ano a ano a partir daqui.
   */
  static ANO_MIN_PADRAO = 2008;

  /** Vereditos MEDIDOS por contagem, nunca por "respondeu". */
  static FILTROS = {
    termo: { ok: true, nota: 'licitação/2025 = 21; termo VAZIO com janela de data lista o periodo inteiro (jun/2025 = 4)' },
    dataSessao: { ok: true, nota: 'jun/2026 = 1 contra 2026 inteiro = 6 e 2025 = 21 — restringe de verdade' },
    codRelator: { ok: true, nota: '44 (DURVAL ANGELO) = 7, 100 (TELMO PASSARELI) = 6, 71 (WANDERLEY AVILA) = 1 de 21; codigo inventado = 0' },
    nomeRelator: { ok: false, nota: 'DECORATIVO: mandar so o nome, sem codRelator, devolve os 21 (= sem filtro). Quem filtra e o codigo' },
    numeroProcesso: {
      ok: true,
      nota:
        'casamento EXATO, sem substring (1188139 = 1; 1188138 = 0; 999999999 = 0) e SEM precisar ' +
        'de janela de data — e o unico caminho rapido do portal',
    },
    natureza: {
      ok: true,
      parcial: true,
      nota:
        'filtra (17 CONSULTA = 21, 20 DENUNCIA = 0, 141 REPRESENTACAO = 0), mas o parametro NAO ' +
        'esta na tela: so aparece em DetalhesExcerto.js. 🔴 E o controle do valor inventado FALHA ' +
        'aqui: "XXINVENTADOXX" devolve os 21 do sem-filtro — valor nao-numerico e IGNORADO em ' +
        'silencio, o que se le como sucesso',
    },
    tipoPesquisa: {
      ok: true,
      nota:
        'IndexExcerto = EXCERTO = 11 e INDEXACAO = 6 (janela 01-06/2025). 🔴 A medicao de 16/08 ' +
        'dizia "os tres identicos" porque comparou os BYTES DA CASCA (9.035 nos tres, sempre); ' +
        'a diferenca so aparece no segundo salto, contando LINHAS. Valor inventado = 0',
    },
  };

  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCEMGNavigator({ log });
  }

  /** Entidades nomeadas que aparecem na base (HTML4 latino + basicas). */
  static ENTIDADES = (() => {
    const t = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', sect: '§', middot: '·', iquest: '¿', iexcl: '¡', bull: '•', dagger: '†', euro: '€', pound: '£', copy: '©', reg: '®', trade: '™', times: '×', frac12: '½', sup2: '²', sup3: '³', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d' };
    const vogais = { A: 'A', E: 'E', I: 'I', O: 'O', U: 'U', a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' };
    const acentos = { acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', uml: '\u0308' };
    for (const [v, base] of Object.entries(vogais))
      for (const [a, comb] of Object.entries(acentos))
        t[v + a] = (base + comb).normalize('NFC');
    t.ccedil = 'ç';
    t.Ccedil = 'Ç';
    t.ntilde = 'ñ';
    t.Ntilde = 'Ñ';
    return t;
  })();

  static _texto(s) {
    return String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      // ⚠️ AS ENTIDADES NAO SAO UNIFORMES NA BASE. O mesmo campo vem em UTF-8 cru
      // num documento ("EXIGÊNCIA") e em entidade nomeada no outro
      // ("EXIG&Ecirc;NCIA") — depende de como o excerto foi cadastrado. Decodificar
      // so `&amp;/&lt;/&gt;/&quot;` (o reflexo) deixa acento cru na ementa de parte
      // do acervo. Por isso aqui a decodificacao e GERAL.
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCharCode(parseInt(d, 16)))
      .replace(/&([A-Za-z]+);/g, (m, nome) => TCEMGCrawler.ENTIDADES[nome] ?? m)
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ \| *\n/g, ' | ')
      .replace(/\n *\|/g, ' |')
      .replace(/\|\s*\|/g, '|')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[\s|]+|[\s|]+$/g, '')
      .trim();
  }

  /** Tabela HTML -> { colunas, linhas:[{coluna: valor}] }. Celula vazia e omitida. */
  static _tabela(html) {
    const colunas = [...html.matchAll(/<th>\s*([\s\S]*?)\s*<\/th>/g)].map((m) =>
      TCEMGCrawler._texto(m[1]),
    );
    const corpo = (html.match(/<tbody>([\s\S]*)<\/tbody>/) || [])[1] || '';
    const linhas = [];
    for (const tr of corpo.split(/<tr>/).slice(1)) {
      const celulas = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => TCEMGCrawler._texto(m[1]));
      if (!celulas.some((c) => c)) continue;
      const obj = {};
      celulas.forEach((c, i) => {
        if (c) obj[colunas[i] || `col${i}`] = c;
      });
      if (Object.keys(obj).length) linhas.push(obj);
    }
    return { colunas, linhas };
  }

  /** Linhas do grid, uma por documento. O 1º DetalhesExcerto de cada <tr> e o id
   *  — os outros sao "Titulos vinculados" e contaminariam a contagem. */
  static _linhas(html) {
    return html.split(/<tr name='gridExcertoIntegra\d+'/).slice(1);
  }

  /**
   * Anatomia do card, medida em 21 documentos: seis secoes nomeadas por
   * `<th class='legenda th<ID>'>` — Dados do processo, Parecer, Indexacao,
   * Classificacao, Referencia Legal, Titulos vinculados.
   *
   * ✅ O TEXTO INTEGRAL JA VEM NA BUSCA. A secao "Parecer" traz EMENTA + PARECER
   * + a NOTA DE TRANSCRICAO da sessao inteira: 5.098 a 212.976 chars na amostra
   * (mediana ~33 KB). Nao ha segundo salto para obter texto — o PDF e a mesma
   * coisa em outro formato.
   * ✅ EMENTA EM 21 DE 21 (100%), sempre no topo do Parecer sob o titulo "EMENTA".
   * Ao contrario do TCE-BA, aqui nao ha tipo de documento sem ementa — porque so
   * ha um tipo (Consulta).
   */
  _mapear(linha) {
    const id = (linha.match(/DetalhesExcerto\/(\d+)/) || [])[1] || null;
    // ⚠️ Nao delimite a secao por `</td></tr>`: cada secao contem uma TABELA
    // ANINHADA, e o primeiro `</td></tr>` interno corta o conteudo no meio — o
    // sintoma foi `relator: null` num card que tinha relator. O corte seguro e o
    // proximo cabecalho de secao.
    const secoes = {};
    const partes = linha.split(/<th class='legenda th\d+[^']*'>/);
    for (const p of partes.slice(1)) {
      const m = p.match(/^\s*([\s\S]*?)\s*<\/th>([\s\S]*)$/);
      if (m) secoes[m[1]] = m[2];
    }

    // "Dados do processo": Nº processo | Data da sessao | Data da Publicacao | Vigencia | Relator
    const celulas = [...(secoes['Dados do processo'] || '').matchAll(/<td>([^<]*)<\/td>/g)].map((m) =>
      m[1].trim(),
    );
    const [numero, dataSessao, dataPublicacao, vigencia, relator] = celulas;

    const parecer = TCEMGCrawler._texto(secoes['Parecer'] || '');
    const mEmenta = parecer.match(
      /(?:^|\n)\s*EMENTA\s*\n([\s\S]*?)(?=\n\s*(?:PARECER|NOTA DE TRANSCRIÇÃO|RELATÓRIO|VOTO)\s*\n|$)/,
    );
    const ementa = mEmenta ? mEmenta[1].trim() : null;

    const indexacao = TCEMGCrawler._texto(secoes['Indexação'] || '');
    // ✅ Classificacao e Referencia Legal sao TABELAS de verdade — viram lista,
    // nao paragrafo. E o que permite recortar por "LICITACAO > Contratacao
    // Direta" ou por "Lei 14.133/2021, art. 17" depois, no consumidor.
    const classificacao = TCEMGCrawler._tabela(secoes['Classificação'] || '');
    const referenciaLegal = TCEMGCrawler._tabela(secoes['Referência Legal'] || '');
    const titulos = TCEMGCrawler._texto(secoes['Títulos vinculados'] || '');

    return {
      // 🔴 O ID DO EXCERTO **E** O NUMERO DO PROCESSO NO TCE-MG (7 digitos), e nao
      // um id interno: conferido em 21 documentos, a celula "Nº processo" repete
      // exatamente o numero do permalink. NAO e CNJ — `src/cnj.js` nao se aplica.
      id,
      processo: numero || id,
      numeroProcesso: numero || id,
      tipo: 'Consulta (excerto de jurisprudencia)',
      titulo: ementa ? ementa.replace(/\s+/g, ' ').slice(0, 160) : null,
      relator: relator || null,
      orgaoJulgador: 'Tribunal Pleno — TCE-MG',
      uf: 'MG',
      dataJulgamento: dataSessao || null,
      // ✅ Data de publicacao e campo proprio; "N/T" aparece quando nao ha.
      dataPublicacao: dataPublicacao && dataPublicacao !== 'N/T' ? dataPublicacao : null,
      // "VIGENTE" / "NAO VIGENTE": o TCE-MG marca se a tese ainda vale. Nao ha
      // equivalente nos outros tribunais do repo — nao descarte por conta propria.
      vigencia: vigencia || null,
      ementa,
      semEmenta: !ementa,
      inteiroTeor: parecer || null,
      inteiroTeorChars: parecer.length,
      indexacao: indexacao || null,
      classificacao: classificacao.linhas.length ? classificacao.linhas : null,
      referenciaLegal: referenciaLegal.linhas.length ? referenciaLegal.linhas : null,
      titulosVinculados: /Não possui/i.test(titulos) ? null : titulos || null,
      // ⚠️ Permalink responde 200 SEM cookie, mas e CASCA — ver
      // TCEMGNavigator.permalinkUtil. Marcado como nao-autossuficiente.
      url: id ? TCEMGNavigator.permalink(id) : null,
      urlPublica: true,
      urlAutossuficiente: false,
    };
  }

  /** Avisos que o usuario PRECISA ver — e onde o zero mora. */
  static avisos(o = {}) {
    const av = [];
    const q = o.query || '';

    if (/(^|\s)NAO(\s|$)/.test(q)) {
      av.push(
        'ATENCAO: "NAO" sem til NAO e operador nesta base — e ZERA. Medido: ' +
          '"licitação NAO pregão" = 0 contra 6 de "licitação NÃO pregão". Use NÃO acentuado.',
      );
    }
    if (/(^|\s)NÃO(\s|$)/i.test(q)) {
      av.push(
        'ATENCAO: o operador NÃO responde e restringe, mas PERDE RESULTADO. Medido: ' +
          '"licitação NÃO pregão" = 6 quando a diferenca real (licitação menos pregão) e 14. ' +
          'Os 6 sao legitimos, mas 8 documentos validos ficam de fora em silencio. ' +
          'Para exaustividade, prefira buscar A e B em separado e subtrair.',
      );
    }
    if (/\*/.test(q)) {
      av.push('O curinga aqui e "%", nao "*". Medido: licita* = 0 e licita% = 25.');
    }
    if (q && !/\b(E|OU|NÃO|AND|OR)\b/.test(q) && /\s/.test(q) && !/"/.test(q) && !/[()]/.test(q)) {
      av.push(
        'Termos separados por ESPACO nao sao unidos por conectivo implicito: ' +
          '"licitação pregão" = 0. Use "licitação E pregão", "licitação OU pregão" ou ' +
          'aspas para frase exata.',
      );
    }
    if (o.nomeRelator && !o.codRelator) {
      av.push(
        'nomeRelator sem codRelator NAO filtra (medido: devolve o mesmo total do sem-filtro). ' +
          'Use --listar-filtros para pegar o codigo.',
      );
    }
    if (o.natureza && !/^\d+$/.test(String(o.natureza))) {
      av.push(
        'natureza nao-numerica e IGNORADA em silencio pelo servidor (devolve o total sem ' +
          'filtro, o que se le como sucesso). Use o codigo numerico de --listar-filtros.',
      );
    }
    return av;
  }

  static _ano(d) {
    const m = String(d || '').match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Fatias de data. Sem -di/-df, varre ano a ano do mais novo para o mais antigo. */
  static _fatias({ dataInicio, dataFim, anoMin, anoMax }) {
    if (dataInicio || dataFim) {
      return [{ di: dataInicio || '01/01/1990', df: dataFim || '31/12/2099' }];
    }
    const fim = anoMax || new Date().getFullYear();
    const ini = anoMin || TCEMGCrawler.ANO_MIN_PADRAO;
    const out = [];
    for (let a = fim; a >= ini; a--) out.push({ di: `01/01/${a}`, df: `31/12/${a}`, ano: a });
    return out;
  }

  /**
   * `maxPages` aqui e o numero de FATIAS DE ANO percorridas, nao de paginas do
   * grid: o grid nao precisa paginar (quantidade=0 traz tudo de uma vez) e o que
   * de fato limita e o custo por janela de data.
   */
  async buscar(opts = {}) {
    const avisos = [...TCEMGCrawler.avisos(opts)];
    for (const a of avisos) this.log(`  [aviso] ${a}`);

    const t0 = Date.now();
    const fatias = TCEMGCrawler._fatias(opts);
    const limite = parseInt(opts.maxPages ?? (opts.dataInicio || opts.dataFim ? 1 : 3), 10);
    const usadas = fatias.slice(0, Math.max(1, limite));

    if (usadas.length < fatias.length) {
      avisos.push(
        `Sem -di/-df o crawler fatia por ano (obrigatorio: a busca sem janela nao responde ` +
          `nem em 240 s). Foram percorridos ${usadas.length} ano(s) — ${usadas.map((f) => f.ano).join(', ')} ` +
          `— de ${fatias.length} possiveis (${TCEMGCrawler.ANO_MIN_PADRAO} em diante). ` +
          'Aumente -m para varrer mais fundo; o total abaixo e a SOMA das fatias percorridas, ' +
          'nao o acervo.',
      );
    }

    const resultados = [];
    const porFatia = [];
    let total = 0;

    for (const f of usadas) {
      const b = await this.nav.buscar({
        termo: opts.query || '',
        tipoPesquisa: opts.tipoPesquisa || 'IndexExcerto',
        numeroProcesso: opts.numeroProcesso || '',
        codRelator: opts.codRelator || '',
        nomeRelator: opts.nomeRelator || '',
        natureza: opts.natureza || '',
        dataInicio: f.di,
        dataFim: f.df,
      });
      if (b.vazio || !b.gridHelper) {
        porFatia.push({ ...f, total: 0, ms: b.ms });
        this.log(`   ${f.ano || `${f.di}–${f.df}`} → 0 (o portal responde "Nenhum registro encontrado")`);
        continue;
      }
      const g = await this.nav.grid(b.gridHelper, { quantidade: TCEMGCrawler.QUANTIDADE_TODOS });
      const linhas = TCEMGCrawler._linhas(g.html);
      porFatia.push({ ...f, total: g.total, linhas: linhas.length, ms: b.ms + g.ms });
      total += g.total || 0;
      this.log(
        `   ${f.ano || `${f.di}–${f.df}`} → ${g.total} documento(s), ${linhas.length} linha(s) ` +
          `em ${((b.ms + g.ms) / 1000).toFixed(1)} s`,
      );
      if (g.total != null && linhas.length !== g.total) {
        avisos.push(
          `Fatia ${f.ano || f.di}: totalRegistros=${g.total} mas o grid montou ${linhas.length} ` +
            'linha(s). Nao trate a contagem como conferida nesta fatia.',
        );
      }
      resultados.push(...linhas.map((l) => this._mapear(l)));
    }

    if (total === 0) {
      avisos.push(
        'Zero aqui quase nunca e ausencia de jurisprudencia. Confira, nesta ordem: ' +
          '(1) espaco entre termos NAO e conectivo — "a b" = 0; ' +
          '(2) "NAO" sem til zera (o operador e "NÃO"); ' +
          '(3) o curinga e "%", nao "*"; ' +
          '(4) a janela de datas — a base tem 9 a 98 documentos POR ANO, entao um mes ' +
          'costuma trazer 0 a 5; ' +
          '(5) a base e so de excertos de CONSULTA: contas, denuncias e representacoes ' +
          'nao estao aqui, e procura-las devolve zero legitimamente.',
      );
    }

    return {
      tribunal: 'TCE-MG',
      comando: 'tcemg',
      modulo: 'MapJuris — Textual/Dados do Processo',
      query: opts.query || null,
      total,
      // ✅ EXATO: 10 + 10 + 10 + 4 = 34 conferido linha a linha na paginacao.
      totalExato: true,
      totalEhSomaDeFatias: usadas.length > 1,
      fatias: porFatia,
      retornados: resultados.length,
      duracaoMs: Date.now() - t0,
      avisos,
      resultados,
    };
  }
}

module.exports = TCEMGCrawler;
