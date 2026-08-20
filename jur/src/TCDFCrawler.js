// src/TCDFCrawler.js
const TCDFNavigator = require('./TCDFNavigator');

/**
 * TCDFCrawler — Jurisprudencia do TCDF (Tribunal de Contas do Distrito Federal).
 *
 * ✅ O CAMPO `q` E UM query_string LUCENE DE VERDADE — o mais rico do Bloco 5.
 * Cada operador foi testado isolado em 20/08/2026 (nepotismo = 112,
 * licitação = 6.684):
 *   nepotismo AND licitação          =    23   ✅ AND
 *   nepotismo licitação  (espaco)    = 6.773   ✅ default operator = OR
 *   nepotismo OR licitação           = 6.773   ✅ identico ao espaco (confirma)
 *   nepotismo NOT licitação          =    89   ✅ NOT (112 - 23 = 89)
 *   +nepotismo -licitação            =    89   ✅ +/-
 *   "servidor efetivo"               =   491   ✅ frase exata (sem aspas: 10.000/gte)
 *   (nepotismo OR usucapiao) AND licitação = 37 ✅ parenteses
 *   licita*                          = 7.372   ✅ curinga (> licitação)
 *   jurisprudencia_ementa:nepotismo  =    30   ✅ sintaxe de campo
 *   NEPOTISMO                        =   112   ✅ caixa nao importa
 *   nepotismo AND  (sintaxe quebrada)= HTTP 500
 *
 * 🔴 `E` E `OU` EM PORTUGUES NAO SAO OPERADORES — E O ERRO AMPLIA, NAO ZERA:
 *   nepotismo E  licitação = 8.034   (> que o OR de 6.773)
 *   nepotismo OU licitação = 7.675   (> que o OR de 6.773)
 * Porque "e"/"ou" viram MAIS UM TERMO no OR implicito e casam com quase tudo. A
 * contagem MUDA, entao parece que o operador pegou — e o resultado e MAIOR, nao
 * menor. Quem escrever `A E B` esperando intersecao recebe uniao inflada. Este
 * crawler avisa; nao reescreve a query do usuario.
 *
 * ⚠️ ACENTO: `licitacao` = 6.680 contra `licitação` = 6.684. NAO da para dizer
 * "normaliza" nem "exige" — 4 documentos divergem. O aviso e honesto sobre isso:
 * avisa da divergencia sem prometer equivalencia. (Oposto do TCE-PE, onde sem
 * acento a busca desabava de 13.636 para 40.)
 * ⚠️ `nepot*` = 112 = `nepotismo` NAO prova que o curinga nao funciona — prova
 * que nao ha outra palavra "nepot..." indexada. `licita*` (7.372 > 6.684) prova
 * que funciona. Um controle de uma amostra so teria concluido errado.
 *
 * 🔴 O TOTAL DA BUSCA E SATURADO EM 10.000 e o proprio ES diz qual e qual em
 * `hits.total.relation`: "eq" = exato, "gte" = teto. O acervo sem termo devolve
 * 10.000/gte, e NAO sao 10.000 documentos: somando os buckets de `Situacao` em
 * /jurisprudencia/tipos da 18.370 (Descartada 15.920 + Publicada 2.430 +
 * Em Analise 16 + Pre-Descartada 4). Reportar "10.000" e afirmacao falsa, entao
 * este crawler nunca imprime `total` sem o qualificador.
 *
 * 🔴 "JURISPRUDENCIA SELECIONADA" E "INTEIRO TEOR" SAO O MESMO ENDPOINT. A unica
 * diferenca e `filter[jurisprudencia_situacao]='Publicada'`. A Selecionada e um
 * SUBCONJUNTO de 2.430 dos 18.370 (13,2%) — a licao do TCE-CE repetida. O default
 * daqui e a BASE INTEIRA; `--selecionada` reproduz a curadoria.
 * ⚠️ "Descartada" e descarte da CURADORIA de jurisprudencia, nao do acervo: os
 * 15.920 documentos existem, abrem pelo permalink e tem texto.
 */
