// src/TCECECrawler.js
const TCECENavigator = require('./TCECENavigator');

/**
 * TCECECrawler — Contexto/Documentos do TCE-CE (Tribunal de Contas do Ceara).
 *
 * ✅ A ARMADILHA DO TCM E FALSA NO CEARA, e a prova saiu de duas medicoes
 * independentes: `tabelas-auxiliares/localidade` traz 186 entradas INCLUINDO
 * `{"id":"60","descricao":"FORTALEZA"}` (a capital), e `tabelas-auxiliares/
 * tipo-sessao` traz `TCM - 1ª CÂMARA ORDINÁRIA`, `TCM - 2ª CÂMARA ORDINÁRIA` e
 * `TCM - PLENO ORDINÁRIA`. O TCM-CE foi extinto em 2017 e o acervo MIGROU — os
 * processos trazem "PROCESSO MIGRADO DO TCM (SGP)" no assunto. Ou seja o TCE-CE
 * cobre estado + os 184 municipios + o historico do TCM.
 *
 * 🔴 A DECISAO CENTRAL DESTE CRAWLER: `/documentos/buscar` NAO E BASE DE
 * JURISPRUDENCIA — e o acervo documental inteiro (5.318.348 documentos, numero
 * publicado pelo proprio `/documentos/total-documentos`). A agregacao
 * `group_by_idtipodocumento` de `nepotismo` (2.130 docs em 82 tipos) mostra o que
 * a busca crua devolve: ANEXO 284, CERTIFICADO 240, ESCLARECIMENTO 194,
 * PETIÇÃO 131, PARECER 115 … e ACÓRDÃO **64**. So 3% e acordao, e o primeiro
 * resultado por data e um "ANEXOS AOS ESCLARECIMENTOS" — papelada, nao julgado.
 * Apontar o crawler para a busca crua quebra a invariante nº 1 do repo.
 *
 * ✅ POR ISSO O DEFAULT E "DOCUMENTOS DE DECISAO", E A LISTA NAO FOI ADIVINHADA.
 * O painel FILTROS do Contexto tem, sob o rotulo "Busca para Jurispridência"
 * (sic, o portal escreve errado), um checkbox "Documentos de Decisão". Marcando-o
 * e capturando o XHR no Playwright em 22/08/2026, o corpo enviado e:
 *   {"terms":{"idtipodocumento":["4","12","25","6","13","3","172","98"]}}
 * = ACÓRDÃO, DECLARACAO DE VOTO, PARECER PRÉVIO, RELATÓRIO, RELATÓRIO VOTO,
 *   RESOLUÇÃO, VOTO, VOTO VISTA.
 * 🔴 A LISTA PALPITADA ESTARIA ERRADA. O mapeamento de 18/08 propunha como
 * fallback `633 DECISÃO`, `687 ACÓRDÃO RETIFICADOR`, `653 DESPACHO DECISÓRIO`,
 * `5 DESPACHO SINGULAR`, `160 SÚMULA` e `124 DECISÃO JUDICIAL` — **nenhum desses
 * esta na lista oficial**, e tres da lista oficial (RELATÓRIO, DECLARACAO DE VOTO,
 * RESOLUÇÃO) nao estavam no palpite. Capturar o XHR valeu mais que ler os nomes.
 * Medido: `nepotismo` = 2.130 cru -> **239** com o filtro de decisao (11%).
 *
 * 🔴 CINCO FILTROS DO CONTRATO ESTAO MORTOS NO INDICE — e nenhum deles ERRA,
 * todos devolvem ZERO com HTTP 200. O bundle monta clausulas para 16 filtros;
 * o painel da tela so expoe 7. Os que sobram foram testados um a um e o campo
 * simplesmente nao existe nos documentos (`exists` = 0):
 *   dtsessao          `{"exists":{"field":"dtsessao"}}`        -> 0   (data de JULGAMENTO)
 *   esferajulgamento  `{"exists":{"field":"esferajulgamento"}}`-> 0
 *   idmembrorelator   3 relatores REAIS + 1 inventado          -> 0   (RELATOR)
 *   tpespeciecategoria os 4 valores do combo                   -> 0
 *   tpsessao          id 11 (PLENO-ORDINARIA)                  -> 0
 * ⚠️ CONSEQUENCIA PRATICA: **nao ha filtro por relator nem por data de
 * julgamento nesta base**, e pedi-los devolveria zero que se le como "nao ha
 * jurisprudencia". Este crawler NAO expoe flag para eles — flag que nao filtra
 * mente para o usuario (licao do TCE-PR). O que existe e a data de GERACAO do
 * documento (`dtfinalizado`), que e coisa diferente.
 *
 * ✅ OS QUE FUNCIONAM, provados por contagem sobre `nepotismo` = 2.130:
 *   idtipodocumento  ["4"] ACÓRDÃO            ->    64 ; ["999999"] -> 0
 *   idlocalidade     ["60"] FORTALEZA         ->    62 ; ["999999"] -> 0
 *   idespecie        ["74"] TOMADA DE CONTAS  ->   731
 *   idsetor          ["32"] GAB.CONS. ALEXANDRE ->  10
 *   nrprocesso       term "40717/2019-6"      ->   100 documentos do processo
 *   range dtfinalizado 2024                   ->   169 ; 2025 -> 139
 * ✅ E as DUAS PONTAS da data funcionam sozinhas (399 so-gte / 1.900 so-lte) —
 * ao contrario do TCE-PR, onde uma ponta zerava e a outra era ignorada.
 *
 * 🔴 O FORMATO DA DATA E ARMADILHA DE 400 MASCARADO EM 200:
 *   {"range":{"dtfinalizado":{"gte":"2024-01-01","lte":"2024-12-31"}}}          -> 169 ✅
 *   {"range":{"dtfinalizado":{"format":"dd/MM/yyyy","gte":"01/01/2024",…}}}      -> 169 ✅
 *   {"range":{"dtfinalizado":{"gte":"01/01/2024","lte":"31/12/2024"}}}           -> HTTP 200
 *                                                     com {"erros":["400 Bad Request"]}
 * O SPA sempre manda `format`. Este crawler manda ISO, que dispensa o `format`.
 *
 * 🔴 NENHUM OPERADOR LOGICO FUNCIONA, E A TELA ANUNCIA OS QUATRO. Sob
 * "OPERADORES LÓGICOS" a tela oferece `E` `OU` `NÃO` `" "`. Medido termo a termo
 * (`nepotismo` 2.127, `nepotismo licitacao` 1.217):
 *   `E` = 1.217 (identico ao espaco — o AND ja e implicito)
 *   `OU` = 1.217  ← 🔴 devolve a INTERSECAO, nao a uniao. `A OU B` RESTRINGE.
 *   `NÃO` / `NAO` = 1.217 ← nao exclui nada
 * E as aspas quebram: `"prestacao de contas"` devolve o envelope de erro.
 * E a **quinta vez seguida no Bloco 5** que a legenda do portal descreve um
 * operador que o servidor nao implementa.
 * ⚠️ `$` e `*` NAO sao curinga e sao o caso perigoso: `nepotism$` = 14 e
 * `nepotism*` = 31 contra 2.130 de `nepotismo`. NAO zeram — devolvem julgados de
 * verdade, e quem ler "o curinga funcionou" perde 98% da base.
 *
 * ✅ `buscaPalavraExata` FUNCIONA e e o unico controle de texto que funciona —
 * desliga o stemming. Provado onde a saturacao nao esconde (com filtro de
 * decisao): `nepotismos` = 239 no padrao (o stemmer reduz a "nepotismo") e
 * **5** com palavraExata. Ja `buscaPesquisaExata` e INERTE nos 6 pares testados,
 * inclusive em frase de 3 palavras — este crawler nao expoe flag para ele.
 *
 * ✅ ACENTO E REMOVIDO, nao so normalizado: `nepotísmo` (acento ERRADO) = 2.127
 * = `nepotismo`; `inelegibilidádé` = 8.949 = `inelegibilidade`. O crawler nao
 * precisa normalizar a query. E o inverso exato do TCE-PE.
 * ⚠️ Mas palavra curta e comum devolve 0 (`a`, `de`): zero ali e stopword.
 */
