// src/TCEGOCrawler.js
const TCEGONavigator = require('./TCEGONavigator');

/**
 * TCEGOCrawler — Consulta Ampla de Decisoes do TCE-GO (SPA "Iago").
 *
 * 🔴 A DECISAO CENTRAL DESTE CRAWLER: O SERVIDOR ESCOLHE O MODELO DE BUSCA
 * SOZINHO, E O USUARIO NAO MANDA NISSO. Cada resultado traz um campo `model`, e
 * ele muda conforme o termo (medido em 22/08/2026, base `year=2024` = 4.987):
 *
 *   termo                              total   model
 *   "aposentadoria"                     3112   BM25            <- lexical
 *   "aposentadoria integral"            1709   BM25
 *   "contrato administrativo rescisao"    47   BM25
 *   "aposentadoria pregao"              1623   EMBEDDINGS      <- SEMANTICO
 *   "licitacao deserta fracassada"         3   EMBEDDINGS
 *   "\"pregao eletronico\""               45   OPERATOR_QUERY  <- frase
 *
 * ⚠️ CONSEQUENCIA QUE QUEBRA A INVARIANTE Nº 1 SE FOR IGNORADA: quando o modelo
 * e EMBEDDINGS, **o resultado nao precisa conter o termo buscado**. O top-1 de
 * "aposentadoria pregao" e um acordao de Representacao sobre pregao eletronico
 * SEM uma linha sobre aposentadoria. Recall semantico nao e recall lexical.
 * Por isso este crawler EXPOE o `model` em cada resultado e no resumo, e avisa
 * quando a busca caiu no semantico. Nunca cite achado de EMBEDDINGS como se o
 * tribunal tivesse decidido sobre o seu termo — confira o texto.
 *
 * 🔴 NENHUM OPERADOR BOOLEANO FUNCIONA, E AS MEDICOES SE CONTRADIZEM ENTRE SI —
 * que e a prova mais forte de que nao ha algebra de conjunto por tras. Medido:
 *   aposentadoria                       3112
 *   aposentadoria AND aposentadoria     1926   <- AND consigo mesmo PERDE 1.186
 *   aposentadoria OR  aposentadoria     1926   <- identico ao AND
 *   aposentadoria AND pregao               0
 *   aposentadoria OU  pregao            1918
 *   aposentadoria OR  pregao              44
 *   aposentadoria NAO pregao               0
 *   aposentadoria NÃO pregao            1749   <- o acento muda o resultado
 *   AND (sozinho) 0 · OR (sozinho) 2           <- sao TOKENS, nao operadores
 *   "aposentadoria"                        0   <- a MESMA palavra entre aspas ZERA
 *   "aposentadoria" OR "aposentadoria"  1926   <- duplicada, volta a 1926
 *   "pregao eletronico" AND "tomada de precos"    0
 *   "pregao eletronico" E   "tomada de precos"   48  (= o OR, nao a intersecao)
 *   "pregao eletronico" NAO "tomada de precos"   48  (nao exclui nada)
 * ⚠️ E ADICIONAR UM TOKEN QUE NAO EXISTE MUDA A CONTAGEM EM VEZ DE ZERAR:
 *   "aposentadoria zzqqxx" = 1.788 (e o score do top-1 cai de 179,9 para 5,4);
 *   "aposentadoria zzqqxx yywwvv" = 0. Uma palavra a mais apaga a busca inteira.
 * Por isso este crawler NAO expoe flag de operador — flag que nao filtra mente
 * para o usuario (licao TCE-PR) — e AVISA quando ve um operador no termo.
 *
 * 🔴 A ASPAS SIMPLES ZERA: `"aposentadoria"` = 0 enquanto `aposentadoria` = 3112.
 * O OPERATOR_QUERY casa em um conjunto de campos MENOR que o BM25. Aspas so
 * valem a pena em frase de 2+ palavras, e ainda assim reduzem o alcance.
 *
 * 🔴 O `totalElements` E FABRICADO. Medido paginando o acervo inteiro:
 *   page=0&size=25 -> 10.000 · page=400&size=25 -> 10.025 · page=50&size=2000 ->
 *   102.000 · page=191&size=2000 -> 383.075 (o numero verdadeiro, ultima pagina).
 * Ou seja `totalElements ≈ max(10.000, min(acervo, (page+1) × size))`.
 *   < 10.000  -> EXATO (confere com o agregado: year=2024 = 4.987 nos dois)
 *   = 10.000  -> SATURADO: "≥ 10.000, quantidade desconhecida"
 *   > 10.000  -> artefato do proprio offset, nao e contagem de nada
 * ✅ A saida e `/decisions/aggregations`, que devolve contagem EXATA acima do
 * teto. Este crawler consulta o agregado sempre que o total satura.
 *
 * ✅ PARTICAO DE COLEGIADO FECHA EXATA em 2024: 2.601 + 1.910 + 476 = 4.987.
 * Nenhum filtro e decorativo e todos rejeitam valor inventado com 0.
 *
 * ⚠️ MAS 83% DO ACERVO NAO TEM COLEGIADO NEM TIPO DE SESSAO: os agregados dao
 * `ano` = `tipo_documento` = 383.075 e `colegiado` = `tipo_sessao` = 64.797.
 * Filtrar por colegiado EXCLUI 318.278 documentos em silencio — nao e "nao ha
 * julgado", e campo vazio.
 *
 * ⚠️ MUNICIPIOS GOIANOS — a ressalva da fila esta CONFIRMADA PARA A ERA MODERNA,
 * e a prova saiu do agregado, sem sair do dominio oficial. `interested=PREFEITURA`
 * devolve 4.227 documentos, mas a distribuicao por ano desaba:
 *   1998=599 · 2004=150 · 2007=102 · 2008=21 · 2013=2 · 2019=4 · 2020=6 · 2026=4
 * Ou seja o TCE-GO guarda um acervo municipal HISTORICO (concentrado ate ~2007) e
 * praticamente nao julga contas municipais hoje. Buscar municipio goiano recente
 * aqui devolve quase-zero que NAO significa ausencia de julgado — significa que a
 * competencia e de outra Corte. O formulario nao tem combo de municipio.
 */
