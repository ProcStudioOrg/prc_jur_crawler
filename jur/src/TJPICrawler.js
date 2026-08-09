// src/TJPICrawler.js
const TJPINavigator = require('./TJPINavigator');

/**
 * Crawler do TJPI (Tribunal de Justiça do Piauí) — portal JusPI.
 * https://jurisprudencia.tjpi.jus.br
 *
 * Como TJBA/TJPA/TJPE, NÃO estende BaseCrawler: o acesso é HTTP direto (ver
 * TJPINavigator). Contrato público do repo: search(query, filters, options)
 * → Array com .totalResults.
 *
 * ✅ A EMENTA ÍNTEGRA JÁ VEM NO HTML DA BUSCA, num `<div>` escondido por CSS
 *    (`data-reveal-target="item"`) que o botão "+" só revela — sem XHR nenhum.
 *    Junto com ela vem a CITAÇÃO OFICIAL pronta. O inteiro teor é que exige o
 *    permalink (um GET por documento), e `--fetch-inteiro-teor` é quem liga isso.
 */

/** Regex de Turma/Colégio Recursal, para o recorte Juizado × Justiça Comum. */
const RE_TURMAS = /turma recursal|col[ée]gio recursal|turma (estadual )?de uniformiza/i;

/** Entidades HTML que aparecem na listagem do JusPI. */
const ENTIDADES = {
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', icirc: 'î', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Uacute: 'Ú', Ccedil: 'Ç',
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–',
  hellip: '…', deg: '°', ordm: 'º', ordf: 'ª', sect: '§', bull: '•',
  raquo: '»', rsaquo: '›', laquo: '«', lsaquo: '‹',
};

/** Os três valores do combo `tipo`, exatamente como o servidor os quer. */
const TIPOS = {
  acordao: 'Acórdão',
  terminativa: 'Decisão Terminativa',
  sumula: 'Súmula',
};

class TJPICrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages ?? 10;
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJPINavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
  }

  /** DD/MM/YYYY → YYYY-MM-DD (o `<input type="date">` do JusPI quer ISO). @private */
  _toIsoDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Tira tag e decodifica entidade. @private */
  static limparHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&([a-zA-Z]+);/g, (m, e) => (Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m))
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Lê o total da listagem.
   *
   * ⚠️ O JusPI tem DOIS textos diferentes, e quem só casar o primeiro lê zero
   * em toda busca que caiba numa página:
   *   - várias páginas: `Exibindo <b>1&nbsp;-&nbsp;25</b> de um total de <b>585</b> jurisprudência(s)`
   *   - uma página só:  `Exibindo <b>18</b> jurisprudência(s)`  ← sem "total de"
   * ✅ O total é EXATO, não saturado: medido 585 = 23×25 + 10 na última página,
   *    e 397.031 = 15.881×25 + 6 na base inteira.
   * @private
   */
  static lerTotal(html) {
    const m = html.match(/total de\s*<b>\s*([\d.]+)\s*<\/b>/i);
    if (m) return Number(m[1].replace(/\./g, ''));
    const uma = html.match(/Exibindo\s*<b>\s*(\d+)\s*<\/b>\s*jurisprud/i);
    if (uma) return Number(uma[1]);
    return 0; // página de "nenhum resultado": não há nenhum dos dois textos
  }

  /** Fatia o HTML da listagem nos cards. @private */
  static fatiarCards(html) {
    const partes = html.split(/<div class="callout callout-danger"/);
    return partes.slice(1).map((p) => `<div class="callout callout-danger"${p}`);
  }

  /**
   * Card do JusPI → formato padrão do repo.
   *
   * Campo a campo, o que o card entrega sem clicar nada:
   *   `<a href="/jurisprudences/34082462/public">` → id do DOCUMENTO (≠ processo)
   *   texto do `<h5>`                              → assunto + nº CNJ
   *   `<span class="right badge">`                 → tipo ("Acórdão de 2º Grau")
   *   `<h6>Publicação: DD/MM/YYYY`                 → única data que a base expõe
   *   `<div class="text-justify">` (topo)          → TRECHO com <mark>, não ementa
   *   `<div data-reveal-target="item">`            → EMENTA ÍNTEGRA + citação oficial
   */
  mapCard(cardHtml) {
    const id = (cardHtml.match(/\/jurisprudences\/(\d+)\/public/) || [])[1] || null;

    const h5 = (cardHtml.match(/<h5>([\s\S]*?)<\/h5>/i) || [])[1] || '';
    const badge = TJPICrawler.limparHtml((h5.match(/<span class="right badge[^"]*">([\s\S]*?)<\/span>/i) || [])[1] || '');
    const tituloTxt = TJPICrawler.limparHtml(h5.replace(/<span class="right badge[\s\S]*?<\/span>/i, ''));
    const numeroProcesso = (tituloTxt.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/) || [])[0] || '';
    const assunto = tituloTxt.replace(numeroProcesso, '').trim();

    const dataPublicacao = (TJPICrawler.limparHtml(
      (cardHtml.match(/<h6>([\s\S]*?)<\/h6>/i) || [])[1] || '',
    ).match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';

    // ⚠️ O bloco escondido traz a ementa ÍNTEGRA. O texto de cima é trecho.
    const revelado = (cardHtml.match(/data-reveal-target="item"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    const revelTxt = TJPICrawler.limparHtml(revelado);

    // ✅ A CITAÇÃO OFICIAL VEM PRONTA no fim do bloco — nada de montar por regex
    //    a partir de campos soltos, como foi preciso nos quatro e-SAJ do Bloco 1.
    //    Formato: (TJPI - <CLASSE> <CNJ> - Relator: <NOME> - <ÓRGÃO> - Data DD/MM/YYYY)
    const cit = revelTxt.match(/\(TJPI\s*-\s*([\s\S]*?)-\s*Data\s*(\d{2}\/\d{2}\/\d{4})\s*\)\s*$/);
    let classe = '', relator = '', orgaoJulgador = '', citacao = '';
    if (cit) {
      citacao = cit[0].replace(/\s+/g, ' ').trim();
      const miolo = cit[1];
      const mRel = miolo.match(/^([\s\S]*?)\s*-\s*Relator\s*\(?a?\)?:\s*([\s\S]*?)\s*-\s*([\s\S]*)$/i);
      if (mRel) {
        classe = mRel[1].replace(numeroProcesso, '').replace(/\s+/g, ' ').trim().replace(/[-\s]+$/, '');
        relator = mRel[2].replace(/\s+/g, ' ').trim();
        orgaoJulgador = mRel[3].replace(/\s+/g, ' ').trim();
      }
    }

    // A ementa é tudo que vem antes da citação, sem o rótulo "Ementa:".
    const ementa = (citacao ? revelTxt.slice(0, revelTxt.lastIndexOf(citacao)) : revelTxt)
      .replace(/^\s*Ementa:\s*/i, '').trim();

    const trecho = TJPICrawler.limparHtml(
      ((cardHtml.match(/<div class="text-justify">([\s\S]*?)<div class="mt-3">/i) || [])[1] || ''),
    );

    // 🔴 O PERMALINK DE SÚMULA ESTÁ QUEBRADO NO SERVIDOR.
    //    `/jurisprudences/<id>/public` devolve HTTP 500 para TODA súmula
    //    (medido 5/5: ids 83, 85, 86, 87, 88), enquanto acórdão e decisão
    //    terminativa abrem normalmente. Não é documento envenenado avulso como
    //    no TJPE — é o tipo inteiro. Por isso a súmula sai SEM link: publicar
    //    uma URL que dá 500 é pior que declarar que não há.
    const ehSumula = /súmula|sumula/i.test(badge);
    const link = id && !ehSumula ? TJPINavigator.permalink(id) : null;

    return {
      id,
      tipoDocumento: badge,             // "Acórdão de 2º Grau" | "Decisão Terminativa de 2º Grau" | "Súmula de 2º Grau"
      numeroProcesso,
      processoUrl: link,
      orgaoJulgador,
      instancia: RE_TURMAS.test(orgaoJulgador) ? 'Turma Recursal' : '2º Grau',
      classe,
      assunto,
      relator,
      // ⚠️ A BASE SÓ TEM DATA DE PUBLICAÇÃO. Não existe data de julgamento
      //    exposta em lugar nenhum — nem no card, nem no documento, nem como
      //    filtro. `dataJulgamento` fica vazio de propósito, para não inventar.
      dataJulgamento: '',
      dataPublicacao,
      uf: 'PI',
      ementa: ementa.substring(0, 20000),
      trecho,                            // o texto com <mark> que o portal mostra fechado
      citacao,
      inteiroTeorLink: link,
    };
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um é uma armadilha medida em
   * 09/08/2026 contra a base real.
   * @private
   */
  _avisosDaQuery(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. 🔴 Os operadores INGLESES ZERAM a busca (viram termo literal e o AND
    //    implícito nunca casa). Medido: and/or/not/adj/prox = 0 resultados.
    const en = q.match(/(^|\s)(AND|OR|NOT|ADJ|PROX)(\s|$)/gi);
    if (en) {
      avisos.push(
        `AVISO: "${[...new Set(en.map((s) => s.trim().toUpperCase()))].join('", "')}" ZERA a busca no TJPI — ` +
        'nao e operador aqui. Os operadores do JusPI sao em PORTUGUES: E, OU, ' +
        'NAO acentuado ("nao" sem acento NAO funciona), "frase exata" e parenteses.',
      );
    }

    // 2. 🔴 O `NAO` sem acento NAO e operador — e o erro nao da sintoma.
    //    Medido: `usucapiao nao posse` = 282 (o termo "nao" entra no AND) contra
    //    `usucapiao nao(acentuado) posse` = 279 = 585 - 306, a exclusao correta.
    if (/(^|\s)nao(\s|$)/i.test(q) && !/(^|\s)n[ãÃ]o(\s|$)/i.test(q)) {
      avisos.push(
        'AVISO: escreva NAO com til ("nao" acentuado) para excluir termo no TJPI. ' +
        'Sem acento ele vira PALAVRA de busca e a contagem sobe em vez de cair ' +
        '(medido: 282 x 279) — sem erro nenhum na tela.',
      );
    }

    // 3. `$` e `*` nao sao operadores documentados aqui.
    if (/[$*]/.test(q)) {
      avisos.push('AVISO: "$" e "*" nao constam dos conectivos do JusPI — trate como texto literal.');
    }

    // 4. 🔴 Numero de processo SOZINHO devolve ZERO, mesmo estando indexado.
    if (/^\s*\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\s*$/.test(q)) {
      avisos.push(
        'AVISO: uma busca que seja SO um numero de processo mascarado derruba o JusPI ' +
        'com HTTP 500 (a pontuacao sozinha quebra o parser). Sem mascara nao da erro, ' +
        'mas devolve 0. Use "./bin/jur tjpi -n <numero>" — o Checker aplica o contorno.',
      );
    }

    // 5. 🔴 data_min sem data_max e IGNORADO em silencio.
    if ((filters.dataInicio && !filters.dataFim) || (!filters.dataInicio && filters.dataFim)) {
      avisos.push(
        'AVISO: o JusPI so aplica o filtro de data quando as DUAS pontas vao juntas. ' +
        'Medido: -di sozinho devolve o acervo inteiro (585 = sem filtro), com HTTP 200 ' +
        'e numero plausivel. Informe -di E -df.',
      );
    }

    if (filters.origem && filters.origem !== 'ambas') {
      avisos.push(
        `NOTA: --origem ${filters.origem} e recorte de CLIENTE, pelo nome do orgao julgador ` +
        'que vem na citacao do documento. O total do servidor se refere ao acervo SEM esse recorte.',
      );
    }
    return avisos;
  }

  /** Monta a querystring do formulário. @private */
  _buildParams(query, filters = {}, page = 1) {
    const p = {
      q: query || undefined,
      // ⚠️ O combo `tipo` quer o RÓTULO com acento ("Acórdão"), não um código.
      //    Valor inventado devolve 0 — o filtro é levado a sério, não ignorado.
      tipo: filters.tipo && filters.tipo !== 'todos' ? (TIPOS[filters.tipo] || filters.tipo) : undefined,
      // ⚠️ relator/classe/orgao querem o NOME exato do combo, não id.
      relator: filters.relator || undefined,
      classe: filters.classe || undefined,
      orgao: filters.orgao || undefined,
      data_min: this._toIsoDate(filters.dataInicio),
      data_max: this._toIsoDate(filters.dataFim),
      page: page > 1 ? page : undefined,
    };
    Object.keys(p).forEach((k) => p[k] === undefined && delete p[k]);
    return p;
  }

  /**
   * Busca. Contrato do repo: devolve Array com `.totalResults`.
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    const avisos = this._avisosDaQuery(query, filters);
    avisos.forEach((a) => this.log(a));

    const resultados = [];
    let total = 0;
    let paginas = 0;

    for (let page = 1; page <= maxPages; page++) {
      const html = await this.navigator.buscar(this._buildParams(query, filters, page));
      if (page === 1) total = TJPICrawler.lerTotal(html);
      const cards = TJPICrawler.fatiarCards(html);
      if (cards.length === 0) break;
      paginas = page;
      for (const c of cards) resultados.push(this.mapCard(c));
      if (page * TJPINavigator.POR_PAGINA >= total) break;
    }

    // Recorte de cliente Juizado × Justiça Comum.
    let saida = resultados;
    if (filters.origem === 'turmas') saida = resultados.filter((r) => r.instancia === 'Turma Recursal');
    else if (filters.origem === 'comum') saida = resultados.filter((r) => r.instancia !== 'Turma Recursal');

    if (this.includeFullText) {
      for (const r of saida) {
        try {
          r.inteiroTeor = await this.fetchInteiroTeor(r.id, r.tipoDocumento);
        } catch (e) {
          r.inteiroTeor = '';
          this.log(`AVISO: inteiro teor do documento ${r.id} falhou: ${e.message}`);
        }
      }
    }

    saida.totalResults = total;
    saida.paginasLidas = paginas;
    saida.porPagina = TJPINavigator.POR_PAGINA;
    // ✅ Total EXATO (não saturado): a última página fecha a aritmética
    //    (585 = 23×25+10; 397.031 = 15.881×25+6) e não há teto de offset.
    saida.totalExato = true;
    saida.avisos = avisos;
    this.ultimaBusca = { query, filters, total };
    return saida;
  }

  /**
   * Inteiro teor de um documento, pelo permalink público.
   *
   * ✅ Sem captcha e sem sessão — o mesmo GET responde em contexto limpo.
   * A página traz ementa + ACÓRDÃO (relatório, voto e decisão) + a tabela
   * "Detalhes". Aqui se devolve do "Acórdão"/"Decisão" em diante, que é o que
   * a ementa NÃO cobre.
   */
  async fetchInteiroTeor(id, tipoDocumento = '') {
    if (!id) return '';
    // Súmula não tem página pública (HTTP 500) — e o texto dela JÁ É a ementa.
    if (/súmula|sumula/i.test(tipoDocumento)) return '';
    const html = await this.navigator.documento(id);
    const corpo = (html.match(/<div class="content-wrapper"[\s\S]*?<footer/i) || [html])[0];
    const txt = TJPICrawler.limparHtml(corpo);
    const i = txt.search(/\n\s*(ACÓRDÃO|Acórdão|DECISÃO|Decisão)\s*\n/);
    return (i > 0 ? txt.slice(i) : txt).trim();
  }

  /** Metadados da tabela "Detalhes" da página do documento. */
  async fetchDetalhes(id) {
    const html = await this.navigator.documento(id);
    const det = {};
    const bloco = (html.match(/Detalhes([\s\S]*?)<footer/i) || [])[1] || '';
    const re = /<(?:dt|th|strong|b)[^>]*>\s*([^<]{3,40}?)\s*<\/(?:dt|th|strong|b)>\s*<(?:dd|td|span|div)[^>]*>\s*([^<]{1,200}?)\s*</gi;
    let m;
    while ((m = re.exec(bloco)) !== null) {
      det[TJPICrawler.limparHtml(m[1])] = TJPICrawler.limparHtml(m[2]);
    }
    return det;
  }
}

TJPICrawler.TIPOS = TIPOS;
module.exports = TJPICrawler;