class TCECECrawler {
  /** 🔴 FIXO EM 10 PELO SERVIDOR. Ver TCECENavigator.buscarPagina. */
  static POR_PAGINA = 10;

  /** 🔴 Teto do track_total_hits. Total >= isto e SATURADO, nunca exato. */
  static TETO_TOTAL = 10000;

  /**
   * A lista oficial do checkbox "Documentos de Decisão", capturada do XHR.
   * NAO editar por intuicao: ver o bloco no topo da classe.
   */
  static TIPOS_DECISAO = [
    { id: '4', descricao: 'ACÓRDÃO' },
    { id: '12', descricao: 'DECLARACAO DE VOTO' },
    { id: '25', descricao: 'PARECER PRÉVIO' },
    { id: '6', descricao: 'RELATÓRIO' },
    { id: '13', descricao: 'RELATÓRIO VOTO' },
    { id: '3', descricao: 'RESOLUÇÃO' },
    { id: '172', descricao: 'VOTO' },
    { id: '98', descricao: 'VOTO VISTA' },
  ];

  /** Veredito MEDIDO de cada filtro do contrato. `ok:false` = morto no indice. */
  static FILTROS = {
    idtipodocumento: { ok: true, nota: '["4"] -> 64 de 2130; ["999999"] -> 0 (id invalido NAO e ignorado)' },
    idlocalidade: { ok: true, nota: '["60"] FORTALEZA -> 62 de 2130; ["999999"] -> 0' },
    idespecie: { ok: true, nota: '["74"] TOMADA DE CONTAS ESPECIAL -> 731 de 2130' },
    idsetor: { ok: true, nota: '["32"] GAB.CONS. ALEXANDRE -> 10 de 2130' },
    identidade: { ok: null, nota: 'combo de 11.519 opcoes; NAO provado por contagem' },
    idinteressado: { ok: null, nota: 'NAO medido (a tabela auxiliar existe)' },
    idsituacao: { ok: null, nota: 'NAO medido' },
    nrprocesso: { ok: true, nota: 'term "40717/2019-6" -> 100 documentos daquele processo' },
    dtfinalizado: { ok: true, nota: 'range 2024 -> 169; 2025 -> 139; as duas pontas funcionam sozinhas' },
    dtsessao: { ok: false, nota: 'MORTO: exists -> 0. O campo vem null em todo documento. E a data de JULGAMENTO.' },
    esferajulgamento: { ok: false, nota: 'MORTO: exists -> 0.' },
    idmembrorelator: { ok: false, nota: 'MORTO: 3 relatores reais + 1 inventado -> 0. NAO ha filtro por relator.' },
    tpespeciecategoria: { ok: false, nota: 'MORTO: os 4 valores do combo -> 0.' },
    tpsessao: { ok: false, nota: 'MORTO: id 11 (PLENO-ORDINARIA) -> 0.' },
  };

  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCECENavigator({ log });
  }

  /** DD/MM/YYYY -> YYYY-MM-DD. O range do ES aceita ISO sem `format`. */
  static _iso(d) {
    if (!d) return '';
    const s = String(d).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`Data invalida: "${d}". Use DD/MM/YYYY.`);
  }

  static _br(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  static _lista(v) {
    if (v === undefined || v === null || v === '') return null;
    const a = Array.isArray(v) ? v : String(v).split(',');
    const out = a.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : null;
  }

  /** Monta o array `filtros` (query DSL cru do Elasticsearch). */
  static _montarFiltros(o) {
    const f = [];
    const tipos = TCECECrawler._lista(o.tipo);
    if (tipos) f.push({ terms: { idtipodocumento: tipos } });
    else if (!o.todosDocumentos) {
      f.push({ terms: { idtipodocumento: TCECECrawler.TIPOS_DECISAO.map((t) => t.id) } });
    }
    const loc = TCECECrawler._lista(o.localidade);
    if (loc) f.push({ terms: { idlocalidade: loc } });
    const esp = TCECECrawler._lista(o.especie);
    if (esp) f.push({ terms: { idespecie: esp } });
    const set = TCECECrawler._lista(o.setor);
    if (set) f.push({ terms: { idsetor: set } });
    const ent = TCECECrawler._lista(o.entidade);
    if (ent) f.push({ terms: { identidade: ent } });
    if (o.processo) f.push({ term: { nrprocesso: String(o.processo).trim() } });
    const di = TCECECrawler._iso(o.dataInicio);
    const df = TCECECrawler._iso(o.dataFim);
    if (di || df) {
      const r = {};
      if (di) r.gte = di;
      if (df) r.lte = df;
      f.push({ range: { dtfinalizado: r } });
    }
    return f;
  }

  /** Avisos que o usuario PRECISA ver — sao onde o zero (ou o subconjunto) mora. */
  static avisos(o = {}) {
    const av = [];
    const q = String(o.query || '');

    if (/(^|\s)(E|OU|NÃO|NAO)(\s|$)/.test(q)) {
      av.push(
        'ATENCAO: "E", "OU" e "NÃO" NAO sao operadores nesta base, embora a tela do ' +
          'Contexto os exiba sob o rotulo "OPERADORES LÓGICOS". Medido: os tres devolvem ' +
          '1.217, exatamente o mesmo que o espaco (AND implicito) — inclusive o "OU", que ' +
          'entrega a INTERSECAO em vez da uniao. Para uniao, rode uma busca por termo e ' +
          'some voce mesmo.',
      );
    }
    if (/"/.test(q)) {
      av.push(
        'Aspas duplas dentro do termo QUEBRAM a busca: o servidor responde HTTP 200 com ' +
          '{"erros":[...]} e `data` nulo. Nao ha busca por frase exata nesta API; o que ' +
          'existe e --palavra-exata, que desliga o stemming.',
      );
    }
    if (/[$*]/.test(q)) {
      av.push(
        'CURINGA NAO EXISTE AQUI, E O ERRO NAO ZERA: "nepotism$" = 14 e "nepotism*" = 31 ' +
          'contra 2.130 de "nepotismo". Voce recebe julgados de verdade e perde 98% da base.',
      );
    }
    if (q && q.trim().length <= 2) {
      av.push(
        `Termo muito curto ("${q.trim()}"). Palavra curta e comum devolve 0 por ser ` +
          'stopword do indice (medido: "a" = 0, "de" = 0). Zero aqui nao e ausencia de acervo.',
      );
    }
    if (o.todosDocumentos) {
      av.push(
        '🔴 --todos-documentos DESLIGA o filtro "Documentos de Decisão". A busca crua do ' +
          'Contexto e o acervo documental inteiro (5.318.348 documentos): de 2.130 hits de ' +
          '"nepotismo", 284 sao ANEXO, 240 CERTIFICADO, 194 ESCLARECIMENTO e apenas 64 sao ' +
          'ACÓRDÃO. NAO cite o que vier daqui como julgado sem conferir `tipo`.',
      );
    }
    if (o.relator) {
      av.push(
        '🔴 NAO HA FILTRO POR RELATOR nesta base: `idmembrorelator` esta morto no indice ' +
          '(3 relatores reais e 1 inventado devolveram 0, e `nmmembrorelator` vem null em ' +
          'todo documento). O parametro foi IGNORADO em vez de zerar sua busca.',
      );
    }
    if (o.dataJulgamento) {
      av.push(
        '🔴 NAO HA FILTRO POR DATA DE JULGAMENTO: `dtsessao` esta morto no indice ' +
          '(`exists` = 0). O recorte de data deste crawler e por `dtfinalizado`, a data de ' +
          'GERACAO/disponibilizacao do documento — sao coisas diferentes.',
      );
    }
    if (!q && !o.processo) {
      av.push(
        'Busca sem termo devolve o acervo por data e o total satura em 10.000. Use -di/-df ' +
          'para fatiar: a paginacao por search_after nao tem teto de profundidade, mas ' +
          'anda de 10 em 10 documentos por request.',
      );
    }
    return av;
  }

  /**
   * ⚠️ O `conteudo` NEM SEMPRE E O DOCUMENTO INTEIRO. O mapeamento de 18/08
   * registrou "o texto integral ja vem no payload", e isso e verdade em parte
   * dos documentos e falso em outros: o ACÓRDÃO 1754/2026 (id 9343180) declara
   * "1/12" na primeira linha e traz **976 chars** de `conteudo` — a primeira
   * pagina, nao as doze. Por isso `inteiroTeorCompleto` sai como `false` sempre
   * que o texto e curto, e o PDF continua sendo a fonte do inteiro teor.
   *
   * ⚠️ E A EMENTA NAO E CAMPO PROPRIO. Existe `dssumula`, mas `exists` = 0 no
   * indice (vem null em todo documento medido). Quando ha ementa, ela e um
   * TRECHO dentro de `conteudo` comecando em "EMENTA:". O ACÓRDÃO medido nao
   * tinha nenhuma. Este mapeamento extrai quando da, e marca `semEmenta` quando
   * nao da — nunca inventa.
   */
  _mapear(d) {
    const conteudo = String(d.conteudo || '');
    const m = conteudo.match(/EMENTA\s*:?\s*([\s\S]{40,4000}?)(?=\n\s*(?:ACORDA|ACÓRDÃ|RELATÓRIO|VOTO|1\.|I\s*[-–])|$)/i);
    const ementa = m ? m[1].replace(/\s+/g, ' ').trim() : null;
    const trecho = (d.highlight?.conteudo || [])
      .map((t) => t.replace(/<\/?mark>/g, ''))
      .join('\n…\n') || null;

    return {
      // 🔴 QUEM IDENTIFICA O DOCUMENTO E `iddocumento`. `nrdocumento` se repete
      // entre tipos (ha VOTO 5855/2026 e ACÓRDÃO 5855/2026) e `nrprocesso`
      // agrupa ~100 documentos.
      id: d.iddocumento,
      numeroDocumento: d.nrdocumento && d.nranodocumento ? `${d.nrdocumento}/${d.nranodocumento}` : null,
      tipo: d.nmtipodocumento || null,
      titulo:
        d.nmtipodocumento && d.nrdocumento ? `${d.nmtipodocumento} ${d.nrdocumento}/${d.nranodocumento}` : null,
      // NAO e CNJ: numeracao propria <sequencial>/<ano>-<dv>. src/cnj.js nao se aplica.
      processo: d.nrprocesso || null,
      especie: d.dsespecie || null,
      entidade: d.dsentidade || null,
      localidade: d.dslocalidade || null,
      setor: d.nmsetor || null,
      uf: 'CE',
      // 🔴 NAO ha data de julgamento nesta base (dtsessao morto). Esta e a data de
      // geracao/disponibilizacao do documento — e o que a tela chama
      // "Disponibilizado em".
      dataDocumento: TCECECrawler._br(d.dtfinalizado),
      dataJulgamento: null,
      dataEntradaProcesso: TCECECrawler._br(d.dtentradaprocesso),
      relator: d.nmmembrorelator || null, // sempre null: campo morto no indice
      ementa,
      semEmenta: !ementa,
      trecho,
      inteiroTeor: conteudo || null,
      inteiroTeorChars: conteudo.length,
      inteiroTeorCompleto: conteudo.length > 5000,
      arquivoGed: d.dsdocumento || null,
      url: TCECENavigator.permalink(d.iddocumento),
      urlPublica: true,
      sort: d.sort || null,
    };
  }

  async buscar(opts = {}) {
    const maxPages = parseInt(opts.maxPages ?? 1, 10);
    const filtros = TCECECrawler._montarFiltros(opts);
    const avisos = TCECECrawler.avisos(opts);
    for (const a of avisos) this.log(`  [aviso] ${a}`);

    const t0 = Date.now();
    const resultados = [];
    let total = null;
    let totalExato = null;
    let agregacao = {};
    let paginas = 0;
    let cursor = null;

    for (let page = 0; page < maxPages; page++) {
      const r = await this.nav.buscarPagina({
        texto: opts.query || '',
        filtros,
        searchAfterSort: cursor,
        palavraExata: !!opts.palavraExata,
      });
      if (total === null) {
        total = r.total;
        totalExato = r.totalExato;
        agregacao = r.agregacao;
      }
      paginas++;
      this.log(
        `   pagina ${page + 1} → ${r.documentos.length} documentos` +
          (r.total != null ? ` (total ${r.total}${r.totalExato ? '' : '+, SATURADO'})` : ''),
      );
      resultados.push(...r.documentos.map((d) => this._mapear(d)));
      if (!r.documentos.length) break;
      // ✅ O cursor e o campo `sort` do ULTIMO documento da pagina.
      // 🔴 Array de 1 elemento (so o id) ZERA silenciosamente: precisa dos dois.
      cursor = r.documentos[r.documentos.length - 1].sort;
      if (!cursor || cursor.length < 2) break;
      if (r.documentos.length < TCECECrawler.POR_PAGINA) break;
      if (total != null && totalExato && resultados.length >= total) break;
    }

    if (totalExato === false) {
      avisos.push(
        `O total ${total} e SATURADO, nao exato: o track_total_hits do Elasticsearch trava ` +
          `em ${TCECECrawler.TETO_TOTAL}. O acervo documental do Contexto e de 5.318.348 ` +
          'documentos (numero publicado em /documentos/total-documentos). NAO reporte ' +
          `${TCECECrawler.TETO_TOTAL} como se fosse o total.`,
      );
    } else if (total != null) {
      // ✅ Abaixo do teto o total e EXATO, e da para provar: os buckets de
      // group_by_idtipodocumento de "nepotismo" somam exatamente 2.127 = tamanho.
      avisos.push(
        `Total ${total} e EXATO (abaixo do teto de ${TCECECrawler.TETO_TOTAL}). Prova do ` +
          'metodo: os 82 buckets de group_by_idtipodocumento de "nepotismo" somam ' +
          'exatamente o `tamanho` — a particao fecha.',
      );
    }
    if (total === 0) {
      avisos.push(
        'Zero aqui quase nunca e ausencia de jurisprudencia. Confira, nesta ordem: ' +
          '(1) se usou "E"/"OU"/"NÃO" achando que sao operadores (nao sao, e "OU" restringe); ' +
          '(2) se usou $ ou * como curinga (nao sao, e devolvem contagem plausivel); ' +
          '(3) se o termo e stopword curta ("a", "de" = 0); ' +
          '(4) se pediu um filtro MORTO — relator, esfera, tipo de sessao, categoria de ' +
          'especie e data de JULGAMENTO nao existem no indice e devolvem 0 com HTTP 200; ' +
          '(5) se restringiu tipo de documento demais — o default ja e so decisao (11% da base).',
      );
    }

    const buckets = (agregacao?.group_by_idtipodocumento?.buckets || []).map((b) => ({
      idtipodocumento: b.key,
      n: b.doc_count,
    }));

    return {
      tribunal: 'TCE-CE',
      comando: 'tcece',
      query: opts.query || null,
      filtros,
      apenasDecisao: !opts.todosDocumentos && !opts.tipo,
      tiposDecisao: TCECECrawler.TIPOS_DECISAO,
      total,
      totalExato: !!totalExato,
      acervoTotalConhecido: 5318348,
      retornados: resultados.length,
      paginas,
      porPagina: TCECECrawler.POR_PAGINA,
      distribuicaoTipos: buckets.slice(0, 20),
      duracaoMs: Date.now() - t0,
      avisos,
      resultados,
    };
  }
}

module.exports = TCECECrawler;