class TCEGOCrawler {
  /** ✅ Enumerados por `/decisions/aggregations`. Sao keyword EXATA, com acento. */
  static TIPOS = ['Acórdão', 'Resolução', 'Resolução Administrativa', 'Resolução Normativa'];
  static COLEGIADOS = ['Primeira Camara', 'Segunda Camara', 'Tribunal Pleno'];
  static SESSOES = ['Ordinaria', 'Extraordinária', 'Extraordinária Administrativa'];
  static ORDENS = ['RELEVANCE', 'RECENT', 'OLD'];

  static POR_PAGINA = 25;
  static SIZE_MAX = 2000;
  static TETO_TOTAL = TCEGONavigator.TETO_TOTAL;

  /** Veredito MEDIDO de cada filtro. Todos passam na prova por contagem. */
  static FILTROS = {
    year: { ok: true, nota: '2024 -> 4.987; confere com o agregado `ano`' },
    type: { ok: true, nota: 'Acórdão 4.938 / Resolução 11 em 2024; "Bananas" -> 0' },
    collegiate: { ok: true, nota: '2.601 + 1.910 + 476 = 4.987 — particao EXATA; inventado -> 0' },
    session: { ok: true, nota: 'Ordinaria 4.935; 🔴 EXIGE ACENTO: Extraordinária 29, Extraordinaria 0' },
    reporter: { ok: true, nota: 'CELMAR RECH -> 727 (relator da DECISAO); inventado -> 0' },
    rapporteur: { ok: true, nota: 'CARLA CINTIA SANTILLO -> 814 (relator do PROCESSO); inventado -> 0' },
    interested: { ok: true, nota: 'texto livre; PREFEITURA -> 4.227; inventado -> 0' },
    number: { ok: true, nota: '04119 -> 48 em TODOS os anos; com year=2024 -> 1. Zero a esquerda e opcional' },
    process: { ok: true, nota: '201700010015938 -> 1, casamento EXATO; prefixo parcial -> 0' },
    start: { ok: true, nota: 'ISO YYYY-MM-DD; 🔴 so vale COM `end` — sozinho e IGNORADO' },
    end: { ok: true, nota: 'ISO YYYY-MM-DD; 🔴 so vale COM `start` — sozinho e IGNORADO' },
    order: { ok: true, nota: 'RELEVANCE|RECENT|OLD; 🔴 valor invalido -> HTTP 500' },
  };

  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCEGONavigator({ log });
  }

  /** DD/MM/YYYY -> YYYY-MM-DD. 🔴 O filtro so aceita ISO: BR responde HTTP 500. */
  static _iso(d) {
    if (!d) return '';
    const s = String(d).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`Data invalida: "${d}". Use DD/MM/YYYY.`);
  }

  static _montarParams(o) {
    const p = {};
    if (o.ano) p.year = String(o.ano).trim();
    if (o.tipo) p.type = String(o.tipo).trim();
    if (o.colegiado) p.collegiate = String(o.colegiado).trim();
    if (o.sessao) p.session = String(o.sessao).trim();
    if (o.relatorDecisao) p.reporter = String(o.relatorDecisao).trim();
    if (o.relator) p.rapporteur = String(o.relator).trim();
    if (o.interessado) p.interested = String(o.interessado).trim();
    if (o.numero) p.number = String(o.numero).trim();
    if (o.processo) p.process = String(o.processo).trim().replace(/\D/g, '');
    const di = TCEGOCrawler._iso(o.dataInicio);
    const df = TCEGOCrawler._iso(o.dataFim);
    if (di) p.start = di;
    if (df) p.end = df;
    if (o.ordem) p.order = String(o.ordem).trim().toUpperCase();
    return p;
  }

  /** Avisos que o usuario PRECISA ver — sao onde o zero (e o falso positivo) mora. */
  static avisos(o = {}) {
    const av = [];
    const q = String(o.query || '');

    if (/(^|\s)(E|OU|NAO|NÃO|AND|OR|NOT)(\s|$)/.test(q)) {
      av.push(
        '🔴 NAO HA OPERADOR BOOLEANO NESTA BASE, e as medicoes se contradizem entre si. ' +
          '"aposentadoria AND aposentadoria" = 1.926 contra 3.112 da palavra sozinha (o AND ' +
          'consigo mesmo PERDE 1.186); "AND" sozinho = 0 e "OR" sozinho = 2, ou seja sao ' +
          'TOKENS de busca, nao operadores; "aposentadoria NAO pregao" = 0 mas ' +
          '"aposentadoria NÃO pregao" = 1.749, so pelo acento. Tire a palavra do termo.',
      );
    }
    if (/"/.test(q)) {
      const palavras = (q.match(/"([^"]*)"/g) || []).map((s) => s.replace(/"/g, '').trim());
      av.push(
        'Aspas mudam o modelo do servidor para OPERATOR_QUERY, que casa num conjunto de ' +
          'campos MENOR. 🔴 Frase de UMA palavra ZERA: "aposentadoria" = 0 enquanto ' +
          'aposentadoria = 3.112. Aspas so valem em frase de 2+ palavras.' +
          (palavras.some((p) => p && !/\s/.test(p))
            ? ` Voce mandou frase de uma palavra so (${palavras.filter((p) => p && !/\s/.test(p)).map((p) => `"${p}"`).join(', ')}) — ela provavelmente vai zerar.`
            : ''),
      );
    }
    if (/[$*?]/.test(q)) {
      av.push(
        'CURINGA NAO EXISTE AQUI. Medido: "aposent*" = 0 (zera de vez) e "aposentadori?" = ' +
          '3.085 contra 3.112 — o "?" NAO e curinga, e um token que muda o ranking e devolve ' +
          'contagem plausivel. Voce leria "funcionou" e teria perdido resultados.',
      );
    }
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && !/"/.test(q)) {
      av.push(
        `Termo com ${tokens.length} palavras: o servidor pode cair no modelo EMBEDDINGS ` +
          '(semantico) em vez de BM25 (lexical) — e ai o resultado NAO precisa conter as suas ' +
          'palavras. Confira o campo `model` de cada resultado antes de citar. Medido: ' +
          '"aposentadoria pregao" = EMBEDDINGS e o top-1 nao fala de aposentadoria.',
      );
    }
    if (o.dataInicio && !o.dataFim) {
      av.push(
        '🔴 -di SOZINHO E IGNORADO PELO SERVIDOR (medido: start=2024-01-01 sozinho devolve o ' +
          'acervo saturado, 10.000). A janela de data so funciona FECHADA. Passe tambem -df.',
      );
    }
    if (o.dataFim && !o.dataInicio) {
      av.push(
        '🔴 -df SOZINHO E IGNORADO PELO SERVIDOR (medido: end=2024-01-31 sozinho devolve ' +
          '10.000). A janela de data so funciona FECHADA. Passe tambem -di.',
      );
    }
    if (o.colegiado || o.sessao) {
      av.push(
        '⚠️ 83% DO ACERVO NAO TEM COLEGIADO NEM TIPO DE SESSAO: os agregados dao 383.075 em ' +
          '`ano` e 64.797 em `colegiado`/`tipo_sessao`. Filtrar por eles exclui 318.278 ' +
          'documentos em silencio — o que faltar nao e "nao ha julgado", e campo vazio.',
      );
    }
    if (o.sessao && !/[áéíóúâêôãõç]/i.test(String(o.sessao)) && /extraordinaria/i.test(String(o.sessao))) {
      av.push(
        '🔴 `session` E KEYWORD EXATA E EXIGE O ACENTO: "Extraordinária" -> 29, ' +
          '"Extraordinaria" -> 0 com HTTP 200. Use o rotulo literal de --listar-filtros.',
      );
    }
    if (o.numero && !o.ano) {
      av.push(
        'O numero da decisao SE REPETE a cada ano: number=04119 sozinho devolve 48 decisoes ' +
          'de anos diferentes. Passe --ano para chegar a uma so.',
      );
    }
    if (!q && !o.processo && !o.numero) {
      av.push(
        'Busca sem termo devolve o acervo por relevancia e o total satura em 10.000. Use ' +
          '--ano ou -di/-df para fatiar: nao ha teto de profundidade (page=191&size=2000 ' +
          'chegou ao fim do acervo), mas o total exposto continua mentindo.',
      );
    }
    return av;
  }

  /**
   * 🔴 A RESSALVA MAIS CARA DESTE TRIBUNAL: `summary` E EMENTA GERADA POR IA.
   * O rotulo do proprio portal e `ia_ementa: "Ementa Artificial"` e o texto de
   * boas-vindas diz "O Iago agora resume cada decisao em uma ementa artificial".
   * E o campo que a tela mostra em destaque, em CAIXA ALTA, com cara de ementa
   * oficial. Publicar `summary` como ementa do TCE-GO e citar resumo de maquina
   * como ato do tribunal. Aqui ele sai como `ementaArtificialIA`, nunca como
   * `ementa` — e o nome do campo e o aviso.
   *
   * ✅ Os QUATRO tipos de documento tem o MESMO esquema de 22 campos, todos
   * preenchidos (medido em 22/08/2026 em Acórdão, Resolução, Resolução
   * Administrativa e Resolução Normativa). Nao ha o buraco por tipo do TJMG.
   * ⚠️ `session` NAO e campo do card, embora seja filtro: a sessao so aparece
   * dentro do `title` ("34ª Sessão Ordinaria Primeira Camara").
   */
  _mapear(d) {
    const ementa = d.ementa ? String(d.ementa).trim() : null;
    return {
      // 🔑 `id` identifica o DOCUMENTO e e a chave de todos os endpoints seguintes.
      // `process` NAO identifica o julgado e `number` se repete a cada ano.
      id: d.id,
      numeroDecisao: d.number && d.year ? `${d.number}/${d.year}` : null,
      tipo: d.type || null,
      indicador: d.indicator || null,
      titulo: d.title || null,
      // NAO e CNJ: numeracao propria AAAANNNNNNNNNNN. src/cnj.js nao se aplica.
      processo: d.process || null,
      uf: 'GO',
      colegiado: d.collegiate || null,
      dataJulgamento: d.date || null, // ja vem BR ("28/10/2024 08:00")
      assunto: d.subject || null,
      relatorProcesso: d.rapporteur || null,
      relatorDecisao: d.decision_rapporteur || null,
      interessados: d.interested || null,
      procurador: d.procurator || null,
      auditor: d.auditor || null,
      sigilo: d.confidential === true || d.confidential === 'True',
      ementa,
      semEmenta: !ementa,
      // 🔴 NAO E EMENTA DO TRIBUNAL. Ver o bloco acima deste metodo.
      ementaArtificialIA: d.summary ? String(d.summary).trim() : null,
      ementaArtificialAviso: d.summary
        ? 'RESUMO GERADO POR IA ("Ementa Artificial" do portal). NAO e ato do tribunal, nao cite como ementa.'
        : null,
      trecho: d.highlights ? String(d.highlights).replace(/<\/?em>/g, '') : null,
      // ✅ Qual modelo de busca devolveu este resultado. EMBEDDINGS = semantico:
      // o documento pode NAO conter o termo. Ver o bloco no topo da classe.
      model: d.model || null,
      score: d.score ?? null,
      inteiroTeor: null, // preenchido por --fetch-inteiro-teor via GET /decisions/<id>
      // 🔴 NAO HA PERMALINK DE DOCUMENTO neste tribunal (§23). O permalink que
      // existe e o do PROCESSO, e exige uma chamada a /decisions/url/<id>.
      url: null,
      urlPublica: false,
    };
  }

  /** ✅ Contagem EXATA pelo agregado — a saida para o total saturado. */
  async contarExato({ query = '', params = {} } = {}) {
    const agg = await this.nav.agregacoes({ term: query, params });
    const ano = (agg || []).find((a) => a.key === 'ano');
    if (!ano || !ano.agg?.length) return null;
    return ano.agg.reduce((s, a) => s + (a.value || 0), 0);
  }

  async buscar(opts = {}) {
    const maxPages = parseInt(opts.maxPages ?? 1, 10);
    const size = Math.min(parseInt(opts.size ?? TCEGOCrawler.POR_PAGINA, 10), TCEGOCrawler.SIZE_MAX);
    const params = TCEGOCrawler._montarParams(opts);
    const avisos = TCEGOCrawler.avisos(opts);
    for (const a of avisos) this.log(`  [aviso] ${a}`);

    const t0 = Date.now();
    const resultados = [];
    let totalBruto = null;
    let paginas = 0;

    for (let page = 0; page < maxPages; page++) {
      const r = await this.nav.buscar({ term: opts.query || '', params: { ...params, page, size } });
      if (totalBruto === null) totalBruto = r.totalBruto;
      paginas++;
      this.log(`   pagina ${page + 1} (page=${page}) → ${r.documentos.length} documentos`);
      resultados.push(...r.documentos.map((d) => this._mapear(d)));
      // Ao estourar a ultima pagina: HTTP 200, content=[], numberOfElements=0.
      if (r.documentos.length < size) break;
    }

    // 🔴 Classificar o total. Ver o bloco `totalElements` no topo da classe.
    let total = totalBruto;
    let totalExato = false;
    let totalNota = null;
    if (totalBruto != null && totalBruto < TCEGOCrawler.TETO_TOTAL) {
      totalExato = true;
      totalNota = `EXATO (abaixo do teto de ${TCEGOCrawler.TETO_TOTAL})`;
    } else {
      // Acima do teto o `totalElements` e artefato do offset. Vai no agregado.
      let exato = null;
      try {
        exato = await this.contarExato({ query: opts.query || '', params });
      } catch (e) {
        this.log(`  [aviso] agregado falhou (${e.message}); total fica saturado`);
      }
      if (exato != null) {
        total = exato;
        totalExato = true;
        totalNota =
          `EXATO pelo agregado /decisions/aggregations (a busca dizia ${totalBruto}, que e ` +
          'artefato do offset — soma dos buckets de `ano`)';
      } else {
        totalExato = false;
        totalNota = `SATURADO: o totalElements ${totalBruto} nao e contagem de nada`;
        avisos.push(
          `🔴 O total ${totalBruto} devolvido pela busca NAO e a quantidade de resultados: e o ` +
            `track_total_hits do Elasticsearch (${TCEGOCrawler.TETO_TOTAL}) somado ao offset da ` +
            'pagina. NAO reporte esse numero. O agregado nao respondeu desta vez.',
        );
      }
    }

    const modelos = [...new Set(resultados.map((r) => r.model).filter(Boolean))];
    if (modelos.includes('EMBEDDINGS')) {
      avisos.push(
        '🔴 O SERVIDOR RESPONDEU EM MODO SEMANTICO (model=EMBEDDINGS). Os resultados NAO ' +
          'precisam conter o termo buscado — sao vizinhos vetoriais. Leia o texto antes de ' +
          'citar qualquer um como julgado sobre o seu assunto.',
      );
    }
    if (total === 0) {
      avisos.push(
        'Zero aqui quase nunca e ausencia de jurisprudencia. Confira, nesta ordem: ' +
          '(1) se pos operador ("AND"/"NAO"/"+") no termo — eles zeram a busca em vez de filtrar; ' +
          '(2) se usou aspas em UMA palavra ("aposentadoria" = 0 e aposentadoria = 3.112); ' +
          '(3) se acrescentou uma palavra a mais — 3 tokens com um inexistente apagam a busca; ' +
          '(4) se o valor do filtro esta sem acento (session=Extraordinaria = 0, com acento = 29); ' +
          '(5) se filtrou por colegiado/sessao, que faltam em 83% do acervo; ' +
          '(6) se e materia municipal recente — o acervo municipal do TCE-GO para em ~2007.',
      );
    }

    return {
      tribunal: 'TCE-GO',
      comando: 'tcego',
      query: opts.query || null,
      params,
      total,
      totalBruto,
      totalExato,
      totalNota,
      acervoTotalConhecido: 383075, // medido em 19/08/2026; 383.166 em 22/08 — a base cresce
      retornados: resultados.length,
      paginas,
      porPagina: size,
      modelosDeBusca: modelos,
      duracaoMs: Date.now() - t0,
      avisos,
      resultados,
    };
  }
}

module.exports = TCEGOCrawler;
