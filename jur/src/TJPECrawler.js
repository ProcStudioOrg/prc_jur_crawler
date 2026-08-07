// src/TJPECrawler.js
const TJPENavigator = require('./TJPENavigator');

/**
 * Crawler do TJPE (Tribunal de Justiça de Pernambuco).
 * https://consultajurisprudencia.app.tjpe.jus.br — SPA Angular sobre API
 * JHipster pública. Como TJBA/TJPA, NÃO estende BaseCrawler: o acesso é HTTP
 * direto (ver TJPENavigator). Contrato público do repo:
 * search(query, filters, options) → Array com .totalResults.
 *
 * O inteiro teor JÁ VEM no payload da busca (`textoAcordao` / `textoDecisao`),
 * e a ementa é um campo separado e real (`textoEmenta`) — por isso
 * `--fetch-inteiro-teor` não faz request extra.
 */

/** Regex que separa Juizado/Turma Recursal de Justiça Comum pelo nome do órgão
 *  gravado NO DOCUMENTO. Ver ressalva: o filtro de órgão do servidor não serve
 *  para isso. */
const RE_TURMAS = /turma recursal|col[ée]gio recursal|jecrc|turma (estadual )?de uniformiza/i;

/** Entidades HTML que aparecem no texto do TJPE (exportado do MS Word). */
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
};

class TJPECrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? 100, TJPENavigator.SIZE_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJPENavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
  }

  /** DD/MM/YYYY → YYYY-MM-DD. @private */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** ISO → DD/MM/YYYY. @private */
  _toBrDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  }

  /**
   * Tira o HTML do Word e decodifica entidade.
   *
   * ⚠️ Os textos do TJPE vêm como export do MS Word: ~50 KB de markup para
   * ~2,4 KB de texto útil, e todo acento é entidade (`&ccedil;`). Um strip
   * ingênuo que só remove `<tag>` devolve "Justi a de Pernambuco".
   * @private
   */
  static limparHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, e) => (Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m))
      // lixo do cabeçalho de export do Word
      .replace(/Normal\s+0\s+\d+\s+false\s+false\s+false[^\n]*/gi, ' ')
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um é uma armadilha medida.
   * @private
   */
  _avisosDaQuery(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. 🔴 Aqui os operadores INGLESES é que enganam — o inverso do TJBA.
    //    Medido: AND=0, OR=1, ADJ=0, NOT=1.281 (contra NAO=2.007).
    const enOps = q.match(/(^|\s)(AND|OR|NOT|ADJ)(\s|$)/g);
    if (enOps) {
      avisos.push(
        `AVISO: "${enOps.map(s => s.trim()).join('", "')}" NAO e operador no TJPE — ` +
        'AND e ADJ ZERAM a busca e OR devolve 1. Os operadores desta base sao em ' +
        'PORTUGUES: E, OU, NAO (ou NAO acentuado) e PROX.'
      );
    }
    // 2. Espaço entre termos é E (AND). Medido: "usucapiao posse" = "usucapiao E posse" = 4.269.
    //    Vale avisar só quando o usuário misturou operador com espaço.
    if (/\bPROX\b/.test(q)) {
      avisos.push('NOTA: PROX funciona no TJPE (medido: 13 resultados), mas e MUITO restritivo.');
    }
    // 3. Acento NAO importa aqui — o indice normaliza (usucapiao = usucapião = 6.266).
    //    Registrado para nao repetir o aviso do TJBA/TJMS por engano.

    // 4. `$` nao e operador: e ignorado (usucapiao$ = usucapiao = 6.266).
    if (/\$/.test(q)) {
      avisos.push('AVISO: "$" nao e operador no TJPE — e ignorado, nao trunca.');
    }
    // 5. Curinga `*` NAO expande: `usucapi*` = 921 contra `usucapiao` = 6.266.
    if (/\*/.test(q)) {
      avisos.push(
        'AVISO: o curinga "*" no TJPE devolve MENOS que o termo inteiro ' +
        '(medido: "usucapi*"=921 x "usucapiao"=6.266). Nao e truncamento a esquerda do indice.'
      );
    }
    if (filters.origem && filters.origem !== 'ambas') {
      avisos.push(
        `NOTA: --origem ${filters.origem} e aplicado no CLIENTE, pelo nome do orgao julgador. ` +
        'O filtro de orgao da API do TJPE nao e confiavel para agrupar (ver CLAUDE-TJPE.md), ' +
        'entao o total do servidor se refere ao acervo SEM esse recorte.'
      );
    }
    return avisos;
  }

  /**
   * Monta os filtros no formato da API.
   * @private
   */
  _buildFilter(query, filters = {}) {
    // 🔴 tipoSentenca.in e OBRIGATORIO junto com pesquisaLivre.contains:
    // sem ele a API devolve HTTP 500. E o enum e a LETRA (A/D), nao o rotulo
    // ACORDAO/DECISAO que a tela usa — mandar o rotulo devolve 0 EM SILENCIO.
    const tipo = filters.tipo || 'todos';
    const tipoSentenca = tipo === 'acordao' ? 'A' : tipo === 'monocratica' ? 'D' : 'A,D';

    // Meio de tramitação (Eletrônico x Físico). Medido: as duas partições somam
    // exatamente o total, então este filtro é confiável.
    const meio = filters.meio || 'ambos';
    const origemIn = meio === 'eletronico' ? 'ELETRONICO'
      : meio === 'fisico' ? 'FISICO'
        : 'ELETRONICO,FISICO';

    const f = {
      'pesquisaLivre.contains': query || undefined,
      'tipoSentenca.in': tipoSentenca,
      'origem.in': origemIn,
      'dataJulgamento.greaterThanOrEqual': this._toApiDate(filters.dataInicio),
      'dataJulgamento.lessThanOrEqual': this._toApiDate(filters.dataFim),
      'npuSemFormatacao.equals': filters.processo
        ? String(filters.processo).replace(/\D/g, '') : undefined,
      'numAntigo.equals': filters.numeroAntigo || undefined,
      'relator.in': filters.relator || undefined,
      'classeCNJ.in': filters.classe || undefined,
      'assuntoCNJ.in': filters.assunto || undefined,
      sort: 'dataJulgamento,desc',
    };
    Object.keys(f).forEach((k) => f[k] === undefined && delete f[k]);
    return f;
  }

  /** Resultado cru da API → formato padrão do repo. */
  mapDocumento(d) {
    const ementa = TJPECrawler.limparHtml(d.textoEmenta);
    // Acórdão usa textoAcordao; monocrática usa textoDecisao. Nunca os dois.
    const inteiro = TJPECrawler.limparHtml(d.textoAcordao || d.textoDecisao);

    const r = {
      id: d.chave,
      chave: d.chave,
      codigoProcesso: d.codigoProcesso,
      tipoDocumento: d.tipoSentenca === 'A' ? 'ACORDAO'
        : d.tipoSentenca === 'D' ? 'DECISAO_MONOCRATICA' : (d.tipoSentenca || ''),
      numeroProcesso: d.npu || '',
      processoUrl: null, // não existe permalink por documento — ver CLAUDE-TJPE.md
      orgaoJulgador: d.nomeOrgaoJulgador || '',
      instancia: RE_TURMAS.test(d.nomeOrgaoJulgador || '') ? 'Turma Recursal' : '2º Grau',
      classe: d.descrClasseCNJ || '',
      assunto: d.descrAssuntoCNJ || '',
      relator: d.relator || '',
      dataJulgamento: this._toBrDate(d.dataJulgamento),
      dataPublicacao: this._toBrDate(d.dataPublicacao),
      meioTramitacao: d.origem || '',
      uf: 'PE',
      // A ementa aqui é ementa de verdade (média ~2.4k de texto útil),
      // distinta do inteiro teor (~10.7k). Ver CLAUDE-TJPE.md.
      ementa: ementa.substring(0, 10000),
      inteiroTeorLink: null,
    };
    if (this.includeFullText) r.inteiroTeor = inteiro;
    return r;
  }

  /**
   * Busca uma página tolerando o "documento envenenado".
   *
   * 🔴 Existe registro que faz a API devolver HTTP 500 em QUALQUER página que
   * o contenha. Medido em 07/08/2026: com `usucapiao`, o offset 186 derruba
   * `page=1&size=100` de forma determinística (8/8), enquanto as páginas
   * vizinhas respondem 200. Um crawler ingênuo perde 100 documentos ou aborta.
   *
   * A recuperação bisecta a página em fatias menores e pula só o offset ruim,
   * registrando quantos documentos se perderam — nunca em silêncio.
   * @private
   */
  async _buscarPaginaTolerante(filtros, page, size) {
    try {
      return await this.navigator.buscar(filtros, page, size);
    } catch (e) {
      if (e.status !== 500) throw e;
      this.log(`  AVISO: HTTP 500 na pagina ${page + 1} (size=${size}); bisectando para achar o registro ruim...`);
      const inicio = page * size;
      const itens = [];
      let total = null;
      let perdidos = 0;
      for (let i = 0; i < size; i++) {
        try {
          const r = await this.navigator.buscar(filtros, inicio + i, 1);
          if (total === null) total = r.total;
          if (!r.itens.length) break; // fim do acervo
          itens.push(...r.itens);
        } catch (e2) {
          if (e2.status !== 500) throw e2;
          perdidos++;
          this.log(`  AVISO: documento no offset ${inicio + i} e ilegivel (HTTP 500 do servidor) — pulado.`);
        }
      }
      this._perdidos = (this._perdidos || 0) + perdidos;
      return { itens, total: total ?? 0, saturado: (total ?? 0) >= TJPENavigator.TETO_RESULTADOS };
    }
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   * @param {string} query
   * @param {Object} filters - dataInicio/dataFim (DD/MM/YYYY),
   *   tipo ('acordao'|'monocratica'|'todos'), meio ('eletronico'|'fisico'|'ambos'),
   *   origem ('comum'|'turmas'|'ambas'), processo, relator, classe, assunto
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const filtros = this._buildFilter(query, filters);
    this._perdidos = 0;

    const avisos = this._avisosDaQuery(query, filters);
    avisos.forEach((a) => this.log(a));

    const origem = filters.origem || 'ambas';
    const all = [];
    const vistos = new Set();
    let totalResults = null;
    let saturado = false;
    let descartadosPorOrigem = 0;

    for (let page = 0; page < maxPages; page++) {
      this.log(`Extracting results from page ${page + 1}...`);
      const data = await this._buscarPaginaTolerante(filtros, page, this.pageSize);

      if (totalResults === null) {
        totalResults = data.total;
        saturado = data.saturado;
        this.log(`Total results on server: ${totalResults}${saturado ? ' (SATURADO no teto de 10.000)' : ''}`);
        if (saturado) {
          const a = 'AVISO: o total do TJPE esta SATURADO no teto de 10.000 — o acervo real e MAIOR. ' +
            'Nao relate 10.000 como contagem; refine com data (-di/-df) para obter numero exato.';
          this.log(a);
          avisos.push(a);
        }
      }
      if (!data.itens.length) break;

      for (const d of data.itens) {
        if (d.chave && vistos.has(d.chave)) continue;
        if (d.chave) vistos.add(d.chave);
        // --origem é recorte de CLIENTE (ver ressalva do filtro de órgão).
        if (origem !== 'ambas') {
          const eTurma = RE_TURMAS.test(d.nomeOrgaoJulgador || '');
          if ((origem === 'turmas' && !eTurma) || (origem === 'comum' && eTurma)) {
            descartadosPorOrigem++;
            continue;
          }
        }
        all.push(this.mapDocumento(d));
      }
      this.log(`Found ${data.itens.length} results on page ${page + 1} (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      // Teto da janela: page*size não passa de 10.000.
      if ((page + 1) * this.pageSize >= TJPENavigator.TETO_RESULTADOS) {
        this.log('AVISO: teto de paginacao do TJPE (10.000 documentos) atingido.');
        break;
      }
    }

    if (this._perdidos) {
      const a = `AVISO: ${this._perdidos} documento(s) do TJPE sao ilegiveis (o servidor responde ` +
        'HTTP 500 ao le-los individualmente) e foram pulados. E defeito da base, nao da busca.';
      this.log(a);
      avisos.push(a);
    }

    this.ultimaBusca = {
      totalTJPE: totalResults,
      saturado,
      descartadosPorOrigem,
      documentosIlegiveis: this._perdidos || 0,
      avisos,
    };
    all.totalResults = totalResults;
    return all;
  }

  /**
   * Grava o inteiro teor em disco. Não há request extra: o texto já veio no
   * payload da busca (nem captcha, nem sessão).
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });
    return results.map((r) => {
      const texto = r.inteiroTeor || r.ementa || '';
      if (!texto) {
        log(`  sem texto: ${r.numeroProcesso}`);
        return { ...r, arquivo: null };
      }
      // O mesmo processo tem vários julgados — o nome precisa da chave.
      const proc = (r.numeroProcesso || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${String(r.chave || '').slice(0, 10)}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }
}

TJPECrawler.RE_TURMAS = RE_TURMAS;

module.exports = TJPECrawler;
