// src/TCEPECrawler.js
const TCEPENavigator = require('./TCEPENavigator');

/**
 * TCEPECrawler — Deliberacoes do TCE-PE (Tribunal de Contas do Estado de Pernambuco).
 *
 * 🔴 NAO HA OPERADOR BOOLEANO, E O ESPACO E "E" IMPLICITO.
 * Medido em 18/08/2026 (nepotismo = 263, licitacao-acentuado = 13.636):
 *   `nepotismo licitação`      = 139   (espaco = AND: todos os termos exigidos)
 *   `nepotismo ZZQQINVENTADO`  = 0     (o controle que prova o AND)
 *   `nepotismo E licitação`    = 139   (identico ao espaco)
 *   `nepotismo NAO licitação`  = 139   `nepotismo NÃO licitação` = 139
 *   `nepotismo OU licitação`   = 137   🔴 MENOS que o AND, nao mais
 *   `nepotismo E`              = 263   `nepotismo OU` = 263 (= termo sozinho)
 * Ou seja: E, OU e NAO NAO SAO OPERADORES — sao palavras comuns que aparecem em
 * quase todo documento, entao `E` some no ruido e `OU` chega a RESTRINGIR (os 2
 * documentos de 139 que nao contem a palavra "ou"). Escrever `A OU B` esperando
 * uniao devolve a INTERSECAO. Para unir dois conceitos, rode duas buscas.
 *   `nepotism` = 0 e `nepotism*` = 0 e `nepotism$` = 0 — casamento por palavra
 * inteira, e NAO HA CURINGA (ao contrario do TCE-BA, onde `*` funcionava).
 *   `"nepotismo cruzado"` (aspas) = 14 = `nepotismo cruzado` com exprExata=true:
 * as aspas funcionam como frase, e aqui NAO derrubam a busca (TCE-BA dava 500).
 *
 * 🔴 O ACENTO NAO E NORMALIZADO, E O ERRO NAO E ZERO — E UM SUBCONJUNTO PLAUSIVEL.
 * `licitação` = 13.636 contra `licitacao` = 40. Nao ha o zero que denunciaria o
 * problema: quem buscar sem acento recebe 40 resultados de verdade, com ementa e
 * inteiro teor, e conclui que o acervo e pequeno. Oposto de TCE-BA/TJAC, onde o
 * indice normalizava. O crawler AVISA sempre que o termo tiver vogal acentuavel
 * escrita sem acento.
 *
 * 🔴 O DEFAULT DO PORTAL OMITE OS PARECERES PREVIOS. Os tres tipos de documento
 * particionam exato (nepotismo): acordao 241 + decisao 22 + parecerPrevio 9 = 272.
 * Mas a tela vem com `parecerPrevio.equals=false`, entao a busca oficial devolve
 * 263 — 3,3% a menos, e o que fica de fora e justamente o PARECER PREVIO, a peca
 * das contas anuais de prefeito. Este crawler manda os TRES como default e
 * expoe `--sem-parecer-previo` para reproduzir a tela.
 * ⚠️ `inteiroTeor.equals` NAO e um quarto tipo: sozinho devolve 272 (= sem
 * restricao), logo NAO restringe nada e nao entra na particao.
 *
 * 🔴 O TEXTO INTEGRAL JA VEM NA BUSCA, em `descricaoParecerProcesso` (42.285
 * chars no acordao 1450/2026), com `<br/>` como quebra. `--fetch-inteiro-teor`
 * portanto NAO precisa de segundo salto — ele so grava o texto em disco.
 * ⚠️ Parte do acervo devolve a string literal `"Não foi possível obter o texto."`
 * nesse campo (medido na base sem termo): e AUSENCIA DE TEXTO, nao texto, e o
 * crawler marca `semTexto: true` em vez de gravar a mensagem como se fosse o
 * inteiro teor. E `descricaoParecerProcessoSimplificada` NAO e a ementa — e o
 * mesmo texto truncado em ~100 chars.
 */
