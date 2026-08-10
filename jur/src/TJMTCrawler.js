// src/TJMTCrawler.js
const TJMTNavigator = require('./TJMTNavigator');

/**
 * Crawler do TJMT (Tribunal de Justiça de Mato Grosso).
 * https://jurisprudencia.tjmt.jus.br — SPA Angular sobre API REST atrás de um
 * gateway Kong. Como TJBA/TJPA/TJPE, NÃO estende BaseCrawler: o acesso é HTTP
 * direto (ver TJMTNavigator). Contrato público do repo:
 * search(query, filters, options) → Array com .totalResults.
 *
 * A ementa e o inteiro teor JÁ VÊM no payload da busca, sem captcha e sem
 * request extra — por isso `--fetch-inteiro-teor` só grava em disco.
 *
 * ⚠️ Mas os dois tipos de documento têm SCHEMAS DIFERENTES (ver mapDocumento):
 * no acórdão `Conteudo` é a ementa e `Documento` é o inteiro teor; na
 * monocrática o campo `Documento` **não existe** e `Conteudo` é a decisão
 * inteira. Apresentar um pelo outro erra a natureza do texto.
 */

/**
 * `filtro.tipoBusca` — onde o termo é procurado.
 * ⚠️ Só afeta o acórdão: a contagem de monocrática fica travada nos três
 * valores (2.299 em `usucapião`), coerente com monocrática não ter ementa.
 */
const ESCOPOS = { ementa: 1, inteiro: 2, todos: 3 };

/** Entidades HTML do export de MS Word (mesmo caso do TJPE). */
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

class TJMTCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? TJMTNavigator.SIZE_DEFAULT, TJMTNavigator.SIZE_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJMTNavigator({
      timeout: options.timeout ?? 120000,
      log: this.log,
    });
  }

  /**
   * Tira o HTML do Word e decodifica entidade.
   *
   * 🔴 A PRIMEIRA SUBSTITUIÇÃO NÃO É OPCIONAL. Cada acórdão embute o brasão
   * como `data:image/png;base64,...` (~100 KB) dentro do campo `Documento`, e
   * um strip ingênuo — que só remove `<tag>` — deixa a imagem inteira virar
   * "texto" e ir para o JSON de saída. Removemos a URI de dados antes de
   * qualquer outra coisa.
   * @private
   */
  static limparHtml(s) {
    if (!s) return '';
    return String(s)
      // 1º: mata a imagem base64 embutida, ainda dentro do atributo.
      .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, e) => (Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m))
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um é uma armadilha medida.
   *
   * 🔴 O TJMT é o quinto conjunto de operadores em cinco tribunais da série, e
   * o mais traiçoeiro até aqui: as duas teclas quebradas **contraem** para um
   * número plausível em vez de zerar ou estourar. Não há sintoma visível.
   * @private
   */
  _avisosDaQuery(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. 🔴 `OU` e `NÃO` são descartados e a query cai no AND implícito do espaço.
    //    Medido: "usucapião OU posse" = "usucapião NÃO posse" = "usucapião posse" = 2.315.
    //    O usuário pediu união (ou exclusão) e recebeu interseção.
    const ptQuebrados = q.match(/(^|\s)(OU|NÃO)(\s|$)/g);
    if (ptQuebrados) {
      avisos.push(
        `AVISO: "${ptQuebrados.map(s => s.trim()).join('", "')}" NAO funciona no TJMT — ` +
        'e descartado em silencio e a busca vira E (AND). Voce recebe a INTERSECAO ' +
        'onde pediu uniao/exclusao, com um numero plausivel e sem erro. ' +
        'Para uniao, rode duas buscas e some.'
      );
    }
    // 2. 🔴 Um token ingles desliga o AND implícito e a query inteira vira OR.
    //    Medido: "usucapião AND posse" = 62.360 (3.849 + 60.783 - 2.315).
    const enOps = q.match(/(^|\s)(AND|OR|NOT)(\s|$)/g);
    if (enOps) {
      avisos.push(
        `AVISO: "${enOps.map(s => s.trim()).join('", "')}" NAO e operador no TJMT — ` +
        'um token desconhecido DESLIGA o AND implicito e a busca inteira vira OR, ' +
        'INFLANDO o resultado (medido: 62.360 onde se esperava 2.315).'
      );
    }
    // 3. 🔴 PROX e ADJ zeram. O que funciona é a palavra inteira: PROXIMO.
    if (/(^|\s)(PROX|ADJ)(\s|$)/.test(q)) {
      avisos.push(
        'AVISO: "PROX" e "ADJ" ZERAM a busca no TJMT (0 resultados, HTTP 200, sem erro). ' +
        'O operador de proximidade daqui e a palavra inteira: PROXIMO.'
      );
    }
    // 4. `$` degenera em vez de zerar (padrão TJAL): 2 se lê como busca específica.
    if (/\$/.test(q)) {
      avisos.push(
        'AVISO: "$" nao trunca no TJMT — DEGENERA a busca (medido: "usucapi$" = 2 contra ' +
        '3.849 de "usucapião"). Dois resultados se leem como busca especifica e nao sao. ' +
        'O curinga que funciona e "*".'
      );
    }
    // 5. Acento NAO importa aqui — o índice normaliza (usucapiao = usucapião = 3.852).
    //    Registrado para não repetir por engano o aviso do TJMS/TJBA.

    // 6. 🔴 O thesaurus infla ~10x. É checkbox da tela e default false na API.
    if (filters.thesaurus) {
      avisos.push(
        'AVISO: --thesaurus liga a busca por sinonimos e INFLA cerca de 10x ' +
        '(medido em 10/08/2026: "usucapião" vai de 6.151 para 59.606 documentos). ' +
        'O numero grande NAO e abundancia de jurisprudencia sobre o termo pedido.'
      );
    }
    return avisos;
  }

  /**
   * Monta os filtros no formato da API.
   * @private
   */
  _buildFilter(query, filters = {}) {
    const escopo = filters.escopo || 'ementa';
    if (!Object.prototype.hasOwnProperty.call(ESCOPOS, escopo)) {
      throw new Error(`--escopo invalido: "${escopo}" (use ementa, inteiro ou todos)`);
    }

    // ⚠️ `tipoProcesso` quer o RÓTULO ACENTUADO. Medido: "Cível" filtra (3.848),
    // "Civel" sem acento devolve 0 EM SILENCIO, e o id (1/2) tambem devolve 0.
    let tipoProcesso;
    if (filters.materia === 'civel') tipoProcesso = 'Cível';
    else if (filters.materia === 'criminal') tipoProcesso = 'Criminal';
    else if (filters.materia && filters.materia !== 'todas') {
      throw new Error(`--materia invalida: "${filters.materia}" (use civel, criminal ou todas)`);
    }

    const f = {
      'filtro.termoDeBusca': query || '',
      'filtro.tipoBusca': ESCOPOS[escopo],
      'filtro.area': 'Judiciaria',
      'filtro.ordenacao.ordenarPor': 'DataDecrescente',
      // ⚠️ Só ordena. Provado em 10/08/2026: com a MESMA janela, `Julgamento` e
      // `Publicacao` devolvem contagem identica (1.032) e mudam so a ordem dos
      // itens. NAO troca o campo que o filtro de data usa.
      'filtro.ordenacao.ordenarDataPor': filters.ordenarPor === 'publicacao' ? 'Publicacao' : 'Julgamento',
      'filtro.thesaurus': filters.thesaurus ? 'true' : 'false',
      // 🔴 A janela e de PUBLICACAO (ver search()) e vai em MM/DD/YYYY — o
      // TJMTNavigator.paraDataApi contorna o defeito de parse do servidor.
      'filtro.periodoDataDe': TJMTNavigator.paraDataApi(filters.dataPubInicio),
      'filtro.periodoDataAte': TJMTNavigator.paraDataApi(filters.dataPubFim),
      'filtro.tipoProcesso': tipoProcesso,
    };
    Object.keys(f).forEach((k) => f[k] === undefined && delete f[k]);
    return f;
  }

  /**
   * Documento cru da API → formato padrão do repo.
   *
   * 🔴 OS DOIS TIPOS TÊM SCHEMAS DIFERENTES, e é aqui que o repo erraria em
   * silêncio se copiasse a suposição de outro tribunal:
   *
   * | campo       | Acórdão                    | Monocrática                     |
   * |-------------|----------------------------|---------------------------------|
   * | `Conteudo`  | a EMENTA (987–3.604 chars) | a DECISÃO INTEIRA (10,9–19,4 mil)|
   * | `Documento` | o INTEIRO TEOR             | **não existe** (ausente, 5/5)   |
   *
   * Ou seja: monocrática do TJMT **não tem ementa** (padrão TJPE/TJCE).
   */
  mapDocumento(d, tipo) {
    const p = d.Processo || {};
    const eAcordao = tipo === 'ACORDAO';

    const conteudo = TJMTCrawler.limparHtml(d.Conteudo);
    const documento = TJMTCrawler.limparHtml(d.Documento);

    const r = {
      id: d.Id,
      tipoDocumento: eAcordao ? 'ACORDAO' : 'DECISAO_MONOCRATICA',
      numeroProcesso: p.NumeroUnicoFormatado || '',
      numeroProcessoSemMascara: p.NumeroUnico || '',
      uid: p.UID || null,
      // 🔴 NAO EXISTE PERMALINK POR DOCUMENTO — o card abre ementa e inteiro
      // teor no proprio DOM, sem rota por julgado. Nunca invente link do TJMT.
      processoUrl: null,
      inteiroTeorLink: null,
      orgaoJulgador: p.DescricaoCamara || '',
      // A base nao expoe Turma Recursal (ver aviso em search()): tudo que volta
      // aqui e 2º grau do Tribunal de Justica.
      instancia: p.Instancia || '',
      classe: p.NomeClasseEsferaProcessual || '',
      classeFeito: p.SiglaClasseFeito || '',
      assunto: p.Assunto || '',
      acao: p.TipoAcao || '',
      relator: p.NomeRelator || '',
      redatorDesignado: p.NomeRedatorDesignado || null,
      dataJulgamento: p.DataJulgamentoFormatada || '',
      dataPublicacao: p.DataPublicacaoFormatada || '',
      tipoProcesso: p.TipoProcesso || '',
      julgamento: p.Julgamento || '',
      origem: p.Origem || '',
      uf: 'MT',
      // ✅ A citacao oficial ja vem PRONTA — nada de regex, ao contrario dos
      // quatro tribunais da familia ESAJ.
      citacao: d.Observacao || '',
      // No acordao `Conteudo` e a ementa de verdade. Na monocratica NAO HA
      // ementa: deixamos o campo vazio em vez de mentir sobre a natureza do
      // texto, e a decisao inteira vai para `inteiroTeor`.
      ementa: eAcordao ? conteudo.substring(0, 10000) : '',
      semEmenta: !eAcordao,
    };
    if (this.includeFullText) {
      r.inteiroTeor = eAcordao ? documento : conteudo;
    }
    return r;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   *
   * @param {string} query
   * @param {Object} filters - dataPubInicio/dataPubFim (DD/MM/YYYY, PUBLICAÇÃO),
   *   tipo ('acordao'|'monocratica'|'todos'), escopo ('ementa'|'inteiro'|'todos'),
   *   materia ('civel'|'criminal'|'todas'), thesaurus (bool), ordenarPor
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const tipo = filters.tipo || 'todos';
    if (!['todos', 'acordao', 'monocratica'].includes(tipo)) {
      throw new Error(`-t invalido: "${tipo}" (use todos, acordao ou monocratica)`);
    }
    const filtros = this._buildFilter(query, filters);

    const avisos = this._avisosDaQuery(query, filters);

    // 🔴 A janela de data e de PUBLICACAO, e isso nao estava no mapeamento de
    // 08/08 — foi provado em 10/08/2026 lendo o par (julgamento, publicacao) de
    // cada documento devolvido: a janela de 1 dia 03/08/2026 devolve 8/8 com
    // `pub=03/08/2026` e julgamentos espalhados por 28-30/07. Nao existe filtro
    // por data de JULGAMENTO nesta API, embora o campo exista no documento.
    if (filters.dataPubInicio || filters.dataPubFim) {
      avisos.push(
        'NOTA: a janela de data do TJMT filtra DATA DE PUBLICACAO, nao de julgamento ' +
        '(provado em 10/08/2026). A data de julgamento existe no documento mas NAO e ' +
        'filtravel. Nao apresente o recorte como se fosse por julgamento.'
      );
      // Uma ponta só funciona aqui? Não medimos as duas pontas em separado —
      // mandamos sempre as duas quando o usuário der as duas, e avisamos quando
      // der só uma (a lição do TJPI, onde meia janela é ignorada em silêncio).
      if (!filters.dataPubInicio || !filters.dataPubFim) {
        avisos.push(
          'AVISO: voce mandou so uma ponta da janela de data. No TJMT isso NAO foi medido ' +
          'e no TJPI a meia janela e ignorada em silencio, devolvendo o acervo inteiro. ' +
          'Mande -dpi E -dpf para ter certeza do recorte.'
        );
      }
    }

    // 🔴 Nao ha Juizado/Turma Recursal nesta base — e a tela promete que ha.
    avisos.push(
      'NOTA: o TJMT NAO tem particao Juizado x Justica Comum nesta base. Os parametros ' +
      'que prometem isso (colegiado, localConsultaAcordao) sao IGNORADOS pelo servidor e ' +
      'CountRecursalEletronico e 0 em toda busca, inclusive nas de consumo. Pedido de ' +
      'jurisprudencia de Juizado Especial de MT NAO tem resposta aqui — e esse zero nao e ' +
      'ausencia de julgado.'
    );

    if ((filters.escopo || 'ementa') !== 'ementa' && tipo !== 'acordao') {
      avisos.push(
        'NOTA: --escopo so afeta ACORDAO. A contagem de monocratica nao muda nos tres ' +
        'valores, porque monocratica nao tem ementa separada.'
      );
    }

    avisos.forEach((a) => this.log(a));

    const all = [];
    // 🔴 DEDUPLICACAO OBRIGATORIA. A paginacao do TJMT e INSTAVEL: nao ha campo
    // de desempate na ordenacao, e a mesma pagina 2, em tres execucoes
    // seguidas, devolveu tres conjuntos diferentes — com documento que estava
    // na pagina 1 de uma execucao reaparecendo na pagina 2 de outra
    // (padrao TJRJ/TJMG). Sem isto, uma varredura repete e perde documentos.
    const vistos = new Set();
    let repetidos = 0;
    let totais = null;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      this.log(`Extracting results from page ${pagina}...`);
      const data = await this.navigator.buscar(filtros, pagina, this.pageSize);

      if (totais === null) {
        totais = {
          total: data.total,
          acordao: data.totalAcordao,
          monocratica: data.totalMonocratica,
          recursal: data.totalRecursal,
        };
        this.log(
          `Total results on server: ${totais.total} ` +
          `(acordao ${totais.acordao} + monocratica ${totais.monocratica})`
        );
      }

      // ⚠️ O recorte por tipo e de CLIENTE: `filtro.tipoConsulta` e ignorado e a
      // API manda as duas colecoes SEMPRE. Cada busca ja pagou o custo das duas.
      const lote = [];
      if (tipo !== 'monocratica') lote.push(...data.acordaos.map((d) => [d, 'ACORDAO']));
      if (tipo !== 'acordao') lote.push(...data.monocraticas.map((d) => [d, 'MONOCRATICA']));

      if (!data.acordaos.length && !data.monocraticas.length) break;

      let novos = 0;
      for (const [d, t] of lote) {
        const chave = `${t}:${d.Id}`;
        if (d.Id != null && vistos.has(chave)) { repetidos++; continue; }
        if (d.Id != null) vistos.add(chave);
        all.push(this.mapDocumento(d, t));
        novos++;
      }
      this.log(`Found ${novos} new results on page ${pagina} (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
    }

    if (repetidos) {
      const a = `AVISO: ${repetidos} documento(s) vieram REPETIDOS entre paginas e foram ` +
        'descartados. A paginacao do TJMT e instavel (sem campo de desempate): o mesmo ' +
        'documento pode repetir numa pagina e SUMIR de outra. O crawler deduplica por Id, ' +
        'mas isso nao recupera o que o servidor deixou de mandar.';
      this.log(a);
      avisos.push(a);
    }

    this.ultimaBusca = {
      totalTJMT: totais ? totais.total : null,
      totalAcordao: totais ? totais.acordao : null,
      totalMonocratica: totais ? totais.monocratica : null,
      totalRecursalEletronico: totais ? totais.recursal : null,
      repetidosDescartados: repetidos,
      janelaDeDataEDePublicacao: !!(filters.dataPubInicio || filters.dataPubFim),
      avisos,
    };
    all.totalResults = totais ? totais.total : null;
    return all;
  }

  /**
   * Grava o inteiro teor em disco. Não há request extra: o texto já veio no
   * payload da busca (nem captcha, nem sessão) — padrão TJDFT/TJBA/TJPE.
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
      // ⚠️ O mesmo numero de processo tem varios julgados (acordao e
      // monocratica), entao o nome precisa do Id, que e quem identifica o
      // DOCUMENTO.
      const proc = (r.numeroProcesso || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${r.id}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }
}

TJMTCrawler.ESCOPOS = ESCOPOS;

module.exports = TJMTCrawler;