class TCDFCrawler {
  /**
   * 100 e conservador de proposito. Ver a quinta casca de HTTP 200 no Navigator:
   * o teto do proxy PHP e em BYTES (800 documentos = 35,5 MB passa; 1.600 estoura).
   */
  static SIZE_DEFAULT = 100;

  /** Profundidade: `from + maxPerPage <= 10000` (max_result_window do ES). */
  static MAX_RESULT_WINDOW = 10000;

  /**
   * Os filtros da tela, com o veredito de cada um MEDIDO POR CONTAGEM.
   * base para os testes com termo: q=nepotismo = 112.
   */
  static FILTROS = {
    ano: { ok: true, nota: 'filter[ano]=2023 -> 13 de 112; ano inexistente (1899) -> 0' },
    relator: { ok: true, nota: "filter[relator]='Inácio Magalhães Filho' -> 22 de 112; aspas sao OPCIONAIS (mesmo 22 sem elas)" },
    numero: { ok: true, nota: 'filter[numero]=4760 -> 1; 99999 -> 0. E o numero do DOCUMENTO, nao do processo' },
    sessao_tipo: { ok: true, nota: "filter[sessao_tipo]='EXTRAORDINÁRIA' -> 6 de 112" },
    jurisprudencia_situacao: { ok: true, nota: "='Publicada' -> 12 de 112; sozinho -> 2.430 (bate com a agregacao)" },
    paradigmatica: { ok: true, nota: "sozinho ='Em sede de consulta' -> 82, EXATAMENTE o bucket da agregacao" },
    classificacao_tematica: {
      ok: true,
      parcial: true,
      nota:
        "='Pessoal' sozinho -> 536, mas o bucket da agregacao diz 454. NAO e exato: casa " +
        'tambem os valores compostos ("Contas, Processual" e afins). Restringe de verdade, ' +
        'mas nao com semantica de igualdade.',
    },
    // 🔴 Os tres abaixo estao QUEBRADOS NO SERVIDOR. Ver _avisosFiltros().
    assunto: {
      ok: false,
      nota:
        "SEMPRE ZERO. ='Pregão eletrônico' -> 0, mas a agregacao AssuntoDescritor diz 83 " +
        'para esse mesmo valor. Aceita, responde HTTP 200 e devolve nada.',
    },
    normativo: {
      ok: false,
      nota:
        "SEMPRE ZERO. ='Lei nº 8666/1993' -> 0, mas a agregacao LegislacaoNormativo diz 239.",
    },
    ementa_voto: { ok: false, nota: 'SEMPRE ZERO. =nepotismo -> 0, com ou sem termo.' },
    emissor: { ok: true, nota: "='Federal' -> 7 de 112" },
    artigo: { ok: null, nota: 'NAO medido' },
    paragrafo: { ok: null, nota: 'NAO medido' },
    inciso: { ok: null, nota: 'NAO medido' },
    alinea: { ok: null, nota: 'NAO medido' },
  };

  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCDFNavigator({ log });
  }

  /** DD/MM/YYYY -> YYYY-MM-DD, o formato que o range do Lucene aceita. */
  static _iso(d) {
    if (!d) return '';
    const s = String(d).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`Data invalida: "${d}". Use DD/MM/YYYY.`);
  }

  static _br(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  /**
   * Monta o `q` final, embutindo o intervalo de datas quando houver.
   *
   * 🔴 O INTERVALO DE DATAS NAO PASSA POR `filter[]` — PASSA POR `q`.
   *   filter[sessao_data]=[2023-01-01 TO 2023-12-31]  -> HTTP 500
   *   q=... AND sessao_data:[2023-01-01 TO 2023-12-31] -> funciona
   * E funciona de verdade, particionando (q=nepotismo):
   *   [2023-01-01 TO 2023-12-31] = 13  ← e filter[ano]=2023 tambem da 13 ✅
   *   [2023-01-01 TO 2023-06-30] =  6  (metade do ano, metade dos julgados)
   *   [2020-01-01 TO 2020-12-31] = 25  ← e filter[ano]=2020 tambem da 25 ✅
   *   [1900-01-01 TO 1900-12-31] =  0  (controle)
   * A conferencia cruzada com `filter[ano]`, que e um caminho independente, e o
   * que transforma "respondeu" em "filtra".
   *
   * ⚠️ O recorte e por `sessao_data` (data da SESSAO de julgamento). Ha tambem
   * `jurisprudencia_data_publicacao` no registro — sao datas diferentes, e o
   * filtro por publicacao NAO foi medido.
   */
  static _montarQ(o) {
    const partes = [];
    const q = (o.query || '').trim();
    if (q) partes.push(q);
    const di = TCDFCrawler._iso(o.dataInicio);
    const df = TCDFCrawler._iso(o.dataFim);
    if (di || df) {
      partes.push(`sessao_data:[${di || '1900-01-01'} TO ${df || '2999-12-31'}]`);
    }
    return partes.join(' AND ');
  }

  static _montarFiltros(o) {
    const f = {};
    if (o.ano) f.ano = o.ano;
    if (o.relator) f.relator = `'${o.relator}'`;
    if (o.numero) f.numero = o.numero;
    if (o.sessaoTipo) f.sessao_tipo = `'${o.sessaoTipo}'`;
    if (o.classificacaoTematica) f.classificacao_tematica = `'${o.classificacaoTematica}'`;
    if (o.paradigmatica) f.paradigmatica = `'${o.paradigmatica}'`;
    if (o.emissor) f.emissor = `'${o.emissor}'`;
    // A tela da aba "Jurisprudencia Selecionada" e exatamente este filtro.
    if (o.selecionada) f.jurisprudencia_situacao = "'Publicada'";
    else if (o.situacao) f.jurisprudencia_situacao = `'${o.situacao}'`;
    return f;
  }

  /** Avisos que o usuario PRECISA ver — sao onde o zero (ou o subconjunto) mora. */
  static avisos(o = {}) {
    const av = [];
    const q = o.query || '';

    if (/(^|\s)(E|OU)(\s|$)/.test(q)) {
      av.push(
        'ATENCAO: "E" e "OU" NAO sao operadores nesta base — sao termos comuns, e o erro ' +
          'AMPLIA em vez de zerar. Medido: "nepotismo E licitação" = 8.034 e ' +
          '"nepotismo OU licitação" = 7.675, os DOIS maiores que o OR real (6.773). ' +
          'Use AND / OR / NOT em ingles, ou +termo / -termo.',
      );
    }
    if (/[áàâãéêíóôõúç]/i.test(q) === false && /\b(licitacao|contratacao|servico|orgao|acordao|decisao|sancao|omissao|admissao|aposentadoria|inexigibilidade|conclusao)\b/i.test(q)) {
      av.push(
        'Termo escrito SEM acento. Aqui o acento quase nao muda a contagem ' +
          '(licitacao = 6.680 contra licitação = 6.684), mas NAO e equivalencia: ' +
          '4 documentos divergem. Se a busca for exaustiva, rode as duas grafias.',
      );
    }
    if (!q && !o.ano && !o.numero && !o.relator && !o.dataInicio && !o.dataFim) {
      av.push(
        'Busca sem termo e sem filtro percorre o acervo inteiro (18.370 documentos), e o ' +
          'Elasticsearch so pagina ate from+maxPerPage = 10.000. Use --ano para fatiar.',
      );
    }
    return av;
  }

  /** Avisos sobre os filtros pedidos — tres deles estao quebrados no servidor. */
  static _avisosFiltros(o = {}) {
    const av = [];
    const quebrados = [
      ['assunto', o.assunto],
      ['normativo', o.normativo],
      ['ementa_voto', o.ementaVoto],
    ].filter(([, v]) => v);
    for (const [nome] of quebrados) {
      av.push(
        `FILTRO QUEBRADO NO SERVIDOR: filter[${nome}] responde HTTP 200 e devolve SEMPRE ZERO. ` +
          `${TCDFCrawler.FILTROS[nome].nota} O filtro esta na tela do TCDF e aceita o valor; ` +
          'ele so nao filtra. Este crawler NAO o envia — envia-lo produziria zero que se le ' +
          'como "nao ha jurisprudencia".',
      );
    }
    if (o.classificacaoTematica) {
      av.push(`filter[classificacao_tematica]: ${TCDFCrawler.FILTROS.classificacao_tematica.nota}`);
    }
    return av;
  }

  /**
   * ✅ O TEXTO JA VEM NO PAYLOAD DA BUSCA — nenhum segundo salto e necessario.
   * Medido no e-doc B0AB532D:
   *   jurisprudencia_decisao                  437 chars (o dispositivo)
   *   jurisprudencia_ementa                   513 chars (A EMENTA)
   *   jurisprudencia_ementa_voto            1.303 chars
   *   jurisprudencia_excerto                3.102 chars
   *   jurisprudencia_ementa_voto_e_excerto  4.405 chars ← o mais completo
   * E o endpoint do documento devolve MENOS (1.742 chars limpos), nao mais.
   *
   * 🔴 O TEXTO DO CARD DA TELA NAO E A EMENTA E NEM SEMPRE E O MESMO CAMPO: na
   * mesma busca, a maioria dos cards mostra `jurisprudencia_decisao` truncado com
   * "...", e alguns mostram um fragmento de highlight cortado no meio da frase
   * (e-doc 4A597532: "se encontrava em caso de nepotismo, mesmo apos alertado por
   * meio do Parecer no 130/2016, da RA IX sobre"). Por isso o mapeamento abaixo
   * usa o campo nomeado, nunca o que a tela exibe.
   *
   * ⚠️ `jurisprudencia_relacionados` chega a 52 KB por registro e e o que estoura
   * a memoria do proxy PHP. E DESCARTADO aqui de proposito.
   */
  _mapear(h) {
    const s = h._source || {};
    const edoc = s.documento_edoc || h._id || null;
    const limpar = (t) =>
      String(t || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();

    const ementa = limpar(s.jurisprudencia_ementa);
    const inteiroTeor = limpar(s.jurisprudencia_ementa_voto_e_excerto) || limpar(s.jurisprudencia_excerto);

    return {
      // 🔴 QUEM IDENTIFICA O DOCUMENTO E O e-doc, NAO O NUMERO DO PROCESSO.
      // Um processo (4518/2020-e) rende varias Decisoes, e a mesma Decisao
      // aparece referenciada como `B0AB532D-c` dentro de outros documentos.
      id: edoc,
      numeroDocumento: s.documento_numero_ano || null,
      tipo: s.jurisprudencia_tipo_descricao || null,
      titulo: s.documento_numero_ano
        ? `${s.jurisprudencia_tipo_descricao || 'Documento'} ${s.documento_numero_ano}`
        : null,
      // NAO e CNJ. `src/cnj.js` nao se aplica ao Bloco 5.
      processo: s.processo_numero_completo || null,
      relator: s.processo_relator || null,
      orgaoJulgador: s.sessao_tipo ? `Plenario — sessao ${s.sessao_tipo}` : null,
      sessaoNumero: s.sessao_numero ?? null,
      uf: 'DF',
      dataJulgamento: TCDFCrawler._br(s.sessao_data),
      // ✅ HA data de publicacao, e e campo proprio (ao contrario do TCE-PE).
      dataPublicacao: TCDFCrawler._br(s.jurisprudencia_data_publicacao),
      ementa: ementa || null,
      semEmenta: !ementa,
      inteiroTeor: inteiroTeor || null,
      inteiroTeorChars: inteiroTeor.length,
      // Curadoria: "Publicada" = Jurisprudencia Selecionada. "Descartada" = fora da
      // curadoria, NAO fora do acervo (o documento existe e abre).
      situacao: s.jurisprudencia_situacao || null,
      selecionada: s.jurisprudencia_situacao === 'Publicada',
      votacao: s.jurisprudencia_votacao || null,
      relevancia: s.jurisprudencia_relevancia || null,
      classificacaoTematica: s.jurisprudencia_classificacao_tematica || null,
      assuntos: Array.isArray(s.jurisprudencia_assunto) ? s.jurisprudencia_assunto : [],
      // ✅ Permalink confirmado em aba limpa. Ver TCDFNavigator.permalink.
      url: TCDFNavigator.permalink(edoc),
      urlPublica: true,
      score: h._score ?? null,
    };
  }

  async buscar(opts = {}) {
    const size = Math.max(1, parseInt(opts.size || TCDFCrawler.SIZE_DEFAULT, 10));
    const maxPages = parseInt(opts.maxPages ?? 1, 10);
    const q = TCDFCrawler._montarQ(opts);
    const filtros = TCDFCrawler._montarFiltros(opts);

    const avisos = [...TCDFCrawler.avisos(opts), ...TCDFCrawler._avisosFiltros(opts)];
    for (const a of avisos) this.log(`  [aviso] ${a}`);

    const t0 = Date.now();
    const resultados = [];
    let total = null;
    let totalExato = null;
    let paginas = 0;

    for (let page = 0; page < maxPages; page++) {
      const from = page * size;
      if (from + size > TCDFCrawler.MAX_RESULT_WINDOW) {
        avisos.push(
          `Paginacao interrompida em from=${from}: o Elasticsearch do TCDF so aceita ` +
            `from+maxPerPage <= ${TCDFCrawler.MAX_RESULT_WINDOW} (alem disso responde HTTP 500). ` +
            'Para varrer mais fundo, fatie a busca por --ano.',
        );
        break;
      }
      const r = await this.nav.buscarPagina({ q, from, maxPerPage: size, filtros });
      if (total === null) {
        total = r.total;
        totalExato = r.totalExato;
      }
      paginas++;
      this.log(
        `   pagina ${page} (from=${from}) → ${r.documentos.length} documentos` +
          (r.total != null ? ` (total ${r.total}${r.totalExato ? '' : '+, SATURADO'})` : ''),
      );
      resultados.push(...r.documentos.map((h) => this._mapear(h)));
      if (r.documentos.length < r.maxPerPageUsado) break;
      if (total != null && totalExato && resultados.length >= total) break;
    }

    if (totalExato === false) {
      avisos.push(
        `O total ${total} e SATURADO, nao exato: o Elasticsearch responde ` +
          '`hits.total.relation = "gte"` e trava a contagem em 10.000. O acervo real de ' +
          'inteiro teor e 18.370 documentos (soma dos buckets de Situacao em ' +
          '/jurisprudencia/tipos). NAO reporte 10.000 como se fosse o total.',
      );
    }
    if (total === 0) {
      avisos.push(
        'Zero aqui quase nunca e ausencia de jurisprudencia. Confira, nesta ordem: ' +
          '(1) se usou "E"/"OU" em portugues achando que sao operadores; ' +
          '(2) se a sintaxe do Lucene ficou quebrada (terminar em AND devolve HTTP 500, ' +
          'mas parenteses desbalanceados podem zerar); ' +
          '(3) se pediu um filtro com nome de campo errado — campo desconhecido ZERA ' +
          "em vez de ser ignorado (filter[campo_que_nao_existe]='x' -> 0).",
      );
    }

    return {
      tribunal: 'TCDF',
      comando: 'tcdf',
      query: opts.query || null,
      queryEnviada: q || null,
      filtros,
      total,
      totalExato: !!totalExato,
      acervoTotalConhecido: 18370,
      retornados: resultados.length,
      paginas,
      duracaoMs: Date.now() - t0,
      avisos,
      resultados,
    };
  }
}

module.exports = TCDFCrawler;
