// src/TJTOCrawler.js
const TJTONavigator = require('./TJTONavigator');

/**
 * Crawler do TJTO (Tribunal de Justiça do Tocantins) — portal "Jurisprudência 4.0".
 * https://jurisprudencia.tjto.jus.br
 *
 * Como TJPI/TJBA/TJPE, NÃO estende BaseCrawler: o acesso é HTTP direto (ver
 * TJTONavigator). Contrato público do repo: search(query, filters, options)
 * → Array com .totalResults.
 *
 * ✅ A EMENTA ÍNTEGRA JÁ VEM NO HTML DA BUSCA (`div.content_ementa`), no
 *    formato estruturado do CNJ (I. Caso em exame / II. Questões em discussão /
 *    III. Razões de decidir / IV. Dispositivo). O inteiro teor é que exige um
 *    GET por documento — `--fetch-inteiro-teor` liga isso.
 *
 * ✅ A CITAÇÃO OFICIAL vem pronta em `rodape_ementa` (via `ementa.php`), sem
 *    regex: "(TJTO, Apelação Cível, 0004697-71.2023.8.27.2737, Rel. …,
 *    julgado em 24/06/2026, …)". Como TJMT e TJPI.
 */

/** As três abas da listagem. O portal chama isso de "minuta". */
const TIPOS = { acordao: 1, monocratica: 2, sentenca: 3 };

/**
 * O rótulo da competência que separa Juizado de Justiça Comum.
 * ⚠️ Não confunda com "TURMAS DAS CAMARAS CIVEIS", que é 2º grau comum: os dois
 *    começam por "TURMAS" e o acervo é 9× diferente (186.534 × 20.785).
 */
const COMPETENCIA_TURMAS = 'TURMAS RECURSAIS';
const RE_TURMAS = /turmas?\s+recursa/i;

class TJTOCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages ?? 10;
    this.porPagina = Math.min(options.porPagina ?? TJTONavigator.POR_PAGINA, TJTONavigator.ROWS_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJTONavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
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
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * O total da aba ativa. ✅ EXATO, não saturado: a aritmética da última página
   * fecha (1.807 = 90×20+7; 29.310 com start=29.300 devolve 10) e não há teto
   * de offset (start=20.000 responde).
   */
  static lerTotal(html) {
    const m = html.match(/([\d.]+)\s+resultados/);
    return m ? parseInt(m[1].replace(/\./g, ''), 10) : 0;
  }

  /**
   * Os totais das TRÊS abas, que o portal devolve **sempre juntos**, já
   * refletindo os filtros correntes. Uma requisição dá os três acervos.
   */
  static lerAbas(html) {
    const out = {};
    const re = /type_minuta=\s*(\d)[\s\S]{0,400}?>([^<]+?)\s*<span class="num_minuta">\s*\(([\d.]+)\)/g;
    let m;
    while ((m = re.exec(html)) !== null) out[m[2].trim()] = parseInt(m[3].replace(/\./g, ''), 10);
    return out;
  }

  /** Fatia a listagem em cards. Um card = um `container align-self-center panel panel-default`. */
  static fatiarCards(html) {
    const partes = html.split(/<div style="width: 99%[^"]*"\s+class="container align-self-center panel panel-default"\s*>/);
    return partes.slice(1).filter((p) => /id="content_[0-9a-f]{32}"/.test(p));
  }

  /** Um card → o objeto do repo. `aba` é o rótulo do tipo (acórdão/monocrática/sentença). */
  mapCard(card, aba = 'Acórdão') {
    const uuid = (card.match(/id="content_([0-9a-f]{32})"/) || [])[1] || null;
    const processo = (card.match(/setcopiarConteudo\('(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})'\)/) || [])[1] || null;
    const eproc = card.match(/eproc2\.tjto\.jus\.br\/consulta_publica\/(\dG)\/processo\/(\d{20})/);

    // A tabela de metadados: <td>rótulo</td><td>valor</td>
    const meta = {};
    const re = /<td[^>]*>\s*([^<]{3,30}?)\s*<\/td>\s*<td[^>]*>\s*([\s\S]{0,400}?)\s*<\/td>/g;
    let m;
    while ((m = re.exec(card)) !== null) meta[TJTOCrawler.limparHtml(m[1])] = TJTOCrawler.limparHtml(m[2]);

    const ementaHtml = (card.match(/<div[^>]*class="content_ementa"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const competencia = meta['Competência'] || meta['Competencia'] || null;

    return {
      id: uuid,
      // 🔴 O uuid identifica o DOCUMENTO, não o processo: um mesmo processo
      //    aparece em mais de uma aba (o 0004697-71.2023.8.27.2737 tem 1 acórdão
      //    E 1 sentença). Nunca use o nº do processo como identidade do julgado.
      processo,
      processoSemMascara: eproc ? eproc[2] : (processo ? processo.replace(/\D/g, '') : null),
      processoUrl: eproc ? `https://eproc2.tjto.jus.br/consulta_publica/${eproc[1]}/processo/${eproc[2]}/` : null,
      // ⚠️ O card tem um campo "Tipo Julgamento", e ele NÃO é o tipo do
      //    documento: vale "Mérito", "Embargos de Declaração", "Agravo
      //    Interno"… O tipo do repo (acórdão × monocrática × sentença) é a ABA,
      //    que não aparece no card — vem de qual `type_minuta_selected` se pediu.
      tipoDocumento: aba,
      tipoJulgamento: meta['Tipo Julgamento'] || null,
      classe: meta['Classe'] || null,
      assuntos: meta['Assunto(s)'] || null,
      orgaoJulgador: competencia,
      instancia: competencia && RE_TURMAS.test(competencia) ? 'Turma Recursal' : 'Justiça Comum',
      relator: meta['Relator'] || null,
      dataAutuacao: meta['Data Autuação'] || null,
      dataJulgamento: meta['Data Julgamento'] || null,
      // 🔴 NÃO EXISTE DATA DE PUBLICAÇÃO nesta base — nem campo, nem filtro.
      //    O par de datas é (autuação, julgamento). Espelho do TJRO.
      dataPublicacao: null,
      uf: 'TO',
      ementa: TJTOCrawler.limparHtml(ementaHtml),
      // 🔴 SÓ ACÓRDÃO TEM EMENTA DE VERDADE. Na sentença e na monocrática o
      //    mesmo `div.content_ementa` traz **a decisão inteira** — cabeçalho,
      //    partes, "SENTENÇA"/"DESPACHO/DECISÃO" e o corpo. Apresentar isso
      //    como ementa seria errar a natureza do texto (padrão TJBA).
      semEmenta: aba !== 'Acórdão',
      // O `<em>` marca o termo buscado dentro da ementa — é destaque sobre o
      // texto ÍNTEGRO, não um trecho recortado: o card e o `ementa.php` do
      // mesmo documento devolvem o mesmo texto (conferido caractere a caractere).
      permalink: uuid ? TJTONavigator.permalink(uuid) : null,
      inteiroTeorLink: uuid ? TJTONavigator.permalink(uuid) : null,
    };
  }

  /** DD/MM/YYYY, e só. @private */
  _dataBr(d) {
    if (!d) return undefined;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    // 🔴 O portal IGNORA ISO em silêncio (devolve o acervo inteiro com HTTP 200):
    //    converter aqui é obrigatório, não conveniência.
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** Monta o corpo do POST. @private */
  _buildParams(query, filters = {}, start = 0, rows = this.porPagina) {
    const p = {
      q: query || '*:*',
      type_minuta_selected: TIPOS[filters.tipo] ?? TIPOS.acordao,
      rows,
      start,
    };
    if (filters.instancia === '1') p.tip_criterio_inst = '1';
    else if (filters.instancia === '2') p.tip_criterio_inst = '2';
    if (filters.ordem) p.tip_criterio_data = filters.ordem;
    if (filters.somenteEmenta) p.soementa = 'true';
    if (filters.numeroProcesso) p.numero_processo = filters.numeroProcesso;

    const di = this._dataBr(filters.dataInicio);
    const df = this._dataBr(filters.dataFim);
    if (di || df) {
      // 🔴 `tempo_julgados=pers` É OBRIGATÓRIO: sem ele o portal IGNORA as duas
      //    datas em silêncio e devolve o acervo inteiro com HTTP 200. Um filtro
      //    de data destrancado por um parâmetro-companheiro — defeito novo no repo.
      p.tempo_julgados = 'pers';
      if (di) p.dat_jul_ini = di;
      if (df) p.dat_jul_fim = df;
    }

    // Facetas. A chave é `fq_<campo>[<valor literal>]` — valor, nunca id.
    if (filters.origem === 'turmas') p[`fq_competencia[${COMPETENCIA_TURMAS}]`] = 'on';
    if (filters.competencia) p[`fq_competencia[${filters.competencia}]`] = 'on';
    if (filters.classe) p[`fq_classe[${filters.classe}]`] = 'on';
    if (filters.relator) p[`fq_magistrado[${filters.relator}]`] = 'on';
    if (filters.orgao) p[`fq_orgao_colegiado[${filters.orgao}]`] = 'on';
    if (filters.assunto) p[`fq_assuntos[${filters.assunto}]`] = 'on';
    return p;
  }

  /** Avisos de query, no padrão do repo. @private */
  _avisos(query, filters) {
    const a = [];
    const q = query || '';
    if (/\bNAO\b/.test(q)) {
      a.push('AVISO: no TJTO "NAO" SEM ACENTO nao e operador — vira palavra e INFLA a busca '
        + '(usucapiao NAO posse = 30.282 contra 550 da exclusao correta). Escreva "NÃO" ou "NOT".');
    }
    if (/\b(ADJ|PROX)\b/.test(q)) {
      a.push('AVISO: ADJ e PROX nao existem no TJTO — sao IGNORADOS (a busca vira a uniao dos termos).');
    }
    if (/\S\s+\S/.test(q.replace(/"[^"]*"/g, '')) && !/\b(E|AND|OU|OR|NOT|NÃO)\b/.test(q)) {
      a.push('AVISO: no TJTO o ESPACO entre termos e OR (uniao), nao AND — provado: '
        + '1.807 + 29.310 - 1.257 = 29.860. Para exigir os dois termos escreva "E" ou "AND".');
    }
    if (filters.tipo === 'sentenca' || filters.tipo === 'monocratica') {
      a.push('AVISO: monocratica e sentenca so existem na base a partir de 2024 '
        + '(em 2019-2023 o acervo e praticamente so acordao). Pedido historico nesses tipos devolve pouco.');
      a.push('AVISO: sentenca e monocratica NAO TEM EMENTA — o campo traz a DECISAO INTEIRA '
        + '(cabecalho, partes, corpo) e vem SEM relator. Nao apresente esse texto como ementa.');
    }
    if (filters.tipo === 'monocratica') {
      a.push('AVISO: a aba "Decisoes Monocraticas" mistura DESPACHO DE MERO EXPEDIENTE '
        + '(ex.: "Emenda a Inicial", "INTIME-SE") com decisao de merito. O total de 597.990 nao e '
        + 'jurisprudencia toda. Recorte por "Tipo Julgamento" antes de contar.');
    }
    if (filters.origem === 'comum') {
      a.push('AVISO: --origem comum e recorte de CLIENTE (o portal so oferece faceta POSITIVA). '
        + 'O total do servidor se refere ao acervo SEM esse recorte.');
    }
    return a;
  }

  /** Busca. Contrato do repo: devolve Array com `.totalResults`. */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    const rows = Math.min(options.porPagina ?? this.porPagina, TJTONavigator.ROWS_MAX);
    const avisos = this._avisos(query, filters);
    avisos.forEach((x) => this.log(x));

    const resultados = [];
    let total = 0;
    let abas = {};
    let paginas = 0;

    for (let page = 0; page < maxPages; page++) {
      const html = await this.navigator.buscar(this._buildParams(query, filters, page * rows, rows));
      if (page === 0) { total = TJTOCrawler.lerTotal(html); abas = TJTOCrawler.lerAbas(html); }
      const cards = TJTOCrawler.fatiarCards(html);
      if (cards.length === 0) break;
      paginas = page + 1;
      const aba = { acordao: 'Acórdão', monocratica: 'Decisão Monocrática', sentenca: 'Sentença' }[filters.tipo] || 'Acórdão';
      for (const c of cards) resultados.push(this.mapCard(c, aba));
      if ((page + 1) * rows >= total) break;
    }

    // Recorte de cliente Juizado × Justiça Comum (só o lado "comum";
    // "turmas" é faceta de servidor e já veio filtrado).
    const saida = filters.origem === 'comum'
      ? resultados.filter((r) => r.instancia !== 'Turma Recursal')
      : resultados;

    if (this.includeFullText) {
      for (const r of saida) {
        try {
          r.inteiroTeor = await this.fetchInteiroTeor(r.id);
        } catch (e) {
          r.inteiroTeor = '';
          this.log(`AVISO: inteiro teor do documento ${r.id} falhou: ${e.message}`);
        }
      }
    }

    saida.totalResults = total;
    saida.totaisPorTipo = abas;
    saida.paginasLidas = paginas;
    saida.porPagina = rows;
    saida.totalExato = true; // medido: aritmética da última página fecha, sem teto de offset
    saida.avisos = avisos;
    this.ultimaBusca = { query, filters, total };
    return saida;
  }

  /**
   * Inteiro teor pelo permalink público (`documento.php?uuid=`).
   * ✅ Sem captcha e sem sessão. ⚠️ ISO-8859-1 — o Navigator já decodifica.
   * Típico: ~259 KB brutos → ~42 mil caracteres úteis, com cabeçalho, partes,
   * advogados, relatório, voto, dispositivo e a lista de votantes.
   */
  async fetchInteiroTeor(uuid) {
    if (!uuid) return '';
    const html = await this.navigator.documento(uuid);
    return TJTOCrawler.limparHtml(html);
  }

  /** A citação oficial pronta do portal (`rodape_ementa`), sem regex. */
  async fetchCitacao(uuid) {
    const doc = await this.navigator.ementa(uuid);
    return doc?.rodape_ementa ? TJTOCrawler.limparHtml(doc.rodape_ementa) : '';
  }
}

TJTOCrawler.TIPOS = TIPOS;
TJTOCrawler.COMPETENCIA_TURMAS = COMPETENCIA_TURMAS;
module.exports = TJTOCrawler;