class TCEPECrawler {
  static SIZE_DEFAULT = 100;

  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCEPENavigator({ log });
  }

  /** DD/MM/YYYY -> YYYY-MM-DD. A API so aceita ISO; `01/01/2026` devolve HTTP 400. */
  static _iso(d) {
    if (!d) return '';
    const s = String(d).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/^\d{4}-\d{2}-\d{2}$/);
    if (m) return s;
    throw new Error(`Data invalida: "${d}". Use DD/MM/YYYY (o crawler converte para YYYY-MM-DD).`);
  }

  _montarParams(o, page, size) {
    const p = {
      page,
      size,
      // 🔴 `todasBaseExprExata.equals` e OBRIGATORIO sempre que ha termo: sem ele
      // a API devolve HTTP 400 com corpo `{"message":null}` — erro mudo.
      'todasBaseDescricao.equals': o.query || '',
      'todasBaseExprExata.equals': o.expressaoExata ? 'true' : 'false',
      'modalidade.in': o.modalidade || '',
      'tipoProcesso.in': o.tipoProcesso || '',
      'relator.contains': o.relator || '',
      'unidadeGestora.equals': o.unidadeGestora || '',
      'orgaoJulgador.equals': o.orgaoJulgador || '',
      'numeroProcesso.equals': o.numeroProcesso || '',
      'acordao.equals': String(o.acordao !== false),
      'decisao.equals': String(o.decisao !== false),
      'parecerPrevio.equals': String(o.parecerPrevio !== false),
      'inteiroTeor.equals': 'false',
      'dataJulgamentoInicio.equals': TCEPECrawler._iso(o.dataInicio),
      'dataJulgamentoFim.equals': TCEPECrawler._iso(o.dataFim),
      'numeroDeliberacao.equals': o.numeroDeliberacao || '',
      'anoDeliberacao.in': o.anoDeliberacao || '',
      sort: 'dataJulgamentoProcesso,desc',
    };
    return p;
  }

  /** Avisos que o usuario PRECISA ver — sao onde o zero (ou o subconjunto) mora. */
  static avisos(o = {}) {
    const av = [];
    const q = o.query || '';
    if (/\b(E|OU|NAO|NÃO|AND|OR|NOT)\b/.test(q)) {
      av.push(
        'O TCE-PE NAO TEM OPERADOR BOOLEANO. O espaco ja e "E" implicito, e as palavras ' +
          'E/OU/NAO sao termos comuns: "A OU B" devolve a INTERSECAO (medido: 137 contra ' +
          '139 do AND), nunca a uniao. Para unir dois conceitos, rode duas buscas.',
      );
    }
    if (/[*$?]/.test(q)) {
      av.push('NAO HA CURINGA no TCE-PE: nepotism* = 0 e nepotism$ = 0 (nepotismo = 263).');
    }
    if (/\b(licitacao|contratacao|servico|orgao|nao|acordao|decisao|sancao|omissao|inexigibilidade|conclusao|admissao|aposentadoria)\b/i.test(q)) {
      av.push(
        'ACENTO IMPORTA NO TCE-PE e o erro NAO aparece como zero: "licitacao" = 40 contra ' +
          '"licitação" = 13.636. Sem acento a busca devolve um SUBCONJUNTO PLAUSIVEL. ' +
          'Escreva o termo acentuado.',
      );
    }
    if (o.parecerPrevio === false) {
      av.push(
        'PARECER PREVIO DESLIGADO: e o que a tela do portal faz por default, e omite 3,3% ' +
          'do acervo (nepotismo: 263 em vez de 272) — justamente as contas anuais de prefeito.',
      );
    }
    return av;
  }

  _mapear(d) {
    const bruto = typeof d.descricaoParecerProcesso === 'string' ? d.descricaoParecerProcesso : '';
    // 🔴 Mensagem de falha do proprio portal, NAO texto do julgado.
    const semTexto = !bruto || /^N[ãa]o foi poss[íi]vel obter o texto\.?$/i.test(bruto.trim());
    const texto = semTexto ? '' : bruto.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const numeroDel = d.numeroDeliberacaoProcesso;
    const anoDel = d.anoDeliberacaoProcesso;
    return {
      // 🔴 Quem identifica a peca e o codigo do documento, nao o processo: um
      // processo rende Acordao + Inteiro Teor da Deliberacao com codigos distintos.
      id: d.codigoDeliberacaoProcesso ?? null,
      tipoDocumento: d.nomeTipoDocumento || null,
      processo: d.numeroProcessoProcesso || null,
      anoProcesso: d.anoProcessoProcesso || null,
      numeroDecisao: numeroDel ?? null,
      anoDecisao: anoDel ?? null,
      titulo: numeroDel && anoDel ? `${d.nomeTipoDocumento || 'Deliberação'} ${numeroDel}/${anoDel}` : null,
      orgaoJulgador: d.detalheProcessoNomeOrgaoJulgador || null,
      relator: d.detalheProcessoNomeServidor || null,
      unidadeGestora: d.detalheProcessoNomeUnidadeJurisdicionada || null,
      modalidade: d.modalidadeProcesso || null,
      tipoProcesso: d.descricaoTipoProcessoProcesso || null,
      uf: 'PE',
      dataJulgamento: d.dataJulgamentoProcessoFormatada || TCEPECrawler._br(d.dataJulgamentoProcesso),
      // 🔴 NAO EXISTE data de publicacao nesta base — nem como filtro nem como campo.
      dataPublicacao: null,
      // 🔴 NAO ha ementa como campo proprio: o que existe e o texto integral.
      ementa: null,
      semEmenta: true,
      inteiroTeor: texto || null,
      inteiroTeorChars: texto.length,
      semTexto,
      // 🔴 O PERMALINK SO E PUBLICO NA METADE RECENTE DO ACERVO. Medido em 272
      // documentos de `nepotismo`: 138 apontam para `etce.tce.pe.gov.br/epp/validaDoc.seam`
      // (publico, HTTP 200) e 134 para `portalintranet.tce.pe/siga/downloadAPAction.do`,
      // que e NXDOMAIN — host de INTRANET vazado no payload publico. Entregar essa URL
      // como se fosse citavel e o erro; `urlPublica` marca quais valem.
      url: d.linkDocumentoDeliberacao || null,
      urlPublica: TCEPECrawler._publica(d.linkDocumentoDeliberacao),
      inteiroTeorLink: d.linkDocumentoITD || null,
      processoUrl: d.linkConsultaProcesso || null,
    };
  }

  /** `portalintranet.tce.pe` e NXDOMAIN: link de intranet nao e permalink. */
  static _publica(u) {
    if (!u) return false;
    try { return new URL(u).host.endsWith('.gov.br'); } catch (e) { return false; }
  }

  static _br(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  async buscar(opts = {}) {
    const size = Math.min(parseInt(opts.size || TCEPECrawler.SIZE_DEFAULT, 10), 2000);
    const maxPages = parseInt(opts.maxPages ?? 1, 10);
    const avisos = TCEPECrawler.avisos(opts);
    for (const a of avisos) this.log(`  [aviso] ${a}`);

    const t0 = Date.now();
    const resultados = [];
    let total = null;
    let paginas = 0;
    for (let page = 0; page < maxPages; page++) {
      const { documentos, total: t } = await this.nav.buscarPagina(this._montarParams(opts, page, size));
      if (total === null) total = t;
      paginas++;
      this.log(`   pagina ${page} → ${documentos.length} documentos${t != null ? ` (total ${t})` : ''}`);
      resultados.push(...documentos.map((d) => this._mapear(d)));
      if (documentos.length < size) break;
      if (total != null && resultados.length >= total) break;
    }

    const semPermalink = resultados.filter((r) => r.url && !r.urlPublica).length;
    if (semPermalink) {
      avisos.push(
        `${semPermalink} de ${resultados.length} documentos so tem link de INTRANET ` +
          `(portalintranet.tce.pe, NXDOMAIN) — sao os do acervo antigo (era SIGA), e para eles ` +
          `NAO ha permalink publico nem PDF pela API. O texto integral, esse, veio na busca; ` +
          `a verificacao desses julgados e por reconsulta (jur tcepe -n <processo>).`,
      );
    }

    const semTexto = resultados.filter((r) => r.semTexto).length;
    if (semTexto) {
      avisos.push(
        `${semTexto} de ${resultados.length} documentos vieram com "Não foi possível obter o ` +
          `texto." no lugar do inteiro teor — e ausencia de texto no portal, nao do julgado.`,
      );
    }
    if (total === 0) {
      avisos.push(
        'Zero no TCE-PE quase nunca e ausencia de jurisprudencia: confira ACENTO (licitacao=40 ' +
          'contra licitação=13.636), confira se nao escreveu OU esperando uniao, e lembre que ' +
          'nao ha curinga.',
      );
    }

    return {
      tribunal: 'TCE-PE',
      comando: 'tcepe',
      query: opts.query || null,
      total, // ✅ EXATO (X-Total-Count), nao saturado
      totalExato: true,
      retornados: resultados.length,
      paginas,
      duracaoMs: Date.now() - t0,
      avisos,
      resultados,
    };
  }
}

module.exports = TCEPECrawler;
